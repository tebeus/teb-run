export const LOGICAL_W = 1280;
export const LOGICAL_H = 720;

export interface Letterbox {
  scale: number;
  cssW: number;
  cssH: number;
  offsetX: number;
  offsetY: number;
}

/** Calcola come inserire un canvas w×h in una finestra winW×winH mantenendo il rapporto. Pura. */
export function computeLetterbox(winW: number, winH: number, w = LOGICAL_W, h = LOGICAL_H): Letterbox {
  const scale = Math.min(winW / w, winH / h);
  const cssW = Math.max(1, Math.floor(w * scale));
  const cssH = Math.max(1, Math.floor(h * scale));
  return {
    scale,
    cssW,
    cssH,
    offsetX: Math.max(0, Math.floor((winW - cssW) / 2)),
    offsetY: Math.max(0, Math.floor((winH - cssH) / 2)),
  };
}

/** Margini da lasciare liberi ai bordi (le safe area di un telefono con notch), in pixel CSS. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Come `computeLetterbox`, ma dentro la finestra meno le safe area: il gioco
 * non finisce sotto il notch né sotto la barra di iOS. Senza margini è
 * identico a `computeLetterbox`. Pura.
 */
export function computeSafeLetterbox(winW: number, winH: number, insets: Insets = NO_INSETS): Letterbox {
  const n = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
  const top = n(insets.top);
  const left = n(insets.left);
  const innerW = Math.max(1, winW - left - n(insets.right));
  const innerH = Math.max(1, winH - top - n(insets.bottom));
  const lb = computeLetterbox(innerW, innerH);
  return { ...lb, offsetX: lb.offsetX + Math.floor(left), offsetY: lb.offsetY + Math.floor(top) };
}

/** Le safe area, dalle variabili CSS `--safe-*` di style.css (`env(safe-area-inset-*)`). */
export function readSafeInsets(root: Element): Insets {
  try {
    const style = getComputedStyle(root);
    const px = (name: string): number => parseFloat(style.getPropertyValue(name)) || 0;
    return { top: px('--safe-top'), right: px('--safe-right'), bottom: px('--safe-bottom'), left: px('--safe-left') };
  } catch {
    return NO_INSETS;
  }
}

/** Imposta la risoluzione logica, il letterbox e il ridimensionamento automatico. */
export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  canvas.width = LOGICAL_W;
  canvas.height = LOGICAL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingEnabled = true;

  const fit = (): void => {
    const lb = computeSafeLetterbox(window.innerWidth, window.innerHeight, readSafeInsets(document.documentElement));
    canvas.style.width = `${lb.cssW}px`;
    canvas.style.height = `${lb.cssH}px`;
    canvas.style.left = `${lb.offsetX}px`;
    canvas.style.top = `${lb.offsetY}px`;
  };
  window.addEventListener('resize', fit);
  // Il telefono che ruota: su iOS `resize` può arrivare prima delle misure nuove.
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  fit();
  return ctx;
}
