// Comandi a schermo (lancio, punto 7): la riga dei comandi della radio e il
// suggerimento dei primi secondi della prima gara. Solo testi e disegno,
// nel font bitmap del gioco; il dispositivo in uso lo dice `core/device`.

import { LOGICAL_W } from '../core/canvas';
import type { InputDevice } from '../core/device';
import { drawTextOutlined, measureText } from './text';

/** Comandi di guida, uno per dispositivo, come li scrive la radio. */
export const DRIVE_LINES: Readonly<Record<InputDevice, string>> = {
  keyboard: 'KEYS: UP GAS  DOWN BRAKE  LEFT RIGHT STEER  SHIFT GEAR  P PAUSE',
  pad: 'PAD: RT GAS  LT BRAKE  STICK STEER  Y GEAR  START PAUSE',
  touch: 'TOUCH: < > STEER   GAS BRAKE GEAR   II PAUSE',
};

/** La riga del tocco con TILT acceso: sterza il telefono, le frecce non ci sono. */
export const DRIVE_LINE_TOUCH_TILT = 'TOUCH: TILT TO STEER   GAS BRAKE GEAR   II PAUSE';

/**
 * Le righe dei comandi della radio: prima quella del dispositivo in uso,
 * poi l'altra fra tastiera e gamepad. Su un telefono basta la riga del
 * tocco. Pura.
 */
export function radioControlLines(device: InputDevice): string[] {
  if (device === 'touch') return [DRIVE_LINES.touch];
  if (device === 'pad') return [DRIVE_LINES.pad, DRIVE_LINES.keyboard];
  return [DRIVE_LINES.keyboard, DRIVE_LINES.pad];
}

/** La riga della radio sotto l'elenco, per scegliere il brano e partire. Pura. */
export function radioMenuLine(device: InputDevice): string {
  if (device === 'touch') return 'TAP < > TO CHOOSE, START TO GO';
  if (device === 'pad') return 'LEFT RIGHT TO CHOOSE, A TO START';
  return 'LEFT RIGHT TO CHOOSE, ENTER TO START';
}

/** La scritta sotto l'auto e sotto la modalità, sulla radio. Pura. */
export function radioChangeLine(device: InputDevice, key: 'C' | 'D'): string {
  if (device === 'touch') return 'TAP TO CHANGE';
  if (device === 'pad') return key === 'C' ? 'Y TO CHANGE' : 'D KEY TO CHANGE';
  return `${key} TO CHANGE`;
}

/** Quota delle righe dei comandi della radio, sopra il titolo (che sta a 78). */
export const RADIO_CONTROLS_Y = 14;
export const RADIO_CONTROLS_STEP = 26;

/** Le righe dei comandi della radio, centrate in alto. */
export function drawRadioControls(ctx: CanvasRenderingContext2D, device: InputDevice): void {
  radioControlLines(device).forEach((line, i) => {
    drawTextOutlined(ctx, line, LOGICAL_W / 2, RADIO_CONTROLS_Y + i * RADIO_CONTROLS_STEP, 2, i === 0 ? '#ffffff' : '#e8e8e8', 'center');
  });
}

/** Il suggerimento di inizio gara: due righe, scelte dal dispositivo (e, col tocco, da TILT). Pura. */
export function raceHintLines(device: InputDevice, tiltOn = false): [string, string] {
  if (device === 'touch' && tiltOn) return ['HOLD GAS   TILT THE PHONE TO STEER', 'BRAKE   GEAR   II PAUSE'];
  if (device === 'touch') return ['HOLD GAS   < > TO STEER', 'BRAKE   GEAR   II PAUSE'];
  if (device === 'pad') return ['RT GAS   LT BRAKE   STICK STEER', 'Y GEAR   START PAUSE'];
  return ['UP GAS   DOWN BRAKE   LEFT RIGHT STEER', 'SHIFT GEAR   ESC OR P PAUSE   M MUTE'];
}

/** Per quanti secondi di gara (semaforo compreso) resta il suggerimento. */
export const RACE_HINT_SECONDS = 8;
/** Entrata e uscita in dissolvenza, in secondi. */
export const RACE_HINT_FADE_IN = 0.3;
export const RACE_HINT_FADE_OUT = 1;

/** Opacità del suggerimento dopo `t` secondi di gara: 0 prima e dopo. Pura. */
export function raceHintAlpha(t: number): number {
  if (!(t >= 0) || t >= RACE_HINT_SECONDS) return 0;
  const fadeIn = Math.min(1, t / RACE_HINT_FADE_IN);
  const fadeOut = Math.min(1, (RACE_HINT_SECONDS - t) / RACE_HINT_FADE_OUT);
  return Math.min(fadeIn, fadeOut);
}

/** Quota della prima riga del suggerimento: fra il portale di partenza e l'auto. */
export const RACE_HINT_Y = 404;

/** Il suggerimento su una fascia scura, discreto, a opacità `alpha`. */
export function drawRaceHint(ctx: CanvasRenderingContext2D, device: InputDevice, alpha: number, tiltOn = false): void {
  if (!(alpha > 0)) return;
  const lines = raceHintLines(device, tiltOn);
  const w = Math.max(...lines.map((line) => measureText(line, 2))) + 48;
  // Niente save/restore: basta rimettere l'opacità com'era.
  const before = ctx.globalAlpha;
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = '#101018';
  ctx.fillRect(LOGICAL_W / 2 - w / 2, RACE_HINT_Y - 12, w, 16 * 2 + 10 + 24);
  ctx.globalAlpha = alpha;
  drawTextOutlined(ctx, lines[0], LOGICAL_W / 2, RACE_HINT_Y, 2, '#ffffff', 'center');
  drawTextOutlined(ctx, lines[1], LOGICAL_W / 2, RACE_HINT_Y + 26, 2, '#ffee55', 'center');
  ctx.globalAlpha = before;
}
