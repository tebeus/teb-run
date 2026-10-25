import type { CarChoice, Difficulty } from '../types';
import type { StorageLike } from './scores';

/**
 * Il miglior punteggio DAILY di oggi, in locale (spec classifica e sfida,
 * §3.4): funziona senza rete e su ogni build, portal compreso. Si tiene solo
 * il giorno della sfida: un record di un altro giorno, alla lettura, vale
 * vuoto. Chiave nuova e versionata.
 */
export const DAILY_KEY = 'tebrun.daily.v1';

/** Le ultime iniziali usate: `nameEntry` riparte da lì. */
export const INITIALS_KEY = 'tebrun.initials.v1';

export interface DailyBest {
  score: number;
  car: CarChoice;
  mode: Difficulty;
  stageId: string;
  route: string;
}

export interface DailyStore {
  /** Il record della sfida `key`, o null. */
  best(key: string): DailyBest | null;
  /** Registra una partita della sfida `key`; vero se è un nuovo record di oggi. */
  record(key: string, run: DailyBest): boolean;
}

/** Tetto sulla chiave grezza prima di `JSON.parse`, come in `scores.ts`. */
const MAX_RAW_LEN = 512;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && /^[A-Za-z0-9 -]*$/.test(v);

/** Un record nella forma giusta, o null. Pura. */
function parseStored(raw: string | null): { key: string; best: DailyBest } | null {
  if (raw === null || raw.length > MAX_RAW_LEN) return null;
  try {
    const v = JSON.parse(raw) as { key?: unknown; best?: Partial<DailyBest> } | null;
    const b = v?.best;
    if (
      !isText(v?.key, 10) ||
      typeof b?.score !== 'number' ||
      !Number.isFinite(b.score) ||
      !isText(b.car, 16) ||
      !isText(b.mode, 16) ||
      !isText(b.stageId, 8) ||
      !isText(b.route, 8)
    ) {
      return null;
    }
    return { key: v.key, best: { score: b.score, car: b.car as CarChoice, mode: b.mode as Difficulty, stageId: b.stageId, route: b.route } };
  } catch {
    return null;
  }
}

/**
 * Su uno storage iniettabile; se lancia, resta in memoria per la sessione
 * senza ritentare (come le altre scelte di `persist/`).
 */
export function createDailyStore(storage?: StorageLike): DailyStore {
  let broken = !storage;
  let memory: { key: string; best: DailyBest } | null = null;
  const read = (): { key: string; best: DailyBest } | null => {
    if (broken || !storage) return memory;
    try {
      return parseStored(storage.getItem(DAILY_KEY));
    } catch {
      broken = true;
      return memory;
    }
  };
  const write = (value: { key: string; best: DailyBest }): void => {
    memory = value;
    if (broken || !storage) return;
    try {
      storage.setItem(DAILY_KEY, JSON.stringify(value));
    } catch {
      broken = true;
    }
  };
  return {
    best(key) {
      const v = read();
      return v !== null && v.key === key ? v.best : null;
    },
    record(key, run) {
      const prev = this.best(key);
      if (prev !== null && run.score <= prev.score) return false;
      write({ key, best: run });
      return true;
    },
  };
}

/** Le ultime iniziali (`A-Z` × 3), ricordate per la prossima volta. */
export interface InitialsMemory {
  get(): string | null;
  set(initials: string): void;
}

export function createInitialsMemory(storage?: StorageLike): InitialsMemory {
  let broken = !storage;
  let memory: string | null = null;
  return {
    get() {
      if (broken || !storage) return memory;
      try {
        const v = storage.getItem(INITIALS_KEY);
        return v !== null && /^[A-Z]{3}$/.test(v) ? v : memory;
      } catch {
        broken = true;
        return memory;
      }
    },
    set(initials) {
      memory = initials;
      if (broken || !storage) return;
      try {
        storage.setItem(INITIALS_KEY, initials);
      } catch {
        broken = true;
      }
    },
  };
}

/** `localStorage` quando c'è e risponde, altrimenti la memoria. */
export function defaultStorage(): StorageLike | undefined {
  try {
    if (typeof localStorage !== 'undefined') {
      const probeKey = '__tebrun_probe__';
      localStorage.setItem(probeKey, '1');
      localStorage.removeItem(probeKey);
      return localStorage;
    }
  } catch {
    // ricade sulla sola memoria
  }
  return undefined;
}
