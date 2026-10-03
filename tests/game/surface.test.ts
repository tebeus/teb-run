import { describe, expect, test } from 'vitest';
import {
  baseSurfaceFor,
  DOMINANT_MIX,
  gripFor,
  gripOf,
  SURFACE_GRIP,
  surfaceBlendOf,
  surfaceKindOf,
  surfaceMixOf,
  wetnessOf,
} from '../../src/game/surface';
import { makeSegment } from '../helpers/segments';
import type { SurfaceKind, Weather } from '../../src/types';

const ALL_KINDS: readonly SurfaceKind[] = ['asphalt', 'dirt', 'snow', 'wet'];
const ALL_WEATHER: readonly Weather[] = ['clear', 'rain', 'snow', 'dust'];

describe('la tabella di aderenza (spec §5)', () => {
  test('the four grips are the ones the spec declares', () => {
    expect(SURFACE_GRIP.asphalt).toBe(1);
    expect(SURFACE_GRIP.wet).toBe(0.85);
    expect(SURFACE_GRIP.dirt).toBe(0.8);
    expect(SURFACE_GRIP.snow).toBe(0.7);
  });

  test('every surface kind has a grip, and none of them is zero or above one', () => {
    for (const kind of ALL_KINDS) {
      expect(SURFACE_GRIP[kind]).toBeGreaterThan(0);
      expect(SURFACE_GRIP[kind]).toBeLessThanOrEqual(1);
    }
  });
});

describe('superficie di fondo dal meteo (spec §4.4f)', () => {
  test('only rain wets the whole stage', () => {
    expect(baseSurfaceFor('rain')).toBe('wet');
    expect(baseSurfaceFor('clear')).toBe('asphalt');
    expect(baseSurfaceFor('snow')).toBe('asphalt');
    expect(baseSurfaceFor('dust')).toBe('asphalt');
  });

  test('no weather at all is dry asphalt', () => {
    expect(baseSurfaceFor()).toBe('asphalt');
  });
});

describe('surfaceMixOf: un numero sempre in [0, 1] (Review Focus 1)', () => {
  test('an absent mix is zero', () => {
    expect(surfaceMixOf({})).toBe(0);
    expect(surfaceMixOf(makeSegment(0))).toBe(0);
  });

  test('a mix outside the unit interval is clamped, not trusted', () => {
    expect(surfaceMixOf({ surfaceMix: -3 })).toBe(0);
    expect(surfaceMixOf({ surfaceMix: 1.4 })).toBe(1);
    expect(surfaceMixOf({ surfaceMix: 0.25 })).toBe(0.25);
  });

  test('a non finite mix is zero, like a missing one: broken data never invents a surface run', () => {
    expect(surfaceMixOf({ surfaceMix: Number.NaN })).toBe(0);
    expect(surfaceMixOf({ surfaceMix: Number.POSITIVE_INFINITY })).toBe(0);
    expect(surfaceMixOf({ surfaceMix: Number.NEGATIVE_INFINITY })).toBe(0);
  });
});

describe('surfaceBlendOf: fondo, tratto e miscela (spec §4.4f)', () => {
  test('a segment without surface fields resolves to dry asphalt with grip one', () => {
    const blend = surfaceBlendOf(makeSegment(7));
    expect(blend).toEqual({ base: 'asphalt', kind: 'asphalt', mix: 0 });
    expect(gripOf(blend)).toBe(1);
    expect(gripFor(makeSegment(7))).toBe(1);
    expect(surfaceKindOf(makeSegment(7))).toBe('asphalt');
  });

  test('rain alone makes the segment wet, with no field written on it', () => {
    const blend = surfaceBlendOf(makeSegment(7), 'rain');
    expect(blend).toEqual({ base: 'wet', kind: 'wet', mix: 0 });
    expect(gripOf(blend)).toBe(SURFACE_GRIP.wet);
    expect(surfaceKindOf(makeSegment(7), 'rain')).toBe('wet');
  });

  test('an explicit run wins over the weather on the same segment (Review Focus 4)', () => {
    // 4-2 Windmill Coast: farm (sterrato) e pioggia insieme.
    const seg = makeSegment(7, { surfaceKind: 'dirt', surfaceMix: 1 });
    const blend = surfaceBlendOf(seg, 'rain');
    expect(blend).toEqual({ base: 'wet', kind: 'dirt', mix: 1 });
    expect(gripOf(blend)).toBe(SURFACE_GRIP.dirt);
    expect(surfaceKindOf(seg, 'rain')).toBe('dirt');
  });

  test('the ramp interpolates the grip between the two surfaces, with no jump', () => {
    const at = (mix: number): number =>
      gripFor(makeSegment(7, { surfaceKind: 'dirt', surfaceMix: mix }), 'rain');
    expect(at(0)).toBeCloseTo(SURFACE_GRIP.wet, 10);
    expect(at(1)).toBeCloseTo(SURFACE_GRIP.dirt, 10);
    expect(at(0.5)).toBeCloseTo((SURFACE_GRIP.wet + SURFACE_GRIP.dirt) / 2, 10);
    // Monotona: a ogni passo l'aderenza non risale.
    let prev = at(0);
    for (let i = 1; i <= 20; i++) {
      const now = at(i / 20);
      expect(now).toBeLessThanOrEqual(prev + 1e-12);
      prev = now;
    }
  });

  test('a run of the same kind as the base is not a run at all', () => {
    const blend = surfaceBlendOf(makeSegment(7, { surfaceKind: 'wet', surfaceMix: 1 }), 'rain');
    expect(blend).toEqual({ base: 'wet', kind: 'wet', mix: 0 });
    const dry = surfaceBlendOf(makeSegment(7, { surfaceKind: 'asphalt', surfaceMix: 1 }), 'clear');
    expect(dry).toEqual({ base: 'asphalt', kind: 'asphalt', mix: 0 });
  });

  test('surfaceKindOf returns exactly one of the four kinds, for every pairing', () => {
    for (const weather of ALL_WEATHER) {
      for (const kind of ALL_KINDS) {
        for (const mix of [0, 0.3, 0.5, 0.8, 1]) {
          const got = surfaceKindOf(makeSegment(3, { surfaceKind: kind, surfaceMix: mix }), weather);
          expect(ALL_KINDS).toContain(got);
        }
      }
    }
  });

  test('the dominant surface flips at DOMINANT_MIX and not before', () => {
    expect(DOMINANT_MIX).toBe(0.5);
    const seg = (mix: number) => makeSegment(3, { surfaceKind: 'snow', surfaceMix: mix });
    expect(surfaceKindOf(seg(0.49))).toBe('asphalt');
    expect(surfaceKindOf(seg(0.5))).toBe('snow');
  });
});

describe('wetnessOf: quanto la strada riflette (spec §4.4f)', () => {
  test('dry asphalt is not wet at all', () => {
    expect(wetnessOf(surfaceBlendOf(makeSegment(1)))).toBe(0);
  });

  test('a rainy stage is fully wet where no run covers it', () => {
    expect(wetnessOf(surfaceBlendOf(makeSegment(1), 'rain'))).toBe(1);
  });

  test('a dirt run on a rainy stage stops reflecting as the ramp closes', () => {
    const at = (mix: number): number =>
      wetnessOf(surfaceBlendOf(makeSegment(1, { surfaceKind: 'dirt', surfaceMix: mix }), 'rain'));
    expect(at(0)).toBe(1);
    expect(at(0.5)).toBeCloseTo(0.5, 10);
    expect(at(1)).toBe(0);
  });
});
