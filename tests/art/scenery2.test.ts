import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { SCENERY2 } from '../../src/art/procedural/scenery2';
import { PROCEDURAL } from '../../src/art/procedural/index';
import { targetSize } from '../../src/core/assets';
import { createFakeCtx } from '../helpers/fakeCtx';

/** I 18 nomi di scenografia del Set 2, nell'ordine di spec §13. */
const SET2 = [
  'common_sign_chevron',
  'common_sign_speed',
  'common_lamp_highway',
  'common_bridge_pylon',
  'common_boulder_large',
  'beach_lifeguard_tower',
  'beach_boat',
  'beach_rock_arch',
  'desert_pillar',
  'desert_bush_dry',
  'alpine_snow_pine',
  'alpine_signpost',
  'farm_tractor',
  'farm_fence_wood',
  'farm_silo',
  'town_cafe',
  'town_bus_stop',
  'town_tower',
];

const TRAFFIC2 = ['traffic_sportscar', 'traffic_bus', 'traffic_pickup'];

describe('scenografia del Set 2 (spec §13)', () => {
  test('all 18 names have a drawer and a catalog entry', () => {
    // SCENERY2 porta anche i tre spettatori del Set 4 (spec §13, task 21):
    // il controllo resta un sottoinsieme, non più un'uguaglianza stretta.
    for (const name of SET2) {
      expect(SCENERY2[name], name).toBeDefined();
      expect(CATALOG[name], name).toBeDefined();
      expect(CATALOG[name].kind, name).toBe('scenery');
    }
  });

  test('every drawer paints a recognisable shape at its own target size', () => {
    for (const name of SET2) {
      const { w, h } = targetSize(name);
      const ctx = createFakeCtx();
      SCENERY2[name](ctx, w, h);
      expect(ctx.paints, name).toBeGreaterThan(2);
    }
  });

  test('two objects never draw the same shape', () => {
    const shapes = SET2.map((name) => {
      const ctx = createFakeCtx();
      SCENERY2[name](ctx, 200, 300);
      return JSON.stringify(ctx.ops);
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  test('the drawers are registered in PROCEDURAL', () => {
    for (const name of [...SET2, ...TRAFFIC2]) {
      expect(PROCEDURAL[name], name).toBeDefined();
    }
  });
});

describe('veicoli del Set 2 (spec §13)', () => {
  test('the three new cars are solid cars with 0.9 · scale of hitbox', () => {
    const expected: Record<string, number> = {
      traffic_sportscar: 0.135,
      traffic_bus: 0.2,
      traffic_pickup: 0.15,
    };
    for (const [name, scale] of Object.entries(expected)) {
      expect(CATALOG[name].kind, name).toBe('car');
      expect(CATALOG[name].solid, name).toBe(true);
      expect(CATALOG[name].scale, name).toBeCloseTo(scale, 10);
      expect(CATALOG[name].collideW, name).toBeCloseTo(0.9 * scale, 10);
    }
  });

  test('every vehicle of spec §13 has exactly the scale of the table', () => {
    const table: Record<string, number> = {
      player_straight: 0.14,
      player_left1: 0.14,
      player_left2: 0.14,
      player_brake: 0.14,
      player_spin_0: 0.14,
      player_spin_1: 0.14,
      player_spin_2: 0.14,
      player_spin_3: 0.14,
      traffic_sedan: 0.14,
      traffic_hatchback: 0.13,
      traffic_coupe: 0.135,
      traffic_offroad: 0.13,
      traffic_van: 0.16,
      traffic_truck: 0.2,
      traffic_bike: 0.08,
      traffic_sportscar: 0.135,
      traffic_bus: 0.2,
      traffic_pickup: 0.15,
      traffic_supercar: 0.135,
      traffic_roadster: 0.13,
      traffic_muscle: 0.15,
      traffic_rally: 0.14,
    };
    for (const [name, scale] of Object.entries(table)) {
      expect(CATALOG[name].scale, name).toBeCloseTo(scale, 10);
    }
  });

  test('every solid vehicle has collideW = 0.9 · scale', () => {
    for (const [name, entry] of Object.entries(CATALOG)) {
      if (entry.kind !== 'car') continue;
      expect(entry.collideW, name).toBeCloseTo(0.9 * entry.scale, 10);
    }
  });
});
