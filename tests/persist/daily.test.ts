// Il record DAILY locale (spec §3.4) e le ultime iniziali: senza rete, su
// ogni build. Solo il giorno della sfida conta; valori illeggibili valgono
// vuoto; uno storage che lancia lascia tutto in memoria.

import { describe, expect, test } from 'vitest';
import { createDailyStore, createInitialsMemory, DAILY_KEY, INITIALS_KEY, type DailyBest } from '../../src/persist/daily';
import type { StorageLike } from '../../src/persist/scores';

function memStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const broken: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const run = (score: number): DailyBest => ({ score, car: 'retro', mode: 'hard', stageId: '2-1', route: 'LR' });

describe('local daily best', () => {
  test('the first run of the day is a record; a better one too; a worse or equal one is not', () => {
    const s = createDailyStore(memStorage());
    expect(s.best('2026-10-25')).toBeNull();
    expect(s.record('2026-10-25', run(100))).toBe(true);
    expect(s.record('2026-10-25', run(100))).toBe(false);
    expect(s.record('2026-10-25', run(90))).toBe(false);
    expect(s.record('2026-10-25', run(150))).toBe(true);
    expect(s.best('2026-10-25')?.score).toBe(150);
  });

  test('a new day starts empty, and its first run replaces yesterday', () => {
    const storage = memStorage();
    const s = createDailyStore(storage);
    s.record('2026-10-25', run(500));
    expect(s.best('2026-10-26')).toBeNull();
    expect(s.record('2026-10-26', run(10))).toBe(true);
    expect(JSON.parse(storage.data.get(DAILY_KEY)!).key).toBe('2026-10-26');
  });

  test('survives a reload', () => {
    const storage = memStorage();
    createDailyStore(storage).record('2026-10-25', run(321));
    expect(createDailyStore(storage).best('2026-10-25')).toEqual(run(321));
  });

  test('unreadable values are empty', () => {
    for (const raw of ['{', 'null', '[]', '{"key":"2026-10-25"}', JSON.stringify({ key: '2026-10-25', best: { ...run(1), score: 'x' } }), 'x'.repeat(10_000)]) {
      const storage = memStorage();
      storage.data.set(DAILY_KEY, raw);
      expect(createDailyStore(storage).best('2026-10-25')).toBeNull();
    }
  });

  test('a storage that throws: kept in memory for the session', () => {
    const s = createDailyStore(broken);
    expect(s.record('2026-10-25', run(7))).toBe(true);
    expect(s.best('2026-10-25')?.score).toBe(7);
  });
});

describe('last initials', () => {
  test('remembered, only in the A-Z form', () => {
    const storage = memStorage();
    expect(createInitialsMemory(storage).get()).toBeNull();
    createInitialsMemory(storage).set('TEB');
    expect(createInitialsMemory(storage).get()).toBe('TEB');
    storage.data.set(INITIALS_KEY, '<script>');
    expect(createInitialsMemory(storage).get()).toBeNull();
  });

  test('a storage that throws: memory only', () => {
    const m = createInitialsMemory(broken);
    m.set('ABC');
    expect(m.get()).toBe('ABC');
  });
});
