// Comandi "di contorno" disegnati sopra le schermate, fuori dalla macchina a
// stati: il pulsante dello schermo intero (titolo e radio) e i link a privacy
// e about (solo titolo). Si usano col
// tasto F e col clic o il tocco sul canvas; niente di tutto questo passa da
// `createInput`, perché requestFullscreen vuole il gesto dell'utente dentro
// l'handler dell'evento, non nel tick della simulazione.
// Nella build crazygames niente pulsante né tasto F (lo schermo intero lo dà
// il portale) e niente ABOUT: resta solo PRIVACY.

import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import {
  FULLSCREEN_EVENTS,
  canFullscreen,
  isFullscreen,
  toggleFullscreen,
  type FullscreenDoc,
  type FullscreenTarget,
} from '../core/fullscreen';
import { ABOUT_URL, PRIVACY_URL } from '../core/config';
import { ABOUT_BUILD, FEATURES, FULLSCREEN_BUILD, type TargetFeatures } from '../core/target';
import type { ScreenName } from './fsm';
import { inside, touchRect, type Rect } from './rect';

export { inside, MIN_TOUCH_CSS, touchRect, type Rect } from './rect';
import { drawTextOutlined, measureText } from './text';


/** Lato del pulsante disegnato, in pixel logici. */
export const FS_BUTTON_SIZE = 48;
/** Distanza del pulsante dai bordi dello schermo. */
export const FS_BUTTON_MARGIN = 16;

/** Schermate con il pulsante dello schermo intero. */
export const FULLSCREEN_SCREENS: readonly ScreenName[] = ['title', 'radio'];

/** Il pulsante disegnato, in basso a destra. Pura. */
export function fullscreenButtonRect(): Rect {
  return {
    x: LOGICAL_W - FS_BUTTON_MARGIN - FS_BUTTON_SIZE,
    y: LOGICAL_H - FS_BUTTON_MARGIN - FS_BUTTON_SIZE,
    w: FS_BUTTON_SIZE,
    h: FS_BUTTON_SIZE,
  };
}



/** Il pulsante c'è su questa schermata? Pura. */
export function showsFullscreenButton(screen: ScreenName, available: boolean): boolean {
  return available && FULLSCREEN_SCREENS.includes(screen);
}

/**
 * Il pulsante: quattro angoli che puntano in fuori (entra) o in dentro
 * (esci), su un fondo scuro semitrasparente.
 */
export function drawFullscreenButton(ctx: CanvasRenderingContext2D, r: Rect, active: boolean): void {
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#101018';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  const pad = 10;
  const arm = 12;
  const t = 4;
  const x0 = r.x + pad;
  const y0 = r.y + pad;
  const x1 = r.x + r.w - pad;
  const y1 = r.y + r.h - pad;
  // Ogni angolo: (vertice x, vertice y, verso orizzontale, verso verticale).
  const corners: [number, number, number, number][] = active
    ? // Esci: i vertici guardano il centro.
      [
        [x0 + arm, y0 + arm, -1, -1],
        [x1 - arm, y0 + arm, 1, -1],
        [x0 + arm, y1 - arm, -1, 1],
        [x1 - arm, y1 - arm, 1, 1],
      ]
    : [
        [x0, y0, 1, 1],
        [x1, y0, -1, 1],
        [x0, y1, 1, -1],
        [x1, y1, -1, -1],
      ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.fillRect(dx > 0 ? cx : cx - arm, dy > 0 ? cy : cy - t, arm, t);
    ctx.fillRect(dx > 0 ? cx : cx - t, dy > 0 ? cy : cy - arm, t, arm);
  }
}

/** Un link del titolo: scritta e indirizzo (le costanti di config). */
export interface TitleLink {
  label: string;
  url: string;
}

/** PRIVACY sempre; ABOUT no nella build crazygames (`ABOUT_BUILD`). */
export const TITLE_LINKS: readonly TitleLink[] = ABOUT_BUILD
  ? [
      { label: 'PRIVACY', url: PRIVACY_URL },
      { label: 'ABOUT', url: ABOUT_URL },
    ]
  : [{ label: 'PRIVACY', url: PRIVACY_URL }];

/** Scala del font dei link: piccoli, glifi alti 16 px. */
export const LINK_SCALE = 2;
/** Spazio fra due link, e margine dai bordi. */
export const LINK_GAP = 32;
export const LINK_MARGIN = 20;
/** Altezza minima dell'area di clic di un link, in pixel logici. */
export const LINK_MIN_LOGICAL = 44;

/** Riquadri dei link, in basso a sinistra, in fila. Pura. */
export function titleLinkRects(links: readonly TitleLink[] = TITLE_LINKS): Rect[] {
  const h = 8 * LINK_SCALE;
  const y = LOGICAL_H - LINK_MARGIN - h;
  let x = LINK_MARGIN;
  return links.map((link) => {
    const w = measureText(link.label, LINK_SCALE);
    const r = { x, y, w, h };
    x += w + LINK_GAP;
    return r;
  });
}

/**
 * Dove si apre un link: nella build portal in una scheda nuova; dentro un
 * iframe (la build site incorporata su tebrun.io) nella pagina che lo
 * contiene, non dentro il riquadro del gioco; altrimenti al posto del gioco.
 * Pura.
 */
export function linkTarget(features: Pick<TargetFeatures, 'linksInNewTab'>, framed: boolean): '_blank' | '_top' | '_self' {
  if (features.linksInNewTab) return '_blank';
  return framed ? '_top' : '_self';
}

/** Apre `url` secondo `target`. Una scheda nuova non sa chi l'ha aperta. */
export function openLink(win: Pick<Window, 'open' | 'location'>, url: string, target: '_blank' | '_top' | '_self'): void {
  if (target === '_blank') win.open(url, '_blank', 'noopener,noreferrer');
  else if (target === '_top') win.open(url, '_top');
  else win.location.assign(url);
}

/** I link del titolo, scritti piccoli e sottolineati. */
export function drawTitleLinks(ctx: CanvasRenderingContext2D, rects: readonly Rect[], links: readonly TitleLink[] = TITLE_LINKS): void {
  links.forEach((link, i) => {
    const r = rects[i];
    drawTextOutlined(ctx, link.label, r.x, r.y, LINK_SCALE, '#cccccc', 'left');
    ctx.fillStyle = '#101018';
    ctx.fillRect(r.x - 1, r.y + r.h + 1, r.w + 2, 4);
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(r.x, r.y + r.h + 2, r.w, 2);
  });
}

/** Punto del canvas in pixel logici da un evento del puntatore. Pura. */
export function toLogical(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  const sx = box.width > 0 ? LOGICAL_W / box.width : 1;
  const sy = box.height > 0 ? LOGICAL_H / box.height : 1;
  return { x: (clientX - box.left) * sx, y: (clientY - box.top) * sy };
}

export interface LaunchUi {
  /** Da chiamare dopo `app.render`, a ogni fotogramma. */
  draw(ctx: CanvasRenderingContext2D): void;
}

/**
 * Collega tasto F e clic/tocco sul canvas, e ritorna il disegno. `screen`
 * dice la schermata corrente (`app.name`).
 */
export function installLaunchUi(win: Window, canvas: HTMLCanvasElement, screen: () => ScreenName): LaunchUi {
  const doc = win.document as unknown as FullscreenDoc & Document;
  const root = win.document.documentElement as unknown as FullscreenTarget;
  // Senza `FULLSCREEN_BUILD` (crazygames) il pulsante non c'è mai, e il
  // bundler toglie le chiamate a requestFullscreen.
  const available = FULLSCREEN_BUILD && canFullscreen(doc, root);
  const button = fullscreenButtonRect();

  const cssPerLogical = (): number => canvas.getBoundingClientRect().width / LOGICAL_W;
  const hitButton = (x: number, y: number): boolean =>
    showsFullscreenButton(screen(), available) && inside(touchRect(button, cssPerLogical()), x, y);
  const links = titleLinkRects();
  /** Il link sotto il punto, sul titolo; null se nessuno. */
  const hitLink = (x: number, y: number): TitleLink | null => {
    if (screen() !== 'title') return null;
    const k = cssPerLogical();
    const i = links.findIndex((r) => inside(touchRect(r, k, LINK_MIN_LOGICAL), x, y));
    return i < 0 ? null : TITLE_LINKS[i];
  };
  let framed = false;
  try {
    framed = win.top !== win.self;
  } catch {
    framed = true;
  }

  win.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!FULLSCREEN_BUILD || !showsFullscreenButton(screen(), available)) return;
    e.preventDefault();
    toggleFullscreen(doc, root);
  });
  canvas.addEventListener('click', (e) => {
    const p = toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
    if (FULLSCREEN_BUILD && hitButton(p.x, p.y)) {
      toggleFullscreen(doc, root);
      return;
    }
    const link = hitLink(p.x, p.y);
    if (link !== null) openLink(win, link.url, linkTarget(FEATURES, framed));
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
    canvas.style.cursor = hitButton(p.x, p.y) || hitLink(p.x, p.y) !== null ? 'pointer' : '';
  });
  // Entrata e uscita (anche con Esc del browser): il letterbox si rifà.
  for (const name of FULLSCREEN_EVENTS) {
    win.document.addEventListener(name, () => win.dispatchEvent(new Event('resize')));
  }

  return {
    draw(ctx) {
      if (screen() === 'title') drawTitleLinks(ctx, links);
      if (showsFullscreenButton(screen(), available)) drawFullscreenButton(ctx, button, isFullscreen(doc));
    },
  };
}
