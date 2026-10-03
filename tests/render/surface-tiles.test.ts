import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { SURFACE_TONES, TEXTURES } from '../../src/art/procedural/textures';
import {
  DIRT_VEIL,
  DIRT_VEIL_ALPHA,
  SNOW_VEIL,
  SURFACE_TILES,
  SURFACE_TILE_VEIL_ALPHA,
  surfaceTile,
  surfaceTileWeights,
  tiledVeilAlpha,
  veilAlpha,
} from '../../src/render/ground';
import { paletteFor } from '../../src/render/palette';
import { drawSegment } from '../../src/render/road';
import type { SpriteKind } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeSegment } from '../helpers/segments';
import targetsJson from '../../tools/sprite-targets.json';

const targets = targetsJson as Record<string, { w: number; h: number }>;
const PAL = paletteFor('farm');

const projected = (over: Parameters<typeof makeSegment>[1] = {}) => {
  const seg = makeSegment(10, over);
  seg.p1.screen = { x: 640, y: 600, w: 300, scale: 0.01 };
  seg.p2.screen = { x: 640, y: 500, w: 150, scale: 0.005 };
  return seg;
};

/** Store finto: ogni nome è una tessera 512x512, tranne quelli in `missing`. */
const opts = (missing: ReadonlySet<string> = new Set()) => ({
  assets: {
    ready: Promise.resolve(),
    get: (name: string) => {
      const kind: SpriteKind = missing.has(name) ? 'scenery' : 'texture';
      return {
        name,
        image: { name } as unknown as CanvasImageSource,
        w: 512,
        h: 512,
        entry: { kind, scale: 1, solid: false, collideW: 0, anchorY: 1 },
      };
    },
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  },
  timeLeft: 40,
  lanes: 4,
  weather: 'clear' as const,
});

const imagesOf = (r: ReturnType<typeof createRecordCtx>, name: string) =>
  r.images().filter((op) => op.image === name);

describe('le due tessere di superficie nel catalogo (Set 7, spec §4.4f)', () => {
  test('dirt and snow roads are 512x512 textures with a procedural fallback', () => {
    for (const n of ['ground_dirt_road', 'ground_snow_road']) {
      expect(CATALOG[n].kind, n).toBe('texture');
      expect(CATALOG[n].solid, n).toBe(false);
      expect(targets[n], n).toEqual({ w: 512, h: 512 });
      expect(TEXTURES[n], n).toBeTypeOf('function');
    }
  });

  test('the fallback tiles start from the colour of the veil they replace', () => {
    expect(SURFACE_TONES.dirt.base).toBe(DIRT_VEIL);
    expect(SURFACE_TONES.snow.base).toBe(SNOW_VEIL);
  });

  test('only dirt and snow have a tile: wet and asphalt stay a veil', () => {
    expect(SURFACE_TILES).toEqual({ dirt: 'ground_dirt_road', snow: 'ground_snow_road' });
    expect(surfaceTile('dirt')).toBe('ground_dirt_road');
    expect(surfaceTile('snow')).toBe('ground_snow_road');
    expect(surfaceTile('asphalt')).toBeNull();
    expect(surfaceTile('wet')).toBeNull();
  });
});

describe('pesi e velo delle tessere di superficie', () => {
  test('a dirt run comes in with its mix, over dry or wet asphalt', () => {
    expect(surfaceTileWeights({ base: 'asphalt', kind: 'dirt', mix: 0.25 })).toEqual({ base: 0, kind: 0.25 });
    expect(surfaceTileWeights({ base: 'wet', kind: 'snow', mix: 1 })).toEqual({ base: 0, kind: 1 });
    expect(surfaceTileWeights({ base: 'asphalt', kind: 'asphalt', mix: 0 })).toEqual({ base: 0, kind: 0 });
  });

  test('a tiled base covers everything until an untiled run replaces it', () => {
    expect(surfaceTileWeights({ base: 'snow', kind: 'snow', mix: 0 })).toEqual({ base: 1, kind: 0 });
    expect(surfaceTileWeights({ base: 'snow', kind: 'asphalt', mix: 0.4 })).toEqual({ base: 0.6, kind: 0 });
    expect(surfaceTileWeights({ base: 'snow', kind: 'dirt', mix: 0.4 })).toEqual({ base: 1, kind: 0.4 });
  });

  test('over a tile the veil only tunes the tint: lighter than the full veil', () => {
    const dirt = { base: 'asphalt', kind: 'dirt', mix: 1 } as const;
    expect(tiledVeilAlpha(dirt)).toBe(SURFACE_TILE_VEIL_ALPHA);
    expect(veilAlpha(dirt)).toBe(DIRT_VEIL_ALPHA);
    expect(tiledVeilAlpha(dirt)).toBeLessThan(veilAlpha(dirt));
    const dry = { base: 'asphalt', kind: 'asphalt', mix: 0 } as const;
    expect(tiledVeilAlpha(dry)).toBe(veilAlpha(dry));
  });
});

describe('drawSegment disegna la tessera dello sterrato e della neve', () => {
  test('a full dirt segment draws the dirt tile over the asphalt, opaque', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, 1280, projected({ surfaceKind: 'dirt', surfaceMix: 1 }), PAL, 0, 0.1, opts());
    const dirt = imagesOf(rec, 'ground_dirt_road');
    expect(dirt.length).toBeGreaterThan(0);
    for (const op of dirt) expect(op.alpha).toBeCloseTo(1, 9);
    const images = rec.images();
    const asphalt = images.findIndex((op) => op.image === PAL.asphalt);
    const first = images.findIndex((op) => op.image === 'ground_dirt_road');
    expect(asphalt).toBeGreaterThanOrEqual(0);
    expect(first).toBeGreaterThan(asphalt);
    expect(imagesOf(rec, 'ground_snow_road')).toHaveLength(0);
  });

  test('on the ramp the tile alpha is the mix', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, 1280, projected({ surfaceKind: 'snow', surfaceMix: 0.5 }), PAL, 0, 0.1, opts());
    const snow = imagesOf(rec, 'ground_snow_road');
    expect(snow.length).toBeGreaterThan(0);
    for (const op of snow) expect(op.alpha).toBeCloseTo(0.5, 9);
  });

  test('the veil over the tile uses the lighter alpha', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, 1280, projected({ surfaceKind: 'dirt', surfaceMix: 1 }), PAL, 0, 0.1, opts());
    const veils = rec.fills().filter((op) => op.fill === DIRT_VEIL);
    expect(veils.length).toBeGreaterThan(0);
    for (const op of veils) expect(op.alpha).toBeCloseTo(SURFACE_TILE_VEIL_ALPHA, 9);
  });

  test('without a usable tile it falls back to the full veil of before', () => {
    const rec = createRecordCtx();
    const missing = new Set(['ground_dirt_road']);
    drawSegment(rec.ctx, 1280, projected({ surfaceKind: 'dirt', surfaceMix: 1 }), PAL, 0, 0.1, opts(missing));
    expect(imagesOf(rec, 'ground_dirt_road')).toHaveLength(0);
    const veils = rec.fills().filter((op) => op.fill === DIRT_VEIL);
    expect(veils.length).toBeGreaterThan(0);
    for (const op of veils) expect(op.alpha).toBeCloseTo(DIRT_VEIL_ALPHA, 9);
  });

  test('dry asphalt draws no surface tile and leaves the alpha at one', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, 1280, projected(), PAL, 0, 0.1, opts());
    expect(imagesOf(rec, 'ground_dirt_road')).toHaveLength(0);
    expect(imagesOf(rec, 'ground_snow_road')).toHaveLength(0);
    expect(rec.ctx.globalAlpha).toBe(1);
  });
});
