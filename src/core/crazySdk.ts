// L'SDK di CrazyGames v3, solo nella build crazygames (`SDK_BUILD`): lo
// alimenta il punto unico degli eventi di gioco (`core/gameplayEvents.ts`).
//
// Documentazione (docs.crazygames.com, letta il 21 ottobre 2026): lo script
// è `SDK_URL`, va avviato con `await CrazyGames.SDK.init()`, e ha tre
// ambienti: `crazygames` sul portale, `local` su localhost e 127.0.0.1 (la
// pubblicità è un riquadro di testo, gli eventi vanno in console), e
// `disabled` altrove, dove ogni chiamata lancia. Qui:
// - lo script si aggiunge senza bloccare niente e `init` non si aspetta mai:
//   il gioco parte uguale, offline, con lo script bloccato o in `disabled`;
// - finché l'SDK non è pronto (o se non lo sarà mai) nessuna chiamata parte;
//   quando arriva, si allinea allo stato di adesso (una gara in corso manda
//   `gameplayStart`, un caricamento in corso `loadingStart`);
// - `gameplayStart` e `gameplayStop` l'SDK li scarta se arrivano a meno di
//   un secondo dalla chiamata uguale precedente (`throttledMethod`, 1000 ms):
//   una pausa aperta e chiusa al volo perderebbe la seconda partenza, e il
//   portale crederebbe il gioco fermo. Qui si tiene lo stato voluto e si
//   manda solo quando l'SDK lo accetta, mai due uguali di fila;
// - `muteAudio` delle impostazioni del portale zittisce il gioco (vince su M).
// Ogni chiamata all'SDK sta in un try: un SDK che lancia non ferma il gioco.

/** Lo script della documentazione. È l'unica origine esterna della build crazygames (`check:builds`). */
export const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
/** L'intervallo sotto cui l'SDK scarta un `gameplayStart` (o `gameplayStop`) uguale al precedente. */
export const SDK_THROTTLE_MS = 1000;
/** Margine oltre il limite dell'SDK, per non cadere sul millisecondo sbagliato. */
const THROTTLE_MARGIN_MS = 50;

/** Le callback di una pubblicità, come le vuole `requestAd`. */
export interface AdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: unknown) => void;
}

/** Quello che serve dell'SDK v3 (`window.CrazyGames.SDK`). */
export interface CrazySdkLike {
  init(): Promise<unknown>;
  readonly environment?: string;
  game: {
    gameplayStart(): void;
    gameplayStop(): void;
    loadingStart(): void;
    loadingStop(): void;
    happytime(): void;
    readonly settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(listener: (settings: { muteAudio?: boolean }) => void): void;
  };
  ad: {
    requestAd(type: 'midgame', callbacks: AdCallbacks): unknown;
  };
}

/** Il mondo intorno all'SDK, iniettato (i test lo fingono). */
export interface SdkEnv {
  /** Carica lo script e dà l'SDK, o null se non c'è (offline, bloccato). */
  load(): Promise<CrazySdkLike | null>;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

/** Cosa sa fare il gioco per l'SDK. */
export interface SdkHooks {
  /** Da chiamare una volta, all'avvio: carica e avvia l'SDK in background. `mute` zittisce il gioco per il portale. */
  start(mute: (on: boolean) => void): void;
  /** Il caricamento degli asset comincia (true) o finisce (false). */
  loading(on: boolean): void;
  gameplayStart(): void;
  gameplayStop(): void;
  happytime(): void;
  /** L'SDK è pronto (ambiente `crazygames` o `local`)? */
  ready(): boolean;
  /** Chiede una pubblicità fra due partite; false se l'SDK non c'è (le callback allora non arriveranno). */
  requestMidgame(callbacks: AdCallbacks): boolean;
}

/** Gli ambienti in cui l'SDK funziona; in `disabled` ogni chiamata lancerebbe. */
const LIVE_ENVIRONMENTS = ['crazygames', 'local'];

/** Chiama `fn` ingoiando quello che lancia. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Un SDK che lancia (disabilitato, rotto) non ferma il gioco.
  }
}

export function createCrazySdk(env: SdkEnv): SdkHooks {
  let sdk: CrazySdkLike | null = null;
  let started = false;
  /** Il caricamento è in corso, e se `loadingStart` è già partito. */
  let loadingNow = false;
  let loadingSent = false;
  /** Lo stato di gioco voluto e quello mandato all'SDK. */
  let playing = false;
  let sentPlaying = false;
  /** Quando è partita l'ultima chiamata di ciascun tipo. */
  const last = { start: -Infinity, stop: -Infinity };
  let flushScheduled = false;

  const flush = (): void => {
    if (sdk === null || playing === sentPlaying) return;
    const kind = playing ? 'start' : 'stop';
    const wait = last[kind] + SDK_THROTTLE_MS + THROTTLE_MARGIN_MS - env.now();
    if (wait > 0) {
      if (!flushScheduled) {
        flushScheduled = true;
        env.setTimeout(() => {
          flushScheduled = false;
          flush();
        }, wait);
      }
      return;
    }
    const game = sdk.game;
    safely(() => (playing ? game.gameplayStart() : game.gameplayStop()));
    last[kind] = env.now();
    sentPlaying = playing;
  };

  const becomeReady = (s: CrazySdkLike, mute: (on: boolean) => void): void => {
    if (!LIVE_ENVIRONMENTS.includes(String(s.environment))) return;
    sdk = s;
    safely(() => mute(s.game.settings?.muteAudio === true));
    safely(() => s.game.addSettingsChangeListener?.((settings) => mute(settings?.muteAudio === true)));
    if (loadingNow) {
      safely(() => s.game.loadingStart());
      loadingSent = true;
    }
    flush();
  };

  return {
    start(mute) {
      if (started) return;
      started = true;
      void env
        .load()
        .then(async (s) => {
          if (s === null) return;
          await s.init();
          becomeReady(s, mute);
        })
        .catch(() => undefined);
    },
    loading(on) {
      loadingNow = on;
      if (sdk === null) return;
      const game = sdk.game;
      if (on && !loadingSent) {
        safely(() => game.loadingStart());
        loadingSent = true;
      } else if (!on && loadingSent) {
        safely(() => game.loadingStop());
        loadingSent = false;
      }
    },
    gameplayStart() {
      playing = true;
      flush();
    },
    gameplayStop() {
      playing = false;
      flush();
    },
    happytime() {
      const s = sdk;
      if (s !== null) safely(() => s.game.happytime());
    },
    ready: () => sdk !== null,
    requestMidgame(callbacks) {
      const s = sdk;
      if (s === null) return false;
      try {
        s.ad.requestAd('midgame', callbacks);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Il caricamento vero: lo script in fondo a <head>, asincrono; null se non arriva. */
export function loadSdkScript(doc: Document, win: Window & { CrazyGames?: { SDK?: CrazySdkLike } }): Promise<CrazySdkLike | null> {
  return new Promise((resolve) => {
    try {
      const script = doc.createElement('script');
      script.async = true;
      script.src = SDK_URL;
      script.onload = () => resolve(win.CrazyGames?.SDK ?? null);
      script.onerror = () => resolve(null);
      doc.head.appendChild(script);
    } catch {
      resolve(null);
    }
  });
}

/** L'ambiente del browser. */
export function browserSdkEnv(win: Window): SdkEnv {
  return {
    load: () => loadSdkScript(win.document, win),
    now: () => win.performance.now(),
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
  };
}
