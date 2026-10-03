// Campioni audio CC0 caricati da public/audio/. Il caricamento parte SOLO
// dopo unlock(), perché serve un AudioContext per decodeAudioData e Safari
// non ne dà uno prima di un gesto utente. Niente qui lancia mai: un file che
// manca, un manifest illeggibile o una rete muta lasciano quel buffer a null,
// e chi lo usa (motore, batteria) ricade sulla sintesi (spec §13a, §15).

/** Cartella dei campioni, servita da `public/`, relativa alla base di Vite. */
export const SAMPLE_BASE = `${import.meta.env.BASE_URL}audio/`;
export const SAMPLE_MANIFEST_URL = `${SAMPLE_BASE}manifest.json`;

export const ENGINE_SAMPLE_NAMES = ['engine_low', 'engine_high'] as const;
export const DRUM_SAMPLE_NAMES = [
  'drums/kick',
  'drums/snare',
  'drums/clap',
  'drums/hat_closed',
  'drums/hat_open',
  'drums/tom',
  'drums/cowbell',
] as const;

export type EngineSampleName = (typeof ENGINE_SAMPLE_NAMES)[number];
export type DrumSampleName = (typeof DRUM_SAMPLE_NAMES)[number];
export type SampleName = EngineSampleName | DrumSampleName;

export const SAMPLE_NAMES: readonly SampleName[] = [...ENGINE_SAMPLE_NAMES, ...DRUM_SAMPLE_NAMES];

const KNOWN = new Set<string>(SAMPLE_NAMES);

export type SampleManifest = Partial<Record<SampleName, string>>;

/**
 * Manifest letto in modo tollerante, come `parseManifest` di core/assets.ts:
 * ciò che non si capisce si butta, non si lancia. Pura.
 */
export function parseSampleManifest(raw: unknown): SampleManifest {
  const out: SampleManifest = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN.has(key)) continue;
    if (typeof value !== 'string' || value.trim() === '') continue;
    out[key as SampleName] = value.trim();
  }
  return out;
}

/**
 * URL del campione, o null se il nome uscirebbe dalla cartella o
 * dall'origine. Il manifest lo genera il nostro tool, ma è un file di testo
 * dentro `public/`: se qualcuno lo modifica a mano non deve poter far partire
 * una richiesta altrove. Pura.
 */
export function sampleUrl(base: string, file: string): string | null {
  if (file === '' || file.startsWith('/') || file.startsWith('\\')) return null;
  if (file.includes('..') || file.includes('\\')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(file)) return null;
  return `${base}${file}`;
}

/** Un buffer serve solo se ha almeno un frame e almeno un canale. Pura. */
export function usableBuffer(buffer: AudioBuffer | null | undefined): boolean {
  if (buffer === null || buffer === undefined) return false;
  return buffer.length > 0 && buffer.numberOfChannels > 0;
}

export interface SampleEnv {
  fetchJson(url: string): Promise<unknown>;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  log(message: string): void;
}

/** L'ambiente vero: `fetch` e la console. I test ne passano uno finto. */
export function createSampleEnv(): SampleEnv {
  return {
    async fetchJson(url: string): Promise<unknown> {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.json();
    },
    async fetchBytes(url: string): Promise<ArrayBuffer> {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.arrayBuffer();
    },
    log(message: string): void {
      console.info(`[audio] ${message}`);
    },
  };
}

export interface SampleStore {
  /** Si risolve quando ogni campione è stato caricato o dato per perso. Non rifiuta mai. */
  readonly ready: Promise<void>;
  /** null se il campione non c'è: il chiamante ricade sulla sintesi. */
  get(name: SampleName): AudioBuffer | null;
  readonly stats: { loaded: number; missing: number };
}

export interface LoadSamplesOptions {
  base?: string;
  manifestUrl?: string;
  env?: SampleEnv;
}

/**
 * `decodeAudioData` nella forma con le callback: è quella che funziona su
 * tutti i browser che ci interessano, compreso il Safari vecchio, dove la
 * forma che ritorna una promessa non c'è. Il wrapper la normalizza a
 * promessa, e un'eccezione sincrona (argomento rifiutato) diventa un
 * rifiuto invece di propagarsi al chiamante.
 */
function decode(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      ctx.decodeAudioData(bytes, resolve, reject);
    } catch (reason) {
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    }
  });
}

/**
 * Carica tutti i campioni del manifest. Da chiamare dopo `unlock()`: prima
 * non esiste nessun AudioContext e questa funzione non deve inventarne uno.
 */
export function loadSamples(ctx: BaseAudioContext, options: LoadSamplesOptions = {}): SampleStore {
  const base = options.base ?? SAMPLE_BASE;
  const manifestUrl = options.manifestUrl ?? SAMPLE_MANIFEST_URL;
  const env = options.env ?? createSampleEnv();
  const buffers = new Map<SampleName, AudioBuffer>();
  const stats = { loaded: 0, missing: 0 };

  async function loadOne(name: SampleName, file: string | undefined): Promise<void> {
    if (file === undefined) {
      stats.missing += 1;
      return;
    }
    const url = sampleUrl(base, file);
    if (url === null) {
      env.log(`${name}: percorso rifiutato '${file}'`);
      stats.missing += 1;
      return;
    }
    try {
      // `await` dentro il try: così anche un fetch che lancia in modo
      // sincrono (URL relativo in Node) finisce qui e non fuori.
      const bytes = await env.fetchBytes(url);
      const buffer = await decode(ctx, bytes);
      if (!usableBuffer(buffer)) throw new Error('buffer vuoto');
      buffers.set(name, buffer);
      stats.loaded += 1;
    } catch (reason) {
      env.log(`${name} non disponibile (${url}): ${String(reason)}`);
      stats.missing += 1;
    }
  }

  const ready = (async (): Promise<void> => {
    let manifest: SampleManifest = {};
    try {
      manifest = parseSampleManifest(await env.fetchJson(manifestUrl));
    } catch (reason) {
      env.log(`manifest non disponibile (${manifestUrl}): tutto sintetico. ${String(reason)}`);
      manifest = {};
    }
    await Promise.all(SAMPLE_NAMES.map((name) => loadOne(name, manifest[name])));
    env.log(`campioni: ${stats.loaded} caricati, ${stats.missing} mancanti`);
  })();

  return {
    ready,
    get(name: SampleName): AudioBuffer | null {
      return buffers.get(name) ?? null;
    },
    get stats(): { loaded: number; missing: number } {
      return { loaded: stats.loaded, missing: stats.missing };
    },
  };
}
