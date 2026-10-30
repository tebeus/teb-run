// Ciò che game over e finali decidono all'ingresso, comune ai due (spec
// classifica e sfida, §3.3): se chiedere le iniziali, quale record mostrare,
// dove porta RETRY. Fuori da DAILY: la TOP 10 locale della modalità, più la
// top 10 mondiale di oggi se è già arrivata. In DAILY: il record locale della
// sfida di oggi (che si aggiorna qui) e la top 10 mondiale DAILY; la TOP 10
// locale no, perché il traffico è un altro.

import { GAMEPLAY } from '../core/gameplayEvents';
import { SDK_BUILD } from '../core/target';
import { dailyKey, type DailyChallenge } from '../shared/daily';
import type { ScreenDeps } from './deps';
import { nextChallengeLine } from './dailySession';
import { streakLine } from '../persist/streak';
import { go, type Transition } from './fsm';
import { bestLine, isNewBest, personalBest } from './retryMenu';
import type { StageDef } from '../types';
import { visitedStages } from '../render/routeMap';

export interface EndOfGame {
  /** La sfida della partita, o null. */
  daily: DailyChallenge | null;
  /** Prima di RETRY, le iniziali (CONTINUE). */
  qualifies: boolean;
  /** `NEW BEST!`, `BEST 9000`, `NEW DAILY BEST!`, `DAILY BEST 9000`. */
  bestText: string;
  /** `NEW CHALLENGE IN 5H 12M`, solo in DAILY; con la serie davanti da 2 giorni: `DAY 3 IN A ROW · NEW CHALLENGE IN 5H 12M`. */
  nextLine: string | null;
}

/** `NEW DAILY BEST!` o `DAILY BEST <punteggio>`; il primo punteggio di oggi è un record. Pura. */
export function dailyBestLine(score: number, best: number | null): string {
  return best === null || isNewBest(score, best) ? 'NEW DAILY BEST!' : `DAILY BEST ${best}`;
}

/** La riga di fine partita DAILY con la serie davanti, se si mostra. Pura. */
export function withStreak(count: number, next: string): string {
  const line = streakLine(count);
  return line === null ? next : `${line} · ${next}`;
}

/** Decide e registra, all'ingresso di game over o finale. `celebrated`: il finale fa già festa da sé. */
export function enterEndOfGame(
  deps: ScreenDeps,
  run: { score: number; stage: StageDef; route: readonly ('L' | 'R')[] },
  celebrated: boolean,
): EndOfGame {
  const now = new Date(deps.now?.() ?? Date.now());
  // Le tappe raggiunte, per la mappa della pagina ENDINGS (spec telefono e finali §C).
  deps.endings?.recordStages(visitedStages(run.route));
  const daily = deps.daily?.current() ?? null;
  const mode = deps.mode?.get() ?? 'normal';
  if (daily !== null) {
    const prev = deps.dailyStore?.best(daily.key) ?? null;
    const isNew = deps.dailyStore?.record(daily.key, {
      score: run.score,
      car: daily.car,
      mode: daily.mode,
      stageId: run.stage.id,
      route: run.route.join(''),
    });
    // La festa del portale su un nuovo record DAILY di oggi (non sul primo punteggio del giorno).
    if (SDK_BUILD && !celebrated && prev !== null && isNew === true) GAMEPLAY.celebrate();
    return {
      daily,
      qualifies: deps.board?.wouldQualify(mode, 'daily', run.score) === true,
      bestText: dailyBestLine(run.score, prev?.score ?? null),
      nextLine: withStreak(deps.streak?.current(dailyKey(now)) ?? 0, nextChallengeLine(now)),
    };
  }
  const best = personalBest(deps.scores.load());
  // La festa del portale su un nuovo record (non sul primo punteggio di tutti).
  if (SDK_BUILD && !celebrated && best > 0 && isNewBest(run.score, best)) GAMEPLAY.celebrate();
  return {
    daily: null,
    qualifies: deps.scores.qualifies(run.score) || deps.board?.wouldQualify(mode, 'today', run.score) === true,
    bestText: bestLine(run.score, best),
    nextLine: null,
  };
}

/**
 * Dove porta RETRY: la gara con lo stesso brano, o, se la sfida della
 * partita non è più quella di oggi (è passata la mezzanotte UTC), la
 * schermata della sfida, che apre quella nuova e la fa vedere.
 */
export function retryTarget(deps: ScreenDeps): (song: number) => Transition {
  return (song) => {
    const daily = deps.daily?.current() ?? null;
    if (daily !== null && daily.key !== dailyKey(new Date(deps.now?.() ?? Date.now()))) return go('daily', undefined);
    return go('race', { song });
  };
}
