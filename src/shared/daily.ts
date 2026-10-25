// La sfida giornaliera calcolata dalla data (spec classifica e sfida, §3.1).
// Codice comune a client e Worker (`api/`): puro, senza DOM e senza
// `core/target`, così il Worker non si tira dietro `import.meta.env`.
//
// - la chiave è la data UTC `YYYY-MM-DD`: nuova sfida a mezzanotte UTC;
// - auto: una delle quattro pubbliche, mai la stessa del giorno prima;
// - modalità: HARD il sabato e la domenica ("HARD WEEKEND"), NORMAL gli altri giorni;
// - `trafficSalt`: il traffico del giorno (`StageDef.trafficSalt`), stesse
//   regole e stessa densità, solo un altro seme.

import { mulberry32 } from '../core/rng';
import type { CarChoice, Difficulty } from './kinds';

/** Le auto della sfida: le quattro pubbliche, mai la classica. */
export const DAILY_CARS: readonly CarChoice[] = ['new', 'retro', 'sport', 'super'];

export interface DailyChallenge {
  key: string;
  car: CarChoice;
  mode: Difficulty;
  /** Mescolato al seme del traffico di ogni tappa; mai zero. */
  trafficSalt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** La chiave della sfida all'istante `now`: la data UTC. Pura. */
export function dailyKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Giorni dal 1970-01-01 UTC, o NaN se la chiave non è una data vera. Pura. */
function dayNumber(key: string): number {
  const m = KEY_RE.exec(key);
  if (!m) return Number.NaN;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dailyKey(new Date(t)) === key ? t / DAY_MS : Number.NaN;
}

/** Vero se `key` è una data `YYYY-MM-DD` che esiste. Pura. */
export function parseDailyKey(key: string): boolean {
  return Number.isFinite(dayNumber(key));
}

/** La chiave `days` giorni dopo `key` (anche negativi). Pura. */
export function addDays(key: string, days: number): string {
  return dailyKey(new Date((dayNumber(key) + days) * DAY_MS));
}

/** Millisecondi fino alla prossima mezzanotte UTC. Pura. */
export function msToNextDaily(now: Date): number {
  const t = now.getTime();
  return (Math.floor(t / DAY_MS) + 1) * DAY_MS - t;
}

/** FNV-1a a 32 bit, la stessa di `stageSeed` in `game/stages.ts`. Pura. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** L'auto "grezza" del giorno `n`, senza guardare i vicini. Pura. */
const rawCar = (n: number): number => Math.floor(mulberry32(fnv1a(`daily-car:${n}`)).next() * DAILY_CARS.length);

/**
 * Indice dell'auto del giorno `n`, senza ricorsione sui giorni prima: i
 * giorni pari tengono l'auto grezza, i dispari ne scelgono una diversa da
 * quelle dei due vicini (pari). Così due giorni di fila non hanno mai la
 * stessa auto, e il server calcola un giorno qualunque in tempo costante.
 */
function carIndex(n: number): number {
  if (n % 2 === 0) return rawCar(n);
  const avoid = new Set([rawCar(n - 1), rawCar(n + 1)]);
  const free = DAILY_CARS.map((_, i) => i).filter((i) => !avoid.has(i));
  return free[Math.floor(mulberry32(fnv1a(`daily-odd:${n}`)).next() * free.length)];
}

/** La sfida del giorno `key` (`YYYY-MM-DD`). Pura; lancia su una chiave invalida. */
export function dailyChallenge(key: string): DailyChallenge {
  const n = dayNumber(key);
  if (!Number.isFinite(n)) throw new Error(`invalid daily key: ${JSON.stringify(key)}`);
  // 1970-01-01 era giovedì: (n + 4) % 7 è il giorno della settimana, 0 = domenica.
  const weekday = (((n + 4) % 7) + 7) % 7;
  const mode: Difficulty = weekday === 0 || weekday === 6 ? 'hard' : 'normal';
  return { key, car: DAILY_CARS[carIndex(n)], mode, trafficSalt: fnv1a(`daily-traffic:${key}`) || 1 };
}
