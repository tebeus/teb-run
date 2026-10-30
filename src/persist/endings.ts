// La collezione dei finali (spec telefono e finali §C): i finali visti (1..5,
// l'indice di `REAL_GRAPH.endingOf` più uno, uguale per tutte le auto) e le
// tappe raggiunte, per la pagina ENDINGS e la sua mappa. Sul dispositivo,
// con una chiave nuova e versionata; nessun dato personale.
//
// Le partite di prima: i finali non si ricavano con certezza dalla TOP 10
// locale (una voce non dice se la partita è finita all'arrivo o in game over
// sull'ultima tappa), le tappe raggiunte sì: `route` le dà tutte. Alla
// prima lettura si prendono dalla TOP 10, una volta sola.

import { ENDING_COUNT } from '../game/endings';
import type { ScoreEntry, StorageLike } from './scores';

export const ENDINGS_KEY = 'tebrun.endings.v1';

export interface EndingsRecord {
  /** Finali visti, 1..ENDING_COUNT, in ordine. */
  seen: number[];
  /** Tappe raggiunte (`3-1`), in ordine. */
  stages: string[];
  /** Le tappe della TOP 10 di prima sono già state prese. */
  migrated: boolean;
}

export interface EndingsStore {
  /** Ciò che è salvato; vuoto senza storage. */
  load(): EndingsRecord;
  /** Segna le tappe raggiunte. */
  recordStages(ids: readonly string[]): void;
  /** Segna il finale `ending` (0..4): `isNew` se non era mai stato visto, e quanti sono adesso. */
  recordEnding(ending: number): { isNew: boolean; count: number };
}

const EMPTY: EndingsRecord = { seen: [], stages: [], migrated: false };
const STAGE_ID = /^[0-4]-[0-4]$/;
const MAX_RAW_LEN = 512;

/** Un record nella forma giusta: numeri e tappe validi, senza doppioni, ordinati. Pura. */
export function parseEndings(raw: string | null): EndingsRecord {
  if (raw === null || raw.length > MAX_RAW_LEN) return { ...EMPTY };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof EndingsRecord, unknown>> | null;
    const seen = Array.isArray(v?.seen) ? v.seen.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= ENDING_COUNT) : [];
    const stages = Array.isArray(v?.stages) ? v.stages.filter((s): s is string => typeof s === 'string' && STAGE_ID.test(s)) : [];
    return { seen: [...new Set(seen)].sort(), stages: [...new Set(stages)].sort(), migrated: v?.migrated === true };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Le tappe che una voce della TOP 10 ha attraversato, se si possono dire con
 * certezza: il percorso (`L R L`) porta esattamente alla tappa della voce.
 * Altrimenti nessuna. Pura.
 */
export function stagesOfEntry(entry: Pick<ScoreEntry, 'route' | 'stageId'>): string[] {
  if (typeof entry.route !== 'string' || !/^[LR ]*$/.test(entry.route)) return [];
  const sides = entry.route.replace(/ /g, '').split('') as ('L' | 'R')[];
  if (sides.length > ENDING_COUNT - 1) return [];
  const out = ['0-0'];
  let index = 0;
  sides.forEach((side, i) => {
    if (side === 'R') index += 1;
    out.push(`${i + 1}-${index}`);
  });
  return out[out.length - 1] === entry.stageId ? out : [];
}

/**
 * Su uno storage iniettabile. `history` dà le voci della TOP 10 locale (di
 * tutte le modalità) per il recupero delle tappe. Senza storage, o se
 * lancia, la collezione è vuota (tutto chiuso) e vive in memoria finché la
 * pagina è aperta; nessun errore arriva al gioco.
 */
export function createEndingsStore(storage?: StorageLike, history: () => readonly ScoreEntry[] = () => []): EndingsStore {
  let broken = !storage;
  let memory: EndingsRecord = { ...EMPTY };
  const write = (next: EndingsRecord): void => {
    memory = next;
    if (broken || !storage) return;
    try {
      storage.setItem(ENDINGS_KEY, JSON.stringify(next));
    } catch {
      broken = true;
    }
  };
  const read = (): EndingsRecord => {
    if (broken || !storage) return memory;
    let rec: EndingsRecord;
    try {
      rec = parseEndings(storage.getItem(ENDINGS_KEY));
    } catch {
      broken = true;
      return memory;
    }
    if (!rec.migrated) {
      let old: readonly ScoreEntry[] = [];
      try {
        old = history();
      } catch {
        old = [];
      }
      const stages = new Set(rec.stages);
      for (const entry of old) for (const id of stagesOfEntry(entry)) stages.add(id);
      rec = { ...rec, stages: [...stages].sort(), migrated: true };
      write(rec);
    }
    return rec;
  };
  return {
    load: read,
    recordStages(ids) {
      const rec = read();
      const stages = new Set(rec.stages);
      for (const id of ids) if (STAGE_ID.test(id)) stages.add(id);
      if (stages.size !== rec.stages.length) write({ ...rec, stages: [...stages].sort() });
    },
    recordEnding(ending) {
      const n = Math.trunc(ending) + 1;
      const rec = read();
      if (!(n >= 1 && n <= ENDING_COUNT) || rec.seen.includes(n)) return { isNew: false, count: rec.seen.length };
      const seen = [...rec.seen, n].sort();
      write({ ...rec, seen });
      return { isNew: true, count: seen.length };
    },
  };
}
