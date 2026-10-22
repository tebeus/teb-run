// RETRY a fine partita (Basic Launch su CrazyGames: chi ha appena perso deve
// poter ripartire subito). Due voci in basso al centro, RETRY grande e già
// scelto, MENU accanto: sinistra e destra cambiano voce, ENTER (o A) sceglie
// quella accesa, Esc vale MENU, un clic o un tocco sceglie la voce sotto il
// dito. Lo usano game over, finali e la TOP 10 dopo le iniziali. Qui solo
// geometria, riduttore e disegno; la transizione la decide la schermata.

import type { Actions } from '../types';
import type { InputDevice } from '../core/device';
import { inside, type Rect } from './rect';
import { drawTextOutlined } from './text';

export type RetryChoice = 'retry' | 'menu';

/** RETRY: grande, al centro in basso. Libero sia dal pulsante SHARE (in basso a sinistra) sia dalla mappa dei finali (in basso a destra). */
export const RETRY_RECT: Rect = { x: 380, y: 612, w: 340, h: 84 };
/** MENU: accanto, più piccolo, alto uguale (un tocco comodo anche su telefono). */
export const MENU_RECT: Rect = { x: 740, y: 612, w: 200, h: 84 };
/** CONTINUE, quando prima vengono le iniziali: al posto delle due voci. */
export const CONTINUE_RECT: Rect = { x: 470, y: 612, w: 340, h: 84 };
/** Dove comincia la fila dei pulsanti: le schermate tengono libero lo spazio da qui in giù. */
export const RETRY_ROW_TOP = RETRY_RECT.y;

/**
 * Per quanto la schermata ignora l'input appena aperta: chi in gara batte A
 * del gamepad (gas e conferma insieme) proprio mentre il tempo scade non
 * deve ripartire senza aver visto com'è andata.
 */
export const RETRY_INPUT_DELAY_S = 0.5;

export interface RetryMenuState {
  choice: RetryChoice;
  t: number;
  prevLeft: boolean;
  prevRight: boolean;
}

export function initialRetryMenu(): RetryMenuState {
  return { choice: 'retry', t: 0, prevLeft: false, prevRight: false };
}

/**
 * Riduttore del menu. `tap` è il tocco o il clic del tick (`signals.takeTap`,
 * qualunque puntatore): su una voce la sceglie, altrove non fa niente, e in
 * quel tick ENTER non conta (il clic del mouse arriva anche come `confirm`
 * su altre schermate, mai due volte qui). Pura.
 */
export function stepRetryMenu(
  state: RetryMenuState,
  dt: number,
  actions: Actions,
  tap: { x: number; y: number } | null = null,
): { state: RetryMenuState; chosen: RetryChoice | null } {
  const t = state.t + dt;
  const edgeLeft = actions.left && !state.prevLeft;
  const edgeRight = actions.right && !state.prevRight;
  const next: RetryMenuState = { choice: state.choice, t, prevLeft: actions.left, prevRight: actions.right };
  if (t < RETRY_INPUT_DELAY_S) return { state: next, chosen: null };
  if (tap !== null) {
    if (inside(RETRY_RECT, tap.x, tap.y)) return { state: { ...next, choice: 'retry' }, chosen: 'retry' };
    if (inside(MENU_RECT, tap.x, tap.y)) return { state: { ...next, choice: 'menu' }, chosen: 'menu' };
    return { state: next, chosen: null };
  }
  if (edgeLeft || edgeRight) next.choice = state.choice === 'retry' ? 'menu' : 'retry';
  if (actions.back) return { state: next, chosen: 'menu' };
  if (actions.confirm) return { state: next, chosen: next.choice };
  return { state: next, chosen: null };
}

/** CONTINUE è stato scelto? ENTER, o un tocco o un clic sul pulsante. Pura. */
export function continueChosen(actions: Actions, tap: { x: number; y: number } | null): boolean {
  if (tap !== null) return inside(CONTINUE_RECT, tap.x, tap.y);
  return actions.confirm;
}

/** Un pulsante del menu: fondo scuro, cornice, scritta al centro; acceso in giallo. */
export function drawMenuButton(ctx: CanvasRenderingContext2D, r: Rect, label: string, scale: number, lit: boolean): void {
  const before = ctx.globalAlpha;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = '#0a0e28';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.globalAlpha = before;
  ctx.fillStyle = lit ? '#ffee55' : 'rgba(255,255,255,0.75)';
  const t = lit ? 6 : 3;
  ctx.fillRect(r.x, r.y, r.w, t);
  ctx.fillRect(r.x, r.y + r.h - t, r.w, t);
  ctx.fillRect(r.x, r.y, t, r.h);
  ctx.fillRect(r.x + r.w - t, r.y, t, r.h);
  drawTextOutlined(ctx, label, r.x + r.w / 2, r.y + r.h / 2 - 4 * scale, scale, lit ? '#ffee55' : '#ffffff', 'center');
}

/** Le due voci. Col tocco non c'è una voce "accesa" da spostare: RETRY resta il pulsante grande. */
export function drawRetryMenu(ctx: CanvasRenderingContext2D, state: RetryMenuState, device: InputDevice = 'keyboard'): void {
  const retryLit = device === 'touch' || state.choice === 'retry';
  drawMenuButton(ctx, RETRY_RECT, 'RETRY', 5, retryLit);
  drawMenuButton(ctx, MENU_RECT, 'MENU', 3, device !== 'touch' && state.choice === 'menu');
}

/** CONTINUE, prima delle iniziali. */
export function drawContinueButton(ctx: CanvasRenderingContext2D): void {
  drawMenuButton(ctx, CONTINUE_RECT, 'CONTINUE', 4, true);
}

/** Il record personale: il punteggio migliore della TOP 10 locale (della modalità), 0 se è vuota. Pura. */
export function personalBest(entries: readonly { score: number }[]): number {
  return entries.reduce((best, e) => (Number.isFinite(e.score) && e.score > best ? e.score : best), 0);
}

/** Questo punteggio batte il record di prima? Un record a 0 (TOP 10 vuota) si batte con qualunque punto. Pura. */
export function isNewBest(score: number, best: number): boolean {
  return score > best;
}

/** La scritta del record a fine partita: `NEW BEST!` o `BEST <punteggio>`. Pura. */
export function bestLine(score: number, best: number): string {
  return isNewBest(score, best) ? 'NEW BEST!' : `BEST ${best}`;
}

/** Il puntatore del mouse è su uno dei pulsanti di fine partita (per la manina)? Pura. */
export function overEndButtons(p: { x: number; y: number }): boolean {
  return [RETRY_RECT, MENU_RECT, CONTINUE_RECT].some((r) => inside(r, p.x, p.y));
}
