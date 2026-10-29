import { addDays, parseDailyKey } from '../shared/daily';
import type { StorageLike } from './scores';

/**
 * La serie di giorni (spec prima tappa e ritorno §5): quanti giorni di fila
 * il giocatore ha giocato la sfida giornaliera. Solo sul dispositivo; i
 * giorni sono quelli della sfida (`dailyKey`, data UTC). Conta al via di una
 * gara DAILY, con la chiave della sfida giocata. Chiave nuova e versionata.
 */
export const STREAK_KEY = 'tebrun.streak.v1';

/** Da quanti giorni di fila la serie si mostra (risposta 5 di Teb). */
export const STREAK_MIN_SHOWN = 2;

export interface Streak {
  /** Ultimo giorno giocato, `YYYY-MM-DD`. */
  last: string;
  count: number;
}

export interface StreakStore {
  /** Una gara della sfida `key` è partita. */
  record(key: string): void;
  /** La serie viva oggi (`today` è la chiave di oggi): l'ultimo giorno è oggi o ieri; altrimenti 0. */
  current(today: string): number;
}

/** La serie dopo aver giocato il giorno `key`. Pura. */
export function nextStreak(prev: Streak | null, key: string): Streak {
  if (prev === null) return { last: key, count: 1 };
  if (prev.last === key) return prev;
  if (addDays(prev.last, 1) === key) return { last: key, count: prev.count + 1 };
  // Un giorno saltato, o un orologio tornato indietro: si riparte.
  return { last: key, count: 1 };
}

/** La serie viva il giorno `today`, o 0. Pura. */
export function liveCount(streak: Streak | null, today: string): number {
  if (streak === null) return 0;
  return streak.last === today || addDays(streak.last, 1) === today ? streak.count : 0;
}

/** `DAY 3 IN A ROW`, o null sotto `STREAK_MIN_SHOWN`. Pura. */
export function streakLine(count: number): string | null {
  return count >= STREAK_MIN_SHOWN ? `DAY ${count} IN A ROW` : null;
}

const MAX_RAW_LEN = 64;

/** Una serie nella forma giusta, o null. Pura. */
function parseStored(raw: string | null): Streak | null {
  if (raw === null || raw.length > MAX_RAW_LEN) return null;
  try {
    const v = JSON.parse(raw) as Partial<Streak> | null;
    if (typeof v?.last !== 'string' || !parseDailyKey(v.last)) return null;
    if (typeof v.count !== 'number' || !Number.isInteger(v.count) || v.count < 1 || v.count > 100000) return null;
    return { last: v.last, count: v.count };
  } catch {
    return null;
  }
}

/**
 * Su uno storage iniettabile. Senza storage, o se lancia, niente serie: la
 * memoria della sessione la tiene finché la pagina è aperta, come le altre
 * scelte di `persist/`, e nessun errore arriva al gioco.
 */
export function createStreakStore(storage?: StorageLike): StreakStore {
  let broken = !storage;
  let memory: Streak | null = null;
  const read = (): Streak | null => {
    if (broken || !storage) return memory;
    try {
      return parseStored(storage.getItem(STREAK_KEY));
    } catch {
      broken = true;
      return memory;
    }
  };
  return {
    record(key) {
      if (!parseDailyKey(key)) return;
      const next = nextStreak(read(), key);
      memory = next;
      if (broken || !storage) return;
      try {
        storage.setItem(STREAK_KEY, JSON.stringify(next));
      } catch {
        broken = true;
      }
    },
    current(today) {
      return liveCount(read(), today);
    },
  };
}
