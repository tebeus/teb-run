import { describe, expect, test } from 'vitest';
import { DEMO_GRAPH, DEMO_STAGES, makeStage, stageLengthFor } from '../../src/game/demo-graph';
import { createStageGraph, indexOf, levelOf } from '../../src/game/stage-graph';
import { buildTrack, FORK_ZONE_SEGMENTS } from '../../src/game/track';
import { timeLimitFor } from '../../src/game/timer';
import type { StageDef } from '../../src/types';

describe('levelOf and indexOf (spec §9)', () => {
  test('they read the two halves of the id', () => {
    expect(levelOf('0-0')).toBe(0);
    expect(indexOf('0-0')).toBe(0);
    expect(levelOf('4-3')).toBe(4);
    expect(indexOf('4-3')).toBe(3);
  });

  test('a malformed id falls back to zero instead of NaN', () => {
    expect(levelOf('')).toBe(0);
    expect(indexOf('')).toBe(0);
    expect(levelOf('demo')).toBe(0);
    expect(indexOf('demo')).toBe(0);
  });
});

describe('createStageGraph (spec §9)', () => {
  const stages: StageDef[] = [
    makeStage('0-0', 'A', 'beach', 0.1, 1),
    makeStage('1-0', 'B', 'desert', 0.2, 2),
    makeStage('1-1', 'C', 'alpine', 0.2, 3),
    makeStage('2-0', 'D', 'farm', 0.3, 4),
    makeStage('2-1', 'E', 'town', 0.3, 5),
    makeStage('2-2', 'F', 'beach', 0.3, 6),
  ];
  const graph = createStageGraph(stages);

  test('it starts from 0-0', () => {
    expect(graph.first().id).toBe('0-0');
  });

  test('left keeps the index, right adds one', () => {
    expect(graph.next(stages[0], 'L')?.id).toBe('1-0');
    expect(graph.next(stages[0], 'R')?.id).toBe('1-1');
    expect(graph.next(stages[1], 'L')?.id).toBe('2-0');
    expect(graph.next(stages[1], 'R')?.id).toBe('2-1');
    expect(graph.next(stages[2], 'L')?.id).toBe('2-1');
    expect(graph.next(stages[2], 'R')?.id).toBe('2-2');
  });

  test('the last level has no successors', () => {
    for (const id of ['2-0', '2-1', '2-2']) {
      const stage = stages.find((s) => s.id === id) as StageDef;
      expect(graph.next(stage, 'L')).toBeNull();
      expect(graph.next(stage, 'R')).toBeNull();
    }
  });

  test('the ending is the index of the last stage, clamped to five endings', () => {
    expect(graph.endingOf(stages[3])).toBe(0);
    expect(graph.endingOf(stages[5])).toBe(2);
    expect(graph.endingOf(makeStage('4-9', 'X', 'beach', 0.1, 7))).toBe(4);
  });

  test('a graph with no stages is a programming error, not a silent start', () => {
    expect(() => createStageGraph([])).toThrow();
  });

  test('a graph whose first stage is not 0-0 starts from the first of the list', () => {
    expect(createStageGraph([stages[1], stages[2]]).first().id).toBe('1-0');
  });
});

describe('DEMO_GRAPH', () => {
  test('it has three stages over two levels', () => {
    expect(DEMO_STAGES.map((s) => s.id)).toEqual(['0-0', '1-0', '1-1']);
  });

  test('the first stage forks into the other two', () => {
    const first = DEMO_GRAPH.first();
    expect(first.id).toBe('0-0');
    expect(DEMO_GRAPH.next(first, 'L')?.id).toBe('1-0');
    expect(DEMO_GRAPH.next(first, 'R')?.id).toBe('1-1');
  });

  test('both second stages end the race, with a different ending each', () => {
    const left = DEMO_STAGES[1];
    const right = DEMO_STAGES[2];
    expect(DEMO_GRAPH.next(left, 'L')).toBeNull();
    expect(DEMO_GRAPH.next(left, 'R')).toBeNull();
    expect(DEMO_GRAPH.endingOf(left)).toBe(0);
    expect(DEMO_GRAPH.endingOf(right)).toBe(1);
  });

  test('lengths and time limits follow the spec formulas', () => {
    for (const s of DEMO_STAGES) {
      expect(s.lengthSegments, s.id).toBe(stageLengthFor(s.difficulty));
      expect(s.timeLimit, s.id).toBe(timeLimitFor(levelOf(s.id), s.difficulty));
    }
    expect(DEMO_STAGES[0].lengthSegments).toBe(3256);
    expect(DEMO_STAGES[0].timeLimit).toBe(74);
    expect(DEMO_STAGES[1].timeLimit).toBe(71);
  });

  test('every demo stage builds a legal track with a fork zone', () => {
    for (const s of DEMO_STAGES) {
      const track = buildTrack(s);
      expect(track, s.id).toHaveLength(s.lengthSegments);
      expect(track[track.length - FORK_ZONE_SEGMENTS].fork, s.id).toBe('zone');
    }
  });
});
