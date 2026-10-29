// L'aiuto marcia (spec prima tappa e ritorno §3.2, risposta 4 di Teb): chi
// non sa del cambio resta in `lo` e non arriva. Quando si è in `lo` vicino
// alla velocità massima di `lo` per circa 2 s, una riga dice quale tasto
// mette la marcia alta. Solo testo: nessuna regola cambia.
//
// - in tutte le tappe di NORMAL, mai in HARD;
// - sparisce appena si cambia;
// - dopo il primo cambio della sessione (la pagina aperta) non torna più.

import { LOGICAL_W } from '../core/canvas';
import type { InputDevice } from '../core/device';
import { modeOf } from '../game/mode';
import { MAX_SPEED_LO } from '../game/player';
import type { RaceSnapshot } from '../types';
import { drawTextOutlined, measureText } from './text';

/** Frazione di `MAX_SPEED_LO` sopra la quale si è "al massimo della bassa". */
export const GEAR_HINT_PERCENT = 0.95;
/** Secondi al massimo della bassa prima che l'aiuto appaia. */
export const GEAR_HINT_HOLD_S = 2;
/** Riga dell'aiuto: nel cielo, sotto i banner del bivio, sopra l'orizzonte. */
export const GEAR_HINT_Y = 226;
export const GEAR_HINT_SCALE = 3;

export interface GearHintState {
  /** Secondi di fila in `lo` al massimo della bassa. */
  held: number;
  /** Il giocatore ha già messo la marcia alta in questa sessione. */
  shifted: boolean;
}

export function initialGearHint(): GearHintState {
  return { held: 0, shifted: false };
}

/**
 * Lo stato dopo un tick di gara visto in `snapshot`. La marcia alta, anche
 * per un tick e anche in HARD, vale come "ha imparato" per sempre. Pura.
 */
export function stepGearHint(state: GearHintState, snapshot: RaceSnapshot, dt: number): GearHintState {
  if (state.shifted) return state;
  const { gear, speed } = snapshot.player;
  if (gear === 'hi') return { held: 0, shifted: true };
  const atTop = speed >= MAX_SPEED_LO * GEAR_HINT_PERCENT;
  return { held: atTop ? state.held + dt : 0, shifted: false };
}

/** L'aiuto si vede? Solo in NORMAL, in `lo`, dopo `GEAR_HINT_HOLD_S`, fuori da checkpoint e game over. Pura. */
export function gearHintVisible(state: GearHintState, snapshot: RaceSnapshot): boolean {
  if (state.shifted || snapshot.player.gear !== 'lo') return false;
  if (modeOf(snapshot.stage) !== 'normal') return false;
  if (snapshot.banner === 'checkpoint' || snapshot.banner === 'gameover') return false;
  return state.held >= GEAR_HINT_HOLD_S;
}

/** Il testo secondo il dispositivo dell'ultimo input. Pura. */
export function gearHintText(device: InputDevice): string {
  if (device === 'pad') return 'Y FOR HIGH GEAR';
  if (device === 'touch') return 'TAP GEAR FOR HIGH GEAR';
  return 'SHIFT FOR HIGH GEAR';
}

/** La riga, gialla su una fascia scura come la riga dell'obiettivo. */
export function drawGearHint(ctx: CanvasRenderingContext2D, device: InputDevice): void {
  const text = gearHintText(device);
  const w = measureText(text, GEAR_HINT_SCALE) + 32;
  const before = ctx.globalAlpha;
  ctx.globalAlpha = before * 0.6;
  ctx.fillStyle = '#101018';
  ctx.fillRect(LOGICAL_W / 2 - w / 2, GEAR_HINT_Y - 8, w, 8 * GEAR_HINT_SCALE + 16);
  ctx.globalAlpha = before;
  drawTextOutlined(ctx, text, LOGICAL_W / 2, GEAR_HINT_Y, GEAR_HINT_SCALE, '#ffee55', 'center');
}
