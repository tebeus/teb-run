// Un SDK di CrazyGames finto e un orologio finto, per i test dell'SDK e
// della pubblicità fra due partite.

import { SDK_THROTTLE_MS, type AdCallbacks, type CrazySdkLike, type SdkEnv } from '../../src/core/crazySdk';

/** Un SDK finto: registra le chiamate, con un `throttledMethod` come il vero (scarta la stessa chiamata entro 1 s). */
export function fakeSdk(clock: { t: number }, environment = 'local', settings: { muteAudio?: boolean } = {}) {
  const log: string[] = [];
  const dropped: string[] = [];
  const lastAt: Record<string, number> = {};
  const listeners: ((s: { muteAudio?: boolean }) => void)[] = [];
  const ads: AdCallbacks[] = [];
  const throttled = (name: string) => () => {
    if (clock.t - (lastAt[name] ?? -Infinity) <= SDK_THROTTLE_MS) {
      dropped.push(name);
      return;
    }
    lastAt[name] = clock.t;
    log.push(name);
  };
  const sdk: CrazySdkLike = {
    init: async () => undefined,
    environment,
    game: {
      gameplayStart: throttled('gameplayStart'),
      gameplayStop: throttled('gameplayStop'),
      happytime: throttled('happytime'),
      loadingStart: () => void log.push('loadingStart'),
      loadingStop: () => void log.push('loadingStop'),
      settings,
      addSettingsChangeListener: (fn) => void listeners.push(fn),
    },
    ad: {
      requestAd: (_type, cb) => {
        log.push('requestAd');
        ads.push(cb);
      },
    },
  };
  return { sdk, log, dropped, listeners, ads };
}

/** Un orologio e dei timer finti, fatti avanzare a mano. */
export function fakeEnv(load: () => Promise<CrazySdkLike | null>) {
  const clock = { t: 0 };
  const timers: { at: number; fn: () => void }[] = [];
  const env: SdkEnv = {
    load,
    now: () => clock.t,
    setTimeout: (fn, ms) => void timers.push({ at: clock.t + ms, fn }),
  };
  const advance = (ms: number): void => {
    clock.t += ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= clock.t).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  return { env, clock, advance };
}

