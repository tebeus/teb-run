import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import { MAX_SPEED } from '../game/player';
import { renderBackground } from './background';
import type { ParticleField } from './effects';
import {
  blendPalette,
  FAR_WINDOW,
  paletteFor,
  paletteForStage,
  paletteForStageId,
  ROAD_WINDOW,
  SKY_WINDOW,
  windowProgress,
} from './palette';
import { CAMERA_HEIGHT, clamp, LANES, ROAD_WIDTH } from './project';
import { renderRoad } from './road';
import type { SkidTrail } from './skid';
import { renderSprites } from './sprites';
import type { Flock } from './wildlife';
import { DEFAULT_CAR, playerFrame } from '../game/car';
import type { AssetStore, CarChoice, RaceSnapshot, SpriteAsset, SpriteName, Surface } from '../types';

/** Scala di proiezione alla posizione del giocatore: cameraDepth / playerZ. */
export const PLAYER_SCALE = 1 / CAMERA_HEIGHT;
/** Pixel fra il fondo dello schermo e le ruote dell'auto. */
export const PLAYER_CAR_BOTTOM = 8;

/**
 * Frame dell'auto del giocatore: crash, freno o sterzo (spec §4.4 punto 5),
 * con il prefisso dell'auto scelta nella radio (`player_`,
 * `player_classic_`, `player_retro_`, `player_sport_` o `player_super_`). Senza `car` è l'auto nuova, come prima.
 */
export function playerFrameName(snapshot: RaceSnapshot, car: CarChoice = DEFAULT_CAR): SpriteName {
  const frame = (name: string): SpriteName => playerFrame(car, name);
  if (snapshot.crash.active) {
    return frame(`spin_${clamp(Math.round(snapshot.crash.frame), 0, 3)}`);
  }
  if (snapshot.player.braking) return frame('brake');
  const steer = snapshot.player.steer;
  if (steer <= -2) return frame('left2');
  if (steer === -1) return frame('left1');
  if (steer === 1) return frame('right1');
  if (steer >= 2) return frame('right2');
  return frame('straight');
}

/** Tetto della correzione di riempimento: un frame non cresce più del 20 %. */
export const MAX_FILL_SCALE = 1.2;
/** Alfa sotto cui un pixel conta come vuoto, sulla scala 0..255. */
const FILL_ALPHA = 32;

/**
 * Correzione di riempimento di un frame rispetto al dritto della stessa auto.
 * `topStraight` e `topFrame` sono la frazione vuota in cima al riquadro
 * (0 = l'auto tocca il bordo alto). Se nel frame di sterzo la carrozzeria
 * parte più in basso, a parità d'altezza del riquadro sembrerebbe un'auto più
 * piccola: la scala la riporta all'altezza del dritto, con le gomme ancorate in
 * basso. Mai sotto 1, mai sopra `MAX_FILL_SCALE`; dati non validi danno 1. Pura.
 */
export function fillScale(topStraight: number, topFrame: number): number {
  if (!Number.isFinite(topStraight) || !Number.isFinite(topFrame)) return 1;
  if (topStraight < 0 || topFrame < 0 || topStraight >= 1 || topFrame >= 1) return 1;
  const k = (1 - topStraight) / (1 - topFrame);
  return k < 1 ? 1 : k > MAX_FILL_SCALE ? MAX_FILL_SCALE : k;
}

const contentTopCache = new WeakMap<object, number>();

/**
 * Frazione vuota in cima all'immagine di uno sprite, misurata una volta sola
 * sull'alfa e poi tenuta in cache. Senza un canvas (test in Node, browser
 * senza OffscreenCanvas e senza DOM) o con un errore di lettura vale 0, cioè
 * nessuna correzione.
 */
export function contentTopFraction(asset: SpriteAsset): number {
  const image = asset.image as unknown as object | null;
  if (image === null || typeof image !== 'object') return 0;
  const cached = contentTopCache.get(image);
  if (cached !== undefined) return cached;
  let top = 0;
  try {
    const w = Math.max(1, Math.round(asset.w));
    const h = Math.max(1, Math.round(asset.h));
    let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
    else if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (ctx) {
      ctx.drawImage(asset.image as CanvasImageSource, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let row = 0;
      search: for (; row < h; row++) {
        for (let x = 0; x < w; x++) if (data[(row * w + x) * 4 + 3] > FILL_ALPHA) break search;
      }
      top = row >= h ? 0 : row / h;
    }
  } catch {
    top = 0;
  }
  contentTopCache.set(image, top);
  return top;
}

/**
 * Ampiezza massima dell'oscillazione verticale dell'auto, in pixel
 * (spec §4.4 punto 5): 2 sull'asfalto, 3 sulla banchina, 6 fuori strada.
 */
export function bounceAmplitude(surface: Surface): number {
  if (surface === 'grass') return 6;
  return surface === 'shoulder' ? 3 : 2;
}

/**
 * Dimensione a schermo del frame `asset`, ancorata all'ALTEZZA del frame
 * dritto (spec §4.4 punto 5, addendum del collaudo): `straight` decide
 * `dh` con la formula degli altri sprite, ogni frame prende quell'altezza e
 * la sua larghezza segue il proprio rapporto d'aspetto. Prima l'ancoraggio
 * era sulla larghezza: i frame di sterzo, con la carrozzeria ruotata e più
 * bassa nel riquadro sorgente, uscivano più bassi e sembravano auto più
 * piccole. Con `asset === straight` il risultato è invariato.
 */
export function playerCarSize(straight: SpriteAsset, asset: SpriteAsset, width: number): { w: number; h: number } {
  const dw0 = PLAYER_SCALE * straight.entry.scale * ROAD_WIDTH * (width / 2);
  const h = dw0 * (straight.h / straight.w);
  return { w: h * (asset.w / asset.h), h };
}

/** Auto del giocatore: fissa in basso al centro, con ombra e oscillazione. */
export function drawPlayerCar(
  ctx: CanvasRenderingContext2D,
  snapshot: RaceSnapshot,
  assets: AssetStore,
  width: number,
  height: number,
  car: CarChoice = DEFAULT_CAR,
): void {
  // get() non lancia mai: un nome ignoto dà un segnaposto magenta, e
  // il frame dritto delle due auto c'è sempre nel catalogo. L'altezza la
  // decide il dritto **della stessa auto**.
  const frameName = playerFrameName(snapshot, car);
  const asset = assets.get(frameName);
  const straight = assets.get(playerFrame(car, 'straight'));
  const size = playerCarSize(straight, asset, width);
  // Sterzo e frenata: se nel riquadro la carrozzeria parte più in basso del
  // dritto, il frame si ingrandisce quanto basta per non sembrare un'auto più
  // piccola (collaudo: la supercar in curva perdeva fino al 12 %). Le gomme
  // restano ancorate in basso. Il testacoda no: ha sagome diverse per scelta.
  const fill =
    asset === straight || frameName.includes('spin')
      ? 1
      : fillScale(contentTopFraction(straight), contentTopFraction(asset));
  const dw = size.w * fill;
  const dh = size.h * fill;
  const speedPercent = snapshot.player.speed / MAX_SPEED;
  // Oscillazione verticale proporzionale alla velocità: ampiezza data dalla superficie.
  const amplitude = bounceAmplitude(snapshot.player.surface);
  const bounce = Math.round(Math.random() * amplitude * speedPercent) * (Math.random() < 0.5 ? -1 : 1);
  const dx = width / 2 - dw / 2;
  const dy = height - PLAYER_CAR_BOTTOM - dh + bounce;

  // L'ombra usa la larghezza del frame dritto, non quella del frame corrente
  // (che ora varia con l'aspetto del riquadro sorgente): altrimenti
  // pulserebbe ogni volta che lo sterzo cambia frame.
  const shadowDw = playerCarSize(straight, straight, width).w;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(width / 2, dy + dh - 4, shadowDw * 0.42, dh * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // I frame destri sono sprite propri (spec §13, Set 3): niente specchio, o i
  // passeggeri si scambierebbero di posto.
  ctx.drawImage(asset.image, dx, dy, dw, dh);
}

/**
 * Strati del mondo che non nascono dallo snapshot ma vivono nella
 * schermata di gara (spec §4.4b): le strisce di gomma, e dal task 11 i
 * gabbiani. Tutti opzionali: chi disegna il mondo senza (il titolo, le
 * pagine di sviluppo, i test) non ne ha bisogno.
 */
export interface WorldLayers {
  trail?: SkidTrail;
  birds?: Flock;
  /** Auto scelta nella radio (Set 7); assente è l'auto nuova. */
  car?: CarChoice;
}

/**
 * Cielo, parallasse, gabbiani, strada, striscia di gomma, sprite, auto,
 * particelle, in quest'ordine (spec §4.4, punti 1-5, e §4.4b): i gabbiani
 * stanno in cielo, dopo lo sfondo e prima della strada; la gomma sta
 * sull'asfalto, dopo la strada e prima di chiunque ci passi sopra.
 */
export function renderWorld(
  ctx: CanvasRenderingContext2D,
  snapshot: RaceSnapshot,
  assets: AssetStore,
  particles?: ParticleField,
  layers?: WorldLayers,
): void {
  const tr = snapshot.transition;
  // La palette è quella della tappa, non solo quella del tema
  // (spec §4.4f). In transizione l'arrivo è sempre la tappa corrente
  // dello snapshot, quindi il suo scostamento c'è sempre; la partenza
  // arriva da `transition.fromId`, e senza di quello si ricade sulla
  // palette del tema, che è corretta e perde solo lo scostamento.
  const from = tr === undefined ? null : paletteForStageId(tr.fromId ?? '', tr.from);
  // `to` serve a **due** cose: i colori che `blendPalette` interpola e i
  // **nomi delle tessere** dell'overlay di transizione
  // (`{ ground: to.ground, asphalt: to.asphalt }`). Il tema base deve
  // quindi restare `tr.to`, non `snapshot.stage.theme`: con
  // `paletteForStage(snapshot.stage)` una fixture in cui i due divergono
  // farebbe ridisegnare all'overlay la tessera di **partenza**, e la
  // transizione non mostrerebbe più due temi. Lo scostamento di colore
  // viene dall'id della tappa, che è ciò che serve.
  const to = tr === undefined ? null : paletteForStageId(snapshot.stage.id, tr.to);
  const tSky = tr === undefined ? 0 : windowProgress(tr.t, SKY_WINDOW.from, SKY_WINDOW.to);
  const tRoad = tr === undefined ? 0 : windowProgress(tr.t, ROAD_WINDOW.from, ROAD_WINDOW.to);
  const tFar = tr === undefined ? 0 : windowProgress(tr.t, FAR_WINDOW.from, FAR_WINDOW.to);
  // Fuori dalla transizione la palette è quella della tappa corrente.
  const pal =
    from !== null && to !== null
      ? blendPalette(from, to, tSky, tRoad)
      : paletteForStage(snapshot.stage);

  renderBackground(
    ctx,
    pal,
    snapshot.parallax,
    assets,
    LOGICAL_W,
    LOGICAL_H,
    // La variante di sfondo (spec §4.4f, binario L) segue la tappa di
    // arrivo, come le tessere di `to`.
    to === null ? undefined : { pal: to, alpha: tFar, id: snapshot.stage.id },
    // Fuori da una transizione lo strato di base è la tappa corrente; in
    // transizione le sue tessere restano quelle di partenza (`to.ground`
    // eccetera vengono da `a`, non da `b`, in `blendPalette`), quindi anche
    // la sua variante è quella di partenza.
    tr?.fromId ?? snapshot.stage.id,
  );
  // I gabbiani stanno in cielo: dopo lo sfondo, prima della strada (spec §13).
  layers?.birds?.draw(ctx, assets, LOGICAL_W, LOGICAL_H);
  renderRoad(ctx, snapshot.segments, pal, LOGICAL_W, {
    assets,
    timeLeft: snapshot.timeLeft,
    lanes: snapshot.stage.lanes ?? LANES,
    // Il meteo della tappa (spec §4.4f): bagna l'asfalto e avvicina la
    // nebbia (task 7). Assente vale sereno.
    weather: snapshot.stage.weather ?? 'clear',
    overlay: to === null ? undefined : { ground: to.ground, asphalt: to.asphalt, alpha: tRoad },
  });
  // La gomma sta sull'asfalto, sotto chiunque passi (spec §4.4b).
  layers?.trail?.draw(ctx, snapshot.segments);
  renderSprites(ctx, snapshot.segments, assets, LOGICAL_W, LOGICAL_H);
  drawPlayerCar(ctx, snapshot, assets, LOGICAL_W, LOGICAL_H, layers?.car);
  // Dopo l'auto (spec §4.4b): le nuvolette di fumo e polvere coprono la
  // parte bassa delle ruote, come nei racer arcade dell'epoca.
  particles?.draw(ctx, pal, LOGICAL_W, LOGICAL_H, assets);
}
