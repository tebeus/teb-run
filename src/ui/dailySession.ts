// La sfida giornaliera in corso (spec classifica e sfida, §3.3). La schermata
// `daily` la apre, il titolo la chiude; nel frattempo l'auto e la modalità
// sono quelle della sfida, per tutte le schermate che le leggono (radio,
// gara, HUD, finali), senza toccare la scelta salvata del giocatore: i due
// avvolgitori qui sotto rispondono con la sfida e ignorano C e D.

import type { CarSetting } from '../persist/car';
import type { ModeSetting } from '../persist/mode';
import type { DailyChallenge } from '../shared/daily';
import { msToNextDaily } from '../shared/daily';

export interface DailySession {
  /** La sfida in corso, o null fuori da DAILY. */
  current(): DailyChallenge | null;
  start(challenge: DailyChallenge): void;
  stop(): void;
}

export function createDailySession(): DailySession {
  let challenge: DailyChallenge | null = null;
  return {
    current: () => challenge,
    start(c) {
      challenge = c;
    },
    stop() {
      challenge = null;
    },
  };
}

/** L'auto scelta, o quella della sfida mentre DAILY è in corso (e allora C non fa niente). */
export function sessionCar(car: CarSetting, session: DailySession): CarSetting {
  return {
    get: () => session.current()?.car ?? car.get(),
    set(value) {
      if (session.current() === null) car.set(value);
    },
    toggle() {
      const c = session.current();
      return c === null ? car.toggle() : c.car;
    },
  };
}

/** La modalità scelta, o quella della sfida mentre DAILY è in corso (e allora D non fa niente). */
export function sessionMode(mode: ModeSetting, session: DailySession): ModeSetting {
  return {
    get: () => session.current()?.mode ?? mode.get(),
    set(value) {
      if (session.current() === null) mode.set(value);
    },
    toggle() {
      const c = session.current();
      return c === null ? mode.toggle() : c.mode;
    },
  };
}

/** `RETRO · HARD`: la sfida in una riga, nel font del gioco. Pura. */
export function challengeLabel(c: Pick<DailyChallenge, 'car' | 'mode'>): string {
  return `${c.car.toUpperCase()} · ${c.mode.toUpperCase()}`;
}

/** `NEW CHALLENGE IN 5H 12M` (o `IN 12M` nell'ultima ora). Pura. */
export function nextChallengeLine(now: Date): string {
  const minutes = Math.max(1, Math.floor(msToNextDaily(now) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `NEW CHALLENGE IN ${h > 0 ? `${h}H ${m}M` : `${m}M`}`;
}
