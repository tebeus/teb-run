import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import type { LogicalPoint } from '../core/signals';
import type { InputDevice } from '../core/device';
import type { Actions } from '../types';
import { drawTextOutlined } from './text';

/**
 * Menu di pausa della gara (lancio, punto 5). Qui solo la parte pura:
 * stato, riduttore, geometria dei pulsanti e disegno. Chi ferma il motore e
 * l'audio è `screens/race.ts`.
 */
export type PauseChoice = 'continue' | 'restart' | 'title';

export const PAUSE_ITEMS: readonly PauseChoice[] = ['continue', 'restart', 'title'];

export const PAUSE_LABELS: Readonly<Record<PauseChoice, string>> = {
  continue: 'CONTINUE',
  restart: 'RESTART',
  title: 'TITLE',
};

export interface PauseState {
  open: boolean;
  selected: number;
  /** Su e Giù del tick prima: il cursore si muove sul fronte, non a tasto tenuto. */
  prevUp: boolean;
  prevDown: boolean;
}

export function closedPause(): PauseState {
  return { open: false, selected: 0, prevUp: false, prevDown: false };
}

/**
 * Apre il menu su CONTINUE. Su e Giù già tenuti (il gas tenuto in gara è
 * Su) contano come "già premuti": il cursore non scappa da solo. Pura.
 */
export function openPause(actions: Actions): PauseState {
  return { open: true, selected: 0, prevUp: actions.accelerate, prevDown: actions.brake };
}

/** Esc (back), P e Start (pause) aprono la pausa in gara e la richiudono. Pura. */
export function wantsPause(actions: Actions): boolean {
  return actions.back || actions.pause === true;
}

/** Pulsanti del menu, in coordinate logiche: ben oltre i 44x44 px richiesti per il tocco. */
export const PAUSE_BUTTON_W = 400;
export const PAUSE_BUTTON_H = 72;
export const PAUSE_BUTTON_GAP = 20;
export const PAUSE_FIRST_Y = 290;
export const PAUSE_TITLE_Y = 170;

export interface PauseButton {
  choice: PauseChoice;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Riquadri dei tre pulsanti, uno sotto l'altro, centrati. Pura. */
export function pauseButtons(): PauseButton[] {
  return PAUSE_ITEMS.map((choice, i) => ({
    choice,
    x: LOGICAL_W / 2 - PAUSE_BUTTON_W / 2,
    y: PAUSE_FIRST_Y + i * (PAUSE_BUTTON_H + PAUSE_BUTTON_GAP),
    w: PAUSE_BUTTON_W,
    h: PAUSE_BUTTON_H,
  }));
}

/** Il pulsante sotto un punto logico, o null. Pura. */
export function pauseHit(p: LogicalPoint): PauseChoice | null {
  for (const b of pauseButtons()) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b.choice;
  }
  return null;
}

/**
 * Un tick del menu aperto. Esc, P o Start richiudono (CONTINUE); Su e Giù
 * (frecce, d-pad) muovono il cursore; Invio o A scelgono la voce; un tocco
 * o un clic su un pulsante lo sceglie subito. Pura.
 */
export function stepPause(
  state: PauseState,
  actions: Actions,
  tap: LogicalPoint | null = null,
): { state: PauseState; choice: PauseChoice | null } {
  const up = actions.accelerate;
  const down = actions.brake;
  let selected = state.selected;
  if (up && !state.prevUp) selected = (selected + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length;
  else if (down && !state.prevDown) selected = (selected + 1) % PAUSE_ITEMS.length;
  const next: PauseState = { open: true, selected, prevUp: up, prevDown: down };

  if (wantsPause(actions)) return { state: next, choice: 'continue' };
  const hit = tap === null ? null : pauseHit(tap);
  if (hit !== null) return { state: { ...next, selected: PAUSE_ITEMS.indexOf(hit) }, choice: hit };
  if (actions.confirm) return { state: next, choice: PAUSE_ITEMS[selected] };
  return { state: next, choice: null };
}

export const PAUSE_VEIL = 'rgba(6,8,22,0.62)';

/** Velo, scritta PAUSED, tre pulsanti e la riga dei comandi, sopra la gara ferma. */
/** La riga dei comandi sotto il menu, per il dispositivo in uso. Pura. */
export function pauseHintLine(device: InputDevice = 'keyboard'): string {
  if (device === 'touch') return 'TAP A BUTTON   II TO RESUME';
  if (device === 'pad') return 'UP/DOWN + A   START TO RESUME';
  return 'UP/DOWN + ENTER   ESC/P TO RESUME';
}

export function drawPause(ctx: CanvasRenderingContext2D, state: PauseState, device: InputDevice = 'keyboard'): void {
  ctx.save();
  ctx.fillStyle = PAUSE_VEIL;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  drawTextOutlined(ctx, 'PAUSED', LOGICAL_W / 2, PAUSE_TITLE_Y, 8, '#ffffff', 'center');
  for (const [i, b] of pauseButtons().entries()) {
    const on = i === state.selected;
    ctx.fillStyle = on ? 'rgba(255,238,85,0.22)' : 'rgba(16,16,40,0.78)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Il bordo con quattro fillRect: pixel netti come il font bitmap.
    const t = on ? 4 : 2;
    ctx.fillStyle = on ? '#ffee55' : '#8888aa';
    ctx.fillRect(b.x, b.y, b.w, t);
    ctx.fillRect(b.x, b.y + b.h - t, b.w, t);
    ctx.fillRect(b.x, b.y, t, b.h);
    ctx.fillRect(b.x + b.w - t, b.y, t, b.h);
    const label = on ? `> ${PAUSE_LABELS[b.choice]} <` : PAUSE_LABELS[b.choice];
    drawTextOutlined(ctx, label, LOGICAL_W / 2, b.y + (b.h - 32) / 2, 4, on ? '#ffee55' : '#ffffff', 'center');
  }
  const hintY = PAUSE_FIRST_Y + PAUSE_ITEMS.length * (PAUSE_BUTTON_H + PAUSE_BUTTON_GAP) + 24;
  drawTextOutlined(ctx, pauseHintLine(device), LOGICAL_W / 2, hintY, 2, '#ccccdd', 'center');
  ctx.restore();
}
