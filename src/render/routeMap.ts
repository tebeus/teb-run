import type { AssetStore } from '../types';

/** Livelli del grafo delle tappe (spec §9): cinque righe di mappa. */
export const ROUTE_LEVELS = 5;
/** Raggio dei nodi: quelli percorsi sono più grandi. */
export const NODE_R = 5;
export const VISITED_NODE_R = 7;
export const MAP_EDGE = '#3a4a5a';
export const MAP_EDGE_ON = '#ffd23f';
export const MAP_NODE = '#6f7a88';
export const MAP_NODE_ON = '#ffd23f';
export const MAP_CURRENT = '#ff3333';
/** Spessore dei collegamenti, spenti e accesi. */
export const EDGE_W = 1;
export const EDGE_ON_W = 3;

/**
 * Le tappe attraversate da un percorso, partendo da `0-0` (spec §11):
 * L porta a `(l+1)-i`, R a `(l+1)-(i+1)`. Una lista di scelte più lunga dei
 * bivi esistenti si ferma all'ultimo livello. Pura.
 */
export function visitedStages(route: readonly ('L' | 'R')[]): string[] {
  const out = ['0-0'];
  let level = 0;
  let index = 0;
  for (const side of route) {
    if (level >= ROUTE_LEVELS - 1) break;
    level += 1;
    if (side === 'R') index += 1;
    out.push(`${level}-${index}`);
  }
  return out;
}

/**
 * Centro del nodo `l-i` dentro il riquadro dato: il livello 0 in basso, il 4
 * in alto, ogni riga centrata orizzontalmente. Pura.
 */
export function nodeCentre(
  level: number,
  index: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { cx: number; cy: number } {
  const stepY = h / ROUTE_LEVELS;
  const stepX = w / ROUTE_LEVELS;
  return {
    cx: x + w / 2 + stepX * (index - level / 2),
    cy: y + h - stepY * (level + 0.5),
  };
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function line(
  ctx: CanvasRenderingContext2D,
  a: { cx: number; cy: number },
  b: { cx: number; cy: number },
  colour: string,
  width: number,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.cx, a.cy);
  ctx.lineTo(b.cx, b.cy);
  ctx.stroke();
}

/** Coordinate di un id "l-i", o null se l'id non è del grafo. */
function centreOf(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): { cx: number; cy: number } | null {
  const m = /^(\d)-(\d)$/.exec(id);
  if (!m) return null;
  const level = Number(m[1]);
  const index = Number(m[2]);
  if (level >= ROUTE_LEVELS || index > level) return null;
  return nodeCentre(level, index, x, y, w, h);
}

/**
 * La mappa del percorso di spec §11: il triangolo delle 15 tappe, i
 * collegamenti, le tappe percorse evidenziate, la tappa corrente marcata.
 * `visited` arriva da `visitedStages`; `current` è l'id della tappa in cui si
 * è finiti, e un id che non sta nel grafo non viene marcato.
 */
export function drawRouteMap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  visited: readonly string[],
  current: string,
): void {
  if (!(w > 0) || !(h > 0)) return;
  const at = (level: number, index: number) => nodeCentre(level, index, x, y, w, h);

  // 1. i collegamenti spenti di tutto il triangolo
  for (let level = 0; level < ROUTE_LEVELS - 1; level++) {
    for (let index = 0; index <= level; index++) {
      const from = at(level, index);
      line(ctx, from, at(level + 1, index), MAP_EDGE, EDGE_W);
      line(ctx, from, at(level + 1, index + 1), MAP_EDGE, EDGE_W);
    }
  }

  // 2. i collegamenti del percorso, sopra i precedenti
  for (let i = 1; i < visited.length; i++) {
    const from = centreOf(visited[i - 1], x, y, w, h);
    const to = centreOf(visited[i], x, y, w, h);
    if (from !== null && to !== null) line(ctx, from, to, MAP_EDGE_ON, EDGE_ON_W);
  }

  // 3. i quindici nodi
  for (let level = 0; level < ROUTE_LEVELS; level++) {
    for (let index = 0; index <= level; index++) {
      const c = at(level, index);
      circle(ctx, c.cx, c.cy, NODE_R, MAP_NODE);
    }
  }

  // 4. le tappe percorse, più grandi
  for (const id of visited) {
    const c = centreOf(id, x, y, w, h);
    if (c !== null) circle(ctx, c.cx, c.cy, VISITED_NODE_R, MAP_NODE_ON);
  }

  // 5. la tappa in cui si è finiti
  const now = centreOf(current, x, y, w, h);
  if (now !== null) circle(ctx, now.cx, now.cy, NODE_R, MAP_CURRENT);
}

/** Velo scuro fra l'illustrazione e il grafo: il 25% di spec §11. */
export const MAP_VEIL = 'rgba(0,0,0,0.25)';

/**
 * La mappa del percorso disegnata sopra l'illustrazione `map_full`
 * (spec §11): l'immagine tirata dentro il riquadro, un velo scuro al 25%
 * perché i nodi restino leggibili, e sopra il grafo di `drawRouteMap`.
 * Un riquadro senza area non disegna niente; un asset senza misura lascia
 * solo il grafo, che è il contenuto vero.
 */
export function drawRouteMapPanel(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  x: number,
  y: number,
  w: number,
  h: number,
  visited: readonly string[],
  current: string,
): void {
  if (!(w > 0) || !(h > 0)) return;
  // get() non lancia mai: senza PNG arriva il ripiego procedurale.
  const asset = assets.get('map_full');
  if (asset.w > 0 && asset.h > 0) {
    ctx.drawImage(asset.image, x, y, w, h);
    ctx.fillStyle = MAP_VEIL;
    ctx.fillRect(x, y, w, h);
  }
  drawRouteMap(ctx, x, y, w, h, visited, current);
}

/** Rettangolo in coordinate logiche. */
export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Il riquadro più grande con l'aspetto dell'immagine che sta dentro
 * `box`, centrato: niente tagli e niente deformazioni. Un'immagine senza
 * misura occupa tutto il riquadro. Pura.
 */
export function containRect(iw: number, ih: number, box: MapRect): MapRect {
  if (!(iw > 0) || !(ih > 0) || !(box.w > 0) || !(box.h > 0)) return { ...box };
  const s = Math.min(box.w / iw, box.h / ih);
  const w = iw * s;
  const h = ih * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * L'illustrazione `map_full` come fondo di un riquadro intero (game over):
 * prima il colore di fondo, che fa da letterbox dove l'aspetto non
 * coincide, poi l'immagine intera e non deformata, poi un velo scuro
 * `veil` perché il grafo sopra resti il contenuto da leggere. Ritorna il
 * rettangolo dove l'immagine è finita (null se l'asset non ha misura).
 */
/** Quanto colore si toglie all'illustrazione di fondo (0 niente, 1 tutto). */
export const BACKDROP_DESATURATE = 0.7;

export function drawMapBackdrop(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  box: MapRect,
  background: string,
  veil: string,
): MapRect | null {
  if (!(box.w > 0) || !(box.h > 0)) return null;
  ctx.fillStyle = background;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const asset = assets.get('map_full');
  let placed: MapRect | null = null;
  if (asset.w > 0 && asset.h > 0) {
    placed = containRect(asset.w, asset.h, box);
    ctx.drawImage(asset.image, placed.x, placed.y, placed.w, placed.h);
    // Toglie gran parte del colore all'illustrazione: i suoi nodi gialli
    // disegnati non fanno concorrenza al grafo, che è giallo anche lui.
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = BACKDROP_DESATURATE;
    ctx.fillStyle = '#808080';
    ctx.fillRect(placed.x, placed.y, placed.w, placed.h);
    ctx.restore();
  }
  ctx.fillStyle = veil;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  return placed;
}

/** Misure della mappa grande (game over): nodi e tratti in pixel logici. */
export const BIG_NODE_R = 11;
export const BIG_VISITED_R = 16;
export const BIG_CURRENT_R = 25;
export const BIG_EDGE_W = 3;
export const BIG_EDGE_ON_W = 9;
/** Contorno scuro sotto il percorso e attorno ai nodi, per staccarli dal fondo. */
export const BIG_OUTLINE = '#101018';
export const BIG_NODE_FILL = '#2a3342';
/** Griglia spenta e bordo dei nodi spenti: chiari, perché il fondo è scuro e ricco. */
export const BIG_EDGE = '#a9b6c8';
export const BIG_NODE_RING = '#dfe6ef';
/** Lampeggio della tappa in cui è finita la corsa, in hertz. */
export const BIG_BLINK_HZ = 2.5;

/** Vero nella metà «accesa» del lampeggio a `BIG_BLINK_HZ`. Pura. */
export function blinkOn(t: number): boolean {
  return Math.floor(t * BIG_BLINK_HZ * 2) % 2 === 0;
}

/** Centro del nodo `id` nel riquadro, o null se l'id non è del grafo. Pura. */
export function nodeCentreOf(id: string, rect: MapRect): { cx: number; cy: number } | null {
  return centreOf(id, rect.x, rect.y, rect.w, rect.h);
}

/**
 * Il grafo delle 15 tappe in grande, per la schermata di game over: i
 * collegamenti spenti sottili, il tratto percorso spesso e giallo sopra un
 * contorno scuro, i nodi spenti vuoti, quelli percorsi pieni, e la tappa in
 * cui si è finiti con il centro rosso e un anello rosso che c'è solo quando
 * `blink` è vero. Stesse posizioni di `drawRouteMap` (`nodeCentre`).
 */
export function drawRouteMapLarge(
  ctx: CanvasRenderingContext2D,
  rect: MapRect,
  visited: readonly string[],
  current: string,
  blink: boolean,
): void {
  const { x, y, w, h } = rect;
  if (!(w > 0) || !(h > 0)) return;
  const at = (level: number, index: number) => nodeCentre(level, index, x, y, w, h);

  // 1. la griglia spenta
  for (let level = 0; level < ROUTE_LEVELS - 1; level++) {
    for (let index = 0; index <= level; index++) {
      const from = at(level, index);
      line(ctx, from, at(level + 1, index), BIG_EDGE, BIG_EDGE_W);
      line(ctx, from, at(level + 1, index + 1), BIG_EDGE, BIG_EDGE_W);
    }
  }

  // 2. il percorso: prima il contorno scuro, poi il giallo sopra
  const hops: { from: { cx: number; cy: number }; to: { cx: number; cy: number } }[] = [];
  for (let i = 1; i < visited.length; i++) {
    const from = centreOf(visited[i - 1], x, y, w, h);
    const to = centreOf(visited[i], x, y, w, h);
    if (from !== null && to !== null) hops.push({ from, to });
  }
  for (const hop of hops) line(ctx, hop.from, hop.to, BIG_OUTLINE, BIG_EDGE_ON_W + 4);
  for (const hop of hops) line(ctx, hop.from, hop.to, MAP_EDGE_ON, BIG_EDGE_ON_W);

  // 3. i nodi spenti: un disco scuro con il bordo grigio
  const on = new Set(visited);
  for (let level = 0; level < ROUTE_LEVELS; level++) {
    for (let index = 0; index <= level; index++) {
      if (on.has(`${level}-${index}`)) continue;
      const c = at(level, index);
      circle(ctx, c.cx, c.cy, BIG_NODE_R + 2, BIG_NODE_RING);
      circle(ctx, c.cx, c.cy, BIG_NODE_R, BIG_NODE_FILL);
    }
  }

  // 4. i nodi percorsi, pieni
  for (const id of visited) {
    const c = centreOf(id, x, y, w, h);
    if (c === null) continue;
    circle(ctx, c.cx, c.cy, BIG_VISITED_R + 3, BIG_OUTLINE);
    circle(ctx, c.cx, c.cy, BIG_VISITED_R, MAP_NODE_ON);
  }

  // 5. la tappa in cui si è finiti: centro rosso sempre, anello a lampeggio
  const now = centreOf(current, x, y, w, h);
  if (now !== null) {
    if (blink) {
      ctx.strokeStyle = MAP_CURRENT;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(now.cx, now.cy, BIG_CURRENT_R, 0, Math.PI * 2);
      ctx.stroke();
    }
    circle(ctx, now.cx, now.cy, BIG_VISITED_R - 6, MAP_CURRENT);
  }
}
