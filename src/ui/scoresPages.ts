// Le pagine della classifica (spec classifica e sfida, §2.7): LOCAL (la TOP
// 10 di sempre, sul dispositivo) e, dove c'è la classifica mondiale, TODAY,
// ALL TIME e DAILY. Le pagine mondiali compaiono solo quando i loro dati
// sono arrivati: offline si vede solo LOCAL, senza messaggi. Si cambia
// pagina con su e giù (tastiera, croce del gamepad: sinistra e destra
// restano a RETRY e MENU) o con un clic o un tocco sulle linguette.

import { inside, type Rect } from './rect';
import { drawMenuButton } from './retryMenu';

export type ScoresPage = 'local' | 'today' | 'alltime' | 'daily';
export const SCORES_PAGES: readonly ScoresPage[] = ['local', 'today', 'alltime', 'daily'];

export const PAGE_LABELS: Readonly<Record<ScoresPage, string>> = { local: 'LOCAL', today: 'TODAY', alltime: 'ALL TIME', daily: 'DAILY' };

const TAB_W = 220;
const TAB_H = 56;
const TAB_GAP = 16;
export const TAB_Y = 12;

/** Le linguette delle pagine `pages`, centrate in alto. Pura. */
export function tabRects(pages: readonly ScoresPage[]): { page: ScoresPage; rect: Rect }[] {
  const w = pages.length * TAB_W + (pages.length - 1) * TAB_GAP;
  const x0 = (1280 - w) / 2;
  return pages.map((page, i) => ({ page, rect: { x: x0 + i * (TAB_W + TAB_GAP), y: TAB_Y, w: TAB_W, h: TAB_H } }));
}

/** La pagina sotto un punto, o null. Pura. */
export function tabAt(pages: readonly ScoresPage[], p: { x: number; y: number }): ScoresPage | null {
  return tabRects(pages).find((t) => inside(t.rect, p.x, p.y))?.page ?? null;
}

/** La pagina dopo (o prima, `dir` -1) nel giro di quelle disponibili. Pura. */
export function cyclePage(pages: readonly ScoresPage[], page: ScoresPage, dir: 1 | -1): ScoresPage {
  const i = Math.max(0, pages.indexOf(page));
  return pages[(i + dir + pages.length) % pages.length];
}

export function drawTabs(ctx: CanvasRenderingContext2D, pages: readonly ScoresPage[], current: ScoresPage): void {
  if (pages.length < 2) return;
  for (const { page, rect } of tabRects(pages)) drawMenuButton(ctx, rect, PAGE_LABELS[page], 2, page === current);
}
