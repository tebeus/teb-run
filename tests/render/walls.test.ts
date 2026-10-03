import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { SHOULDER_W } from '../../src/game/player';
import { forkOffset } from '../../src/game/track';
import { ROAD_WIDTH, SEGMENT_LENGTH } from '../../src/render/project';
import {
  WALL_BASE_OFFSET,
  WALL_GAP,
  WALL_HEIGHT,
  WALL_MAX_RATIO,
  WALL_TEXTURE,
  WALL_TILE_SEGMENTS,
  WALL_TILE_WORLD,
  renderSegmentWalls,
  wallQuad,
  wallSourceW,
  wallSourceX,
} from '../../src/render/walls';
import type { AssetStore, Segment, SpriteAsset, WallKind } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeSegment } from '../helpers/segments';

const KINDS: WallKind[] = [
  'rock_red',
  'rock_grey',
  'guardrail',
  'seawall',
  'hedge',
  'bridge_rail',
  'town_facades',
];

/** Segmento già proiettato, come lo trova il renderer: vicino e visibile. */
function projected(over: Partial<Segment> = {}): Segment {
  // `clip` sta dentro le sovrascritture: assegnarlo dopo cancellerebbe il
  // valore che il chiamante ha chiesto, e i due casi sul taglio della
  // collina passerebbero da 580 e 100 a 720.
  const seg = makeSegment(10, { clip: LOGICAL_H, ...over });
  seg.p1.camera.z = 2000;
  seg.p2.camera.z = 2200;
  seg.p1.screen = { x: 640, y: 600, w: 300, scale: 0.0003 };
  seg.p2.screen = { x: 650, y: 560, w: 280, scale: 0.00028 };
  return seg;
}

function store(): AssetStore {
  return {
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 256,
      h: 256,
      entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  };
}

describe('costanti delle pareti (spec §4.4c)', () => {
  test('the base sits at 1 + shoulder + gap, that is 1.5', () => {
    expect(WALL_GAP).toBe(0.15);
    expect(WALL_BASE_OFFSET).toBeCloseTo(1 + SHOULDER_W + WALL_GAP, 10);
    expect(WALL_BASE_OFFSET).toBeCloseTo(1.5, 10);
  });

  test('the heights are the table of the spec', () => {
    expect(WALL_HEIGHT).toEqual({
      rock_red: 0.5,
      rock_grey: 0.5,
      town_facades: 0.7,
      seawall: 0.15,
      hedge: 0.12,
      bridge_rail: 0.1,
      guardrail: 0.08,
    });
  });

  test('every kind points at a wall tile of the catalog', () => {
    for (const kind of KINDS) {
      expect(WALL_TEXTURE[kind]).toBe(`wall_${kind}`);
      expect(CATALOG[WALL_TEXTURE[kind]].kind, kind).toBe('wall');
    }
  });
});

describe('wallSourceX (spec §4.4c: la colonna scorre con la z)', () => {
  test('si ripete ogni 6 segmenti, un numero intero', () => {
    expect(WALL_TILE_WORLD / SEGMENT_LENGTH).toBe(WALL_TILE_SEGMENTS);
    expect(Number.isInteger(WALL_TILE_SEGMENTS)).toBe(true);
    expect(wallSourceX(WALL_TILE_SEGMENTS, 256)).toBeCloseTo(wallSourceX(0, 256), 10);
    expect(wallSourceX(1, 256)).toBeGreaterThan(wallSourceX(0, 256));
  });

  test('le colonne coprono la tessera esatta: nessuna si ripete', () => {
    const tile = 256;
    const sw = wallSourceW(tile);
    const xs = Array.from({ length: WALL_TILE_SEGMENTS }, (_, i) => wallSourceX(i, tile));
    expect(new Set(xs.map((x) => x.toFixed(6))).size).toBe(WALL_TILE_SEGMENTS);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(sw, 9);
    expect(xs[xs.length - 1] + sw).toBeCloseTo(tile, 9);
  });

  test('la tessera si applica quasi isotropa sulla parete piu alta', () => {
    // 256 px di tessera per 1300 unita in orizzontale, e per
    // WALL_HEIGHT.rock_red * ROAD_WIDTH unita in verticale: lo stesso numero.
    const pxPerUnitX = 256 / WALL_TILE_WORLD;
    const pxPerUnitY = 256 / (WALL_HEIGHT.rock_red * ROAD_WIDTH);
    expect(pxPerUnitX / pxPerUnitY).toBeGreaterThan(0.8);
    expect(pxPerUnitX / pxPerUnitY).toBeLessThan(1.25);
  });

  test('le pareti alte sono isotrope, le basse contano su una tessera larga', () => {
    /** Allungamento orizzontale con una tessera quadrata. */
    const square = (kind: WallKind): number => WALL_TILE_WORLD / (WALL_HEIGHT[kind] * ROAD_WIDTH);
    // Roccia: tessera 256x256, quasi la stessa scala nei due assi.
    expect(square('rock_red')).toBeGreaterThan(0.8);
    expect(square('rock_red')).toBeLessThan(1.25);
    expect(square('rock_grey')).toBeGreaterThan(0.8);
    expect(square('rock_grey')).toBeLessThan(1.25);
    // Facciate: piu alte della roccia, quindi schiacciate, non allungate.
    expect(square('town_facades')).toBeLessThan(1);
    // Le pareti basse hanno tessere larghe il doppio dell'altezza
    // (`wall_guardrail` 256x130, `wall_bridge_rail` 256x137): l'aspetto della
    // tessera riassorbe gran parte dell'allungamento.
    expect(square('guardrail') / (256 / 130)).toBeLessThan(3.5);
    expect(square('bridge_rail') / (256 / 137)).toBeLessThan(3.5);
    // Con il periodo vecchio (4 strade) erano tutte oltre sei volte.
    for (const kind of Object.keys(WALL_HEIGHT) as WallKind[]) {
      expect((8 * ROAD_WIDTH) / (WALL_HEIGHT[kind] * ROAD_WIDTH), kind).toBeGreaterThan(square(kind));
    }
  });

  test('the column never leaves the tile', () => {
    for (const index of [0, 1, 51, 52, 4321]) {
      const x = wallSourceX(index, 256);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + wallSourceW(256)).toBeLessThanOrEqual(256);
    }
  });
});

describe('wallQuad (spec §4.4c)', () => {
  test('the base is at 1.5 half widths on the chosen side', () => {
    const seg = projected();
    const right = wallQuad(seg, 1, 'rock_red', LOGICAL_H);
    const left = wallQuad(seg, -1, 'rock_red', LOGICAL_H);
    expect(right).not.toBeNull();
    expect(right!.x1).toBeCloseTo(640 + WALL_BASE_OFFSET * 300, 6);
    expect(right!.x2).toBeCloseTo(650 + WALL_BASE_OFFSET * 280, 6);
    expect(left!.x1).toBeCloseTo(640 - WALL_BASE_OFFSET * 300, 6);
  });

  test('the top is the world height projected with the scale of its own point', () => {
    const seg = projected();
    const q = wallQuad(seg, 1, 'town_facades', LOGICAL_H)!;
    expect(q.t1).toBeCloseTo(600 - 0.0003 * 0.7 * ROAD_WIDTH * (LOGICAL_H / 2), 6);
    expect(q.t2).toBeCloseTo(560 - 0.00028 * 0.7 * ROAD_WIDTH * (LOGICAL_H / 2), 6);
  });

  test('a taller kind reaches higher', () => {
    const seg = projected();
    const rock = wallQuad(seg, 1, 'rock_red', LOGICAL_H)!;
    const rail = wallQuad(seg, 1, 'guardrail', LOGICAL_H)!;
    expect(rock.t1).toBeLessThan(rail.t1);
  });

  test('a wall is clipped by the hill in front of it', () => {
    const seg = projected({ clip: 580 });
    const q = wallQuad(seg, 1, 'rock_red', LOGICAL_H)!;
    // La base non scende sotto clip: la collina copre il piede della parete.
    expect(q.y1).toBe(580);
    expect(q.y2).toBe(560);
  });

  test('a wall entirely above the clip is skipped', () => {
    const seg = projected({ clip: 100 });
    expect(wallQuad(seg, 1, 'guardrail', LOGICAL_H)).toBeNull();
  });

  test('a segment with no scale gives no quad', () => {
    const seg = projected();
    seg.p1.screen.scale = 0;
    expect(wallQuad(seg, 1, 'rock_red', LOGICAL_H)).toBeNull();
  });

  test('on a dual carriageway the base follows forkOffset, past roadHalf (C1)', () => {
    const seg = projected({ roadHalf: 2.4 });
    const right = wallQuad(seg, 1, 'rock_red', LOGICAL_H)!;
    const left = wallQuad(seg, -1, 'rock_red', LOGICAL_H)!;
    const off = forkOffset(WALL_BASE_OFFSET, 2.4);
    expect(off).toBeGreaterThan(WALL_BASE_OFFSET);
    expect(right.x1).toBeCloseTo(640 + off * 300, 6);
    expect(right.x2).toBeCloseTo(650 + off * 280, 6);
    expect(left.x1).toBeCloseTo(640 - off * 300, 6);
  });
});

describe('renderSegmentWalls', () => {
  test('it draws the tile of the kind, on the marked side only', () => {
    const rec = createRecordCtx();
    const seg = projected({ wall: { right: 'seawall' } });
    renderSegmentWalls(rec.ctx, seg, store(), LOGICAL_W, LOGICAL_H, 0.1);
    const drawn = rec.ops.filter((op) => op.type === 'drawImage');
    expect(drawn).toHaveLength(1);
    expect(drawn[0].image).toBe('wall_seawall');
    // La destinazione e in coordinate di fetta: la x di schermo sta nella
    // traslazione della trasformazione affine (quinto argomento).
    const tr = rec.ops.filter((op) => op.type === 'transform');
    expect(tr).toHaveLength(1);
    expect(tr[0].args[4]).toBeGreaterThan(640);
  });

  test('la tessera si appoggia al parallelogramma della fetta, non al rettangolo che lo contiene', () => {
    const rec = createRecordCtx();
    const seg = projected({ wall: { right: 'rock_red' } });
    const q = wallQuad(seg, 1, 'rock_red', LOGICAL_H)!;
    renderSegmentWalls(rec.ctx, seg, store(), LOGICAL_W, LOGICAL_H, 0.1);
    const tr = rec.ops.filter((op) => op.type === 'transform')[0];
    const [a, bb, c, d, e, f] = tr.args;
    // u = 0 cade sulla cima dell'estremo vicino, u = 1 su quella del lontano.
    expect(e).toBeCloseTo(q.x1, 9);
    expect(f).toBeCloseTo(q.t1, 9);
    expect(a).toBeCloseTo(q.x2 - q.x1, 9);
    expect(bb).toBeCloseTo(q.t2 - q.t1, 9);
    expect(c).toBe(0);
    // v = 1 cade sulla base: l'altezza e la media dei due estremi.
    expect(d).toBeCloseTo((q.y1 - q.t1 + (q.y2 - q.t2)) / 2, 9);
    // Il rettangolo che contiene il parallelogramma e piu alto della parete:
    // e' quello che prima deformava la tessera.
    const box = Math.max(q.y1, q.y2) - Math.min(q.t1, q.t2);
    expect(box).toBeGreaterThan(d);
    // Il rettangolo di destinazione e' la fetta unitaria, allargata ai lati.
    // args di drawImage a 8 argomenti: sx, sy, sw, sh, dx, dy, dw, dh.
    const drawn = rec.ops.filter((op) => op.type === 'drawImage')[0];
    expect(drawn.args[4]).toBeLessThan(0);
    expect(drawn.args[5]).toBe(0);
    expect(drawn.args[6]).toBeCloseTo(1 - 2 * drawn.args[4], 9);
    expect(drawn.args[7]).toBe(1);
  });

  test('una parete senza tessera non disegna niente', () => {
    const rec = createRecordCtx();
    const seg = projected({ wall: { right: 'hedge' } });
    const empty: AssetStore = {
      ready: Promise.resolve(),
      get: (name): SpriteAsset => ({
        name,
        image: { name } as unknown as CanvasImageSource,
        w: 0,
        h: 0,
        entry: { kind: 'wall', scale: 1, solid: false, collideW: 0, anchorY: 1 },
      }),
      has: () => true,
      stats: { png: 0, procedural: 0, missing: 0 },
    };
    renderSegmentWalls(rec.ctx, seg, empty, LOGICAL_W, LOGICAL_H, 0.1);
    expect(rec.ops.filter((op) => op.type === 'drawImage')).toHaveLength(0);
  });

  test('both sides are drawn when both are marked', () => {
    const rec = createRecordCtx();
    const seg = projected({ wall: { left: 'hedge', right: 'hedge' } });
    renderSegmentWalls(rec.ctx, seg, store(), LOGICAL_W, LOGICAL_H, 0.1);
    expect(rec.ops.filter((op) => op.type === 'drawImage')).toHaveLength(2);
  });

  test('no wall on the discarded side of a fork exit segment (terzo addendum del collaudo)', () => {
    const rec = createRecordCtx();
    // side: 1 scelto -> il lato scartato e' 'left' (offset negativo).
    const seg = projected({ wall: { left: 'hedge', right: 'hedge' }, forkExit: { side: 1, t: 0.3 }, discarded: { near: -4, far: -4, halfNear: 1, halfFar: 1 } });
    renderSegmentWalls(rec.ctx, seg, store(), LOGICAL_W, LOGICAL_H, 0.1);
    expect(rec.ops.filter((op) => op.type === 'drawImage')).toHaveLength(1);
  });

  test('a segment without walls draws nothing', () => {
    const rec = createRecordCtx();
    renderSegmentWalls(rec.ctx, projected(), store(), LOGICAL_W, LOGICAL_H, 0.1);
    expect(rec.ops).toHaveLength(0);
  });

  test('past 60 per cent of the draw distance the walls stop', () => {
    const rec = createRecordCtx();
    const seg = projected({ wall: { right: 'rock_red' } });
    renderSegmentWalls(rec.ctx, seg, store(), LOGICAL_W, LOGICAL_H, WALL_MAX_RATIO + 0.01);
    expect(rec.ops).toHaveLength(0);
  });

  test('the clip is opened and closed around every wall', () => {
    const rec = createRecordCtx();
    const seg = projected({ wall: { left: 'rock_grey', right: 'rock_grey' } });
    renderSegmentWalls(rec.ctx, seg, store(), LOGICAL_W, LOGICAL_H, 0.1);
    expect(rec.ops.filter((op) => op.type === 'clip')).toHaveLength(2);
    expect(rec.ops.filter((op) => op.type === 'save')).toHaveLength(2);
    expect(rec.ops.filter((op) => op.type === 'restore')).toHaveLength(2);
  });
});
