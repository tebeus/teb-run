// L'SDK di CrazyGames, con un SDK finto che registra le chiamate e un
// orologio finto: niente attese per il gioco, niente chiamate prima che sia
// pronto o in `disabled`, `muteAudio`, caricamento, e il limite di un secondo
// che l'SDK mette fra due gameplayStart (o due gameplayStop). Poi l'ordine
// degli eventi su una partita intera, con una pausa e una scheda nascosta.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createCrazySdk, SDK_URL, type CrazySdkLike } from '../../src/core/crazySdk';
import { fakeEnv, fakeSdk } from '../helpers/fakeSdk';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createFakeRace } from '../../src/dev/fake-race';
import { createNullAudio } from '../../src/dev/null-audio';
import { createScoresStore } from '../../src/persist/scores';
import type { ScreenDeps } from '../../src/ui/deps';
import type { StageDef } from '../../src/types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the CrazyGames SDK', () => {
  test('the script is the one of the documentation', () => {
    expect(SDK_URL).toBe('https://sdk.crazygames.com/crazygames-sdk-v3.js');
  });

  test('no script (offline, blocked): every call does nothing, at once, and no ad is requested', async () => {
    const { env } = fakeEnv(async () => null);
    const sdk = createCrazySdk(env);
    sdk.start(() => undefined);
    await flush();
    expect(() => {
      sdk.loading(true);
      sdk.gameplayStart();
      sdk.gameplayStop();
      sdk.happytime();
    }).not.toThrow();
    expect(sdk.ready()).toBe(false);
    expect(sdk.requestMidgame({})).toBe(false);
  });

  test('a script that fails to load or an init that throws: still nothing, no error', async () => {
    for (const load of [async () => Promise.reject(new Error('net')), async () => ({ ...fakeSdk({ t: 0 }).sdk, init: async () => Promise.reject(new Error('init')) })]) {
      const { env } = fakeEnv(load as () => Promise<CrazySdkLike | null>);
      const sdk = createCrazySdk(env);
      sdk.start(() => undefined);
      await flush();
      expect(sdk.ready()).toBe(false);
    }
  });

  test('the "disabled" environment (any other domain): no call at all, since each would throw', async () => {
    const fake = fakeSdk({ t: 0 }, 'disabled');
    const { env } = fakeEnv(async () => fake.sdk);
    const sdk = createCrazySdk(env);
    sdk.start(() => undefined);
    await flush();
    sdk.gameplayStart();
    sdk.happytime();
    expect(fake.log).toEqual([]);
    expect(sdk.requestMidgame({})).toBe(false);
  });

  test('an SDK that throws on every call does not stop the game', async () => {
    const fake = fakeSdk({ t: 0 });
    const boom = () => {
      throw new Error('sdk');
    };
    Object.assign(fake.sdk.game, { gameplayStart: boom, gameplayStop: boom, happytime: boom, loadingStart: boom, loadingStop: boom });
    fake.sdk.ad.requestAd = boom;
    const { env } = fakeEnv(async () => fake.sdk);
    const sdk = createCrazySdk(env);
    sdk.start(() => undefined);
    sdk.loading(true);
    await flush();
    expect(() => {
      sdk.loading(false);
      sdk.gameplayStart();
      sdk.happytime();
    }).not.toThrow();
    expect(sdk.requestMidgame({})).toBe(false);
  });

  test('loading: start and stop around the assets, if the SDK is there in time; never a stop without a start', async () => {
    const early = fakeSdk({ t: 0 });
    const a = fakeEnv(async () => early.sdk);
    const sdk = createCrazySdk(a.env);
    sdk.start(() => undefined);
    sdk.loading(true);
    await flush();
    sdk.loading(false);
    expect(early.log).toEqual(['loadingStart', 'loadingStop']);

    const late = fakeSdk({ t: 0 });
    let arrive: (s: CrazySdkLike) => void = () => undefined;
    const b = fakeEnv(() => new Promise((resolve) => (arrive = resolve)));
    const sdk2 = createCrazySdk(b.env);
    sdk2.start(() => undefined);
    sdk2.loading(true);
    sdk2.loading(false);
    arrive(late.sdk);
    await flush();
    expect(late.log).toEqual([]);
  });

  test('a race already running when the SDK arrives gets its gameplayStart then', async () => {
    const fake = fakeSdk({ t: 0 });
    let arrive: (s: CrazySdkLike) => void = () => undefined;
    const { env } = fakeEnv(() => new Promise((resolve) => (arrive = resolve)));
    const sdk = createCrazySdk(env);
    sdk.start(() => undefined);
    sdk.gameplayStart();
    expect(fake.log).toEqual([]);
    arrive(fake.sdk);
    await flush();
    expect(fake.log).toEqual(['gameplayStart']);
  });

  test('muteAudio: at start, and at every change of the portal settings', async () => {
    const fake = fakeSdk({ t: 0 }, 'crazygames', { muteAudio: true });
    const { env } = fakeEnv(async () => fake.sdk);
    const muted: boolean[] = [];
    createCrazySdk(env).start((on) => muted.push(on));
    await flush();
    fake.listeners.forEach((fn) => fn({ muteAudio: false }));
    fake.listeners.forEach((fn) => fn({ muteAudio: true }));
    expect(muted).toEqual([true, false, true]);
  });

  test('a pause opened and closed within a second: the second start waits for the SDK to accept it; never two alike in a row', async () => {
    const { env, clock, advance } = fakeEnv(async () => fake.sdk);
    const fake = fakeSdk(clock);
    const sdk = createCrazySdk(env);
    sdk.start(() => undefined);
    await flush();
    sdk.gameplayStart();
    advance(200);
    sdk.gameplayStop();
    advance(200);
    sdk.gameplayStart();
    expect(fake.log).toEqual(['gameplayStart', 'gameplayStop']);
    advance(1000);
    expect(fake.log).toEqual(['gameplayStart', 'gameplayStop', 'gameplayStart']);
    expect(fake.dropped).toEqual([]);
  });

  test('a stop and a start both within the wait cancel out: nothing is sent', async () => {
    const { env, clock, advance } = fakeEnv(async () => fake.sdk);
    const fake = fakeSdk(clock);
    const sdk = createCrazySdk(env);
    sdk.start(() => undefined);
    await flush();
    sdk.gameplayStart();
    advance(100);
    sdk.gameplayStop();
    advance(100);
    sdk.gameplayStart();
    advance(100);
    sdk.gameplayStop();
    advance(5000);
    expect(fake.log).toEqual(['gameplayStart', 'gameplayStop']);
    expect(fake.dropped).toEqual([]);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('SDK events over a whole game (crazygames build)', () => {
  test('start, pause, resume, hidden tab, resume, game over: start/stop alternate, the autopause stops it, the start waits for the race', async () => {
    vi.stubEnv('VITE_TARGET', 'crazygames');
    vi.resetModules();
    const events = await import('../../src/core/gameplayEvents');
    const { createRaceScreen } = await import('../../src/ui/screens/race');
    const log: string[] = [];
    vi.spyOn(events.PORTAL_SDK, 'gameplayStart').mockImplementation(() => void log.push('start'));
    vi.spyOn(events.PORTAL_SDK, 'gameplayStop').mockImplementation(() => void log.push('stop'));
    let lost = false;
    const stage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 2260, timeLimit: 30, seed: 1, difficulty: 0.15 };
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: createNullAudio(),
      scores: createScoresStore(),
      raceFactory: (s, a) => createFakeRace(s, a),
      renderWorld: () => {},
      firstStage: stage,
      signals: {
        takeTap: () => null,
        takeFocusLost: () => {
          const l = lost;
          lost = false;
          return l;
        },
      },
    };
    const race = createRaceScreen(deps);
    const tick = (a = emptyActions()) => race.update(1 / 60, a);
    race.enter({ song: 0 });
    tick();
    tick();
    expect(log).toEqual(['start']);
    // P: pausa, poi P di nuovo: riprende.
    tick({ ...emptyActions(), pause: true });
    tick();
    expect(log).toEqual(['start', 'stop']);
    tick({ ...emptyActions(), pause: true });
    tick();
    expect(log).toEqual(['start', 'stop', 'start']);
    // La scheda nascosta: al ritorno la pausa automatica, e lo stop.
    lost = true;
    tick();
    tick();
    expect(log).toEqual(['start', 'stop', 'start', 'stop']);
    // Ferma finché il giocatore non riprende.
    for (let i = 0; i < 120; i++) tick();
    expect(log).toEqual(['start', 'stop', 'start', 'stop']);
    tick({ ...emptyActions(), pause: true });
    tick();
    expect(log).toEqual(['start', 'stop', 'start', 'stop', 'start']);
    // Fino al game over: la schermata cambia, ed esce con lo stop.
    let t = null;
    for (let i = 0; i < 60 * 40 && t === null; i++) t = tick();
    expect(t?.to).toBe('gameOver');
    race.exit?.();
    expect(log).toEqual(['start', 'stop', 'start', 'stop', 'start', 'stop']);
  });

  test('happytime on an ending, and on a game over only with a new record over an old one', async () => {
    vi.stubEnv('VITE_TARGET', 'crazygames');
    vi.resetModules();
    const events = await import('../../src/core/gameplayEvents');
    const { createGameOverScreen } = await import('../../src/ui/screens/gameOver');
    const { createEndingScreen } = await import('../../src/ui/screens/ending');
    const happy = vi.spyOn(events.PORTAL_SDK, 'happytime').mockImplementation(() => undefined);
    const scores = createScoresStore();
    const stage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 };
    const deps: ScreenDeps = { assets: createEmptyAssets(), audio: createNullAudio(), scores, raceFactory: () => createFakeRace(stage, createEmptyAssets()), renderWorld: () => {}, firstStage: stage };
    const over = createGameOverScreen(deps);
    over.enter({ score: 500, stage, route: [] }); // nessun record prima: niente festa
    expect(happy).toHaveBeenCalledTimes(0);
    scores.insert({ name: 'AAA', score: 1000, stageId: '0-0', route: '', date: '' });
    over.enter({ score: 900, stage, route: [] });
    expect(happy).toHaveBeenCalledTimes(0);
    over.enter({ score: 1001, stage, route: [] });
    expect(happy).toHaveBeenCalledTimes(1);
    createEndingScreen(deps).enter({ score: 5000, ending: 0, stage, route: [] });
    expect(happy).toHaveBeenCalledTimes(2);
  });

  test('portal: none of this, the screens call no SDK', async () => {
    vi.stubEnv('VITE_TARGET', 'portal');
    vi.resetModules();
    const events = await import('../../src/core/gameplayEvents');
    const { createRaceScreen } = await import('../../src/ui/screens/race');
    const { createEndingScreen } = await import('../../src/ui/screens/ending');
    const calls = ['gameplayStart', 'gameplayStop', 'happytime', 'requestMidgame', 'loading', 'start'].map((m) =>
      vi.spyOn(events.PORTAL_SDK, m as 'happytime').mockImplementation(() => undefined as never),
    );
    const stage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 2260, timeLimit: 3, seed: 1, difficulty: 0.15 };
    const deps: ScreenDeps = { assets: createEmptyAssets(), audio: createNullAudio(), scores: createScoresStore(), raceFactory: (s, a) => createFakeRace(s, a), renderWorld: () => {}, firstStage: stage };
    const race = createRaceScreen(deps);
    for (let game = 0; game < 2; game++) {
      race.enter({ song: 0 });
      for (let i = 0; i < 60 * 6; i++) race.update(1 / 60, emptyActions());
      race.exit?.();
    }
    createEndingScreen(deps).enter({ score: 1, ending: 0, stage, route: [] });
    for (const c of calls) expect(c).not.toHaveBeenCalled();
  });
});
