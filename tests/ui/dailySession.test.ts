// La sessione DAILY: mentre è aperta, auto e modalità sono quelle della
// sfida e C e D non le cambiano, né in memoria né nello storage; chiusa,
// torna la scelta del giocatore.

import { describe, expect, test } from 'vitest';
import { createCarSetting } from '../../src/persist/car';
import { createModeSetting } from '../../src/persist/mode';
import { dailyChallenge } from '../../src/shared/daily';
import { challengeLabel, createDailySession, nextChallengeLine, sessionCar, sessionMode } from '../../src/ui/dailySession';

describe('the daily session', () => {
  const challenge = { ...dailyChallenge('2026-10-25'), car: 'retro' as const, mode: 'hard' as const };

  test('car and mode of the challenge while it runs; the saved choice untouched; back after stop', () => {
    const session = createDailySession();
    const rawCar = createCarSetting(undefined, 'sport');
    const rawMode = createModeSetting(undefined, 'normal');
    const car = sessionCar(rawCar, session);
    const mode = sessionMode(rawMode, session);
    expect([car.get(), mode.get()]).toEqual(['sport', 'normal']);
    session.start(challenge);
    expect([car.get(), mode.get()]).toEqual(['retro', 'hard']);
    expect(car.toggle()).toBe('retro');
    expect(mode.toggle()).toBe('hard');
    car.set('new');
    mode.set('normal');
    expect([rawCar.get(), rawMode.get()]).toEqual(['sport', 'normal']);
    session.stop();
    expect([car.get(), mode.get()]).toEqual(['sport', 'normal']);
    expect(car.toggle()).not.toBe('sport');
  });

  test('labels', () => {
    expect(challengeLabel(challenge)).toBe('RETRO · HARD');
    expect(nextChallengeLine(new Date('2026-10-25T18:48:00Z'))).toBe('NEW CHALLENGE IN 5H 12M');
    expect(nextChallengeLine(new Date('2026-10-25T23:47:30Z'))).toBe('NEW CHALLENGE IN 12M');
    expect(nextChallengeLine(new Date('2026-10-25T23:59:59Z'))).toBe('NEW CHALLENGE IN 1M');
  });
});
