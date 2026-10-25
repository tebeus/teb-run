// Le forme della classifica mondiale viste dal gioco (spec classifica e
// sfida, §2.3 e §4). Il client vero è `net/board.ts`, solo nelle build con
// `WORLD_BOARD_BUILD`; le schermate vedono solo questa interfaccia, sincrona:
// leggono quello che è già arrivato e non aspettano mai la rete.

import type { CarChoice, Difficulty } from '../types';
import type { RunBody } from '../shared/validate';

export type BoardName = 'today' | 'alltime' | 'daily';

export interface BoardRow {
  initials: string;
  score: number;
  car: CarChoice;
  stageId: string;
  ending: number | null;
}

/** Una riga di `/daily`: iniziali, punteggio, auto. */
export interface DailyRow {
  initials: string;
  score: number;
  car: CarChoice;
}

export interface DailyInfo {
  date: string;
  challenge: { car: CarChoice; mode: Difficulty };
  nextChallengeInMinutes: number;
  yesterday: { date: string; challenge: { car: CarChoice; mode: Difficulty }; champion: DailyRow | null; top3: DailyRow[] };
  today: { top3: DailyRow[] };
}

export interface SubmitResult {
  board: BoardName;
  rank: number;
  total: number;
}

export interface BoardClient {
  /** La top 10 già arrivata (e non più vecchia di un minuto), o null; se manca la chiede. */
  top(mode: Difficulty, board: BoardName): BoardRow[] | null;
  /**
   * Il punteggio entrerebbe nella top 10? null se la risposta non è arrivata
   * (offline, o non ancora): allora vale solo la regola locale.
   */
  wouldQualify(mode: Difficulty, board: BoardName, score: number): boolean | null;
  /** Manda una partita in background; il risultato arriva in `submitted`. */
  submit(run: RunBody, board: BoardName): void;
  /** L'ultimo invio: in corso, arrivato (con la posizione) o fallito; null se nessuno. */
  submitted(): { status: 'pending' | 'done' | 'failed'; result?: SubmitResult } | null;
  /** `/daily` già arrivato, o null; se manca lo chiede. */
  daily(): DailyInfo | null;
}
