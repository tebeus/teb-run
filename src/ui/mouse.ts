// Il clic del mouse (collaudo del Basic Launch su CrazyGames: quasi tutti
// cliccano). Solo il tasto sinistro del mouse vero (`pointerType` mouse):
// le dita e la penna passano già da `touch.ts`, così un tocco non vale mai
// due volte. Il clic conta alla pressione, come i tasti e il tocco, e dà il
// fuoco alla finestra (dentro un iframe la tastiera funziona subito dopo).
// Il punto arriva alle schermate in `actions.click`: ognuna sa cosa c'è
// sotto. I clic sui comandi di contorno (link, schermo intero, SHARE) li
// gestiscono `launchUi` e `share`, e qui si scartano.

import { toLogical, type LogicalPoint } from '../core/signals';
import type { ScreenName } from './fsm';
import { mouseButtonActions } from './touch';

/** Le schermate dove un clic del mouse fa qualcosa ovunque cada (per il puntatore). */
const CLICK_ANYWHERE: readonly ScreenName[] = ['title', 'daily', 'radio', 'scores'];

/** Il puntatore a manina su `screen` nel punto `p`? Pura. */
export function clickable(screen: ScreenName, p: LogicalPoint, extra: (screen: ScreenName, p: LogicalPoint) => boolean = () => false): boolean {
  return CLICK_ANYWHERE.includes(screen) || Object.keys(mouseButtonActions(screen, p)).length > 0 || extra(screen, p);
}

interface CanvasLike extends EventTarget {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  style: { cursor: string };
}

export interface MouseOptions {
  win: EventTarget & { focus?: () => void };
  canvas: CanvasLike;
  screen: () => ScreenName;
  /** Il punto è su un comando di contorno (link, schermo intero, SHARE)? Lì il clic non arriva alle schermate. */
  ignore?: (p: LogicalPoint) => boolean;
  /** Altri punti cliccabili per il puntatore (RETRY, i pulsanti delle iniziali). */
  pointerOver?: (screen: ScreenName, p: LogicalPoint) => boolean;
}

export interface MouseClicks {
  /** Il primo clic non ancora letto, o null: si consuma qui, uno per tick. */
  poll(): LogicalPoint | null;
}

/** Collega il mouse al canvas. */
export function createMouseClicks(opts: MouseOptions): MouseClicks {
  const { win, canvas, screen } = opts;
  const ignore = opts.ignore ?? (() => false);
  /** I clic non ancora letti: uno per tick, così due clic nello stesso fotogramma contano entrambi. */
  const clicks: LogicalPoint[] = [];
  const point = (e: PointerEvent): LogicalPoint | null => toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());

  canvas.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    try {
      win.focus?.();
    } catch {
      // Una finestra che non si lascia dare il fuoco: la tastiera aspetta un altro clic.
    }
    const p = point(e);
    if (p === null || ignore(p)) return;
    // Un tetto: una raffica di clic con il gioco fermo non si accumula all'infinito.
    if (clicks.length < 4) clicks.push(p);
  });
  // Registrato dopo quelli di `launchUi` e `share`: qui si decide l'ultima parola sul puntatore.
  canvas.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'mouse') return;
    const p = point(e);
    canvas.style.cursor = p !== null && (ignore(p) || clickable(screen(), p, opts.pointerOver)) ? 'pointer' : '';
  });

  return {
    poll() {
      return clicks.shift() ?? null;
    },
  };
}
