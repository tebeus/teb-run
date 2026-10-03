// Effetti sonori: motore continuo, derapata, urto, urtino, checkpoint, fanfara,
// blip. Le funzioni e le tabelle di questa prima metà sono pure e testate in
// Node; createSfx, sotto, è il collegamento al Web Audio.

import type { Gear, SfxName } from '../types';
import type { SampledEngine } from './engine-sampled';
import { noteToFreq } from './notes';
import { createSynth } from './synth';

/**
 * Sagoma [0, 1]: negativo e non finito vanno a 0, tranne `+Infinity` che va
 * a 1 (una velocità "infinita" è tutto gas, non ferma). Condivisa con
 * `engine-sampled.ts`, che aveva la stessa funzione con questa stessa
 * semantica duplicata (revisione finale, Important 6).
 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 1 : 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Spec §10: 60 + p*240 Hz in lo, 40 + p*200 Hz in hi. */
export function engineFreq(speedPercent: number, gear: Gear): number {
  const p = clamp01(speedPercent);
  return gear === 'lo' ? 60 + p * 240 : 40 + p * 200;
}

/** Taglio del passa-basso sul motore (spec §10). */
export function engineFilterFreq(speedPercent: number): number {
  return 400 + clamp01(speedPercent) * 2600;
}

/** Scordatura dei due denti di sega, in cent e come rapporto (spec §10). */
export const DETUNE_CENTS = 7;
export const DETUNE_RATIO = Math.pow(2, DETUNE_CENTS / 1200);
/** Guadagno dell'onda quadra un'ottava sotto (spec §10). */
export const SUB_GAIN = 0.5;
/** Pendenza della saturazione `tanh(drive · x)` (spec §10). */
export const SHAPER_DRIVE = 2;
/** Campioni della curva di saturazione: dispari, così c'è lo zero esatto. */
export const SHAPER_SAMPLES = 1025;
/** Sotto questa differenza non vale riscrivere la profondità del tremolo. */
export const ENGINE_TREMOLO_EPSILON = 0.01;
/** Costante di tempo della rampa sulla profondità del tremolo, condivisa dal
 *  motore sintetico e da quello campionato (`engine-sampled.ts`). */
export const TREMOLO_RAMP = 0.08;

/** Frequenza del borbottio: 9 Hz al minimo, 15 a tutta (spec §10). */
export function tremoloFreq(speedPercent: number): number {
  return 9 + clamp01(speedPercent) * 6;
}

/** Profondità del borbottio: forte al minimo, spento in velocità (spec §10). */
export function tremoloDepth(speedPercent: number): number {
  return 0.35 * (1 - clamp01(speedPercent));
}

/**
 * Curva `tanh(drive · x)` su [-1, 1] per un `WaveShaperNode`. Condivisa da
 * `saturationCurve` (synth), `sampledSaturationCurve` (motore campionato,
 * `engine-sampled.ts`) e `limiterCurve` (bus musica, `effects.ts`): le tre
 * erano lo stesso ciclo con un solo numero diverso (revisione finale,
 * Important 6).
 */
export function tanhCurve(drive: number, samples: number): Float32Array<ArrayBuffer> {
  const n = Math.max(3, Math.floor(samples));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x);
  }
  return curve;
}

/**
 * Curva di saturazione `tanh(SHAPER_DRIVE · x)` su [-1, 1], per il
 * `WaveShaperNode` (spec §10). Si costruisce una volta sola.
 */
export function saturationCurve(samples: number = SHAPER_SAMPLES): Float32Array<ArrayBuffer> {
  return tanhCurve(SHAPER_DRIVE, samples);
}

/** Volume del motore; 0 a motore spento. */
export function engineLevel(running: boolean, speedPercent: number): number {
  return running ? 0.05 + clamp01(speedPercent) * 0.1 : 0;
}

/** Vero solo se vale la pena scrivere sull'AudioParam: evita 60 automazioni al secondo. */
export function shouldUpdateParam(last: number, next: number, epsilon: number): boolean {
  return Math.abs(next - last) >= epsilon;
}

export const ENGINE_FREQ_EPSILON = 1;
export const ENGINE_FILTER_EPSILON = 10;
export const ENGINE_LEVEL_EPSILON = 0.004;

export interface ArpeggioNote {
  note: string;
  /** Offset in secondi dall'inizio dell'effetto. */
  at: number;
  dur: number;
  vel: number;
}

/** Melodie originali per checkpoint (4 note) e finale (8 note), spec §10. */
export const ARPEGGIOS: Record<'checkpoint' | 'fanfare', readonly ArpeggioNote[]> = {
  checkpoint: [
    { note: 'C5', at: 0, dur: 0.11, vel: 0.8 },
    { note: 'E5', at: 0.08, dur: 0.11, vel: 0.8 },
    { note: 'G5', at: 0.16, dur: 0.11, vel: 0.8 },
    { note: 'C6', at: 0.24, dur: 0.3, vel: 0.85 },
  ],
  fanfare: [
    { note: 'C5', at: 0, dur: 0.12, vel: 0.8 },
    { note: 'E5', at: 0.1, dur: 0.12, vel: 0.8 },
    { note: 'G5', at: 0.2, dur: 0.12, vel: 0.8 },
    { note: 'C6', at: 0.3, dur: 0.18, vel: 0.85 },
    { note: 'B5', at: 0.45, dur: 0.1, vel: 0.8 },
    { note: 'A5', at: 0.55, dur: 0.1, vel: 0.8 },
    { note: 'G5', at: 0.65, dur: 0.14, vel: 0.85 },
    { note: 'C6', at: 0.8, dur: 0.6, vel: 0.9 },
  ],
};

export const BLIP_NOTE = 'C6';

/** Taglio del passa-basso dello sterrato, in Hz (spec §10). */
export const RUMBLE_CUTOFF = 300;
/** Volume del rombo quando è acceso. */
export const RUMBLE_LEVEL = 0.1;

/**
 * Quanto il passa-basso dello sterrato si apre a velocità piena, in Hz
 * (spec §10): da `RUMBLE_CUTOFF` fermo a `RUMBLE_CUTOFF + RUMBLE_SWEEP`
 * a tavoletta. Il fruscio della ghiaia sale di tono correndo, come il
 * motore; il rumore marrone di base resta lo stesso.
 */
export const RUMBLE_SWEEP = 900;

/**
 * Taglio del passa-basso della pioggia, in Hz. Più alto di quello dello
 * sterrato: la pioggia è un sibilo, non un rombo. Con un campione vero
 * il filtro si apre e non colora niente.
 */
export const RAIN_CUTOFF = 1400;
/** Taglio del filtro quando suona un campione vero: praticamente aperto. */
export const RAIN_OPEN = 18000;
/**
 * Livello massimo dell'anello di pioggia: un fondo, non un protagonista.
 * Il riferimento sono i due anelli continui che già stanno sul bus degli
 * effetti: `RUMBLE_LEVEL = 0.1` e la derapata a 0.12. La pioggia è la
 * più costante delle tre — non si spegne mai per tutta la tappa — quindi
 * poco più forte di loro e molto sotto il motore.
 */
export const RAIN_LEVEL_MAX = 0.16;
/** Raffiche: un LFO lento sul guadagno, così la pioggia non è un fruscio piatto. */
export const RAIN_GUST_HZ = 0.13;
export const RAIN_GUST_DEPTH = 0.25;
/** Secondi di dissolvenza quando la pioggia si accende o si spegne. */
export const RAIN_FADE_S = 0.25;

/**
 * Frequenza del passa-basso dello sterrato a una data velocità
 * (spec §10). Una velocità fuori da `[0, 1]` o non numerica torna al
 * minimo: il filtro non deve mai ricevere un `NaN`, che in Web Audio
 * lancia. Pura.
 */
export function rumbleFilterFreq(speedPercent: number): number {
  const p = Number.isFinite(speedPercent) ? Math.min(1, Math.max(0, speedPercent)) : 0;
  return RUMBLE_CUTOFF + p * RUMBLE_SWEEP;
}

/** Guadagno applicato al rumore marrone, che nasce molto più basso del bianco. */
export const BROWN_GAIN = 3.5;
/** Quanto pesa il campione nuovo: più è piccolo, più il rumore è scuro. */
export const BROWN_MIX = 0.02;

/**
 * Un campione di rumore marrone: integratore con perdita sul rumore bianco.
 * Il divisore `1 + BROWN_MIX` tiene il valore dentro ±1 anche con un ingresso
 * costante a 1. Pura.
 */
export function brownStep(last: number, white: number): number {
  return (last + BROWN_MIX * white) / (1 + BROWN_MIX);
}

/** Riempie un buffer di rumore marrone con il generatore dato. */
export function fillBrownNoise(data: Float32Array, rng: () => number): void {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = brownStep(last, rng() * 2 - 1);
    const v = last * BROWN_GAIN;
    data[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
}

/**
 * LFO + profondità del tremolo: un oscillatore sinusoidale che fa oscillare
 * il guadagno di `target` di ±depth. Condiviso dal motore sintetico (qui
 * sotto) e da quello campionato (`engine-sampled.ts`), che costruivano lo
 * stesso grafo a mano (revisione finale, Important 6).
 */
export function createTremolo(
  ctx: BaseAudioContext,
  target: GainNode,
): { lfo: OscillatorNode; depth: GainNode } {
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = tremoloFreq(0);
  const depth = ctx.createGain();
  depth.gain.value = tremoloDepth(0);
  lfo.connect(depth);
  depth.connect(target.gain);
  lfo.start();
  return { lfo, depth };
}

export interface SfxPlayer {
  /** Da chiamare a ogni tick di gioco: non alloca nodi. */
  setEngine(speedPercent: number, gear: Gear, running: boolean): void;
  setSkid(on: boolean): void;
  /** Rombo di sterrato: nodo unico, acceso e spento con una rampa. */
  setRumble(on: boolean, speedPercent?: number): void;
  /** Livello dell'anello di pioggia, in `[0, 1]`; 0 è silenzio. */
  setRain(level: number): void;
  /**
   * Campione di pioggia dal loader del binario J, o `null` per restare
   * sul rumore filtrato. Chiamata **una volta**, quando i campioni sono
   * arrivati: se l'anello sta già suonando, sostituisce la sorgente.
   */
  useRainSample(buffer: AudioBuffer | null): void;
  /**
   * Passa al motore campionato (o torna al sintetico con null). Il motore
   * sintetico, se era già stato costruito, viene portato a zero: i suoi
   * oscillatori restano, ma muti.
   */
  useSampledEngine(engine: SampledEngine | null): void;
  play(name: SfxName): void;
  stopAll(): void;
}

export function createSfx(ctx: AudioContext, destination: AudioNode): SfxPlayer {
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(destination);

  // Il synth serve per gli effetti melodici: duty 12,5% sul canale dei blip.
  const synth = createSynth(ctx, out);
  synth.setDuty('pulse1', 0.5);
  synth.setDuty('pulse2', 0.125);

  const noiseBuffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate)), ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

  let engine: {
    saws: [OscillatorNode, OscillatorNode];
    sub: OscillatorNode;
    filter: BiquadFilterNode;
    depth: GainNode;
    lfo: OscillatorNode;
    gain: GainNode;
  } | null = null;
  let lastFreq = -1;
  let lastFilter = -1;
  let lastLevel = -1;
  let lastTremolo = -1;
  let sampled: SampledEngine | null = null;

  /**
   * Catena del motore (spec §10): due seghe scordate più la quadra un'ottava
   * sotto → saturazione → passa-basso → tremolo → volume. Si costruisce una
   * volta sola: `setEngine` gira a 60 chiamate al secondo e non deve allocare.
   */
  function ensureEngine(): void {
    if (engine !== null) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(out);
    // Il tremolo è un guadagno fisso a 1 che l'LFO fa oscillare di ±depth.
    const tremolo = ctx.createGain();
    tremolo.gain.value = 1;
    tremolo.connect(gain);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = engineFilterFreq(0);
    filter.Q.value = 1;
    filter.connect(tremolo);
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve();
    shaper.connect(filter);

    const base = engineFreq(0, 'lo');
    const saw = (ratio: number): OscillatorNode => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = base * ratio;
      osc.connect(shaper);
      osc.start();
      return osc;
    };
    const saws: [OscillatorNode, OscillatorNode] = [saw(DETUNE_RATIO), saw(1 / DETUNE_RATIO)];

    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = base / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = SUB_GAIN;
    sub.connect(subGain);
    subGain.connect(shaper);
    sub.start();

    const { lfo, depth } = createTremolo(ctx, tremolo);

    engine = { saws, sub, filter, depth, lfo, gain };
  }

  function setSynthEngine(speedPercent: number, gear: Gear, running: boolean): void {
    ensureEngine();
    if (engine === null) return;
    const now = ctx.currentTime;
    const freq = engineFreq(speedPercent, gear);
    const cutoff = engineFilterFreq(speedPercent);
    const level = engineLevel(running, speedPercent);
    const depth = tremoloDepth(speedPercent);
    if (shouldUpdateParam(lastFreq, freq, ENGINE_FREQ_EPSILON)) {
      engine.saws[0].frequency.setTargetAtTime(freq * DETUNE_RATIO, now, 0.03);
      engine.saws[1].frequency.setTargetAtTime(freq / DETUNE_RATIO, now, 0.03);
      engine.sub.frequency.setTargetAtTime(freq / 2, now, 0.03);
      engine.lfo.frequency.setTargetAtTime(tremoloFreq(speedPercent), now, 0.05);
      lastFreq = freq;
    }
    if (shouldUpdateParam(lastFilter, cutoff, ENGINE_FILTER_EPSILON)) {
      engine.filter.frequency.setTargetAtTime(cutoff, now, 0.05);
      lastFilter = cutoff;
    }
    if (shouldUpdateParam(lastLevel, level, ENGINE_LEVEL_EPSILON)) {
      engine.gain.gain.setTargetAtTime(level, now, 0.05);
      lastLevel = level;
    }
    if (shouldUpdateParam(lastTremolo, depth, ENGINE_TREMOLO_EPSILON)) {
      engine.depth.gain.setTargetAtTime(depth, now, TREMOLO_RAMP);
      lastTremolo = depth;
    }
  }

  function setEngine(speedPercent: number, gear: Gear, running: boolean): void {
    if (sampled !== null) {
      sampled.setEngine(speedPercent, gear, running);
      return;
    }
    setSynthEngine(speedPercent, gear, running);
  }

  function useSampledEngine(next: SampledEngine | null): void {
    // Se si torna al sintetico (null), il campionato precedente va zittito:
    // altrimenti resta acceso, sovrapposto al sintetico che riparte.
    if (next === null) sampled?.stop();
    sampled = next;
    if (next === null) return;
    // Il sintetico può essere già nato (il gioco suonava prima che i
    // campioni finissero di caricarsi): lo si silenzia, non lo si distrugge,
    // perché gli oscillatori non si possono far ripartire.
    if (engine !== null) {
      engine.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      lastLevel = 0;
    }
  }

  let skid: GainNode | null = null;
  let skidOn = false;

  function ensureSkid(): void {
    if (skid !== null) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start();
    skid = gain;
  }

  function setSkid(on: boolean): void {
    if (on === skidOn) return;
    skidOn = on;
    if (!on && skid === null) return;
    ensureSkid();
    if (skid === null) return;
    const now = ctx.currentTime;
    const param = skid.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(on ? 0.12 : 0, now + 0.05);
  }

  let rumble: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  let rumbleOn = false;

  function ensureRumble(): void {
    if (rumble !== null) return;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate)), ctx.sampleRate);
    fillBrownNoise(buffer.getChannelData(0), Math.random);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = RUMBLE_CUTOFF;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start();
    rumble = { gain, filter };
  }

  /**
   * Rombo di sterrato (spec §10). Il **livello** cambia solo quando
   * l'interruttore cambia, come nel binario H; il **taglio** segue la
   * velocità a ogni chiamata mentre è acceso, perché il fruscio della
   * ghiaia sale di tono correndo. Spegnendolo il taglio non si tocca:
   * non si sente niente, e rimetterlo a posto sarebbe una scrittura per
   * niente sessanta volte al secondo.
   */
  function setRumble(on: boolean, speedPercent = 0): void {
    if (on) {
      ensureRumble();
      if (rumble !== null) rumble.filter.frequency.value = rumbleFilterFreq(speedPercent);
    }
    if (on === rumbleOn) return;
    rumbleOn = on;
    if (!on && rumble === null) return;
    ensureRumble();
    if (rumble === null) return;
    const now = ctx.currentTime;
    const param = rumble.gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(on ? RUMBLE_LEVEL : 0, now + 0.08);
  }

  // -------------------------------------------------------------------------
  // Anello di pioggia (spec §10, §4.4f)
  // -------------------------------------------------------------------------

  let rain: { gain: GainNode; filter: BiquadFilterNode; source: AudioBufferSourceNode } | null = null;
  let rainBuffer: AudioBuffer | null = null;
  let rainLevel = 0;

  /** Sorgente dell'anello: il campione se c'è, il rumore bianco altrimenti. */
  function startRainSource(filter: BiquadFilterNode): AudioBufferSourceNode {
    const source = ctx.createBufferSource();
    source.buffer = rainBuffer ?? noiseBuffer;
    source.loop = true;
    source.connect(filter);
    source.start();
    // Con un campione vero il filtro si apre: la pioggia registrata ha
    // già il suo timbro, e colorarla la renderebbe un fruscio sordo.
    filter.frequency.value = rainBuffer === null ? RAIN_CUTOFF : RAIN_OPEN;
    return source;
  }

  /**
   * Catena della pioggia: sorgente in anello → passa-basso → guadagno,
   * più un LFO lento sommato al guadagno per le raffiche. Si costruisce
   * una volta sola, come il motore: `setRain` gira a sessanta chiamate
   * al secondo e non deve allocare (Review Focus 5).
   */
  function ensureRain(): void {
    if (rain !== null) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(out);
    const source = startRainSource(filter);
    // Raffiche: l'LFO si **somma** al valore del parametro, non lo
    // sostituisce, quindi `setRain` continua a comandare il livello.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = RAIN_GUST_HZ;
    const depth = ctx.createGain();
    depth.gain.value = RAIN_LEVEL_MAX * RAIN_GUST_DEPTH;
    lfo.connect(depth);
    depth.connect(gain.gain);
    lfo.start();
    rain = { gain, filter, source };
  }

  function setRain(level: number): void {
    const target = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    if (target === rainLevel) return;
    if (target === 0 && rain === null) {
      rainLevel = 0;
      return;
    }
    rainLevel = target;
    ensureRain();
    if (rain === null) return;
    const now = ctx.currentTime;
    const param = rain.gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target * RAIN_LEVEL_MAX, now + RAIN_FADE_S);
  }

  function useRainSample(buffer: AudioBuffer | null): void {
    if (buffer === rainBuffer) return;
    rainBuffer = buffer;
    if (rain === null) return;
    // L'anello sta già suonando: si sostituisce la sorgente, una volta.
    rain.source.stop();
    rain.source.disconnect();
    rain.source = startRainSource(rain.filter);
  }

  function noiseBurst(
    start: number,
    duration: number,
    filterType: 'lowpass' | 'bandpass',
    from: number,
    to: number,
    peak: number,
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(20, from), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.01);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(start);
    source.stop(start + duration + 0.02);
    source.onended = (): void => gain.disconnect();
  }

  function tone(
    type: OscillatorType,
    start: number,
    duration: number,
    from: number,
    to: number,
    peak: number,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.01);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    osc.connect(gain);
    gain.connect(out);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    osc.onended = (): void => gain.disconnect();
  }

  function play(name: SfxName): void {
    const now = ctx.currentTime + 0.01;
    switch (name) {
      case 'crash':
        noiseBurst(now, 0.6, 'bandpass', 1800, 200, 0.5);
        tone('sawtooth', now, 0.6, 420, 60, 0.35);
        break;
      case 'bump':
        tone('triangle', now, 0.12, 110, 55, 0.45);
        noiseBurst(now, 0.06, 'lowpass', 400, 120, 0.25);
        break;
      case 'checkpoint':
        for (const note of ARPEGGIOS.checkpoint) {
          synth.playNote('pulse1', noteToFreq(note.note), now + note.at, note.dur, note.vel);
        }
        break;
      case 'fanfare':
        for (const note of ARPEGGIOS.fanfare) {
          synth.playNote('pulse1', noteToFreq(note.note), now + note.at, note.dur, note.vel);
        }
        break;
      case 'blip':
        synth.playNote('pulse2', noteToFreq(BLIP_NOTE), now, 0.05, 0.6);
        break;
    }
  }

  /** Spegne tutto senza creare nodi: se motore e derapata non sono mai
   *  esistiti, non è il momento di costruirli. */
  function stopAll(): void {
    const now = ctx.currentTime;
    if (skid !== null) {
      skidOn = false;
      const param = skid.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(0, now + 0.05);
    } else {
      skidOn = false;
    }
    if (engine !== null) {
      engine.gain.gain.setTargetAtTime(0, now, 0.05);
      lastLevel = 0;
    }
    if (rumble !== null) {
      rumbleOn = false;
      // `rumble` ora è `{ gain, filter }`: il parametro sta un livello
      // più sotto. Senza questa riga `tsc` dà quattro errori
      // (`cancelScheduledValues`, `setValueAtTime`, `value`,
      // `linearRampToValueAtTime` non esistono su `GainNode`).
      const param = rumble.gain.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(0, now + 0.05);
    } else {
      rumbleOn = false;
    }
    setRain(0);
    sampled?.stop();
    synth.allNotesOff();
  }

  return { setEngine, setSkid, setRumble, setRain, useRainSample, useSampledEngine, play, stopAll };
}
