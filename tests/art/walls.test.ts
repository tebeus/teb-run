import { describe, expect, test } from 'vitest';
import { WALLS, WALL_PERIOD, WALL_TILE, wallShapes } from '../../src/art/procedural/walls';
import type { WallKind } from '../../src/types';
import { createFakeCtx, drawnBounds } from '../helpers/fakeCtx';

const KINDS: WallKind[] = [
  'rock_red',
  'rock_grey',
  'guardrail',
  'seawall',
  'hedge',
  'bridge_rail',
  'town_facades',
];

describe('wallShapes (spec §4.4c, §13: 256x256 ripetibili in orizzontale)', () => {
  test('there is one shape list per wall kind, never empty', () => {
    for (const kind of KINDS) {
      expect(wallShapes(kind).length, kind).toBeGreaterThanOrEqual(3);
    }
  });

  test('no shape leaves the tile, so the tile repeats without bleeding', () => {
    for (const kind of KINDS) {
      for (const s of wallShapes(kind)) {
        // Per le ellissi x e y sono il centro e w e h i diametri.
        const half = s.kind === 'ell';
        const left = half ? s.x - s.w / 2 : s.x;
        const right = half ? s.x + s.w / 2 : s.x + s.w;
        const top = half ? s.y - s.h / 2 : s.y;
        const bottom = half ? s.y + s.h / 2 : s.y + s.h;
        expect(left, `${kind} left`).toBeGreaterThanOrEqual(0);
        expect(right, `${kind} right`).toBeLessThanOrEqual(WALL_TILE);
        expect(top, `${kind} top`).toBeGreaterThanOrEqual(0);
        expect(bottom, `${kind} bottom`).toBeLessThanOrEqual(WALL_TILE);
      }
    }
  });

  test('every period divides the tile', () => {
    for (const kind of KINDS) {
      expect(WALL_TILE % WALL_PERIOD[kind], kind).toBe(0);
    }
  });

  test('the repeated elements come in one group per period cell', () => {
    for (const kind of KINDS) {
      const period = WALL_PERIOD[kind];
      if (period === WALL_TILE) continue;
      const cells = WALL_TILE / period;
      const repeated = wallShapes(kind).filter((s) => s.w <= period);
      expect(repeated.length, kind).toBeGreaterThanOrEqual(cells);
      // Ogni cella del passo ha almeno una forma che comincia dentro di sé:
      // il motivo si ripete a passo costante su tutta la tessera. Il totale
      // non è un multiplo del numero di celle: le righe dispari di `seawall`
      // hanno una forma in più delle pari, i due mezzi blocchi ai bordi.
      for (let cell = 0; cell < cells; cell++) {
        const inCell = repeated.filter((s) => s.x >= cell * period && s.x < (cell + 1) * period);
        expect(inCell.length, `${kind} cell ${cell}`).toBeGreaterThan(0);
      }
    }
  });

  test('every kind has at least one band spanning the whole tile', () => {
    for (const kind of KINDS) {
      const spanning = wallShapes(kind).filter((s) => s.kind === 'box' && s.x === 0 && s.w === WALL_TILE);
      expect(spanning.length, kind).toBeGreaterThan(0);
    }
  });

  test('the shape list is deterministic', () => {
    for (const kind of KINDS) {
      expect(wallShapes(kind)).toEqual(wallShapes(kind));
    }
  });

  test('a smaller tile scales the shapes with it', () => {
    for (const s of wallShapes('seawall', 128)) {
      expect(s.kind === 'ell' ? s.x + s.w / 2 : s.x + s.w).toBeLessThanOrEqual(128);
    }
  });
});

describe('WALLS', () => {
  test('there are seven tiles, one per WallKind', () => {
    expect(Object.keys(WALLS).sort()).toEqual(KINDS.map((k) => `wall_${k}`).sort());
  });

  test('every tile paints something and stays inside 256x256', () => {
    for (const [name, draw] of Object.entries(WALLS)) {
      const b = drawnBounds(draw, WALL_TILE, WALL_TILE);
      expect(b.ctx.paints, name).toBeGreaterThan(3);
      expect(b.minX, name).toBeGreaterThanOrEqual(0);
      expect(b.maxX, name).toBeLessThanOrEqual(WALL_TILE);
      expect(b.minY, name).toBeGreaterThanOrEqual(0);
      expect(b.maxY, name).toBeLessThanOrEqual(WALL_TILE);
    }
  });

  test('the open kinds never paint a full background rectangle', () => {
    // guard-rail e ringhiera devono lasciare passare il cielo (spec §13).
    for (const kind of ['guardrail', 'bridge_rail'] as const) {
      const ctx = createFakeCtx();
      WALLS[`wall_${kind}`](ctx, WALL_TILE, WALL_TILE);
      const covers = ctx.ops.some(
        (op) => op.type === 'fillRect' && op.args[2] >= WALL_TILE && op.args[3] >= WALL_TILE,
      );
      expect(covers, kind).toBe(false);
    }
  });

  test('two kinds never draw the same tile', () => {
    const shapes = Object.values(WALLS).map((draw) => {
      const ctx = createFakeCtx();
      draw(ctx, WALL_TILE, WALL_TILE);
      return JSON.stringify(ctx.ops);
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});
