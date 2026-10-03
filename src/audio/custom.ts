// Brani personali dell'utente: i file che mette in public/music/custom/,
// elencati in manifest.json da `tools/process-audio.py --music`. Modulo puro
// più una funzione di caricamento che non rifiuta mai.
//
// Il manifest lo genera il nostro tool, ma è un file di testo dentro
// `public/`: chiunque può modificarlo a mano, e allora `file` va trattato
// come input non fidato. Un nome che contiene un separatore, un `..` o uno
// schema non diventa un URL: il gioco lo butta e va avanti.

/** Cartella dei brani, relativa alla base di Vite come gli sprite. */
export const CUSTOM_BASE = `${import.meta.env.BASE_URL}music/custom/`;
export const CUSTOM_MANIFEST_URL = `${CUSTOM_BASE}manifest.json`;
/** Tetto all'elenco, uguale a quello del tool (spec §13a). */
export const MAX_CUSTOM_TRACKS = 32;
/** Estensioni che un browser sa riprodurre con <audio>. */
export const CUSTOM_EXTENSIONS = ['.mp3', '.ogg', '.oga', '.m4a', '.wav', '.flac'] as const;

export interface CustomTrack {
  /** Nome del file, senza percorso: sta in CUSTOM_BASE. */
  file: string;
  /** Titolo da mostrare nella radio. */
  title: string;
}

/** Vero solo per un nome di file semplice, senza percorso. Pura. */
export function isPlainFileName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(name)) return false;
  return true;
}

function hasAudioExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return CUSTOM_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Manifest letto in modo tollerante: ciò che non si capisce si butta. Pura. */
export function parseCustomManifest(raw: unknown): CustomTrack[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomTrack[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const file = record['file'];
    const title = record['title'];
    if (typeof file !== 'string' || typeof title !== 'string') continue;
    const trimmed = title.trim();
    if (trimmed === '') continue;
    if (!isPlainFileName(file) || !hasAudioExtension(file)) continue;
    out.push({ file, title: trimmed });
    if (out.length >= MAX_CUSTOM_TRACKS) break;
  }
  return out;
}

/**
 * URL del brano, o null se il nome non è un nome di file semplice.
 * `encodeURIComponent` sul nome: gli spazi e i cancelletti nei nomi dei file
 * di musica sono la norma, e un `#` non codificato taglierebbe l'URL.  Pura.
 */
export function customTrackUrl(base: string, file: string): string | null {
  if (!isPlainFileName(file)) return null;
  return `${base}${encodeURIComponent(file)}`;
}

export interface CustomEnv {
  fetchJson(url: string): Promise<unknown>;
  log(message: string): void;
}

/**
 * Legge il manifest. Non rifiuta mai: senza manifest non ci sono brani
 * personali, che è il caso normale di chi non ne ha messi (spec §13a).
 */
export async function loadCustomManifest(
  env: CustomEnv,
  url: string = CUSTOM_MANIFEST_URL,
): Promise<CustomTrack[]> {
  try {
    const tracks = parseCustomManifest(await env.fetchJson(url));
    env.log(`brani personali: ${tracks.length}`);
    return tracks;
  } catch (reason) {
    env.log(`nessun brano personale (${url}): ${String(reason)}`);
    return [];
  }
}
