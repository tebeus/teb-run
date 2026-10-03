import { describe, expect, test } from 'vitest';
import { FOG_DENSITY } from '../../src/render/project';
import { FOG_START, FOG_START_BY_WEATHER, fogAmount, fogStartFor } from '../../src/render/road';
import type { Weather } from '../../src/types';

const ALL: readonly Weather[] = ['clear', 'rain', 'snow', 'dust'];

describe('la nebbia per meteo (spec §4.4f)', () => {
  test('clear keeps the threshold of the spec, and FOG_START is that threshold', () => {
    expect(FOG_START).toBe(0.8);
    expect(fogStartFor('clear')).toBe(FOG_START);
    expect(fogStartFor()).toBe(FOG_START);
  });

  test('rain brings the fog a little closer and a sandstorm a lot', () => {
    expect(fogStartFor('rain')).toBe(0.7);
    expect(fogStartFor('dust')).toBe(0.55);
  });

  test('snow does not touch the fog: the flakes already cut the view', () => {
    expect(fogStartFor('snow')).toBe(FOG_START);
  });

  test('every weather has a threshold, inside (0, 1)', () => {
    for (const w of ALL) {
      expect(Object.keys(FOG_START_BY_WEATHER)).toContain(w);
      expect(FOG_START_BY_WEATHER[w]).toBeGreaterThan(0);
      expect(FOG_START_BY_WEATHER[w]).toBeLessThan(1);
    }
    expect(Object.keys(FOG_START_BY_WEATHER)).toHaveLength(ALL.length);
  });

  test('the density and the shape of the curve are not touched', () => {
    // A distanza piena la nebbia è totale, con qualunque soglia: cambia
    // dove comincia, non quanto diventa fitta (spec §4.4f, deroga 9).
    expect(FOG_DENSITY).toBe(5);
    for (const w of ALL) expect(fogAmount(1, w)).toBeCloseTo(1 - Math.exp(-FOG_DENSITY), 10);
  });

  test('before its threshold there is no fog, and after it there is', () => {
    for (const w of ALL) {
      const start = fogStartFor(w);
      expect(fogAmount(start, w), w).toBe(0);
      expect(fogAmount(start - 0.01, w), w).toBe(0);
      expect(fogAmount(start + 0.01, w), w).toBeGreaterThan(0);
    }
  });

  test('a sandstorm is foggier than rain, and rain foggier than clear, at every distance', () => {
    for (let r = 0.5; r <= 1.0001; r += 0.05) {
      const clear = fogAmount(r, 'clear');
      const rain = fogAmount(r, 'rain');
      const dust = fogAmount(r, 'dust');
      expect(dust, `ratio ${r.toFixed(2)}`).toBeGreaterThanOrEqual(rain);
      expect(rain, `ratio ${r.toFixed(2)}`).toBeGreaterThanOrEqual(clear);
    }
    // E a metà distanza di disegno la sabbia già vela, il sereno no.
    expect(fogAmount(0.65, 'dust')).toBeGreaterThan(0);
    expect(fogAmount(0.65, 'clear')).toBe(0);
  });

  test('the amount never leaves [0, 1] and never grows backwards', () => {
    for (const w of ALL) {
      let prev = -1;
      for (let r = 0; r <= 1.0001; r += 0.02) {
        const f = fogAmount(r, w);
        expect(f, `${w} ${r.toFixed(2)}`).toBeGreaterThanOrEqual(0);
        expect(f, `${w} ${r.toFixed(2)}`).toBeLessThanOrEqual(1);
        expect(f, `${w} ${r.toFixed(2)}`).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = f;
      }
    }
  });

  test('an absent weather is clear: fogAmount with one argument is the one of before', () => {
    for (let r = 0; r <= 1.0001; r += 0.1) expect(fogAmount(r)).toBe(fogAmount(r, 'clear'));
  });
});
