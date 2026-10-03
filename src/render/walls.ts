import { SHOULDER_W } from '../game/player';
import { forkOffset, hidesDiscardedSide } from '../game/track';
import { ROAD_WIDTH, SEGMENT_LENGTH } from './project';
import type { AssetStore, Segment, SpriteAsset, SpriteName, WallKind } from '../types';

/** Distacco fra il bordo esterno della banchina e la parete (spec §4.4c). */
export const WALL_GAP = 0.15;
/** Offset della base della parete: 1 + banchina + distacco = 1.5. */
export const WALL_BASE_OFFSET = 1 + SHOULDER_W + WALL_GAP;

/** Altezza in frazioni della larghezza strada (spec §4.4c). */
export const WALL_HEIGHT: Record<WallKind, number> = {
  rock_red: 0.5,
  rock_grey: 0.5,
  town_facades: 0.7,
  seawall: 0.15,
  hedge: 0.12,
  bridge_rail: 0.1,
  guardrail: 0.08,
};

/** Tessera di ogni tipo di parete. */
export const WALL_TEXTURE: Record<WallKind, SpriteName> = {
  rock_red: 'wall_rock_red',
  rock_grey: 'wall_rock_grey',
  guardrail: 'wall_guardrail',
  seawall: 'wall_seawall',
  hedge: 'wall_hedge',
  bridge_rail: 'wall_bridge_rail',
  town_facades: 'wall_town_facades',
};

/**
 * Segmenti coperti da una tessera di parete. La spec §4.4c chiede che la
 * colonna sorgente venga dalla z del segmento ma non fissa il periodo, e il
 * periodo decide due cose.
 *
 * La **scala**: con 4 larghezze strada la tessera di 256 px copriva 8000
 * unità, cioè 5,9 px di tessera per metro di parete in orizzontale contro i
 * 36 px per metro in verticale — sei volte, e i blocchi di roccia si
 * smerigliavano in strisce orizzontali larghe mezza strada. Con 6 segmenti la
 * tessera copre 1200 unità, quasi i 1300 che è alta la parete di roccia: la
 * texture si applica quasi isotropa e i blocchi restano blocchi.
 *
 * E la **tassellatura**: un numero **intero** di segmenti divide la tessera in
 * colonne che la coprono esatta, senza che l'ultima debba essere tirata
 * indietro dal limite di `wallSourceX` e ripetere quella prima. Con 6.5
 * segmenti una colonna su sette si ripeteva, e lì il nastro mostrava un
 * salto.
 */
export const WALL_TILE_SEGMENTS = 6;
export const WALL_TILE_WORLD = WALL_TILE_SEGMENTS * SEGMENT_LENGTH;
/** Il periodo in larghezze strada, come lo scrive la spec §4.4c: 0,4615. */
export const WALL_TILE_ROADS = WALL_TILE_WORLD / ROAD_WIDTH;
/**
 * Oltre questa frazione della distanza di disegno le pareti si fermano: più
 * in là sono dentro la nebbia e larghe meno di un pixel.
 */
export const WALL_MAX_RATIO = 0.6;
/**
 * Pixel di allargamento per lato. Su un rettilineo la fetta di un segmento è
 * larga una frazione di pixel: senza questa sovrapposizione il nastro mostra
 * fessure di antialiasing.
 */
export const WALL_OVERDRAW = 0.75;

/** Colonna sorgente della tessera per un segmento (spec §4.4c). */
export function wallSourceW(tileW: number): number {
  return (SEGMENT_LENGTH / WALL_TILE_WORLD) * tileW;
}

export function wallSourceX(index: number, tileW: number): number {
  const world = (((index * SEGMENT_LENGTH) % WALL_TILE_WORLD) + WALL_TILE_WORLD) % WALL_TILE_WORLD;
  const x = (world / WALL_TILE_WORLD) * tileW;
  return Math.min(x, Math.max(0, tileW - wallSourceW(tileW)));
}

/** Quadrilatero verticale di una parete: base e cima ai due punti del segmento. */
export interface WallQuad {
  x1: number;
  y1: number;
  t1: number;
  x2: number;
  y2: number;
  t2: number;
}

/**
 * Quadrilatero della parete su un lato, o null se invisibile. La base è
 * limitata a `seg.clip`: come per gli sprite, ciò che sta oltre è coperto da
 * una collina (spec §4.4, punto 4).
 */
export function wallQuad(seg: Segment, side: -1 | 1, kind: WallKind, height: number): WallQuad | null {
  const s1 = seg.p1.screen;
  const s2 = seg.p2.screen;
  if (!(s1.scale > 0) || !(s2.scale > 0)) return null;
  const world = WALL_HEIGHT[kind] * ROAD_WIDTH;
  const y1 = Math.min(s1.y, seg.clip);
  const y2 = Math.min(s2.y, seg.clip);
  const t1 = s1.y - s1.scale * world * (height / 2);
  const t2 = s2.y - s2.scale * world * (height / 2);
  if (t1 >= y1 && t2 >= y2) return null;
  const off = forkOffset(side * WALL_BASE_OFFSET, seg.roadHalf);
  return {
    x1: s1.x + off * s1.w,
    y1,
    t1,
    x2: s2.x + off * s2.w,
    y2,
    t2,
  };
}

/**
 * Una fetta di parete: taglio a forma di quadrilatero, poi la colonna di
 * texture appoggiata al quadrilatero.
 *
 * La fetta di un segmento è un parallelogramma: base da `y1` a `y2`, cima da
 * `t1` a `t2`. Disegnare la colonna dentro il **rettangolo che lo contiene**
 * (`min(t1,t2)`..`max(y1,y2)`) sembra la cosa semplice, ma quel rettangolo è
 * alto quanto la fetta più la sua pendenza, e di quanto lo sia cambia da un
 * segmento all'altro: la tessera finiva a una scala e a un'altezza diverse in
 * ogni fetta, e la parete si leggeva come un mosaico di strisce verticali con
 * le fughe della muratura disallineate. Qui la colonna si disegna con una
 * trasformazione affine che manda il rettangolo sorgente sul parallelogramma:
 * la riga `v` della tessera cade sempre alla stessa frazione dell'altezza
 * della parete, quindi le fughe restano allineate da una fetta alla
 * successiva. L'approssimazione è la sola altezza, presa come media dei due
 * estremi: fra due estremi di uno stesso segmento differisce di pochi pixel,
 * e il taglio al quadrilatero raccoglie comunque il resto.
 */
export function drawWall(
  ctx: CanvasRenderingContext2D,
  asset: SpriteAsset,
  q: WallQuad,
  sx: number,
  sw: number,
): void {
  if (!(asset.h > 0) || !(sw > 0)) return;
  const left = Math.min(q.x1, q.x2) - WALL_OVERDRAW;
  const right = Math.max(q.x1, q.x2) + WALL_OVERDRAW;
  const top = Math.min(q.t1, q.t2);
  const bottom = Math.max(q.y1, q.y2);
  if (!(bottom - top > 1)) return;
  const height = (q.y1 - q.t1 + (q.y2 - q.t2)) / 2;
  if (!(height > 0.5)) return;
  const dx = q.x2 - q.x1;
  // Allargamento in unità di fetta: WALL_OVERDRAW px per lato. Su un
  // rettilineo `dx` è una frazione di pixel, quindi l'allargamento vale più
  // di una fetta intera e la colonna si ripete sulla vicina — che la copre.
  const over = Math.abs(dx) > 1e-6 ? WALL_OVERDRAW / Math.abs(dx) : 1;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left, q.y1);
  ctx.lineTo(left, q.t1);
  ctx.lineTo(right, q.t2);
  ctx.lineTo(right, q.y2);
  ctx.closePath();
  ctx.clip();
  // u va da 0 a 1 lungo la fetta, v da 0 a 1 dalla cima alla base.
  ctx.transform(dx, q.t2 - q.t1, 0, height, q.x1, q.t1);
  ctx.drawImage(asset.image, sx, 0, sw, asset.h, -over, 0, 1 + 2 * over, 1);
  ctx.restore();
}

/**
 * Le pareti di un segmento, disegnate insieme ai suoi sprite e con lo stesso
 * `clip` (spec §4.4c). `distanceRatio` è la posizione del segmento nella fetta
 * visibile, da 0 (il più vicino) a 1.
 */
export function renderSegmentWalls(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  assets: AssetStore,
  width: number,
  height: number,
  distanceRatio: number,
): void {
  const wall = seg.wall;
  if (wall === undefined || distanceRatio > WALL_MAX_RATIO) return;
  for (const side of [-1, 1] as const) {
    const kind = side < 0 ? wall.left : wall.right;
    if (kind === undefined) continue;
    // Terzo addendum del collaudo: niente parete sul lato della strada
    // scartata, o la coprirebbe.
    if (hidesDiscardedSide(side, seg)) continue;
    const q = wallQuad(seg, side, kind, height);
    if (q === null) continue;
    // Fuori schermo da un lato solo: niente da disegnare.
    if (Math.max(q.x1, q.x2) < 0 || Math.min(q.x1, q.x2) > width) continue;
    // get() non lancia mai: se la tessera non è una parete si lascia perdere,
    // meglio nessuna parete che un rettangolo magenta alto mezzo schermo.
    const asset = assets.get(WALL_TEXTURE[kind]);
    if (asset.entry.kind !== 'wall' || !(asset.w > 0) || !(asset.h > 0)) continue;
    drawWall(ctx, asset, q, wallSourceX(seg.index, asset.w), Math.max(1, wallSourceW(asset.w)));
  }
}
