// Schermata di caricamento: viene prima del titolo, mentre arrivano gli
// sprite. Il nome del gioco (il logo, se è già arrivato; altrimenti il font
// bitmap, che non deve caricare niente) e una barra con i passi fatti sui
// totali. Nessuna libreria: disegno su canvas e requestAnimationFrame.

import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import { GAME_NAME } from '../core/config';
import type { LoadProgress } from '../core/assets';
import type { SpriteAsset } from '../types';
import { drawText, drawTextOutlined } from './text';

/** Geometria della barra, in pixel logici. */
export const LOADING_BAR_W = 640;
export const LOADING_BAR_H = 24;
export const LOADING_BAR_Y = 460;
/** Alto del nome (o del logo) del gioco. */
export const LOADING_NAME_Y = 200;

/** Frazione fatta, fra 0 e 1, anche con numeri strani. Pura. */
export function loadingFraction(p: LoadProgress): number {
  if (!(p.total > 0) || !(p.done > 0)) return 0;
  return Math.min(1, p.done / p.total);
}

/** Scritta sotto la barra: `LOADING 12/150`. Pura. */
export function loadingLabel(p: LoadProgress): string {
  const total = Math.max(0, Math.floor(p.total));
  const done = Math.min(total, Math.max(0, Math.floor(p.done)));
  return `LOADING ${done}/${total}`;
}

/** Un fotogramma della schermata di caricamento. `logo` null: il nome nel font bitmap. */
export function drawLoadingScreen(ctx: CanvasRenderingContext2D, p: LoadProgress, logo: SpriteAsset | null): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  if (logo !== null && logo.w > 0 && logo.h > 0) {
    // Il logo sta sopra la barra: se è più alto dello spazio, si riduce.
    const room = LOADING_BAR_Y - 100;
    const k = Math.min(1, room / logo.h, (LOGICAL_W - 80) / logo.w);
    const w = logo.w * k;
    const h = logo.h * k;
    ctx.drawImage(logo.image, LOGICAL_W / 2 - w / 2, LOADING_BAR_Y - 40 - h, w, h);
  } else {
    drawTextOutlined(ctx, GAME_NAME, LOGICAL_W / 2, LOADING_NAME_Y, 8, '#ffee55', 'center');
  }
  const x = (LOGICAL_W - LOADING_BAR_W) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 4, LOADING_BAR_Y - 4, LOADING_BAR_W + 8, LOADING_BAR_H + 8);
  ctx.fillStyle = '#101018';
  ctx.fillRect(x, LOADING_BAR_Y, LOADING_BAR_W, LOADING_BAR_H);
  ctx.fillStyle = '#ff5a8c';
  ctx.fillRect(x, LOADING_BAR_Y, Math.round(LOADING_BAR_W * loadingFraction(p)), LOADING_BAR_H);
  drawText(ctx, loadingLabel(p), LOGICAL_W / 2, LOADING_BAR_Y + LOADING_BAR_H + 20, 2, '#e8e8e8', 'center');
}

/** Quanto serve alla schermata di caricamento dello store degli sprite. */
export interface LoadingSource {
  progress(): LoadProgress;
  isLoaded(name: 'title_logo'): boolean;
  get(name: 'title_logo'): SpriteAsset;
}

/**
 * Disegna la schermata subito (primo fotogramma sincrono, senza aspettare
 * requestAnimationFrame) e poi a ogni fotogramma, finché non si chiama la
 * funzione ritornata.
 */
export function startLoadingScreen(
  ctx: CanvasRenderingContext2D,
  source: LoadingSource,
  raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
): () => void {
  let stopped = false;
  let id = 0;
  const frame = (): void => {
    if (stopped) return;
    drawLoadingScreen(ctx, source.progress(), source.isLoaded('title_logo') ? source.get('title_logo') : null);
    id = raf(frame);
  };
  frame();
  return () => {
    stopped = true;
    cancel(id);
  };
}
