// I controlli del server su una partita inviata (spec classifica e sfida,
// §2.4). Codice comune, puro: il Worker decide con questo, i test della
// radice lo provano sulle partite vere del pilota esperto.
//
// Il client non è fidato: lo scopo è alzare il costo, non impedire. I limiti
// vengono dalle regole del gioco (`shared/limits.ts`, generata dal codice
// vero), per il percorso dichiarato:
//
// - durata minima: le tappe completate a velocità massima su strada dritta
//   (`lunghezza / MAX_SPEED`), sotto ogni guida possibile, × 0,95;
// - durata massima: la somma dei limiti di tempo delle tappe raggiunte (il
//   tempo di gara non conta pause, schermate e pubblicità), più la
//   decelerazione del game over e 2 s;
// - punteggio massimo: guida a velocità piena per tutta la durata al
//   moltiplicatore più alto raggiunto, due sorpassi per veicolo di ogni
//   tappa, i checkpoint con il massimo tempo che può restare e l'arrivo con
//   il tempo che resta davvero (somma dei limiti meno la durata), il tutto
//   × 1,10 + 1000.

import { addDays, dailyChallenge, dailyKey, parseDailyKey } from './daily';
import { blockedInitials, validInitials } from './initials';
import { endingOfStage, LIMITS, nextStageId, stageLimits, type StageLimits } from './limits';
import type { CarChoice, Difficulty } from './kinds';

/** Cosa manda il client. */
export interface RunBody {
  initials: string;
  score: number;
  mode: Difficulty;
  car: CarChoice;
  stageId: string;
  /** Le scelte ai bivi, compatte: `'LRLR'`, `''` alla prima tappa. */
  route: string;
  /** Finale 1..5, solo all'arrivo. */
  ending?: number | null;
  /** Tempo di gara senza pause, schermate e pubblicità. */
  durationMs: number;
  /** La sfida giocata (`YYYY-MM-DD`), solo per una partita DAILY. */
  daily?: string;
}

/** La riga da salvare. */
export interface RunRow {
  board: 'run' | 'daily';
  day: string;
  mode: Difficulty;
  initials: string;
  score: number;
  car: CarChoice;
  stageId: string;
  route: string;
  ending: number | null;
  durationMs: number;
}

/** Perché una partita è rifiutata: il server conta i rifiuti per motivo, senza dati. */
export type RejectReason = 'shape' | 'initials' | 'route' | 'duration' | 'score' | 'daily';

export const REJECT_REASONS: readonly RejectReason[] = ['shape', 'initials', 'route', 'duration', 'score', 'daily'];

export type RunVerdict = { ok: true; row: RunRow } | { ok: false; reason: RejectReason };

/** Le auto accettate: mai la classica, che esiste solo nella build privata. */
export const PUBLIC_CARS: readonly CarChoice[] = ['new', 'retro', 'sport', 'super'];
const MODES: readonly Difficulty[] = ['normal', 'hard'];
const FIELDS = new Set(['initials', 'score', 'mode', 'car', 'stageId', 'route', 'ending', 'durationMs', 'daily']);

/** Minuti dopo la mezzanotte UTC in cui vale ancora la sfida di ieri. */
export const DAILY_GRACE_MS = 15 * 60 * 1000;
/** Tetti larghi sui numeri, prima di ogni altro controllo. */
const MAX_SCORE = 10_000_000;
const MAX_DURATION_MS = 60 * 60 * 1000;

export const MIN_DURATION_FACTOR = 0.95;
export const DURATION_SLACK_S = 2;
export const SCORE_FACTOR = 1.1;
export const SCORE_SLACK = 1000;
/** Sorpassi contati al massimo per veicolo di una tappa (l'esperto: ≤ 1,1). */
export const OVERTAKES_PER_CAR = 2;

const isInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/** Le tappe di un percorso dalla prima, o null se il percorso non esiste. Pura. */
export function stagesOfRoute(route: string): { id: string; limits: StageLimits }[] | null {
  if (!/^[LR]{0,4}$/.test(route)) return null;
  let id = '0-0';
  const out = [{ id, limits: stageLimits(id)! }];
  for (const side of route) {
    const next = nextStageId(id, side as 'L' | 'R');
    if (next === null) return null;
    id = next;
    out.push({ id, limits: stageLimits(id)! });
  }
  return out;
}

/** Durata minima e massima plausibili, in secondi, per le tappe raggiunte. Pura. */
export function durationBounds(
  stages: readonly { limits: StageLimits }[],
  mode: Difficulty,
  finished: boolean,
): { min: number; max: number } {
  const completed = finished ? stages : stages.slice(0, -1);
  const min = completed.reduce((t, s) => t + s.limits.length / LIMITS.maxSpeedSegmentsPerSecond, 0) * MIN_DURATION_FACTOR;
  const limits = stages.reduce((t, s) => t + s.limits.limit[mode], 0);
  return { min, max: limits + (finished ? 0 : LIMITS.gameoverDecelS) + DURATION_SLACK_S };
}

/** Punteggio massimo plausibile per le tappe raggiunte e la durata. Pura. */
export function maxScore(
  stages: readonly { limits: StageLimits }[],
  mode: Difficulty,
  finished: boolean,
  durationS: number,
): number {
  const topLevel = stages[stages.length - 1].limits.level;
  const drive = LIMITS.scoreRate * (1 + LIMITS.levelScoreStep * topLevel) * durationS;
  const overtakes = stages.reduce((t, s) => t + LIMITS.overtakePoints * OVERTAKES_PER_CAR * s.limits.cars[mode], 0);
  let reserve = 0;
  let checkpoints = 0;
  // I checkpoint sono alla fine di ogni tappa tranne l'ultima raggiunta.
  for (let k = 0; k < stages.length - 1; k++) {
    const s = stages[k].limits;
    reserve += s.limit[mode] - s.length / LIMITS.maxSpeedSegmentsPerSecond;
    checkpoints += LIMITS.checkpointBonusPerSecond * Math.max(0, reserve);
  }
  const limits = stages.reduce((t, s) => t + s.limits.limit[mode], 0);
  const finish = finished ? LIMITS.finishBonusPerSecond * Math.max(0, limits - durationS + 1) : 0;
  return SCORE_FACTOR * (drive + overtakes + checkpoints + finish) + SCORE_SLACK;
}

/** Il giorno della sfida `daily` è accettabile adesso? Oggi, o ieri nei primi 15 minuti. Pura. */
export function dailyAccepted(daily: string, now: Date): boolean {
  const today = dailyKey(now);
  if (daily === today) return true;
  return daily === addDays(today, -1) && dailyKey(new Date(now.getTime() - DAILY_GRACE_MS)) === daily;
}

/** Decide su un corpo di `POST /score`. Pura. */
export function validateRun(body: unknown, now: Date): RunVerdict {
  const no = (reason: RejectReason): RunVerdict => ({ ok: false, reason });
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return no('shape');
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !FIELDS.has(k))) return no('shape');
  if (
    !isInt(b.score, MAX_SCORE) ||
    !isInt(b.durationMs, MAX_DURATION_MS) ||
    !MODES.includes(b.mode as Difficulty) ||
    !PUBLIC_CARS.includes(b.car as CarChoice) ||
    typeof b.stageId !== 'string' ||
    typeof b.route !== 'string' ||
    !(b.ending === undefined || b.ending === null || isInt(b.ending, 99)) ||
    !(b.daily === undefined || (typeof b.daily === 'string' && parseDailyKey(b.daily)))
  ) {
    return no('shape');
  }
  if (!validInitials(b.initials) || blockedInitials(b.initials)) return no('initials');
  const mode = b.mode as Difficulty;
  const ending = (b.ending as number | null | undefined) ?? null;

  const stages = stagesOfRoute(b.route);
  if (stages === null || stages[stages.length - 1].id !== b.stageId) return no('route');
  const finished = ending !== null;
  if (finished && endingOfStage(b.stageId) !== ending) return no('route');

  const durationS = b.durationMs / 1000;
  const { min, max } = durationBounds(stages, mode, finished);
  if (durationS < min || durationS > max) return no('duration');
  if (b.score > maxScore(stages, mode, finished, durationS)) return no('score');

  let board: RunRow['board'] = 'run';
  let day = dailyKey(now);
  if (b.daily !== undefined) {
    const challenge = dailyChallenge(b.daily);
    if (!dailyAccepted(b.daily, now) || challenge.car !== b.car || challenge.mode !== mode) return no('daily');
    board = 'daily';
    day = b.daily;
  }
  return {
    ok: true,
    row: {
      board,
      day,
      mode,
      initials: b.initials,
      score: b.score,
      car: b.car as CarChoice,
      stageId: b.stageId,
      route: b.route,
      ending,
      durationMs: b.durationMs,
    },
  };
}
