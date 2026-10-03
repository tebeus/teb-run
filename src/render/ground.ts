import { SHOULDER_W } from '../game/player';
import type { SurfaceBlend } from '../game/surface';
import { mixHex, type SegmentColors, type ThemePalette } from './palette';
import { LANES, ROAD_WIDTH, SEGMENT_LENGTH } from './project';
import type { Segment, SpriteAsset, SpriteKind, SpriteName, SurfaceKind } from '../types';

/** Quante larghezze strada copre una tessera di terreno (spec §4.4a). */
export const GROUND_TILE_ROADS = 6;
/** Unità mondo coperte da una tessera: 12000, cioè 60 segmenti. */
export const GROUND_TILE_WORLD = GROUND_TILE_ROADS * ROAD_WIDTH;
/** Oltre questa frazione della distanza di disegno si torna al colore piatto. */
export const GROUND_TEXTURE_MAX = 0.7;
/**
 * Deroga di prestazione a spec §4.4a: sotto questa altezza in pixel la fascia
 * di un segmento è invisibile e la fetta costerebbe un `drawImage` per
 * niente. A 300 segmenti di distanza le fasce scendono sotto il pixel intorno
 * al 35° segmento, quindi è questo il limite che conta davvero.
 */
export const MIN_TEXTURE_BAND = 0.8;
/** Copie laterali massime di una fetta, per lato (spec §4.4a, «ripetuta a lato»). */
export const SLAB_MAX_REPEATS = 4;
/**
 * L'asfalto è una tessera sola per tutti i temi (spec §4.4a): si disegna
 * semitrasparente sopra il colore piatto del tema, così la tinta della strada
 * resta quella della palette.
 */
export const ASPHALT_ALPHA = 0.55;
/** Velo scuro sui segmenti `dark` con texture (spec §4.4a). */
export const DARK_VEIL = 'rgba(0,0,0,0.1)';
/** Alfa delle tracce d'usura (spec §4.4a). */
export const WEAR_ALPHA = 0.08;
/**
 * Alfa del velo di `asphaltTint`, uguale per tutti i temi (spec §4.4a). A
 * 0.18 i cinque asfalti misuravano 110,110,110 / 129,116,100 / 87,94,104 /
 * 107,103,91 / 90,88,98: montagna e città stavano a 15 punti di distanza in
 * tutto, cioè lo stesso grigio a occhio. A 0.32 la coppia più vicina sta a 36.
 */
export const ASPHALT_TINT_ALPHA = 0.32;

// ---------------------------------------------------------------------------
// Veli per superficie (spec §4.4f)
// ---------------------------------------------------------------------------

/** Terra battuta: bruno caldo, coprente, uguale in campagna e in deserto. */
export const DIRT_VEIL = '#7a5a36';
export const DIRT_VEIL_ALPHA = 0.8;
/** Neve sulla strada: bianco freddo, appena grigio, non candido. */
export const SNOW_VEIL = '#e6ecf2';
export const SNOW_VEIL_ALPHA = 0.78;
/**
 * Asfalto bagnato: il bagnato non ha un colore proprio, ha il colore
 * della strada più scuro. `WET_VEIL` è il nero-blu verso cui tirare la
 * tinta della tappa, e `WET_VEIL_PULL` quanto tirarla: così il cielo
 * grigio di Old Harbor e quello di Windmill Coast restano
 * distinguibili anche sull'asfalto, invece di diventare lo stesso nero.
 */
export const WET_VEIL = '#101820';
export const WET_VEIL_PULL = 0.7;
export const WET_VEIL_ALPHA = 0.5;
/** Tracce d'usura: solchi marcati sulla terra, corsie pulite sulla neve. */
export const DIRT_WEAR_ALPHA = 0.3;
export const SNOW_WEAR_ALPHA = 0.26;
/**
 * Oltre questa miscela di sterrato il cordolo non si disegna più: una
 * strada di terra non ha il cordolo bianco e rosso. A metà rampa, così
 * il cordolo non sparisce sul primo segmento del tratto, dove la strada
 * è ancora quasi asfalto.
 */
export const NO_KERB_MIX = 0.5;
/**
 * Riflesso del bagnato: un velo bianchissimo e quasi trasparente sui
 * soli segmenti `dark`, che con l'alternanza ogni `RUMBLE_SEGMENTS`
 * segmenti si legge come una striscia di luce che corre sulla strada.
 * L'alfa la mette `globalAlpha`, come per `SMOKE_COLOR` in `effects.ts`.
 */
export const WET_SHEEN = '#ffffff';
export const WET_SHEEN_ALPHA = 0.07;
/** Sul bagnato le linee di corsia sono più larghe e più chiare: riflettono. */
export const WET_LANE_WIDEN = 1.35;
export const WET_LANE_GLOW = 0.6;

/**
 * Memoria a uno slot per il colore del bagnato: la tinta della palette è
 * costante dentro un fotogramma, anche durante una transizione, dove
 * `blendPalette` ne produce una nuova per fotogramma e non per segmento.
 * Senza, `mixHex` girerebbe trecento volte per fotogramma sulle due
 * tappe che piovono.
 */
let wetVeilKey = '';
let wetVeilValue = '';

/** Tinta della tappa tirata verso il nero-blu del bagnato. Pura a meno della memoria. */
export function wetVeilColour(tint: string): string {
  if (tint !== wetVeilKey) {
    wetVeilKey = tint;
    wetVeilValue = mixHex(tint, WET_VEIL, WET_VEIL_PULL);
  }
  return wetVeilValue;
}

/** Idem per il colore delle linee di corsia sul bagnato. */
let wetLaneKey = '';
let wetLaneValue = '';

/** Linea di corsia schiarita verso il bianco del cordolo. Pura a meno della memoria. */
export function wetLaneColour(lane: string, rumbleLight: string): string {
  const key = `${lane}|${rumbleLight}`;
  if (key !== wetLaneKey) {
    wetLaneKey = key;
    wetLaneValue = mixHex(lane, rumbleLight, WET_LANE_GLOW);
  }
  return wetLaneValue;
}

/** Colore del velo di una superficie sola. Pura a meno della memoria del bagnato. */
export function kindColour(pal: ThemePalette, kind: SurfaceKind): string {
  switch (kind) {
    case 'dirt':
      return DIRT_VEIL;
    case 'snow':
      return SNOW_VEIL;
    case 'wet':
      return wetVeilColour(pal.asphaltTint);
    default:
      return pal.asphaltTint;
  }
}

/** Alfa del velo di una superficie sola. Pura. */
export function kindAlpha(kind: SurfaceKind): number {
  switch (kind) {
    case 'dirt':
      return DIRT_VEIL_ALPHA;
    case 'snow':
      return SNOW_VEIL_ALPHA;
    case 'wet':
      return WET_VEIL_ALPHA;
    default:
      return ASPHALT_TINT_ALPHA;
  }
}

/**
 * Colore del velo di una miscela (spec §4.4f): i due colori fusi con la
 * miscela. Ai due estremi ritorna il colore secco, senza `mixHex`: il
 * caso di gran lunga più comune è `mix = 0`, e i soli segmenti che
 * pagano la fusione sono i `2 · SURFACE_RAMP` delle rampe. Pura a meno
 * della memoria del bagnato.
 */
export function veilColour(pal: ThemePalette, blend: SurfaceBlend): string {
  if (blend.mix <= 0) return kindColour(pal, blend.base);
  if (blend.mix >= 1) return kindColour(pal, blend.kind);
  return mixHex(kindColour(pal, blend.base), kindColour(pal, blend.kind), blend.mix);
}

/** Alfa del velo di una miscela: interpolazione lineare fra le due. Pura. */
export function veilAlpha(blend: SurfaceBlend): number {
  const from = kindAlpha(blend.base);
  const to = kindAlpha(blend.kind);
  return from + (to - from) * blend.mix;
}

// ---------------------------------------------------------------------------
// Tessere di superficie (spec §4.4f)
// ---------------------------------------------------------------------------

/**
 * Sterrato e neve hanno una tessera propria da disegnare sopra l'asfalto
 * (spec §4.4f, «punto d'innesto» del task 6 del binario K). Il bagnato no:
 * è l'asfalto più scuro, il velo basta.
 */
export const SURFACE_TILES: Readonly<Partial<Record<SurfaceKind, SpriteName>>> = {
  dirt: 'ground_dirt_road',
  snow: 'ground_snow_road',
};

/** Tessera di una superficie, o `null` se la superficie è solo un velo. Pura. */
export function surfaceTile(kind: SurfaceKind): SpriteName | null {
  return SURFACE_TILES[kind] ?? null;
}

/**
 * Velo sopra una tessera di superficie: la tessera ha già colore e grana,
 * il velo la accorda alla tinta della tappa e basta. Con 0.3 la media
 * della tessera di terra velata (142,95,51) e quella della neve
 * (199,205,211) cadono vicino al colore piatto che la strada prende oltre
 * `GROUND_TEXTURE_MAX`, così dove la tessera finisce non si vede la riga.
 */
export const SURFACE_TILE_VEIL_ALPHA = 0.3;

/**
 * Quanto coprire con la tessera del fondo (`base`) e con quella del
 * tratto (`kind`), in alfa: il fondo tassellato copre tutto finché il
 * tratto non lo sostituisce, il tratto entra con la miscela. Zero per le
 * superfici senza tessera. Pura.
 */
export function surfaceTileWeights(blend: SurfaceBlend): { base: number; kind: number } {
  const baseTiled = surfaceTile(blend.base) !== null;
  const kindTiled = surfaceTile(blend.kind) !== null && blend.kind !== blend.base;
  const mix = Math.min(1, Math.max(0, blend.mix));
  return {
    base: baseTiled ? (kindTiled || blend.kind === blend.base ? 1 : 1 - mix) : 0,
    kind: kindTiled ? mix : 0,
  };
}

/**
 * Alfa del velo quando le tessere di superficie sono disegnate: per le
 * superfici tassellate vale `SURFACE_TILE_VEIL_ALPHA` invece di
 * `kindAlpha`, per le altre non cambia. Pura.
 */
export function tiledVeilAlpha(blend: SurfaceBlend): number {
  const alpha = (kind: SurfaceKind): number =>
    surfaceTile(kind) !== null ? SURFACE_TILE_VEIL_ALPHA : kindAlpha(kind);
  const from = alpha(blend.base);
  const to = alpha(blend.kind);
  return from + (to - from) * blend.mix;
}

/**
 * Colore piatto della strada con la superficie applicata (spec §4.4f).
 * Serve **a ogni distanza**, anche dove la tessera d'asfalto non si
 * disegna più: senza, uno sterrato tornerebbe grigio a trenta segmenti
 * di distanza, con una riga netta in mezzo alla strada. Per l'asfalto
 * asciutto ritorna **la stessa stringa** che ha ricevuto, senza
 * allocare e senza cambiare un pixel di ciò che il binario H disegna
 * oggi. Pura a meno della memoria del bagnato.
 */
export function surfaceRoadColour(pal: ThemePalette, base: string, blend: SurfaceBlend): string {
  if (blend.mix <= 0 && blend.base === 'asphalt') return base;
  return mixHex(base, veilColour(pal, blend), veilAlpha(blend));
}

/** Alfa delle tracce d'usura per la miscela (spec §4.4f). Pura. */
export function wearAlphaFor(blend: SurfaceBlend): number {
  const wear = (kind: SurfaceKind): number =>
    kind === 'dirt' ? DIRT_WEAR_ALPHA : kind === 'snow' ? SNOW_WEAR_ALPHA : WEAR_ALPHA;
  const from = wear(blend.base);
  const to = wear(blend.kind);
  return from + (to - from) * blend.mix;
}

/**
 * Se il segmento ha il cordolo (spec §4.4f): tutti tranne lo sterrato
 * oltre metà rampa. La neve lo tiene — sotto la neve il cordolo si vede
 * ancora — e il bagnato lo tiene ovviamente. Pura.
 */
export function hasKerb(blend: SurfaceBlend): boolean {
  return !(blend.kind === 'dirt' && blend.mix > NO_KERB_MIX);
}

/**
 * Velo di riflesso del bagnato (spec §4.4f): un `quad` sull'intera
 * carreggiata, con l'alfa proporzionale a quanto la strada è bagnata.
 * Da chiamare **solo** sui segmenti `dark`, dopo il velo di superficie:
 * l'alternanza chiaro/scuro ogni tre segmenti lo trasforma in una
 * striscia di luce che corre. Con `wetness` a zero non disegna niente e
 * non tocca l'alfa.
 */
export function drawWetSheen(ctx: CanvasRenderingContext2D, seg: Segment, wetness: number): void {
  if (!(wetness > 0)) return;
  const { x: x1, w: w1 } = seg.p1.screen;
  const { x: x2, w: w2 } = seg.p2.screen;
  const { near: y1, far: y2 } = bandEdges(seg);
  const r1 = w1 * seg.roadHalf;
  const r2 = w2 * seg.roadHalf;
  ctx.globalAlpha = WET_SHEEN_ALPHA * Math.min(1, wetness);
  quad(ctx, x1 - r1, y1, x1 + r1, y1, x2 + r2, y2, x2 - r2, y2, WET_SHEEN);
  ctx.globalAlpha = 1;
}

/**
 * Sovrapposizione in orizzontale fra due copie laterali della stessa fetta,
 * in pixel. Due copie adiacenti condividono il bordo: senza sovrapposizione
 * l'antialiasing lascia passare il fondo sulla colonna di confine, e le copie
 * si leggono come una griglia verticale sull'asfalto (deroga di spec §4.4a).
 */
export const SLAB_OVERDRAW = 1;

/**
 * Bordi di una fetta arrotondati al pixel intero. Le fette di due segmenti
 * adiacenti condividono il bordo esatto, e dentro una fetta si sovrappongono
 * fino a sei riempimenti (terreno piatto, tessera, banchina, cordolo,
 * asfalto, velo): con un bordo a coordinata frazionaria ognuno copre solo
 * `f` del pixel di confine, e di ogni strato resta un residuo `f · (1 - f)`
 * — cioè una riga chiara su **ogni** confine, che da vicino si legge come una
 * griglia. Su coordinate intere il canvas non antialiasa i bordi orizzontali
 * e le fette combaciano esatte: `p2` di un segmento e `p1` del successivo
 * sono lo stesso punto del mondo proiettato con la stessa telecamera, quindi
 * arrotondano allo stesso intero (deroga di spec §4.4a). Pura.
 */
export function bandEdges(seg: Segment): { near: number; far: number } {
  return { near: Math.round(seg.p1.screen.y), far: Math.round(seg.p2.screen.y) };
}

/** Quadrilatero pieno. Condiviso con `road.ts`: un solo disegnatore di trapezi. */
export function quad(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

/** Altezza sorgente che copre un segmento sulla tessera. */
export function textureSourceH(tileH: number): number {
  return (SEGMENT_LENGTH / GROUND_TILE_WORLD) * tileH;
}

/**
 * Riga sorgente di un segmento: la sua z riportata sull'altezza della
 * tessera (spec §4.4a). Limitata a `tileH - sh` perché un rettangolo
 * sorgente a cavallo del bordo si vedrebbe come una fetta più sottile: una
 * riga su sessanta si ripete, e non si nota.
 */
export function textureSourceY(index: number, tileH: number): number {
  const world = (((index * SEGMENT_LENGTH) % GROUND_TILE_WORLD) + GROUND_TILE_WORLD) % GROUND_TILE_WORLD;
  const y = (world / GROUND_TILE_WORLD) * tileH;
  return Math.min(y, Math.max(0, tileH - textureSourceH(tileH)));
}

/** Larghezza a schermo di una fetta: sei larghezze strada (spec §4.4a). */
export function slabWidth(halfW: number): number {
  return 2 * halfW * GROUND_TILE_ROADS;
}

/**
 * Copie laterali necessarie a coprire lo schermo, da `from` a `to` compresi
 * (0 è la copia centrata sul centro strada). Limitate a `SLAB_MAX_REPEATS`.
 */
export function slabRepeats(centreX: number, slabW: number, width: number): { from: number; to: number } {
  if (!(slabW > 0.5)) return { from: 0, to: 0 };
  const left = centreX - slabW / 2;
  const right = centreX + slabW / 2;
  const leftCopies = Math.min(SLAB_MAX_REPEATS, Math.ceil(Math.max(0, left) / slabW));
  const rightCopies = Math.min(SLAB_MAX_REPEATS, Math.ceil(Math.max(0, width - right) / slabW));
  // `leftCopies === 0 ? 0 : -leftCopies` evita lo zero negativo, che
  // `toEqual` distingue da 0 (la stessa trappola documentata in
  // `background.ts` per `tileStartX`).
  return { from: leftCopies === 0 ? 0 : -leftCopies, to: rightCopies };
}

/** I due lati della strada, come costante di modulo: il ciclo non alloca. */
export const SIDES: readonly [-1, 1] = [-1, 1];

/** `roadHalf` al capo lontano `p2` del segmento (bivio v3): assente vale `roadHalf`. */
export function farRoadHalf(seg: Segment): number {
  return seg.roadHalfFar ?? seg.roadHalf;
}

/** `median` al capo lontano `p2` del segmento (bivio v3): assente vale `median`. */
export function farMedian(seg: Segment): number {
  return seg.medianFar ?? seg.median;
}

/**
 * Bordo esterno della banchina, in pixel dal centro strada (spec §4.4a). La
 * banchina è larga `SHOULDER_W` semilarghezze **normali** anche quando la
 * strada è allargata dal bivio, così la sua larghezza vera non cambia.
 */
export function shoulderEdge(halfW: number, roadHalf = 1): number {
  return halfW * (roadHalf + SHOULDER_W);
}

/**
 * Isola centrale della zona di bivio (spec §4.4): terreno in mezzo, con una
 * banda di banchina su ogni bordo. Quando l'isola è più stretta di due
 * banchine le due bande la coprono tutta, che è l'aspetto giusto per
 * un'isola appena nata. Con `fill` falso (la Y del bivio v3) il terreno in
 * mezzo è quello del tema, già disegnato sotto: fra i due rami, e dopo il
 * commit fra la strada scelta e la scartata, è lo stesso terreno, e non
 * cambia colore quando la zona finisce.
 */
export function drawIsland(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  colors: SegmentColors,
  fill = true,
): void {
  const s1 = seg.p1.screen;
  const s2 = seg.p2.screen;
  const { near: y1, far: y2 } = bandEdges(seg);
  const m1 = s1.w * seg.median;
  const m2 = s2.w * farMedian(seg);
  if (!(m1 > 0.25) && !(m2 > 0.25)) return;
  if (fill) quad(ctx, s1.x - m1, y1, s1.x + m1, y1, s2.x + m2, y2, s2.x - m2, y2, colors.grass);
  const b1 = Math.min(s1.w * SHOULDER_W, m1);
  const b2 = Math.min(s2.w * SHOULDER_W, m2);
  for (const side of SIDES) {
    quad(
      ctx,
      s1.x + side * m1,
      y1,
      s1.x + side * (m1 - b1),
      y1,
      s2.x + side * (m2 - b2),
      y2,
      s2.x + side * m2,
      y2,
      colors.shoulder,
    );
  }
}

/**
 * Centri delle tracce d'usura in frazioni della semilarghezza strada:
 * due per corsia, simmetriche rispetto al centro (spec §4.4a).
 */
export function wearTrackOffsets(lanes: number = LANES): number[] {
  const out: number[] = [];
  for (let i = 0; i < lanes; i++) {
    const centre = -1 + (2 * (i + 0.5)) / lanes;
    const half = 1 / lanes;
    out.push(centre - half * 0.55, centre + half * 0.55);
  }
  return out;
}

/** Calcolate una volta: il ciclo di disegno non alloca array per segmento. */
export const WEAR_OFFSETS: readonly number[] = wearTrackOffsets();
/** Stessa tabella per le tappe a 3 corsie (città, montagna: spec §9). */
export const WEAR_OFFSETS_3: readonly number[] = wearTrackOffsets(3);

/**
 * Tabella di `wearTrackOffsets` per il numero di corsie della tappa, senza
 * allocare per segmento: le uniche cardinalità di spec §9 sono 3 e 4.
 */
function wearOffsetsFor(lanes: number): readonly number[] {
  return lanes === 3 ? WEAR_OFFSETS_3 : WEAR_OFFSETS;
}

/** Condizioni per disegnare la texture invece del colore piatto. Pura. */
export function useGroundTexture(o: {
  distanceRatio: number;
  bandH: number;
  slabW: number;
  width: number;
  tileW: number;
  tileH: number;
  kind: SpriteKind;
}): boolean {
  if (o.kind !== 'texture') return false;
  if (!(o.tileW > 0) || !(o.tileH > 0)) return false;
  if (!(o.distanceRatio <= GROUND_TEXTURE_MAX)) return false;
  if (!(o.bandH >= MIN_TEXTURE_BAND)) return false;
  return o.slabW * (2 * SLAB_MAX_REPEATS + 1) >= o.width;
}

/** Fette di terreno a tutta larghezza, ripetute a lato quanto serve. */
export function drawGroundSlab(
  ctx: CanvasRenderingContext2D,
  asset: SpriteAsset,
  seg: Segment,
  width: number,
  bandTop: number,
  bandH: number,
): void {
  const centre = seg.p1.screen.x;
  const slabW = slabWidth(seg.p1.screen.w);
  const sy = textureSourceY(seg.index, asset.h);
  const sh = Math.max(1, textureSourceH(asset.h));
  const { from, to } = slabRepeats(centre, slabW, width);
  const dx0 = centre - slabW / 2;
  for (let k = from; k <= to; k++) {
    ctx.drawImage(
      asset.image,
      0,
      sy,
      asset.w,
      sh,
      dx0 + k * slabW - SLAB_OVERDRAW,
      bandTop,
      slabW + 2 * SLAB_OVERDRAW,
      bandH,
    );
  }
}

/** Banchina: un trapezio per lato, fra il bordo strada e il terreno (spec §4.4a). */
export function drawShoulders(ctx: CanvasRenderingContext2D, seg: Segment, colors: SegmentColors): void {
  const { x: x1, w: w1 } = seg.p1.screen;
  const { x: x2, w: w2 } = seg.p2.screen;
  const { near: y1, far: y2 } = bandEdges(seg);
  const e1 = shoulderEdge(w1, seg.roadHalf);
  const e2 = shoulderEdge(w2, farRoadHalf(seg));
  const r1 = w1 * seg.roadHalf;
  const r2 = w2 * farRoadHalf(seg);
  quad(ctx, x1 - e1, y1, x1 - r1, y1, x2 - r2, y2, x2 - e2, y2, colors.shoulder);
  quad(ctx, x1 + e1, y1, x1 + r1, y1, x2 + r2, y2, x2 + e2, y2, colors.shoulder);
}

/**
 * Percorso di taglio a forma dell'asfalto: un trapezio, o due quando c'è
 * l'isola (bivio v3: l'isola della Y è terreno, e la fetta d'asfalto non ci
 * deve cadere sopra).
 */
function clipRoad(ctx: CanvasRenderingContext2D, seg: Segment): void {
  const { x: x1, w: w1 } = seg.p1.screen;
  const { x: x2, w: w2 } = seg.p2.screen;
  const { near: y1, far: y2 } = bandEdges(seg);
  const r1 = w1 * seg.roadHalf;
  const r2 = w2 * farRoadHalf(seg);
  const m1 = w1 * seg.median;
  const m2 = w2 * farMedian(seg);
  ctx.beginPath();
  if (m1 > 0 || m2 > 0) {
    for (const side of SIDES) {
      ctx.moveTo(x1 + side * m1, y1);
      ctx.lineTo(x1 + side * r1, y1);
      ctx.lineTo(x2 + side * r2, y2);
      ctx.lineTo(x2 + side * m2, y2);
      ctx.closePath();
    }
  } else {
    ctx.moveTo(x1 - r1, y1);
    ctx.lineTo(x1 + r1, y1);
    ctx.lineTo(x2 + r2, y2);
    ctx.lineTo(x2 - r2, y2);
    ctx.closePath();
  }
  ctx.clip();
}

/**
 * Fetta d'asfalto, ritagliata al trapezio della strada, più il velo scuro dei
 * segmenti `dark`. Il taglio costa poco perché `useGroundTexture` lascia
 * passare solo le fasce alte almeno `MIN_TEXTURE_BAND`, cioè le più vicine.
 */
export function drawAsphaltSlab(
  ctx: CanvasRenderingContext2D,
  asset: SpriteAsset,
  seg: Segment,
  width: number,
  bandH: number,
  veil: boolean,
  alphaScale = 1,
): void {
  const centre = seg.p1.screen.x;
  const slabW = slabWidth(seg.p1.screen.w);
  const sy = textureSourceY(seg.index, asset.h);
  const sh = Math.max(1, textureSourceH(asset.h));
  const { from, to } = slabRepeats(centre, slabW, width);
  const dx0 = centre - slabW / 2;
  const top = bandEdges(seg).far;
  ctx.save();
  clipRoad(ctx, seg);
  ctx.globalAlpha = ASPHALT_ALPHA * alphaScale;
  for (let k = from; k <= to; k++) {
    ctx.drawImage(
      asset.image,
      0,
      sy,
      asset.w,
      sh,
      dx0 + k * slabW - SLAB_OVERDRAW,
      top,
      slabW + 2 * SLAB_OVERDRAW,
      bandH,
    );
  }
  ctx.globalAlpha = 1;
  if (veil) {
    // Durante una transizione (spec §4.4d) `alphaScale` è il progresso della
    // tessera nuova: il velo scuro segue la stessa sfumatura, o l'alternanza
    // chiaro/scuro dell'asfalto entrante resterebbe sempre chiara finché la
    // transizione non chiude (minore 4). `DARK_VEIL` porta già il suo alfa
    // (0.1) nel colore: `globalAlpha` lo scala senza doverlo calcolare qui.
    ctx.globalAlpha = alphaScale;
    ctx.fillStyle = DARK_VEIL;
    ctx.fillRect(0, top, width, bandH);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/**
 * Velo per rendere l'asfalto riconoscibile per tema (spec §4.4a): un solo
 * `quad` in più per segmento, sopra la fetta d'asfalto già disegnata,
 * `globalAlpha = ASPHALT_TINT_ALPHA`. Con l'isola sono due, uno per
 * carreggiata (bivio v3: l'isola della Y è il terreno del tema, e un velo
 * d'asfalto sopra si vedrebbe).
 */
export function drawAsphaltTint(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  tint: string,
  alpha: number = ASPHALT_TINT_ALPHA,
): void {
  const { x: x1, w: w1 } = seg.p1.screen;
  const { x: x2, w: w2 } = seg.p2.screen;
  const { near: y1, far: y2 } = bandEdges(seg);
  const r1 = w1 * seg.roadHalf;
  const r2 = w2 * farRoadHalf(seg);
  const m1 = w1 * seg.median;
  const m2 = w2 * farMedian(seg);
  ctx.globalAlpha = alpha;
  if (m1 > 0 || m2 > 0) {
    for (const side of SIDES) {
      quad(ctx, x1 + side * m1, y1, x1 + side * r1, y1, x2 + side * r2, y2, x2 + side * m2, y2, tint);
    }
  } else {
    quad(ctx, x1 - r1, y1, x1 + r1, y1, x2 + r2, y2, x2 - r2, y2, tint);
  }
  ctx.globalAlpha = 1;
}

/**
 * Due tracce d'usura per corsia, scure e quasi trasparenti (spec §4.4a).
 * `lanes` assente vale `LANES` (4): con una tappa a 3 corsie (città,
 * montagna, spec §9) le tracce a 4 corsie cadevano disallineate dalle
 * corsie disegnate, otto invece di sei.
 */
export function drawWearTracks(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  lanes: number = LANES,
  alpha: number = WEAR_ALPHA,
): void {
  const { x: x1, w: w1 } = seg.p1.screen;
  const { x: x2, w: w2 } = seg.p2.screen;
  const { near: y1, far: y2 } = bandEdges(seg);
  const t1 = Math.max(1, w1 / 24);
  const t2 = Math.max(0.5, w2 / 24);
  ctx.globalAlpha = alpha;
  for (const o of wearOffsetsFor(lanes)) {
    const c1 = x1 + o * w1;
    const c2 = x2 + o * w2;
    quad(ctx, c1 - t1, y1, c1 + t1, y1, c2 + t2, y2, c2 - t2, y2, '#000000');
  }
  ctx.globalAlpha = 1;
}

/** Riga di schiuma al bordo interno dell'acqua (spec §4.4c). */
export const FOAM = 'rgba(255,255,255,0.55)';
/** Velo di luccichio sui segmenti scuri (spec §4.4c). */
export const SHIMMER = 'rgba(255,255,255,0.12)';
/** Il luccichio alterna ogni quarto di secondo (spec §4.4c). */
export const SHIMMER_PERIOD = 0.25;
/** Larghezza della schiuma, in frazioni della semilarghezza strada. */
export const FOAM_WIDTH = 0.06;

/**
 * Fase del luccichio dall'unico orologio che il renderer ha: i secondi che
 * restano (spec §4.4c). Pura.
 */
export function shimmerOn(timeLeft: number): boolean {
  const t = Math.max(0, Number.isFinite(timeLeft) ? timeLeft : 0);
  return Math.floor(t / SHIMMER_PERIOD) % 2 === 0;
}

/**
 * Fascia d'acqua su un lato, oltre la banchina, con la riga di schiuma e il
 * luccichio (spec §4.4c). Si disegna dopo il terreno e prima della banchina.
 */
export function drawWater(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  colors: SegmentColors,
  width: number,
  side: 'left' | 'right',
  shimmer: boolean,
): void {
  const s1 = seg.p1.screen;
  const s2 = seg.p2.screen;
  const { near: y1, far: y2 } = bandEdges(seg);
  const sign = side === 'left' ? -1 : 1;
  const e1 = s1.x + sign * shoulderEdge(s1.w, seg.roadHalf);
  const e2 = s2.x + sign * shoulderEdge(s2.w, farRoadHalf(seg));
  const edge = side === 'left' ? 0 : width;
  quad(ctx, edge, y1, e1, y1, e2, y2, edge, y2, colors.water);
  const f1 = Math.max(1, s1.w * FOAM_WIDTH);
  const f2 = Math.max(0.5, s2.w * FOAM_WIDTH);
  quad(ctx, e1, y1, e1 + sign * f1, y1, e2 + sign * f2, y2, e2, y2, FOAM);
  if (shimmer && seg.dark) {
    quad(ctx, edge, y1, e1, y1, e2, y2, edge, y2, SHIMMER);
  }
}
