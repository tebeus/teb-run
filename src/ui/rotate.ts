// Telefono in verticale (lancio, punto 14): il gioco è orizzontale. Su un
// dispositivo touch in verticale la tela di `portrait.ts` copre tutto con
// "ROTATE YOUR PHONE" (spec telefono e finali §A), i tocchi non arrivano al
// gioco e la gara va in pausa da sola, come quando la scheda perde il
// fuoco. Con tastiera e mouse non succede mai.

import type { InputDevice } from '../core/device';
import type { LogicalPoint, SystemSignals } from '../core/signals';

/**
 * Oltre questo rapporto altezza/larghezza la finestra è chiaramente
 * verticale. 1,25 (cioè 4:5): un pieghevole aperto sta fra 1:1 e circa 6:5,
 * e lì il gioco in letterbox occupa tutta la larghezza e almeno il 45%
 * dell'altezza; un telefono in verticale sta oltre 2:1.
 */
export const ROTATE_ASPECT = 1.25;
/**
 * Da questa larghezza in px CSS il gioco in letterbox è grande almeno come
 * su un iPhone SE in orizzontale (667 px), con i pulsanti alle stesse
 * misure: un iPad in verticale (768-834 px) si gioca così, senza velo.
 */
export const ROTATE_MIN_PLAYABLE_W = 640;

/**
 * Va chiesto di ruotare? Solo col tocco, con la finestra chiaramente
 * verticale e troppo stretta per giocare in letterbox. Pura.
 */
export function wantsRotate(device: InputDevice, winW: number, winH: number): boolean {
  return device === 'touch' && winH > winW * ROTATE_ASPECT && winW < ROTATE_MIN_PLAYABLE_W;
}

export interface RotateGuard {
  /** Vero mentre si chiede di ruotare: i controlli touch tacciono. */
  blocked(): boolean;
}

/**
 * Guarda la forma della finestra. Al passaggio in verticale chiama
 * `onPortrait` (la gara lo usa come perdita del fuoco: pausa).
 */
export function createRotateGuard(
  win: Pick<Window, 'innerWidth' | 'innerHeight' | 'addEventListener'>,
  device: () => InputDevice,
  onPortrait: () => void,
): RotateGuard {
  let was = false;
  const check = (): boolean => {
    const now = wantsRotate(device(), win.innerWidth, win.innerHeight);
    if (now && !was) onPortrait();
    was = now;
    return now;
  };
  win.addEventListener('resize', () => void check());
  return {
    blocked: check,
  };
}

/**
 * I segnali del sistema, ma senza tocchi mentre si chiede di ruotare, e con
 * `raiseFocusLost` per mettere in pausa la gara quando il telefono si gira.
 * `blocked` si decide dopo: il guardiano ha bisogno di `raiseFocusLost`.
 */
export function guardSignals(signals: SystemSignals): SystemSignals & {
  raiseFocusLost(): void;
  setBlocked(blocked: () => boolean): void;
} {
  let lost = false;
  let blocked = (): boolean => false;
  return {
    takeTap(): LogicalPoint | null {
      const tap = signals.takeTap();
      return blocked() ? null : tap;
    },
    takeFocusLost() {
      const inner = signals.takeFocusLost();
      const raised = lost;
      lost = false;
      return inner || raised;
    },
    raiseFocusLost() {
      lost = true;
    },
    setBlocked(fn) {
      blocked = fn;
    },
  };
}
