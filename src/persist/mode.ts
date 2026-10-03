import { DEFAULT_MODE, nextMode, parseMode } from '../game/mode';
import type { Difficulty } from '../types';
import type { StorageLike } from './scores';

export const MODE_KEY = 'tebrun.mode.v1';

/** La modalità scelta per la sessione, ricordata anche nello storage. */
export interface ModeSetting {
  get(): Difficulty;
  set(mode: Difficulty): void;
  /** Passa alla modalità dopo nel giro del tasto D e la ritorna. */
  toggle(): Difficulty;
}

/**
 * Scelta della modalità su uno storage iniettabile, con la stessa cautela
 * della scelta dell'auto (`persist/car.ts`): un valore illeggibile vale il
 * default, e uno storage che lancia lascia la scelta in memoria per il resto
 * della sessione, senza ritentare. `initial` (da `?mode=`) vince su quanto è
 * salvato e viene salvato a sua volta.
 */
export function createModeSetting(storage?: StorageLike, initial?: Difficulty | null): ModeSetting {
  let broken = !storage;
  const read = (): Difficulty | null => {
    if (broken || !storage) return null;
    try {
      return parseMode(storage.getItem(MODE_KEY));
    } catch {
      broken = true;
      return null;
    }
  };
  const write = (mode: Difficulty): void => {
    if (broken || !storage) return;
    try {
      storage.setItem(MODE_KEY, mode);
    } catch {
      broken = true;
    }
  };
  let current: Difficulty = initial ?? read() ?? DEFAULT_MODE;
  if (initial) write(initial);
  return {
    get: () => current,
    set(mode) {
      current = mode;
      write(mode);
    },
    toggle() {
      current = nextMode(current);
      write(current);
      return current;
    },
  };
}

/** Istanza su `localStorage` quando c'è e risponde, altrimenti in memoria. */
export function createDefaultModeSetting(initial?: Difficulty | null): ModeSetting {
  try {
    if (typeof localStorage !== 'undefined') {
      const probeKey = '__tebrun_probe__';
      localStorage.setItem(probeKey, '1');
      localStorage.removeItem(probeKey);
      return createModeSetting(localStorage, initial);
    }
  } catch {
    // ricade sulla sola memoria
  }
  return createModeSetting(undefined, initial);
}
