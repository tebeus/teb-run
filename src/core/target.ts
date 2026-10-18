// Le quattro build dello stesso codice. Il bersaglio lo fissa Vite al momento
// della build (`import.meta.env.VITE_TARGET`, vedi vite.config.ts) e il
// codice sceglie il comportamento solo da qui: nessun altro modulo legge la
// variabile.
//
// - private: `npm run dev` e `npm run build:private`, tutto incluso;
// - site: `npm run build:site` (e `npm run build`), per il sito proprio;
// - portal: `npm run build:portal`, zip per i portali, nessuna chiamata esterna;
// - crazygames: `npm run build:crazygames`, il portal per CrazyGames: niente
//   pulsante dello schermo intero (lo dà il portale), niente link ABOUT né
//   SHARE (porterebbero a tebrun.io, che ha il gioco in home: cross-promozione).

export type Target = 'private' | 'site' | 'portal' | 'crazygames';

export const TARGETS: readonly Target[] = ['private', 'site', 'portal', 'crazygames'];

/**
 * Bersaglio da un valore della variabile. Assente vale `private` (i test
 * unitari e gli strumenti di sviluppo girano senza Vite); un valore ignoto
 * lancia, perché una build pubblica che ricade in silenzio su `private`
 * porterebbe con sé tutto. Pura.
 */
export function parseTarget(value: string | undefined): Target {
  if (value === undefined || value === '') return 'private';
  if ((TARGETS as readonly string[]).includes(value)) return value as Target;
  throw new Error(`unknown build target: ${value}`);
}

/** Cosa accende o spegne ciascun bersaglio. */
export interface TargetFeatures {
  /** L'auto classica (`player_classic_*`, `ending_classic_*`): solo privata. */
  classicCar: boolean;
  /** Statistiche senza cookie (GoatCounter, `core/stats.ts`): solo il sito proprio. */
  stats: boolean;
  /** I link esterni (privacy, about) si aprono in una nuova scheda. */
  linksInNewTab: boolean;
  /** Il pulsante dello schermo intero (e il tasto F): CrazyGames lo vieta. */
  fullscreenButton: boolean;
  /** Il link ABOUT del titolo (tebrun.io, con il gioco in home). PRIVACY resta sempre. */
  aboutLink: boolean;
  /** SHARE a fine partita: la scheda e il testo portano l'indirizzo del sito. */
  share: boolean;
  /**
   * Il punto unico degli eventi di gioco per l'SDK di un portale
   * (`core/gameplayEvents.ts`): oggi non chiama niente.
   */
  gameplayEvents: boolean;
  /**
   * Il gancio di diagnostica `#debug` (`window.__tebrun`, per gli e2e): solo
   * privata e sviluppo. Nelle build pubbliche `#debug` non fa niente.
   */
  debugHook: boolean;
}

/** Le funzioni di un bersaglio. Pura. */
export function featuresOf(target: Target): TargetFeatures {
  return {
    classicCar: target === 'private',
    stats: target === 'site',
    linksInNewTab: target === 'portal' || target === 'crazygames',
    debugHook: target === 'private',
    fullscreenButton: target !== 'crazygames',
    aboutLink: target !== 'crazygames',
    share: target !== 'crazygames',
    gameplayEvents: target === 'crazygames',
  };
}

export const TARGET: Target = parseTarget(import.meta.env.VITE_TARGET as string | undefined);

export const FEATURES: TargetFeatures = featuresOf(TARGET);

/**
 * Vero se il gancio `#debug` va acceso: il bersaglio lo concede e l'indirizzo
 * finisce con `hash`. Pura.
 */
export function debugHookOn(features: TargetFeatures, hash: string, debugHash: string): boolean {
  return features.debugHook && hash === debugHash;
}

/**
 * `FEATURES.stats` come confronto letterale con la variabile che Vite
 * sostituisce: il bundler lo risolve a `false` nelle build private e portal e
 * toglie il codice delle statistiche con il loro indirizzo, che così non
 * compare in nessun file. Vale sempre quanto `FEATURES.stats` (test).
 */
export const STATS_BUILD: boolean = import.meta.env.VITE_TARGET === 'site';

/**
 * Gli altri flag che tolgono codice, come `STATS_BUILD`: confronti letterali
 * che il bundler risolve, così nella build crazygames spariscono il codice
 * dello schermo intero (`requestFullscreen`), l'indirizzo di ABOUT e la
 * scheda di SHARE con l'indirizzo del sito, e nelle altre build il punto
 * degli eventi di gioco. Valgono sempre quanto i flag di `FEATURES` (test).
 */
export const FULLSCREEN_BUILD: boolean = import.meta.env.VITE_TARGET !== 'crazygames';
export const ABOUT_BUILD: boolean = import.meta.env.VITE_TARGET !== 'crazygames';
export const SHARE_BUILD: boolean = import.meta.env.VITE_TARGET !== 'crazygames';
export const GAMEPLAY_EVENTS_BUILD: boolean = import.meta.env.VITE_TARGET === 'crazygames';
