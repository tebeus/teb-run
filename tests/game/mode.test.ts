import { describe, expect, test } from 'vitest';
import {
  DEFAULT_MODE,
  modeFromSearch,
  modeGraph,
  modeLabel,
  modeOf,
  nextMode,
  parseMode,
  TRAFFIC_COUNT_FACTOR,
  TRAFFIC_SPEED_FACTOR,
  withMode,
} from '../../src/game/mode';
import { MAX_SPEED } from '../../src/game/player';
import { REAL_GRAPH, STAGE_LIST, STAGE_SPECS, stageById } from '../../src/game/stages';
import { STAGE_TIME_LIMITS, STAGE_TIME_LIMITS_HARD } from '../../src/game/timer';
import { SPEED_JITTER, TRAFFIC_SPEEDS } from '../../src/game/traffic';

describe('modalità di gioco (collaudo utente: due livelli di difficoltà)', () => {
  test('NORMAL is the default, and only normal and hard are read', () => {
    expect(DEFAULT_MODE).toBe('normal');
    expect(parseMode('normal')).toBe('normal');
    expect(parseMode('hard')).toBe('hard');
    for (const bad of ['HARD', 'easy', '', null, undefined]) expect(parseMode(bad)).toBeNull();
  });

  test('?mode= is read from the query string', () => {
    expect(modeFromSearch('?mode=hard')).toBe('hard');
    expect(modeFromSearch('?car=retro&mode=normal')).toBe('normal');
    expect(modeFromSearch('?mode=insane')).toBeNull();
    expect(modeFromSearch('')).toBeNull();
  });

  test('D goes round normal, hard, normal', () => {
    expect(nextMode('normal')).toBe('hard');
    expect(nextMode('hard')).toBe('normal');
  });

  test('the label is the one the radio and the HUD write', () => {
    expect(modeLabel('normal')).toBe('MODE: NORMAL');
    expect(modeLabel('hard')).toBe('MODE: HARD');
  });

  test('HARD has 1.6 times the traffic, 10 per cent faster, still slower than the player', () => {
    expect(TRAFFIC_COUNT_FACTOR).toEqual({ normal: 1, hard: 1.6 });
    expect(TRAFFIC_SPEED_FACTOR).toEqual({ normal: 1, hard: 1.1 });
    const fastest = Math.max(...Object.values(TRAFFIC_SPEEDS));
    expect(MAX_SPEED * fastest * TRAFFIC_SPEED_FACTOR.hard * (1 + SPEED_JITTER)).toBeLessThan(0.7 * MAX_SPEED);
  });

  test('NORMAL leaves a stage as it is: same object, same time as the table', () => {
    for (const stage of STAGE_LIST) {
      expect(withMode(stage, 'normal')).toBe(stage);
      expect(modeOf(stage)).toBe('normal');
      expect(stage.timeLimit).toBe(STAGE_TIME_LIMITS[stage.id]);
    }
  });

  test('HARD marks the stage and gives it its own time', () => {
    expect(Object.keys(STAGE_TIME_LIMITS_HARD).sort()).toEqual(STAGE_SPECS.map((s) => s.id).sort());
    for (const stage of STAGE_LIST) {
      const hard = withMode(stage, 'hard');
      expect(modeOf(hard)).toBe('hard');
      expect(hard.timeLimit, stage.id).toBe(STAGE_TIME_LIMITS_HARD[stage.id]);
      expect(Number.isInteger(hard.timeLimit)).toBe(true);
      expect({ ...hard, mode: undefined, timeLimit: stage.timeLimit }).toEqual({ ...stage, mode: undefined });
    }
  });

  test('the HARD graph walks the real graph and marks every stage', () => {
    const graph = modeGraph(REAL_GRAPH, 'hard');
    let stage = graph.first();
    expect(stage.id).toBe(REAL_GRAPH.first().id);
    const seen = [stage];
    for (const side of ['L', 'R', 'L', 'R'] as const) {
      const next = graph.next(stage, side);
      expect(next).not.toBeNull();
      stage = next!;
      seen.push(stage);
    }
    for (const s of seen) {
      expect(s.mode).toBe('hard');
      expect(s.timeLimit).toBe(STAGE_TIME_LIMITS_HARD[s.id]);
    }
    expect(graph.next(stage, 'L')).toBeNull();
    expect(graph.endingOf(stage)).toBe(REAL_GRAPH.endingOf(stageById(stage.id)));
  });

  test('the NORMAL graph is the real graph itself', () => {
    expect(modeGraph(REAL_GRAPH, 'normal')).toBe(REAL_GRAPH);
  });
});
