import { describe, expect, test } from 'vitest';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import {
  FOAM,
  SHIMMER,
  SHIMMER_PERIOD,
  drawWater,
  shimmerOn,
  shoulderEdge,
} from '../../src/render/ground';
import { PALETTES, segmentColors } from '../../src/render/palette';
import { drawSegment } from '../../src/render/road';
import type { AssetStore, Segment, SpriteAsset } from '../../src/types';
import { CATALOG } from '../../src/art/catalog';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeSegment } from '../helpers/segments';

function projected(over: Partial<Segment> = {}): Segment {
  // `clip` sta dentro le sovrascritture: assegnarlo dopo cancellerebbe il
  // valore che il chiamante ha chiesto.
  const seg = makeSegment(10, { clip: LOGICAL_H, ...over });
  seg.p1.camera.z = 2000;
  seg.p2.camera.z = 2200;
  seg.p1.screen = { x: 640, y: 600, w: 300, scale: 0.0003 };
  seg.p2.screen = { x: 645, y: 560, w: 280, scale: 0.00028 };
  return seg;
}

const store = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w: 512,
    h: 512,
    entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

describe('shimmerOn (spec §4.4c: alternato ogni 0.25 s)', () => {
  test('it flips every quarter of a second', () => {
    expect(SHIMMER_PERIOD).toBe(0.25);
    expect(shimmerOn(0)).toBe(true);
    expect(shimmerOn(0.2)).toBe(true);
    expect(shimmerOn(0.3)).toBe(false);
    expect(shimmerOn(0.6)).toBe(true);
  });

  test('a negative clock never throws and reads as zero', () => {
    expect(shimmerOn(-5)).toBe(true);
  });
});

describe('drawWater (spec §4.4c)', () => {
  test('the water fills from the shoulder edge to the screen edge, on the left', () => {
    const rec = createRecordCtx();
    const seg = projected();
    drawWater(rec.ctx, seg, segmentColors(PALETTES.beach, false), LOGICAL_W, 'left', false);
    const water = rec.ops.filter((op) => op.type === 'moveTo');
    expect(water.length).toBeGreaterThanOrEqual(2);
    // Il primo quadrilatero parte dal bordo sinistro dello schermo.
    expect(water[0].args[0]).toBe(0);
    const edge = 640 - shoulderEdge(300);
    expect(rec.ops.some((op) => op.type === 'lineTo' && Math.abs(op.args[0] - edge) < 0.001)).toBe(true);
  });

  test('on the right it reaches the right edge of the screen', () => {
    const rec = createRecordCtx();
    drawWater(rec.ctx, projected(), segmentColors(PALETTES.beach, false), LOGICAL_W, 'right', false);
    expect(rec.ops.some((op) => op.type === 'moveTo' && op.args[0] === LOGICAL_W)).toBe(true);
  });

  test('it paints the water colour of the segment and a foam line', () => {
    const rec = createRecordCtx();
    const colors = segmentColors(PALETTES.beach, true);
    drawWater(rec.ctx, projected({ dark: true }), colors, LOGICAL_W, 'left', false);
    const fills = rec.ops.filter((op) => op.type === 'fill').map((op) => op.fill);
    expect(fills).toContain(PALETTES.beach.waterDark);
    expect(fills).toContain(FOAM);
  });

  test('the shimmer only lands on dark segments', () => {
    const dark = createRecordCtx();
    drawWater(dark.ctx, projected({ dark: true }), segmentColors(PALETTES.beach, true), LOGICAL_W, 'left', true);
    expect(dark.ops.some((op) => op.type === 'fill' && op.fill === SHIMMER)).toBe(true);

    const light = createRecordCtx();
    drawWater(light.ctx, projected({ dark: false }), segmentColors(PALETTES.beach, false), LOGICAL_W, 'left', true);
    expect(light.ops.some((op) => op.type === 'fill' && op.fill === SHIMMER)).toBe(false);
  });

  test('with the shimmer off nothing shimmers, dark or not', () => {
    const rec = createRecordCtx();
    drawWater(rec.ctx, projected({ dark: true }), segmentColors(PALETTES.beach, true), LOGICAL_W, 'left', false);
    expect(rec.ops.some((op) => op.type === 'fill' && op.fill === SHIMMER)).toBe(false);
  });
});

describe('drawSegment con acqua', () => {
  test('a segment marked with water paints it, a plain one does not', () => {
    const wet = createRecordCtx();
    // dark: false, così il colore atteso è quello chiaro dell'alternanza.
    drawSegment(wet.ctx, LOGICAL_W, projected({ water: 'left', dark: false }), PALETTES.beach, 0, 0.1, {
      assets: store(),
      timeLeft: 60,
    });
    expect(wet.ops.some((op) => op.type === 'fill' && op.fill === PALETTES.beach.waterLight)).toBe(true);

    const dry = createRecordCtx();
    drawSegment(dry.ctx, LOGICAL_W, projected({ dark: false }), PALETTES.beach, 0, 0.1, {
      assets: store(),
      timeLeft: 60,
    });
    expect(dry.ops.some((op) => op.type === 'fill' && op.fill === PALETTES.beach.waterLight)).toBe(false);
  });

  test('no water on the discarded side of a fork exit segment (terzo addendum del collaudo)', () => {
    // side: 1 scelto -> il lato scartato e' 'left': l'acqua lì non si disegna.
    const rec = createRecordCtx();
    drawSegment(
      rec.ctx,
      LOGICAL_W,
      projected({ water: 'left', dark: false, forkExit: { side: 1, t: 0.3 }, discarded: { near: -4, far: -4, halfNear: 1, halfFar: 1 } }),
      PALETTES.beach,
      0,
      0.1,
      { assets: store(), timeLeft: 60 },
    );
    expect(rec.ops.some((op) => op.type === 'fill' && op.fill === PALETTES.beach.waterLight)).toBe(false);
  });

  test('the water is covered by the shoulder, never the other way round', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, LOGICAL_W, projected({ water: 'left', dark: false }), PALETTES.beach, 0, 0.1, {
      assets: store(),
      timeLeft: 60,
    });
    const colours = rec.ops.filter((op) => op.type === 'fill' || op.type === 'fillRect').map((op) => op.fill);
    const iWater = colours.indexOf(PALETTES.beach.waterLight);
    const iShoulder = colours.findIndex(
      (cc) => cc === PALETTES.beach.shoulderLight || cc === PALETTES.beach.shoulderDark,
    );
    expect(iWater).toBeGreaterThanOrEqual(0);
    expect(iShoulder).toBeGreaterThan(iWater);
  });
});
