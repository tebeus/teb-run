// Scheda del risultato da condividere (lancio, punto 10): un PNG 1200x630
// disegnato su un canvas a parte, con il font bitmap e la mappa dei bivi del
// gioco. Niente rete: tutto nasce qui, dagli sprite già caricati.

import { GAME_NAME, SITE_DOMAIN, SITE_URL } from '../core/config';
import { carLabel } from '../game/car';
import { ENDING_COUNT, clampEndingIndex } from '../game/endings';
import { formatLap, formatScore } from '../render/hud';
import {
  ROUTE_LEVELS,
  drawMapBackdrop,
  drawRouteMapLarge,
  visitedStages,
  type MapRect,
} from '../render/routeMap';
import type { AssetStore, CarChoice, Difficulty } from '../types';
import { drawTextOutlined } from './text';

/** Misure della scheda: il formato delle anteprime dei social (1,91:1). */
export const CARD_W = 1200;
export const CARD_H = 630;

/** Il risultato di una partita, quanto basta alla scheda e al testo breve. */
export interface ShareResult {
  /** `ending` a fine giro, `gameOver` se è finito il tempo. */
  kind: 'ending' | 'gameOver';
  score: number;
  /** Secondi di gara, dall'inizio della partita. */
  time: number;
  mode: Difficulty;
  car: CarChoice;
  route: readonly ('L' | 'R')[];
  /** Id `l-i` della tappa in cui è finita la partita. */
  stageId: string;
  stageName: string;
  /** Indice del finale 0..4 (solo `ending`). */
  ending?: number;
}

/** Tappa raggiunta, 1..5, dall'id `l-i`; 1 se l'id non è del grafo. Pura. */
export function stageNumber(stageId: string): number {
  const m = /^(\d)-\d$/.exec(stageId);
  const level = m ? Number(m[1]) : 0;
  return Math.min(ROUTE_LEVELS, level + 1);
}

/** «ENDING 3 OF 5» a fine giro, «STAGE 2 OF 5» al game over. Pura. */
export function resultHeadline(r: ShareResult): string {
  if (r.kind === 'ending') return `ENDING ${clampEndingIndex(r.ending ?? 0) + 1} OF ${ENDING_COUNT}`;
  return `STAGE ${stageNumber(r.stageId)} OF ${ROUTE_LEVELS}`;
}

/** Le righe della scheda, nell'ordine in cui compaiono. Pura. */
export interface CardContent {
  name: string;
  outcome: string;
  headline: string;
  stage: string;
  score: string;
  time: string;
  mode: string;
  car: string;
  site: string;
}

export function shareCardContent(r: ShareResult): CardContent {
  return {
    name: GAME_NAME,
    outcome: r.kind === 'ending' ? 'GOAL!' : 'GAME OVER',
    headline: resultHeadline(r),
    stage: r.stageName.toUpperCase(),
    score: `SCORE ${formatScore(r.score)}`,
    time: `TIME ${formatLap(r.time)}`,
    mode: r.mode.toUpperCase(),
    car: carLabel(r.car),
    site: SITE_DOMAIN.toUpperCase(),
  };
}

/** Il testo breve che accompagna la scheda (appunti, o il foglio di condivisione). Pura. */
export function shareText(r: ShareResult): string {
  const score = Math.max(0, Math.floor(r.score));
  return `${GAME_NAME}: ${score} points, ${resultHeadline(r)}, ${r.mode.toUpperCase()}, ${formatLap(r.time)}. ${SITE_URL}`;
}

/** Nome del file scaricato: il nome del gioco senza spazi e il punteggio. Pura. */
export function shareFileName(r: ShareResult): string {
  const slug = GAME_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${Math.max(0, Math.floor(r.score))}.png`;
}

/** Dove sta la mappa dei bivi nella scheda. */
export const CARD_MAP: MapRect = { x: 640, y: 64, w: 500, h: 440 };
const CARD_BG_TOP = '#1a0f3a';
const CARD_BG_BOTTOM = '#0a2a52';
const CARD_FRAME = '#ff3399';

/**
 * Disegna la scheda su un contesto `CARD_W`x`CARD_H`: a sinistra nome,
 * esito, punteggio, tempo, modalità e auto; a destra la mappa delle 15
 * tappe con il percorso acceso (lo stesso disegno del game over); in basso
 * l'indirizzo del sito.
 */
export function drawShareCard(ctx: CanvasRenderingContext2D, r: ShareResult, assets: AssetStore): void {
  const c = shareCardContent(r);
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  grad.addColorStop(0, CARD_BG_TOP);
  grad.addColorStop(1, CARD_BG_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Cornice al neon, come le schede dei cabinati.
  ctx.fillStyle = CARD_FRAME;
  ctx.fillRect(12, 12, CARD_W - 24, 6);
  ctx.fillRect(12, CARD_H - 18, CARD_W - 24, 6);
  ctx.fillRect(12, 12, 6, CARD_H - 24);
  ctx.fillRect(CARD_W - 18, 12, 6, CARD_H - 24);

  // La mappa dei bivi, sopra l'illustrazione velata.
  drawMapBackdrop(ctx, assets, CARD_MAP, CARD_BG_BOTTOM, 'rgba(6,8,22,0.55)');
  ctx.lineCap = 'round';
  const inner = { x: CARD_MAP.x + 10, y: CARD_MAP.y + 10, w: CARD_MAP.w - 20, h: CARD_MAP.h - 20 };
  drawRouteMapLarge(ctx, inner, visitedStages(r.route), r.stageId, true);
  drawTextOutlined(ctx, c.stage, CARD_MAP.x + CARD_MAP.w / 2, CARD_MAP.y + CARD_MAP.h + 18, 3, '#ffffff', 'center');

  const x = 60;
  drawTextOutlined(ctx, c.name, x, 56, 9, '#ffd23f');
  drawTextOutlined(ctx, c.outcome, x, 160, 4, r.kind === 'ending' ? '#ffee55' : '#ff3333');
  drawTextOutlined(ctx, c.headline, x, 210, 5, '#ffffff');
  drawTextOutlined(ctx, c.score, x, 300, 4, '#ffee55');
  drawTextOutlined(ctx, c.time, x, 352, 4, '#ffffff');
  drawTextOutlined(ctx, c.mode, x, 420, 3, r.mode === 'hard' ? '#ff5555' : '#66ddff');
  drawTextOutlined(ctx, c.car, x, 460, 3, '#ffffff');
  drawTextOutlined(ctx, c.site, x, 548, 4, '#66ddff');
  ctx.restore();
}

/** Il documento come lo usa la scheda: solo per creare il canvas a parte. */
export interface CardDoc {
  createElement(tag: 'canvas'): HTMLCanvasElement;
}

/**
 * Crea la scheda su un canvas nuovo, fuori dalla pagina, e la rende PNG.
 * Null se il browser non dà un contesto 2D o non sa fare il PNG.
 */
export function renderShareCard(doc: CardDoc, r: ShareResult, assets: AssetStore): Promise<Blob | null> {
  const canvas = doc.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return Promise.resolve(null);
  ctx.imageSmoothingEnabled = false;
  drawShareCard(ctx, r, assets);
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}
