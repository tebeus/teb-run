/** Tipi e colori condivisi da tutti gli sprite disegnati da codice. */

/**
 * Sottoinsieme di CanvasRenderingContext2D usato dai disegnatori. Lo
 * soddisfano il contesto di `HTMLCanvasElement`, quello di `OffscreenCanvas`
 * e il fake dei test: così i disegnatori non dipendono dal DOM.
 */
export type Ctx2D = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
};

export type Drawer = (ctx: Ctx2D, w: number, h: number) => void;

/** Palette anni 80: caldi saturi, contorno viola scuro, due toni per volume. */
export const P = {
  outline: '#1b1026',
  red: '#e03131',
  redDark: '#8f1d1d',
  redLight: '#ff6b6b',
  glass: '#3f5d8a',
  glassLight: '#9ad3ff',
  tyre: '#241c24',
  metal: '#c8ccd8',
  metalDark: '#7d8496',
  white: '#f5f0e6',
  cream: '#ffe9c0',
  yellow: '#ffd23f',
  yellowDark: '#c79a1c',
  orange: '#ff8c42',
  orangeDark: '#c25a17',
  pink: '#f06595',
  magenta: '#ff00ff',
  purple: '#7048e8',
  teal: '#2ec4b6',
  blue: '#3a86ff',
  blueDark: '#1d3557',
  green: '#2f9e44',
  greenDark: '#125522',
  greenLight: '#69db7c',
  sand: '#e6c27a',
  sandDark: '#b3893f',
  rock: '#c2622b',
  rockDark: '#7f3d18',
  grey: '#adb5bd',
  greyDark: '#5c636a',
  wood: '#96603a',
  woodDark: '#5c3a1a',
  snow: '#f1f3f5',
  brick: '#b03030',
  brickDark: '#6f1c1c',
  ochre: '#e8b04b',
  ochreDark: '#a97822',
  stone: '#d8cdb5',
  stoneDark: '#9b8d72',
} as const;

/** Spessore del contorno proporzionato al riquadro. */
export function lw(w: number, h: number): number {
  return Math.max(2, Math.round(Math.min(w, h) * 0.022));
}

/** Poligono pieno con contorno opzionale. */
export function poly(
  ctx: Ctx2D,
  points: readonly (readonly [number, number])[],
  fill: string | CanvasGradient,
  stroke?: string,
  width = 3,
): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** Ellisse piena con contorno opzionale. */
export function ell(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string | CanvasGradient,
  stroke?: string,
  width = 3,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** Rettangolo pieno con contorno opzionale. */
export function box(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string | CanvasGradient,
  stroke?: string,
  width = 3,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (stroke) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** Gradiente lineare da una lista di fermate. */
export function vgrad(
  ctx: Ctx2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: readonly (readonly [number, string])[],
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}
