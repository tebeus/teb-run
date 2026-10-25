// Il client della classifica mondiale (spec classifica e sfida, §2.7). Solo
// nelle build con `WORLD_BOARD_BUILD` (site, e la privata con `?board=local`):
// nelle altre il bundler toglie questo modulo con l'indirizzo dell'API.
//
// Le schermate non aspettano mai la rete: leggono quello che è già
// arrivato (`top`, `daily`, `submitted`) e chiedere è un effetto collaterale.
// Ogni richiesta ha 3 s di tempo, non manda cookie (`credentials: 'omit'`) e
// non ha librerie; un errore, un timeout o una risposta strana valgono
// "niente": nessun messaggio, resta la TOP 10 locale.

import type { CarChoice, Difficulty } from '../types';
import type { RunBody } from '../shared/validate';
import type { BoardClient, BoardName, BoardRow, DailyInfo, DailyRow, SubmitResult } from './types';

export const BOARD_TIMEOUT_MS = 3000;
export const TOP_FRESH_MS = 60_000;
export const DAILY_FRESH_MS = 300_000;

export interface BoardEnv {
  origin: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
}

const CARS: readonly CarChoice[] = ['new', 'retro', 'sport', 'super'];
const MODES: readonly Difficulty[] = ['normal', 'hard'];
const isCar = (v: unknown): v is CarChoice => CARS.includes(v as CarChoice);
const isMode = (v: unknown): v is Difficulty => MODES.includes(v as Difficulty);
const isScore = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e8;
const isInitials = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);

/** Una riga di `/top` nella forma giusta, o null. Pura. */
export function parseBoardRow(v: unknown): BoardRow | null {
  const r = v as Record<string, unknown> | null;
  if (r === null || typeof r !== 'object') return null;
  if (!isInitials(r.initials) || !isScore(r.score) || !isCar(r.car) || typeof r.stageId !== 'string' || !/^\d-\d$/.test(r.stageId)) return null;
  const ending = r.ending === null || r.ending === undefined ? null : Number.isInteger(r.ending) ? (r.ending as number) : null;
  return { initials: r.initials, score: r.score, car: r.car, stageId: r.stageId, ending };
}

const parseDailyRow = (v: unknown): DailyRow | null => {
  const r = v as Record<string, unknown> | null;
  return r !== null && typeof r === 'object' && isInitials(r.initials) && isScore(r.score) && isCar(r.car) ? { initials: r.initials, score: r.score, car: r.car } : null;
};

const rows3 = (v: unknown): DailyRow[] => (Array.isArray(v) ? v.map(parseDailyRow).filter((r): r is DailyRow => r !== null).slice(0, 3) : []);

/** `/daily` nella forma giusta, o null. Pura. */
export function parseDailyInfo(v: unknown): DailyInfo | null {
  const d = v as Record<string, any> | null;
  if (d === null || typeof d !== 'object' || typeof d.date !== 'string') return null;
  const c = d.challenge;
  const y = d.yesterday;
  if (!isCar(c?.car) || !isMode(c?.mode) || typeof y !== 'object' || y === null || typeof y.date !== 'string') return null;
  if (!isCar(y.challenge?.car) || !isMode(y.challenge?.mode)) return null;
  return {
    date: d.date,
    challenge: { car: c.car, mode: c.mode },
    nextChallengeInMinutes: typeof d.nextChallengeInMinutes === 'number' ? d.nextChallengeInMinutes : 0,
    yesterday: { date: y.date, challenge: { car: y.challenge.car, mode: y.challenge.mode }, champion: parseDailyRow(y.champion), top3: rows3(y.top3) },
    today: { top3: rows3(d.today?.top3) },
  };
}

interface Slot<T> {
  value: T | null;
  at: number;
  pending: boolean;
}

export function createBoardClient(env: BoardEnv): BoardClient {
  const tops = new Map<string, Slot<BoardRow[]>>();
  const dailySlot: Slot<DailyInfo> = { value: null, at: -Infinity, pending: false };
  let last: { status: 'pending' | 'done' | 'failed'; result?: SubmitResult } | null = null;

  /** Una richiesta con 3 s di tempo e senza cookie; ogni guasto è null. */
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BOARD_TIMEOUT_MS);
    try {
      const res = await env.fetch(`${env.origin}${path}`, { ...init, credentials: 'omit', mode: 'cors', signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function refresh<T>(slot: Slot<T>, path: string, parse: (v: unknown) => T | null): void {
    if (slot.pending) return;
    slot.pending = true;
    void request(path).then((body) => {
      slot.pending = false;
      const value = body === null ? null : parse(body);
      if (value !== null) {
        slot.value = value;
        slot.at = env.now();
      }
    });
  }

  const topSlot = (mode: Difficulty, board: BoardName): Slot<BoardRow[]> => {
    const key = `${mode}:${board}`;
    let slot = tops.get(key);
    if (slot === undefined) {
      slot = { value: null, at: -Infinity, pending: false };
      tops.set(key, slot);
    }
    return slot;
  };

  const parseTop = (v: unknown): BoardRow[] | null => {
    const rows = (v as { rows?: unknown } | null)?.rows;
    return Array.isArray(rows) ? rows.map(parseBoardRow).filter((r): r is BoardRow => r !== null).slice(0, 10) : null;
  };

  const top = (mode: Difficulty, board: BoardName): BoardRow[] | null => {
    const slot = topSlot(mode, board);
    if (env.now() - slot.at >= TOP_FRESH_MS) refresh(slot, `/top?mode=${mode}&board=${board}`, parseTop);
    return slot.value;
  };

  return {
    top,
    wouldQualify(mode, board, score) {
      const rows = topSlot(mode, board).value;
      if (rows === null) return null;
      if (!(score > 0)) return false;
      return rows.length < 10 || score > rows[rows.length - 1].score;
    },
    submit(run: RunBody, board) {
      last = { status: 'pending' };
      void request('/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run) }).then((body) => {
        const r = body as { rank?: unknown; total?: unknown } | null;
        if (r !== null && Number.isInteger(r.rank) && Number.isInteger(r.total) && (r.rank as number) >= 1) {
          last = { status: 'done', result: { board, rank: r.rank as number, total: r.total as number } };
          // La classifica è cambiata: alla prossima lettura si richiede.
          topSlot(run.mode, board).at = -Infinity;
          top(run.mode, board);
          if (board === 'today') topSlot(run.mode, 'alltime').at = -Infinity;
        } else {
          last = { status: 'failed' };
        }
      });
    },
    submitted: () => last,
    daily() {
      if (env.now() - dailySlot.at >= DAILY_FRESH_MS) refresh(dailySlot, '/daily', parseDailyInfo);
      return dailySlot.value;
    },
  };
}
