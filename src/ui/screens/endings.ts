// La pagina ENDINGS (spec telefono e finali §C): i cinque finali, quelli già
// visti con il nome e un'immagine piccola, gli altri col lucchetto e `???`,
// e `2 / 5`. Una seconda vista mostra la mappa dei bivi con le tappe già
// raggiunte accese (la stessa del titolo, a tutto schermo: su un telefono
// rimpicciolita non si leggerebbe). Ci si arriva dal titolo e dalla TOP 10;
// BACK torna al titolo.
//
// Tastiera e pad: sinistra e destra cambiano vista, ESC (Select), ENTER (A)
// tornano al titolo. Mouse e tocco: i pulsanti MAP/ENDINGS e BACK.

import { stagedOf } from '../../core/assets';
import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { DEFAULT_CAR, endingSpriteFor } from '../../game/car';
import { ENDING_COUNT, ENDINGS as ENDING_DEFS, endingSprite } from '../../game/endings';
import { FIRST_STAGE_ID } from '../../game/stages';
import type { EndingsRecord } from '../../persist/endings';
import { drawRouteMapPanel } from '../../render/routeMap';
import type { Actions } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type Transition } from '../fsm';
import { ENDINGS_BACK_RECT, ENDINGS_VIEW_RECT } from '../endingsLayout';
import { inside, type Rect } from '../rect';
import { drawMenuButton } from '../retryMenu';
import { drawText, drawTextOutlined } from '../text';

export { ENDINGS_BACK_RECT, ENDINGS_VIEW_RECT };
/** Le cinque carte: 220x300, 20 px fra l'una e l'altra, centrate. */
export const CARD_W = 220;
export const CARD_H = 300;
export const CARD_GAP = 20;
export const CARD_Y = 200;
/** L'immagine dentro la carta. */
export const CARD_IMAGE_H = 180;

export type EndingsView = 'endings' | 'map';

export interface EndingsState {
  view: EndingsView;
  prevLeft: boolean;
  prevRight: boolean;
}

export function initialEndingsState(): EndingsState {
  // Fronti già "tenuti": il tasto che ha aperto la pagina non cambia vista.
  return { view: 'endings', prevLeft: true, prevRight: true };
}

/** Il riquadro della carta `i` (0..4). Pura. */
export function cardRect(i: number): Rect {
  const total = ENDING_COUNT * CARD_W + (ENDING_COUNT - 1) * CARD_GAP;
  return { x: (LOGICAL_W - total) / 2 + i * (CARD_W + CARD_GAP), y: CARD_Y, w: CARD_W, h: CARD_H };
}

/** `2 / 5`. Pura. */
export function endingsCount(seen: number): string {
  return `${seen} / ${ENDING_COUNT}`;
}

/**
 * Riduttore puro: sinistra e destra (fronte), o MAP/ENDINGS, cambiano vista;
 * BACK, ESC o ENTER tornano al titolo. `tap` è un tocco o un clic.
 */
export function stepEndings(
  state: EndingsState,
  actions: Actions,
  tap: { x: number; y: number } | null,
): { state: EndingsState; transition: Transition | null } {
  const edges = { prevLeft: actions.left, prevRight: actions.right };
  if (actions.back || actions.confirm || (tap !== null && inside(ENDINGS_BACK_RECT, tap.x, tap.y))) {
    return { state: { ...state, ...edges }, transition: go('title', undefined) };
  }
  const turn =
    (actions.left && !state.prevLeft) || (actions.right && !state.prevRight) || (tap !== null && inside(ENDINGS_VIEW_RECT, tap.x, tap.y));
  const view: EndingsView = turn ? (state.view === 'endings' ? 'map' : 'endings') : state.view;
  return { state: { view, ...edges }, transition: null };
}

/** Il lucchetto, disegnato: arco e corpo, centrato in (cx, cy). */
function drawLock(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.fillStyle = '#888899';
  ctx.fillRect(cx - 26, cy - 46, 10, 40);
  ctx.fillRect(cx + 16, cy - 46, 10, 40);
  ctx.fillRect(cx - 26, cy - 56, 52, 10);
  ctx.fillStyle = '#ffcc33';
  ctx.fillRect(cx - 40, cy - 8, 80, 60);
  ctx.fillStyle = '#101028';
  ctx.fillRect(cx - 6, cy + 10, 12, 22);
}

/** Una carta: con l'immagine e il nome se il finale è stato visto, col lucchetto e `???` se no. */
function drawCard(ctx: CanvasRenderingContext2D, deps: ScreenDeps, i: number, seen: boolean): void {
  const r = cardRect(i);
  drawMenuButton(ctx, r, '', 1, false);
  const pad = 10;
  const area = { x: r.x + pad, y: r.y + pad, w: r.w - 2 * pad, h: CARD_IMAGE_H };
  if (seen) {
    const key = endingSpriteFor(deps.car?.get() ?? DEFAULT_CAR, endingSprite(i), (n) => deps.assets.has(n));
    // L'immagine è della fase 2: aprendo la pagina passa in testa; finché
    // manca, la cornice resta vuota (mai il ripiego procedurale).
    const ready = stagedOf(deps.assets)?.requestFile?.(key) ?? true;
    if (ready && deps.assets.has(key)) {
      const a = deps.assets.get(key);
      if (a.w > 0 && a.h > 0) {
        const k = Math.max(area.w / a.w, area.h / a.h);
        const w = a.w * k;
        const h = a.h * k;
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.x, area.y, area.w, area.h);
        ctx.clip();
        ctx.drawImage(a.image, area.x + (area.w - w) / 2, area.y + (area.h - h) / 2, w, h);
        ctx.restore();
      }
    }
    // Il nome su due righe al più, una parola per riga: `GOLDEN` `SHORELINE`.
    const words = ENDING_DEFS[i].title.split(' ');
    const lines = words.length <= 1 ? words : [words[0], words.slice(1).join(' ')];
    lines.forEach((line, j) => drawText(ctx, line, r.x + r.w / 2, area.y + area.h + 24 + j * 28, 2, '#ffee55', 'center'));
  } else {
    ctx.fillStyle = '#05050f';
    ctx.fillRect(area.x, area.y, area.w, area.h);
    drawLock(ctx, r.x + r.w / 2, area.y + area.h / 2);
    drawText(ctx, '???', r.x + r.w / 2, area.y + area.h + 30, 3, '#888899', 'center');
  }
}

export function createEndingsScreen(deps: ScreenDeps): Screen {
  let state = initialEndingsState();
  let record: EndingsRecord = { seen: [], stages: [], migrated: false };

  return {
    enter() {
      state = initialEndingsState();
      record = deps.endings?.load() ?? record;
      deps.signals?.takeTap();
      // Le immagini dei finali visti e la mappa passano in testa al background.
      const staged = stagedOf(deps.assets);
      for (const n of record.seen) staged?.requestFile?.(`ending_${n}`);
      staged?.requestFile?.('map_full');
    },
    update(_dt, actions) {
      const tap = deps.signals?.takeTap() ?? actions.click ?? null;
      const r = stepEndings(state, actions, tap);
      state = r.state;
      return r.transition;
    },
    render(ctx) {
      ctx.fillStyle = '#101028';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      const seen = new Set(record.seen);
      if (state.view === 'endings') {
        drawTextOutlined(ctx, 'ENDINGS', LOGICAL_W / 2, 50, 6, '#ffffff', 'center');
        drawTextOutlined(ctx, endingsCount(seen.size), LOGICAL_W / 2, 126, 4, '#ffee55', 'center');
        for (let i = 0; i < ENDING_COUNT; i++) drawCard(ctx, deps, i, seen.has(i + 1));
      } else {
        const mapReady = stagedOf(deps.assets)?.requestFile?.('map_full') ?? true;
        if (mapReady) drawRouteMapPanel(ctx, deps.assets, 0, 0, LOGICAL_W, LOGICAL_H, record.stages, FIRST_STAGE_ID);
        drawTextOutlined(ctx, 'ROUTE MAP', LOGICAL_W / 2, 40, 4, '#ffffff', 'center');
        drawTextOutlined(ctx, `${record.stages.length} / 15 STAGES`, LOGICAL_W / 2, 84, 2, '#ffee55', 'center');
      }
      const device = deps.device?.() ?? 'keyboard';
      drawMenuButton(ctx, ENDINGS_BACK_RECT, 'BACK', 3, false);
      drawMenuButton(ctx, ENDINGS_VIEW_RECT, state.view === 'endings' ? 'MAP' : 'ENDINGS', 3, false);
      if (device !== 'touch') {
        const hint = device === 'pad' ? 'LEFT RIGHT: VIEW   SELECT: BACK' : 'LEFT RIGHT: VIEW   ESC: BACK';
        drawText(ctx, hint, LOGICAL_W / 2, 650, 2, '#888888', 'center');
      }
    },
  };
}
