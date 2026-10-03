// Misure su un blocco di campioni: RMS, picco, campioni in clipping e dove
// sta l'energia. Modulo puro: nessun DOM, nessun Web Audio, testato in Node
// su seni sintetici. Serve alla verifica d'ascolto (spec §16): non dice se un
// suono è bello, dice se c'è, se non è distorto e se ha i bassi dove deve.

/** Oltre questo modulo un campione è, in pratica, in clipping. */
export const CLIP_THRESHOLD = 0.999;
/** Confine della banda bassa, in Hz: il rombo del motore vive sotto (spec §16). */
export const LOW_BAND_HZ = 200;
/** Quante frequenze di sonda: poche, spaziate in modo logaritmico. */
export const PROBE_COUNT = 48;
/** Estremi delle sonde, in Hz. */
export const PROBE_LOW_HZ = 25;
export const PROBE_HIGH_HZ = 12000;

/**
 * Frequenze a cui si misura l'energia, spaziate in modo logaritmico: così ci
 * sono sonde sotto i 200 Hz (dove serve la risoluzione) senza pagare una DFT
 * piena. Pura.
 */
export function probeFrequencies(sampleRate: number, count: number = PROBE_COUNT): number[] {
  const top = Math.min(PROBE_HIGH_HZ, sampleRate / 2 - 1);
  const steps = Math.max(2, Math.floor(count));
  const ratio = Math.log(top / PROBE_LOW_HZ) / (steps - 1);
  const out: number[] = [];
  for (let i = 0; i < steps; i++) out.push(PROBE_LOW_HZ * Math.exp(ratio * i));
  return out;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

export function peakAmplitude(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const magnitude = Math.abs(samples[i]!);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

export function countClipped(samples: Float32Array, threshold: number = CLIP_THRESHOLD): number {
  let count = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) >= threshold) count += 1;
  }
  return count;
}

/**
 * Potenza a una singola frequenza, con l'algoritmo di Goertzel: costa due
 * moltiplicazioni per campione, contro la DFT piena che costerebbe una
 * moltiplicazione per campione **per bin**. Normalizzata sulla lunghezza,
 * così il risultato non dipende da quanto è lungo il blocco. Pura.
 */
export function goertzelPower(samples: Float32Array, sampleRate: number, freq: number): number {
  const n = samples.length;
  if (n === 0 || !(freq > 0) || freq >= sampleRate / 2) return 0;
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = samples[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.max(0, power) / (n * n);
}

/** Ampiezza a ogni frequenza di sonda, nell'ordine di `probeFrequencies`. Pura. */
export function magnitudeBins(
  samples: Float32Array,
  sampleRate: number,
  count: number = PROBE_COUNT,
): number[] {
  return probeFrequencies(sampleRate, count).map((freq) =>
    Math.sqrt(goertzelPower(samples, sampleRate, freq)),
  );
}

/**
 * Quanta parte dell'energia misurata sta sotto `cutoff`. È un indice, non
 * un'energia di banda fisica: si misura su un pugno di frequenze di sonda,
 * non su tutto lo spettro. Serve per confrontare un motore con un altro, non
 * per tarare un equalizzatore. Pura.
 */
export function lowBandRatio(
  bins: number[],
  frequencies: number[],
  cutoff: number = LOW_BAND_HZ,
): number {
  let low = 0;
  let total = 0;
  for (let i = 0; i < bins.length; i++) {
    const power = (bins[i] ?? 0) * (bins[i] ?? 0);
    total += power;
    if ((frequencies[i] ?? Number.POSITIVE_INFINITY) < cutoff) low += power;
  }
  return total <= 0 ? 0 : low / total;
}

export interface AudioSampleReport {
  sampleRate: number;
  samples: number;
  rms: number;
  peak: number;
  /** Quanti campioni sono a fondo scala: uno solo è già un difetto udibile. */
  clipped: number;
  /** 0..1, quanta energia sta sotto LOW_BAND_HZ. */
  lowRatio: number;
  /** Ampiezze alle frequenze di sonda, per lo spettro disegnato dagli e2e. */
  bins: number[];
}

/** Il rapporto completo su un blocco di campioni. Pura. */
export function analyse(samples: Float32Array, sampleRate: number): AudioSampleReport {
  const bins = magnitudeBins(samples, sampleRate);
  return {
    sampleRate,
    samples: samples.length,
    rms: rms(samples),
    peak: peakAmplitude(samples),
    clipped: countClipped(samples),
    lowRatio: lowBandRatio(bins, probeFrequencies(sampleRate)),
    bins,
  };
}
