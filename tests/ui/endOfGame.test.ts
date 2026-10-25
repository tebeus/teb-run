// Fine partita (game over e finali) in DAILY e fuori (spec §3.3): record
// della sfida di oggi in locale, iniziali solo se la top 10 mondiale le
// vuole, NEW CHALLENGE IN, RETRY sulla sfida (o sulla nuova dopo
// mezzanotte); fuori da DAILY la TOP 10 locale e, se arrivata, la mondiale
// di oggi. Nella build crazygames happytime su un nuovo record DAILY.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createFakeRace } from '../../src/dev/fake-race';
import { createNullAudio } from '../../src/dev/null-audio';
import { createDailyStore } from '../../src/persist/daily';
import { dailyChallenge } from '../../src/shared/daily';
import { createDailySession } from '../../src/ui/dailySession';
import { RETRY_INPUT_DELAY_S } from '../../src/ui/retryMenu';
import type { BoardClient, BoardName } from '../../src/net/types';
import type { ScoresStore } from '../../src/persist/scores';
import type { Actions, StageDef } from '../../src/types';
import type { ScreenDeps } from '../../src/ui/deps';

const act = (a: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...a });
const stage: StageDef = { id: '2-1', name: 'Pine Pass', theme: 'alpine', lengthSegments: 100, timeLimit: 80, seed: 1, difficulty: 0.45 };
const NOON = Date.parse('2026-10-24T12:00:00Z');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

function scoresWith(qualifies: boolean): ScoresStore {
  return { load: () => [{ name: 'AAA', score: 5000, stageId: '1-0', route: 'L', date: '' }], qualifies: () => qualifies, insert: () => 1, clear: () => {} };
}

function setup(opts: { daily: boolean; localQualifies?: boolean; world?: Partial<Record<BoardName, boolean | null>>; now?: number }) {
  let now = opts.now ?? NOON;
  const session = createDailySession();
  if (opts.daily) session.start(dailyChallenge('2026-10-24'));
  const asked: BoardName[] = [];
  const board: Partial<BoardClient> = {
    wouldQualify: (_m, b) => {
      asked.push(b);
      return opts.world?.[b] ?? null;
    },
  };
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
    audio: createNullAudio(),
    scores: scoresWith(opts.localQualifies ?? false),
    raceFactory: (s, a) => createFakeRace(s, a),
    renderWorld: () => {},
    firstStage: stage,
    now: () => now,
    daily: session,
    dailyStore: createDailyStore(),
    board: board as BoardClient,
  };
  return { deps, asked, setNow: (t: number) => (now = t) };
}

const payload = (score: number) => ({ score, stage, route: ['R', 'L'] as ('L' | 'R')[], time: 200, song: 2 });

async function gameOver(deps: ScreenDeps) {
  const { createGameOverScreen } = await import('../../src/ui/screens/gameOver');
  return createGameOverScreen(deps);
}

describe('end of a DAILY game', () => {
  test('the local record of today: first run, a worse one, a better one', async () => {
    const { enterEndOfGame } = await import('../../src/ui/endOfGame');
    const { deps } = setup({ daily: true });
    expect(enterEndOfGame(deps, payload(1000), false).bestText).toBe('NEW DAILY BEST!');
    expect(enterEndOfGame(deps, payload(800), false).bestText).toBe('DAILY BEST 1000');
    expect(enterEndOfGame(deps, payload(1500), false).bestText).toBe('NEW DAILY BEST!');
    expect(deps.dailyStore!.best('2026-10-24')?.score).toBe(1500);
  });

  test('initials only if the world DAILY top 10 wants them; the local TOP 10 is not asked', async () => {
    const { enterEndOfGame } = await import('../../src/ui/endOfGame');
    const yes = setup({ daily: true, localQualifies: true, world: { daily: true } });
    expect(enterEndOfGame(yes.deps, payload(1000), false).qualifies).toBe(true);
    expect(yes.asked).toEqual(['daily']);
    const offline = setup({ daily: true, localQualifies: true });
    expect(enterEndOfGame(offline.deps, payload(1000), false).qualifies).toBe(false);
  });

  test('NEW CHALLENGE IN, and RETRY: the race on the same day, the daily screen after midnight', async () => {
    const r = setup({ daily: true, now: Date.parse('2026-10-24T23:59:00Z') });
    const screen = await gameOver(r.deps);
    screen.enter(payload(100));
    screen.update(RETRY_INPUT_DELAY_S, act());
    expect(screen.update(1 / 60, act({ confirm: true }))?.to).toBe('race');
    screen.enter(payload(100));
    r.setNow(Date.parse('2026-10-25T00:00:30Z'));
    screen.update(RETRY_INPUT_DELAY_S, act());
    expect(screen.update(1 / 60, act({ confirm: true }))?.to).toBe('daily');
    const { enterEndOfGame } = await import('../../src/ui/endOfGame');
    expect(enterEndOfGame(r.deps, payload(1), false).nextLine).toBe('NEW CHALLENGE IN 23H 59M');
  });
});

describe('end of a normal game', () => {
  test('the local TOP 10, or the world one of today when it has arrived', async () => {
    const { enterEndOfGame } = await import('../../src/ui/endOfGame');
    expect(enterEndOfGame(setup({ daily: false, localQualifies: true }).deps, payload(10), false).qualifies).toBe(true);
    expect(enterEndOfGame(setup({ daily: false }).deps, payload(10), false).qualifies).toBe(false);
    const world = setup({ daily: false, world: { today: true } });
    expect(enterEndOfGame(world.deps, payload(10), false)).toMatchObject({ qualifies: true, bestText: 'BEST 5000', nextLine: null });
    expect(world.asked).toEqual(['today']);
  });
});

describe('crazygames: happytime on a new DAILY record', () => {
  test('not on the first run of the day, yes on a better one, not on a worse one', async () => {
    vi.stubEnv('VITE_TARGET', 'crazygames');
    vi.resetModules();
    const events = await import('../../src/core/gameplayEvents');
    const party = vi.spyOn(events.GAMEPLAY, 'celebrate').mockImplementation(() => undefined);
    const { enterEndOfGame } = await import('../../src/ui/endOfGame');
    const { deps } = setup({ daily: true });
    enterEndOfGame(deps, payload(1000), false);
    expect(party).not.toHaveBeenCalled();
    enterEndOfGame(deps, payload(900), false);
    expect(party).not.toHaveBeenCalled();
    enterEndOfGame(deps, payload(1200), false);
    expect(party).toHaveBeenCalledTimes(1);
    // Un finale fa già festa da sé: niente seconda.
    enterEndOfGame(deps, payload(5000), true);
    expect(party).toHaveBeenCalledTimes(1);
  });
});
