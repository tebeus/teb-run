import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { initialPlayer } from '../../src/game/player';
import { updateVisible } from '../../src/game/race';
import { DARK_VEIL, MIN_TEXTURE_BAND, SLAB_MAX_REPEATS } from '../../src/render/ground';
import { PALETTES } from '../../src/render/palette';
import { SEGMENT_LENGTH } from '../../src/render/project';
import { drawSegment, renderRoad, shouldDrawSegment } from '../../src/render/road';
import type { AssetStore, Segment, SpriteAsset } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeFlatTrack } from '../helpers/segments';

/** Store finto: ogni immagine porta il proprio nome, così si sa cosa è uscito. */
function store(over: Partial<Record<string, { w: number; h: number }>> = {}): AssetStore {
  return {
    ready: Promise.resolve(),
    get: (name): SpriteAsset => {
      const size = over[name] ?? { w: 512, h: 512 };
      return {
        name,
        image: { name } as unknown as CanvasImageSource,
        w: size.w,
        h: size.h,
        entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
      };
    },
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  };
}

/** I segmenti visibili di un tracciato piatto, il giocatore a 20 segmenti. */
function visible(): Segment[] {
  return updateVisible(makeFlatTrack(400), { ...initialPlayer(), z: 20 * SEGMENT_LENGTH }, LOGICAL_W, LOGICAL_H);
}

/**
 * Il primo segmento davvero disegnabile. `visible()[0]` è il segmento sotto
 * la telecamera: `shouldDrawSegment` lo scarta e la sua fascia è negativa
 * (misurato: y1 -1517, y2 8086, semilarghezza -3338).
 */
function nearSegment(): Segment {
  const seg = visible().find((s) => shouldDrawSegment(s) && s.p1.screen.y - s.p2.screen.y >= 2);
  expect(seg).toBeDefined();
  return seg as Segment;
}

const opts = (assets = store()) => ({ assets, timeLeft: 60 });

describe('renderRoad con le texture (spec §4.4a)', () => {
  test('the near segments draw the ground tile of the theme and the asphalt tile', () => {
    const rec = createRecordCtx();
    renderRoad(rec.ctx, visible(), PALETTES.beach, LOGICAL_W, opts());
    const names = new Set(rec.images().map((op) => op.image));
    expect(names.has('ground_beach')).toBe(true);
    expect(names.has('asphalt')).toBe(true);
  });

  test('without options nothing is drawn with an image: the flat road still works', () => {
    const rec = createRecordCtx();
    renderRoad(rec.ctx, visible(), PALETTES.beach, LOGICAL_W, null);
    expect(rec.images()).toHaveLength(0);
    expect(rec.fills().length).toBeGreaterThan(100);
  });

  test('a texture with no size falls back to the flat colour', () => {
    const rec = createRecordCtx();
    renderRoad(rec.ctx, visible(), PALETTES.beach, LOGICAL_W, opts(store({ ground_beach: { w: 0, h: 0 } })));
    expect(rec.images().some((op) => op.image === 'ground_beach')).toBe(false);
  });

  test('the far segments cost no drawImage: their band is thinner than a pixel', () => {
    const segments = visible();
    const rec = createRecordCtx();
    renderRoad(rec.ctx, segments, PALETTES.beach, LOGICAL_W, opts());
    // L'ultimo segmento disegnato ha una fascia sottilissima: la sua riga
    // sorgente non deve comparire fra le immagini.
    const thin = segments.filter((seg) => seg.p1.screen.y - seg.p2.screen.y < MIN_TEXTURE_BAND);
    expect(thin.length).toBeGreaterThan(100);
    // Nessuna fetta è più bassa del limite, e il conto resta legato ai soli
    // segmenti spessi: al massimo terreno e asfalto per ogni copia laterale.
    // Misurato: 150 immagini su 300 segmenti, 43 dei quali abbastanza spessi.
    for (const op of rec.images()) {
      expect(op.args[7], 'altezza della fetta').toBeGreaterThanOrEqual(MIN_TEXTURE_BAND);
    }
    const thick = segments.length - thin.length;
    expect(rec.images().length).toBeLessThanOrEqual(2 * (2 * SLAB_MAX_REPEATS + 1) * thick);
  });

  test('a dark segment gets the dark veil over the texture', () => {
    const rec = createRecordCtx();
    const segments = visible();
    const dark = segments.find((seg) => seg.dark && seg.p1.screen.y - seg.p2.screen.y >= 2);
    expect(dark).toBeDefined();
    drawSegment(rec.ctx, LOGICAL_W, dark as Segment, PALETTES.beach, 0, 0.1, opts());
    expect(rec.fills().some((op) => op.fill === DARK_VEIL)).toBe(true);
  });

  test('a light segment gets no veil', () => {
    const rec = createRecordCtx();
    const segments = visible();
    const light = segments.find((seg) => !seg.dark && seg.p1.screen.y - seg.p2.screen.y >= 2);
    drawSegment(rec.ctx, LOGICAL_W, light as Segment, PALETTES.beach, 0, 0.1, opts());
    expect(rec.fills().some((op) => op.fill === DARK_VEIL)).toBe(false);
  });

  test('the order is ground, shoulder, kerb, asphalt', () => {
    const rec = createRecordCtx();
    const seg = nearSegment();
    drawSegment(rec.ctx, LOGICAL_W, seg, PALETTES.beach, 0, 0.1, opts());
    const colours = rec.fills().map((op) => op.fill);
    const iGround = colours.indexOf(PALETTES.beach.grassLight);
    const iShoulder = colours.findIndex((c) => c === PALETTES.beach.shoulderLight || c === PALETTES.beach.shoulderDark);
    const iRumble = colours.findIndex((c) => c === PALETTES.beach.rumbleLight || c === PALETTES.beach.rumbleDark);
    const iRoad = colours.indexOf(PALETTES.beach.roadLight);
    expect(iGround).toBe(0);
    expect(iShoulder).toBeGreaterThan(iGround);
    expect(iRumble).toBeGreaterThan(iShoulder);
    expect(iRoad).toBeGreaterThan(iRumble);
  });

  test('the asphalt slice is clipped to the road, and the clip is released', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, LOGICAL_W, nearSegment(), PALETTES.beach, 0, 0.1, opts());
    const saves = rec.ops.filter((op) => op.type === 'save').length;
    const restores = rec.ops.filter((op) => op.type === 'restore').length;
    expect(rec.ops.some((op) => op.type === 'clip')).toBe(true);
    expect(saves).toBe(restores);
  });

  test('the wear tracks are drawn at 0.08 alpha and the alpha is put back', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, LOGICAL_W, nearSegment(), PALETTES.beach, 0, 0.1, opts());
    expect(rec.fills().some((op) => op.alpha === 0.08)).toBe(true);
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  test('a theme without lane markers draws fewer quads than one with them', () => {
    // `PALETTES.alpine.lane` non serve al confronto: in quel tema coincide
    // col cordolo chiaro, entrambi '#ffffff'. Il colore di corsia del deserto
    // invece è solo suo.
    const segments = visible();
    const withLanes = createRecordCtx();
    renderRoad(withLanes.ctx, segments, PALETTES.desert, LOGICAL_W, opts());
    const without = createRecordCtx();
    renderRoad(without.ctx, segments, PALETTES.alpine, LOGICAL_W, opts());
    expect(withLanes.fills().some((op) => op.fill === PALETTES.desert.lane)).toBe(true);
    expect(without.fills().some((op) => op.fill === PALETTES.desert.lane)).toBe(false);
    expect(without.fills().length).toBeLessThan(withLanes.fills().length);
  });
});
