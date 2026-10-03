import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { mulberry32 } from '../../src/core/rng';
import { STAGE_LIST } from '../../src/game/stages';
import { buildTrack } from '../../src/game/track';
import {
  TRAFFIC_NAMES,
  TRAFFIC_SPEEDS,
  TRAFFIC_WEIGHTS,
  pickTrafficName,
  spawnTraffic,
} from '../../src/game/traffic';
import type { ThemeId } from '../../src/types';

const THEMES: ThemeId[] = ['beach', 'desert', 'alpine', 'farm', 'town'];
const NEW = ['traffic_sportscar', 'traffic_bus', 'traffic_pickup'];
/** Sportive extra del Set 6, anticipate dal binario I (addendum del collaudo). */
const SET6 = ['traffic_supercar', 'traffic_roadster', 'traffic_muscle', 'traffic_rally'];

describe('veicoli nuovi (spec §6, §13)', () => {
  test('the three names are in the table with the spec speeds', () => {
    expect(TRAFFIC_SPEEDS.traffic_sportscar).toBe(0.5);
    expect(TRAFFIC_SPEEDS.traffic_bus).toBe(0.25);
    expect(TRAFFIC_SPEEDS.traffic_pickup).toBe(0.38);
  });

  test('they are appended to the ordered list, before the Set 6 cars, which stays deterministic', () => {
    expect(TRAFFIC_NAMES.slice(-7, -4)).toEqual(NEW);
    expect(new Set(TRAFFIC_NAMES).size).toBe(TRAFFIC_NAMES.length);
  });

  test('every name of the list has a speed', () => {
    for (const name of TRAFFIC_NAMES) {
      expect(TRAFFIC_SPEEDS[name], name).toBeGreaterThan(0);
      expect(TRAFFIC_SPEEDS[name], name).toBeLessThan(1);
    }
  });
});

describe('traffic_truck: sprite deformato, non si genera più (addendum del collaudo)', () => {
  test('the catalog still has it, but the spawn list and tables do not', () => {
    expect(CATALOG.traffic_truck).toBeDefined();
    expect(TRAFFIC_NAMES).not.toContain('traffic_truck');
    expect(TRAFFIC_SPEEDS.traffic_truck).toBeUndefined();
    for (const theme of THEMES) expect(TRAFFIC_WEIGHTS[theme].traffic_truck).toBeUndefined();
  });

  test('it never comes out of pickTrafficName or spawnTraffic', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 4000; i++) expect(pickTrafficName(rng, 'desert')).not.toBe('traffic_truck');
    for (const stage of STAGE_LIST) {
      for (const car of spawnTraffic(buildTrack(stage), stage)) {
        expect(car.name, stage.id).not.toBe('traffic_truck');
      }
    }
  });
});

describe('sportive extra del Set 6 (addendum del collaudo)', () => {
  test('the four names are in the table with the spec speeds and scales', () => {
    expect(TRAFFIC_SPEEDS.traffic_supercar).toBe(0.55);
    expect(TRAFFIC_SPEEDS.traffic_roadster).toBe(0.45);
    expect(TRAFFIC_SPEEDS.traffic_muscle).toBe(0.5);
    expect(TRAFFIC_SPEEDS.traffic_rally).toBe(0.48);
    expect(CATALOG.traffic_supercar).toEqual({ kind: 'car', scale: 0.135, solid: true, collideW: 0.1215, anchorY: 1 });
    expect(CATALOG.traffic_roadster).toEqual({ kind: 'car', scale: 0.13, solid: true, collideW: 0.117, anchorY: 1 });
    expect(CATALOG.traffic_muscle).toEqual({ kind: 'car', scale: 0.15, solid: true, collideW: 0.135, anchorY: 1 });
    expect(CATALOG.traffic_rally).toEqual({ kind: 'car', scale: 0.14, solid: true, collideW: 0.126, anchorY: 1 });
  });

  test('they are appended to the ordered list, which stays deterministic', () => {
    expect(TRAFFIC_NAMES.slice(-4)).toEqual(SET6);
  });

  test('the supercar is rare everywhere, the other three lean on their preferred themes', () => {
    for (const theme of THEMES) {
      expect(TRAFFIC_WEIGHTS[theme].traffic_supercar, theme).toBe(1);
    }
    for (const theme of ['beach', 'farm'] as ThemeId[]) {
      expect(TRAFFIC_WEIGHTS[theme].traffic_roadster, theme).toBeGreaterThan(TRAFFIC_WEIGHTS[theme].traffic_supercar);
    }
    for (const theme of ['desert', 'town'] as ThemeId[]) {
      expect(TRAFFIC_WEIGHTS[theme].traffic_muscle, theme).toBeGreaterThan(TRAFFIC_WEIGHTS[theme].traffic_supercar);
    }
    for (const theme of ['farm', 'alpine'] as ThemeId[]) {
      expect(TRAFFIC_WEIGHTS[theme].traffic_rally, theme).toBeGreaterThan(TRAFFIC_WEIGHTS[theme].traffic_supercar);
    }
  });

  test('the four new vehicles all show up somewhere in the 15 stages', () => {
    const seen = new Set<string>();
    for (const stage of STAGE_LIST) {
      for (const car of spawnTraffic(buildTrack(stage), stage)) seen.add(car.name);
    }
    for (const name of SET6) expect(seen.has(name), name).toBe(true);
  });
});

describe('TRAFFIC_WEIGHTS (spec §6: pesi per tema)', () => {
  test('every theme weighs every vehicle of the list', () => {
    for (const theme of THEMES) {
      for (const name of TRAFFIC_NAMES) {
        expect(TRAFFIC_WEIGHTS[theme][name], `${theme} ${name}`).toBeGreaterThan(0);
      }
    }
  });

  test('the desert runs pickups more than buses', () => {
    expect(TRAFFIC_WEIGHTS.desert.traffic_pickup).toBeGreaterThan(TRAFFIC_WEIGHTS.desert.traffic_bus);
  });
});

describe('pickTrafficName', () => {
  test('it always returns a name of the list', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      expect(TRAFFIC_NAMES).toContain(pickTrafficName(rng, 'farm'));
    }
  });

  test('the same seed gives the same sequence', () => {
    const a = mulberry32(3);
    const b = mulberry32(3);
    const one = Array.from({ length: 50 }, () => pickTrafficName(a, 'beach'));
    const two = Array.from({ length: 50 }, () => pickTrafficName(b, 'beach'));
    expect(two).toEqual(one);
  });

  test('it consumes exactly one number per call', () => {
    const rng = mulberry32(11);
    pickTrafficName(rng, 'town');
    const after = rng.next();
    const fresh = mulberry32(11);
    fresh.next();
    expect(after).toBe(fresh.next());
  });

  test('the heavier a vehicle weighs, the more it shows up', () => {
    const rng = mulberry32(99);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const name = pickTrafficName(rng, 'town');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    expect(counts.get('traffic_bus') ?? 0).toBeGreaterThan(counts.get('traffic_truck') ?? 0);
  });
});

describe('spawnTraffic con i pesi', () => {
  test('it only spawns names of the list', () => {
    for (const stage of STAGE_LIST) {
      for (const car of spawnTraffic(buildTrack(stage), stage)) {
        expect(TRAFFIC_NAMES, `${stage.id} ${car.name}`).toContain(car.name);
      }
    }
  });

  test('the three new vehicles all show up somewhere in the 15 stages', () => {
    const seen = new Set<string>();
    for (const stage of STAGE_LIST) {
      for (const car of spawnTraffic(buildTrack(stage), stage)) seen.add(car.name);
    }
    for (const name of NEW) expect(seen.has(name), name).toBe(true);
  });

  test('it is still deterministic from the seed', () => {
    const stage = STAGE_LIST[3];
    expect(spawnTraffic(buildTrack(stage), stage)).toEqual(spawnTraffic(buildTrack(stage), stage));
  });
});
