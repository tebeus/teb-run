import { describe, expect, test } from 'vitest';
import { REAL_GRAPH } from '../../src/game/stages';
import {
  MAP_CURRENT,
  MAP_EDGE,
  MAP_EDGE_ON,
  MAP_NODE_ON,
  ROUTE_LEVELS,
  drawRouteMap,
  nodeCentre,
  visitedStages,
} from '../../src/render/routeMap';
import { createRecordCtx } from '../helpers/recordCtx';

/** I 16 percorsi completi, come nel test della taratura. */
function allRoutes(): ('L' | 'R')[][] {
  const routes: ('L' | 'R')[][] = [];
  for (let bits = 0; bits < 16; bits++) {
    routes.push([0, 1, 2, 3].map((i) => (((bits >> i) & 1) === 1 ? 'R' : 'L')));
  }
  return routes;
}

describe('visitedStages (spec §11)', () => {
  test('an empty route is just the first stage', () => {
    expect(visitedStages([])).toEqual(['0-0']);
  });

  test('left keeps the index, right adds one', () => {
    expect(visitedStages(['L'])).toEqual(['0-0', '1-0']);
    expect(visitedStages(['R'])).toEqual(['0-0', '1-1']);
    expect(visitedStages(['R', 'R'])).toEqual(['0-0', '1-1', '2-2']);
    expect(visitedStages(['L', 'R', 'L', 'R'])).toEqual(['0-0', '1-0', '2-1', '3-1', '4-2']);
  });

  test('every one of the 16 routes gives five valid stages', () => {
    for (const route of allRoutes()) {
      const visited = visitedStages(route);
      expect(visited, route.join('')).toHaveLength(ROUTE_LEVELS);
      visited.forEach((id, level) => {
        const [l, i] = id.split('-').map(Number);
        expect(l, id).toBe(level);
        expect(i, id).toBeGreaterThanOrEqual(0);
        expect(i, id).toBeLessThanOrEqual(level);
      });
    }
  });

  test('the walk agrees with the real stage graph', () => {
    for (const route of allRoutes()) {
      const visited = visitedStages(route);
      let stage = REAL_GRAPH.first();
      expect(stage.id).toBe(visited[0]);
      route.forEach((side, i) => {
        const next = REAL_GRAPH.next(stage, side);
        expect(next, `${route.join('')} at ${i}`).not.toBeNull();
        stage = next as typeof stage;
        expect(stage.id).toBe(visited[i + 1]);
      });
    }
  });

  test('a route longer than the grid stops at the last level', () => {
    expect(visitedStages(['L', 'L', 'L', 'L', 'L', 'L'])).toEqual(['0-0', '1-0', '2-0', '3-0', '4-0']);
  });
});

describe('nodeCentre', () => {
  test('level 0 is at the bottom and level 4 at the top', () => {
    const bottom = nodeCentre(0, 0, 0, 0, 200, 100);
    const top = nodeCentre(4, 0, 0, 0, 200, 100);
    expect(bottom.cy).toBeGreaterThan(top.cy);
    expect(bottom.cy).toBeLessThanOrEqual(100);
    expect(top.cy).toBeGreaterThanOrEqual(0);
  });

  test('the row of a level is centred on the box', () => {
    const left = nodeCentre(4, 0, 0, 0, 200, 100);
    const right = nodeCentre(4, 4, 0, 0, 200, 100);
    expect((left.cx + right.cx) / 2).toBeCloseTo(100, 6);
    expect(nodeCentre(0, 0, 0, 0, 200, 100).cx).toBeCloseTo(100, 6);
  });

  test('a higher index sits further right, by a constant step', () => {
    const a = nodeCentre(3, 0, 0, 0, 200, 100);
    const b = nodeCentre(3, 1, 0, 0, 200, 100);
    const c = nodeCentre(3, 2, 0, 0, 200, 100);
    expect(b.cx - a.cx).toBeCloseTo(c.cx - b.cx, 6);
    expect(b.cx).toBeGreaterThan(a.cx);
  });

  test('the box offset moves every node with it', () => {
    const here = nodeCentre(2, 1, 0, 0, 200, 100);
    const moved = nodeCentre(2, 1, 40, 25, 200, 100);
    expect(moved.cx - here.cx).toBeCloseTo(40, 9);
    expect(moved.cy - here.cy).toBeCloseTo(25, 9);
  });
});

describe('drawRouteMap (spec §11)', () => {
  const box = { x: 20, y: 30, w: 240, h: 150 };
  const draw = (visited: string[], current: string) => {
    const rec = createRecordCtx();
    drawRouteMap(rec.ctx, box.x, box.y, box.w, box.h, visited, current);
    return rec;
  };

  test('it draws the fifteen nodes plus one highlight per visited stage', () => {
    const visited = visitedStages(['L', 'R', 'L', 'R']);
    const rec = draw(visited, '4-2');
    const circles = rec.ops.filter((op) => op.type === 'arc');
    // 15 nodi del triangolo, 5 evidenziati, 1 anello sulla tappa corrente.
    expect(circles).toHaveLength(15 + visited.length + 1);
  });

  test('it draws the twenty edges of the grid plus the four of the route', () => {
    const visited = visitedStages(['L', 'R', 'L', 'R']);
    const rec = draw(visited, '4-2');
    // 2 + 4 + 6 + 8 archi del triangolo, più uno per ogni salto del percorso.
    expect(rec.ops.filter((op) => op.type === 'moveTo')).toHaveLength(20 + visited.length - 1);
  });

  test('the route is drawn in the highlight colour, the grid in the dim one', () => {
    const rec = draw(visitedStages(['R', 'R', 'R', 'R']), '4-4');
    const strokes = rec.ops.filter((op) => op.type === 'stroke').map((op) => op.fill);
    expect(strokes).toContain(MAP_EDGE);
    expect(strokes).toContain(MAP_EDGE_ON);
    const fills = rec.ops.filter((op) => op.type === 'fill').map((op) => op.fill);
    expect(fills).toContain(MAP_NODE_ON);
    expect(fills).toContain(MAP_CURRENT);
  });

  test('an empty route still draws the grid and the first stage', () => {
    const rec = draw(visitedStages([]), '0-0');
    expect(rec.ops.filter((op) => op.type === 'arc')).toHaveLength(15 + 1 + 1);
  });

  test('a current stage outside the route is simply not marked', () => {
    const rec = draw(visitedStages(['L']), 'nope');
    expect(rec.ops.filter((op) => op.type === 'arc')).toHaveLength(15 + 2);
    expect(rec.ops.some((op) => op.fill === MAP_CURRENT)).toBe(false);
  });

  test('everything stays inside the box it was given', () => {
    const rec = draw(visitedStages(['L', 'L', 'L', 'L']), '4-0');
    for (const op of rec.ops) {
      if (op.type !== 'arc' && op.type !== 'moveTo' && op.type !== 'lineTo') continue;
      const r = op.type === 'arc' ? op.args[2] : 0;
      expect(op.args[0] - r).toBeGreaterThanOrEqual(box.x - 0.001);
      expect(op.args[0] + r).toBeLessThanOrEqual(box.x + box.w + 0.001);
      expect(op.args[1] - r).toBeGreaterThanOrEqual(box.y - 0.001);
      expect(op.args[1] + r).toBeLessThanOrEqual(box.y + box.h + 0.001);
    }
  });

  test('a degenerate box draws nothing and does not throw', () => {
    const rec = createRecordCtx();
    expect(() => drawRouteMap(rec.ctx, 0, 0, 0, 0, ['0-0'], '0-0')).not.toThrow();
    expect(rec.ops).toHaveLength(0);
  });
});
