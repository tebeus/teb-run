// Telefono in verticale (spec telefono e finali §A): il gioco resta
// orizzontale, ma chi arriva col telefono in verticale vede subito un gioco
// vero e l'invito a girarlo, invece del velo nero. Una tela a parte,
// `canvas#portrait`, a tutta finestra e sopra il gioco, con un suo spazio
// logico 9:16: visibile solo quando `wantsRotate` è vero (le regole di
// `rotate.ts` non cambiano), prende lei i tocchi e funziona prima, durante e
// dopo il caricamento. Il canvas del gioco non cambia.

import type { LoadProgress } from '../core/assets';
import { GAME_NAME } from '../core/config';
import type { SpriteAsset } from '../types';
import { drawText, drawTextOutlined } from './text';
import { drawDailyLine } from './dailyLine';

/** Spazio logico della tela verticale. */
export const PORTRAIT_W = 720;
export const PORTRAIT_H = 1280;

/** Altezza della fascia dell'illustrazione del titolo, dall'alto. */
export const PORTRAIT_ART_H = 760;
/** Secondi di un passaggio dell'illustrazione da un lato all'altro. */
export const PORTRAIT_PAN_S = 12;
/** Secondi di un giro del telefono disegnato: dritto, gira, sdraiato, torna. */
export const PHONE_CYCLE_S = 1.6;
/** Il telefono gira a scatti di questo angolo, come l'arte del gioco. */
export const PHONE_STEP_RAD = Math.PI / 12;

export const PORTRAIT_ROTATE_Y = 800;
export const PORTRAIT_DAILY_Y = 920;
export const PORTRAIT_BAR_Y = 1150;
export const PORTRAIT_BAR_W = 560;
export const PORTRAIT_BAR_H = 20;

/** Ciò che la tela mostra in un fotogramma. Ogni campo può mancare. */
export interface PortraitView {
  /** Secondi dall'inizio, per le animazioni. */
  t: number;
  /** L'avanzamento del caricamento, finché è in corso; null quando il titolo è pronto. */
  progress: LoadProgress | null;
  /** `screen_attract` e `title_logo`, se sono già arrivati. */
  attract: SpriteAsset | null;
  logo: SpriteAsset | null;
  /** La sfida di oggi (`SPORT · HARD`) e la riga della serie e del conto alla rovescia. */
  daily: { label: string; line: { streak: string | null; next: string } } | null;
}

/** Spostamento orizzontale dell'illustrazione, 0..`span`, avanti e indietro. Pura. */
export function panOffset(t: number, span: number): number {
  if (!(span > 0)) return 0;
  const phase = (((t / PORTRAIT_PAN_S) % 2) + 2) % 2;
  return Math.round(span * (phase <= 1 ? phase : 2 - phase));
}

/**
 * Angolo del telefono disegnato al tempo `t`: dritto per un quarto del
 * giro, gira di 90° in un terzo, sdraiato fino all'ultimo ottavo, poi torna.
 * A scatti di `PHONE_STEP_RAD`. Pura.
 */
export function phoneAngle(t: number): number {
  const u = (((t % PHONE_CYCLE_S) + PHONE_CYCLE_S) % PHONE_CYCLE_S) / PHONE_CYCLE_S;
  let a: number;
  if (u < 0.25) a = 0;
  else if (u < 0.58) a = ((u - 0.25) / 0.33) * (Math.PI / 2);
  else if (u < 0.875) a = Math.PI / 2;
  else a = (1 - (u - 0.875) / 0.125) * (Math.PI / 2);
  return Math.round(a / PHONE_STEP_RAD) * PHONE_STEP_RAD;
}

/** Il telefono: una cornice gialla 150x260 con lo schermo scuro, ruotata attorno al centro. */
function drawPhone(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number): void {
  const w = 150;
  const h = 260;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffee55';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#101018';
  ctx.fillRect(-w / 2 + 10, -h / 2 + 22, w - 20, h - 44);
  ctx.fillStyle = '#ffee55';
  ctx.fillRect(-12, h / 2 - 16, 24, 8);
  ctx.restore();
}

/** Un fotogramma della tela verticale, in coordinate logiche 720x1280. */
export function drawPortrait(ctx: CanvasRenderingContext2D, view: PortraitView): void {
  ctx.fillStyle = '#05050f';
  ctx.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H);
  const cx = PORTRAIT_W / 2;

  // L'illustrazione del titolo a tutta altezza della fascia, che scorre.
  const art = view.attract;
  if (art !== null && art.w > 0 && art.h > 0) {
    const k = PORTRAIT_ART_H / art.h;
    const w = art.w * k;
    ctx.drawImage(art.image, -panOffset(view.t, Math.max(0, w - PORTRAIT_W)), 0, w, PORTRAIT_ART_H);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, PORTRAIT_W, PORTRAIT_ART_H);
    ctx.globalAlpha = 1;
  }

  // Il logo, largo l'80%; finché non c'è, il nome nel font bitmap.
  const logo = view.logo;
  if (logo !== null && logo.w > 0 && logo.h > 0) {
    const k = Math.min((PORTRAIT_W * 0.8) / logo.w, 220 / logo.h);
    ctx.drawImage(logo.image, cx - (logo.w * k) / 2, 60, logo.w * k, logo.h * k);
  } else {
    drawTextOutlined(ctx, GAME_NAME, cx, 120, 8, '#ffee55', 'center');
  }

  drawPhone(ctx, cx, 520, phoneAngle(view.t));
  drawTextOutlined(ctx, 'ROTATE YOUR PHONE', cx, PORTRAIT_ROTATE_Y, 5, '#ffffff', 'center');

  if (view.daily !== null) {
    drawTextOutlined(ctx, 'DAILY CHALLENGE', cx, PORTRAIT_DAILY_Y, 4, '#ffee55', 'center');
    drawTextOutlined(ctx, `TODAY: ${view.daily.label}`, cx, PORTRAIT_DAILY_Y + 56, 3, '#cccccc', 'center');
    drawDailyLine(ctx, view.daily.line, cx, PORTRAIT_DAILY_Y + 108);
  }

  if (view.progress !== null) {
    const p = view.progress;
    const fraction = p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;
    const x = (PORTRAIT_W - PORTRAIT_BAR_W) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 4, PORTRAIT_BAR_Y - 4, PORTRAIT_BAR_W + 8, PORTRAIT_BAR_H + 8);
    ctx.fillStyle = '#101018';
    ctx.fillRect(x, PORTRAIT_BAR_Y, PORTRAIT_BAR_W, PORTRAIT_BAR_H);
    ctx.fillStyle = '#ff5a8c';
    ctx.fillRect(x, PORTRAIT_BAR_Y, Math.round(PORTRAIT_BAR_W * fraction), PORTRAIT_BAR_H);
    const total = Math.max(0, Math.floor(p.total));
    const done = Math.min(total, Math.max(0, Math.floor(p.done)));
    drawText(ctx, `LOADING ${done}/${total}`, cx, PORTRAIT_BAR_Y + PORTRAIT_BAR_H + 18, 2, '#e8e8e8', 'center');
  }
}

/** Il rettangolo CSS della tela 9:16 dentro una finestra `winW`x`winH`, centrata. Pura. */
export function portraitBox(winW: number, winH: number): { left: number; top: number; width: number; height: number } {
  const k = Math.min(winW / PORTRAIT_W, winH / PORTRAIT_H);
  const width = Math.round(PORTRAIT_W * k);
  const height = Math.round(PORTRAIT_H * k);
  return { left: Math.round((winW - width) / 2), top: Math.round((winH - height) / 2), width, height };
}

/** Dove vive la tela: l'elemento, la finestra e il prossimo fotogramma. */
export interface PortraitHost {
  canvas: Pick<HTMLCanvasElement, 'width' | 'height' | 'style' | 'getContext'>;
  win: Pick<Window, 'innerWidth' | 'innerHeight'>;
  raf: (cb: (now: number) => void) => number;
}

/**
 * Accende la tela: a ogni fotogramma, se `wanted()` è vero la mostra e la
 * disegna con `view(t)`, altrimenti la nasconde e non disegna niente.
 */
export function startPortrait(host: PortraitHost, wanted: () => boolean, view: (t: number) => PortraitView): void {
  const { canvas, win, raf } = host;
  canvas.width = PORTRAIT_W;
  canvas.height = PORTRAIT_H;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx === null) return;
  let start: number | null = null;
  let shown = false;
  const frame = (now: number): void => {
    start ??= now;
    const on = wanted();
    if (on !== shown) {
      canvas.style.display = on ? 'block' : 'none';
      shown = on;
    }
    if (on) {
      // A tutta finestra, col fondo scuro del CSS: il disegno 9:16 sta al
      // centro (`object-fit: contain`, grande come `portraitBox`), e ai lati
      // non si vede più il gioco sotto (collaudo di Teb su iPhone 13).
      canvas.style.left = '0px';
      canvas.style.top = '0px';
      canvas.style.width = `${win.innerWidth}px`;
      canvas.style.height = `${win.innerHeight}px`;
      drawPortrait(ctx, view((now - start) / 1000));
    }
    raf(frame);
  };
  raf(frame);
}
