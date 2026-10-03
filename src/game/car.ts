import { FEATURES } from '../core/target';
import type { CarChoice, SpriteName } from '../types';

/** Auto di chi non ha scelto: la cabrio nuova del Set 7. */
export const DEFAULT_CAR: CarChoice = 'new';

/** Tutte le auto, nell'ordine in cui il tasto C le propone. */
export const ALL_CARS: readonly CarChoice[] = ['new', 'classic', 'retro', 'sport', 'super'];

/** Le auto di una build: la classica solo dove `classic` è vero (la privata). Pura. */
export function carsFor(classic: boolean): readonly CarChoice[] {
  return classic ? ALL_CARS : ALL_CARS.filter((car) => car !== 'classic');
}

/**
 * Le auto di questa build (`src/core/target.ts`). Nelle build site e portal
 * la classica non esiste: né nella radio, né da `?car=classic`, né da uno
 * storage che la ricorda, e ricade sull'auto nuova.
 */
export const CARS: readonly CarChoice[] = carsFor(FEATURES.classicCar);

/** Legge un valore di `?car=` o dello storage: solo le auto di `cars`, il resto è `null`. Pura. */
export function parseCar(value: string | null | undefined, cars: readonly CarChoice[] = CARS): CarChoice | null {
  return (cars as readonly (string | null | undefined)[]).includes(value) ? (value as CarChoice) : null;
}

/** `?car=` di una query string (`location.search`), o `null`. Pura. */
export function carFromSearch(search: string, cars: readonly CarChoice[] = CARS): CarChoice | null {
  return parseCar(new URLSearchParams(search).get('car'), cars);
}

/** L'auto dopo `car` nel giro del tasto C: new → classic → retro → sport → super → new (senza la classica fuori dalla privata). Pura. */
export function nextCar(car: CarChoice, cars: readonly CarChoice[] = CARS): CarChoice {
  return cars[(cars.indexOf(car) + 1) % cars.length];
}

/** Prefisso dei dieci frame dell'auto: `player_` o `player_<auto>_`. Pura. */
export function playerPrefix(car: CarChoice): string {
  return car === 'new' ? 'player_' : `player_${car}_`;
}

/** Nome del frame `frame` (`straight`, `left1`, `spin_2`...) per l'auto `car`. Pura. */
export function playerFrame(car: CarChoice, frame: string): SpriteName {
  return `${playerPrefix(car)}${frame}`;
}

/** Auto con i propri finali 1-5 (`ending_<auto>_N`): per ora solo la classica. */
const OWN_ENDINGS: readonly CarChoice[] = ['classic'];

/**
 * Illustrazione di un finale per l'auto `car`. I finali 1-5 del Set 7 hanno
 * la cabrio nuova, la classica ha i suoi `ending_classic_N`; retrò,
 * sportiva e supercar non hanno illustrazioni proprie e usano quelle della nuova, a
 * meno che `has` non dica che esiste un `ending_<auto>_N`. Pura se lo è
 * `has`.
 */
export function endingSpriteFor(
  car: CarChoice,
  name: SpriteName,
  has: (name: SpriteName) => boolean = (n) => OWN_ENDINGS.some((c) => n.startsWith(`ending_${c}_`)),
): SpriteName {
  if (car === 'new' || !/^ending_[1-5]$/.test(name)) return name;
  const own = name.replace('ending_', `ending_${car}_`);
  return has(own) ? own : name;
}

/** Scritta della radio, nel font del gioco. Pura. */
export function carLabel(car: CarChoice): string {
  return `CAR: ${car.toUpperCase()}`;
}
