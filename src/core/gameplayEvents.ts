// Il punto unico degli eventi di gioco per l'SDK del portale (CrazyGames:
// `gameplayStart`, `gameplayStop`, `happytime`, `midgameAd`). Le chiamate
// vere stanno in `core/crazySdk.ts`; qui c'è solo cosa il gioco racconta.
//
// Lo alimentano la schermata di gara (`ui/screens/race.ts`) e quelle di
// fine partita, e solo nella build crazygames (`SDK_BUILD`): nelle altre il
// bundler lo toglie, SDK e indirizzo compresi.
// - corsa che parte o riparte dalla pausa: `gameplayStart`;
// - pausa aperta (anche quella automatica, per il fuoco perso o la scheda
//   nascosta), fine partita (game over, finale), uscita al titolo:
//   `gameplayStop`;
// - un nuovo record personale, un finale: `happytime` (`celebrate`);
// - fra una partita e la successiva, prima del suo `gameplayStart`: il
//   `midgameAd` (`nextGame`). Mai prima della prima partita della sessione,
//   mai in gara né in pausa; la frequenza la regola l'SDK (al massimo una
//   ogni tre minuti, contando l'inizio: le richieste in anticipo le scarta
//   con `adError`). Arriva dall'avvio della gara, cioè da RETRY, da RESTART
//   della pausa o da START della radio dopo il titolo: mai da un pulsante
//   che porta al menu (regole del portale).
//
// Durante la pubblicità la gara è ferma sulla griglia con l'input ignorato
// (`adRunning`), e su `adStarted` l'audio tace (`setHostMute('ad')`, che
// lascia M com'era). `adFinished` o `adError` fanno ripartire subito; senza
// SDK si parte senza chiedere niente. Se l'SDK non risponde affatto entro
// `AD_ANSWER_TIMEOUT_MS` si parte lo stesso; una pubblicità che cominciasse
// dopo, a gara partita, la zittisce e la mette in pausa (`interrupt`).

import { browserSdkEnv, createCrazySdk, type SdkEnv, type SdkHooks } from './crazySdk';

/** Ciò che l'SDK riceve. */
export interface GameplayHooks {
  gameplayStart(): void;
  gameplayStop(): void;
  /** Fra due partite: la pubblicità, poi `done` (una volta sola). */
  betweenGames(done: () => void): void;
  happytime(): void;
}

/** Nessun SDK: niente da chiamare, e fra due partite si parte subito. */
export const NO_GAMEPLAY_HOOKS: GameplayHooks = {
  gameplayStart: () => undefined,
  gameplayStop: () => undefined,
  betweenGames: (done) => done(),
  happytime: () => undefined,
};

/** Gli eventi della gara, ridotti ai fronti che l'SDK vuole. */
export interface GameplayTracker {
  /**
   * Una partita sta per cominciare (la gara si apre): dalla seconda della
   * sessione in poi, prima la pubblicità. `ready` si chiama quando si può
   * partire, anche subito (dentro questa chiamata).
   */
  nextGame(ready: () => void): void;
  /** È in corso una pubblicità fra due partite (dalla richiesta alla fine)? L'input aspetta. */
  adRunning(): boolean;
  /** A ogni tick della gara: il menu di pausa è aperto? */
  race(paused: boolean): void;
  /** La gara è finita o abbandonata (uscita dalla schermata). */
  raceOver(): void;
  /** Un momento da festeggiare: un nuovo record, un finale. */
  celebrate(): void;
}

/** Il tracciatore sopra `hooks`. */
export function createGameplayTracker(hooks: GameplayHooks): GameplayTracker {
  let playing = false;
  let games = 0;
  let waiting = false;
  return {
    nextGame(ready) {
      const first = games === 0;
      games++;
      if (first) {
        ready();
        return;
      }
      waiting = true;
      let called = false;
      hooks.betweenGames(() => {
        if (called) return;
        called = true;
        waiting = false;
        ready();
      });
    },
    adRunning: () => waiting,
    race(paused) {
      if (playing === !paused) return;
      playing = !paused;
      if (playing) hooks.gameplayStart();
      else hooks.gameplayStop();
    },
    raceOver() {
      if (!playing) return;
      playing = false;
      hooks.gameplayStop();
    },
    celebrate() {
      hooks.happytime();
    },
  };
}

/** Quanto si aspetta una risposta qualsiasi dell'SDK a una richiesta di pubblicità, prima di partire lo stesso. */
export const AD_ANSWER_TIMEOUT_MS = 8000;

/** Cosa serve alla pubblicità oltre all'SDK: lo assegna `main.ts`. */
export interface AdEnv {
  /** Zittisce il gioco per la pubblicità (`setHostMute('ad', on)`). */
  mute(on: boolean): void;
  /** Una pubblicità cominciata a gara già partita: la gara va in pausa. */
  interrupt(): void;
  setTimeout(fn: () => void, ms: number): unknown;
}

/** I ganci sopra l'SDK di CrazyGames. */
export function sdkGameplayHooks(sdk: SdkHooks, ad: AdEnv): GameplayHooks {
  return {
    gameplayStart: () => sdk.gameplayStart(),
    gameplayStop: () => sdk.gameplayStop(),
    betweenGames(done) {
      let over = false;
      let started = false;
      const finish = (): void => {
        if (started) ad.mute(false);
        started = false;
        if (over) return;
        over = true;
        done();
      };
      const asked = sdk.requestMidgame({
        // Muto solo quando la pubblicità comincia davvero, non alla richiesta
        // (regole del portale: spesso non ce n'è nessuna).
        adStarted: () => {
          started = true;
          ad.mute(true);
          if (over) ad.interrupt();
        },
        adFinished: finish,
        adError: finish,
      });
      if (!asked) {
        finish();
        return;
      }
      ad.setTimeout(() => {
        if (!started && !over) {
          over = true;
          done();
        }
      }, AD_ANSWER_TIMEOUT_MS);
    },
    happytime: () => sdk.happytime(),
  };
}

/** L'ambiente della pubblicità: muto e pausa li collega `main.ts`. */
export const AD_ENV: AdEnv = {
  mute: () => undefined,
  interrupt: () => undefined,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

/** L'ambiente del browser, letto solo quando l'SDK parte (`start`): il modulo si importa anche senza finestra. */
const lazyBrowserEnv: SdkEnv = {
  load: () => browserSdkEnv(window).load(),
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

/** L'SDK della build crazygames: `main.ts` lo avvia, gli eventi ci arrivano dal tracciatore. */
export const PORTAL_SDK: SdkHooks = /* @__PURE__ */ createCrazySdk(lazyBrowserEnv);

/** Il tracciatore che gara e fine partita alimentano nella build crazygames. */
export const GAMEPLAY: GameplayTracker = /* @__PURE__ */ createGameplayTracker(/* @__PURE__ */ sdkGameplayHooks(PORTAL_SDK, AD_ENV));
