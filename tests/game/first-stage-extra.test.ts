import { describe, expect, test } from 'vitest';
import { dailyGraph } from '../../src/game/daily';
import { modeGraph, withMode } from '../../src/game/mode';
import { REAL_GRAPH, stageById } from '../../src/game/stages';
import {
  carryAfterCheckpoint,
  extraOf,
  FIRST_STAGE_EXTRA_CARRY_S,
  FIRST_STAGE_EXTRA_S,
  NO_EXTRA_TIME,
  STAGE_TIME_LIMITS,
  STAGE_TIME_LIMITS_HARD,
} from '../../src/game/timer';
import { carryAfterCheckpoint as workerCarry } from '../../src/shared/validate';
import { driveRouteExpert } from '../helpers/expert-driver';
import { launchGraph } from '../helpers/beginner-driver';

/**
 * La 0-0 di NORMAL a 110 s (spec prima tappa e ritorno §3.2): 30 s in più
 * per chi non sa ancora guidare. Se ne riportano i primi
 * `FIRST_STAGE_EXTRA_CARRY_S` rimasti, più tutto quello oltre i 30 (spec
 * telefono e finali §0, decisione di Teb: X = 15).
 */
describe('0-0 NORMAL: 110 s, 15 dei 30 in più riportabili', () => {
  test('the table: 110 s in NORMAL, HARD unchanged at 75', () => {
    expect(STAGE_TIME_LIMITS['0-0']).toBe(110);
    expect(FIRST_STAGE_EXTRA_S).toBe(30);
    expect(STAGE_TIME_LIMITS_HARD['0-0']).toBe(75);
    expect(stageById('0-0').timeLimit).toBe(110);
    expect(withMode(stageById('0-0'), 'hard').timeLimit).toBe(75);
  });

  test('the one number: 15 of the 30 extra seconds carry, and it stays between 0 and 30', () => {
    expect(FIRST_STAGE_EXTRA_CARRY_S).toBe(15);
    expect(FIRST_STAGE_EXTRA_CARRY_S).toBeGreaterThanOrEqual(0);
    expect(FIRST_STAGE_EXTRA_CARRY_S).toBeLessThanOrEqual(FIRST_STAGE_EXTRA_S);
    expect(extraOf(stageById('0-0'))).toEqual({ seconds: 30, carried: 15 });
  });

  test('only the 0-0, only in NORMAL: nothing extra in HARD, in the other stages, in a HARD daily', () => {
    expect(extraOf(withMode(stageById('0-0'), 'hard'))).toEqual(NO_EXTRA_TIME);
    for (const id of ['1-0', '1-1', '2-1', '4-4']) expect(extraOf(stageById(id)), id).toEqual(NO_EXTRA_TIME);
    expect(extraOf(modeGraph(REAL_GRAPH, 'hard').first())).toEqual(NO_EXTRA_TIME);
    expect(extraOf(dailyGraph(REAL_GRAPH, 7).first())).toEqual({ seconds: 30, carried: 15 });
    expect(extraOf(dailyGraph(modeGraph(REAL_GRAPH, 'hard'), 7).first())).toEqual(NO_EXTRA_TIME);
  });

  test('carryAfterCheckpoint: the first 15 seconds left, plus all beyond 30, never below zero', () => {
    const extra = { seconds: 30, carried: 15 };
    expect(carryAfterCheckpoint(-1, extra)).toBe(0);
    expect(carryAfterCheckpoint(0, extra)).toBe(0);
    expect(carryAfterCheckpoint(5, extra)).toBe(5);
    expect(carryAfterCheckpoint(12, extra)).toBe(12);
    expect(carryAfterCheckpoint(20, extra)).toBe(15);
    expect(carryAfterCheckpoint(30, extra)).toBe(15);
    expect(carryAfterCheckpoint(39.5, extra)).toBeCloseTo(24.5, 9);
    // Senza secondi in più è il tempo rimasto; 30 su 30 li riporta tutti, 0 nessuno.
    expect(carryAfterCheckpoint(9.5, NO_EXTRA_TIME)).toBe(9.5);
    expect(carryAfterCheckpoint(39.5, { seconds: 30, carried: 30 })).toBe(39.5);
    expect(carryAfterCheckpoint(39.5, { seconds: 30, carried: 0 })).toBeCloseTo(9.5, 9);
    expect(carryAfterCheckpoint(20, { seconds: 30, carried: 0 })).toBe(0);
  });

  test('the Worker carries exactly as the game does', () => {
    for (const extra of [NO_EXTRA_TIME, { seconds: 30, carried: 15 }, { seconds: 30, carried: 0 }, { seconds: 30, carried: 30 }]) {
      for (let left = -2; left <= 60; left += 0.25) expect(workerCarry(left, extra)).toBe(carryAfterCheckpoint(left, extra));
    }
  });

  test('the expert reaches the 1-0 with 15 s more than at launch, and the rest of the game shifts by those 15', () => {
    const now = driveRouteExpert(['R', 'L', 'R', 'L']);
    const launch = driveRouteExpert(['R', 'L', 'R', 'L'], { graph: launchGraph() });
    expect(now.finished).toBe(true);
    expect(now.margins[0].margin - launch.margins[0].margin).toBeCloseTo(30, 6);
    expect(now.margins.map((m) => m.id)).toEqual(launch.margins.map((m) => m.id));
    now.margins.slice(1).forEach((m, i) => expect(m.margin, m.id).toBeCloseTo(launch.margins[i + 1].margin + 15, 6));
    expect(now.score).toBeGreaterThan(launch.score);
  }, 30000);
});
