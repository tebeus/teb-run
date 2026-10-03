import type { StageDef } from '../types';

/**
 * Le tappe viste come grafo (spec §9). Il binario E ne monta una versione di
 * prova con poche tappe, il binario F quella completa a 15.
 */
export interface StageGraph {
  /** Tappa di partenza. */
  first(): StageDef;
  /** Tappa raggiunta scegliendo `side` al bivio, o null se questa è l'ultima. */
  next(stage: StageDef, side: 'L' | 'R'): StageDef | null;
  /** Indice del finale 0..4: lo sprite è `ending_${ending + 1}`. */
  endingOf(stage: StageDef): number;
}

/** Numero massimo di finali (spec §9). */
export const ENDING_COUNT = 5;

/** Livello dall'id "l-i" (spec §9); 0 se l'id non è nella forma attesa. Pura. */
export function levelOf(stageId: string): number {
  const n = Number.parseInt(stageId.split('-')[0] ?? '', 10);
  return Number.isInteger(n) ? n : 0;
}

/** Indice dall'id "l-i" (spec §9); 0 se l'id non è nella forma attesa. Pura. */
export function indexOf(stageId: string): number {
  const n = Number.parseInt(stageId.split('-')[1] ?? '', 10);
  return Number.isInteger(n) ? n : 0;
}

/**
 * Grafo sulla griglia triangolare della spec §9: da `l-i` si va a `(l+1)-i` a
 * sinistra e a `(l+1)-(i+1)` a destra; l'ultimo livello non ha successori e
 * porta al finale `i`. Funziona con qualsiasi lista di tappe con id "l-i",
 * quindi il binario F lo riusa passando le 15 vere.
 */
export function createStageGraph(stages: readonly StageDef[]): StageGraph {
  if (stages.length === 0) throw new Error('createStageGraph: no stages');
  const byId = new Map(stages.map((s) => [s.id, s]));
  const start = byId.get('0-0') ?? stages[0];
  return {
    first: () => start,
    next(stage, side) {
      const level = levelOf(stage.id);
      const index = indexOf(stage.id);
      return byId.get(`${level + 1}-${side === 'L' ? index : index + 1}`) ?? null;
    },
    endingOf(stage) {
      const i = indexOf(stage.id);
      return i < 0 ? 0 : i > ENDING_COUNT - 1 ? ENDING_COUNT - 1 : i;
    },
  };
}
