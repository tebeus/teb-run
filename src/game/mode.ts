import type { Difficulty, StageDef } from '../types';
import type { StageGraph } from './stage-graph';
import { STAGE_TIME_LIMITS_HARD } from './timer';

/** Modalità di chi non ha scelto: la taratura di sempre. */
export const DEFAULT_MODE: Difficulty = 'normal';

/** Le modalità nell'ordine in cui il tasto D le propone. */
export const MODES: readonly Difficulty[] = ['normal', 'hard'];

/**
 * Veicoli per tappa rispetto a NORMAL (collaudo utente: due livelli di
 * difficoltà). HARD ne ha 1,6 volte tanti.
 */
export const TRAFFIC_COUNT_FACTOR: Readonly<Record<Difficulty, number>> = { normal: 1, hard: 1.6 };

/**
 * Velocità del traffico rispetto a NORMAL. In HARD ×1,1: la moto, la più
 * veloce, arriva a 0,55 · 1,1 · 1,1 ≈ 0,67 di MAX_SPEED, ancora ben sotto il
 * giocatore lanciato, quindi si sorpassa tutto.
 */
export const TRAFFIC_SPEED_FACTOR: Readonly<Record<Difficulty, number>> = { normal: 1, hard: 1.1 };

/** Legge un valore di `?mode=` o dello storage: solo `normal` e `hard`, il resto è `null`. Pura. */
export function parseMode(value: string | null | undefined): Difficulty | null {
  return (MODES as readonly (string | null | undefined)[]).includes(value) ? (value as Difficulty) : null;
}

/** `?mode=` di una query string (`location.search`), o `null`. Pura. */
export function modeFromSearch(search: string): Difficulty | null {
  return parseMode(new URLSearchParams(search).get('mode'));
}

/** La modalità dopo `mode` nel giro del tasto D: normal → hard → normal. Pura. */
export function nextMode(mode: Difficulty): Difficulty {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

/** Modalità di una tappa: assente vale NORMAL. Pura. */
export function modeOf(stage: StageDef): Difficulty {
  return stage.mode ?? DEFAULT_MODE;
}

/** Scritta della radio e dell'HUD, nel font del gioco. Pura. */
export function modeLabel(mode: Difficulty): string {
  return `MODE: ${mode.toUpperCase()}`;
}

/**
 * La tappa nella modalità `mode`: NORMAL la lascia com'è (i suoi tempi sono
 * già quelli della tabella di sempre), HARD la marca e le dà il limite di
 * `STAGE_TIME_LIMITS_HARD`, se c'è, senza grazia (`carryGrace`). Pura.
 */
export function withMode(stage: StageDef, mode: Difficulty): StageDef {
  if (mode === 'normal') return stage;
  // HARD non ha la grazia della 0-0 di NORMAL: i suoi tempi sono quelli del lancio.
  const { carryGrace: _, ...rest } = stage;
  return { ...rest, mode, timeLimit: STAGE_TIME_LIMITS_HARD[stage.id] ?? stage.timeLimit };
}

/**
 * Il grafo `graph` nella modalità `mode`: ogni tappa che esce da `first` e
 * `next` passa per `withMode`, così il motore di gara, che legge il tempo e
 * il traffico dalla `StageDef`, non deve sapere niente delle modalità. Il
 * grafo sotto riconosce le tappe per id, quindi riceve anche quelle marcate.
 */
export function modeGraph(graph: StageGraph, mode: Difficulty): StageGraph {
  if (mode === 'normal') return graph;
  return {
    first: () => withMode(graph.first(), mode),
    next(stage, side) {
      const next = graph.next(stage, side);
      return next === null ? null : withMode(next, mode);
    },
    endingOf: (stage) => graph.endingOf(stage),
  };
}
