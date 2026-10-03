import { clamp } from '../render/project';
import type { CrashState, Difficulty, PlayerState } from '../types';
import { DEFAULT_MODE } from './mode';
import { surfaceOf } from './player';
import { TIME_EPSILON } from './timer';
import { easeOut } from './track';

/**
 * Tempi di un incidente (spec §7): rotazione, assestamento e arresto.
 * `spin` è la fase in cui l'auto gira (i quattro frame ciclano per tutta la
 * durata) e scivola verso il lato opposto all'urto; `settle` è la fase in
 * cui la coppia la rimette dritta e in carreggiata, x che torna al centro;
 * `stop` è in quanto la velocità arriva a zero, dentro `spin`.
 */
export interface CrashTiming {
  spin: number;
  settle: number;
  stop: number;
}

/**
 * Tempi dell'incidente per modalità.
 *
 * HARD: **deroga (terzo collaudo utente: «finibile solo con una guida quasi
 * perfetta»)**. Erano 1,6 + 0,6 s con arresto in 0,5 s, e un incidente
 * costava ~4 s, meno dei 3-6 s di scorta del pilota esperto, quindi uno
 * schianto non costava la partita. Come nei racer arcade dell'epoca l'auto
 * gira a lungo: 4,2 + 2,2 s, arresto in 0,8 s (la scivolata si vede),
 * l'incidente costa 6-9 s di cronometro (misura in `game/timer.ts`).
 *
 * NORMAL: **deroga (collaudo utente su iPhone: «NORMAL deve essere più
 * facile, soprattutto deve costare meno un incidente»)**. Circa 3 s in tutto:
 * 2,0 s di rotazione (venti frame, cinque giri completi), 1,0 s di
 * assestamento, arresto in 0,5 s, in proporzione a HARD. Un incidente costa
 * ~3-4 s di cronometro invece di 6-9. HARD resta com'era.
 */
export const CRASH_TIMING: Readonly<Record<Difficulty, CrashTiming>> = {
  normal: { spin: 2.0, settle: 1.0, stop: 0.5 },
  hard: { spin: 4.2, settle: 2.2, stop: 0.8 },
};
/** Durata totale dell'incidente con i tempi `timing`. Pura. */
export function crashDuration(timing: CrashTiming): number {
  return timing.spin + timing.settle;
}
/** Tempo di ogni frame di rotazione (spec §7). */
export const SPIN_FRAME_TIME = 0.1;
/** Numero di frame di rotazione: player_spin_0..3. */
export const SPIN_FRAMES = 4;

export type CrashPhase = 'none' | 'spin' | 'settle';

export interface Crash {
  /** Quello che finisce nello snapshot. */
  state: CrashState;
  /** Velocità al momento dell'urto, da cui parte la frenata. */
  startSpeed: number;
  /** x al momento dell'urto, da cui parte l'easing. */
  startX: number;
  /** Lato urtato: x va verso il segno opposto (spec §7). */
  side: -1 | 0 | 1;
  /** Tempi della modalità della partita (`CRASH_TIMING`). */
  timing: CrashTiming;
}

/** Nessun incidente in corso. Pura. */
export function noCrash(): Crash {
  return {
    state: { active: false, t: 0, frame: 0 },
    startSpeed: 0,
    startX: 0,
    side: 0,
    timing: CRASH_TIMING[DEFAULT_MODE],
  };
}

/** Fase dell'incidente al tempo t con i tempi `timing` (spec §7). Pura. */
export function crashPhase(t: number, timing: CrashTiming): CrashPhase {
  if (t + TIME_EPSILON >= crashDuration(timing)) return 'none';
  return t + TIME_EPSILON < timing.spin ? 'spin' : 'settle';
}

/** Frame di rotazione: 0,1,2,3 ogni 0.1 s (spec §7). Pura. */
export function spinFrame(t: number): number {
  return Math.floor((t + TIME_EPSILON) / SPIN_FRAME_TIME) % SPIN_FRAMES;
}

/** Velocità durante l'incidente: a zero in `timing.stop` (spec §7). Pura. */
export function crashSpeed(startSpeed: number, t: number, timing: CrashTiming): number {
  return Math.max(0, startSpeed * (1 - t / timing.stop));
}

/**
 * x durante l'incidente (spec §7): in `spin` va verso il segno opposto al
 * lato urtato con easing e resta entro ±1; in `settle` torna verso il centro.
 * Pura.
 */
export function crashX(startX: number, side: -1 | 0 | 1, t: number, timing: CrashTiming): number {
  const away = -side;
  if (crashPhase(t, timing) === 'spin') {
    return clamp(easeOut(startX, away, clamp(t / timing.spin, 0, 1)), -1, 1);
  }
  return easeOut(away, 0, clamp((t - timing.spin) / timing.settle, 0, 1));
}

/** Inizio di un incidente dal lato urtato, coi tempi della modalità `mode`. Pura. */
export function startCrash(player: PlayerState, side: -1 | 0 | 1, mode: Difficulty): Crash {
  return {
    state: { active: true, t: 0, frame: 0 },
    startSpeed: player.speed,
    startX: player.x,
    side,
    timing: CRASH_TIMING[mode],
  };
}

/** Avanza l'incidente di dt; a fine durata torna inattivo. Pura. */
export function stepCrash(crash: Crash, dt: number): Crash {
  if (!crash.state.active) return crash;
  const t = crash.state.t + dt;
  const phase = crashPhase(t, crash.timing);
  if (phase === 'none') return { ...crash, state: { active: false, t: 0, frame: 0 } };
  return {
    ...crash,
    state: { active: true, t, frame: phase === 'spin' ? spinFrame(t) : 0 },
  };
}

/**
 * Sovrascrive lo stato del giocatore secondo la fase dell'incidente (spec §7):
 * velocità in frenata, x in easing, marcia forzata a lo in `settle`, nessuno
 * sterzo. L'input è già ignorato da `stepPlayer(..., crashActive)`.
 *
 * `roadHalf` e `median` sono quelli del segmento, come per `stepPlayer`.
 * Contano per l'**isola centrale** della zona di bivio: `crashX` limita `x` a
 * ±1, quindi un testacoda finisce sempre dentro la carreggiata, ma con
 * `median > 0` quella x può cadere sull'isola di terreno, e prima si leggeva
 * come asfalto — l'auto rimbalzava di 2 px invece di 6 mentre girava sul
 * prato. Pura.
 */
export function applyCrash(crash: Crash, player: PlayerState, roadHalf = 1, median = 0): PlayerState {
  if (!crash.state.active) return player;
  const t = crash.state.t;
  const x = crashX(crash.startX, crash.side, t, crash.timing);
  return {
    ...player,
    speed: crashSpeed(crash.startSpeed, t, crash.timing),
    x,
    gear: crashPhase(t, crash.timing) === 'settle' ? 'lo' : player.gear,
    steer: 0,
    braking: false,
    accelerating: false,
    // `|x| > 1`, come in `stepPlayer` (spec §5): `offRoad` non segue
    // `roadHalf`, che allarga solo la carreggiata di una strada divisa.
    offRoad: Math.abs(x) > 1,
    surface: surfaceOf(x, roadHalf, median),
    skidding: false,
    steerHeld: 0,
  };
}
