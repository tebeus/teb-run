import { describe, expect, test } from 'vitest';
import { dailyGraph } from '../../src/game/daily';
import { modeGraph, withMode } from '../../src/game/mode';
import { REAL_GRAPH, stageById } from '../../src/game/stages';
import {
  carryAfterCheckpoint,
  CARRY_FIRST_STAGE_EXTRA,
  FIRST_STAGE_EXTRA_S,
  graceOf,
  STAGE_TIME_LIMITS,
  STAGE_TIME_LIMITS_HARD,
} from '../../src/game/timer';
import { driveRouteExpert } from '../helpers/expert-driver';
import { launchGraph } from '../helpers/beginner-driver';

/**
 * La 0-0 di NORMAL a 110 s (spec prima tappa e ritorno §3.2, risposte di Teb
 * §9): 30 s in più per chi non sa ancora guidare, che con
 * `CARRY_FIRST_STAGE_EXTRA` falso non si riportano alla 1-0.
 */
describe('0-0 NORMAL: 110 s, 30 dei quali solo per la prima tappa', () => {
  test('the table: 110 s in NORMAL, HARD unchanged at 75', () => {
    expect(STAGE_TIME_LIMITS['0-0']).toBe(110);
    expect(FIRST_STAGE_EXTRA_S).toBe(30);
    expect(STAGE_TIME_LIMITS_HARD['0-0']).toBe(75);
    expect(stageById('0-0').timeLimit).toBe(110);
    expect(withMode(stageById('0-0'), 'hard').timeLimit).toBe(75);
  });

  test('the one switch is off by default: the extra seconds are not carried', () => {
    expect(CARRY_FIRST_STAGE_EXTRA).toBe(false);
    expect(stageById('0-0').carryGrace).toBe(30);
    expect(graceOf(stageById('0-0'))).toBe(30);
  });

  test('only the 0-0, only in NORMAL: no grace in HARD, in the other stages, in a HARD daily', () => {
    expect(graceOf(withMode(stageById('0-0'), 'hard'))).toBe(0);
    for (const id of ['1-0', '1-1', '2-1', '4-4']) expect(graceOf(stageById(id)), id).toBe(0);
    expect(graceOf(modeGraph(REAL_GRAPH, 'hard').first())).toBe(0);
    expect(graceOf(dailyGraph(REAL_GRAPH, 7).first())).toBe(30);
    expect(graceOf(dailyGraph(modeGraph(REAL_GRAPH, 'hard'), 7).first())).toBe(0);
  });

  test('carryAfterCheckpoint: the time left minus the grace, never below zero', () => {
    expect(carryAfterCheckpoint(39.5, 30)).toBeCloseTo(9.5, 9);
    expect(carryAfterCheckpoint(12, 30)).toBe(0);
    expect(carryAfterCheckpoint(-1, 30)).toBe(0);
    expect(carryAfterCheckpoint(9.5, 0)).toBe(9.5);
  });

  test('the expert plays the same game as at launch: same margins after the 0-0, same score', () => {
    const now = driveRouteExpert(['R', 'L', 'R', 'L']);
    const launch = driveRouteExpert(['R', 'L', 'R', 'L'], { graph: launchGraph() });
    expect(now.finished).toBe(true);
    expect(now.margins[0].margin - launch.margins[0].margin).toBeCloseTo(30, 6);
    // Uguali a meno della virgola mobile: 39,5 − 30 non è esattamente 9,5.
    expect(now.margins.map((m) => m.id)).toEqual(launch.margins.map((m) => m.id));
    now.margins.slice(1).forEach((m, i) => expect(m.margin, m.id).toBeCloseTo(launch.margins[i + 1].margin, 6));
    expect(now.score).toBe(launch.score);
  }, 30000);
});
