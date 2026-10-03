import { describe, expect, test } from 'vitest';
import type { StorageLike } from '../../src/persist/scores';
import { createTiltSeenSetting, createTiltSetting, parseTilt, TILT_KEY, TILT_SEEN_KEY } from '../../src/persist/tilt';

function memoryStorage(
  initial: Record<string, string> = {},
  throws = false,
): StorageLike & { data: Record<string, string>; reads: number } {
  const data: Record<string, string> = { ...initial };
  const store = {
    data,
    reads: 0,
    getItem(k: string) {
      store.reads += 1;
      if (throws) throw new Error('storage rotto');
      return k in data ? (data[k] ?? null) : null;
    },
    setItem(k: string, v: string) {
      if (throws) throw new Error('storage rotto');
      data[k] = v;
    },
    removeItem(k: string) {
      if (throws) throw new Error('storage rotto');
      delete data[k];
    },
  };
  return store;
}

describe('createTiltSetting: TILT si ricorda', () => {
  test('off by default; switching it on is saved and read back after a reload', () => {
    const storage = memoryStorage();
    const tilt = createTiltSetting(storage);
    expect(tilt.get()).toBe(false);
    tilt.set(true);
    expect(storage.data[TILT_KEY]).toBe('1');
    expect(createTiltSetting(storage).get()).toBe(true);
    tilt.set(false);
    expect(storage.data[TILT_KEY]).toBe('0');
    expect(createTiltSetting(storage).get()).toBe(false);
  });

  test('an unreadable value is off', () => {
    expect(parseTilt(null)).toBe(false);
    expect(parseTilt('yes')).toBe(false);
    expect(parseTilt('1')).toBe(true);
    expect(createTiltSetting(memoryStorage({ [TILT_KEY]: 'banana' })).get()).toBe(false);
  });

  test('a storage that throws keeps the choice in memory and is not retried', () => {
    const storage = memoryStorage({}, true);
    const tilt = createTiltSetting(storage);
    expect(tilt.get()).toBe(false);
    expect(() => tilt.set(true)).not.toThrow();
    expect(tilt.get()).toBe(true);
    expect(() => tilt.set(false)).not.toThrow();
    expect(storage.reads).toBe(1);
  });

  test('without storage it lives in memory', () => {
    const tilt = createTiltSetting();
    expect(tilt.get()).toBe(false);
    tilt.set(true);
    expect(tilt.get()).toBe(true);
  });
});

describe('createTiltSeenSetting: TILT già toccato', () => {
  test('not seen by default; once seen it stays seen after a reload, under its own key', () => {
    const storage = memoryStorage();
    const seen = createTiltSeenSetting(storage);
    expect(seen.get()).toBe(false);
    seen.set(true);
    expect(storage.data[TILT_SEEN_KEY]).toBe('1');
    expect(storage.data[TILT_KEY]).toBeUndefined();
    expect(createTiltSeenSetting(storage).get()).toBe(true);
    expect(createTiltSetting(storage).get()).toBe(false);
  });

  test('a storage that throws keeps it in memory', () => {
    const seen = createTiltSeenSetting(memoryStorage({}, true));
    expect(() => seen.set(true)).not.toThrow();
    expect(seen.get()).toBe(true);
  });
});
