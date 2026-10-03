import type { SpriteName, ThemeId } from '../../types';
import type { Ctx2D, Drawer } from './palette';

/** Lato della tessera di terreno e asfalto (spec §13, Set 2). */
export const TEXTURE_TILE = 512;
/** Celle di rumore per lato: a 512 px una cella è 16 px. */
export const NOISE_GRID = 32;
/** Macchie e granelli per tessera. */
export const PATCHES = 7;
export const SPECKS = 170;

/** Seme deterministico da un nome: FNV-1a a 32 bit. */
export function textureSeed(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mescola tre interi in [0, 1). Base comune di `valueNoise` e `hash01`. */
function mix(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a, 0x1657f9e1) ^ Math.imul(b, 0x27d4eb2d)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x4bf1c1f3) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Rumore a valori **periodico**: gli indici sono riportati dentro la griglia,
 * quindi la colonna `grid` è la colonna 0 e la tessera affiancata a se stessa
 * non mostra cuciture (spec §13: ripetibile in entrambe le direzioni).
 */
export function valueNoise(seed: number, ix: number, iy: number, grid: number = NOISE_GRID): number {
  const g = Math.max(1, Math.floor(grid));
  const x = ((Math.floor(ix) % g) + g) % g;
  const y = ((Math.floor(iy) % g) + g) % g;
  return mix(seed, x, y);
}

/** Come `valueNoise` ma senza periodicità: per le decorazioni, non per il fondo. */
export function hash01(seed: number, a: number, b: number): number {
  return mix(seed ^ 0x5bf03635, Math.floor(a), Math.floor(b));
}

export interface GroundTones {
  /** Tinta di fondo: è anche il colore piatto a cui il renderer ricade. */
  base: string;
  light: string;
  dark: string;
  /** Granelli: ciuffi, sassi, stoppie. */
  speck: string;
  /** Macchie larghe e morbide. */
  patch: string;
}

/** Terreno per tema, spec §4.4a: sabbia, ocra, prato con neve, erba, pietra. */
export const GROUND_TONES: Record<ThemeId, GroundTones> = {
  beach: { base: '#e3c178', light: '#f0d698', dark: '#c9a45c', speck: '#3f8f4a', patch: '#d8b268' },
  desert: { base: '#d9b877', light: '#e8cd96', dark: '#bf9a58', speck: '#8a6a3f', patch: '#cfa964' },
  alpine: { base: '#3f6b4a', light: '#e8f2f5', dark: '#2f5539', speck: '#dfeaf0', patch: '#eaf4f7' },
  farm: { base: '#7ec850', light: '#d8c25a', dark: '#67b043', speck: '#e0d06a', patch: '#a8c95a' },
  town: { base: '#8a8f7a', light: '#a8ac98', dark: '#6f7464', speck: '#c2b98f', patch: '#9a9a84' },
};

/** Asfalto: una sola tessera per tutti i temi (spec §4.4a). */
export const ASPHALT_TONES: GroundTones = {
  base: '#6b6b6b',
  light: '#7c7c7c',
  dark: '#5c5c5c',
  speck: '#8d8d8d',
  patch: '#646464',
};

/**
 * Terra battuta e neve battuta sulla carreggiata (spec §4.4f): ripiego
 * delle due tessere di superficie. La base è il colore del velo che le
 * sostituisce (`DIRT_VEIL`, `SNOW_VEIL` di `render/ground.ts`), così senza
 * PNG la strada ha la stessa tinta di prima e in più la grana.
 */
export const SURFACE_TONES: Record<'dirt' | 'snow', GroundTones> = {
  dirt: { base: '#7a5a36', light: '#8d6a42', dark: '#63482a', speck: '#a88a62', patch: '#6e5030' },
  snow: { base: '#e6ecf2', light: '#f4f8fb', dark: '#c9d2dc', speck: '#b4bfcb', patch: '#d8e0e8' },
};

/**
 * Tessera di rumore: fondo pieno, celle chiare e scure, macchie e granelli.
 * Niente `getImageData`, niente canvas nuovi: solo `fillRect` e `ellipse`,
 * così gira anche sul contesto finto dei test.
 */
export function noiseTile(ctx: Ctx2D, w: number, h: number, seed: number, tones: GroundTones): void {
  if (!(w > 0) || !(h > 0)) return;
  ctx.fillStyle = tones.base;
  ctx.fillRect(0, 0, w, h);

  const cw = w / NOISE_GRID;
  const ch = h / NOISE_GRID;
  for (let iy = 0; iy < NOISE_GRID; iy++) {
    for (let ix = 0; ix < NOISE_GRID; ix++) {
      const v = valueNoise(seed, ix, iy);
      // La fascia centrale resta la tinta di fondo: due toni su tre bastano.
      if (v >= 0.34 && v < 0.68) continue;
      ctx.fillStyle = v < 0.34 ? tones.dark : tones.light;
      ctx.fillRect(ix * cw, iy * ch, Math.ceil(cw), Math.ceil(ch));
    }
  }

  // Macchie interamente dentro il riquadro: nessuna attraversa il bordo,
  // quindi non serve duplicarle per tenere la tessera ripetibile.
  for (let i = 0; i < PATCHES; i++) {
    const rx = w * (0.04 + 0.05 * hash01(seed, i, 1));
    const ry = h * (0.03 + 0.04 * hash01(seed, i, 2));
    const cx = rx + Math.max(0, w - 2 * rx) * hash01(seed, i, 3);
    const cy = ry + Math.max(0, h - 2 * ry) * hash01(seed, i, 4);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = tones.patch;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const speck = Math.max(1, Math.round(Math.min(w, h) / 170));
  ctx.fillStyle = tones.speck;
  for (let i = 0; i < SPECKS; i++) {
    const x = Math.max(0, w - speck) * hash01(seed, i, 5);
    const y = Math.max(0, h - speck) * hash01(seed, i, 6);
    ctx.fillRect(Math.round(x), Math.round(y), speck, speck);
  }
}

/** Le sei tessere del Set 2 (spec §13) e le due di superficie (spec §4.4f). */
export const TEXTURES: Record<SpriteName, Drawer> = {
  ground_beach: (c, w, h) => noiseTile(c, w, h, textureSeed('ground_beach'), GROUND_TONES.beach),
  ground_desert: (c, w, h) => noiseTile(c, w, h, textureSeed('ground_desert'), GROUND_TONES.desert),
  ground_alpine: (c, w, h) => noiseTile(c, w, h, textureSeed('ground_alpine'), GROUND_TONES.alpine),
  ground_farm: (c, w, h) => noiseTile(c, w, h, textureSeed('ground_farm'), GROUND_TONES.farm),
  ground_town: (c, w, h) => noiseTile(c, w, h, textureSeed('ground_town'), GROUND_TONES.town),
  asphalt: (c, w, h) => noiseTile(c, w, h, textureSeed('asphalt'), ASPHALT_TONES),
  ground_dirt_road: (c, w, h) => noiseTile(c, w, h, textureSeed('ground_dirt_road'), SURFACE_TONES.dirt),
  ground_snow_road: (c, w, h) => noiseTile(c, w, h, textureSeed('ground_snow_road'), SURFACE_TONES.snow),
};
