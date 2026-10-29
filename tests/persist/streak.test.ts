// La serie di giorni della sfida (spec prima tappa e ritorno §5): giorno
// nuovo, stesso giorno, giorno saltato, la mezzanotte UTC, e senza
// `localStorage` (assente, che lancia, con dati rotti) niente serie e nessun errore.

import { describe, expect, test } from 'vitest';
import { dailyKey } from '../../src/shared/daily';
import { createStreakStore, liveCount, nextStreak, STREAK_KEY, streakLine } from '../../src/persist/streak';
import type { StorageLike } from '../../src/persist/scores';

const mapStorage = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) } as StorageLike & { map: Map<string, string> };
};

describe('nextStreak and liveCount', () => {
  test('first day, the same day again, the next day, a skipped day', () => {
    let s = nextStreak(null, '2026-10-27');
    expect(s).toEqual({ last: '2026-10-27', count: 1 });
    s = nextStreak(s, '2026-10-27');
    expect(s.count).toBe(1);
    s = nextStreak(s, '2026-10-28');
    expect(s).toEqual({ last: '2026-10-28', count: 2 });
    s = nextStreak(s, '2026-10-29');
    expect(s.count).toBe(3);
    s = nextStreak(s, '2026-10-31');
    expect(s).toEqual({ last: '2026-10-31', count: 1 });
  });

  test('across months and years; a clock going back starts again', () => {
    expect(nextStreak({ last: '2026-12-31', count: 4 }, '2027-01-01').count).toBe(5);
    expect(nextStreak({ last: '2026-10-31', count: 2 }, '2026-11-01').count).toBe(3);
    expect(nextStreak({ last: '2026-10-28', count: 9 }, '2026-10-27')).toEqual({ last: '2026-10-27', count: 1 });
  });

  test('alive today if the last day is today or yesterday; dead after a skipped day', () => {
    expect(liveCount({ last: '2026-10-27', count: 3 }, '2026-10-27')).toBe(3);
    expect(liveCount({ last: '2026-10-26', count: 3 }, '2026-10-27')).toBe(3);
    expect(liveCount({ last: '2026-10-25', count: 3 }, '2026-10-27')).toBe(0);
    expect(liveCount(null, '2026-10-27')).toBe(0);
  });

  test('the line from 2 days up', () => {
    expect(streakLine(0)).toBeNull();
    expect(streakLine(1)).toBeNull();
    expect(streakLine(2)).toBe('DAY 2 IN A ROW');
    expect(streakLine(31)).toBe('DAY 31 IN A ROW');
  });
});

describe('createStreakStore', () => {
  test('stored under its own versioned key, read back by a new store', () => {
    const storage = mapStorage();
    const a = createStreakStore(storage);
    a.record('2026-10-26');
    a.record('2026-10-27');
    expect(JSON.parse(storage.map.get(STREAK_KEY)!)).toEqual({ last: '2026-10-27', count: 2 });
    expect(createStreakStore(storage).current('2026-10-27')).toBe(2);
    expect(createStreakStore(storage).current('2026-10-28')).toBe(2);
    expect(createStreakStore(storage).current('2026-10-29')).toBe(0);
  });

  test('UTC midnight: a race started at 23:59 counts for that day, the next one for the new day', () => {
    const store = createStreakStore(mapStorage());
    store.record(dailyKey(new Date('2026-10-27T23:59:30Z')));
    store.record(dailyKey(new Date('2026-10-28T00:00:10Z')));
    expect(store.current('2026-10-28')).toBe(2);
    // In un altro fuso è ancora il 27 sera, ma conta la data UTC.
    expect(dailyKey(new Date('2026-10-28T00:00:10+02:00'))).toBe('2026-10-27');
  });

  test('without localStorage: no streak beyond the page, no error', () => {
    const none = createStreakStore(undefined);
    none.record('2026-10-26');
    none.record('2026-10-27');
    expect(none.current('2026-10-27')).toBe(2);
    expect(createStreakStore(undefined).current('2026-10-27')).toBe(0);
  });

  test('a storage that throws, or broken data, or a bad key: no error and no streak', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    } as StorageLike;
    const store = createStreakStore(throwing);
    expect(() => store.record('2026-10-27')).not.toThrow();
    expect(store.current('2026-10-27')).toBe(1);
    for (const raw of ['{', 'null', '{"last":"2026-02-30","count":2}', '{"last":"2026-10-27","count":-1}', '{"last":"2026-10-27","count":1.5}', 'x'.repeat(100)]) {
      const storage = mapStorage();
      storage.map.set(STREAK_KEY, raw);
      expect(createStreakStore(storage).current('2026-10-27'), raw).toBe(0);
    }
    const storage = mapStorage();
    createStreakStore(storage).record('not-a-day');
    expect(storage.map.has(STREAK_KEY)).toBe(false);
  });
});
