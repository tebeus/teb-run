// Riquadri e aree di tocco, senza dipendenze: li usano launchUi, share e touch
// (e gli e2e, che non possono importare moduli che leggono import.meta.env).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Area di tocco minima, in pixel CSS (linee guida per il touch). */
export const MIN_TOUCH_CSS = 44;

/**
 * Allarga `r` attorno al suo centro fino ad almeno `MIN_TOUCH_CSS` pixel CSS
 * per lato, dato quanti pixel CSS vale un pixel logico (`cssPerLogical`), e
 * non meno di `minLogical` pixel logici. Pura.
 */
export function touchRect(r: Rect, cssPerLogical: number, minLogical = 0): Rect {
  const k = cssPerLogical > 0 && Number.isFinite(cssPerLogical) ? cssPerLogical : 1;
  const need = Math.max(minLogical, MIN_TOUCH_CSS / k);
  const w = Math.max(r.w, need);
  const h = Math.max(r.h, need);
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

export function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
