import {
  ASPHALT_ALPHA,
  DARK_VEIL,
  drawAsphaltSlab,
  drawAsphaltTint,
  drawGroundSlab,
  drawIsland,
  drawShoulders,
  drawWater,
  drawWearTracks,
  drawWetSheen,
  hasKerb,
  surfaceRoadColour,
  veilAlpha,
  veilColour,
  wearAlphaFor,
  wetLaneColour,
  WET_LANE_WIDEN,
  bandEdges,
  farMedian,
  farRoadHalf,
  quad,
  shimmerOn,
  SIDES,
  slabWidth,
  surfaceTile,
  surfaceTileWeights,
  tiledVeilAlpha,
  useGroundTexture,
} from './ground';
import { surfaceBlendOf, wetnessOf, type SurfaceBlend } from '../game/surface';
import { discardedRoadOf, hidesDiscardedSide } from '../game/track';
import { SHOULDER_W } from '../game/player';
import { segmentColors, type ThemePalette } from './palette';
import { CAMERA_DEPTH, DRAW_DISTANCE, FOG_DENSITY, LANES } from './project';
import type { AssetStore, Segment, SpriteName, Weather } from '../types';

/** Oltre questa frazione della distanza di disegno inizia la nebbia (spec §4.4). */
export const FOG_START = 0.8;

/** Dissolvenza esponenziale: 1 = aria limpida, verso 0 = coperto. Invariata. */
export function exponentialFog(distance: number, density: number): number {
  return 1 / Math.pow(Math.E, distance * distance * density);
}

/**
 * Dove comincia la nebbia, per meteo (spec §4.4f). Con la sabbia la
 * visibilità è la cosa che cambia di più: a 0.55 della distanza di
 * disegno il velo comincia a metà dei 300 segmenti, e la strada svanisce
 * dentro l'ocra invece di arrivare nitida all'orizzonte. Con la pioggia
 * è un effetto più tenue. La neve **non** la tocca: centoquaranta
 * fiocchi davanti alla telecamera tagliano già la vista, e sommare la
 * nebbia renderebbe la tappa un muro bianco.
 *
 * Cambia solo **dove comincia**: la densità (`FOG_DENSITY = 5`) e la
 * forma esponenziale della dissolvenza restano quelle del binario A
 * (deroga 9 dichiarata, binario K).
 */
export const FOG_START_BY_WEATHER: Readonly<Record<Weather, number>> = {
  clear: FOG_START,
  rain: 0.7,
  snow: FOG_START,
  dust: 0.55,
};

/** Soglia della nebbia per un meteo; assente vale sereno. Pura. */
export function fogStartFor(weather: Weather = 'clear'): number {
  return FOG_START_BY_WEATHER[weather] ?? FOG_START;
}

/** Quantità di nebbia da sovrapporre, 0 = niente, 1 = tutto (spec §4.4, §4.4f). Pura. */
export function fogAmount(distanceRatio: number, weather: Weather = 'clear'): number {
  const start = fogStartFor(weather);
  if (distanceRatio <= start) return 0;
  const t = Math.min(1, (distanceRatio - start) / (1 - start));
  return 1 - exponentialFog(t, FOG_DENSITY);
}

/**
 * Decisione di visibilità della spec §4.4: salta i segmenti dietro la
 * telecamera, quelli rivolti all'indietro e quelli coperti da una collina
 * già disegnata (`clip` è il maxY valido per questo segmento).
 */
export function shouldDrawSegment(seg: Segment, cameraDepth = CAMERA_DEPTH): boolean {
  return (
    seg.p1.camera.z > cameraDepth &&
    seg.p2.screen.y < seg.p1.screen.y &&
    seg.p2.screen.y < seg.clip
  );
}

/** Larghezza della banda laterale a partire dalla semilarghezza proiettata. */
export function rumbleWidth(projectedHalfW: number, lanes = LANES): number {
  return projectedHalfW / Math.max(6, 2 * lanes);
}

/** Spessore della linea di corsia a partire dalla semilarghezza proiettata. */
export function laneMarkerWidth(projectedHalfW: number, lanes = LANES): number {
  return projectedHalfW / Math.max(32, 8 * lanes);
}

/**
 * Fino a sei linee: tre per carreggiata (quattro corsie, spec §4.1) e due
 * carreggiate. Allocato una volta: il ciclo di disegno non alloca.
 */
export const LANE_BUFFER: number[] = [0, 0, 0, 0, 0, 0];
/** Le stesse linee al capo lontano del segmento (bivio v3). */
export const LANE_BUFFER_FAR: number[] = [0, 0, 0, 0, 0, 0];

/**
 * Offset in unità `x` delle linee di corsia, scritti in `out`; ritorna quante
 * ne ha scritte. Con `median = 0` c'è una sola carreggiata da `-roadHalf` a
 * `+roadHalf` e le linee cadono ai confini delle quattro corsie, esattamente
 * come prima di questo task; con l'isola sono due carreggiate, quattro corsie
 * ciascuna
 * (spec §4.4, «linee di corsia per carreggiata»). `divided` forza le due
 * carreggiate anche con `median = 0`: serve alla punta della Y (bivio v3),
 * dove il capo vicino del segmento ha l'isola a zero e quello lontano no, e
 * le linee dei due capi devono corrispondersi una a una. Pura, non alloca.
 */
export function laneOffsets(
  roadHalf: number,
  median: number,
  lanes: number,
  out: number[],
  divided: boolean = median > 0,
): number {
  if (lanes < 2) return 0;
  let n = 0;
  if (!divided) {
    const step = (2 * roadHalf) / lanes;
    for (let i = 1; i < lanes; i++) out[n++] = -roadHalf + i * step;
    return n;
  }
  const step = (roadHalf - median) / lanes;
  for (const side of SIDES) {
    for (let i = 1; i < lanes; i++) out[n++] = side * (median + i * step);
  }
  return n;
}

/**
 * Ciò che serve al disegno con texture. `null` disegna la strada a colori
 * piatti, come prima di questo binario: è il ripiego di ogni caso limite.
 */
export interface RoadRenderOptions {
  assets: AssetStore;
  /**
   * Orologio del luccichio dell'acqua (spec §4.4c): i secondi che restano.
   * Fuori dalla gara è costante e il luccichio sta fermo, che è giusto.
   */
  timeLeft: number;
  /** Corsie della tappa (spec §9): 3 o 4. Assente vale `LANES`. */
  lanes?: number;
  /**
   * Seconda coppia di tessere durante una transizione fra tappe (spec §4.4d):
   * si disegnano sopra le prime con `alpha` pari al progresso. Assente fuori
   * dalla transizione, e ignorata con `alpha` a zero.
   */
  overlay?: { ground: SpriteName; asphalt: SpriteName; alpha: number };
  /**
   * Meteo della tappa (spec §4.4f): decide la superficie di fondo
   * (`'rain'` bagna tutto) e la nebbia più vicina (task 7). Assente vale
   * `'clear'`, e il segmento si disegna esattamente come prima di questo
   * binario.
   */
  weather?: Weather;
}

/**
 * Strada scartata al bivio (spec §4.4): dopo il commit, sui segmenti che
 * restano della zona (bivio v3), e all'uscita, sui primi
 * `FORK_EXIT_SEGMENTS` della tappa nuova (spec §4.4, «Uscita dal bivio»).
 * **Deroga, terzo addendum del collaudo**: si disegna come una strada vera —
 * asfalto, cordoli e linee di corsia, con lo stesso cordolo (`rumbleWidth`)
 * e la stessa larghezza di corsia (`laneMarkerWidth`) della carreggiata del
 * giocatore. Geometria da `discardedRoadOf`, con i due capi del segmento
 * distinti (bivio v3: nella zona si allontana in fretta, e con un offset
 * solo per segmento i bordi farebbero i gradini). Non si disegna quando la
 * semilarghezza è zero a entrambi i capi. La superficie segue quella della
 * carreggiata del giocatore su questo stesso segmento (spec §4.4f): `blend`
 * assente la ricalcola da `seg` a meteo sereno, che è il comportamento di
 * prima di questo binario per chi non passa il meteo.
 */
export function drawForkExitRoad(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  pal: ThemePalette,
  lanes: number = LANES,
  blend: SurfaceBlend = surfaceBlendOf(seg),
): void {
  const road = discardedRoadOf(seg);
  if (road === null || !(road.halfNear > 0 || road.halfFar > 0)) return;
  const { x: x1, w: w1 } = seg.p1.screen;
  const { x: x2, w: w2 } = seg.p2.screen;
  const { near: y1, far: y2 } = bandEdges(seg);
  const cx1 = x1 + road.near * w1;
  const cx2 = x2 + road.far * w2;
  const r1 = w1 * road.halfNear;
  const r2 = w2 * road.halfFar;
  const s1 = r1 * SHOULDER_W;
  const s2 = r2 * SHOULDER_W;
  const k1 = rumbleWidth(w1, lanes);
  const k2 = rumbleWidth(w2, lanes);
  const c = segmentColors(pal, seg.dark);
  // banchina
  quad(ctx, cx1 - r1 - s1, y1, cx1 - r1, y1, cx2 - r2, y2, cx2 - r2 - s2, y2, c.shoulder);
  quad(ctx, cx1 + r1, y1, cx1 + r1 + s1, y1, cx2 + r2 + s2, y2, cx2 + r2, y2, c.shoulder);
  // cordolo
  if (hasKerb(blend)) {
    quad(ctx, cx1 - r1 - k1, y1, cx1 - r1, y1, cx2 - r2, y2, cx2 - r2 - k2, y2, c.rumble);
    quad(ctx, cx1 + r1 + k1, y1, cx1 + r1, y1, cx2 + r2, y2, cx2 + r2 + k2, y2, c.rumble);
  }
  // asfalto, con la superficie del segmento (spec §4.4f).
  quad(ctx, cx1 - r1, y1, cx1 + r1, y1, cx2 + r2, y2, cx2 - r2, y2, surfaceRoadColour(pal, c.road, blend));
  // linee di corsia, come la strada vera.
  if (c.lane) {
    const l1 = laneMarkerWidth(w1, lanes);
    const l2 = laneMarkerWidth(w2, lanes);
    const laneCount = laneOffsets(road.halfNear, 0, lanes, LANE_BUFFER);
    laneOffsets(road.halfFar, 0, lanes, LANE_BUFFER_FAR);
    for (let i = 0; i < laneCount; i++) {
      const lx1 = cx1 + LANE_BUFFER[i] * w1;
      const lx2 = cx2 + LANE_BUFFER_FAR[i] * w2;
      quad(ctx, lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, c.lane);
    }
  }
}

/**
 * Tessere di superficie del segmento (spec §4.4f): quella del fondo e
 * quella del tratto, ognuna col suo peso di `surfaceTileWeights`, con la
 * stessa fetta ritagliata dell'asfalto. Ritorna `true` se ha disegnato
 * qualcosa: allora il velo sopra usa `tiledVeilAlpha`, più leggero,
 * perché colore e grana li porta già la tessera.
 */
export function drawSurfaceTiles(
  ctx: CanvasRenderingContext2D,
  opts: RoadRenderOptions,
  seg: Segment,
  width: number,
  bandH: number,
  blend: SurfaceBlend,
): boolean {
  const weights = surfaceTileWeights(blend);
  let drawn = false;
  for (const [kind, weight] of [
    [blend.base, weights.base],
    [blend.kind, weights.kind],
  ] as const) {
    if (!(weight > 0)) continue;
    const name = surfaceTile(kind);
    if (name === null) continue;
    const tile = opts.assets.get(name);
    if (tile.entry.kind !== 'texture' || !(tile.w > 0) || !(tile.h > 0)) continue;
    // `drawAsphaltSlab` moltiplica per `ASPHALT_ALPHA`: la tessera di
    // superficie invece copre, con alfa pari al suo peso.
    drawAsphaltSlab(ctx, tile, seg, width, bandH, false, weight / ASPHALT_ALPHA);
    drawn = true;
  }
  return drawn;
}

/**
 * Disegna un segmento nell'ordine di spec §4.4a: terreno (con texture),
 * banchina, cordolo, asfalto (con texture), tracce d'usura, linee di corsia,
 * strada secondaria dell'uscita dal bivio, nebbia. Con `opts` a null resta il
 * disegno a colori piatti.
 */
export function drawSegment(
  ctx: CanvasRenderingContext2D,
  width: number,
  seg: Segment,
  pal: ThemePalette,
  fog: number,
  distanceRatio: number,
  opts: RoadRenderOptions | null,
): void {
  const { x: x1, w: w1 } = seg.p1.screen;
  const { x: x2, w: w2 } = seg.p2.screen;
  /** Altezza vera della fascia: decide se vale la pena di testurizzarla. */
  const bandH = seg.p1.screen.y - seg.p2.screen.y;
  /** Bordi al pixel intero: nessun antialiasing sui confini (`bandEdges`). */
  const { near: y1, far: y2 } = bandEdges(seg);
  const drawH = y1 - y2;
  const c = segmentColors(pal, seg.dark);
  /** Corsie della tappa (spec §9): assente vale `LANES`. */
  const lanes = opts?.lanes ?? LANES;

  /**
   * Superficie del segmento: il fondo dal meteo, il tratto dal
   * generatore, e quanto vale il secondo sul primo (spec §4.4f). Fuori
   * dai tratti e senza pioggia è `{ asphalt, asphalt, 0 }`, e ogni
   * decisione qui sotto ricade su quella di prima.
   */
  const blend = surfaceBlendOf(seg, opts?.weather ?? 'clear');
  /** Quanto la strada riflette: zero su tutto tranne il bagnato. */
  const wet = wetnessOf(blend);

  // get() non lancia mai: senza PNG arriva il procedurale, e se anche quello
  // mancasse `useGroundTexture` rifiuta l'asset e resta il colore piatto.
  const ground = opts === null ? null : opts.assets.get(pal.ground);
  const asphalt = opts === null ? null : opts.assets.get(pal.asphalt);
  const slabW = slabWidth(w1);
  const textured =
    ground !== null &&
    useGroundTexture({
      distanceRatio,
      bandH,
      slabW,
      width,
      tileW: ground.w,
      tileH: ground.h,
      kind: ground.entry.kind,
    });

  // 1. terreno: il colore piatto sta sempre sotto, la fetta sopra.
  ctx.fillStyle = textured ? pal.grassLight : c.grass;
  ctx.fillRect(0, y2, width, drawH);
  if (textured && ground !== null) {
    drawGroundSlab(ctx, ground, seg, width, y2, drawH);
    if (seg.dark) {
      ctx.fillStyle = DARK_VEIL;
      ctx.fillRect(0, y2, width, drawH);
    }
  }

  // Tessera del tema nuovo sopra quella vecchia (spec §4.4d).
  const overlay = opts?.overlay;
  if (textured && opts !== null && overlay !== undefined && overlay.alpha > 0) {
    const fresh = opts.assets.get(overlay.ground);
    if (fresh.entry.kind === 'texture' && fresh.w > 0 && fresh.h > 0) {
      ctx.globalAlpha = overlay.alpha;
      drawGroundSlab(ctx, fresh, seg, width, y2, drawH);
      ctx.globalAlpha = 1;
    }
  }

  // 1b. acqua: sostituisce il terreno oltre la banchina, su un lato solo.
  // Terzo addendum del collaudo: non sul lato della strada scartata quando
  // è vicina (`hidesDiscardedSide`), o la coprirebbe.
  const water = seg.water;
  const waterSide: -1 | 1 = water === 'left' ? -1 : 1;
  const waterShown = water !== undefined && !hidesDiscardedSide(waterSide, seg);
  if (waterShown) {
    drawWater(ctx, seg, c, width, water, opts !== null && shimmerOn(opts.timeLeft));
  }

  // 2. banchina
  drawShoulders(ctx, seg, c);

  // 3. cordolo esterno, su ogni bordo della strada divisa. Lo sterrato
  // non ce l'ha (spec §4.4f): una strada di terra non ha il cordolo
  // bianco e rosso.
  const r1 = w1 * seg.roadHalf;
  const r2 = w2 * farRoadHalf(seg);
  const k1 = rumbleWidth(w1, lanes);
  const k2 = rumbleWidth(w2, lanes);
  if (hasKerb(blend)) {
    quad(ctx, x1 - r1 - k1, y1, x1 - r1, y1, x2 - r2, y2, x2 - r2 - k2, y2, c.rumble);
    quad(ctx, x1 + r1 + k1, y1, x1 + r1, y1, x2 + r2, y2, x2 + r2 + k2, y2, c.rumble);
  }

  // 4. asfalto: un trapezio finché non c'è isola, due dopo (spec §4.4)
  const m1 = w1 * seg.median;
  const m2 = w2 * farMedian(seg);
  const divided = seg.median > 0 || farMedian(seg) > 0;
  // Il colore piatto porta la superficie a ogni distanza, anche dove la
  // tessera non si disegna più (spec §4.4f). Sull'asfalto asciutto
  // ritorna la stessa stringa e non cambia un pixel.
  const road = surfaceRoadColour(pal, textured ? pal.roadLight : c.road, blend);
  if (divided) {
    for (const side of SIDES) {
      quad(
        ctx,
        x1 + side * m1,
        y1,
        x1 + side * r1,
        y1,
        x2 + side * r2,
        y2,
        x2 + side * m2,
        y2,
        road,
      );
    }
  } else {
    quad(ctx, x1 - r1, y1, x1 + r1, y1, x2 + r2, y2, x2 - r2, y2, road);
  }
  if (textured && asphalt !== null) {
    const asphaltTextured = useGroundTexture({
      distanceRatio,
      bandH,
      slabW,
      width,
      tileW: asphalt.w,
      tileH: asphalt.h,
      kind: asphalt.entry.kind,
    });
    if (asphaltTextured) {
      drawAsphaltSlab(ctx, asphalt, seg, width, drawH, seg.dark);
      if (opts !== null && overlay !== undefined && overlay.alpha > 0) {
        const freshRoad = opts.assets.get(overlay.asphalt);
        if (freshRoad.entry.kind === 'texture' && freshRoad.w > 0) {
          drawAsphaltSlab(ctx, freshRoad, seg, width, drawH, seg.dark, overlay.alpha);
        }
      }
      // Sterrato e neve: la loro tessera sopra l'asfalto, con la miscela
      // del tratto (spec §4.4f). Senza PNG arriva il procedurale; se anche
      // quello mancasse resta il velo pieno di prima.
      const tiled = opts !== null && drawSurfaceTiles(ctx, opts, seg, width, drawH, blend);
      // Le tracce d'usura sono di una strada vissuta: la zona di bivio si
      // apre in due carreggiate nuove, e lì non si disegnano. Sulla terra
      // e sulla neve sono i solchi delle ruote, molto più marcati
      // (spec §4.4f).
      if (!divided) drawWearTracks(ctx, seg, lanes, wearAlphaFor(blend));
      drawAsphaltTint(ctx, seg, veilColour(pal, blend), tiled ? tiledVeilAlpha(blend) : veilAlpha(blend));
      // Riflesso del bagnato, solo sui segmenti scuri: l'alternanza ogni
      // tre segmenti lo rende una striscia di luce che corre (spec §4.4f).
      if (wet > 0 && seg.dark) drawWetSheen(ctx, seg, wet);
    }
  }

  // 4b. isola centrale e cordoli interni, solo dove l'isola esiste. Nella
  // zona di bivio l'isola è il terreno del tema (bivio v3), niente riempimento.
  if (divided) {
    drawIsland(ctx, seg, c, seg.fork !== 'zone');
    for (const side of SIDES) {
      const i1 = Math.max(0, m1 - k1);
      const i2 = Math.max(0, m2 - k2);
      quad(
        ctx,
        x1 + side * i1,
        y1,
        x1 + side * m1,
        y1,
        x2 + side * m2,
        y2,
        x2 + side * i2,
        y2,
        c.rumble,
      );
    }
  }

  // 5. linee di corsia, per carreggiata. Sul bagnato sono più larghe e
  // più chiare: riflettono (spec §4.4f).
  if (c.lane) {
    const widen = 1 + (WET_LANE_WIDEN - 1) * wet;
    const l1 = laneMarkerWidth(w1, lanes) * widen;
    const l2 = laneMarkerWidth(w2, lanes) * widen;
    const colour = wet > 0 ? wetLaneColour(c.lane, pal.rumbleLight) : c.lane;
    const laneCount = laneOffsets(seg.roadHalf, seg.median, lanes, LANE_BUFFER, divided);
    laneOffsets(farRoadHalf(seg), farMedian(seg), lanes, LANE_BUFFER_FAR, divided);
    for (let i = 0; i < laneCount; i++) {
      const lx1 = x1 + LANE_BUFFER[i] * w1;
      const lx2 = x2 + LANE_BUFFER_FAR[i] * w2;
      quad(ctx, lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, colour);
    }
  }

  // 5b. strada scartata al bivio, sotto gli sprite (spec §4.4). Non sopra
  // il mare del suo lato: lì la strada è lontana, e una striscia d'asfalto
  // sull'acqua all'orizzonte non ha senso.
  if (seg.forkExit !== undefined || seg.discarded !== undefined) {
    const road = discardedRoadOf(seg);
    const onWater = waterShown && road !== null && Math.sign(road.near) === waterSide;
    if (!onWater) drawForkExitRoad(ctx, seg, pal, lanes, blend);
  }

  // 6. nebbia
  if (fog > 0) {
    ctx.globalAlpha = fog;
    ctx.fillStyle = pal.fog;
    ctx.fillRect(0, y2, width, drawH);
    ctx.globalAlpha = 1;
  }
}

/** Disegna i segmenti dal più vicino al più lontano (spec §4.4). */
export function renderRoad(
  ctx: CanvasRenderingContext2D,
  segments: readonly Segment[],
  pal: ThemePalette,
  width: number,
  opts: RoadRenderOptions | null = null,
): void {
  const weather = opts?.weather ?? 'clear';
  for (let n = 0; n < segments.length; n++) {
    const seg = segments[n];
    if (!shouldDrawSegment(seg)) continue;
    const ratio = n / DRAW_DISTANCE;
    drawSegment(ctx, width, seg, pal, fogAmount(ratio, weather), ratio, opts);
  }
}
