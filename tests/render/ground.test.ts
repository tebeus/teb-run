import { describe, expect, test } from 'vitest';
import { SHOULDER_W } from '../../src/game/player';
import {
  bandEdges,
  DARK_VEIL,
  drawGroundSlab,
  drawWearTracks,
  GROUND_TEXTURE_MAX,
  GROUND_TILE_ROADS,
  GROUND_TILE_WORLD,
  MIN_TEXTURE_BAND,
  SLAB_MAX_REPEATS,
  SLAB_OVERDRAW,
  WEAR_OFFSETS,
  WEAR_OFFSETS_3,
  shoulderEdge,
  slabRepeats,
  slabWidth,
  textureSourceH,
  textureSourceY,
  useGroundTexture,
  wearTrackOffsets,
} from '../../src/render/ground';
import { PALETTES } from '../../src/render/palette';
import { ROAD_WIDTH, SEGMENT_LENGTH } from '../../src/render/project';
import { drawSegment } from '../../src/render/road';
import type { AssetStore, Segment, SpriteAsset } from '../../src/types';
import { makeAsset, makeSegment } from '../helpers/segments';
import { createRecordCtx } from '../helpers/recordCtx';

const TILE = 512;
const ok = (over: Partial<Parameters<typeof useGroundTexture>[0]> = {}) =>
  useGroundTexture({
    distanceRatio: 0.1,
    bandH: 4,
    slabW: 600,
    width: 1280,
    tileW: TILE,
    tileH: TILE,
    kind: 'texture',
    ...over,
  });

describe('costanti della superficie (spec §4.4a)', () => {
  test('the ground tile covers 6 road widths', () => {
    expect(GROUND_TILE_ROADS).toBe(6);
    expect(GROUND_TILE_WORLD).toBe(6 * ROAD_WIDTH);
    expect(GROUND_TEXTURE_MAX).toBe(0.7);
  });
});

describe('textureSourceY (spec §4.4a: la riga sorgente segue la z)', () => {
  test('it is the segment z wrapped on the tile', () => {
    expect(textureSourceY(0, TILE)).toBe(0);
    const perSegment = (SEGMENT_LENGTH / GROUND_TILE_WORLD) * TILE;
    expect(textureSourceY(1, TILE)).toBeCloseTo(perSegment, 10);
  });

  test('it repeats every 78 segments, because 78 * 200 = 15600', () => {
    expect(GROUND_TILE_WORLD / SEGMENT_LENGTH).toBe(78);
    expect(textureSourceY(78, TILE)).toBeCloseTo(textureSourceY(0, TILE), 10);
    expect(textureSourceY(79, TILE)).toBeCloseTo(textureSourceY(1, TILE), 10);
  });

  test('it never leaves the tile, not even for a huge index', () => {
    for (const index of [0, 1, 59, 60, 1000, 123457]) {
      const y = textureSourceY(index, TILE);
      expect(y, `index ${index}`).toBeGreaterThanOrEqual(0);
      expect(y + textureSourceH(TILE), `index ${index}`).toBeLessThanOrEqual(TILE);
    }
  });

  test('the source height covers exactly one segment', () => {
    expect(textureSourceH(TILE)).toBeCloseTo((SEGMENT_LENGTH / GROUND_TILE_WORLD) * TILE, 10);
    expect(textureSourceH(TILE)).toBeGreaterThan(0);
  });
});

describe('slabWidth and slabRepeats', () => {
  test('a slab is six road widths wide', () => {
    expect(slabWidth(100)).toBe(2 * 100 * GROUND_TILE_ROADS);
  });

  test('a slab wider than the screen needs no copies', () => {
    expect(slabRepeats(640, 4000, 1280)).toEqual({ from: 0, to: 0 });
  });

  test('a narrow slab is repeated on both sides until it covers the screen', () => {
    const slabW = 200;
    const r = slabRepeats(640, slabW, 1280);
    expect(r.from).toBeLessThan(0);
    expect(r.to).toBeGreaterThan(0);
    // La copia più a sinistra copre lo zero, la più a destra il bordo destro.
    expect(640 - slabW / 2 + r.from * slabW).toBeLessThanOrEqual(0);
    expect(640 + slabW / 2 + r.to * slabW).toBeGreaterThanOrEqual(1280);
  });

  test('the number of copies is capped, whatever the slab width', () => {
    const r = slabRepeats(640, 1, 1280);
    expect(r.from).toBeGreaterThanOrEqual(-SLAB_MAX_REPEATS);
    expect(r.to).toBeLessThanOrEqual(SLAB_MAX_REPEATS);
  });

  test('a degenerate slab asks for no copies', () => {
    expect(slabRepeats(640, 0, 1280)).toEqual({ from: 0, to: 0 });
    expect(slabRepeats(640, Number.NaN, 1280)).toEqual({ from: 0, to: 0 });
  });
});

describe('shoulderEdge', () => {
  test('the shoulder ends at 1 + SHOULDER_W half widths', () => {
    expect(shoulderEdge(300)).toBeCloseTo(300 * (1 + SHOULDER_W), 10);
    expect(SHOULDER_W).toBe(0.35);
  });
});

describe('wearTrackOffsets (spec §4.4a: due tracce per corsia)', () => {
  test('there are two tracks per lane, inside the asphalt', () => {
    const offsets = wearTrackOffsets(4);
    expect(offsets).toHaveLength(8);
    for (const o of offsets) {
      expect(Math.abs(o)).toBeLessThan(1);
    }
  });

  test('the tracks are symmetric around the centre', () => {
    const offsets = wearTrackOffsets(4);
    const mirrored = offsets.map((o) => -o).sort((a, b) => a - b);
    expect(mirrored.map((v) => Number(v.toFixed(6)))).toEqual(
      [...offsets].sort((a, b) => a - b).map((v) => Number(v.toFixed(6))),
    );
  });

  test('WEAR_OFFSETS is computed once, not per segment', () => {
    expect(WEAR_OFFSETS).toBe(WEAR_OFFSETS);
    expect(WEAR_OFFSETS).toHaveLength(8);
  });
});

describe('drawWearTracks con il numero di corsie della tappa (minore 1)', () => {
  test('a 3 corsie ci sono sei tracce, non otto (WEAR_OFFSETS_3)', () => {
    expect(WEAR_OFFSETS_3).toHaveLength(6);
    const rec = createRecordCtx();
    const s = makeSegment(10);
    s.p1.screen = { x: 640, y: 600, w: 300, scale: 0.0003 };
    s.p2.screen = { x: 650, y: 560, w: 280, scale: 0.00028 };
    drawWearTracks(rec.ctx, s, 3);
    const quads = rec.ops.filter((op) => op.type === 'fill' && op.fill === '#000000');
    expect(quads).toHaveLength(6);
  });

  test('senza lanes il default resta a 4 corsie, otto tracce', () => {
    const rec = createRecordCtx();
    const s = makeSegment(10);
    s.p1.screen = { x: 640, y: 600, w: 300, scale: 0.0003 };
    s.p2.screen = { x: 650, y: 560, w: 280, scale: 0.00028 };
    drawWearTracks(rec.ctx, s);
    const quads = rec.ops.filter((op) => op.type === 'fill' && op.fill === '#000000');
    expect(quads).toHaveLength(8);
  });

  test('drawSegment passa le corsie della tappa a drawWearTracks', () => {
    const rec = createRecordCtx();
    const s = makeSegment(10, { median: 0 });
    s.p1.screen = { x: 640, y: 600, w: 300, scale: 0.0003 };
    s.p2.screen = { x: 650, y: 560, w: 280, scale: 0.00028 };
    const ground = makeAsset('ground_town', 512, 512, { kind: 'texture' });
    const asphalt = makeAsset('road_town', 512, 512, { kind: 'texture' });
    drawSegment(rec.ctx, 1280, s, PALETTES.town, 0, 0.1, {
      assets: {
        ready: Promise.resolve(),
        get: (name) => (name === ground.name ? ground : name === asphalt.name ? asphalt : ground),
        has: () => true,
        stats: { png: 0, procedural: 0, missing: 0 },
      },
      timeLeft: 60,
      lanes: 3,
    });
    const quads = rec.ops.filter((op) => op.type === 'fill' && op.fill === '#000000');
    expect(quads).toHaveLength(6);
  });
});

describe('drawAsphaltSlab: il velo scuro segue anche la tessera del tema nuovo (minore 4)', () => {
  test('durante la transizione la tessera entrante mostra l alternanza, sfumata come l immagine', () => {
    const rec = createRecordCtx();
    const s = makeSegment(10, { dark: true, median: 0 });
    s.p1.screen = { x: 640, y: 600, w: 300, scale: 0.0003 };
    s.p2.screen = { x: 650, y: 560, w: 280, scale: 0.00028 };
    const groundOld = makeAsset('ground_beach', 512, 512, { kind: 'texture' });
    const asphaltOld = makeAsset('road_beach', 512, 512, { kind: 'texture' });
    const groundNew = makeAsset('ground_alpine', 512, 512, { kind: 'texture' });
    const asphaltNew = makeAsset('road_alpine', 512, 512, { kind: 'texture' });
    const table: Record<string, SpriteAsset> = {
      [groundOld.name]: groundOld,
      [asphaltOld.name]: asphaltOld,
      [groundNew.name]: groundNew,
      [asphaltNew.name]: asphaltNew,
    };
    const assets: AssetStore = {
      ready: Promise.resolve(),
      get: (name) => table[name] ?? groundOld,
      has: () => true,
      stats: { png: 0, procedural: 0, missing: 0 },
    };
    drawSegment(rec.ctx, 1280, s, { ...PALETTES.beach, ground: groundOld.name, asphalt: asphaltOld.name }, 0, 0.1, {
      assets,
      timeLeft: 60,
      overlay: { ground: groundNew.name, asphalt: asphaltNew.name, alpha: 0.4 },
    });
    const veils = rec.ops.filter((op) => op.type === 'fillRect' && op.fill === DARK_VEIL);
    // Terreno vecchio e asfalto vecchio a alfa piena, asfalto nuovo sfumato
    // come la sua immagine: prima della correzione questo terzo velo non
    // c'era, e la tessera entrante restava sempre chiara.
    expect(veils).toHaveLength(3);
    expect(veils[0].alpha).toBe(1);
    expect(veils[1].alpha).toBe(1);
    expect(veils[2].alpha).toBeCloseTo(0.4, 10);
  });
});

describe('useGroundTexture (spec §4.4a più le due deroghe di prestazione)', () => {
  test('a near, thick, wide band uses the texture', () => {
    expect(ok()).toBe(true);
  });

  test('past 70 per cent of the draw distance it falls back to the flat colour', () => {
    expect(ok({ distanceRatio: GROUND_TEXTURE_MAX + 0.01 })).toBe(false);
    expect(ok({ distanceRatio: GROUND_TEXTURE_MAX })).toBe(true);
  });

  test('a band thinner than 0.8 px falls back: the slice would be invisible', () => {
    expect(ok({ bandH: MIN_TEXTURE_BAND - 0.01 })).toBe(false);
    expect(ok({ bandH: MIN_TEXTURE_BAND })).toBe(true);
  });

  test('a slab too narrow to cover the screen with 9 copies falls back', () => {
    expect(ok({ slabW: 1280 / (2 * SLAB_MAX_REPEATS + 1) - 1 })).toBe(false);
    expect(ok({ slabW: 1280 / (2 * SLAB_MAX_REPEATS + 1) })).toBe(true);
  });

  test('a texture with no size falls back to the flat colour', () => {
    expect(ok({ tileW: 0 })).toBe(false);
    expect(ok({ tileH: 0 })).toBe(false);
    expect(ok({ tileW: Number.NaN })).toBe(false);
  });

  test('an asset that is not a texture falls back: no magenta placeholder on the road', () => {
    expect(ok({ kind: 'scenery' })).toBe(false);
    expect(ok({ kind: 'wall' })).toBe(false);
  });
});

describe('bordi delle fette al pixel intero (deroga di spec §4.4a)', () => {
  const band = (yNear: number, yFar: number): Segment => {
    const seg = makeSegment(3);
    seg.p1.screen = { x: 640, y: yNear, w: 300, scale: 0.01 };
    seg.p2.screen = { x: 640, y: yFar, w: 280, scale: 0.009 };
    return seg;
  };

  test('i due bordi sono interi', () => {
    const e = bandEdges(band(600.4, 578.7));
    expect(e.near).toBe(600);
    expect(e.far).toBe(579);
  });

  test('due segmenti adiacenti combaciano: nessun buco, nessuna sovrapposizione', () => {
    // p2 di uno e p1 dell'altro sono lo stesso punto del mondo: stessa y.
    const shared = 512.37;
    expect(bandEdges(band(540.1, shared)).far).toBe(bandEdges(band(shared, 490.2)).near);
  });

  test('una fetta piu sottile di un pixel collassa invece di dipingere una riga', () => {
    const e = bandEdges(band(600.2, 599.9));
    expect(e.near - e.far).toBe(0);
  });

  test('tutti i riempimenti di un segmento hanno i bordi sugli stessi interi', () => {
    const rec = createRecordCtx();
    const seg = band(600.4, 578.7);
    seg.water = 'left';
    drawSegment(rec.ctx, 1280, seg, PALETTES.beach, 0, 0.1, null);
    const ys = new Set<number>();
    for (const op of rec.ops) {
      if (op.type === 'moveTo' || op.type === 'lineTo') ys.add(op.args[1]);
      if (op.type === 'fillRect') {
        ys.add(op.args[1]);
        ys.add(op.args[1] + op.args[3]);
      }
    }
    expect(ys.size).toBeGreaterThan(0);
    for (const y of ys) expect(Number.isInteger(y), `y=${y}`).toBe(true);
  });

  test('le copie laterali di una fetta si sovrappongono di un pixel per lato', () => {
    const rec = createRecordCtx();
    const seg = band(600, 580);
    seg.p1.screen.w = 40;
    seg.p2.screen.w = 38;
    drawGroundSlab(rec.ctx, makeAsset('ground_beach', TILE, TILE, { kind: 'texture' }), seg, 1280, 580, 20);
    const copies = rec.ops.filter((op) => op.type === 'drawImage');
    expect(copies.length).toBeGreaterThan(1);
    const w = slabWidth(seg.p1.screen.w);
    for (const op of copies) expect(op.args[6]).toBeCloseTo(w + 2 * SLAB_OVERDRAW, 6);
    // Il bordo destro di una copia supera il bordo sinistro della successiva.
    const sorted = copies.map((op) => op.args[4]).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1] + w + 2 * SLAB_OVERDRAW).toBeGreaterThan(sorted[i] + SLAB_OVERDRAW);
    }
  });
});
