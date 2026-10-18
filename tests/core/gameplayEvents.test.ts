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
      betweenGames: () => log.push('between'),
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

  test('the next game opens with betweenGames, before its start (the midgameAd place)', () => {
    const { hooks, log } = recorder();
    const t = createGameplayTracker(hooks);
    t.race(false);
    t.raceOver();
    t.race(false);
    t.raceOver();
    expect(log).toEqual(['start', 'stop', 'between', 'start', 'stop']);
  });

  test('a race that opens in pause starts nothing until the pause closes', () => {
    const { hooks, log } = recorder();
    const t = createGameplayTracker(hooks);
    t.race(true);
    expect(log).toEqual([]);
    t.race(false);
    expect(log).toEqual(['start']);
  });

  test('the hooks do nothing today: no SDK in this build', () => {
    expect(() => {
      NO_GAMEPLAY_HOOKS.gameplayStart();
      NO_GAMEPLAY_HOOKS.gameplayStop();
      NO_GAMEPLAY_HOOKS.betweenGames();
    }).not.toThrow();
  });

  test('the race screen reports to it only behind GAMEPLAY_EVENTS_BUILD', () => {
    const race = readFileSync(fileURLToPath(new URL('../../src/ui/screens/race.ts', import.meta.url)), 'utf8');
    expect(race).toMatch(/if \(GAMEPLAY_EVENTS_BUILD\) GAMEPLAY\.race\(pause\.open\);/);
    expect(race).toMatch(/if \(GAMEPLAY_EVENTS_BUILD\) GAMEPLAY\.raceOver\(\);/);
  });
});
