import { describe, expect, test } from 'vitest';
import { MAX_SPEED, initialPlayer } from '../../src/game/player';
import { forkOffset } from '../../src/game/track';
import { SCENERY_CRASH_MIN_PERCENT } from '../../src/game/traffic';
import { WALL_COLLIDE_W, wallCollision } from '../../src/game/wall-hit';
import { WALL_BASE_OFFSET } from '../../src/render/walls';
import type { PlayerState, Segment } from '../../src/types';
import { makeSegment } from '../helpers/segments';

const player = (over: Partial<PlayerState> = {}): PlayerState => ({ ...initialPlayer(), ...over });
const walled = (over: Partial<Segment> = {}): Segment =>
  makeSegment(5, { wall: { left: 'rock_red', right: 'rock_red' }, ...over });

describe('wallCollision (spec §6, regola dello sprite solido)', () => {
  test('the hit box is 0.1 wide at the base (spec §4.4c)', () => {
    expect(WALL_COLLIDE_W).toBe(0.1);
  });

  test('a segment with no wall never collides', () => {
    expect(wallCollision(player({ x: WALL_BASE_OFFSET }), makeSegment(5))).toBeNull();
  });

  test('driving on the asphalt never touches a wall', () => {
    for (const x of [0, 0.9, -0.9, 1, -1]) {
      expect(wallCollision(player({ x }), walled()), `x ${x}`).toBeNull();
    }
  });

  test('the shoulder is still free: the wall starts past it', () => {
    expect(wallCollision(player({ x: 1.2 }), walled())).toBeNull();
    expect(wallCollision(player({ x: -1.2 }), walled())).toBeNull();
  });

  test('past the shoulder the wall is there, on both sides', () => {
    const fast = player({ x: 1.45, speed: MAX_SPEED * 0.5 });
    expect(wallCollision(fast, walled())?.kind).toBe('crash');
    expect(wallCollision({ ...fast, x: -1.45 }, walled())?.kind).toBe('crash');
  });

  test('only the marked side collides', () => {
    const seg = walled({ wall: { right: 'guardrail' } });
    expect(wallCollision(player({ x: 1.45, speed: MAX_SPEED * 0.5 }), seg)?.kind).toBe('crash');
    expect(wallCollision(player({ x: -1.45, speed: MAX_SPEED * 0.5 }), seg)).toBeNull();
  });

  test('below 15 per cent it stops and pushes back towards the road', () => {
    const slow = player({ x: 1.45, speed: MAX_SPEED * (SCENERY_CRASH_MIN_PERCENT - 0.01) });
    const hit = wallCollision(slow, walled());
    expect(hit?.kind).toBe('stop');
    expect(hit?.speed).toBe(0);
    expect(hit?.x).toBeLessThan(1.45);
    expect(hit?.side).toBe(1);
  });

  test('the push never sends the car across the road', () => {
    const hit = wallCollision(player({ x: -1.45, speed: 10 }), walled());
    expect(hit?.kind).toBe('stop');
    expect(hit?.x).toBeGreaterThan(-1.45);
    expect(hit?.x).toBeLessThan(0);
  });

  test('the crash keeps the speed and the z, like a solid sprite', () => {
    const fast = player({ x: 1.5, speed: MAX_SPEED * 0.8, z: 1234 });
    const hit = wallCollision(fast, walled());
    expect(hit).toEqual({ kind: 'crash', speed: MAX_SPEED * 0.8, z: 1234, x: 1.5, side: 0 });
  });

  test('on a dual carriageway the outer lane asphalt never touches the wall (C1)', () => {
    const seg = walled({ roadHalf: 2.4 });
    const onAsphalt = player({ x: 1.5, speed: MAX_SPEED * 0.5 });
    expect(wallCollision(onAsphalt, seg)).toBeNull();
    expect(wallCollision({ ...onAsphalt, x: -1.5 }, seg)).toBeNull();
    const off = forkOffset(WALL_BASE_OFFSET, 2.4);
    const atWall = player({ x: off, speed: MAX_SPEED * 0.5 });
    expect(wallCollision(atWall, seg)?.kind).toBe('crash');
  });

  test('no wall on the discarded side of a fork exit segment (terzo addendum del collaudo)', () => {
    // side: 1 scelto -> il lato scartato è negativo (-1, la parete "left"),
    // con la strada scartata vicina (entro `FORK_EXIT_REACH`).
    const seg = walled({ forkExit: { side: 1, t: 0.3 }, discarded: { near: -4, far: -4, halfNear: 1, halfFar: 1 } });
    expect(wallCollision(player({ x: -1.45, speed: MAX_SPEED * 0.5 }), seg)).toBeNull();
    // La parete sull'altra carreggiata (destra, quella scelta) resta.
    expect(wallCollision(player({ x: 1.45, speed: MAX_SPEED * 0.5 }), seg)?.kind).toBe('crash');
  });

  test('the wall stays when the discarded road is far (bivio v3: the exit starts more than FORK_EXIT_REACH away)', () => {
    const seg = walled({ forkExit: { side: 1, t: 0 }, discarded: { near: -30, far: -30, halfNear: 1, halfFar: 1 } });
    expect(wallCollision(player({ x: -1.45, speed: MAX_SPEED * 0.5 }), seg)?.kind).toBe('crash');
  });
});
