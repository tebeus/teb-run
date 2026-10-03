import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { ENDINGS, ENDING_COUNT, clampEndingIndex, endingDef, endingSprite } from '../../src/game/endings';
import { LAST_LEVEL, REAL_GRAPH, STAGE_LIST, levelOf } from '../../src/game/stages';

describe('ENDINGS', () => {
  test('has one entry per ending, indexed 0..4 in order', () => {
    expect(ENDING_COUNT).toBe(5);
    expect(ENDINGS).toHaveLength(ENDING_COUNT);
    expect(ENDINGS.map((e) => e.index)).toEqual([0, 1, 2, 3, 4]);
  });

  test('covers exactly the endings the graph can reach', () => {
    const reachable = STAGE_LIST.filter((s) => levelOf(s.id) === LAST_LEVEL).map((s) => REAL_GRAPH.endingOf(s));
    expect(reachable.sort()).toEqual(ENDINGS.map((e) => e.index));
  });

  test('every title and line is non-empty, uppercase and short enough for the screen', () => {
    for (const ending of ENDINGS) {
      expect(ending.title.trim()).not.toBe('');
      expect(ending.title).toBe(ending.title.toUpperCase());
      expect(ending.title.length).toBeLessThanOrEqual(20);
      expect(ending.lines.length).toBeGreaterThanOrEqual(3);
      for (const line of ending.lines) {
        expect(line.trim()).not.toBe('');
        expect(line).toBe(line.toUpperCase());
        expect(line.length).toBeLessThanOrEqual(44);
      }
    }
  });

  test('titles are unique', () => {
    expect(new Set(ENDINGS.map((e) => e.title)).size).toBe(ENDING_COUNT);
  });
});

describe('clampEndingIndex', () => {
  test('passes through 0..4', () => {
    for (let i = 0; i < ENDING_COUNT; i++) expect(clampEndingIndex(i)).toBe(i);
  });

  test('clamps out of range indices and falls back to 0 for non finite input', () => {
    expect(clampEndingIndex(-1)).toBe(0);
    expect(clampEndingIndex(-100)).toBe(0);
    expect(clampEndingIndex(5)).toBe(4);
    expect(clampEndingIndex(99)).toBe(4);
    expect(clampEndingIndex(2.7)).toBe(2);
    expect(clampEndingIndex(Number.NaN)).toBe(0);
    expect(clampEndingIndex(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('endingDef', () => {
  test('returns the matching ending and never undefined for any number', () => {
    expect(endingDef(3).title).toBe(ENDINGS[3].title);
    for (const i of [-5, 0, 4, 12, Number.NaN]) {
      expect(endingDef(i)).toBeDefined();
      expect(endingDef(i).lines.length).toBeGreaterThan(0);
    }
  });
});

describe('endingSprite', () => {
  test('maps ending 0..4 to ending_1..ending_5', () => {
    expect(endingSprite(0)).toBe('ending_1');
    expect(endingSprite(4)).toBe('ending_5');
  });

  test('every name it can produce exists in the sprite catalog', () => {
    for (const i of [-3, 0, 1, 2, 3, 4, 7, Number.NaN]) {
      expect(Object.keys(CATALOG)).toContain(endingSprite(i));
    }
  });
});
