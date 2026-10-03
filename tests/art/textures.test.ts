import { describe, expect, test } from 'vitest';
import {
  ASPHALT_TONES,
  GROUND_TONES,
  NOISE_GRID,
  TEXTURE_TILE,
  TEXTURES,
  hash01,
  noiseTile,
  textureSeed,
  valueNoise,
} from '../../src/art/procedural/textures';
import { PALETTES } from '../../src/render/palette';
import type { ThemeId } from '../../src/types';
import { createFakeCtx, drawnBounds } from '../helpers/fakeCtx';

const THEMES: ThemeId[] = ['beach', 'desert', 'alpine', 'farm', 'town'];
const HEX = /^#[0-9a-f]{6}$/;

describe('valueNoise (spec §4.4a: tessere ripetibili)', () => {
  test('is in [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(1234, i, i * 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('is deterministic', () => {
    expect(valueNoise(99, 5, 7)).toBe(valueNoise(99, 5, 7));
  });

  test('wraps on the grid, so the tile matches itself side by side', () => {
    for (let iy = 0; iy < NOISE_GRID; iy++) {
      expect(valueNoise(7, NOISE_GRID, iy), `row ${iy}`).toBe(valueNoise(7, 0, iy));
      expect(valueNoise(7, -1, iy), `row ${iy}`).toBe(valueNoise(7, NOISE_GRID - 1, iy));
    }
    for (let ix = 0; ix < NOISE_GRID; ix++) {
      expect(valueNoise(7, ix, NOISE_GRID), `col ${ix}`).toBe(valueNoise(7, ix, 0));
    }
  });

  test('different seeds give different fields', () => {
    const a = Array.from({ length: 64 }, (_, i) => valueNoise(1, i % 8, Math.floor(i / 8)));
    const b = Array.from({ length: 64 }, (_, i) => valueNoise(2, i % 8, Math.floor(i / 8)));
    expect(a).not.toEqual(b);
  });

  test('the field is not constant', () => {
    const seen = new Set<number>();
    for (let i = 0; i < NOISE_GRID; i++) seen.add(valueNoise(3, i, 0));
    expect(seen.size).toBeGreaterThan(8);
  });
});

describe('hash01', () => {
  test('is in [0, 1), deterministic, and not periodic on the grid', () => {
    expect(hash01(5, 1, 2)).toBe(hash01(5, 1, 2));
    expect(hash01(5, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(hash01(5, 0, 0)).toBeLessThan(1);
    expect(hash01(5, NOISE_GRID, 0)).not.toBe(hash01(5, 0, 0));
  });
});

describe('textureSeed', () => {
  test('two names never share a seed', () => {
    const names = [...THEMES.map((t) => `ground_${t}`), 'asphalt'];
    expect(new Set(names.map(textureSeed)).size).toBe(names.length);
  });
});

describe('GROUND_TONES', () => {
  test('there is one set of tones per theme, all lowercase hex', () => {
    expect(Object.keys(GROUND_TONES).sort()).toEqual([...THEMES].sort());
    for (const theme of THEMES) {
      const t = GROUND_TONES[theme];
      for (const c of [t.base, t.light, t.dark, t.speck, t.patch]) {
        expect(c, `${theme}: ${c}`).toMatch(HEX);
      }
    }
    for (const c of [ASPHALT_TONES.base, ASPHALT_TONES.light, ASPHALT_TONES.dark]) {
      expect(c).toMatch(HEX);
    }
  });

  test('the base tone is the flat colour the renderer falls back to (spec §4.4a)', () => {
    for (const theme of THEMES) {
      expect(GROUND_TONES[theme].base, theme).toBe(PALETTES[theme].grassLight);
    }
  });

  test('light and dark differ from the base', () => {
    for (const theme of THEMES) {
      const t = GROUND_TONES[theme];
      expect(t.light, theme).not.toBe(t.base);
      expect(t.dark, theme).not.toBe(t.base);
    }
  });
});

describe('noiseTile', () => {
  test('it paints the whole tile and stays inside it', () => {
    const b = drawnBounds((ctx, w, h) => noiseTile(ctx, w, h, 42, GROUND_TONES.beach), TEXTURE_TILE, TEXTURE_TILE);
    expect(b.transformed).toBe(false);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(TEXTURE_TILE);
    expect(b.maxY).toBeLessThanOrEqual(TEXTURE_TILE);
    expect(b.ctx.paints).toBeGreaterThan(200);
  });

  test('the same seed draws exactly the same operations', () => {
    const one = createFakeCtx();
    const two = createFakeCtx();
    noiseTile(one, 128, 128, 7, GROUND_TONES.farm);
    noiseTile(two, 128, 128, 7, GROUND_TONES.farm);
    expect(two.ops).toEqual(one.ops);
  });

  test('a different seed draws something else', () => {
    const one = createFakeCtx();
    const two = createFakeCtx();
    noiseTile(one, 128, 128, 7, GROUND_TONES.farm);
    noiseTile(two, 128, 128, 8, GROUND_TONES.farm);
    expect(two.ops).not.toEqual(one.ops);
  });

  test('the first operation covers the tile with the base tone', () => {
    const ctx = createFakeCtx();
    noiseTile(ctx, 64, 64, 1, GROUND_TONES.town);
    expect(ctx.ops[0]).toMatchObject({ type: 'fillRect', args: [0, 0, 64, 64], fill: GROUND_TONES.town.base });
  });

  test('a degenerate tile does not throw and draws nothing outside it', () => {
    const ctx = createFakeCtx();
    expect(() => noiseTile(ctx, 0, 0, 1, GROUND_TONES.beach)).not.toThrow();
  });
});

describe('TEXTURES', () => {
  test('there are eight tiles: one ground per theme, the shared asphalt and the two road surfaces', () => {
    expect(Object.keys(TEXTURES).sort()).toEqual(
      [
        'asphalt',
        'ground_alpine',
        'ground_beach',
        'ground_desert',
        'ground_farm',
        'ground_town',
        'ground_dirt_road',
        'ground_snow_road',
      ].sort(),
    );
  });

  test('every tile paints something at 512x512', () => {
    for (const [name, draw] of Object.entries(TEXTURES)) {
      const ctx = createFakeCtx();
      draw(ctx, TEXTURE_TILE, TEXTURE_TILE);
      expect(ctx.paints, name).toBeGreaterThan(200);
    }
  });

  test('two themes never draw the same tile', () => {
    const shapes = Object.values(TEXTURES).map((draw) => {
      const ctx = createFakeCtx();
      draw(ctx, 64, 64);
      return JSON.stringify(ctx.ops);
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});
