import { DEFAULT_MODE, MODES } from '../game/mode';
import type { Difficulty } from '../types';

export interface ScoreEntry {
  name: string;
  score: number;
  stageId: string;
  route: string;
  date: string;
}

/** Sottoinsieme di Storage usato: permette di iniettare uno storage finto nei test. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ScoresStore {
  load(): ScoreEntry[];
  qualifies(score: number): boolean;
  /** Ritorna il rango 1-based nella top 10, o -1 se il punteggio non entra in classifica. */
  insert(entry: ScoreEntry): number;
  clear(): void;
}

/**
 * Chiave della classifica unica di prima delle due modalità. Resta il
 * default di `createScoresStore`; il gioco usa `createModeScoresStore`, che
 * la migra in quella di NORMAL.
 */
export const LEGACY_SCORES_KEY = 'tebrun.scores.v1';
const KEY = LEGACY_SCORES_KEY;
const MAX_ENTRIES = 10;

/**
 * Tetti di lunghezza dei campi testuali. `localStorage` è scrivibile da
 * chiunque abbia la console del browser aperta, e la classifica finisce
 * dentro `drawText`, che disegna un fillRect per pixel acceso: un nome da
 * un megabyte non è un'iniezione (niente DOM, niente HTML) ma è un modo
 * gratuito di bloccare il frame. `nameEntry` produce tre lettere, quindi
 * questi limiti non tagliano mai un dato legittimo. Revisione di sicurezza
 * del binario G, vedi docs/security-review.md.
 */
export const MAX_NAME_LEN = 16;
export const MAX_FIELD_LEN = 64;

/**
 * Tetto sulla lunghezza grezza della chiave, prima di `JSON.parse`. I tetti
 * sui singoli campi (sopra) scartano una voce malformata dopo averla
 * deserializzata: chi scrive un array di diecimila voci o una singola
 * stringa da alcuni megabyte fa comunque pagare al gioco un `JSON.parse` di
 * quella taglia sessanta volte al secondo (`load()` è nel `render` del
 * titolo e della classifica). Generoso ma finito: molto più di quanto dieci
 * voci legittime, `+64` di margine per parentesi e virgole di JSON, possano
 * mai pesare.
 */
export const MAX_RAW_LEN = MAX_ENTRIES * (MAX_NAME_LEN + 3 * MAX_FIELD_LEN + 64);

/** Stringa accettabile: entro il limite e senza caratteri di controllo. Pura. */
const isPlainText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

/** Vero solo per un valore che ha tutti i campi di ScoreEntry nella forma giusta. Pura. */
const isScoreEntry = (v: unknown): v is ScoreEntry => {
  const e = v as Partial<ScoreEntry> | null;
  return (
    isPlainText(e?.name, MAX_NAME_LEN) &&
    typeof e?.score === 'number' &&
    Number.isFinite(e.score) &&
    isPlainText(e.stageId, MAX_FIELD_LEN) &&
    isPlainText(e.route, MAX_FIELD_LEN) &&
    isPlainText(e.date, MAX_FIELD_LEN)
  );
};

/**
 * Classifica su uno storage iniettabile (localStorage o un finto nei test).
 * Se lo storage lancia in scrittura, ricade e resta su una lista in memoria
 * per tutte le chiamate successive, senza ritentare lo storage rotto (quello
 * è un guasto persistente, es. quota esaurita). Un valore illeggibile in
 * lettura (JSON invalido, o un JSON valido ma non della forma attesa) non è
 * lo stesso guasto: si tratta come classifica vuota e si ripara la chiave,
 * così lo storage resta utilizzabile per la prossima sessione invece di
 * disabilitare la persistenza per sempre.
 */
export function createScoresStore(storage?: StorageLike, key: string = KEY): ScoresStore {
  let memory: ScoreEntry[] = [];
  let useMemory = !storage;

  const writeRaw = (list: ScoreEntry[]): void => {
    if (useMemory || !storage) {
      memory = list;
      return;
    }
    try {
      storage.setItem(key, JSON.stringify(list));
    } catch {
      useMemory = true;
      memory = list;
    }
  };

  const readRaw = (): ScoreEntry[] => {
    if (useMemory || !storage) return memory;
    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      // Prima della deserializzazione: una chiave più lunga di quanto dieci
      // voci legittime possano pesare è illeggibile allo stesso modo di un
      // JSON invalido, e non deve arrivare a JSON.parse.
      if (raw.length > MAX_RAW_LEN) throw new Error('classifica troppo grande da leggere');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const cleaned = parsed.filter(isScoreEntry);
      // Se il filtro ha scartato qualcosa, la chiave si ripara subito: il
      // costo del parse si paga una volta, non a ogni fotogramma finché
      // qualcuno non chiama insert().
      if (cleaned.length !== parsed.length) writeRaw(cleaned);
      return cleaned;
    } catch {
      try {
        storage.removeItem(key);
      } catch {
        useMemory = true;
      }
      return useMemory ? memory : [];
    }
  };

  // Array.prototype.sort è stabile (garantito da ES2019): a parità di
  // punteggio l'ordine relativo di ingresso è preservato. La nuova voce è
  // sempre concatenata in fondo, quindi su un pareggio perde contro le voci
  // già presenti.
  const sortAndCap = (list: ScoreEntry[]): ScoreEntry[] =>
    [...list].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);

  return {
    load() {
      return sortAndCap(readRaw());
    },
    qualifies(score) {
      const list = sortAndCap(readRaw());
      if (list.length < MAX_ENTRIES) return true;
      return score > list[list.length - 1].score;
    },
    insert(entry) {
      const list = sortAndCap([...readRaw(), entry]);
      writeRaw(list);
      const rank = list.findIndex((e) => e === entry);
      return rank >= 0 ? rank + 1 : -1;
    },
    clear() {
      writeRaw([]);
    },
  };
}

/** Chiave della classifica di una modalità (collaudo utente: due livelli). Pura. */
export function scoresKeyFor(mode: Difficulty): string {
  return `tebrun.scores.${mode}.v1`;
}

/**
 * Porta la classifica unica di prima (`LEGACY_SCORES_KEY`) in quella di
 * NORMAL, l'unica modalità che c'era: una volta sola, e solo se NORMAL non
 * ha ancora una classifica sua. Il contenuto passa com'è: la validazione è
 * di `createScoresStore`, alla prima lettura. Uno storage che lancia lascia
 * le cose come stanno.
 */
export function migrateLegacyScores(storage: StorageLike): void {
  try {
    const legacy = storage.getItem(LEGACY_SCORES_KEY);
    if (legacy === null) return;
    const target = scoresKeyFor(DEFAULT_MODE);
    if (storage.getItem(target) === null) storage.setItem(target, legacy);
    storage.removeItem(LEGACY_SCORES_KEY);
  } catch {
    // resta dov'è: la prossima sessione riprova
  }
}

/**
 * Una classifica per modalità (collaudo utente: due livelli di
 * difficoltà), dietro la stessa interfaccia di una classifica sola: ogni
 * chiamata va alla classifica della modalità che `mode()` dice in quel
 * momento. Le schermate non cambiano: il titolo mostra la classifica della
 * modalità scelta, e il nome si scrive in quella della partita appena
 * giocata, perché la modalità si cambia solo nella radio, prima della gara.
 */
export function createModeScoresStore(storage: StorageLike | undefined, mode: () => Difficulty): ScoresStore {
  if (storage) migrateLegacyScores(storage);
  const stores = new Map<Difficulty, ScoresStore>(MODES.map((m) => [m, createScoresStore(storage, scoresKeyFor(m))]));
  const current = (): ScoresStore => stores.get(mode()) ?? stores.get(DEFAULT_MODE)!;
  return {
    load: () => current().load(),
    qualifies: (score) => current().qualifies(score),
    insert: (entry) => current().insert(entry),
    clear: () => current().clear(),
  };
}

/**
 * Istanza legata a window.localStorage quando disponibile e non bloccato
 * (es. Safari in navigazione privata), altrimenti in sola memoria. Con
 * `mode` è una classifica per modalità (`createModeScoresStore`).
 */
export function createDefaultScoresStore(mode?: () => Difficulty): ScoresStore {
  const make = (storage?: StorageLike): ScoresStore =>
    mode === undefined ? createScoresStore(storage) : createModeScoresStore(storage, mode);
  try {
    if (typeof localStorage !== 'undefined') {
      const probeKey = '__tebrun_probe__';
      localStorage.setItem(probeKey, '1');
      localStorage.removeItem(probeKey);
      return make(localStorage);
    }
  } catch {
    // ricade sulla sola memoria
  }
  return make();
}
