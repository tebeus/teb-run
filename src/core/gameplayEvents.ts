// Il punto unico degli eventi di gioco per l'SDK di un portale (CrazyGames:
// `gameplayStart`, `gameplayStop`, `midgameAd`). Per il Basic Launch l'SDK
// è facoltativo e qui non c'è: `GAMEPLAY_HOOKS` non fa niente. Per il Full
// Launch basta sostituire `GAMEPLAY_HOOKS` con le chiamate dell'SDK; nessun
// altro modulo va toccato.
//
// Lo alimenta solo la schermata di gara (`ui/screens/race.ts`), e solo nella
// build crazygames (`GAMEPLAY_EVENTS_BUILD`): nelle altre il bundler lo toglie.
// - corsa che parte o riparte dalla pausa: `gameplayStart`;
// - pausa aperta, fine partita (game over, finale), uscita al titolo:
//   `gameplayStop`;
// - fra una partita e la successiva, prima del suo `gameplayStart`:
//   `betweenGames`, il posto del `midgameAd`. Un annuncio vero dovrà
//   zittire l'audio e tenere ferma la gara finché non finisce (la gara è già
//   sul semaforo); RESTART dal menu di pausa conta come partita nuova.

/** Ciò che l'SDK riceverà. */
export interface GameplayHooks {
  gameplayStart(): void;
  gameplayStop(): void;
  betweenGames(): void;
}

/** Nessun SDK: niente da chiamare. */
export const NO_GAMEPLAY_HOOKS: GameplayHooks = {
  gameplayStart: () => undefined,
  gameplayStop: () => undefined,
  betweenGames: () => undefined,
};

/** Gli eventi della gara, ridotti ai fronti che l'SDK vuole. */
export interface GameplayTracker {
  /** A ogni tick della gara: il menu di pausa è aperto? */
  race(paused: boolean): void;
  /** La gara è finita o abbandonata (uscita dalla schermata). */
  raceOver(): void;
}

/** Il tracciatore sopra `hooks`. */
export function createGameplayTracker(hooks: GameplayHooks): GameplayTracker {
  let inRace = false;
  let playing = false;
  let games = 0;
  return {
    race(paused) {
      if (!inRace) {
        inRace = true;
        if (games > 0) hooks.betweenGames();
        games++;
      }
      if (playing === !paused) return;
      playing = !paused;
      if (playing) hooks.gameplayStart();
      else hooks.gameplayStop();
    },
    raceOver() {
      inRace = false;
      if (!playing) return;
      playing = false;
      hooks.gameplayStop();
    },
  };
}

/** Le chiamate di oggi: nessuna. Qui si attaccherà l'SDK. */
export const GAMEPLAY_HOOKS: GameplayHooks = NO_GAMEPLAY_HOOKS;

/** Il tracciatore che la gara alimenta nella build crazygames. */
export const GAMEPLAY: GameplayTracker = /* @__PURE__ */ createGameplayTracker(GAMEPLAY_HOOKS);
