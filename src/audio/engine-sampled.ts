// Motore campionato: due loop CC0 (minimo e velocità costante) con crossfade
// su speedPercent e playbackRate che sale con la velocità. Le esportazioni di
// questa prima metà sono pure e testate in Node; createSampledEngine, sotto,
// è il solo collegamento al Web Audio e riceve il contesto come parametro.
//
// Perché il tono è alzato di sette semitoni: i due file vengono da
// registrazioni d'epoca di auto comuni (vedi docs/CREDITS.md), non da una
// sportiva. Al tono originale il minimo sta intorno a 0,47 di playbackRate e
// il risultato suona come un trattore. ENGINE_RATE_MIN e ENGINE_RATE_MAX
// comprendono già il fattore ENGINE_PITCH_LIFT.

import type { Gear } from '../types';
import {
  clamp01,
  createTremolo,
  ENGINE_FILTER_EPSILON,
  ENGINE_LEVEL_EPSILON,
  ENGINE_TREMOLO_EPSILON,
  engineFilterFreq,
  shouldUpdateParam,
  tanhCurve,
  TREMOLO_RAMP,
  tremoloDepth,
  tremoloFreq,
} from './sfx';

/** Sotto questa differenza non vale riscrivere il mix del crossfade. */
export const CROSSFADE_EPSILON = 0.01;

/** Sotto questa velocità si sente solo il loop del minimo (spec §10). */
export const CROSSFADE_LOW_FULL = 0.15;
/** Sopra questa velocità si sente solo il loop alto (spec §10). */
export const CROSSFADE_HIGH_FULL = 0.6;

/** Estremi del playbackRate, innalzamento compreso (spec §10). */
export const ENGINE_RATE_MIN = 0.7;
export const ENGINE_RATE_MAX = 2.4;
/** Semitoni di innalzamento rispetto al tono delle registrazioni (spec §10). */
export const ENGINE_PITCH_LIFT_SEMITONES = 7;
export const ENGINE_PITCH_LIFT = Math.pow(2, ENGINE_PITCH_LIFT_SEMITONES / 12);
/** In marcia hi il tono scende del 15%, come nel motore sintetico (spec §10). */
export const ENGINE_GEAR_JUMP = 0.85;
/** Sotto questa differenza non vale riscrivere il playbackRate. */
export const ENGINE_RATE_EPSILON = 0.005;
/** Pendenza della saturazione: più gentile di quella del synth, tanh(2x). */
export const SAMPLED_DRIVE = 1.2;
export const SAMPLED_SHAPER_SAMPLES = 1025;

/**
 * Picco che il motore deve raggiungere a tutto gas, in dBFS, misurato
 * all'uscita del motore (cioè da `renderSample('engine-full')`, che non passa
 * per il master gain).
 *
 * Non si indovina, si calcola. I campioni escono dal tool a −3 dBFS di picco,
 * la saturazione `tanh(SAMPLED_DRIVE · x)` su quel picco ha un guadagno
 * leggermente inferiore a 1, e il volume finale è l'ultimo nodo della catena:
 * quindi il volume a tutto gas è il rapporto fra il picco che si vuole e il
 * picco che arriva.
 *
 * Corretto dalla revisione finale del binario J: a −6 dBFS il motore
 * misurava un RMS di 0,169 contro 0,087-0,096 dei tre brani, cioè +5/+6 dB
 * sopra la musica invece di starci alla pari (il commento precedente
 * affermava un RMS dei brani di 0,15-0,17, quasi il doppio del vero,
 * plausibile prima del riarrangiamento del task 8 ma non dopo). A −11 dBFS
 * il picco scende a circa 0,274 e l'RMS a tutto gas a circa 0,095,
 * finalmente dentro 0,8×-1,2× l'RMS dei brani. Se in gioco il motore
 * coprisse ancora la musica, è questa costante da abbassare, una sola.
 */
export const SAMPLED_ENGINE_PEAK_DBFS = -11;
export const SAMPLED_ENGINE_TARGET_PEAK = Math.pow(10, SAMPLED_ENGINE_PEAK_DBFS / 20);
/** Picco dei campioni dopo `tools/process-audio.py` (spec §13a). */
export const SAMPLE_PEAK_DBFS = -3;
export const SAMPLE_PEAK = Math.pow(10, SAMPLE_PEAK_DBFS / 20);
/** Guadagno della saturazione sul picco del campione: `tanh(d·x) / x`. */
export const SHAPER_PEAK_GAIN = Math.tanh(SAMPLED_DRIVE * SAMPLE_PEAK) / SAMPLE_PEAK;
/** Volume a tutto gas, cioè quello che porta il picco a SAMPLED_ENGINE_PEAK_DBFS. */
export const SAMPLED_ENGINE_MAX_LEVEL =
  SAMPLED_ENGINE_TARGET_PEAK / (SAMPLE_PEAK * SHAPER_PEAK_GAIN);
/** Al minimo il motore sta a un terzo del massimo, come `engineLevel` del synth. */
export const SAMPLED_ENGINE_MIN_FRACTION = 1 / 3;

/**
 * Volume del motore campionato: zero a motore spento, un terzo del massimo al
 * minimo, il massimo a tutto gas. È la stessa forma di `engineLevel` del synth
 * (`0.05 + p * 0.1`, cioè un terzo che diventa uno) riscalata sul picco di
 * SAMPLED_ENGINE_PEAK_DBFS: i campioni normalizzati a −3 dBFS sono molto più
 * forti delle seghe del synth, e riusare `engineLevel` lascerebbe il motore
 * dieci volte sotto la musica. Pura.
 */
export function sampledEngineLevel(running: boolean, speedPercent: number): number {
  if (!running) return 0;
  const p = clamp01(speedPercent);
  const span = 1 - SAMPLED_ENGINE_MIN_FRACTION;
  return SAMPLED_ENGINE_MAX_LEVEL * (SAMPLED_ENGINE_MIN_FRACTION + span * p);
}
/** Costante di tempo delle rampe: le stesse del motore sintetico. */
export const RAMP = 0.05;
/** Rampa del crossfade: un po' più lenta, così il passaggio non si sente. */
export const CROSSFADE_RAMP = 0.12;

/**
 * Guadagni dei due loop a una data velocità: solo il basso sotto
 * CROSSFADE_LOW_FULL, solo l'alto sopra CROSSFADE_HIGH_FULL, rampa lineare in
 * mezzo. I due guadagni sommano sempre a 1. Pura.
 */
export function crossfadeGains(speedPercent: number): { low: number; high: number } {
  const p = clamp01(speedPercent);
  if (p <= CROSSFADE_LOW_FULL) return { low: 1, high: 0 };
  if (p >= CROSSFADE_HIGH_FULL) return { low: 0, high: 1 };
  const t = (p - CROSSFADE_LOW_FULL) / (CROSSFADE_HIGH_FULL - CROSSFADE_LOW_FULL);
  return { low: 1 - t, high: t };
}

/**
 * playbackRate dei due loop: lineare da ENGINE_RATE_MIN a ENGINE_RATE_MAX su
 * speedPercent, moltiplicato per ENGINE_GEAR_JUMP in marcia hi, così alla
 * cambiata il tono scende. Mai NaN: un AudioParam che riceve NaN lancia, e il
 * motore resterebbe muto per tutta la partita. Pura.
 */
export function playbackRateFor(speedPercent: number, gear: Gear): number {
  const p = clamp01(speedPercent);
  const rate = ENGINE_RATE_MIN + p * (ENGINE_RATE_MAX - ENGINE_RATE_MIN);
  return gear === 'hi' ? rate * ENGINE_GEAR_JUMP : rate;
}

/** Curva `tanh(SAMPLED_DRIVE · x)` su [-1, 1] per il WaveShaperNode. Pura. */
export function sampledSaturationCurve(
  samples: number = SAMPLED_SHAPER_SAMPLES,
): Float32Array<ArrayBuffer> {
  return tanhCurve(SAMPLED_DRIVE, samples);
}

export interface SampledEngine {
  /** Da chiamare a ogni tick di gioco: non alloca nodi. */
  setEngine(speedPercent: number, gear: Gear, running: boolean): void;
  /** Porta a zero i due guadagni senza fermare le sorgenti. */
  stop(): void;
  /** Ultimo playbackRate scritto: serve ai test, non al gioco. */
  readonly rate: number;
  /** Ultimi guadagni scritti: servono ai test, non al gioco. */
  readonly gains: { low: number; high: number };
}

/**
 * Catena: due sorgenti in loop → un guadagno ciascuna (crossfade) → somma →
 * saturazione leggera → passa-basso → tremolo → volume → destinazione. Tutto
 * costruito una volta sola: `setEngine` gira a 60 chiamate al secondo.
 *
 * `loop = true` sui campioni preparati da `tools/process-audio.py`, che hanno
 * già il crossfade fra coda e testa: il punto di giunzione non si sente.
 */
export function createSampledEngine(
  ctx: BaseAudioContext,
  destination: AudioNode,
  buffers: { low: AudioBuffer; high: AudioBuffer },
): SampledEngine {
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(destination);

  const tremolo = ctx.createGain();
  tremolo.gain.value = 1;
  tremolo.connect(level);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = engineFilterFreq(0);
  filter.Q.value = 1;
  filter.connect(tremolo);

  const shaper = ctx.createWaveShaper();
  shaper.curve = sampledSaturationCurve();
  shaper.connect(filter);

  const makeLoop = (buffer: AudioBuffer, gainValue: number): { source: AudioBufferSourceNode; gain: GainNode } => {
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    gain.connect(shaper);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = ENGINE_RATE_MIN;
    source.connect(gain);
    source.start();
    return { source, gain };
  };

  const low = makeLoop(buffers.low, 1);
  const high = makeLoop(buffers.high, 0);

  const { lfo, depth } = createTremolo(ctx, tremolo);

  let lastRate = -1;
  let lastLow = 1;
  let lastHigh = 0;
  let lastFilter = -1;
  let lastLevel = -1;
  let lastTremolo = -1;

  function setEngine(speedPercent: number, gear: Gear, running: boolean): void {
    const now = ctx.currentTime;
    const p = clamp01(speedPercent);
    const rate = playbackRateFor(p, gear);
    const mix = crossfadeGains(p);
    const volume = sampledEngineLevel(running, p);
    const wobble = tremoloDepth(p);

    if (shouldUpdateParam(lastRate, rate, ENGINE_RATE_EPSILON)) {
      low.source.playbackRate.setTargetAtTime(rate, now, RAMP);
      high.source.playbackRate.setTargetAtTime(rate, now, RAMP);
      lfo.frequency.setTargetAtTime(tremoloFreq(p), now, RAMP);
      lastRate = rate;
    }
    if (shouldUpdateParam(lastLow, mix.low, CROSSFADE_EPSILON)) {
      low.gain.gain.setTargetAtTime(mix.low, now, CROSSFADE_RAMP);
      high.gain.gain.setTargetAtTime(mix.high, now, CROSSFADE_RAMP);
      lastLow = mix.low;
      lastHigh = mix.high;
    }
    const cutoff = engineFilterFreq(p);
    if (shouldUpdateParam(lastFilter, cutoff, ENGINE_FILTER_EPSILON)) {
      lastFilter = cutoff;
      filter.frequency.setTargetAtTime(lastFilter, now, RAMP);
    }
    if (shouldUpdateParam(lastLevel, volume, ENGINE_LEVEL_EPSILON)) {
      level.gain.setTargetAtTime(volume, now, RAMP);
      lastLevel = volume;
    }
    if (shouldUpdateParam(lastTremolo, wobble, ENGINE_TREMOLO_EPSILON)) {
      depth.gain.setTargetAtTime(wobble, now, TREMOLO_RAMP);
      lastTremolo = wobble;
    }
  }

  function stop(): void {
    const now = ctx.currentTime;
    level.gain.setTargetAtTime(0, now, RAMP);
    low.gain.gain.setTargetAtTime(0, now, RAMP);
    high.gain.gain.setTargetAtTime(0, now, RAMP);
    lastLevel = 0;
    lastLow = 0;
    lastHigh = 0;
  }

  return {
    setEngine,
    stop,
    get rate(): number {
      return lastRate < 0 ? ENGINE_RATE_MIN : lastRate;
    },
    get gains(): { low: number; high: number } {
      return { low: lastLow, high: lastHigh };
    },
  };
}
