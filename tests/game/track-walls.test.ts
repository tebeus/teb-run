import { describe, expect, test } from 'vitest';
import { MAX_SPEED, initialPlayer } from '../../src/game/player';
import { STAGE_LIST } from '../../src/game/stages';
import {
  CURVE_WALL_MIN,
  DETAIL_NAMES,
  DETAIL_OFFSET_MAX,
  DETAIL_OFFSET_MIN,
  FORK_ZONE_SEGMENTS,
  INTRO_SEGMENTS,
  THEME_WALLS,
  WALL_RUN_MAX,
  WALL_RUN_MIN,
  WATER_THEMES,
  WATER_WALLS,
  buildTrack,
} from '../../src/game/track';
import { wallCollision } from '../../src/game/wall-hit';
import type { PlayerState, Segment, StageDef, WallKind } from '../../src/types';

const byId = (id: string): StageDef => {
  const stage = STAGE_LIST.find((s) => s.id === id);
  if (!stage) throw new Error(`no stage ${id}`);
  return stage;
};

/** Tratti massimali di parete su un lato: [inizio, fine escluso, tipo]. */
function runs(segs: readonly Segment[], side: 'left' | 'right'): [number, number, WallKind][] {
  const out: [number, number, WallKind][] = [];
  let start = -1;
  let kind: WallKind | undefined;
  for (let i = 0; i <= segs.length; i++) {
    const here = i < segs.length ? segs[i].wall?.[side] : undefined;
    if (here !== kind) {
      if (kind !== undefined && start >= 0) out.push([start, i, kind]);
      start = here === undefined ? -1 : i;
      kind = here;
    }
  }
  return out;
}

describe('placeWalls (spec §4.4c)', () => {
  test('every stage gets at least one wall run', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const total = runs(segs, 'left').length + runs(segs, 'right').length;
      expect(total, stage.id).toBeGreaterThan(0);
    }
  });

  test('no wall in the intro straight or in the fork zone', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (let i = 0; i < INTRO_SEGMENTS; i++) {
        expect(segs[i].wall, `${stage.id} intro ${i}`).toBeUndefined();
      }
      for (let i = zoneStart; i < segs.length; i++) {
        expect(segs[i].wall, `${stage.id} fork ${i}`).toBeUndefined();
      }
    }
  });

  test('every run is between 80 and 400 segments long', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (const side of ['left', 'right'] as const) {
        for (const [from, to] of runs(segs, side)) {
          expect(to - from, `${stage.id} ${side} ${from}`).toBeGreaterThanOrEqual(WALL_RUN_MIN);
          expect(to - from, `${stage.id} ${side} ${from}`).toBeLessThanOrEqual(WALL_RUN_MAX);
        }
      }
    }
  });

  test('every kind belongs to the theme (spec §4.4c)', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (const side of ['left', 'right'] as const) {
        for (const [, , kind] of runs(segs, side)) {
          expect(THEME_WALLS[stage.theme], `${stage.id} ${kind}`).toContain(kind);
        }
      }
    }
  });

  test('in the desert a run starts on a curve', () => {
    for (const stage of STAGE_LIST.filter((s) => s.theme === 'desert')) {
      const segs = buildTrack(stage);
      for (const side of ['left', 'right'] as const) {
        for (const [from] of runs(segs, side)) {
          expect(Math.abs(segs[from].curve), `${stage.id} ${from}`).toBeGreaterThanOrEqual(CURVE_WALL_MIN);
        }
      }
    }
  });

  test('no building stands in the water', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (const seg of segs) {
        if (!seg.water) continue;
        const kind = seg.wall?.[seg.water];
        if (kind === undefined) continue;
        expect(WATER_WALLS, `${stage.id} ${kind} on water`).toContain(kind);
      }
    }
  });

  test('on the real tracks, driving the outer lane asphalt of a dual carriageway never hits a wall (C1)', () => {
    const fast = (x: number): PlayerState => ({ ...initialPlayer(), x, speed: MAX_SPEED * 0.5 });
    let dualWalled = 0;
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (const seg of segs) {
        if (seg.wall === undefined || seg.roadHalf <= 1) continue;
        dualWalled++;
        // Campiona tutta la carreggiata, dal centro al bordo dell'asfalto,
        // su entrambi i lati: la parete non deve mai scattare qui.
        for (const x of [0, seg.roadHalf * 0.5, seg.roadHalf * 0.99, -seg.roadHalf * 0.5, -seg.roadHalf * 0.99]) {
          expect(
            wallCollision(fast(x), seg),
            `${stage.id} seg ${seg.index} x ${x} roadHalf ${seg.roadHalf}`,
          ).toBeNull();
        }
      }
    }
    // Conferma che il caso sia davvero esercitato (dualRoad con pareti).
    expect(dualWalled).toBeGreaterThan(0);
  });
});

describe('placeWater (spec §4.4c)', () => {
  test('only the beach and the town have water', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const wet = segs.filter((seg) => seg.water !== undefined).length;
      if (WATER_THEMES.includes(stage.theme)) {
        expect(wet, stage.id).toBeGreaterThan(0);
      } else {
        expect(wet, stage.id).toBe(0);
      }
    }
  });

  test('the water never reaches the fork zone or the start', () => {
    for (const stage of STAGE_LIST.filter((s) => WATER_THEMES.includes(s.theme))) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (let i = 0; i < segs.length; i++) {
        if (i >= INTRO_SEGMENTS && i < zoneStart) continue;
        expect(segs[i].water, `${stage.id} at ${i}`).toBeUndefined();
      }
    }
  });

  test('the water is on one side only, per segment', () => {
    const segs = buildTrack(byId('0-0'));
    for (const seg of segs) {
      if (seg.water === undefined) continue;
      expect(['left', 'right']).toContain(seg.water);
    }
  });
});

describe('placeGroundDetails (spec §4.4a)', () => {
  test('there is a detail every 4 to 8 segments, outside the fork zone', () => {
    const segs = buildTrack(byId('2-1'));
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    const at: number[] = [];
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].sprites.some((p) => DETAIL_NAMES.includes(p.name))) at.push(i);
    }
    expect(at.length).toBeGreaterThan(100);
    expect(at[0]).toBeGreaterThanOrEqual(INTRO_SEGMENTS);
    expect(at[at.length - 1]).toBeLessThan(zoneStart);
    for (let k = 1; k < at.length; k++) {
      const gap = at[k] - at[k - 1];
      expect(gap, `gap at ${at[k]}`).toBeGreaterThanOrEqual(4);
      expect(gap, `gap at ${at[k]}`).toBeLessThanOrEqual(8);
    }
  });

  test('the details sit inside the roadside envelope, on both sides', () => {
    const segs = buildTrack(byId('2-1'));
    const sides = new Set<number>();
    for (const seg of segs) {
      for (const placed of seg.sprites) {
        if (!DETAIL_NAMES.includes(placed.name)) continue;
        const a = Math.abs(placed.offset);
        expect(a).toBeGreaterThanOrEqual(DETAIL_OFFSET_MIN);
        expect(a).toBeLessThanOrEqual(DETAIL_OFFSET_MAX);
        sides.add(Math.sign(placed.offset));
      }
    }
    expect(sides.has(-1)).toBe(true);
    expect(sides.has(1)).toBe(true);
  });

  test('all three detail names are used somewhere', () => {
    const used = new Set<string>();
    for (const stage of STAGE_LIST) {
      for (const seg of buildTrack(stage)) {
        for (const placed of seg.sprites) {
          if (DETAIL_NAMES.includes(placed.name)) used.add(placed.name);
        }
      }
    }
    expect([...used].sort()).toEqual([...DETAIL_NAMES].sort());
  });
});

describe('determinismo (spec §9)', () => {
  test('the same seed gives the same walls, water and details', () => {
    for (const stage of STAGE_LIST) {
      const a = buildTrack(stage);
      const b = buildTrack(stage);
      const shape = (segs: Segment[]): string =>
        segs
          .map((s) => `${s.wall?.left ?? ''}|${s.wall?.right ?? ''}|${s.water ?? ''}|${s.sprites.map((p) => `${p.name}@${p.offset}`).join(',')}`)
          .join(';');
      expect(shape(b), stage.id).toBe(shape(a));
    }
  });
});
