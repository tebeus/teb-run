import { describe, expect, test } from 'vitest';
import { createEndingsStore, ENDINGS_KEY, parseEndings, stagesOfEntry } from '../../src/persist/endings';
import type { ScoreEntry, StorageLike } from '../../src/persist/scores';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const entry = (route: string, stageId: string): ScoreEntry => ({ name: 'AAA', score: 1, stageId, route, date: '2026-10-01' });

describe('collezione dei finali (spec telefono e finali §C)', () => {
  test('a new ending counts once; seeing it again is not new', () => {
    const store = createEndingsStore(memoryStorage());
    expect(store.recordEnding(2)).toEqual({ isNew: true, count: 1 });
    expect(store.recordEnding(2)).toEqual({ isNew: false, count: 1 });
    expect(store.recordEnding(0)).toEqual({ isNew: true, count: 2 });
    expect(store.load().seen).toEqual([1, 3]);
  });

  test('it survives a reload, under its own versioned key', () => {
    const storage = memoryStorage();
    createEndingsStore(storage).recordEnding(4);
    createEndingsStore(storage).recordStages(['0-0', '1-1']);
    expect(JSON.parse(storage.data.get(ENDINGS_KEY)!)).toEqual({ seen: [5], stages: ['0-0', '1-1'], migrated: true });
    expect(createEndingsStore(storage).recordEnding(4).isNew).toBe(false);
  });

  test('without storage, or with one that throws, everything stays locked and nothing throws', () => {
    expect(createEndingsStore().load()).toEqual({ seen: [], stages: [], migrated: false });
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    };
    const store = createEndingsStore(throwing);
    expect(store.load().seen).toEqual([]);
    expect(store.recordEnding(1)).toEqual({ isNew: true, count: 1 });
  });

  test('broken JSON or nonsense values read as nothing', () => {
    expect(parseEndings('{oops')).toEqual({ seen: [], stages: [], migrated: false });
    expect(parseEndings(JSON.stringify({ seen: [0, 3, 3, 9, 'x'], stages: ['1-1', '9-9', 4], migrated: 'yes' }))).toEqual({
      seen: [3],
      stages: ['1-1'],
      migrated: false,
    });
    expect(createEndingsStore(memoryStorage()).recordEnding(7)).toEqual({ isNew: false, count: 0 });
  });

  test('the stages of an old TOP 10 entry, only when the route leads exactly to its stage', () => {
    expect(stagesOfEntry(entry('', '0-0'))).toEqual(['0-0']);
    expect(stagesOfEntry(entry('L R L', '3-1'))).toEqual(['0-0', '1-0', '2-1', '3-1']);
    expect(stagesOfEntry(entry('R R R R', '4-4'))).toEqual(['0-0', '1-1', '2-2', '3-3', '4-4']);
    expect(stagesOfEntry(entry('L R', '3-1'))).toEqual([]);
    expect(stagesOfEntry(entry('X', '1-0'))).toEqual([]);
  });

  test('old games give their stages once, never their endings', () => {
    const storage = memoryStorage();
    let asked = 0;
    const history = () => (asked++, [entry('R R R R', '4-4'), entry('L', '1-0')]);
    const store = createEndingsStore(storage, history);
    expect(store.load()).toEqual({ seen: [], stages: ['0-0', '1-0', '1-1', '2-2', '3-3', '4-4'], migrated: true });
    createEndingsStore(storage, history).load();
    expect(asked).toBe(1);
  });
});
