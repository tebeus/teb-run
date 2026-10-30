import type { StageDef, ThemeId, Weather } from '../types';
import { createStageGraph, indexOf, levelOf, type StageGraph } from './stage-graph';
import { STAGE_EXTRA_TIME, STAGE_TIME_LIMITS, timeLimitFor } from './timer';

/**
 * **Definiti in `game/stage-graph.ts`**; qui solo inoltrati, perché la
 * posizione di una tappa nella griglia si legge in un posto solo. Non cercare
 * una seconda implementazione in questo file: non c'è. Prendono l'**id**, non
 * la `StageDef`, e su un id malformato ritornano 0, perché il motore li chiama
 * a ogni tick. Per validare la tabella qui sotto servono invece
 * `parseStageId`/`stageCoords`, che rifiutano un id malformato.
 */
export { indexOf, levelOf };

/** Livelli del grafo: 0..4 (spec §9). */
export const LEVELS = 5;
/** Livello finale: le sue tappe non hanno bivio e chiudono con un finale. */
export const LAST_LEVEL = LEVELS - 1;

/**
 * Lunghezza in segmenti: `3170 + 576 * difficoltà` (spec §9). **Deroga
 * (collaudo utente: troppo facile, troppi secondi).** Erano 2200 e 400, poi
 * 2640 e 480 (+20 %); al secondo collaudo («ancora troppo facile») un altro
 * +20 %: 3170 e 576. La struttura (15 tappe, 5 per partita) non si tocca —
 * la leva è la lunghezza, insieme ai tempi di `game/timer.ts`.
 */
export const BASE_LENGTH_SEGMENTS = 3170;
export const LENGTH_PER_DIFFICULTY = 576;

/** Corsie e larghezza per tema (spec §9): le città e la montagna sono strette. */
export const THEME_ROAD: Record<ThemeId, { lanes: 3 | 4; roadHalf: number }> = {
  beach: { lanes: 4, roadHalf: 1 },
  desert: { lanes: 4, roadHalf: 1 },
  farm: { lanes: 4, roadHalf: 1 },
  town: { lanes: 3, roadHalf: 0.8 },
  alpine: { lanes: 3, roadHalf: 0.8 },
};

/** Riga della tabella di spec §9: tutto il resto è derivato. */
export interface StageSpec {
  id: string;
  name: string;
  theme: ThemeId;
  difficulty: number;
}

/** Le 15 tappe di spec §9, nell'ordine della tabella (livello crescente, indice crescente). */
export const STAGE_SPECS: readonly StageSpec[] = [
  { id: '0-0', name: 'Palm Bay', theme: 'beach', difficulty: 0.15 },
  { id: '1-0', name: 'Sandstone Gate', theme: 'desert', difficulty: 0.3 },
  { id: '1-1', name: 'Blue Lagoon', theme: 'beach', difficulty: 0.3 },
  { id: '2-0', name: 'Red Canyon', theme: 'desert', difficulty: 0.45 },
  { id: '2-1', name: 'Pine Pass', theme: 'alpine', difficulty: 0.45 },
  { id: '2-2', name: 'Golden Fields', theme: 'farm', difficulty: 0.45 },
  { id: '3-0', name: 'Old Harbor', theme: 'town', difficulty: 0.6 },
  { id: '3-1', name: 'Cloud Ridge', theme: 'alpine', difficulty: 0.62 },
  { id: '3-2', name: 'Vine Hills', theme: 'farm', difficulty: 0.6 },
  { id: '3-3', name: 'Salt Flats', theme: 'desert', difficulty: 0.65 },
  { id: '4-0', name: 'Marble Avenue', theme: 'town', difficulty: 0.75 },
  { id: '4-1', name: 'Glacier Road', theme: 'alpine', difficulty: 0.8 },
  { id: '4-2', name: 'Windmill Coast', theme: 'farm', difficulty: 0.75 },
  { id: '4-3', name: 'Dune Highway', theme: 'desert', difficulty: 0.85 },
  { id: '4-4', name: 'Sunset Lagoon', theme: 'beach', difficulty: 0.7 },
];

/**
 * Le sei tappe con meteo (spec §4.4f e §9), per id. Tabella separata da
 * `STAGE_SPECS`, che è la trascrizione della tabella di spec §9 e non
 * cambia forma: qui ci sono solo le eccezioni, e le altre nove tappe
 * sono serene per assenza. Due per tipo, una al livello 3 e una al
 * livello 4, così nessuno dei sedici percorsi le incontra tutte e
 * nessuno le evita tutte.
 */
export const STAGE_WEATHER: Readonly<Record<string, Weather>> = {
  '3-0': 'rain',
  '3-1': 'snow',
  '3-3': 'dust',
  '4-1': 'snow',
  '4-2': 'rain',
  '4-3': 'dust',
};

/** Coordinate di una tappa nella griglia triangolare. */
export interface StageCoords {
  level: number;
  index: number;
}

/**
 * Interpreta un id "l-i". Ritorna null se la forma non è quella prevista o se
 * `i` esce dal triangolo (0 <= i <= l < LEVELS). Severa di proposito: serve a
 * validare la tabella di F, non a leggere id nel percorso caldo del motore,
 * per cui ci sono `levelOf` e `indexOf` del binario E.
 */
export function parseStageId(id: string): StageCoords | null {
  const m = /^(\d)-(\d)$/.exec(id);
  if (!m) return null;
  const level = Number(m[1]);
  const index = Number(m[2]);
  if (level >= LEVELS || index > level) return null;
  return { level, index };
}

/** Come `parseStageId` ma lancia: usarla quando un id non valido è un errore di programmazione. */
export function stageCoords(id: string): StageCoords {
  const c = parseStageId(id);
  if (!c) throw new Error(`malformed stage id: ${JSON.stringify(id)}`);
  return c;
}

/**
 * Seme deterministico da un id: FNV-1a a 32 bit. Due id diversi danno semi
 * diversi (verificato nei test sui 15 id reali), così due tappe non condividono
 * mai il tracciato.
 */
export function stageSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Lunghezza in segmenti, arrotondata: `576 * 0.15` non è esatto in virgola mobile. */
export function lengthFor(difficulty: number): number {
  return Math.round(BASE_LENGTH_SEGMENTS + LENGTH_PER_DIFFICULTY * difficulty);
}

/**
 * Limite di tempo della tappa in **secondi interi**: quello proprio della
 * tappa `id` in `STAGE_TIME_LIMITS` (deroga del terzo collaudo), se c'è.
 * Altrimenti la regola di spec §8
 * (base per livello, ×0.92 sopra difficoltà 0.7) è di `game/timer.ts` e non si
 * riscrive qui: `timeLimitFor` ritorna 53,36 al livello 4, e l'arrotondamento
 * appartiene a chi definisce le tappe, non alla regola. Nome diverso da quello
 * di `timer.ts` di proposito: due funzioni omonime con arrotondamento diverso
 * sono una trappola.
 */
export function stageTimeLimit(level: number, difficulty: number, id?: string): number {
  // Deroga del terzo collaudo: le tappe vere hanno un limite proprio.
  const own = id === undefined ? undefined : STAGE_TIME_LIMITS[id];
  return own ?? Math.round(timeLimitFor(level, difficulty));
}

/**
 * Costruisce la `StageDef` completa da una riga della tabella. Nome distinto da
 * `makeStage` di `game/demo-graph.ts`, che ha argomenti posizionali.
 */
export function stageFromSpec(spec: StageSpec): StageDef {
  const { level } = stageCoords(spec.id);
  return {
    id: spec.id,
    name: spec.name,
    theme: spec.theme,
    lengthSegments: lengthFor(spec.difficulty),
    timeLimit: stageTimeLimit(level, spec.difficulty, spec.id),
    ...(STAGE_EXTRA_TIME[spec.id] === undefined ? {} : { extraTime: STAGE_EXTRA_TIME[spec.id] }),
    seed: stageSeed(spec.id),
    difficulty: spec.difficulty,
    lanes: THEME_ROAD[spec.theme].lanes,
    roadHalf: THEME_ROAD[spec.theme].roadHalf,
    weather: STAGE_WEATHER[spec.id] ?? 'clear',
  };
}

/** Le 15 tappe, nell'ordine di `STAGE_SPECS`. */
export const STAGE_LIST: readonly StageDef[] = STAGE_SPECS.map(stageFromSpec);

/** Le 15 tappe per id. */
export const STAGES: ReadonlyMap<string, StageDef> = new Map(STAGE_LIST.map((s) => [s.id, s]));

/** Tappa per id. Lancia su un id sconosciuto: è sempre un errore di programmazione. */
export function stageById(id: string): StageDef {
  const stage = STAGES.get(id);
  if (!stage) throw new Error(`unknown stage id: ${JSON.stringify(id)}`);
  return stage;
}

/**
 * Prima tappa del gioco (spec §9). Decorativa: `REAL_GRAPH.first()` non legge
 * questa costante, viene da `createStageGraph` del binario E, che hardcoda
 * `'0-0'`. Un test lega le due cose, quindi non possono divergere senza che il
 * test se ne accorga, ma la leva vera è quella di E, non questa costante.
 */
export const FIRST_STAGE_ID = '0-0';

/**
 * La griglia triangolare della spec §9 la implementa `createStageGraph` del
 * binario E: F non riscrive quell'aritmetica, la istanzia sulle 15 tappe vere.
 */
const GRID: StageGraph = createStageGraph(STAGE_LIST);

/**
 * Grafo reale: `createStageGraph` sulle 15 tappe, più due guardie che il
 * motore rende sicure e utili (contratto del binario E).
 *
 * - `next` delega, quindi ritorna `null` al livello 4 e **non lancia** lì: il
 *   motore la chiama a ogni tick negli ultimi 200 segmenti di ogni tappa.
 * - `next` ed `endingOf` lanciano su una `StageDef` che non è una delle 15.
 *   Senza la guardia `createStageGraph`, su un id come "demo", leggerebbe
 *   livello 0 e indice 0 e risponderebbe `1-0`: un successore plausibile ma
 *   sbagliato. Il motore passa solo tappe uscite dal grafo, quindi la guardia
 *   non scatta mai in gioco e intercetta solo un errore di programmazione.
 * - `endingOf` lancia fuori dal livello 4, dove il generico ritornerebbe un
 *   finale credibile per una tappa intermedia. È chiamata solo dopo che `next`
 *   ha ritornato `null`, quindi solo sul livello 4.
 */
export const REAL_GRAPH: StageGraph = {
  first(): StageDef {
    return GRID.first();
  },
  next(stage: StageDef, side: 'L' | 'R'): StageDef | null {
    requireKnown(stage);
    return GRID.next(stage, side);
  },
  endingOf(stage: StageDef): number {
    requireKnown(stage);
    if (levelOf(stage.id) !== LAST_LEVEL) {
      throw new Error(`stage ${stage.id} is not a final stage: endings exist only at level ${LAST_LEVEL}`);
    }
    return GRID.endingOf(stage);
  },
};

/** Lancia se la tappa non è una delle 15: il chiamante ne ha fabbricata una. */
function requireKnown(stage: StageDef): void {
  if (!STAGES.has(stage.id)) throw new Error(`unknown stage: ${JSON.stringify(stage.id)}`);
}

/** Numero massimo di scelte in un percorso: una per ogni bivio (spec §9). */
export const MAX_ROUTE_LENGTH = LAST_LEVEL;

/**
 * Percorso come stringa per la classifica, es. "L R L R" (spec §11). Percorso
 * vuoto → stringa vuota; è lo stesso formato che `nameEntry` salva già.
 */
export function routeString(route: readonly ('L' | 'R')[]): string {
  return route.join(' ');
}

/**
 * Tappe attraversate da un percorso, prima tappa inclusa: un percorso di `n`
 * scelte dà `n + 1` tappe. Lancia se il percorso è più lungo dei bivi esistenti.
 */
export function stagesAlongRoute(route: readonly ('L' | 'R')[]): StageDef[] {
  if (route.length > MAX_ROUTE_LENGTH) {
    throw new Error(`route too long: ${route.length} choices, at most ${MAX_ROUTE_LENGTH}`);
  }
  const stages: StageDef[] = [REAL_GRAPH.first()];
  for (const side of route) {
    const next = REAL_GRAPH.next(stages[stages.length - 1], side);
    if (!next) throw new Error(`route too long: no fork after stage ${stages[stages.length - 1].id}`);
    stages.push(next);
  }
  return stages;
}
