import { CATALOG, STRIPS, SPRITE_NAMES } from '../art/catalog';
import { GAME_NAME } from './config';
import { PROCEDURAL, hasDrawer } from '../art/procedural/index';
import type { Ctx2D } from '../art/procedural/palette';
import targetsJson from '../../tools/sprite-targets.json';
import { STAGE_PALETTES } from '../render/palette';
import { STAGES } from '../game/stages';
import { levelOf } from '../game/stage-graph';
import { backgroundRank, isInitial, neededFor, type StageNeed } from './phases';
import type { SpriteName, AssetStore, SpriteAsset } from '../types';

/**
 * Nomi opzionali `bg_<id>_far`/`bg_<id>_near` per ognuna delle quindici
 * tappe (spec §4.4f facoltativa, binario L): se il manifest ne elenca uno
 * davvero, `loadAssets` lo carica al posto dello sprite del tema; se no,
 * resta ignorato. Deliberatamente **fuori** da `CATALOG`/`SPRITE_NAMES`:
 * il catalogo non deve richiedere questi trenta PNG, `manifestWarnings` e
 * i test sulla completezza del catalogo restano sul set fisso di sempre.
 */
export const STAGE_BG_NAMES: readonly SpriteName[] = Object.keys(STAGE_PALETTES).flatMap((id) => [
  `bg_${id}_far`,
  `bg_${id}_near`,
]);

/** Un nome bg_<id>_far/near, per non far spuntare un avviso di manifest ignoto. */
const STAGE_BG_NAME_RE = /^bg_\d-\d_(far|near)$/;

// ---------------------------------------------------------------------------
// Dati e tipi
// ---------------------------------------------------------------------------

/** Voce di `public/sprites/manifest.json`. */
export interface ManifestEntry {
  file: string;
  w: number;
  h: number;
  frames?: number;
}

export type Manifest = Record<string, ManifestEntry>;

/** Voce di `tools/sprite-targets.json`: misura finale (per frame, se strip). */
export interface SpriteTarget {
  w: number;
  h: number;
  frames?: number;
}

export const TARGETS: Record<string, SpriteTarget> = targetsJson as Record<string, SpriteTarget>;

/** Nome logico → file di strip che lo contiene. */
export const STRIP_OF: Record<SpriteName, string> = (() => {
  const out: Record<string, string> = {};
  for (const [file, names] of Object.entries(STRIPS)) {
    for (const name of names) out[name] = file;
  }
  return out;
})();

/** Misura dei nomi che esistono solo in forma procedurale (nessun target). */
export const PROCEDURAL_SIZES: Record<SpriteName, { w: number; h: number }> = {
  common_barrier: { w: 160, h: 120 },
  common_gantry: { w: 1024, h: 320 },
  ground_tuft: { w: 96, h: 64 },
  ground_stone: { w: 80, h: 56 },
  ground_crack: { w: 120, h: 40 },
};

export const DEFAULT_SIZE = { w: 200, h: 200 };

/**
 * Cartella degli sprite, servita da `public/`, relativa alla base di Vite
 * (`./` in build, `/` in sviluppo): la build funziona anche da una
 * sottocartella.
 */
export const SPRITE_BASE = `${import.meta.env.BASE_URL}sprites/`;
export const SPRITE_MANIFEST_URL = `${SPRITE_BASE}manifest.json`;

/** File PNG che copre un nome logico: la strip, oppure il nome stesso. */
export function fileOf(name: SpriteName): string {
  return STRIP_OF[name] ?? name;
}

export function frameIndexOf(name: SpriteName): number {
  const file = STRIP_OF[name];
  return file ? STRIPS[file].indexOf(name) : 0;
}

export function frameCountOf(name: SpriteName): number {
  const file = STRIP_OF[name];
  return file ? STRIPS[file].length : 1;
}

export function targetSize(name: SpriteName): { w: number; h: number } {
  const target = TARGETS[fileOf(name)];
  if (target) return { w: target.w, h: target.h };
  return PROCEDURAL_SIZES[name] ?? DEFAULT_SIZE;
}

// ---------------------------------------------------------------------------
// Decisione della sorgente (pura)
// ---------------------------------------------------------------------------

export type Source =
  | { kind: 'png'; file: string; url: string; frames: number; index: number }
  | { kind: 'procedural'; w: number; h: number }
  | { kind: 'missing'; w: number; h: number };

const usableEntry = (entry: ManifestEntry | undefined): entry is ManifestEntry =>
  !!entry && Number.isFinite(entry.w) && Number.isFinite(entry.h) && entry.w > 0 && entry.h > 0;

const framesOf = (entry: ManifestEntry): number =>
  Number.isInteger(entry.frames) && (entry.frames as number) >= 1 ? (entry.frames as number) : 1;

/**
 * Da quale sorgente prendere `name`: PNG del manifest (nome logico o file di
 * strip), altrimenti disegnatore procedurale, altrimenti rettangolo magenta.
 */
export function pickSource(
  name: SpriteName,
  manifest: Manifest,
  procedural: ReadonlySet<SpriteName>,
  base = SPRITE_BASE,
): Source {
  const direct = manifest[name];
  if (usableEntry(direct)) {
    return { kind: 'png', file: name, url: base + (direct.file || `${name}.png`), frames: framesOf(direct), index: 0 };
  }
  const file = STRIP_OF[name];
  const strip = file ? manifest[file] : undefined;
  if (file && usableEntry(strip)) {
    const frames = framesOf(strip);
    const index = frameIndexOf(name);
    if (index < frames) {
      return { kind: 'png', file, url: base + (strip.file || `${file}.png`), frames, index };
    }
  }
  const size = targetSize(name);
  return procedural.has(name) ? { kind: 'procedural', ...size } : { kind: 'missing', ...size };
}

/** Rettangolo sorgente del frame `index` in un'immagine `w`x`h` con `frames` frame. */
export function frameRect(
  w: number,
  h: number,
  frames: number,
  index: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const n = Number.isInteger(frames) && frames >= 1 ? frames : 1;
  const sw = Math.floor(w / n);
  return { sx: index * sw, sy: 0, sw, sh: h };
}

// ---------------------------------------------------------------------------
// Manifest: lettura tollerante e controlli
// ---------------------------------------------------------------------------

export function parseManifest(raw: unknown): Manifest {
  const out: Manifest = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const w = v.w;
    const h = v.h;
    if (typeof w !== 'number' || typeof h !== 'number' || !(w > 0) || !(h > 0)) continue;
    const entry: ManifestEntry = {
      file: typeof v.file === 'string' && v.file.length > 0 ? v.file : `${key}.png`,
      w,
      h,
    };
    if (typeof v.frames === 'number' && Number.isInteger(v.frames) && v.frames >= 1) entry.frames = v.frames;
    out[key] = entry;
  }
  return out;
}

/** Incoerenze tra manifest, catalogo e sprite-targets, in italiano tecnico. */
export function manifestWarnings(manifest: Manifest): string[] {
  const out: string[] = [];
  for (const [key, entry] of Object.entries(manifest)) {
    const expected = STRIPS[key]?.length;
    const frames = framesOf(entry);
    if (expected !== undefined && expected !== frames) {
      out.push(`manifest ${key}: ${frames} frames, il catalogo ne aspetta ${expected}`);
      continue;
    }
    if (expected === undefined && frames > 1) {
      out.push(`manifest ${key}: ${frames} frames ma ${key} non è una strip del catalogo`);
      continue;
    }
    if (!TARGETS[key] && !CATALOG[key]) {
      // Sfondo opzionale di tappa (spec §4.4f facoltativa): riconosciuto a
      // parte da `loadAssets`, non è un refuso del manifest.
      if (STAGE_BG_NAME_RE.test(key)) continue;
      out.push(`manifest ${key}: non è in tools/sprite-targets.json né nel catalogo, ignorato`);
    }
  }
  return out;
}

export function countSources(sources: Iterable<Source>): { png: number; procedural: number; missing: number } {
  const stats = { png: 0, procedural: 0, missing: 0 };
  for (const source of sources) stats[source.kind] += 1;
  return stats;
}

export function summaryLine(
  stats: { png: number; procedural: number; missing: number },
  total: number,
): string {
  return `${GAME_NAME} assets: ${stats.png} png, ${stats.procedural} procedural, ${stats.missing} missing (${total} names)`;
}

// ---------------------------------------------------------------------------
// Runtime: ambiente iniettabile e caricamento
// ---------------------------------------------------------------------------

/** Superficie di disegno: un canvas fuori schermo più il suo contesto. */
export interface Surface {
  image: CanvasImageSource;
  ctx: Ctx2D;
  /** Copia il rettangolo sorgente su tutta la superficie. */
  blit(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): void;
}

/** Tutto ciò che `loadAssets` fa fuori da sé: rete, decodifica, canvas, log. */
export interface AssetEnv {
  fetchManifest(url: string): Promise<unknown>;
  loadImage(url: string): Promise<{ image: CanvasImageSource; w: number; h: number }>;
  surface(w: number, h: number): Surface;
  log(message: string): void;
}

const CATALOG_FALLBACK = { kind: 'scenery' as const, scale: 0.3, solid: false, collideW: 0, anchorY: 1 };

/**
 * Superficie senza un canvas reale: nessun ambiente disegnabile è
 * disponibile (né `OffscreenCanvas` né il DOM). Non disegna niente, ma
 * nessuna delle sue operazioni lancia mai, così `loadAssets` mantiene la
 * garanzia "mai bloccante" anche in questo caso limite.
 */
function noDrawSurface(w: number, h: number): Surface {
  const noop = () => undefined;
  const ctx: Ctx2D = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    fillText: noop,
    strokeText: noop,
    createLinearGradient: () => ({ addColorStop: noop }) as unknown as CanvasGradient,
  };
  // Nessun canvas reale esiste in questo ambiente: il placeholder soddisfa
  // il tipo solo per forma, il motore non lo disegna mai davvero qui.
  const image = { width: w, height: h } as unknown as CanvasImageSource;
  return { image, ctx, blit: noop };
}

export function browserEnv(): AssetEnv {
  return {
    async fetchManifest(url: string): Promise<unknown> {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`manifest ${url}: HTTP ${response.status}`);
      return response.json();
    },
    loadImage(url: string): Promise<{ image: CanvasImageSource; w: number; h: number }> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ image: img, w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error(`immagine non decodificata: ${url}`));
        img.src = url;
      });
    },
    surface(w: number, h: number): Surface {
      const width = Math.max(1, Math.round(w));
      const height = Math.max(1, Math.round(h));
      // spec §15, "asset mancanti: mai bloccanti": su un browser senza
      // OffscreenCanvas (Safari < 16.4) non si deve mai lanciare da qui, o
      // `ready` rigetta e ogni `get()` successivo lancia da `drawFallback`.
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const raw = canvas.getContext('2d');
        if (raw) {
          // Nessun cast: `OffscreenCanvasRenderingContext2D` soddisfa `Ctx2D`.
          const ctx: Ctx2D = raw;
          return {
            image: canvas,
            ctx,
            blit(src, sx, sy, sw, sh) {
              raw.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            },
          };
        }
      }
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const raw = canvas.getContext('2d');
        if (raw) {
          // Nessun cast: `CanvasRenderingContext2D` soddisfa `Ctx2D`.
          const ctx: Ctx2D = raw;
          return {
            image: canvas,
            ctx,
            blit(src, sx, sy, sw, sh) {
              raw.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            },
          };
        }
      }
      return noDrawSurface(width, height);
    },
    log(message: string): void {
      console.info(message);
    },
  };
}

function makeAsset(name: SpriteName, image: CanvasImageSource, w: number, h: number): SpriteAsset {
  return { name, image, w, h, entry: CATALOG[name] ?? CATALOG_FALLBACK };
}

/** Disegna il procedurale, o il rettangolo magenta se il disegnatore manca. */
function drawFallback(env: AssetEnv, name: SpriteName, w: number, h: number): SpriteAsset {
  const surface = env.surface(w, h);
  const draw = PROCEDURAL[name];
  if (draw) {
    draw(surface.ctx, w, h);
  } else {
    const ctx = surface.ctx;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000000';
    ctx.font = `bold ${Math.max(10, Math.round(h * 0.16))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, w / 2, h / 2);
  }
  return makeAsset(name, surface.image, w, h);
}


/**
 * `AssetStore` più `sourceOf`: la sorgente reale con cui `name` è stato
 * risolto dopo la catena di fallback (spec §13), inclusi i PNG che il
 * manifest elenca ma che poi non si decodificano. Non è nel contratto
 * frozen di `AssetStore`: serve solo alla diagnostica di `dev/galleria.ts`,
 * che altrimenti mostrerebbe intento (manifest) invece che realtà (store).
 */
export interface AssetStoreWithSource extends AssetStore, StagedAssets {
  sourceOf(name: SpriteName): Source['kind'];
  /**
   * Vero se `name` (un `bg_<id>_far`/`bg_<id>_near` di `STAGE_BG_NAMES`) è
   * stato caricato davvero da un PNG del manifest (spec §4.4f facoltativa).
   * Non è nel contratto frozen di `AssetStore`: `render/background.ts` la
   * chiede con un cast locale, opzionale, così un `AssetStore` di test che
   * non la implementa resta valido.
   */
  hasStageBg(name: SpriteName): boolean;
  /**
   * Avanzamento della **fase iniziale** del caricamento, per la schermata di
   * caricamento: `done` su `total` passi, cioè il manifest più un passo per
   * file d'immagine della fase (riuscito o no). Finché il manifest non è
   * arrivato `total` vale 1; quando `ready` risolve `done === total`. Il
   * background non lo muove.
   */
  progress(): LoadProgress;
  /** Vero se `name` è già arrivato da un'immagine, prima ancora di `ready`. */
  isLoaded(name: SpriteName): boolean;
  /** Risolve quando anche il background ha finito: ogni file è arrivato o è fallito. */
  all: Promise<void>;
}

/**
 * Caricamento a fasi (lancio, punto 12), visto da chi guida: fuori dal
 * contratto frozen di `AssetStore`, e opzionale (`ui/screens/race.ts` la
 * chiede con un controllo, così uno store di test senza fasi resta valido).
 */
export interface StagedAssets {
  /**
   * Mette in testa al background i file che servono alla tappa `stage` con
   * l'auto `car`, e dice se sono già tutti risolti (arrivati o falliti, con
   * il ripiego procedurale). Prima del manifest è falso.
   */
  requestStage(stage: StageNeed, car: string): boolean;
  /** I file della tappa `stage` con l'auto `car` già risolti, sui suoi totali: la barra dell'attesa. */
  stageProgress?(stage: StageNeed, car: string): LoadProgress;
  /**
   * Mette in testa al background il file `file` del manifest (`map_full`,
   * `ending_3`) e dice se è risolto. Vero anche se il manifest non lo
   * elenca: non c'è niente da aspettare.
   */
  requestFile?(file: string): boolean;
}

/** Le fasi di `store`, se le ha (uno store di test o la galleria possono non averle). */
export function stagedOf(store: AssetStore): StagedAssets | null {
  const maybe = store as AssetStore & Partial<StagedAssets>;
  return typeof maybe.requestStage === 'function' ? (maybe as AssetStore & StagedAssets) : null;
}

/** Passi del caricamento fatti e totali. */
export interface LoadProgress {
  done: number;
  total: number;
}

/** Quanti file del background si scaricano insieme: pochi, così una richiesta passa avanti presto. */
export const BACKGROUND_CONCURRENCY = 4;

/** Un file del manifest da scaricare, con i nomi che copre. */
interface Job {
  key: string;
  url: string;
  frames: number;
  names: SpriteName[];
  /** Uno sfondo opzionale di tappa (`STAGE_BG_NAMES`), fuori dal catalogo. */
  stageBg: boolean;
  rank: number;
  state: 'queued' | 'loading' | 'done';
}

/** Primo livello in cui compare ogni tema, per l'ordine del background. */
const THEME_LEVEL: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const stage of STAGES.values()) {
    const level = levelOf(stage.id);
    out[stage.theme] = Math.min(out[stage.theme] ?? level, level);
  }
  return out;
})();

/**
 * Carica il manifest e prepara un asset per ogni nome del catalogo, con la
 * catena di fallback della spec §13. Non rigetta mai: un asset mancante è
 * sempre sostituito, e `stats` dice da dove arriva ciascuno.
 *
 * Con `start` il caricamento va a fasi (lancio, punto 12; spec telefono e
 * finali §B.2): `ready` aspetta solo i file di `isInitial` (titolo e
 * radio), poi in testa al background arriva la prima tappa con l'auto
 * scelta, e il resto dopo (`all`), nell'ordine di
 * `backgroundRank`, con `requestStage` che passa avanti. Finché un file non
 * è arrivato, `get` dà il ripiego procedurale, poi l'immagine vera. Senza
 * `start` è tutto della fase iniziale, come prima.
 */
export function loadAssets(options: {
  manifestUrl?: string;
  procedural?: boolean;
  env?: AssetEnv;
  base?: string;
  start?: { stage: StageNeed; car: string };
  concurrency?: number;
} = {}): AssetStoreWithSource {
  const env = options.env ?? browserEnv();
  const base = options.base ?? SPRITE_BASE;
  const manifestUrl = options.manifestUrl ?? SPRITE_MANIFEST_URL;
  const concurrency = Math.max(1, options.concurrency ?? BACKGROUND_CONCURRENCY);
  const assets = new Map<SpriteName, SpriteAsset>();
  const stats = { png: 0, procedural: 0, missing: 0 };
  // Popolata dentro `ready`; letta da `sourceOf` per il badge reale della galleria.
  const sources = new Map<SpriteName, Source>();
  // Sfondi opzionali di tappa caricati davvero (spec §4.4f facoltativa):
  // letta da `hasStageBg`. Fuori da `sources`/`stats` di proposito, quei
  // numeri restano sul catalogo fisso.
  const stageBgReal = new Set<SpriteName>();
  // Avanzamento per la schermata di caricamento, e i nomi già arrivati.
  const progress: LoadProgress = { done: 0, total: 1 };
  const arrived = new Set<SpriteName>();
  // Un file per voce del manifest; null finché il manifest non è arrivato.
  let jobs: Map<string, Job> | null = null;
  let initialDone = false;
  let active = 0;
  let finishAll: () => void = () => undefined;
  const all = new Promise<void>((resolve) => {
    finishAll = resolve;
  });

  const proceduralNames = new Set<SpriteName>(SPRITE_NAMES.filter((name) => hasDrawer(name)));

  /** Scarica un file e ne mette i frame nello store; mai un'eccezione. */
  const run = async (job: Job): Promise<void> => {
    job.state = 'loading';
    try {
      const loaded = await env.loadImage(job.url);
      if (job.stageBg) {
        const name = job.names[0];
        assets.set(name, makeAsset(name, loaded.image, loaded.w, loaded.h));
        stageBgReal.add(name);
        arrived.add(name);
      } else {
        for (const name of job.names) {
          const source = sources.get(name);
          if (!source || source.kind !== 'png') continue;
          const rect = frameRect(loaded.w, loaded.h, job.frames, source.index);
          if (job.frames === 1) {
            assets.set(name, makeAsset(name, loaded.image, rect.sw, rect.sh));
          } else {
            const surface = env.surface(rect.sw, rect.sh);
            surface.blit(loaded.image, rect.sx, rect.sy, rect.sw, rect.sh);
            assets.set(name, makeAsset(name, surface.image, rect.sw, rect.sh));
          }
          arrived.add(name);
        }
      }
    } catch (error) {
      if (job.stageBg) {
        env.log(`${String(error)}: sfondo di tappa ${job.names[0]} ignorato, resta quello del tema`);
      } else {
        env.log(`${String(error)}: uso lo sprite procedurale`);
        for (const name of job.names) {
          const size = targetSize(name);
          sources.set(name, proceduralNames.has(name) ? { kind: 'procedural', ...size } : { kind: 'missing', ...size });
        }
      }
    }
    job.state = 'done';
  };

  /** Fa partire i file del background, al più `concurrency` insieme, prima i più urgenti. */
  const pump = (): void => {
    if (!initialDone || jobs === null) return;
    while (active < concurrency) {
      let next: Job | null = null;
      for (const job of jobs.values()) {
        if (job.state === 'queued' && (next === null || job.rank < next.rank)) next = job;
      }
      if (next === null) break;
      active += 1;
      void run(next).then(() => {
        active -= 1;
        pump();
      });
    }
    if (active === 0 && [...jobs.values()].every((job) => job.state === 'done')) {
      const counted = countSources(sources.values());
      stats.png = counted.png;
      stats.procedural = counted.procedural;
      stats.missing = counted.missing;
      finishAll();
    }
  };

  const ready = (async () => {
    let manifest: Manifest = {};
    if (!options.procedural) {
      try {
        manifest = parseManifest(await env.fetchManifest(manifestUrl));
      } catch {
        env.log(`manifest non disponibile (${manifestUrl}): tutti gli sprite sono procedurali`);
        manifest = {};
      }
      for (const warning of manifestWarnings(manifest)) env.log(warning);
    }

    for (const name of SPRITE_NAMES) sources.set(name, pickSource(name, manifest, proceduralNames, base));

    // Un solo caricamento per file, condiviso dai frame della stessa strip.
    const found = new Map<string, Job>();
    for (const [name, source] of sources) {
      if (source.kind !== 'png') continue;
      const job = found.get(source.file) ?? { key: source.file, url: source.url, frames: source.frames, names: [], stageBg: false, rank: 0, state: 'queued' as const };
      job.names.push(name);
      found.set(source.file, job);
    }
    // Sfondi opzionali di tappa (spec §4.4f facoltativa, binario L): solo se
    // il manifest ne elenca uno davvero. Nessun avviso e nessun segnaposto
    // per quelli assenti — `render/background.ts` ripiega da sé sul nome del
    // tema — e il catalogo non deve richiedere questi trenta file.
    if (!options.procedural) {
      for (const name of STAGE_BG_NAMES) {
        const entry = manifest[name];
        if (!usableEntry(entry)) continue;
        found.set(name, { key: name, url: base + (entry.file || `${name}.png`), frames: 1, names: [name], stageBg: true, rank: 0, state: 'queued' });
      }
    }
    for (const job of found.values()) job.rank = backgroundRank(job.key, THEME_LEVEL);
    jobs = found;

    const start = options.start;
    const initial = [...found.values()].filter((job) => !start || isInitial(job.key, start.stage, start.car));
    progress.total = 1 + initial.length;
    progress.done = 1;
    await Promise.all(
      initial.map(async (job) => {
        await run(job);
        progress.done += 1;
      }),
    );
    progress.done = progress.total;

    for (const [name, source] of sources) {
      if (source.kind === 'png') continue;
      assets.set(name, drawFallback(env, name, source.w, source.h));
    }

    const counted = countSources(sources.values());
    stats.png = counted.png;
    stats.procedural = counted.procedural;
    stats.missing = counted.missing;
    env.log(summaryLine(stats, SPRITE_NAMES.length));
    initialDone = true;
    // Fase 1 (spec telefono e finali §B.2): la prima tappa con l'auto
    // scelta passa in testa al background, mentre si è su titolo e radio.
    if (start) {
      for (const job of found.values()) {
        if (job.state === 'queued' && neededFor(job.key, start.stage, start.car)) job.rank = -1;
      }
    }
    pump();
  })();

  return {
    ready,
    all,
    has: (name: SpriteName) => Object.prototype.hasOwnProperty.call(CATALOG, name),
    get(name: SpriteName): SpriteAsset {
      const existing = assets.get(name);
      if (existing) return existing;
      // Anche un file non ancora arrivato dal background: il ripiego resta
      // finché l'immagine vera non lo sostituisce.
      const size = targetSize(name);
      const made = drawFallback(env, name, size.w, size.h);
      assets.set(name, made);
      return made;
    },
    stats,
    sourceOf(name: SpriteName): Source['kind'] {
      return sources.get(name)?.kind ?? (proceduralNames.has(name) ? 'procedural' : 'missing');
    },
    progress(): LoadProgress {
      return { done: progress.done, total: progress.total };
    },
    isLoaded(name: SpriteName): boolean {
      return arrived.has(name);
    },
    hasStageBg(name: SpriteName): boolean {
      return stageBgReal.has(name);
    },
    stageProgress(stage: StageNeed, car: string): LoadProgress {
      if (jobs === null) return { done: 0, total: 1 };
      let done = 0;
      let total = 0;
      for (const job of jobs.values()) {
        if (!neededFor(job.key, stage, car)) continue;
        total += 1;
        if (job.state === 'done') done += 1;
      }
      return { done, total };
    },
    requestFile(file: string): boolean {
      if (jobs === null) return false;
      const job = jobs.get(file);
      if (job === undefined) return true;
      if (job.state === 'queued') job.rank = -2;
      pump();
      return job.state === 'done';
    },
    requestStage(stage: StageNeed, car: string): boolean {
      if (jobs === null) return false;
      let settled = true;
      for (const job of jobs.values()) {
        if (!neededFor(job.key, stage, car)) continue;
        if (job.state !== 'done') settled = false;
        // Una tappa chiesta da chi guida passa davanti a tutto: ai file
        // chiesti da soli (-2) e alla fase 1 (-1).
        if (job.state === 'queued') job.rank = -3;
      }
      pump();
      return settled;
    },
  };
}
