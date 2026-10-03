import { describe, expect, test } from 'vitest';
import {
  carryOver,
  CHECKPOINT_BANNER_S,
  expiredSpeed,
  GAMEOVER_DECEL_S,
  HARD_TIME_FACTOR,
  initialTimer,
  LEVEL_TIME_LIMITS,
  stepBannerClock,
  stepTimer,
  timeLimitFor,
  type TimerState,
} from '../../src/game/timer';

const DT = 1 / 60;

describe('timeLimitFor (spec §8)', () => {
  test('the base limits are the retuned table of the third user test (spec §8, deroga: collaudo utente)', () => {
    expect([...LEVEL_TIME_LIMITS]).toEqual([74, 71, 80, 85, 93]);
    expect(timeLimitFor(0, 0.15)).toBe(74);
    expect(timeLimitFor(1, 0.3)).toBe(71);
    expect(timeLimitFor(2, 0.45)).toBe(80);
    expect(timeLimitFor(3, 0.6)).toBe(85);
    expect(timeLimitFor(4, 0.7)).toBe(93);
  });

  test('above difficulty 0.7 the limit is scaled by 0.92', () => {
    expect(timeLimitFor(3, 0.7)).toBe(85);
    expect(timeLimitFor(3, 0.71)).toBeCloseTo(85 * HARD_TIME_FACTOR, 10);
    expect(timeLimitFor(4, 0.85)).toBeCloseTo(93 * HARD_TIME_FACTOR, 10);
  });

  test('a level outside the table clamps to the nearest one', () => {
    expect(timeLimitFor(-1, 0)).toBe(74);
    expect(timeLimitFor(9, 0)).toBe(93);
  });

  /**
   * **Deroga (terzo collaudo utente: ancora troppo facile), fix round 4.**
   * La tabella segue il tempo di guida del pilota esperto livello per
   * livello, livello 0 compreso (margine peggiore 3-6 s). Il livello 1
   * scende perché lo paga il riporto del livello 0; dal 2 in su il tempo di
   * guida cresce e la tabella con lui. Vedi il commento di
   * `LEVEL_TIME_LIMITS` in `game/timer.ts` per le misure.
   */
  test('the table is not monotonic: it follows the real driving time of every level', () => {
    expect(LEVEL_TIME_LIMITS[1]).toBeLessThan(LEVEL_TIME_LIMITS[0]);
    expect(LEVEL_TIME_LIMITS[2]).toBeGreaterThan(LEVEL_TIME_LIMITS[1]);
    expect(LEVEL_TIME_LIMITS[3]).toBeGreaterThan(LEVEL_TIME_LIMITS[2]);
    expect(LEVEL_TIME_LIMITS[4]).toBeGreaterThan(LEVEL_TIME_LIMITS[3]);
  });
});

describe('carryOver (spec §8)', () => {
  test('the time left is added to the next limit', () => {
    expect(carryOver(12.5, 65)).toBe(77.5);
  });

  test('no time left adds nothing, and a negative carry never subtracts', () => {
    expect(carryOver(0, 65)).toBe(65);
    expect(carryOver(-5, 65)).toBe(65);
  });
});

describe('stepTimer (spec §8)', () => {
  test('the clock counts down', () => {
    const r = stepTimer(initialTimer(75), 0.5);
    expect(r.state.left).toBeCloseTo(74.5, 10);
    expect(r.state.expired).toBeNull();
    expect(r.gameOver).toBe(false);
  });

  test('reaching zero starts the two second decel, without the event yet', () => {
    const r = stepTimer({ left: 0.2, expired: null }, 0.5);
    expect(r.state.left).toBe(0);
    expect(r.state.expired).toBe(0);
    expect(r.gameOver).toBe(false);
  });

  test('the time left never goes negative', () => {
    let s = initialTimer(0.05);
    for (let i = 0; i < 300; i++) s = stepTimer(s, DT).state;
    expect(s.left).toBe(0);
  });

  test('the game over event fires once, after the decel', () => {
    let s: TimerState = { left: 0, expired: 0 };
    let fired = 0;
    for (let i = 0; i < 600; i++) {
      const r = stepTimer(s, DT);
      s = r.state;
      if (r.gameOver) fired++;
    }
    expect(fired).toBe(1);
  });

  test('the event lands at the end of the two seconds, not before', () => {
    let s: { left: number; expired: number | null } = { left: 0, expired: 0 };
    let at = -1;
    for (let i = 1; i <= 200; i++) {
      const r = stepTimer(s, DT);
      s = r.state;
      if (r.gameOver) {
        at = i;
        break;
      }
    }
    expect(at).toBe(Math.round(GAMEOVER_DECEL_S / DT));
  });

  test('a limit of zero is already expired on the first step', () => {
    const r = stepTimer(initialTimer(0), DT);
    expect(r.state.expired).not.toBeNull();
  });
});

describe('expiredSpeed (spec §8)', () => {
  test('the car stops in two seconds', () => {
    expect(expiredSpeed(12000, 0)).toBe(12000);
    expect(expiredSpeed(12000, 1)).toBeCloseTo(6000, 10);
    expect(expiredSpeed(12000, GAMEOVER_DECEL_S)).toBe(0);
    expect(expiredSpeed(12000, 5)).toBe(0);
  });
});

describe('stepBannerClock', () => {
  test('the checkpoint banner lasts two seconds', () => {
    expect(CHECKPOINT_BANNER_S).toBe(2);
    let left = CHECKPOINT_BANNER_S;
    let ticks = 0;
    while (left > 0) {
      left = stepBannerClock(left, DT);
      ticks++;
    }
    expect(ticks).toBe(120);
  });

  test('a clock already at zero stays there', () => {
    expect(stepBannerClock(0, DT)).toBe(0);
    expect(stepBannerClock(-1, DT)).toBe(0);
  });
});
