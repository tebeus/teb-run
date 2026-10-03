import { LOGICAL_H, LOGICAL_W } from './canvas';

/** Un punto in coordinate del canvas logico 1280x720. */
export interface LogicalPoint {
  x: number;
  y: number;
}

/**
 * Segnali del sistema che non sono tasti: il tocco o il clic sul canvas e la
 * perdita del fuoco (lancio, punto 5). Si leggono "consumandoli", una volta
 * per tick: chi li prende li azzera.
 */
export interface SystemSignals {
  /** L'ultimo tocco o clic sul canvas dall'ultima lettura, o null. */
  takeTap(): LogicalPoint | null;
  /** true se la finestra ha perso il fuoco o la scheda è stata nascosta dall'ultima lettura. */
  takeFocusLost(): boolean;
}

/** Il riquadro del canvas sulla pagina, come lo dà `getBoundingClientRect`. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Da coordinate della pagina a coordinate logiche del canvas, tenendo conto
 * del letterbox e di qualunque scala CSS. null fuori dal canvas o con un
 * canvas senza area. Pura.
 */
export function toLogical(clientX: number, clientY: number, rect: ClientRect): LogicalPoint | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const x = ((clientX - rect.left) * LOGICAL_W) / rect.width;
  const y = ((clientY - rect.top) * LOGICAL_H) / rect.height;
  if (x < 0 || y < 0 || x > LOGICAL_W || y > LOGICAL_H) return null;
  return { x, y };
}

interface DocLike extends EventTarget {
  readonly visibilityState?: string;
  readonly hidden?: boolean;
}

interface CanvasLike extends EventTarget {
  getBoundingClientRect(): ClientRect;
}

/**
 * Collega `pointerdown` sul canvas, `blur` sulla finestra e
 * `visibilitychange` sul documento. Con la scheda nascosta
 * requestAnimationFrame si ferma: il segnale resta in attesa e la gara lo
 * legge al primo tick dopo il ritorno, prima di far avanzare il motore.
 */
export function createSystemSignals(win: EventTarget, doc: DocLike, canvas: CanvasLike): SystemSignals {
  let tap: LogicalPoint | null = null;
  let focusLost = false;

  canvas.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    const p = toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
    if (p !== null) tap = p;
  });
  win.addEventListener('blur', () => {
    focusLost = true;
  });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden' || doc.hidden === true) focusLost = true;
  });

  return {
    takeTap() {
      const t = tap;
      tap = null;
      return t;
    },
    takeFocusLost() {
      const lost = focusLost;
      focusLost = false;
      return lost;
    },
  };
}
