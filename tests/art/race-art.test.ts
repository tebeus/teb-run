import { describe, expect, test } from 'vitest';
import { CATALOG, PROCEDURAL_ONLY, SPRITE_NAMES } from '../../src/art/catalog';
import { PORTAL_SCALE_FORK, PORTAL_SCALE_ROAD, RACE_ART } from '../../src/art/procedural/race';
import { targetSize } from '../../src/core/assets';
import targetsJson from '../../tools/sprite-targets.json';
import { createFakeCtx } from '../helpers/fakeCtx';

type Target = { w: number; h: number; frames?: number };
const targets = targetsJson as Record<string, Target>;

const PORTALS = ['race_start_gantry', 'race_checkpoint', 'race_goal'] as const;
const NAMES = [
  'race_start_gantry',
  'race_checkpoint',
  'race_goal',
  'race_start_lights',
  'race_flag_left',
  'race_flag_right',
  'race_finish_flags',
  'race_finish_banner',
  'race_fork_left',
  'race_fork_right',
  'race_direction_left',
  'race_direction_right',
  'race_speed_sign',
  'race_caution_sign',
] as const;

describe('arte dei momenti di gara (spec §4.4e, §13)', () => {
  test('RACE_ART has exactly the fourteen names of the spec', () => {
    expect(Object.keys(RACE_ART).sort()).toEqual([...NAMES].sort());
  });

  test.each(NAMES)('%s draws at its target size without throwing', (name) => {
    const { w, h } = targetSize(name);
    const ctx = createFakeCtx();
    RACE_ART[name](ctx, w, h);
    expect(ctx.paints, name).toBeGreaterThan(4);
  });

  test.each(NAMES)('%s is in the catalog and has a PNG target', (name) => {
    expect(CATALOG[name], name).toBeDefined();
    expect(targets[name], name).toBeDefined();
    expect(PROCEDURAL_ONLY.has(name), name).toBe(false);
  });

  test('the three portals span the road and are never solid', () => {
    // spec §4.4e: la scala è in frazioni di larghezza strada e NON passa
    // per WIDE_ROAD_FACTOR, perché il portale deve scavalcare la strada.
    expect(CATALOG.race_start_gantry.scale).toBe(PORTAL_SCALE_ROAD);
    expect(CATALOG.race_goal.scale).toBe(PORTAL_SCALE_ROAD);
    expect(CATALOG.race_checkpoint.scale).toBe(PORTAL_SCALE_FORK);
    expect(PORTAL_SCALE_ROAD).toBeGreaterThan(1);
    // Bivio v3 (revisione finale di I, finding 1): uno per ramo della Y,
    // le gambe fuori dal cordolo (tests/game/track-portals.test.ts).
    expect(PORTAL_SCALE_FORK).toBeCloseTo(1.7, 10);
    for (const name of PORTALS) {
      expect(CATALOG[name].kind, name).toBe('scenery');
      expect(CATALOG[name].solid, name).toBe(false);
      expect(CATALOG[name].collideW, name).toBe(0);
      expect(CATALOG[name].anchorY, name).toBe(1);
      expect(targets[name], name).toEqual({ w: 1280, h: 480 });
    }
  });

  test('the flags are small, not solid, and anchored at the bottom', () => {
    for (const name of ['race_flag_left', 'race_flag_right', 'race_finish_flags'] as const) {
      expect(CATALOG[name].kind, name).toBe('scenery');
      expect(CATALOG[name].solid, name).toBe(false);
      expect(CATALOG[name].scale, name).toBeLessThan(0.3);
      expect(CATALOG[name].anchorY, name).toBe(1);
    }
  });

  test('the fork boards are scenery and not solid: the fork zone is no place for a trap', () => {
    for (const name of [
      'race_fork_left',
      'race_fork_right',
      'race_direction_left',
      'race_direction_right',
    ] as const) {
      expect(CATALOG[name].kind, name).toBe('scenery');
      expect(CATALOG[name].solid, name).toBe(false);
      expect(CATALOG[name].collideW, name).toBe(0);
    }
  });

  test('the two curve signs are solid and as narrow as the chevron', () => {
    for (const name of ['race_speed_sign', 'race_caution_sign'] as const) {
      expect(CATALOG[name].solid, name).toBe(true);
      expect(CATALOG[name].collideW, name).toBeGreaterThan(0);
      expect(CATALOG[name].collideW, name).toBeLessThanOrEqual(CATALOG.common_sign_chevron.collideW * 1.2);
    }
  });

  test('the start lights and the finish banner are overlays, centred on their anchor', () => {
    for (const name of ['race_start_lights', 'race_finish_banner'] as const) {
      expect(CATALOG[name].kind, name).toBe('ui');
      expect(CATALOG[name].solid, name).toBe(false);
      expect(CATALOG[name].anchorY, name).toBe(0.5);
    }
    expect(targets.race_start_lights).toEqual({ w: 520, h: 180 });
    expect(targets.race_finish_banner).toEqual({ w: 900, h: 220 });
  });

  test('the fourteen names are all distinct and all in the catalog', () => {
    // Il conteggio **esatto** del catalogo sta in `tests/art/catalog.test.ts`
    // e in `tests/art/procedural-coverage.test.ts`, che ogni task d'arte
    // aggiorna: pinnarlo anche qui vorrebbe dire aggiornarlo tre volte,
    // e i task 3 e 4 se ne dimenticherebbero.
    expect(new Set(NAMES).size).toBe(14);
    for (const name of NAMES) expect(SPRITE_NAMES, name).toContain(name);
  });
});
