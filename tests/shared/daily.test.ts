// La sfida del giorno dalla data UTC: uguale su client e server, la stessa
// per tutto il giorno, nuova a mezzanotte UTC, mai la stessa auto di ieri,
// HARD il sabato e la domenica.

import { describe, expect, test } from 'vitest';
import {
  addDays,
  DAILY_CARS,
  dailyChallenge,
  dailyKey,
  msToNextDaily,
  parseDailyKey,
} from '../../src/shared/daily';

describe('the daily challenge', () => {
  test('the key is the UTC date, and changes exactly at midnight UTC', () => {
    expect(dailyKey(new Date('2026-10-25T23:59:59.999Z'))).toBe('2026-10-25');
    expect(dailyKey(new Date('2026-10-26T00:00:00.000Z'))).toBe('2026-10-26');
    // Un orario con fuso: conta l'istante, non il fuso di chi lo scrive.
    expect(dailyKey(new Date('2026-10-25T20:00:00-08:00'))).toBe('2026-10-26');
  });

  test('the same all day long, and the same for everyone', () => {
    const morning = dailyChallenge(dailyKey(new Date('2026-10-25T00:00:01Z')));
    const night = dailyChallenge(dailyKey(new Date('2026-10-25T23:59:59Z')));
    expect(night).toEqual(morning);
    expect(dailyChallenge('2026-10-25')).toEqual(dailyChallenge('2026-10-25'));
  });

  test('a year: all four public cars, never classic, never the car of the day before; HARD on Saturday and Sunday only', () => {
    const seen = new Set<string>();
    let prev = dailyChallenge('2026-01-01');
    for (let i = 1; i < 366; i++) {
      const key = addDays('2026-01-01', i);
      const c = dailyChallenge(key);
      seen.add(c.car);
      expect(c.car).not.toBe('classic');
      expect(c.car).not.toBe(prev.car);
      const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
      expect(c.mode).toBe(weekday === 0 || weekday === 6 ? 'hard' : 'normal');
      prev = c;
    }
    expect([...seen].sort()).toEqual([...DAILY_CARS].sort());
  });

  test('a traffic salt that changes every day', () => {
    const salts = new Set<number>();
    for (let i = 0; i < 365; i++) salts.add(dailyChallenge(addDays('2026-01-01', i)).trafficSalt);
    expect(salts.size).toBe(365);
    for (const s of salts) expect(s).toBeGreaterThan(0);
  });

  test('time to the next challenge', () => {
    expect(msToNextDaily(new Date('2026-10-25T18:48:00Z'))).toBe((5 * 60 + 12) * 60 * 1000);
    expect(msToNextDaily(new Date('2026-10-25T00:00:00Z'))).toBe(24 * 3600 * 1000);
  });

  test('keys: parsed strictly, days added across months and years', () => {
    expect(parseDailyKey('2026-10-25')).toBe(true);
    for (const bad of ['2026-1-25', '2026-13-01', '2026-02-30', '26-10-25', '2026-10-25 ', '']) expect(parseDailyKey(bad)).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
