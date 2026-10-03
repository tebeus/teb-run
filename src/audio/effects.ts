// Effetti del bus musica: un delay a ripetizione e un passa-basso con sweep
// lento. Le esportazioni di questa prima metà sono pure e testate in Node;
// createMusicFx, sotto, è il solo collegamento al Web Audio e riceve
// l'AudioContext come parametro.

import { stepDuration } from './sequencer';
import { tanhCurve } from './sfx';

/** Quanti sedicesimi di ritardo: tre, cioè un ottavo puntato. */
export const DELAY_STEPS = 3;
/** Quanta parte dell'uscita rientra nel delay. */
export const DELAY_FEEDBACK = 0.35;
/** Quanto del segnale ritardato si sente. */
export const DELAY_WET = 0.25;
/** Limiti di sicurezza del DelayNode: sopra MAX_DELAY_TIME il nodo va costruito più grande. */
export const MIN_DELAY_TIME = 0.02;
export const MAX_DELAY_TIME = 1;
/** Tempo usato prima che un brano dica il suo. */
export const DEFAULT_BPM = 120;
/**
 * Costante di tempo delle rampe di `apply()` su delay, filtro e LFO: breve
 * abbastanza da restare percettibilmente istantanea, ma evita il clic di un
 * salto secco su `.value` quando cambia brano o quando la musica si ferma.
 */
export const RAMP_TIME_CONSTANT = 0.03;

/**
 * Tempo di ritardo in secondi per un brano a `bpm`: tre sedicesimi, limitato
 * a [MIN_DELAY_TIME, MAX_DELAY_TIME]. Un bpm non finito o <= 0 dà il minimo,
 * così il nodo non riceve mai NaN. Pura.
 */
export function delayTime(bpm: number, steps: number = DELAY_STEPS): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return MIN_DELAY_TIME;
  const raw = steps * stepDuration(bpm);
  if (!Number.isFinite(raw)) return MIN_DELAY_TIME;
  return Math.min(MAX_DELAY_TIME, Math.max(MIN_DELAY_TIME, raw));
}

/** Sweep del passa-basso di un brano: da `base` a `peak` Hz ogni `bars` battute. */
export interface FilterSweep {
  base: number;
  peak: number;
  bars: number;
}

/** Taglio del filtro quando il brano non chiede sweep: praticamente aperto. */
export const BYPASS_CUTOFF = 18000;

/** Centro dell'oscillazione del taglio, in Hz. Pura. */
export function sweepCentre(sweep: FilterSweep): number {
  return (sweep.base + sweep.peak) / 2;
}

/** Semiampiezza dell'oscillazione del taglio, in Hz; mai negativa. Pura. */
export function sweepDepth(sweep: FilterSweep): number {
  return Math.abs(sweep.peak - sweep.base) / 2;
}

/** Due ritardi brevi, nella finestra 12-20 ms che fa il chorus (spec §10). */
export const CHORUS_DELAYS: readonly [number, number] = [0.012, 0.018];
/** Velocità dei due LFO, in Hz: lente e diverse, così le due voci non si allineano. */
export const CHORUS_RATES: readonly [number, number] = [0.33, 0.47];
/** Escursione del ritardo intorno al suo valore, in secondi. */
export const CHORUS_DEPTH = 0.003;
/** Quanto del chorus si sente. */
export const CHORUS_WET = 0.28;

/** Durata della risposta all'impulso del riverbero, in secondi (spec §10). */
export const REVERB_SECONDS = 1.2;
/** Quanto del riverbero si sente (spec §10). */
export const REVERB_WET = 0.15;
/** Pendenza del decadimento: più alto, coda più corta. */
export const REVERB_DECAY = 3.2;

/**
 * Attenuazione del bus musica, in dB. Misurata, non scelta: con sei canali più
 * chorus e riverbero *Mirrorball Mile* arrivava a 1,0076 di picco, cioè oltre
 * il fondo scala, con due campioni in clipping (quattro alla seconda
 * esecuzione, quando il rumore del riverbero non era ancora seminato, vedi
 * `REVERB_IMPULSE_SEED`). −3 dB riporta il picco a circa 0,61.
 */
export const MUSIC_TRIM_DB = -3;
export const MUSIC_TRIM = Math.pow(10, MUSIC_TRIM_DB / 20);
/** Campioni della curva del limitatore: dispari, così c'è lo zero esatto. */
export const LIMITER_SAMPLES = 1025;

/**
 * Curva del limitatore morbido: `tanh(x)` su [-1, 1]. Ha pendenza 1
 * nell'origine, quindi ai livelli normali non fa niente di udibile, e
 * comprime solo vicino al fondo scala. Non sostituisce l'attenuazione: è la
 * rete sotto, per il picco che l'attenuazione non prevede (un riverbero che si
 * somma in fase, un brano aggiunto dopo). Pura.
 */
export function limiterCurve(samples: number = LIMITER_SAMPLES): Float32Array<ArrayBuffer> {
  return tanhCurve(1, samples);
}

/**
 * Un campione della risposta all'impulso sintetica: rumore per un inviluppo
 * che decade in modo esponenziale. Non è la stanza di nessun posto reale, ed è
 * esattamente il punto: costa un buffer e non un file da scaricare. Pura.
 */
export function impulseSample(index: number, length: number, decay: number, noise: number): number {
  const span = Math.max(1, length - 1);
  const t = Math.min(1, Math.max(0, index / span));
  return noise * Math.exp(-decay * t);
}

/** Riempie un canale della risposta all'impulso con il generatore dato. */
export function fillImpulseResponse(data: Float32Array, decay: number, rng: () => number): void {
  for (let i = 0; i < data.length; i++) {
    data[i] = impulseSample(i, data.length, decay, rng() * 2 - 1);
  }
}

/**
 * Generatore pseudocasuale con seme (mulberry32): stessa sequenza a ogni
 * chiamata con lo stesso seme. Serve solo a rumore bianco che non ha bisogno
 * di qualità crittografica, non a nient'altro. Pura: non tocca `Math.random`,
 * quindi due generatori con lo stesso seme restano identici per sempre.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seme fisso della risposta all'impulso del riverbero. Prima di questa
 * costante `createMusicFx` passava `Math.random` a `fillImpulseResponse`, e
 * il render offline (binario J, task 10) non era deterministico bit per bit:
 * ogni chiamata generava una coda di riverbero diversa. Il valore stesso non
 * ha alcun significato: basta che sia sempre lo stesso.
 */
const REVERB_IMPULSE_SEED = 0x5eed_c0de;

/**
 * Frequenza dell'LFO che muove il taglio: un ciclo completo ogni
 * `sweep.bars` battute a `bpm`. Una battuta è 16 sedicesimi. Pura.
 */
export function sweepRateHz(sweep: FilterSweep, bpm: number): number {
  const bars = sweep.bars;
  if (!Number.isFinite(bars) || bars <= 0) return 0;
  const barSeconds = 16 * stepDuration(bpm);
  if (!Number.isFinite(barSeconds) || barSeconds <= 0) return 0;
  return 1 / (bars * barSeconds);
}

export interface MusicFx {
  /** Nodo a cui collegare il synth della musica. */
  readonly input: GainNode;
  /**
   * Accende gli oscillatori (i due LFO del chorus e quello dello sweep). Il
   * bus la chiama quando parte un brano, non alla costruzione: fino a quel
   * momento non deve esistere nessun oscillatore, ed è l'invariante che
   * `tests/audio/bus.test.ts` verifica sul contesto sospeso di Safari.
   * Idempotente.
   */
  start(): void;
  /** Riallinea il tempo di delay e la velocità dello sweep al brano. */
  setBpm(bpm: number): void;
  /** null apre il filtro e ferma l'LFO. */
  setSweep(sweep: FilterSweep | null): void;
}

/**
 * Catena: input -> filtro passa-basso -> uscita; il filtro alimenta anche un
 * delay con rientro, il cui ritorno si somma all'uscita. L'LFO che muove il
 * taglio viene costruito solo al primo `setSweep` non nullo: il bus chiama
 * `createMusicFx` già in `unlock()`, e fino a quando non suona niente non
 * deve esistere nessun oscillatore (è l'invariante che `tests/audio/bus.test.ts`
 * verifica sul contesto ancora sospeso di Safari).
 */
export function createMusicFx(ctx: AudioContext, destination: AudioNode): MusicFx {
  const input = ctx.createGain();
  input.gain.value = 1;

  // Uscita comune del bus musica: attenuazione più limitatore morbido. Sei
  // canali più chorus e riverbero superano il fondo scala, misurato: il disco
  // arrivava a 1,0076 di picco con due campioni in clipping.
  const trim = ctx.createGain();
  trim.gain.value = MUSIC_TRIM;
  const limiter = ctx.createWaveShaper();
  limiter.curve = limiterCurve();
  trim.connect(limiter);
  limiter.connect(destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = BYPASS_CUTOFF;
  filter.Q.value = 1;
  input.connect(filter);
  filter.connect(trim);

  const delay = ctx.createDelay(MAX_DELAY_TIME);
  delay.delayTime.value = delayTime(DEFAULT_BPM);
  const feedback = ctx.createGain();
  feedback.gain.value = DELAY_FEEDBACK;
  const wet = ctx.createGain();
  wet.gain.value = DELAY_WET;
  filter.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(trim);

  // Chorus: due ritardi brevi in parallelo al segnale filtrato, ciascuno
  // modulato dal suo LFO. La somma dei due, a mandata CHORUS_WET, allarga il
  // suono senza farlo sentire come un effetto.
  const chorusWet = ctx.createGain();
  chorusWet.gain.value = CHORUS_WET;
  chorusWet.connect(trim);
  const chorusVoices = CHORUS_DELAYS.map((time) => {
    const node = ctx.createDelay(MAX_DELAY_TIME);
    node.delayTime.value = time;
    filter.connect(node);
    node.connect(chorusWet);
    return node;
  });

  // Riverbero: convolver con una risposta all'impulso sintetica di
  // REVERB_SECONDS. Due canali con rumore indipendente, così la coda è
  // stereo anche se l'ingresso è mono.
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = REVERB_WET;
  reverbWet.connect(trim);
  const convolver = ctx.createConvolver();
  const impulseLength = Math.max(1, Math.round(REVERB_SECONDS * ctx.sampleRate));
  const impulse = ctx.createBuffer(2, impulseLength, ctx.sampleRate);
  // Seme fisso, non Math.random: lo stesso impulso a ogni render, altrimenti
  // il render offline (task 10) non sarebbe deterministico bit per bit.
  const impulseRng = mulberry32(REVERB_IMPULSE_SEED);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    fillImpulseResponse(impulse.getChannelData(channel), REVERB_DECAY, impulseRng);
  }
  convolver.buffer = impulse;
  convolver.normalize = true;
  filter.connect(convolver);
  convolver.connect(reverbWet);

  let lfo: OscillatorNode | null = null;
  let depth: GainNode | null = null;
  let chorusLfos: OscillatorNode[] = [];
  let current: FilterSweep | null = null;
  let bpm = DEFAULT_BPM;

  /** Costruisce i tre oscillatori una volta sola. */
  function ensureOscillators(): void {
    if (lfo !== null) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 0;
    osc.connect(gain);
    gain.connect(filter.frequency);
    osc.start();
    lfo = osc;
    depth = gain;

    chorusLfos = chorusVoices.map((voice, i) => {
      const modulator = ctx.createOscillator();
      modulator.type = 'sine';
      modulator.frequency.value = CHORUS_RATES[i] ?? CHORUS_RATES[0];
      const amount = ctx.createGain();
      amount.gain.value = CHORUS_DEPTH;
      modulator.connect(amount);
      amount.connect(voice.delayTime);
      modulator.start();
      return modulator;
    });
  }

  function apply(): void {
    // setTargetAtTime invece di un salto secco su .value: un cambio di brano
    // (o uno stop) altrimenti farebbe un clic udibile sul delay, sul taglio
    // del filtro e sull'ampiezza dell'LFO. RAMP_TIME_CONSTANT è breve
    // apposta, per restare percettibilmente istantaneo.
    const now = ctx.currentTime;
    delay.delayTime.setTargetAtTime(delayTime(bpm), now, RAMP_TIME_CONSTANT);
    if (current === null) {
      filter.frequency.setTargetAtTime(BYPASS_CUTOFF, now, RAMP_TIME_CONSTANT);
      if (depth !== null) depth.gain.setTargetAtTime(0, now, RAMP_TIME_CONSTANT);
      if (lfo !== null) lfo.frequency.setTargetAtTime(0, now, RAMP_TIME_CONSTANT);
      return;
    }
    filter.frequency.setTargetAtTime(sweepCentre(current), now, RAMP_TIME_CONSTANT);
    if (depth !== null) depth.gain.setTargetAtTime(sweepDepth(current), now, RAMP_TIME_CONSTANT);
    if (lfo !== null) lfo.frequency.setTargetAtTime(sweepRateHz(current, bpm), now, RAMP_TIME_CONSTANT);
  }

  return {
    input,
    start(): void {
      ensureOscillators();
      // I valori scritti da un setSweep arrivato prima di start() vanno
      // riportati sugli oscillatori appena nati.
      apply();
    },
    setBpm(next: number): void {
      bpm = Number.isFinite(next) && next > 0 ? next : DEFAULT_BPM;
      apply();
    },
    setSweep(sweep: FilterSweep | null): void {
      current = sweep;
      apply();
    },
  };
}
