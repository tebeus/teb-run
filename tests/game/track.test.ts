import { describe, expect, test } from 'vitest';
import {
  buildTrack,
  CLOSE_SEGMENTS,
  FORK_ZONE_SEGMENTS,
  INTRO_SEGMENTS,
  MAX_HILL_Y,
  MIN_STAGE_SEGMENTS,
  RUMBLE_SEGMENTS,
} from '../../src/game/track';
import { SEGMENT_LENGTH } from '../../src/render/project';
import type { StageDef } from '../../src/types';

const stage = (over: Partial<StageDef> = {}): StageDef => ({
  id: '1-0',
  name: 'Test Stage',
  theme: 'beach',
  lengthSegments: 2320,
  timeLimit: 75,
  seed: 1234,
  difficulty: 0.3,
  ...over,
});

describe('buildTrack: shape', () => {
  test('has exactly lengthSegments segments, for several lengths', () => {
    for (const lengthSegments of [MIN_STAGE_SEGMENTS, 1000, 2320, 2500, 2561]) {
      expect(buildTrack(stage({ lengthSegments })), `${lengthSegments}`).toHaveLength(lengthSegments);
    }
  });

  test('segment indices and world z follow the array position', () => {
    const segs = buildTrack(stage());
    segs.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.p1.world.z).toBe(i * SEGMENT_LENGTH);
      expect(s.p2.world.z).toBe((i + 1) * SEGMENT_LENGTH);
      expect(s.p1.world.x).toBe(0);
    });
  });

  test('the road surface is continuous: each p1.y equals the previous p2.y', () => {
    const segs = buildTrack(stage({ difficulty: 0.9, seed: 42 }));
    expect(segs[0].p1.world.y).toBe(0);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].p1.world.y, `segment ${i}`).toBeCloseTo(segs[i - 1].p2.world.y, 9);
    }
  });

  test('colour alternates every three segments', () => {
    const segs = buildTrack(stage());
    expect(segs[0].dark).toBe(false);
    expect(segs[RUMBLE_SEGMENTS - 1].dark).toBe(false);
    expect(segs[RUMBLE_SEGMENTS].dark).toBe(true);
    expect(segs[RUMBLE_SEGMENTS * 2].dark).toBe(false);
  });

  test('every segment carries the stage theme and starts with no cars', () => {
    const segs = buildTrack(stage({ theme: 'alpine' }));
    for (const s of segs) {
      expect(s.themeId).toBe('alpine');
      expect(s.cars).toEqual([]);
    }
  });
});

describe('buildTrack: opening and closing', () => {
  test('the first 60 segments are straight and flat', () => {
    const segs = buildTrack(stage({ difficulty: 1, seed: 9 }));
    for (let i = 0; i < INTRO_SEGMENTS; i++) {
      expect(segs[i].curve, `curve at ${i}`).toBe(0);
      expect(segs[i].p1.world.y, `p1.y at ${i}`).toBe(0);
      expect(segs[i].p2.world.y, `p2.y at ${i}`).toBe(0);
    }
  });

  test('the last FORK_ZONE_SEGMENTS segments are straight, flat and marked as fork zone', () => {
    const segs = buildTrack(stage({ id: '2-1' }));
    const start = segs.length - FORK_ZONE_SEGMENTS;
    for (let i = start; i < segs.length; i++) {
      expect(segs[i].curve, `curve at ${i}`).toBe(0);
      expect(segs[i].p1.world.y, `p1.y at ${i}`).toBe(0);
      expect(segs[i].p2.world.y, `p2.y at ${i}`).toBe(0);
      expect(segs[i].fork, `fork at ${i}`).toBe('zone');
    }
    expect(segs[start - 1].fork).toBeUndefined();
  });

  test('a level 4 stage has no fork zone marking', () => {
    const segs = buildTrack(stage({ id: '4-3', difficulty: 0.85 }));
    for (const s of segs) expect(s.fork).toBeUndefined();
    const start = segs.length - FORK_ZONE_SEGMENTS;
    for (let i = start; i < segs.length; i++) {
      expect(segs[i].curve, `curve at ${i}`).toBe(0);
      expect(segs[i].p2.world.y, `p2.y at ${i}`).toBe(0);
    }
  });

  test('the track closes with y and curve at zero, for many seeds and difficulties', () => {
    for (const seed of [1, 2, 3, 7, 99, 12345]) {
      for (const difficulty of [0, 0.3, 0.65, 1]) {
        const segs = buildTrack(stage({ seed, difficulty }));
        const last = segs[segs.length - 1];
        expect(last.p2.world.y, `seed ${seed} d ${difficulty}`).toBe(0);
        expect(last.curve, `seed ${seed} d ${difficulty}`).toBe(0);
      }
    }
  });

  test('throws on a stage shorter than intro plus closing plus fork zone', () => {
    expect(() => buildTrack(stage({ lengthSegments: MIN_STAGE_SEGMENTS - 1 }))).toThrow(/too short/i);
    expect(() => buildTrack(stage({ lengthSegments: MIN_STAGE_SEGMENTS }))).not.toThrow();
  });
});

describe('buildTrack: determinism and variety', () => {
  test('the same seed gives the same geometry', () => {
    const a = buildTrack(stage({ seed: 555 }));
    const b = buildTrack(stage({ seed: 555 }));
    expect(a.map((s) => s.curve)).toEqual(b.map((s) => s.curve));
    expect(a.map((s) => s.p2.world.y)).toEqual(b.map((s) => s.p2.world.y));
  });

  test('a different seed gives a different geometry', () => {
    const a = buildTrack(stage({ seed: 1 }));
    const b = buildTrack(stage({ seed: 2 }));
    expect(a.map((s) => s.curve)).not.toEqual(b.map((s) => s.curve));
  });

  test('the middle of the track has curves in both directions and hills', () => {
    // Su sei seed la varietà deve comparire: una sola tappa potrebbe essere piatta.
    const body = [1, 2, 3, 4, 5, 6].flatMap((seed) =>
      buildTrack(stage({ difficulty: 0.6, seed })).slice(INTRO_SEGMENTS, -FORK_ZONE_SEGMENTS),
    );
    expect(body.some((s) => s.curve > 0.5)).toBe(true);
    expect(body.some((s) => s.curve < -0.5)).toBe(true);
    expect(body.some((s) => s.p2.world.y > SEGMENT_LENGTH)).toBe(true);
    expect(body.some((s) => s.curve === 0 && s.p1.world.y === s.p2.world.y)).toBe(true);
  });

  test('harder stages bend more than easy ones', () => {
    const total = (difficulty: number): number =>
      [1, 2, 3, 4].reduce(
        (sum, seed) =>
          sum + buildTrack(stage({ difficulty, seed })).reduce((s, seg) => s + Math.abs(seg.curve), 0),
        0,
      );
    expect(total(0.9)).toBeGreaterThan(total(0.1));
  });

  test('curvature stays inside the hardest curve amount', () => {
    for (const seed of [4, 40, 400]) {
      for (const s of buildTrack(stage({ difficulty: 1, seed }))) {
        expect(Math.abs(s.curve), `seed ${seed} segment ${s.index}`).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('buildTrack: hills stay drivable', () => {
  test('no segment climbs or drops more than its own length', () => {
    for (const seed of [1, 2, 3, 42, 12345]) {
      for (const difficulty of [0, 0.3, 0.65, 1]) {
        for (const s of buildTrack(stage({ seed, difficulty }))) {
          const slope = Math.abs(s.p2.world.y - s.p1.world.y);
          expect(slope, `seed ${seed} d ${difficulty} segment ${s.index}`).toBeLessThanOrEqual(SEGMENT_LENGTH);
        }
      }
    }
  });

  test('the road height never runs away from zero', () => {
    for (const seed of [1, 2, 3, 42, 12345]) {
      for (const difficulty of [0.3, 0.65, 1]) {
        for (const s of buildTrack(stage({ seed, difficulty }))) {
          expect(Math.abs(s.p1.world.y), `seed ${seed} d ${difficulty} segment ${s.index}`)
            .toBeLessThanOrEqual(MAX_HILL_Y);
        }
      }
    }
  });

  test('the closing stretch brings the road down gently', () => {
    const segs = buildTrack(stage({ seed: 7, difficulty: 1 }));
    const closing = segs.slice(segs.length - FORK_ZONE_SEGMENTS - CLOSE_SEGMENTS, segs.length - FORK_ZONE_SEGMENTS);
    expect(closing).toHaveLength(CLOSE_SEGMENTS);
    for (const s of closing) {
      expect(s.curve, `segment ${s.index}`).toBe(0);
      expect(Math.abs(s.p2.world.y - s.p1.world.y), `segment ${s.index}`).toBeLessThanOrEqual(SEGMENT_LENGTH);
    }
    expect(closing[closing.length - 1].p2.world.y).toBe(0);
  });
});
