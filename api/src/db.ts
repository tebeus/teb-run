// Le query su D1. Nessuna risposta pubblica porta `id`, `created_at` o
// `duration_ms`; le righe `hidden` non escono mai; le iniziali che la lista di
// blocco rifiuta oggi non escono nemmeno se sono state salvate prima.

import { blockedInitials } from '../../src/shared/initials';
import type { RejectReason, RunRow } from '../../src/shared/validate';
import type { CarChoice, Difficulty } from '../../src/shared/kinds';

export type PublicBoard = 'today' | 'alltime' | 'daily';

export interface PublicRow {
  initials: string;
  score: number;
  car: CarChoice;
  stageId: string;
  ending: number | null;
}

interface DbRow {
  initials: string;
  score: number;
  car: CarChoice;
  stage_id: string;
  ending: number | null;
}

/** Quante righe chiedere a D1 per riempirne `n` anche dopo il filtro delle iniziali. */
const OVERFETCH = 10;

const ORDER = 'ORDER BY score DESC, created_at ASC, id ASC';

/** Il filtro di una classifica pubblica: tabella, modo, giorno. */
function where(board: PublicBoard, mode: Difficulty, day: string): { sql: string; args: unknown[] } {
  if (board === 'alltime') return { sql: "board = 'run' AND mode = ?1 AND hidden = 0", args: [mode] };
  return { sql: `board = '${board === 'daily' ? 'daily' : 'run'}' AND mode = ?1 AND day = ?2 AND hidden = 0`, args: [mode, day] };
}

/** La top `n` di una classifica. */
export async function topRows(db: D1Database, board: PublicBoard, mode: Difficulty, day: string, n = 10): Promise<PublicRow[]> {
  const w = where(board, mode, day);
  const { results } = await db
    .prepare(`SELECT initials, score, car, stage_id, ending FROM scores WHERE ${w.sql} ${ORDER} LIMIT ${n + OVERFETCH}`)
    .bind(...w.args)
    .all<DbRow>();
  return results
    .filter((r) => !blockedInitials(r.initials))
    .slice(0, n)
    .map((r) => ({ initials: r.initials, score: r.score, car: r.car, stageId: r.stage_id, ending: r.ending }));
}

/** Salva una partita e dice dove è entrata: `rank` = 1 + chi ha fatto di più, `total` = righe visibili. */
export async function insertRun(db: D1Database, row: RunRow, nowS: number): Promise<{ rank: number; total: number }> {
  await db
    .prepare(
      'INSERT INTO scores (board, day, mode, initials, score, car, stage_id, route, ending, duration_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)',
    )
    .bind(row.board, row.day, row.mode, row.initials, row.score, row.car, row.stageId, row.route, row.ending, row.durationMs, nowS)
    .run();
  const counts = await db
    .prepare(
      'SELECT SUM(CASE WHEN score > ?4 THEN 1 ELSE 0 END) AS above, COUNT(*) AS total FROM scores WHERE board = ?1 AND mode = ?2 AND day = ?3 AND hidden = 0',
    )
    .bind(row.board, row.mode, row.day, row.score)
    .first<{ above: number | null; total: number }>();
  return { rank: (counts?.above ?? 0) + 1, total: counts?.total ?? 1 };
}

/** Un rifiuto in più per `reason` oggi: nessun dato della partita. */
export async function countRejection(db: D1Database, day: string, reason: RejectReason): Promise<void> {
  await db
    .prepare('INSERT INTO rejections (day, reason, count) VALUES (?1, ?2, 1) ON CONFLICT (day, reason) DO UPDATE SET count = count + 1')
    .bind(day, reason)
    .run();
}

export interface AdminRow {
  id: number;
  created_at: number;
  board: string;
  day: string;
  mode: string;
  initials: string;
  score: number;
  car: string;
  stage_id: string;
  route: string;
  ending: number | null;
  duration_ms: number;
  hidden: number;
}

/** Le ultime 100 righe, per l'admin. */
export async function latestRows(db: D1Database): Promise<AdminRow[]> {
  const { results } = await db.prepare('SELECT * FROM scores ORDER BY created_at DESC, id DESC LIMIT 100').all<AdminRow>();
  return results;
}

/** I rifiuti degli ultimi giorni (da `since` compreso), per l'admin. */
export async function rejectionsSince(db: D1Database, since: string): Promise<{ day: string; reason: string; count: number }[]> {
  const { results } = await db
    .prepare('SELECT day, reason, count FROM rejections WHERE day >= ?1 ORDER BY day DESC, reason ASC')
    .bind(since)
    .all<{ day: string; reason: string; count: number }>();
  return results;
}

/** Nasconde o rimostra una riga. Vero se la riga c'era. */
export async function setHidden(db: D1Database, id: number, hidden: boolean): Promise<boolean> {
  const r = await db.prepare('UPDATE scores SET hidden = ?2 WHERE id = ?1').bind(id, hidden ? 1 : 0).run();
  return (r.meta.changes ?? 0) > 0;
}
