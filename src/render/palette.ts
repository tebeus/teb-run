import type { SpriteName, ThemeId } from '../types';

export interface ThemePalette {
  /** Stop del gradiente cielo, dall'alto verso l'orizzonte. */
  sky: readonly [string, string, string];
  grassLight: string;
  grassDark: string;
  rumbleLight: string;
  rumbleDark: string;
  roadLight: string;
  roadDark: string;
  lane: string;
  fog: string;
  /** Il tema disegna le linee di corsia. */
  lanes: boolean;
  bgFar: SpriteName;
  bgNear: SpriteName;
  /** Banchina di terra, sabbia, ghiaia, neve sporca, pietra (spec §4.4a). */
  shoulderLight: string;
  shoulderDark: string;
  /** Fascia d'acqua oltre la banchina, dove il segmento la prevede (spec §4.4c). */
  waterLight: string;
  waterDark: string;
  /** Tessera di terreno del tema, `kind: 'texture'` nel catalogo (spec §4.4a). */
  ground: SpriteName;
  /** Tessera d'asfalto, la stessa per tutti i temi (spec §4.4a). */
  asphalt: SpriteName;
  /**
   * Velo sull'asfalto per rendere ogni tappa riconoscibile (spec §4.4a): un
   * colore piatto, disegnato dal renderer con `globalAlpha = ASPHALT_TINT_ALPHA`
   * (`render/ground.ts`, oggi 0.32).
   */
  asphaltTint: string;
  /** Striscia di nuvole fra il cielo e lo strato `far` (spec §4.4c). */
  clouds: SpriteName;
}

export const PALETTES: Record<ThemeId, ThemePalette> = {
  beach: {
    sky: ['#1f6fd0', '#5fb6e8', '#bfe9f7'],
    grassLight: '#e3c178',
    grassDark: '#c9a45c',
    rumbleLight: '#ffffff',
    rumbleDark: '#c4443c',
    roadLight: '#6b6b6b',
    roadDark: '#636363',
    lane: '#ffffff',
    fog: '#9fd8f0',
    lanes: true,
    bgFar: 'bg_beach_far',
    bgNear: 'bg_beach_near',
    shoulderLight: '#d9b878',
    shoulderDark: '#b8934f',
    waterLight: '#2f9fd0',
    waterDark: '#1d6f9e',
    ground: 'ground_beach',
    asphalt: 'asphalt',
    asphaltTint: '#7a7a7a',
    clouds: 'bg_beach_clouds',
  },
  desert: {
    sky: ['#e8842a', '#f3c46b', '#fbe6bc'],
    grassLight: '#d9b877',
    grassDark: '#cfa964',
    rumbleLight: '#ffffff',
    rumbleDark: '#b05a3a',
    roadLight: '#7a6f63',
    roadDark: '#726862',
    lane: '#ffe9b0',
    fog: '#f0d9a8',
    lanes: true,
    bgFar: 'bg_desert_far',
    bgNear: 'bg_desert_near',
    shoulderLight: '#c79a63',
    shoulderDark: '#a67a45',
    waterLight: '#3f93b4',
    waterDark: '#276d8a',
    ground: 'ground_desert',
    asphalt: 'asphalt',
    asphaltTint: '#a08a6a',
    clouds: 'bg_desert_clouds',
  },
  alpine: {
    sky: ['#0d3a7a', '#3f78c0', '#cfe6f5'],
    grassLight: '#3f6b4a',
    grassDark: '#33593d',
    rumbleLight: '#ffffff',
    rumbleDark: '#8a4a4a',
    roadLight: '#5a5f66',
    roadDark: '#53585f',
    lane: '#ffffff',
    fog: '#dfeaf2',
    lanes: false,
    bgFar: 'bg_alpine_far',
    bgNear: 'bg_alpine_near',
    shoulderLight: '#cfd6d9',
    shoulderDark: '#a8b2b8',
    waterLight: '#4f9ec2',
    waterDark: '#2c6a8c',
    ground: 'ground_alpine',
    asphalt: 'asphalt',
    asphaltTint: '#3f5a80',
    clouds: 'bg_alpine_clouds',
  },
  farm: {
    sky: ['#2a7fd0', '#79c0e8', '#dcecc0'],
    grassLight: '#7ec850',
    grassDark: '#6bb544',
    rumbleLight: '#fff3c4',
    rumbleDark: '#b5893a',
    roadLight: '#6f6a5e',
    roadDark: '#67625a',
    lane: '#fff3c4',
    fog: '#cfe0b8',
    lanes: true,
    bgFar: 'bg_farm_far',
    bgNear: 'bg_farm_near',
    shoulderLight: '#c2a765',
    shoulderDark: '#9c8446',
    waterLight: '#4593b8',
    waterDark: '#2a6784',
    ground: 'ground_farm',
    asphalt: 'asphalt',
    asphaltTint: '#53603f',
    clouds: 'bg_farm_clouds',
  },
  town: {
    sky: ['#123a6a', '#4a6fa5', '#e0d2c0'],
    grassLight: '#8a8f7a',
    grassDark: '#7c8170',
    rumbleLight: '#ffffff',
    rumbleDark: '#4a4f58',
    roadLight: '#5f5f66',
    roadDark: '#58585f',
    lane: '#ffffff',
    fog: '#d8d2c8',
    lanes: true,
    bgFar: 'bg_town_far',
    bgNear: 'bg_town_near',
    shoulderLight: '#b9b2a4',
    shoulderDark: '#938d82',
    waterLight: '#357f9e',
    waterDark: '#22566e',
    ground: 'ground_town',
    asphalt: 'asphalt',
    asphaltTint: '#2e2438',
    clouds: 'bg_town_clouds',
  },
};

export function paletteFor(theme: ThemeId): ThemePalette {
  return PALETTES[theme];
}

/**
 * Scostamento di palette di una tappa (spec §4.4f). Sovrascrive solo le
 * chiavi che nomina: tutto il resto viene dalla palette del tema.
 * **Non** deve nominare `ground`, `asphalt`, `bgFar`, `bgNear`,
 * `clouds` né `lanes`: quelli sono nomi di sprite e un interruttore, non
 * colori, e cambiarli per tappa vorrebbe dire una tessera nuova per
 * tappa (un test lo verifica).
 */
export type PaletteOverride = Partial<ThemePalette>;

/**
 * Un cielo e una tinta d'asfalto per ognuna delle quindici tappe
 * (spec §4.4f). Serve a due cose insieme: dare alle sei tappe con meteo
 * il colore del loro cielo (grigio con la pioggia, ocra con la sabbia,
 * pallido con la neve), e togliere l'impressione che le tre tappe di
 * spiaggia — o di deserto, o di campagna — siano la stessa tappa. Le
 * cinque palette di tema qui sopra **non si toccano**: modificarle
 * cambierebbe tutte e tre le tappe di quel tema insieme, che non è quello
 * che serve.
 *
 * La tinta d'asfalto conta anche sul bagnato: `kindColour` di
 * `render/ground.ts` non usa un nero fisso per l'acqua, usa la tinta
 * della tappa tirata verso `WET_VEIL`, così il cielo grigio di Old
 * Harbor e quello di Windmill Coast restano distinguibili anche sulla
 * strada.
 */
export const STAGE_PALETTES: Readonly<Record<string, PaletteOverride>> = {
  // Spiaggia: mattina, mezzogiorno, tramonto.
  '0-0': { sky: ['#1a6ed4', '#62b9ea', '#c6ecf8'], asphaltTint: '#7d8188', fog: '#a6dcf2' },
  '1-1': { sky: ['#0f86c8', '#55cfe2', '#d6f4f2'], asphaltTint: '#6e7a7a', fog: '#b8ecec' },
  '4-4': { sky: ['#6a2a7a', '#e0693f', '#ffc98c'], asphaltTint: '#5e4a52', fog: '#f2c2a0' },

  // Deserto: sole del mattino, roccia rossa, e le due tempeste di sabbia.
  '1-0': { sky: ['#d97a2a', '#f0bc62', '#fae2b4'], asphaltTint: '#a8906e', fog: '#f0d9a8' },
  '2-0': { sky: ['#c9552a', '#eb9a54', '#f8d6a6'], asphaltTint: '#9a6a52', fog: '#ecc79a' },
  '3-3': { sky: ['#b98a4a', '#d9b87e', '#e8dcc0'], asphaltTint: '#b0a488', fog: '#d8c49a' },
  '4-3': { sky: ['#8f6a34', '#bf9556', '#d8bc8a'], asphaltTint: '#9c8a62', fog: '#c2a56e' },

  // Montagna: cielo profondo, coperto, e ghiacciaio.
  '2-1': { sky: ['#0d3a7a', '#3f78c0', '#cfe6f5'], asphaltTint: '#3f5a80', fog: '#dfeaf2' },
  '3-1': { sky: ['#5a6e86', '#8ea4b8', '#dde8f0'], asphaltTint: '#4e5f70', fog: '#e8eff4' },
  '4-1': { sky: ['#33506e', '#7899b8', '#e6f2f8'], asphaltTint: '#405a72', fog: '#eef5f9' },

  // Campagna: grano, vigna al pomeriggio, e la costa che piove.
  '2-2': { sky: ['#2a7fd0', '#79c0e8', '#e4eec0'], asphaltTint: '#5f6a42', fog: '#d4e2b8' },
  '3-2': { sky: ['#3f6fa8', '#9ac2c0', '#f0e4a8'], asphaltTint: '#4a5a3a', fog: '#ddd9a4' },
  '4-2': { sky: ['#4a5560', '#7d8892', '#c0c8cc'], asphaltTint: '#2c3238', fog: '#b4bcc0' },

  // Città: il porto che piove, e il viale al crepuscolo.
  '3-0': { sky: ['#2a323c', '#55606e', '#9aa4ac'], asphaltTint: '#232a33', fog: '#98a2aa' },
  '4-0': { sky: ['#1c2f58', '#5a6f9a', '#e8d8bc'], asphaltTint: '#352a40', fog: '#dcd4c8' },
};

/**
 * Palette di una tappa da id e tema (spec §4.4f): la palette del tema
 * con lo scostamento della tappa sopra. Un id senza voce — la tappa di
 * prova di `game/demo-stage.ts`, una tappa fabbricata da un test —
 * ritorna la palette del tema, intatta. Pura: non muta nessuna delle due.
 */
export function paletteForStageId(id: string, theme: ThemeId): ThemePalette {
  const over = STAGE_PALETTES[id];
  if (over === undefined) return PALETTES[theme];
  return { ...PALETTES[theme], ...over };
}

/** Come `paletteForStageId`, prendendo id e tema dalla tappa. Pura. */
export function paletteForStage(stage: { id: string; theme: ThemeId }): ThemePalette {
  return paletteForStageId(stage.id, stage.theme);
}

/**
 * Le chiavi che la transizione fra tappe interpola con `tSky`
 * (spec §4.4d): se due palette differiscono su una di queste, il
 * passaggio senza transizione si vedrebbe come un salto.
 */
export const TRANSITION_KEYS = ['sky', 'fog', 'asphaltTint'] as const;

/**
 * Se la giunzione fra due tappe merita una transizione (§4.4d, deroga 13
 * del binario K). Spec §4.4d guardava il solo tema; con gli scostamenti
 * per tappa due tappe dello stesso tema possono avere cieli molto
 * diversi — 2-0 Red Canyon e 3-3 Salt Flats sono entrambe deserto — e
 * senza transizione il cielo salterebbe in un fotogramma. Pura.
 */
export function needsTransition(
  fromId: string,
  fromTheme: ThemeId,
  toId: string,
  toTheme: ThemeId,
): boolean {
  if (fromTheme !== toTheme) return true;
  const a = paletteForStageId(fromId, fromTheme);
  const b = paletteForStageId(toId, toTheme);
  for (const key of TRANSITION_KEYS) {
    if (key === 'sky') {
      for (let i = 0; i < 3; i++) if (a.sky[i] !== b.sky[i]) return true;
    } else if (a[key] !== b[key]) {
      return true;
    }
  }
  return false;
}

/**
 * Variante d'aspetto degli strati di parallasse per una tappa (varietà degli
 * sfondi, binario L). Le cinque coppie di sprite di tema restano cinque:
 * questa tabella non ne aggiunge, dà a ognuna delle quindici tappe un modo
 * diverso di disegnare la **stessa** coppia, così due tappe dello stesso
 * tema (es. 2-0 Red Canyon e 3-3 Salt Flats, entrambe deserto) non sembrano
 * la tappa identica.
 *
 * `render/background.ts` applica tutto questo come stato del contesto
 * (`ctx.filter`, `ctx.globalAlpha`, una `ctx.scale(-1,1)`) intorno ai disegni
 * già esistenti: zero `drawImage` in più per fotogramma.
 *
 * - `farFilter`/`nearFilter`/`cloudsFilter`: stringa per `ctx.filter` (es.
 *   `"hue-rotate(10deg) saturate(1.1)"`), la via preferita perché non
 *   disegna nulla in più: `render/background.ts` lo applica una volta sola
 *   in una copia fuori schermo per immagine (`filteredImage`), non a ogni
 *   fotogramma. Stringa vuota = nessun filtro.
 * - `veil`/`veilAlpha`: ripiego dove `ctx.filter` non esiste (Safari
 *   vecchio, i contesti finti dei test): un rettangolo di colore piatto
 *   sopra lo strato, con `globalAlpha = veilAlpha`. Un `drawImage` non lo
 *   è, ma un `fillRect` in più su un ripiego non sfora il budget dei
 *   disegni d'immagine.
 * - `farOffset`/`nearOffset`/`cloudsOffset`: scostamento aggiunto
 *   all'offset di parallasse dello snapshot, in giri di tessera: due tappe
 *   con lo stesso sprite partono da un punto diverso della strip.
 * - `mirrorNear`: specchia lo strato `near` in orizzontale, su alcune
 *   tappe dove non si vede la cucitura della tessera.
 * - `cloudsAlpha`: moltiplica l'alfa delle nuvole, la densità della tappa
 *   (più opaco = cielo più coperto) senza un secondo disegno.
 */
export interface StageBackdrop {
  farFilter: string;
  nearFilter: string;
  cloudsFilter: string;
  veil: string;
  veilAlpha: number;
  farOffset: number;
  nearOffset: number;
  cloudsOffset: number;
  mirrorNear: boolean;
  cloudsAlpha: number;
}

/** Nessuna variante: gli strati si disegnano esattamente come prima di questa tabella. */
export const NO_BACKDROP: StageBackdrop = {
  farFilter: '',
  nearFilter: '',
  cloudsFilter: '',
  veil: '#000000',
  veilAlpha: 0,
  farOffset: 0,
  nearOffset: 0,
  cloudsOffset: 0,
  mirrorNear: false,
  cloudsAlpha: 1,
};

/**
 * Una variante per ognuna delle quindici tappe. Raggruppate per tema come
 * `STAGE_PALETTES`, nello stesso ordine.
 */
export const STAGE_BACKDROPS: Readonly<Record<string, StageBackdrop>> = {
  // Spiaggia: mattina calma, mezzogiorno vivace, tramonto acceso.
  '0-0': {
    farFilter: 'hue-rotate(-6deg) saturate(1.05) brightness(1.02)',
    nearFilter: 'hue-rotate(-4deg) saturate(1.05)',
    cloudsFilter: 'brightness(1.05)',
    veil: '#fff2c0',
    veilAlpha: 0.1,
    farOffset: 0,
    nearOffset: 0,
    cloudsOffset: 0,
    mirrorNear: false,
    cloudsAlpha: 0.85,
  },
  '1-1': {
    farFilter: 'hue-rotate(8deg) saturate(1.15) brightness(1.05)',
    nearFilter: 'hue-rotate(8deg) saturate(1.1)',
    cloudsFilter: 'saturate(1.2)',
    veil: '#bdf3ec',
    veilAlpha: 0.12,
    farOffset: 0.3,
    nearOffset: 0.15,
    cloudsOffset: 0.2,
    mirrorNear: true,
    cloudsAlpha: 1.05,
  },
  '4-4': {
    farFilter: 'hue-rotate(-25deg) saturate(1.3) brightness(0.92)',
    nearFilter: 'hue-rotate(-20deg) saturate(1.25) brightness(0.9)',
    cloudsFilter: 'hue-rotate(-15deg) saturate(1.2)',
    veil: '#7a3a5e',
    veilAlpha: 0.22,
    farOffset: 0.6,
    nearOffset: 0.45,
    cloudsOffset: 0.5,
    mirrorNear: false,
    cloudsAlpha: 1.2,
  },

  // Deserto: sole del mattino, roccia rossa, le due tempeste di sabbia.
  '1-0': {
    farFilter: 'hue-rotate(4deg) saturate(1.1) brightness(1.05)',
    nearFilter: 'hue-rotate(4deg) saturate(1.05)',
    cloudsFilter: 'brightness(1.1)',
    veil: '#ffe2a0',
    veilAlpha: 0.12,
    farOffset: 0.1,
    nearOffset: 0.35,
    cloudsOffset: 0.1,
    mirrorNear: true,
    cloudsAlpha: 0.8,
  },
  '2-0': {
    farFilter: 'hue-rotate(-10deg) saturate(1.3) brightness(0.95)',
    nearFilter: 'hue-rotate(-12deg) saturate(1.3)',
    cloudsFilter: 'saturate(0.9)',
    veil: '#c9552a',
    veilAlpha: 0.18,
    farOffset: 0.4,
    nearOffset: 0.6,
    cloudsOffset: 0.3,
    mirrorNear: false,
    cloudsAlpha: 0.7,
  },
  '3-3': {
    farFilter: 'saturate(0.6) brightness(1.15)',
    nearFilter: 'saturate(0.55) brightness(1.1)',
    cloudsFilter: 'saturate(0.5) brightness(1.2)',
    veil: '#e8dcc0',
    veilAlpha: 0.28,
    farOffset: 0.55,
    nearOffset: 0.2,
    cloudsOffset: 0.6,
    mirrorNear: true,
    cloudsAlpha: 1.3,
  },
  '4-3': {
    farFilter: 'hue-rotate(14deg) saturate(0.85) brightness(0.9)',
    nearFilter: 'hue-rotate(14deg) saturate(0.8) brightness(0.88)',
    cloudsFilter: 'saturate(0.6) brightness(0.85)',
    veil: '#8f6a34',
    veilAlpha: 0.3,
    farOffset: 0.85,
    nearOffset: 0.75,
    cloudsOffset: 0.8,
    mirrorNear: false,
    cloudsAlpha: 1.35,
  },

  // Montagna: la tappa canonica, il cielo coperto, il ghiacciaio.
  '2-1': {
    farFilter: 'brightness(1.02)',
    nearFilter: 'brightness(1.02)',
    cloudsFilter: '',
    veil: '#0d3a7a',
    veilAlpha: 0.08,
    farOffset: 0.15,
    nearOffset: 0.05,
    cloudsOffset: 0.05,
    mirrorNear: false,
    cloudsAlpha: 1,
  },
  '3-1': {
    farFilter: 'saturate(0.75) brightness(0.95)',
    nearFilter: 'saturate(0.7) brightness(0.93)',
    cloudsFilter: 'saturate(0.8) brightness(1.05)',
    veil: '#5a6e86',
    veilAlpha: 0.2,
    farOffset: 0.45,
    nearOffset: 0.3,
    cloudsOffset: 0.4,
    mirrorNear: true,
    cloudsAlpha: 1.4,
  },
  '4-1': {
    farFilter: 'hue-rotate(10deg) saturate(1.1) brightness(1.08)',
    nearFilter: 'hue-rotate(10deg) saturate(1.05) brightness(1.05)',
    cloudsFilter: 'brightness(1.1)',
    veil: '#bfe3f0',
    veilAlpha: 0.16,
    farOffset: 0.7,
    nearOffset: 0.5,
    cloudsOffset: 0.65,
    mirrorNear: false,
    cloudsAlpha: 0.9,
  },

  // Campagna: grano al pomeriggio, vigna al pomeriggio, la costa che piove.
  '2-2': {
    farFilter: 'hue-rotate(-4deg) saturate(1.1) brightness(1.03)',
    nearFilter: 'hue-rotate(-4deg) saturate(1.08)',
    cloudsFilter: 'brightness(1.05)',
    veil: '#e4eec0',
    veilAlpha: 0.1,
    farOffset: 0.25,
    nearOffset: 0.1,
    cloudsOffset: 0.15,
    mirrorNear: true,
    cloudsAlpha: 0.85,
  },
  '3-2': {
    farFilter: 'hue-rotate(6deg) saturate(1.2) brightness(0.98)',
    nearFilter: 'hue-rotate(6deg) saturate(1.15)',
    cloudsFilter: 'saturate(1.1)',
    veil: '#9ac2c0',
    veilAlpha: 0.14,
    farOffset: 0.5,
    nearOffset: 0.35,
    cloudsOffset: 0.45,
    mirrorNear: false,
    cloudsAlpha: 1,
  },
  '4-2': {
    farFilter: 'saturate(0.7) brightness(0.85)',
    nearFilter: 'saturate(0.65) brightness(0.82)',
    cloudsFilter: 'saturate(0.6) brightness(0.9)',
    veil: '#4a5560',
    veilAlpha: 0.3,
    farOffset: 0.8,
    nearOffset: 0.65,
    cloudsOffset: 0.75,
    mirrorNear: true,
    cloudsAlpha: 1.5,
  },

  // Città: il porto che piove al crepuscolo, il viale caldo al tramonto.
  '3-0': {
    farFilter: 'saturate(0.6) brightness(0.8)',
    nearFilter: 'saturate(0.55) brightness(0.78)',
    cloudsFilter: 'saturate(0.5) brightness(0.85)',
    veil: '#2a323c',
    veilAlpha: 0.32,
    farOffset: 0.1,
    nearOffset: 0.55,
    cloudsOffset: 0.2,
    mirrorNear: false,
    cloudsAlpha: 1.45,
  },
  '4-0': {
    farFilter: 'hue-rotate(-14deg) saturate(1.25) brightness(0.95)',
    nearFilter: 'hue-rotate(-12deg) saturate(1.2) brightness(0.93)',
    cloudsFilter: 'hue-rotate(-10deg) saturate(1.1)',
    veil: '#5a3a20',
    veilAlpha: 0.2,
    farOffset: 0.35,
    nearOffset: 0.2,
    cloudsOffset: 0.5,
    mirrorNear: true,
    cloudsAlpha: 1.05,
  },
};

/**
 * Variante di sfondo di una tappa da id (spec del binario L): quella della
 * tabella, o `NO_BACKDROP` per un id senza voce — la tappa di prova di
 * `game/demo-stage.ts`, o nessuna tappa (schermate senza sfondo a
 * parallasse). Pura.
 */
export function backdropForStageId(id: string): StageBackdrop {
  return STAGE_BACKDROPS[id] ?? NO_BACKDROP;
}

export interface SegmentColors {
  grass: string;
  rumble: string;
  road: string;
  /** null quando il segmento non disegna la linea di corsia. */
  lane: string | null;
  shoulder: string;
  water: string;
}

/** Colori di un segmento: alternanza chiaro/scuro, linea solo sui chiari. */
export function segmentColors(pal: ThemePalette, dark: boolean): SegmentColors {
  return {
    grass: dark ? pal.grassDark : pal.grassLight,
    rumble: dark ? pal.rumbleDark : pal.rumbleLight,
    road: dark ? pal.roadDark : pal.roadLight,
    lane: pal.lanes && !dark ? pal.lane : null,
    shoulder: dark ? pal.shoulderDark : pal.shoulderLight,
    water: dark ? pal.waterDark : pal.waterLight,
  };
}

/** Durata totale della transizione fra tappe, in secondi (spec §4.4d). */
export const TRANSITION_SECONDS = 6;
/** Le tre finestre di spec §4.4d, in secondi dalla giunzione. */
export const SKY_WINDOW = { from: 0, to: 2.5 } as const;
export const ROAD_WINDOW = { from: 1.5, to: 4 } as const;
export const FAR_WINDOW = { from: 3, to: 6 } as const;

/**
 * Progresso dentro una finestra, con easing `smoothstep`: 0 prima, 1 dopo, le
 * due estremità piatte (spec §4.4d). Una finestra di durata zero commuta al
 * suo istante invece di dividere per zero. Pura.
 */
export function windowProgress(t: number, from: number, to: number): number {
  if (!(to > from)) return t >= to ? 1 : 0;
  const k = (t - from) / (to - from);
  const c = k < 0 ? 0 : k > 1 ? 1 : k;
  return c * c * (3 - 2 * c);
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Interpola due colori `#rrggbb` canale per canale. Un colore che non è un
 * esadecimale a sei cifre (per esempio un `rgba(...)`) non si può
 * interpolare: si ritorna quello più vicino, senza lanciare. Pura.
 */
export function mixHex(a: string, b: string, t: number): string {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  if (!HEX6.test(a) || !HEX6.test(b)) return k < 0.5 ? a : b;
  const ca = Number.parseInt(a.slice(1), 16);
  const cb = Number.parseInt(b.slice(1), 16);
  let out = '';
  for (let shift = 16; shift >= 0; shift -= 8) {
    const va = (ca >> shift) & 0xff;
    const vb = (cb >> shift) & 0xff;
    out += Math.round(va + (vb - va) * k)
      .toString(16)
      .padStart(2, '0');
  }
  return `#${out}`;
}

/** Dove finisce il gradiente del cielo, in frazioni dell'altezza (`drawSky`). */
export const SKY_GRADIENT_END = 0.6;
/** Posizione del secondo stop del gradiente del cielo (`drawSky`). */
export const SKY_MID_STOP = 0.55;

/**
 * Colore del cielo all'altezza `y`, cioè lo stesso valore che il gradiente di
 * `drawSky` produce lì. Serve a sfumare i bordi degli strati di parallasse
 * nel cielo esatto che hanno dietro. Pura.
 */
export function skyColourAt(pal: ThemePalette, y: number, height: number): string {
  const span = height * SKY_GRADIENT_END;
  if (!(span > 0)) return pal.sky[2];
  const t = y <= 0 ? 0 : y >= span ? 1 : y / span;
  if (t <= SKY_MID_STOP) return mixHex(pal.sky[0], pal.sky[1], t / SKY_MID_STOP);
  return mixHex(pal.sky[1], pal.sky[2], (t - SKY_MID_STOP) / (1 - SKY_MID_STOP));
}

/**
 * `#rrggbb` con un'alfa, in forma `rgba(r,g,b,a)`. Un colore che non è un
 * esadecimale a sei cifre torna com'è: i gradienti lo accettano comunque.
 * Pura.
 */
export function rgbaOf(hex: string, alpha: number): string {
  if (!HEX6.test(hex)) return hex;
  const c = Number.parseInt(hex.slice(1), 16);
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${a})`;
}

/**
 * Palette intermedia fra due temi (spec §4.4d): cielo e nebbia seguono
 * `tSky`, i colori di strada e terreno seguono `tRoad`. I **nomi** delle
 * tessere e degli strati restano quelli di `a`: le due tessere si disegnano
 * entrambe, e chi disegna chiede i nomi nuovi a `paletteFor(to)`. Pura: non
 * muta nessuna delle due palette.
 */
export function blendPalette(
  a: ThemePalette,
  b: ThemePalette,
  tSky: number,
  tRoad: number,
): ThemePalette {
  const sky = (i: 0 | 1 | 2): string => mixHex(a.sky[i], b.sky[i], tSky);
  return {
    sky: [sky(0), sky(1), sky(2)],
    fog: mixHex(a.fog, b.fog, tSky),
    grassLight: mixHex(a.grassLight, b.grassLight, tRoad),
    grassDark: mixHex(a.grassDark, b.grassDark, tRoad),
    shoulderLight: mixHex(a.shoulderLight, b.shoulderLight, tRoad),
    shoulderDark: mixHex(a.shoulderDark, b.shoulderDark, tRoad),
    rumbleLight: mixHex(a.rumbleLight, b.rumbleLight, tRoad),
    rumbleDark: mixHex(a.rumbleDark, b.rumbleDark, tRoad),
    roadLight: mixHex(a.roadLight, b.roadLight, tRoad),
    roadDark: mixHex(a.roadDark, b.roadDark, tRoad),
    asphaltTint: mixHex(a.asphaltTint, b.asphaltTint, tRoad),
    lane: mixHex(a.lane, b.lane, tRoad),
    waterLight: mixHex(a.waterLight, b.waterLight, tRoad),
    waterDark: mixHex(a.waterDark, b.waterDark, tRoad),
    // Un booleano non si interpola: passa a metà transizione.
    lanes: tRoad < 0.5 ? a.lanes : b.lanes,
    ground: a.ground,
    asphalt: a.asphalt,
    bgFar: a.bgFar,
    bgNear: a.bgNear,
    clouds: a.clouds,
  };
}
