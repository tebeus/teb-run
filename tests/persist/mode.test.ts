import { describe, expect, test } from 'vitest';
import { createModeSetting, MODE_KEY } from '../../src/persist/mode';
import {
  createModeScoresStore,
  LEGACY_SCORES_KEY,
  migrateLegacyScores,
  scoresKeyFor,
  type ScoreEntry,
  type StorageLike,
} from '../../src/persist/scores';
import type { Difficulty } from '../../src/types';

function memoryStorage(
  initial: Record<string, string> = {},
  throws = false,
): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  const guard = (): void => {
    if (throws) throw new Error('storage rotto');
  };
  return {
    data,
    getItem(k) {
      guard();
      return k in data ? data[k] : null;
    },
    setItem(k, v) {
      guard();
      data[k] = v;
    },
    removeItem(k) {
      guard();
      delete data[k];
    },
  };
}

const entry = (name: string, score: number): ScoreEntry => ({
  name,
  score,
  stageId: '0-0',
  route: 'L R',
  date: '2026-01-01T00:00:00.000Z',
});

describe('createModeSetting: la modalità si ricorda', () => {
  test('without anything saved it is NORMAL, and toggling saves it', () => {
    const storage = memoryStorage();
    const mode = createModeSetting(storage);
    expect(mode.get()).toBe('normal');
    expect(mode.toggle()).toBe('hard');
    expect(storage.data[MODE_KEY]).toBe('hard');
    expect(createModeSetting(storage).get()).toBe('hard');
    expect(mode.toggle()).toBe('normal');
  });

  test('?mode= wins over the saved choice and is saved', () => {
    const storage = memoryStorage({ [MODE_KEY]: 'normal' });
    expect(createModeSetting(storage, 'hard').get()).toBe('hard');
    expect(storage.data[MODE_KEY]).toBe('hard');
  });

  test('a garbage or unknown value reads as NORMAL', () => {
    expect(createModeSetting(memoryStorage({ [MODE_KEY]: '{"x":1}' })).get()).toBe('normal');
    expect(createModeSetting(memoryStorage({ [MODE_KEY]: 'insane' })).get()).toBe('normal');
  });

  test('a throwing storage leaves the choice in memory for the session', () => {
    const mode = createModeSetting(memoryStorage({}, true));
    expect(mode.get()).toBe('normal');
    mode.set('hard');
    expect(mode.get()).toBe('hard');
    expect(mode.toggle()).toBe('normal');
  });
});

describe('una classifica per modalità', () => {
  test('each mode has its own key', () => {
    expect(scoresKeyFor('normal')).toBe('tebrun.scores.normal.v1');
    expect(scoresKeyFor('hard')).toBe('tebrun.scores.hard.v1');
    expect(scoresKeyFor('normal')).not.toBe(LEGACY_SCORES_KEY);
  });

  test('scores go to the table of the mode chosen at that moment, and stay apart', () => {
    const storage = memoryStorage();
    let mode: Difficulty = 'normal';
    const scores = createModeScoresStore(storage, () => mode);
    scores.insert(entry('NOR', 500));
    mode = 'hard';
    expect(scores.load()).toEqual([]);
    scores.insert(entry('HRD', 300));
    expect(scores.load().map((e) => e.name)).toEqual(['HRD']);
    mode = 'normal';
    expect(scores.load().map((e) => e.name)).toEqual(['NOR']);
    expect(JSON.parse(storage.data[scoresKeyFor('hard')])).toEqual([entry('HRD', 300)]);
  });

  test('qualifies reads the table of the current mode', () => {
    const storage = memoryStorage();
    let mode: Difficulty = 'normal';
    const scores = createModeScoresStore(storage, () => mode);
    for (let i = 0; i < 10; i++) scores.insert(entry('AAA', 1000 + i));
    expect(scores.qualifies(10)).toBe(false);
    mode = 'hard';
    expect(scores.qualifies(10)).toBe(true);
  });

  test('the old single table becomes the NORMAL one, once', () => {
    const old = JSON.stringify([entry('OLD', 999)]);
    const storage = memoryStorage({ [LEGACY_SCORES_KEY]: old });
    const scores = createModeScoresStore(storage, () => 'normal');
    expect(scores.load()).toEqual([entry('OLD', 999)]);
    expect(storage.data[LEGACY_SCORES_KEY]).toBeUndefined();
    expect(storage.data[scoresKeyFor('normal')]).toBe(old);
    expect(storage.data[scoresKeyFor('hard')]).toBeUndefined();
  });

  test('the migration never overwrites a NORMAL table that already exists', () => {
    const mine = JSON.stringify([entry('NEW', 10)]);
    const storage = memoryStorage({ [LEGACY_SCORES_KEY]: JSON.stringify([entry('OLD', 999)]), [scoresKeyFor('normal')]: mine });
    migrateLegacyScores(storage);
    expect(storage.data[scoresKeyFor('normal')]).toBe(mine);
    expect(storage.data[LEGACY_SCORES_KEY]).toBeUndefined();
  });

  test('a throwing storage neither migrates nor throws, and scores live in memory', () => {
    const storage = memoryStorage({}, true);
    expect(() => migrateLegacyScores(storage)).not.toThrow();
    const scores = createModeScoresStore(storage, () => 'hard');
    expect(scores.insert(entry('MEM', 1))).toBe(1);
    expect(scores.load()).toEqual([entry('MEM', 1)]);
  });

  test('without a storage the two tables live in memory, apart', () => {
    let mode: Difficulty = 'hard';
    const scores = createModeScoresStore(undefined, () => mode);
    scores.insert(entry('HRD', 1));
    mode = 'normal';
    expect(scores.load()).toEqual([]);
  });
});
