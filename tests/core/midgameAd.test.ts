// La pubblicità fra due partite (build crazygames). Prima i ganci sopra un
// SDK finto: mai alla prima partita, muto solo quando comincia davvero, si
// riparte subito su adFinished o adError, senza SDK non si chiede niente, e
// senza risposta si parte lo stesso. Poi l'app intera: dopo un game over
// RETRY (o MENU, titolo, radio, START) chiede la pubblicità, la gara aspetta
// sulla griglia con l'input ignorato (M compreso), l'audio tace e riprende
// com'era; se la pubblicità fallisce, RETRY parte subito.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createCrazySdk } from '../../src/core/crazySdk';
import { AD_ANSWER_TIMEOUT_MS, createGameplayTracker, sdkGameplayHooks, type AdEnv } from '../../src/core/gameplayEvents';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createFakeRace } from '../../src/dev/fake-race';
import { createNullAudio } from '../../src/dev/null-audio';
import type { ScoresStore } from '../../src/persist/scores';
import { RETRY_INPUT_DELAY_S } from '../../src/ui/retryMenu';
import type { ScreenDeps } from '../../src/ui/deps';
import type { AdCallbacks } from '../../src/core/crazySdk';
import type { Actions, StageDef } from '../../src/types';
import { fakeEnv, fakeSdk } from '../helpers/fakeSdk';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function adRig(withSdk = true) {
  const f = fakeEnv(async () => (withSdk ? fake.sdk : null));
  const fake = fakeSdk(f.clock);
  const sdk = createCrazySdk(f.env);
  sdk.start(() => undefined);
  await flush();
  const log: string[] = [];
  const ad: AdEnv = {
    mute: (on) => void log.push(on ? 'mute' : 'unmute'),
    interrupt: () => void log.push('interrupt'),
    setTimeout: (fn, ms) => f.env.setTimeout(fn, ms),
  };
  const tracker = createGameplayTracker(sdkGameplayHooks(sdk, ad));
  const ready = () => log.push('ready');
  return { fake, tracker, log, ready, advance: f.advance };
}

describe('midgame ad hooks', () => {
  test('never before the first game of the session', async () => {
    const { fake, tracker, log, ready } = await adRig();
    tracker.nextGame(ready);
    expect(fake.log).not.toContain('requestAd');
    expect(log).toEqual(['ready']);
  });

  test('between two games: asked, muted only once it starts, unmuted and ready when it finishes', async () => {
    const { fake, tracker, log, ready } = await adRig();
    tracker.nextGame(ready);
    tracker.nextGame(ready);
    expect(fake.log).toEqual(['requestAd']);
    expect(log).toEqual(['ready']);
    expect(tracker.adRunning()).toBe(true);
    fake.ads[0].adStarted?.();
    expect(log).toEqual(['ready', 'mute']);
    fake.ads[0].adFinished?.();
    expect(log).toEqual(['ready', 'mute', 'unmute', 'ready']);
    expect(tracker.adRunning()).toBe(false);
  });

  test('no ad (unfilled, cooldown, Basic Launch): adError and the game starts at once, never muted', async () => {
    const { fake, tracker, log, ready } = await adRig();
    tracker.nextGame(ready);
    tracker.nextGame(ready);
    fake.ads[0].adError?.({ code: 'adsDisabledBasicLaunch' });
    expect(log).toEqual(['ready', 'ready']);
  });

  test('no SDK (offline, blocked, local test): nothing asked, ready at once', async () => {
    const { fake, tracker, log, ready } = await adRig(false);
    tracker.nextGame(ready);
    tracker.nextGame(ready);
    expect(fake.log).toEqual([]);
    expect(log).toEqual(['ready', 'ready']);
  });

  test('no answer at all: after the timeout the game starts; an ad that starts later mutes and pauses, and unmutes at its end', async () => {
    const { fake, tracker, log, ready, advance } = await adRig();
    tracker.nextGame(ready);
    tracker.nextGame(ready);
    advance(AD_ANSWER_TIMEOUT_MS - 1);
    expect(log).toEqual(['ready']);
    advance(1);
    expect(log).toEqual(['ready', 'ready']);
    fake.ads[0].adStarted?.();
    fake.ads[0].adFinished?.();
    expect(log).toEqual(['ready', 'ready', 'mute', 'interrupt', 'unmute']);
  });

  test('an ad that started is never cut by the timeout', async () => {
    const { fake, tracker, log, ready, advance } = await adRig();
    tracker.nextGame(ready);
    tracker.nextGame(ready);
    fake.ads[0].adStarted?.();
    advance(AD_ANSWER_TIMEOUT_MS * 4);
    expect(log).toEqual(['ready', 'mute']);
    fake.ads[0].adFinished?.();
    expect(log).toEqual(['ready', 'mute', 'unmute', 'ready']);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

const never: ScoresStore = { load: () => [], qualifies: () => false, insert: () => -1, clear: () => {} };
const act = (a: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...a });

/** L'app della build crazygames, con l'SDK finto al posto di `requestMidgame`. */
async function crazyApp(answer: 'hold' | 'error') {
  vi.stubEnv('VITE_TARGET', 'crazygames');
  vi.resetModules();
  const events = await import('../../src/core/gameplayEvents');
  const { createApp } = await import('../../src/ui/app');
  const ads: AdCallbacks[] = [];
  const requests = vi.spyOn(events.PORTAL_SDK, 'requestMidgame').mockImplementation((cb) => {
    ads.push(cb);
    if (answer === 'error') cb.adError?.({ code: 'unfilled' });
    return true;
  });
  const mutes: string[] = [];
  events.AD_ENV.mute = (on) => void mutes.push(on ? 'mute' : 'unmute');
  let toggles = 0;
  const songs: number[] = [];
  let engineTicks = 0;
  const stage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 2260, timeLimit: 3, seed: 1, difficulty: 0.15 };
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
    audio: { ...createNullAudio(), available: true, toggleMute: () => (toggles++, false), playSong: (i: number) => void songs.push(i) },
    scores: never,
    raceFactory: (s, a) => {
      const inner = createFakeRace(s, a);
      return { snapshot: () => inner.snapshot(), update: (dt, x) => (engineTicks++, inner.update(dt, x)) };
    },
    attractFactory: (s, a) => createFakeRace(s, a),
    renderWorld: () => {},
    firstStage: stage,
    inputLocked: () => events.GAMEPLAY.adRunning(),
  };
  const app = createApp(deps);
  const playToGameOver = () => {
    for (let i = 0; i < 6 && app.name === 'race'; i++) app.update(1, act());
    expect(app.name).toBe('gameOver');
    app.update(RETRY_INPUT_DELAY_S, act());
  };
  return { app, requests, ads, mutes, songs, toggles: () => toggles, ticks: () => engineTicks, playToGameOver };
}

describe('midgame ad in the whole game (crazygames build)', () => {
  test('first game: no ad; RETRY: the ad first, the race waiting with input ignored, then audio as before and the race', async () => {
    const r = await crazyApp('hold');
    r.app.update(1 / 60, act({ confirm: true }));
    r.app.update(1 / 60, act({ confirm: true }));
    expect(r.app.name).toBe('race');
    expect(r.requests).not.toHaveBeenCalled();
    r.playToGameOver();
    const songsBefore = r.songs.length;
    r.app.update(1 / 60, act({ confirm: true })); // RETRY
    expect(r.app.name).toBe('race');
    expect(r.requests).toHaveBeenCalledTimes(1);
    // In attesa: niente motore, niente musica, M e la pausa ignorati.
    const ticks = r.ticks();
    for (let i = 0; i < 30; i++) r.app.update(1 / 60, act({ mute: true, pause: true, accelerate: true }));
    expect(r.ticks()).toBe(ticks);
    expect(r.songs.length).toBe(songsBefore);
    expect(r.toggles()).toBe(0);
    expect(r.mutes).toEqual([]);
    r.ads[0].adStarted?.();
    expect(r.mutes).toEqual(['mute']);
    r.ads[0].adFinished?.();
    expect(r.mutes).toEqual(['mute', 'unmute']);
    r.app.update(1 / 60, act());
    r.app.update(1 / 60, act());
    expect(r.ticks()).toBeGreaterThan(ticks);
    expect(r.songs.length).toBe(songsBefore + 1);
    // Dopo la pubblicità M torna a funzionare.
    r.app.update(1 / 60, act({ mute: true }));
    expect(r.toggles()).toBe(1);
  });

  test('a failed ad: RETRY races at once, no mute', async () => {
    const r = await crazyApp('error');
    r.app.update(1 / 60, act({ confirm: true }));
    r.app.update(1 / 60, act({ confirm: true }));
    r.playToGameOver();
    const ticks = r.ticks();
    r.app.update(1 / 60, act({ confirm: true }));
    expect(r.requests).toHaveBeenCalledTimes(1);
    r.app.update(1 / 60, act());
    expect(r.ticks()).toBe(ticks + 1);
    expect(r.mutes).toEqual([]);
  });

  test('MENU, title, radio, START: the ad comes before that game too, not on the MENU button', async () => {
    const r = await crazyApp('error');
    r.app.update(1 / 60, act({ confirm: true }));
    r.app.update(1 / 60, act({ confirm: true }));
    r.playToGameOver();
    r.app.update(1 / 60, act({ back: true })); // MENU
    expect(r.app.name).toBe('title');
    expect(r.requests).not.toHaveBeenCalled();
    r.app.update(1 / 60, act({ confirm: true }));
    expect(r.requests).not.toHaveBeenCalled();
    r.app.update(1 / 60, act({ confirm: true }));
    expect(r.app.name).toBe('race');
    expect(r.requests).toHaveBeenCalledTimes(1);
  });
});
