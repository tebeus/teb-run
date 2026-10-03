// Sintesi chiptune a sei canali: pulse1 e pulse2 con PeriodicWave, tri per il
// basso, lead2 per il controcanto, pad per il tappeto armonico, drums per la
// batteria (campionata quando c'è un kit, sintetica altrimenti). Le
// esportazioni di questa prima metà sono pure e testate in Node; createSynth,
// sotto, è il solo collegamento al Web Audio e riceve l'AudioContext come
// parametro.

import type { ChannelName } from './sequencer';
import { drumVoiceFor, SYNTH_DRUM_VOICES, type DrumKit, type DrumVoiceName } from './drums';

export interface Envelope {
  attack: number;
  decay: number;
  /** Frazione del picco tenuta fino alla fine della nota, 0..1. */
  sustain: number;
  release: number;
}

export interface EnvelopePoint {
  time: number;
  value: number;
}

/** Duty dei canali pulse previsti dalla spec §10: 12,5%, 25%, 50%. */
export const PULSE_DUTIES = [0.125, 0.25, 0.5] as const;
export type PulseDuty = (typeof PULSE_DUTIES)[number];

export const CHANNEL_ENVELOPES: Record<ChannelName, Envelope> = {
  pulse1: { attack: 0.005, decay: 0.04, sustain: 0.7, release: 0.06 },
  pulse2: { attack: 0.008, decay: 0.06, sustain: 0.55, release: 0.08 },
  tri: { attack: 0.004, decay: 0.05, sustain: 0.8, release: 0.05 },
  // Controcanto: attacco netto, coda un po' più lunga dei pulse, così le
  // note tenute si appoggiano sul riverbero del task 7.
  lead2: { attack: 0.01, decay: 0.05, sustain: 0.6, release: 0.1 },
  // Tappeto armonico: entra e esce piano, è la voce che non si deve notare.
  pad: { attack: 0.12, decay: 0.2, sustain: 0.85, release: 0.35 },
  drums: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
};

export const CHANNEL_LEVELS: Record<ChannelName, number> = {
  pulse1: 0.22,
  pulse2: 0.16,
  tri: 0.3,
  lead2: 0.12,
  pad: 0.09,
  drums: 0.22,
};

/** Duty fisso del controcanto: il suono sottile che taglia il mix. */
export const LEAD2_DUTY: PulseDuty = 0.125;

/**
 * Posto di ogni canale nello stereo (spec §10). Il basso e la batteria al
 * centro, dove stanno in qualsiasi mix; le voci melodiche larghe, così si
 * distinguono. Vale anche per gli effetti sonori, che usano lo stesso synth:
 * l'arpeggio del checkpoint arriva leggermente da sinistra, ed è voluto.
 */
export const CHANNEL_PAN: Record<ChannelName, number> = {
  pulse1: -0.25,
  pulse2: 0.25,
  tri: 0,
  lead2: 0.45,
  pad: -0.45,
  drums: 0,
};

/**
 * Coefficienti di Fourier di un'onda rettangolare con duty `duty`, nel formato
 * di `createPeriodicWave` (real = coseni, imag = seni). L'indice 0 è 0: nessuna
 * componente continua, così la forma d'onda non introduce offset e non fa clic.
 */
export function pulseHarmonics(duty: number, count = 32): { real: number[]; imag: number[] } {
  const real: number[] = [0];
  const imag: number[] = [0];
  for (let n = 1; n < count; n++) {
    real.push((2 * Math.sin(2 * Math.PI * n * duty)) / (Math.PI * n));
    imag.push((2 * (1 - Math.cos(2 * Math.PI * n * duty))) / (Math.PI * n));
  }
  return { real, imag };
}

export type NoiseFilterType = 'lowpass' | 'bandpass';

export interface NoiseVoice {
  filterType: NoiseFilterType;
  filterFreq: number;
  q: number;
  env: Envelope;
}

/**
 * Timbro di batteria scelto dalla frequenza della nota sul canale noise.
 * I brani usano C2 (65 Hz) cassa, D4 (294 Hz) rullante, A6 (1760 Hz) charleston.
 */
export function noiseVoiceFor(freq: number): NoiseVoice {
  if (freq < 200) {
    return {
      filterType: 'lowpass',
      filterFreq: 160,
      q: 1,
      env: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 },
    };
  }
  if (freq < 1200) {
    return {
      filterType: 'bandpass',
      filterFreq: 1500,
      q: 0.9,
      env: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.03 },
    };
  }
  return {
    filterType: 'bandpass',
    filterFreq: 9000,
    q: 5,
    env: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 },
  };
}

/**
 * Punti dell'inviluppo ADSR da passare a setValueAtTime (il primo) e
 * linearRampToValueAtTime (gli altri). I tempi sono strettamente crescenti:
 * se attack + decay non entrano nella durata vengono compressi in proporzione,
 * e i punti che cadrebbero nello stesso istante vengono fusi. Così non ci sono
 * rampe a durata zero, che sono la causa tipica dei clic.
 */
export function envelopePoints(
  env: Envelope,
  startTime: number,
  duration: number,
  velocity: number,
): EnvelopePoint[] {
  const total = Math.max(0.01, duration);
  let attack = env.attack;
  let decay = env.decay;
  const body = attack + decay;
  if (body > total) {
    const squeeze = total / body;
    attack *= squeeze;
    decay *= squeeze;
  }
  const top = Math.max(0, Math.min(1, velocity));
  const sustain = top * env.sustain;
  const raw: EnvelopePoint[] = [
    { time: startTime, value: 0 },
    { time: startTime + attack, value: top },
    { time: startTime + attack + decay, value: sustain },
    { time: startTime + total, value: sustain },
    { time: startTime + total + Math.max(0.001, env.release), value: 0 },
  ];
  const points: EnvelopePoint[] = [];
  for (const candidate of raw) {
    const last: EnvelopePoint | undefined = points[points.length - 1];
    if (last !== undefined && candidate.time <= last.time + 1e-9) last.value = candidate.value;
    else points.push({ time: candidate.time, value: candidate.value });
  }
  return points;
}

export interface Synth {
  /** Programma una nota. `startTime` è un tempo assoluto dell'AudioContext. */
  playNote(
    channel: ChannelName,
    freq: number,
    startTime: number,
    duration: number,
    velocity: number,
    noteName?: string,
  ): void;
  setDuty(channel: 'pulse1' | 'pulse2', duty: PulseDuty): void;
  /**
   * Spegne con una breve dissolvenza tutte le note vive e annulla quelle già
   * programmate ma non ancora partite: serve perché il sequencer programma
   * fino a LOOKAHEAD secondi di musica in avanti.
   */
  allNotesOff(fade?: number): void;
  /** Collega (o scollega, con null) la batteria campionata. */
  useDrumKit(next: DrumKit | null): void;
  readonly output: GainNode;
}

interface Voice {
  gain: GainNode;
  source: AudioScheduledSourceNode;
}

/** Unico punto di contatto con il Web Audio: l'AudioContext arriva da fuori. */
export function createSynth(ctx: AudioContext, destination: AudioNode): Synth {
  const output = ctx.createGain();
  output.gain.value = 1;
  output.connect(destination);

  function makeChannelGain(channel: ChannelName): GainNode {
    const gain = ctx.createGain();
    gain.gain.value = CHANNEL_LEVELS[channel];
    const pan = CHANNEL_PAN[channel];
    // StereoPannerNode manca su qualche browser vecchio: senza, il canale va
    // diretto all'uscita e il gioco suona mono, che è un ripiego accettabile.
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(output);
    } else {
      gain.connect(output);
    }
    return gain;
  }

  const channelGain: Record<ChannelName, GainNode> = {
    pulse1: makeChannelGain('pulse1'),
    pulse2: makeChannelGain('pulse2'),
    tri: makeChannelGain('tri'),
    lead2: makeChannelGain('lead2'),
    pad: makeChannelGain('pad'),
    drums: makeChannelGain('drums'),
  };

  const waves = new Map<number, PeriodicWave>();
  for (const duty of PULSE_DUTIES) {
    const harmonics = pulseHarmonics(duty, 32);
    waves.set(
      duty,
      ctx.createPeriodicWave(
        new Float32Array(harmonics.real),
        new Float32Array(harmonics.imag),
        { disableNormalization: false },
      ),
    );
  }

  const duties: Record<'pulse1' | 'pulse2', PulseDuty> = { pulse1: 0.5, pulse2: 0.25 };

  // Un secondo di rumore bianco, riprodotto in loop e filtrato per ogni colpo.
  const noiseBuffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate)), ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

  const voices = new Set<Voice>();

  // Riempito dal bus col task 6, quando i campioni sono pronti. Finché è
  // null la batteria è quella sintetica.
  let kit: DrumKit | null = null;

  function playNote(
    channel: ChannelName,
    freq: number,
    startTime: number,
    duration: number,
    velocity: number,
    noteName?: string,
  ): void {
    if (!Number.isFinite(freq) || freq <= 0 || !(duration > 0) || velocity <= 0) return;
    const start = Math.max(startTime, ctx.currentTime);

    // Batteria campionata: un nodo per colpo, gestito dal kit, che ha il suo
    // inviluppo dentro il campione. Se il kit non c'è (o non ha quel
    // campione) si cade sul rumore filtrato, qui sotto.
    if (channel === 'drums' && kit !== null) {
      const voice = drumVoiceFor(noteName);
      if (voice !== null && kit.hit(voice, start, velocity)) return;
    }

    const gain = ctx.createGain();
    gain.gain.value = 0;
    let env = CHANNEL_ENVELOPES[channel];
    let source: AudioScheduledSourceNode;
    if (channel === 'drums') {
      // Ripiego sintetico: il timbro viene dalla lettera della nota se c'è,
      // altrimenti dalla frequenza, come faceva il canale `noise`.
      const drum = drumVoiceFor(noteName);
      const voice = drum === null ? noiseVoiceFor(freq) : SYNTH_DRUM_VOICES[drum];
      env = voice.env;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = voice.filterType;
      filter.frequency.value = voice.filterFreq;
      filter.Q.value = voice.q;
      noise.connect(filter);
      filter.connect(gain);
      source = noise;
    } else if (channel === 'tri') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      source = osc;
    } else if (channel === 'pad') {
      // Dente di sega: è la forma con più armoniche, quindi è quella che il
      // chorus e il riverbero del task 7 allargano meglio.
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.connect(gain);
      source = osc;
    } else {
      const osc = ctx.createOscillator();
      const duty = channel === 'lead2' ? LEAD2_DUTY : duties[channel];
      const wave = waves.get(duty);
      if (wave === undefined) osc.type = 'square';
      else osc.setPeriodicWave(wave);
      osc.frequency.value = freq;
      osc.connect(gain);
      source = osc;
    }
    gain.connect(channelGain[channel]);

    const points = envelopePoints(env, start, duration, velocity);
    const first: EnvelopePoint | undefined = points[0];
    if (first === undefined) return;
    gain.gain.setValueAtTime(first.value, first.time);
    for (let i = 1; i < points.length; i++) {
      const point: EnvelopePoint | undefined = points[i];
      if (point === undefined) continue;
      gain.gain.linearRampToValueAtTime(point.value, point.time);
    }
    const last: EnvelopePoint | undefined = points[points.length - 1];
    const end = last === undefined ? first.time : last.time;

    const voice: Voice = { gain, source };
    voices.add(voice);
    source.onended = (): void => {
      voices.delete(voice);
      gain.disconnect();
    };
    source.start(start);
    source.stop(end + 0.01);
  }

  function setDuty(channel: 'pulse1' | 'pulse2', duty: PulseDuty): void {
    duties[channel] = duty;
  }

  function allNotesOff(fade = 0.03): void {
    const now = ctx.currentTime;
    // Vale anche per le note programmate nel futuro: il loro guadagno è ancora
    // 0, e uno stop precedente allo start fa sì che non suonino affatto.
    for (const voice of [...voices]) {
      const param = voice.gain.gain;
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
      }
      param.linearRampToValueAtTime(0, now + fade);
      try {
        voice.source.stop(now + fade + 0.005);
      } catch {
        // sorgente già conclusa: niente da fare
      }
    }
  }

  function useDrumKit(next: DrumKit | null): void {
    kit = next;
  }

  return { playNote, setDuty, allNotesOff, useDrumKit, output };
}
