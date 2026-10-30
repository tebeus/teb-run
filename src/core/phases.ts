// Caricamento a fasi degli sprite (lancio, punto 12; spec telefono e finali
// §B.2). Tre fasi:
// - 0, prima del titolo: solo titolo e radio (`TITLE_SPRITES` e le
//   anteprime delle auto);
// - 1, mentre il giocatore è su titolo e radio: la prima tappa con l'auto
//   scelta, cioè il suo tema e gli sprite condivisi che disegna davvero
//   (`FIRST_STAGE_SPRITES`, generato da un test), più gli effetti;
// - 2, il resto, in background nell'ordine in cui il gioco lo chiederà.
//
// Le regole stanno sui nomi dei file del manifest (le chiavi), in moduli
// senza import di valori: li leggono sia `core/assets.ts` sia
// `tools/check-builds.mjs`, che misura le fasi della build.

import { FIRST_STAGE_SPRITES } from './firstStageSprites.ts';

/** I cinque temi delle tappe (`ThemeId` di types.ts). */
export const PHASE_THEMES = ['beach', 'desert', 'alpine', 'farm', 'town'] as const;

/** Le auto con i propri frame (`CarChoice` di types.ts): `new` ha il prefisso nudo `player_`. */
export const PHASE_CARS = ['new', 'classic', 'retro', 'sport', 'super'] as const;

/**
 * La prima tappa del gioco (`REAL_GRAPH.first()`, un test lo controlla),
 * scritta qui per `tools/check-builds.mjs`, che non può importare il grafo.
 */
export const FIRST_STAGE = { id: '0-0', theme: 'beach' } as const;

/** A chi serve un file del manifest. */
export type FileGroup =
  /** A tutte le tappe e alle schermate: titolo, radio, HUD, traffico, muri, effetti. */
  | { kind: 'shared' }
  /** Alla scenografia, al fondo e al terreno di un tema. */
  | { kind: 'theme'; theme: string }
  /** Al fondo proprio di una tappa (`bg_<id>_far`/`_near`). */
  | { kind: 'stage'; stage: string }
  /** A un'auto; `preview` è il frame dritto che la radio mostra per tutte. */
  | { kind: 'car'; car: string; preview: boolean }
  /** Solo alla fine della partita: i finali illustrati. */
  | { kind: 'late' };

const THEME_RE = new RegExp(`^(?:bg_|ground_)?(${PHASE_THEMES.join('|')})(?:_|$)`);
const CAR_RE = new RegExp(`^player_(${PHASE_CARS.filter((c) => c !== 'new').join('|')})_`);

/** Il gruppo di un file del manifest, dalla sua chiave (`alpine_pine_1`, `bg_3-1_far`...). Pura. */
export function groupOf(key: string): FileGroup {
  if (key.startsWith('ending_')) return { kind: 'late' };
  const stage = /^bg_(\d-\d)_/.exec(key);
  if (stage) return { kind: 'stage', stage: stage[1] };
  if (key.startsWith('player_')) {
    const car = CAR_RE.exec(key)?.[1] ?? 'new';
    return { kind: 'car', car, preview: key.endsWith('_straight') };
  }
  const theme = THEME_RE.exec(key);
  if (theme) return { kind: 'theme', theme: theme[1] };
  return { kind: 'shared' };
}

/** Una tappa da guidare: il suo id e il suo tema. */
export interface StageNeed {
  id: string;
  theme: string;
}

/** Gli sprite condivisi di titolo e radio: la fase 0, con le anteprime delle auto. */
export const TITLE_SPRITES: readonly string[] = ['screen_attract', 'title_logo', 'menu_cursor', 'radio_panel', 'radio_track_icons'];

const FIRST_STAGE_SHARED = new Set(FIRST_STAGE_SPRITES);

/**
 * Vero se il file condiviso `key` serve alla tappa `stage`. Per la prima
 * tappa sono quelli che disegna davvero, più gli effetti (`fx_*`: un urto
 * può capitare ovunque); per le altre, per prudenza, tutti: quando ci si
 * arriva il background li ha già portati. Pura.
 */
function sharedNeededFor(key: string, stage: StageNeed): boolean {
  if (stage.id !== FIRST_STAGE.id) return true;
  return FIRST_STAGE_SHARED.has(key) || key.startsWith('fx_');
}

/** Vero se il file `key` serve a guidare la tappa `stage` con l'auto `car`. Pura. */
export function neededFor(key: string, stage: StageNeed, car: string): boolean {
  const g = groupOf(key);
  switch (g.kind) {
    case 'shared':
      return sharedNeededFor(key, stage);
    case 'theme':
      return g.theme === stage.theme;
    case 'stage':
      return g.stage === stage.id;
    case 'car':
      return g.car === car;
    case 'late':
      return false;
  }
}

/** Una fase del caricamento: 0 prima del titolo, 1 la prima tappa, 2 il resto. */
export type LoadPhase = 0 | 1 | 2;

/**
 * La fase del file `key`, con la prima tappa `first` e l'auto `car`:
 * titolo, radio e il frame dritto di ogni auto (la radio li mostra tutti)
 * nella 0; ciò che serve a guidare la prima tappa nella 1; il resto nella
 * 2. Pura.
 */
export function phaseOf(key: string, first: StageNeed, car: string): LoadPhase {
  const g = groupOf(key);
  if ((g.kind === 'shared' && TITLE_SPRITES.includes(key)) || (g.kind === 'car' && g.preview)) return 0;
  return neededFor(key, first, car) ? 1 : 2;
}

/** Vero se il file `key` va scaricato prima del titolo (fase 0). Pura. */
export function isInitial(key: string, first: StageNeed, car: string): boolean {
  return phaseOf(key, first, car) === 0;
}

/** Livello di un id di tappa (`3-1` → 3); 0 se l'id è malformato. Pura. */
export function levelOfId(id: string): number {
  const m = /^(\d)-(\d)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** Le due tappe dopo `id` al bivio (`2-1` → `3-1`, `3-2`); nessuna dopo il livello 4. Pura. */
export function successorIds(id: string, lastLevel = 4): string[] {
  const m = /^(\d)-(\d)$/.exec(id);
  if (!m) return [];
  const level = Number(m[1]);
  const index = Number(m[2]);
  if (level >= lastLevel) return [];
  return [`${level + 1}-${index}`, `${level + 1}-${index + 1}`];
}

/**
 * Ordine del background (più basso, prima): le altre auto (la radio viene
 * subito dopo il titolo), poi temi e fondi di tappa per livello (il primo
 * livello in cui il tema compare), per ultimi i finali. `themeLevel` dà il
 * primo livello di ogni tema. Pura.
 */
export function backgroundRank(key: string, themeLevel: Readonly<Record<string, number>>): number {
  const g = groupOf(key);
  switch (g.kind) {
    case 'shared':
    case 'car':
      return 0;
    case 'theme':
      return 1 + (themeLevel[g.theme] ?? 4);
    case 'stage':
      return 1 + levelOfId(g.stage);
    case 'late':
      return 10;
  }
}
