import { describe, expect, test, vi } from 'vitest';
import {
  MAX_FIELD_LEN,
  MAX_NAME_LEN,
  createDefaultScoresStore,
  createScoresStore,
  type ScoreEntry,
  type StorageLike,
} from '../../src/persist/scores';

const entry = (name: string, score: number): ScoreEntry => ({
  name,
  score,
  stageId: '0-0',
  route: 'L R',
  date: '2026-01-01T00:00:00.000Z',
});

function memoryStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem(k) {
      return k in data ? data[k] : null;
    },
    setItem(k, v) {
      data[k] = v;
    },
    removeItem(k) {
      delete data[k];
    },
  };
}

describe('createScoresStore', () => {
  test('load() is empty by default', () => {
    expect(createScoresStore(memoryStorage()).load()).toEqual([]);
  });

  test('insert keeps entries sorted by score descending', () => {
    const s = createScoresStore(memoryStorage());
    s.insert(entry('AAA', 100));
    s.insert(entry('BBB', 300));
    s.insert(entry('CCC', 200));
    expect(s.load().map((e) => e.name)).toEqual(['BBB', 'CCC', 'AAA']);
  });

  test('caps the list at 10 entries, dropping the lowest', () => {
    const s = createScoresStore(memoryStorage());
    for (let i = 0; i < 12; i++) s.insert(entry(`P${i}`, i * 10));
    const list = s.load();
    expect(list).toHaveLength(10);
    expect(list[0].score).toBe(110);
    expect(list[9].score).toBe(20);
  });

  test('on a tie, the earlier entry keeps the higher rank', () => {
    const s = createScoresStore(memoryStorage());
    s.insert(entry('FIRST', 500));
    s.insert(entry('SECOND', 500));
    expect(s.load().map((e) => e.name)).toEqual(['FIRST', 'SECOND']);
  });

  test('insert returns the 1-based rank of the new entry', () => {
    const s = createScoresStore(memoryStorage());
    expect(s.insert(entry('A', 100))).toBe(1);
    expect(s.insert(entry('B', 50))).toBe(2);
    expect(s.insert(entry('C', 200))).toBe(1); // beats both existing entries
  });

  test('insert returns -1 when the entry does not make the top 10', () => {
    const s = createScoresStore(memoryStorage());
    for (let i = 0; i < 10; i++) s.insert(entry(`P${i}`, 100 - i));
    expect(s.insert(entry('LOW', 1))).toBe(-1);
  });

  test('qualifies() is true while there are fewer than 10 entries', () => {
    const s = createScoresStore(memoryStorage());
    expect(s.qualifies(0)).toBe(true);
    for (let i = 0; i < 10; i++) s.insert(entry(`P${i}`, 100));
    expect(s.qualifies(0)).toBe(false);
    expect(s.qualifies(101)).toBe(true);
  });

  test('qualifies() is false on an exact tie with the lowest entry once full', () => {
    const s = createScoresStore(memoryStorage());
    for (let i = 0; i < 10; i++) s.insert(entry(`P${i}`, 100 - i));
    expect(s.load()[9].score).toBe(91);
    expect(s.qualifies(91)).toBe(false);
    expect(s.qualifies(92)).toBe(true);
  });

  test('clear() empties the list', () => {
    const s = createScoresStore(memoryStorage());
    s.insert(entry('X', 10));
    s.clear();
    expect(s.load()).toEqual([]);
  });

  test('corrupted storage content is treated as empty, not thrown', () => {
    const storage = memoryStorage();
    storage.data['tebrun.scores.v1'] = '{not json';
    const s = createScoresStore(storage);
    expect(() => s.load()).not.toThrow();
    expect(s.load()).toEqual([]);
  });

  test('load() drops malformed entries instead of handing them to the caller', () => {
    const storage = memoryStorage();
    storage.data['tebrun.scores.v1'] = JSON.stringify([
      entry('OK', 100),
      { name: 'MISSING_SCORE' },
      1,
      2,
      3,
      null,
      { name: 'BAD_SCORE', score: 'x', stageId: '0-0', route: '', date: '2026-01-01T00:00:00.000Z' },
    ]);
    const s = createScoresStore(storage);
    expect(() => s.load()).not.toThrow();
    expect(s.load()).toEqual([entry('OK', 100)]);
  });

  test('load() drops entries whose text fields are oversized or carry control characters', () => {
    // localStorage è scrivibile da chiunque abbia la console aperta, e la
    // classifica finisce in drawText: un nome enorme non inietta niente ma
    // disegnerebbe un fillRect per pixel di un megabyte di testo.
    const storage = memoryStorage();
    storage.data['tebrun.scores.v1'] = JSON.stringify([
      entry('OK', 100),
      { ...entry('X', 90), name: 'A'.repeat(MAX_NAME_LEN + 1) },
      { ...entry('Y', 80), stageId: '0'.repeat(MAX_FIELD_LEN + 1) },
      { ...entry('Z', 70), route: 'L'.repeat(MAX_FIELD_LEN + 1) },
      { ...entry('W', 60), date: 'd'.repeat(MAX_FIELD_LEN + 1) },
      { ...entry('V', 50), name: 'A\u0000B' },
    ]);
    const s = createScoresStore(storage);
    expect(s.load()).toEqual([entry('OK', 100)]);
  });

  test('a name exactly at the limit is still accepted', () => {
    const storage = memoryStorage();
    const longest = 'A'.repeat(MAX_NAME_LEN);
    storage.data['tebrun.scores.v1'] = JSON.stringify([entry(longest, 100)]);
    expect(createScoresStore(storage).load()).toEqual([entry(longest, 100)]);
  });

  test('a raw value far longer than ten legitimate entries could be is rejected before JSON.parse touches it', () => {
    // Chi scrive nella console del browser può metterci qualunque stringa:
    // il tetto sulla lunghezza grezza deve fermarla prima del parse, non
    // dopo, o il costo si paga comunque una volta a ogni load().
    const storage = memoryStorage();
    const huge = JSON.stringify([entry('OK', 1)]).slice(0, -1) + ' '.repeat(2_000_000) + ']';
    storage.data['tebrun.scores.v1'] = huge;
    const parseSpy = vi.spyOn(JSON, 'parse');
    const s = createScoresStore(storage);
    expect(s.load()).toEqual([]);
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
    // e la chiave viene riparata, come qualunque altro dato illeggibile.
    expect(storage.data['tebrun.scores.v1']).toBeUndefined();
  });

  test('load() rewrites the key with the cleaned list when entries are dropped, so the cost is paid once', () => {
    const storage = memoryStorage();
    storage.data['tebrun.scores.v1'] = JSON.stringify([entry('OK', 100), { name: 'BAD' }]);
    const s = createScoresStore(storage);
    expect(s.load()).toEqual([entry('OK', 100)]);
    expect(JSON.parse(storage.data['tebrun.scores.v1'])).toEqual([entry('OK', 100)]);
  });

  test('recovers from corrupted storage by repairing the key, instead of latching to memory forever', () => {
    const storage = memoryStorage();
    storage.data['tebrun.scores.v1'] = '{not json';
    const s = createScoresStore(storage);
    expect(s.load()).toEqual([]);

    // A later insert must still reach real storage, not just the in-memory
    // fallback: a corrupted read is not the same failure as setItem
    // throwing, and must not disable persistence for the rest of the session.
    s.insert(entry('X', 999));
    expect(s.load().map((e) => e.name)).toEqual(['X']);
    expect(JSON.parse(storage.data['tebrun.scores.v1'])).toEqual([entry('X', 999)]);
  });

  test('falls back to memory when setItem throws (quota exceeded)', () => {
    const storage = memoryStorage();
    let calls = 0;
    storage.setItem = () => {
      calls++;
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const s = createScoresStore(storage);
    expect(() => s.insert(entry('X', 999))).not.toThrow();
    expect(calls).toBe(1);
    expect(s.load().map((e) => e.name)).toEqual(['X']);
    s.insert(entry('Y', 500));
    expect(calls).toBe(1); // non ritenta lo storage rotto
    expect(s.load().map((e) => e.name)).toEqual(['X', 'Y']);
  });

  test('works fully in memory when no storage is given', () => {
    const s = createScoresStore();
    s.insert(entry('X', 1));
    expect(s.load().map((e) => e.name)).toEqual(['X']);
  });
});

describe('createDefaultScoresStore', () => {
  test('inserts and loads correctly regardless of whether localStorage is available in this environment', () => {
    // In Node (ambiente dei test) localStorage è tipicamente assente: questo
    // test verifica solo il comportamento (non lancia, insert+load coerenti),
    // non un dettaglio del runtime, così resta valido anche se l'ambiente
    // Vitest cambiasse o Node esponesse Web Storage in futuro.
    const s = createDefaultScoresStore();
    expect(() => s.insert(entry('X', 1))).not.toThrow();
    expect(s.load().map((e) => e.name)).toEqual(['X']);
  });
});
