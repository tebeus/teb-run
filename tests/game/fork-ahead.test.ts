// Il bivio evidente (spec prima tappa e ritorno §4): `CHOOSE YOUR ROAD` con
// le due tappe negli ultimi FORK_AHEAD_SEGMENTS segmenti prima della zona,
// il banner del bivio come prima nella zona, e per FORK_TAKEN_S dopo il
// commit il lato preso. Nessun cambio al tracciato né al commit.

import { describe, expect, test } from 'vitest';
import { createFullRace, currentBanner, FORK_AHEAD_SEGMENTS, FORK_TAKEN_S } from '../../src/game/race';
import { REAL_GRAPH, stageById } from '../../src/game/stages';
import { buildTrack, FORK_COMMIT, FORK_ZONE_SEGMENTS } from '../../src/game/track';
import { SEGMENT_LENGTH } from '../../src/render/project';
import type { RaceSnapshot, StageDef } from '../../src/types';
import { DRIVER_DT, prudentActions, stubAssets, type DriverState } from '../helpers/prudent-driver';

interface Sample {
  seg: number;
  banner: RaceSnapshot['banner'];
  names?: [string, string];
  taken?: 'L' | 'R';
  t: number;
}

/** Guida una tappa col pilota prudente sul lato `side` e registra banner e segmento a ogni tick. */
function sampleStage(start: StageDef, side: 'L' | 'R'): { samples: Sample[]; length: number } {
  const engine = createFullRace({ graph: REAL_GRAPH, assets: stubAssets(), skipCountdown: true, startStage: { ...start, timeLimit: 999 } });
  const state: DriverState = { shifted: false };
  const samples: Sample[] = [];
  const length = buildTrack(start).length;
  let t = 0;
  for (let i = 0; i < 20000; i++) {
    const s = engine.snapshot();
    if (s.stage.id !== start.id) break;
    samples.push({ seg: s.player.z / SEGMENT_LENGTH, banner: s.banner, names: s.forkNames, taken: s.forkTaken, t });
    const events = engine.update(DRIVER_DT, prudentActions(s, state, side));
    t += DRIVER_DT;
    if (events.some((e) => e.type === 'gameover' || e.type === 'finish')) break;
  }
  return { samples, length };
}

describe('currentBanner', () => {
  test('priority: game over, checkpoint, fork, the sign before the fork, nothing', () => {
    const base = { expired: false, checkpointLeft: 0, inForkZone: false, forkAhead: false };
    expect(currentBanner(base)).toBe('none');
    expect(currentBanner({ ...base, forkAhead: true })).toBe('forkAhead');
    expect(currentBanner({ ...base, forkAhead: true, inForkZone: true })).toBe('fork');
    expect(currentBanner({ ...base, forkAhead: true, inForkZone: true, checkpointLeft: 1 })).toBe('checkpoint');
    expect(currentBanner({ ...base, forkAhead: true, inForkZone: true, checkpointLeft: 1, expired: true })).toBe('gameover');
  });
});

describe('the sign before the fork, in a real race', () => {
  for (const side of ['L', 'R'] as const) {
    test(`0-0, going ${side}: CHOOSE YOUR ROAD only in the ${FORK_AHEAD_SEGMENTS} segments before the zone, then the fork, then the side taken`, () => {
      const { samples, length } = sampleStage(REAL_GRAPH.first(), side);
      const zone = length - FORK_ZONE_SEGMENTS;
      const ahead = samples.filter((s) => s.banner === 'forkAhead');
      expect(ahead.length).toBeGreaterThan(0);
      for (const s of ahead) {
        expect(s.seg).toBeGreaterThanOrEqual(zone - FORK_AHEAD_SEGMENTS);
        expect(s.seg).toBeLessThan(zone + 1);
        expect(s.names).toEqual([stageById('1-0').name, stageById('1-1').name]);
      }
      // Prima del cartello niente, e il cartello comincia al segmento giusto.
      expect(samples.filter((s) => s.seg < zone - FORK_AHEAD_SEGMENTS - 1).every((s) => s.banner === 'none')).toBe(true);
      expect(Math.min(...ahead.map((s) => s.seg))).toBeLessThan(zone - FORK_AHEAD_SEGMENTS + 2);
      // Nella zona, il banner del bivio come prima.
      const fork = samples.filter((s) => s.banner === 'fork');
      expect(Math.min(...fork.map((s) => s.seg))).toBeGreaterThanOrEqual(zone);
      // Il lato preso: dopo il commit, per FORK_TAKEN_S, solo il lato giusto.
      const taken = samples.filter((s) => s.taken !== undefined);
      expect(taken.length).toBeGreaterThan(0);
      expect(taken.every((s) => s.taken === side && s.banner === 'fork')).toBe(true);
      expect(Math.min(...taken.map((s) => s.seg))).toBeGreaterThanOrEqual(zone + FORK_COMMIT - 1);
      const span = Math.max(...taken.map((s) => s.t)) - Math.min(...taken.map((s) => s.t));
      expect(span).toBeLessThanOrEqual(FORK_TAKEN_S + 1e-9);
      expect(span).toBeGreaterThan(FORK_TAKEN_S - 3 * DRIVER_DT);
    }, 30000);
  }

  test('the last stage has no fork and no sign', () => {
    const { samples } = sampleStage(stageById('4-2'), 'R');
    expect(samples.length).toBeGreaterThan(100);
    expect(samples.some((s) => s.banner === 'forkAhead' || s.banner === 'fork' || s.taken !== undefined)).toBe(false);
  }, 30000);
});
