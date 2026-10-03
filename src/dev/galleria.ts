import { CATALOG, SPRITE_NAMES } from '../art/catalog';
import { loadAssets } from '../core/assets';
import type { SpriteAsset, SpriteName } from '../types';

export interface GalleryRow {
  name: SpriteName;
  kind: string;
  source: 'png' | 'procedural' | 'missing';
  w: number;
  h: number;
}

/** Ciò che `galleryRows` chiede allo store: il minimo per essere testabile con un fake. */
export interface GallerySource {
  get(name: SpriteName): SpriteAsset;
  sourceOf(name: SpriteName): GalleryRow['source'];
}

/**
 * Descrizione di ogni sprite da mostrare: pura rispetto a `store` (che può
 * essere un fake nei test). Badge e misura vengono dallo store, cioè da
 * cosa `loadAssets` ha davvero caricato dopo la catena di fallback — non
 * dal manifest o dal target intesi, che possono mentire se un PNG elencato
 * non si decodifica.
 */
export function galleryRows(names: readonly SpriteName[], store: GallerySource): GalleryRow[] {
  return names.map((name) => {
    const asset = store.get(name);
    return {
      name,
      kind: CATALOG[name]?.kind ?? 'unknown',
      source: store.sourceOf(name),
      w: asset.w,
      h: asset.h,
    };
  });
}

const THUMB = 168;

function card(row: GalleryRow): HTMLElement {
  const box = document.createElement('article');
  box.className = 'card';
  const canvas = document.createElement('canvas');
  canvas.width = THUMB;
  canvas.height = THUMB;
  canvas.className = 'thumb';
  box.append(canvas);
  const title = document.createElement('h2');
  title.textContent = row.name;
  const meta = document.createElement('p');
  meta.className = `meta ${row.source}`;
  meta.textContent = `${row.source} · ${row.kind} · ${row.w}x${row.h}`;
  box.append(title, meta);
  return box;
}

function paint(canvas: HTMLCanvasElement, image: CanvasImageSource, w: number, h: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scale = Math.min(canvas.width / w, canvas.height / h);
  const dw = Math.max(1, w * scale);
  const dh = Math.max(1, h * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
}

async function main(): Promise<void> {
  const store = loadAssets();
  await store.ready;

  const rows = galleryRows(SPRITE_NAMES, store);
  const gallery = document.getElementById('gallery');
  const summary = document.getElementById('summary');
  if (!gallery || !summary) throw new Error('la pagina non ha #gallery e #summary');

  summary.textContent =
    `${rows.length} sprite: ${store.stats.png} png, ${store.stats.procedural} procedurali, ` +
    `${store.stats.missing} mancanti`;

  const kinds = [...new Set(rows.map((row) => row.kind))];
  for (const kind of kinds) {
    const section = document.createElement('section');
    const heading = document.createElement('h1');
    const group = rows.filter((row) => row.kind === kind);
    heading.textContent = `${kind} (${group.length})`;
    section.append(heading);
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const row of group) {
      const element = card(row);
      grid.append(element);
      const asset = store.get(row.name);
      const canvas = element.querySelector('canvas');
      if (canvas) paint(canvas, asset.image, asset.w, asset.h);
    }
    section.append(grid);
    gallery.append(section);
  }
}

// Il bootstrap parte solo nel browser: così i test Vitest in ambiente node
// possono importare `galleryRows` senza eseguire la pagina.
if (typeof document !== 'undefined') void main();
