import { LOGICAL_H } from '../core/canvas';
import { CHECKPOINT_NAME, GOAL_NAME, laneToRoad, spriteOffsetOf, START_GANTRY_NAME } from '../game/track';
import { CAMERA_DEPTH, DRAW_DISTANCE, interpolate, ROAD_HALF, ROAD_WIDTH } from './project';
import type { AssetStore, Segment, SpriteAsset } from '../types';
import { renderSegmentWalls } from './walls';

/**
 * Nomi degli sprite di portale (partenza, checkpoint, traguardo, spec
 * §4.4e). Generico sul nome, non sull'istanza: se il bivio piazza più copie
 * dello stesso portale (una per ramo), la protezione qui sotto le copre
 * tutte senza bisogno di saperlo.
 */
const PORTAL_NAMES: ReadonlySet<string> = new Set([START_GANTRY_NAME, CHECKPOINT_NAME, GOAL_NAME]);

/**
 * Sotto questa distanza dalla telecamera, in segmenti, un portale non si
 * disegna più. Alla giunzione (o all'incrocio sotto un portale) il
 * segmento del portale finisce a un pixel dalla telecamera e la scala di
 * proiezione tende a 1: anche con `MAX_SPRITE_WIDTHS` a fare da tetto, il
 * pannello resta largo fino a due frame, cioè riempie mezzo schermo per un
 * fotogramma esattamente quando ci si passa sotto. I portali non sono
 * solidi (non stanno in `WALL_KINDS`): non disegnarli qui non tocca le
 * collisioni.
 */
export const PORTAL_NEAR_CLIP_SEGMENTS = 3;

export interface DestRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Valore di `clipY` che significa "nessun ritaglio". */
export const NO_CLIP = Infinity;

/**
 * Tetto alla larghezza a schermo di uno sprite, in larghezze di frame. La
 * scala di proiezione è `cameraDepth / camera.z`, e `renderSprites` disegna
 * ogni segmento con `camera.z > CAMERA_DEPTH`: appena sopra quella soglia la
 * scala tende a 1 e la larghezza di destinazione cresce senza limite. Succede
 * per davvero, non solo in teoria: `updateVisible` riporta la z in
 * `[0, trackLength)`, quindi all'inizio di una tappa la telecamera sta 4,2
 * segmenti **prima della fine** del tracciato e i suoi ultimi segmenti le
 * finiscono davanti a distanza di un pixel. Uno sprite piazzato lì copriva lo
 * schermo per un fotogramma. Due larghezze di frame lasciano passare ogni
 * sprite legittimo vicino alla telecamera (il più grande misurato è una
 * facciata di città a 1633 px su 1280) e tagliano solo il caso patologico.
 */
export const MAX_SPRITE_WIDTHS = 2;

/**
 * Rettangoli sorgente e destinazione di uno sprite (spec §4.4), o null se
 * invisibile. `offset` 1 = bordo strada. `clipY` è la y oltre cui il segmento
 * è coperto da una collina: `NO_CLIP` significa nessun ritaglio, mentre uno
 * `clipY` sopra la cima dello sprite lo nasconde del tutto. Non c'è un valore
 * ambiguo: più `clipY` è piccolo, più copre.
 */
export function spriteDestRect(
  asset: SpriteAsset,
  projScale: number,
  screenX: number,
  screenY: number,
  offset: number,
  clipY: number,
  width: number,
): DestRect | null {
  if (projScale <= 0 || asset.w <= 0 || asset.h <= 0) return null;
  const wanted = projScale * asset.entry.scale * ROAD_WIDTH * (width / 2);
  // Il tetto vale su entrambi i lati, così le proporzioni non cambiano: uno
  // sprite tagliato in larghezza e non in altezza si deformerebbe.
  const cap = MAX_SPRITE_WIDTHS * width;
  const shrink = wanted > cap ? cap / wanted : 1;
  const dw = wanted * shrink;
  const dh = dw * (asset.h / asset.w);
  if (dw < 0.5 || dh < 0.5) return null;
  const centreX = screenX + projScale * offset * ROAD_HALF * (width / 2);
  const dx = centreX - dw / 2;
  const dy = screenY - dh * asset.entry.anchorY;
  // Con clipY = NO_CLIP la sottrazione dà -Infinity, quindi clipH è 0.
  const clipH = Math.max(0, dy + dh - clipY);
  if (clipH >= dh) return null;
  return {
    sx: 0,
    sy: 0,
    sw: asset.w,
    sh: asset.h - (asset.h * clipH) / dh,
    dx,
    dy,
    dw,
    dh: dh - clipH,
  };
}

/** Disegna uno sprite, eventualmente specchiato in orizzontale. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  asset: SpriteAsset,
  r: DestRect,
  mirror = false,
): void {
  if (!mirror) {
    ctx.drawImage(asset.image, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    return;
  }
  ctx.save();
  ctx.translate(r.dx + r.dw, r.dy);
  ctx.scale(-1, 1);
  ctx.drawImage(asset.image, r.sx, r.sy, r.sw, r.sh, 0, 0, r.dw, r.dh);
  ctx.restore();
}

/**
 * Oggetti a bordo strada, pareti continue e veicoli, dal più lontano al più
 * vicino (spec §4.4 punto 4). `height` serve solo alle pareti, che hanno
 * un'altezza nel mondo invece di una proporzione d'immagine.
 */
export function renderSprites(
  ctx: CanvasRenderingContext2D,
  segments: readonly Segment[],
  assets: AssetStore,
  width: number,
  height: number = LOGICAL_H,
): void {
  for (let n = segments.length - 1; n >= 0; n--) {
    const seg = segments[n];
    if (seg.p1.camera.z <= CAMERA_DEPTH) continue;

    // Prima la parete del segmento, poi i suoi sprite: nello stesso segmento
    // un oggetto più esterno resta comunque dietro alla parete più vicina,
    // che appartiene a un segmento con n minore e viene disegnata dopo.
    renderSegmentWalls(ctx, seg, assets, width, height, n / DRAW_DISTANCE);

    for (const placed of seg.sprites) {
      // Un portale troppo vicino alla telecamera coprirebbe mezzo schermo
      // per un fotogramma (vedi commento su `PORTAL_NEAR_CLIP_SEGMENTS`):
      // non è solido, quindi saltarne il disegno non tocca le collisioni.
      if (PORTAL_NAMES.has(placed.name) && n < PORTAL_NEAR_CLIP_SEGMENTS) continue;
      // get() non lancia mai: un nome ignoto dà un segnaposto magenta.
      const asset = assets.get(placed.name);
      // Offset finale (`spriteOffsetOf`, usata identica dalle collisioni in
      // `traffic.ts`): bordo esterno della zona di bivio, strada scartata,
      // sprite `fixed` del bivio v3.
      const r = spriteDestRect(
        asset,
        seg.p1.screen.scale,
        seg.p1.screen.x,
        seg.p1.screen.y,
        spriteOffsetOf(placed, seg),
        seg.clip,
        width,
      );
      if (r) drawSprite(ctx, asset, r, placed.flip ?? false);
    }

    for (const car of seg.cars) {
      const asset = assets.get(car.name);
      // Interpolazione fra i due estremi del segmento: il veicolo scorre liscio.
      const scale = interpolate(seg.p1.screen.scale, seg.p2.screen.scale, car.percent);
      const x = interpolate(seg.p1.screen.x, seg.p2.screen.x, car.percent);
      const y = interpolate(seg.p1.screen.y, seg.p2.screen.y, car.percent);
      const r = spriteDestRect(asset, scale, x, y, laneToRoad(car.offset, seg.roadHalf, seg.median), seg.clip, width);
      if (r) drawSprite(ctx, asset, r);
    }
  }
}
