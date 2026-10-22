import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { NO_GAMEPLAY_HOOKS, createGameplayTracker, type GameplayHooks } from '../../src/core/gameplayEvents';

function recorder(): { hooks: GameplayHooks; log: string[] } {
  const log: string[] = [];
  return {
    log,
    hooks: {
      gameplayStart: () => log.push('start'),
      gameplayStop: () => log.push('stop'),
      betweenGames: (done) => {
        log.push('between');
        done();
      },
      happytime: () => log.push('happy'),
    },
  };
}

describe('gameplay events (the future portal SDK point)', () => {
  test('a race starts, pauses, resumes and ends: start, stop, start, stop', () => {
    const { hooks, log } = recorder();
    const t = createGameplayTracker(hooks);
    t.race(false);
    t.race(false);
    t.race(true);
    t.race(true);
    t.race(false);
    t.raceOver();
    t.raceOver();
    expect(log).toEqual(['start', 'stop', 'start', 'stop']);
  });

  test('nextGame: the first game of the session starts at once; from the second, betweenGames (the midgameAd) comes first', () => {
    const { hooks, log } = recorder();
    const t = createGameplayTracker(hooks);
    t.nextGame(() => log.push('ready'));
    t.race(false);
    t.raceOver();
    t.nextGame(() => log.push('ready'));
    t.race(false);
    t.raceOver();
    expect(log).toEqual(['ready', 'start', 'stop', 'between', 'ready', 'start', 'stop']);
  });

  test('while the ad runs adRunning is true, and ready comes once even if the SDK answers twice', () => {
    let finish: () => void = () => undefined;
    const t = createGameplayTracker({ ...NO_GAMEPLAY_HOOKS, betweenGames: (done) => (finish = done) });
    let ready = 0;
    t.nextGame(() => ready++);
    expect(t.adRunning()).toBe(false);
    t.nextGame(() => ready++);
    expect(t.adRunning()).toBe(true);
    expect(ready).toBe(1);
    finish();
    finish();
    expect(t.adRunning()).toBe(false);
    expect(ready).toBe(2);
  });

  test('a race that opens in pause starts nothing until the pause closes', () => {
    const { hooks, log } = recorder();
    const t = createGameplayTracker(hooks);
    t.race(true);
    expect(log).toEqual([]);
    t.race(false);
    expect(log).toEqual(['start']);
  });

  test('celebrate is happytime', () => {
    const { hooks, log } = recorder();
    createGameplayTracker(hooks).celebrate();
    expect(log).toEqual(['happy']);
  });

  test('the empty hooks do nothing', () => {
    expect(() => {
      NO_GAMEPLAY_HOOKS.gameplayStart();
      NO_GAMEPLAY_HOOKS.gameplayStop();
      NO_GAMEPLAY_HOOKS.betweenGames(() => undefined);
      NO_GAMEPLAY_HOOKS.happytime();
    }).not.toThrow();
  });

  test('the race screen reports to it only behind SDK_BUILD', () => {
    const race = readFileSync(fileURLToPath(new URL('../../src/ui/screens/race.ts', import.meta.url)), 'utf8');
    expect(race).toMatch(/if \(SDK_BUILD\) GAMEPLAY\.race\(pause\.open\);/);
    expect(race).toMatch(/if \(SDK_BUILD\) GAMEPLAY\.raceOver\(\);/);
  });
});
