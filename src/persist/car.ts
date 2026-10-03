import { CARS, DEFAULT_CAR, nextCar, parseCar } from '../game/car';
import type { CarChoice } from '../types';
import type { StorageLike } from './scores';

export const CAR_KEY = 'tebrun.car.v1';

/** La scelta dell'auto per la sessione, ricordata anche nello storage. */
export interface CarSetting {
  get(): CarChoice;
  set(car: CarChoice): void;
  /** Passa all'auto dopo nel giro del tasto C e la ritorna. */
  toggle(): CarChoice;
}

/**
 * Scelta dell'auto su uno storage iniettabile, con la cautela dei
 * punteggi: un valore illeggibile vale il default, e uno storage che lancia
 * lascia la scelta in memoria per il resto della sessione, senza ritentare.
 * `initial` (da `?car=`) vince su quanto è salvato e viene salvato a sua
 * volta. `cars` sono le auto della build: una salvata che non c'è (la
 * classica fuori dalla build privata) vale il default.
 */
export function createCarSetting(
  storage?: StorageLike,
  initial?: CarChoice | null,
  cars: readonly CarChoice[] = CARS,
): CarSetting {
  let broken = !storage;
  const read = (): CarChoice | null => {
    if (broken || !storage) return null;
    try {
      return parseCar(storage.getItem(CAR_KEY), cars);
    } catch {
      broken = true;
      return null;
    }
  };
  const write = (car: CarChoice): void => {
    if (broken || !storage) return;
    try {
      storage.setItem(CAR_KEY, car);
    } catch {
      broken = true;
    }
  };
  const chosen = initial && cars.includes(initial) ? initial : null;
  let current: CarChoice = chosen ?? read() ?? DEFAULT_CAR;
  if (chosen) write(chosen);
  return {
    get: () => current,
    set(car) {
      current = car;
      write(car);
    },
    toggle() {
      current = nextCar(current, cars);
      write(current);
      return current;
    },
  };
}

/** Istanza su `localStorage` quando c'è e risponde, altrimenti in memoria. */
export function createDefaultCarSetting(initial?: CarChoice | null): CarSetting {
  try {
    if (typeof localStorage !== 'undefined') {
      const probeKey = '__tebrun_probe__';
      localStorage.setItem(probeKey, '1');
      localStorage.removeItem(probeKey);
      return createCarSetting(localStorage, initial);
    }
  } catch {
    // ricade sulla sola memoria
  }
  return createCarSetting(undefined, initial);
}
