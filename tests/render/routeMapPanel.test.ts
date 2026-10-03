import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import {
  BIG_BLINK_HZ,
  BIG_CURRENT_R,
  BIG_VISITED_R,
  blinkOn,
  containRect,
  drawMapBackdrop,
  drawRouteMapLarge,
  drawRouteMapPanel,
  MAP_EDGE_ON,
  MAP_NODE_ON,
  MAP_VEIL,
  visitedStages,
} from '../../src/render/routeMap';
import type { AssetStore, SpriteAsset } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';

const store = (w = 1280, h = 720): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w,
    h,
    entry: CATALOG[name] ?? { kind: 'illustration', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

describe('mappa del percorso sopra l\'illustrazione (spec §11)', () => {
  test('the illustration goes first, then a dark veil, then the graph', () => {
    const rec = createRecordCtx();
    drawRouteMapPanel(rec.ctx, store(), 40, 60, 600, 400, visitedStages(['L', 'R']), '2-1');
    const image = rec.ops.findIndex((op) => op.type === 'drawImage' && op.image === 'map_full');
    const veil = rec.ops.findIndex((op) => op.type === 'fillRect' && op.fill === MAP_VEIL);
    const node = rec.ops.findIndex((op) => op.type === 'fill' && op.fill === MAP_NODE_ON);
    expect(image).toBeGreaterThanOrEqual(0);
    expect(veil).toBeGreaterThan(image);
    expect(node).toBeGreaterThan(veil);
  });

  test('the illustration fills exactly the rectangle it is given', () => {
    const rec = createRecordCtx();
    drawRouteMapPanel(rec.ctx, store(), 40, 60, 600, 400, visitedStages([]), '0-0');
    const image = rec.images().find((op) => op.image === 'map_full');
    expect(image!.args.slice(0, 4)).toEqual([40, 60, 600, 400]);
  });

  test('a zero-sized illustration is skipped and the alpha stays in range', () => {
    const rec = createRecordCtx();
    drawRouteMapPanel(rec.ctx, store(0, 0), 0, 0, 300, 200, visitedStages([]), '0-0');
    expect(rec.images()).toHaveLength(0);
    // Il grafo si disegna comunque: la mappa non dipende dal PNG.
    expect(rec.ops.some((op) => op.type === 'fill' && op.fill === MAP_NODE_ON)).toBe(true);
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  test('a rectangle with no area draws nothing at all', () => {
    const rec = createRecordCtx();
    drawRouteMapPanel(rec.ctx, store(), 0, 0, 0, 200, visitedStages([]), '0-0');
    expect(rec.ops).toEqual([]);
  });
});

describe('containRect', () => {
  test('a wider image is letterboxed top and bottom, a taller one left and right', () => {
    expect(containRect(200, 100, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(containRect(100, 200, { x: 10, y: 0, w: 100, h: 100 })).toEqual({ x: 35, y: 0, w: 50, h: 100 });
  });

  test('an image without size takes the whole box', () => {
    expect(containRect(0, 0, { x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});

describe('drawMapBackdrop', () => {
  test('background, then the whole image, then the veil; save and restore balanced', () => {
    const rec = createRecordCtx();
    const placed = drawMapBackdrop(rec.ctx, store(1279, 720), { x: 0, y: 0, w: 1280, h: 720 }, '#0a2a52', 'rgba(0,0,0,0.5)');
    expect(placed!.w / placed!.h).toBeCloseTo(1279 / 720, 6);
    const bg = rec.ops.findIndex((op) => op.fill === '#0a2a52');
    const image = rec.ops.findIndex((op) => op.image === 'map_full');
    const veil = rec.ops.findIndex((op) => op.fill === 'rgba(0,0,0,0.5)');
    expect(bg).toBeLessThan(image);
    expect(image).toBeLessThan(veil);
    expect(rec.ops.filter((op) => op.type === 'save').length).toBe(rec.ops.filter((op) => op.type === 'restore').length);
    expect(rec.ctx.globalAlpha).toBe(1);
  });
});

describe('drawRouteMapLarge', () => {
  const rect = { x: 140, y: 190, w: 1000, h: 510 };

  test('it draws 20 grid edges, and for each hop of the route a dark outline plus the highlight', () => {
    const visited = visitedStages(['L', 'R']);
    const rec = createRecordCtx();
    drawRouteMapLarge(rec.ctx, rect, visited, visited[visited.length - 1], false);
    const strokes = rec.ops.filter((op) => op.type === 'stroke').map((op) => op.fill);
    expect(strokes.filter((c) => c === MAP_EDGE_ON)).toHaveLength(2);
    expect(strokes).toHaveLength(20 + 2 * 2);
  });

  test('visited nodes are big and filled, the others small, and the blink ring comes and goes', () => {
    const visited = visitedStages(['R']);
    const on = createRecordCtx();
    drawRouteMapLarge(on.ctx, rect, visited, '1-1', true);
    const off = createRecordCtx();
    drawRouteMapLarge(off.ctx, rect, visited, '1-1', false);
    const big = (rec: ReturnType<typeof createRecordCtx>) =>
      rec.ops.filter((op) => op.type === 'arc' && op.args[2] === BIG_VISITED_R).length;
    expect(big(on)).toBe(2);
    const ring = (rec: ReturnType<typeof createRecordCtx>) =>
      rec.ops.filter((op) => op.type === 'arc' && op.args[2] === BIG_CURRENT_R).length;
    expect(ring(on)).toBe(1);
    expect(ring(off)).toBe(0);
    expect(on.ops.filter((op) => op.type === 'fill' && op.fill === MAP_NODE_ON)).toHaveLength(2);
  });

  test('blinkOn alternates at BIG_BLINK_HZ', () => {
    const half = 1 / (2 * BIG_BLINK_HZ);
    expect(blinkOn(0)).toBe(true);
    expect(blinkOn(half * 1.5)).toBe(false);
    expect(blinkOn(half * 2.5)).toBe(true);
  });
});
