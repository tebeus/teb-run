// Caricamento a fasi degli sprite (lancio, punto 12). All'avvio arriva solo
// ciò che serve a caricamento, titolo, radio e prima tappa con l'auto scelta;
// il resto arriva in background, nell'ordine in cui il gioco lo chiederà.
//
// Le regole stanno sui nomi dei file del manifest (le chiavi), in un modulo
// senza import di valori: lo leggono sia `core/assets.ts` sia
// `tools/check-builds.mjs`, che misura la fase iniziale della build.

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

/** Vero se il file `key` serve a guidare la tappa `stage` con l'auto `car`. Pura. */
export function neededFor(key: string, stage: StageNeed, car: string): boolean {
  const g = groupOf(key);
  switch (g.kind) {
    case 'shared':
      return true;
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

/**
 * Vero se il file `key` è della fase iniziale: tutto ciò che serve alla
 * prima tappa con l'auto scelta, più il frame dritto di ogni auto (la radio
 * li mostra tutti). Pura.
 */
export function isInitial(key: string, first: StageNeed, car: string): boolean {
  const g = groupOf(key);
  return neededFor(key, first, car) || (g.kind === 'car' && g.preview);
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
