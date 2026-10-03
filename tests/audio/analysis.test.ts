import { describe, expect, test } from 'vitest';
import {
  analyse,
  CLIP_THRESHOLD,
  countClipped,
  goertzelPower,
  LOW_BAND_HZ,
  lowBandRatio,
  magnitudeBins,
  peakAmplitude,
  probeFrequencies,
  rms,
} from '../../src/audio/analysis';

const RATE = 48000;

/** Un seno di ampiezza `amp` a `freq` Hz, lungo `seconds`. */
function sine(freq: number, seconds = 0.5, amp = 1, rate = RATE): Float32Array {
  const data = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < data.length; i++) data[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return data;
}

describe('rms and peak', () => {
  test('a full scale sine has peak 1 and rms 1/sqrt(2)', () => {
    const data = sine(440);
    expect(peakAmplitude(data)).toBeCloseTo(1, 3);
    expect(rms(data)).toBeCloseTo(Math.SQRT1_2, 3);
  });

  test('silence is zero, not NaN', () => {
    const data = new Float32Array(1000);
    expect(rms(data)).toBe(0);
    expect(peakAmplitude(data)).toBe(0);
  });

  test('an empty buffer is zero, not a division by zero', () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(peakAmplitude(new Float32Array(0))).toBe(0);
  });

  test('halving the amplitude halves the rms', () => {
    expect(rms(sine(440, 0.2, 0.5))).toBeCloseTo(rms(sine(440, 0.2, 1)) / 2, 3);
  });
});

describe('countClipped', () => {
  test('counts only the samples at or past the threshold', () => {
    const data = new Float32Array([0, 0.5, 1, -1, 0.9989, CLIP_THRESHOLD, -CLIP_THRESHOLD]);
    expect(countClipped(data)).toBe(4);
  });

  test('a sine at 0.9 never clips', () => {
    expect(countClipped(sine(440, 0.2, 0.9))).toBe(0);
  });
});

describe('goertzelPower', () => {
  test('finds the frequency that is there and not the ones that are not', () => {
    const data = sine(1000, 0.25);
    const at1000 = goertzelPower(data, RATE, 1000);
    const at4000 = goertzelPower(data, RATE, 4000);
    expect(at1000).toBeGreaterThan(at4000 * 50);
  });

  test('is zero on silence and never negative', () => {
    expect(goertzelPower(new Float32Array(1000), RATE, 440)).toBe(0);
    expect(goertzelPower(sine(440, 0.1), RATE, 3000)).toBeGreaterThanOrEqual(0);
  });
});

describe('probeFrequencies', () => {
  test('spans the audible band, rising, all below Nyquist', () => {
    const probes = probeFrequencies(RATE);
    expect(probes.length).toBeGreaterThan(20);
    expect(probes[0]).toBeGreaterThan(10);
    expect(probes[probes.length - 1]!).toBeLessThan(RATE / 2);
    for (let i = 1; i < probes.length; i++) expect(probes[i]!).toBeGreaterThan(probes[i - 1]!);
  });

  test('some probes sit below the low band cutoff, or the ratio would always be zero', () => {
    expect(probeFrequencies(RATE).filter((f) => f < LOW_BAND_HZ).length).toBeGreaterThanOrEqual(3);
  });
});

describe('lowBandRatio', () => {
  test('near one for a low sine, near zero for a high one', () => {
    const probes = probeFrequencies(RATE);
    const low = lowBandRatio(magnitudeBins(sine(60, 0.25), RATE), probes);
    const high = lowBandRatio(magnitudeBins(sine(6000, 0.25), RATE), probes);
    expect(low).toBeGreaterThan(0.8);
    expect(high).toBeLessThan(0.15);
  });

  test('a mix of low and high noise lands in between', () => {
    // Con due sinusoidi pure questo indice non funziona, ed è giusto così: le
    // sonde sono a spaziatura logaritmica e il Goertzel è a banda stretta,
    // quindi un tono che cade fra due sonde non si vede. Misurato a 48 kHz: la
    // sonda più vicina a 5 kHz dista 215 Hz, e lì la potenza crolla di cinque
    // ordini di grandezza (1,985e−6 contro 2,5e−1 alla frequenza esatta),
    // quindi un mezzo-e-mezzo di 80 Hz e 5 kHz dà 0,9999. L'indice è fatto per
    // segnali a banda larga come il motore, non per toni.
    // Il generatore con seme non è un dettaglio: con Math.random la soglia
    // sfarfalla (0,8218 contro 0,8 in una esecuzione su quattro).
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const data = new Float32Array(RATE * 0.25);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      const white = rnd() * 2 - 1;
      low += (white - low) * 0.02;
      data[i] = low * 2 + white * 0.5;
    }
    const ratio = lowBandRatio(magnitudeBins(data, RATE), probeFrequencies(RATE));
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.8);
  });

  test('silence gives zero, not NaN', () => {
    const probes = probeFrequencies(RATE);
    expect(lowBandRatio(magnitudeBins(new Float32Array(2000), RATE), probes)).toBe(0);
  });
});

describe('analyse', () => {
  test('fills every field of the report', () => {
    const report = analyse(sine(100, 0.25, 0.7), RATE);
    expect(report.sampleRate).toBe(RATE);
    expect(report.samples).toBe(12000);
    expect(report.rms).toBeCloseTo(0.7 * Math.SQRT1_2, 2);
    expect(report.peak).toBeCloseTo(0.7, 2);
    expect(report.clipped).toBe(0);
    expect(report.lowRatio).toBeGreaterThan(0.8);
    expect(report.bins.length).toBe(probeFrequencies(RATE).length);
    for (const bin of report.bins) expect(Number.isFinite(bin)).toBe(true);
  });

  test('an empty buffer gives a zero report instead of NaN everywhere', () => {
    const report = analyse(new Float32Array(0), RATE);
    expect(report.rms).toBe(0);
    expect(report.peak).toBe(0);
    expect(report.lowRatio).toBe(0);
    expect(report.samples).toBe(0);
  });
});
