import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { SCENERY } from '../../src/art/procedural/scenery';
import { drawnBounds } from '../helpers/fakeCtx';

const BEACH = ['beach_palm_1', 'beach_palm_2', 'beach_umbrella', 'beach_hut', 'beach_surf_sign', 'beach_bush'];
const DESERT = [
  'desert_cactus_1',
  'desert_cactus_2',
  'desert_rock_1',
  'desert_rock_2',
  'desert_dead_tree',
  'desert_skull_sign',
];

describe('oggetti di spiaggia e deserto', () => {
  test('ci sono tutti e sono nel catalogo', () => {
    for (const name of [...BEACH, ...DESERT]) {
      expect(SCENERY[name], name).toBeDefined();
      expect(CATALOG[name], name).toBeDefined();
    }
  });

  test.each([...BEACH, ...DESERT])('%s disegna dentro il riquadro', (name) => {
    const b = drawnBounds(SCENERY[name], 300, 520);
    expect(b.ctx.paints, name).toBeGreaterThan(2);
    if (!b.transformed) {
      expect(b.minX, `${name} minX`).toBeGreaterThanOrEqual(-6);
      expect(b.minY, `${name} minY`).toBeGreaterThanOrEqual(-10);
      expect(b.maxX, `${name} maxX`).toBeLessThanOrEqual(306);
      expect(b.maxY, `${name} maxY`).toBeLessThanOrEqual(530);
    }
  });

  test('le due palme si piegano da parti opposte', () => {
    const left = drawnBounds(SCENERY.beach_palm_1, 300, 520);
    const right = drawnBounds(SCENERY.beach_palm_2, 300, 520);
    expect(left.minX).toBeLessThan(right.minX);
    expect(right.maxX).toBeGreaterThan(left.maxX);
  });

  test('un oggetto largo e basso resta basso', () => {
    const b = drawnBounds(SCENERY.desert_cactus_2, 220, 160);
    expect(b.maxY).toBeLessThanOrEqual(170);
  });
});

const ALPINE = ['alpine_pine_1', 'alpine_pine_2', 'alpine_chalet', 'alpine_fence', 'alpine_rock', 'alpine_cow'];
const FARM = ['farm_haybale', 'farm_windmill', 'farm_barn', 'farm_vine_row', 'farm_oak', 'farm_sunflowers'];

describe('oggetti di montagna e campagna', () => {
  test('ci sono tutti e sono nel catalogo', () => {
    for (const name of [...ALPINE, ...FARM]) {
      expect(SCENERY[name], name).toBeDefined();
      expect(CATALOG[name], name).toBeDefined();
    }
  });

  test.each([...ALPINE, ...FARM])('%s disegna dentro il riquadro', (name) => {
    const b = drawnBounds(SCENERY[name], 380, 560);
    expect(b.ctx.paints, name).toBeGreaterThan(2);
    if (!b.transformed) {
      expect(b.minX, `${name} minX`).toBeGreaterThanOrEqual(-8);
      expect(b.minY, `${name} minY`).toBeGreaterThanOrEqual(-10);
      expect(b.maxX, `${name} maxX`).toBeLessThanOrEqual(388);
      expect(b.maxY, `${name} maxY`).toBeLessThanOrEqual(570);
    }
  });

  test('il pino con la neve usa il bianco, quello senza no', () => {
    const snowy = drawnBounds(SCENERY.alpine_pine_2, 240, 520);
    const plain = drawnBounds(SCENERY.alpine_pine_1, 240, 520);
    const white = (b: typeof snowy) => b.ctx.ops.filter((o) => o.fill === '#f1f3f5').length;
    expect(white(snowy)).toBeGreaterThan(0);
    expect(white(plain)).toBe(0);
  });
});

const TOWN = ['town_arch', 'town_column', 'town_lamp', 'town_facade', 'town_fountain', 'town_cypress'];
const COMMON = ['common_billboard', 'common_bush_1', 'common_bush_2', 'common_boulder', 'common_barrier', 'common_gantry'];

describe('oggetti di città e comuni', () => {
  test('ci sono tutti e sono nel catalogo', () => {
    for (const name of [...TOWN, ...COMMON]) {
      expect(SCENERY[name], name).toBeDefined();
      expect(CATALOG[name], name).toBeDefined();
    }
  });

  test.each([...TOWN, ...COMMON])('%s disegna dentro il riquadro', (name) => {
    const b = drawnBounds(SCENERY[name], 460, 520);
    expect(b.ctx.paints, name).toBeGreaterThan(2);
    if (!b.transformed) {
      expect(b.minX, `${name} minX`).toBeGreaterThanOrEqual(-10);
      expect(b.minY, `${name} minY`).toBeGreaterThanOrEqual(-10);
      expect(b.maxX, `${name} maxX`).toBeLessThanOrEqual(470);
      expect(b.maxY, `${name} maxY`).toBeLessThanOrEqual(530);
    }
  });

  test('il cartellone ha un pannello bianco vuoto: il gioco ci scrive sopra', () => {
    const b = drawnBounds(SCENERY.common_billboard, 420, 300);
    const panels = b.ctx.ops.filter((o) => o.type === 'fillRect' && o.fill === '#f5f0e6');
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.some((o) => o.args[2] > 420 * 0.7 && o.args[3] > 300 * 0.3)).toBe(true);
  });

  test('il portale del bivio è largo quanto il riquadro e ha due frecce', () => {
    const b = drawnBounds(SCENERY.common_gantry, 1024, 320);
    expect(b.maxX - b.minX).toBeGreaterThan(1024 * 0.9);
    expect(b.ctx.ops.filter((o) => o.type === 'closePath').length).toBeGreaterThanOrEqual(2);
  });

  test('SCENERY ha esattamente 36 disegnatori', () => {
    expect(Object.keys(SCENERY)).toHaveLength(36);
  });
});
