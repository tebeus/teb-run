import type { StorageLike } from './scores';

export const TILT_KEY = 'tebrun.tilt.v1';
/** TILT è già stato toccato almeno una volta: la radio smette di spiegarlo. */
export const TILT_SEEN_KEY = 'tebrun.tiltSeen.v1';

/** L'opzione dello sterzo con inclinazione, ricordata anche nello storage. */
export interface TiltSetting {
  get(): boolean;
  set(on: boolean): void;
}

/** '1' acceso, qualunque altra cosa (anche niente) spento. Pura. */
export function parseTilt(raw: string | null): boolean {
  return raw === '1';
}

/** Un sì/no su uno storage iniettabile: '1' sì, tutto il resto no. */
function createFlag(key: string, storage?: StorageLike): TiltSetting {
  let broken = !storage;
  const read = (): boolean => {
    if (broken || !storage) return false;
    try {
      return parseTilt(storage.getItem(key));
    } catch {
      broken = true;
      return false;
    }
  };
  const write = (on: boolean): void => {
    if (broken || !storage) return;
    try {
      storage.setItem(key, on ? '1' : '0');
    } catch {
      broken = true;
    }
  };
  let current = read();
  return {
    get: () => current,
    set(on) {
      current = on;
      write(on);
    },
  };
}

/**
 * Opzione TILT su uno storage iniettabile, con la stessa cautela dell'auto
 * e della modalità (`persist/car.ts`, `persist/mode.ts`): un valore
 * illeggibile vale spento, e uno storage che lancia lascia la scelta in
 * memoria per il resto della sessione, senza ritentare.
 */
export function createTiltSetting(storage?: StorageLike): TiltSetting {
  return createFlag(TILT_KEY, storage);
}

/**
 * TILT è mai stato toccato su questo dispositivo? Finché no, la radio
 * spiega a cosa serve. Stessa cautela di `createTiltSetting`.
 */
export function createTiltSeenSetting(storage?: StorageLike): TiltSetting {
  return createFlag(TILT_SEEN_KEY, storage);
}

/** `localStorage` quando c'è e risponde, altrimenti niente (la sola memoria). */
function defaultStorage(): StorageLike | undefined {
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

/** Istanza su `localStorage` quando c'è e risponde, altrimenti in memoria. */
export function createDefaultTiltSetting(): TiltSetting {
  return createTiltSetting(defaultStorage());
}

/** Come `createDefaultTiltSetting`, per `createTiltSeenSetting`. */
export function createDefaultTiltSeenSetting(): TiltSetting {
  return createTiltSeenSetting(defaultStorage());
}
