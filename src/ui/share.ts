// Condivisione del risultato a fine partita (lancio, punto 10): il pulsante
// SHARE sul game over e sui finali, il tasto S, e le azioni. Con
// `navigator.share` che accetta file (telefoni) si condivide la scheda PNG
// col testo breve; altrimenti si scarica il PNG e si copia il testo negli
// appunti. Come il pulsante dello schermo intero (`launchUi.ts`) sta fuori
// dalla macchina a stati: `navigator.share` vuole il gesto dell'utente
// dentro l'handler dell'evento, non nel tick della simulazione.
// Nella build crazygames niente SHARE: scheda e testo portano l'indirizzo
// del sito, cioè cross-promozione (`SHARE_BUILD`).

import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import { GAME_NAME } from '../core/config';
import { SHARE_BUILD } from '../core/target';
import { DEFAULT_CAR } from '../game/car';
import { modeOf } from '../game/mode';
import type { AssetStore, CarChoice, StageDef } from '../types';
import type { ScreenName } from './fsm';
import { inside, toLogical, touchRect, type Rect } from './launchUi';
import { renderShareCard, shareFileName, shareText, type CardDoc, type ShareResult } from './shareCard';
import { drawText, drawTextOutlined } from './text';

/** Schermate con il pulsante SHARE. L'inserimento del nome no: lì S è una lettera. */
export const SHARE_SCREENS: readonly ScreenName[] = ['gameOver', 'ending'];

/** Il tasto S condivide? Solo su game over e finali, con un risultato pronto, senza modificatori. Pura. */
export function isShareKey(
  e: Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  screen: ScreenName,
  offered: boolean,
): boolean {
  if (e.code !== 'KeyS' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  return offered && SHARE_SCREENS.includes(screen);
}

/** Il risultato di una schermata di fine partita, per la scheda. Pura. */
export function shareResultFrom(
  kind: ShareResult['kind'],
  payload: { score: number; stage: StageDef; route: readonly ('L' | 'R')[]; time?: number; ending?: number },
  car: CarChoice | undefined,
): ShareResult {
  const time = typeof payload.time === 'number' && Number.isFinite(payload.time) ? payload.time : 0;
  return {
    kind,
    score: payload.score,
    time,
    // La modalità la porta la tappa (`withMode`): è quella della partita
    // appena giocata, anche se nel frattempo la radio l'avesse cambiata.
    mode: modeOf(payload.stage),
    car: car ?? DEFAULT_CAR,
    route: [...payload.route],
    stageId: payload.stage.id,
    stageName: payload.stage.name,
    ...(kind === 'ending' ? { ending: payload.ending ?? 0 } : {}),
  };
}

/**
 * Il risultato offerto dalla schermata corrente. Le schermate di fine
 * partita lo offrono in `enter` e lo ritirano in `exit`; dopo una
 * condivisione la schermata resta ferma (`held`) finché non si preme ENTER,
 * perché il game over dura tre secondi e il foglio di condivisione di più.
 */
export interface ShareSlot {
  offer(result: ShareResult | null): void;
  current(): ShareResult | null;
  held(): boolean;
  hold(): void;
  /** Chiamata a ogni `offer`. */
  subscribe(fn: (result: ShareResult | null) => void): void;
}

export function createShareSlot(): ShareSlot {
  let result: ShareResult | null = null;
  let isHeld = false;
  const subs: ((r: ShareResult | null) => void)[] = [];
  return {
    offer(r) {
      result = r;
      isHeld = false;
      for (const fn of subs) fn(r);
    },
    current: () => result,
    held: () => isHeld,
    hold() {
      if (result !== null) isHeld = true;
    },
    subscribe(fn) {
      subs.push(fn);
    },
  };
}

/** Quanto di `navigator` serve qui. */
export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

export type ShareAction = 'share' | 'download';

/** Foglio di condivisione se il browser accetta il file, altrimenti download. Pura se lo è `canShare`. */
export function chooseShareAction(nav: ShareNavigator, file: File | null): ShareAction {
  if (file === null || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return 'download';
  try {
    return nav.canShare({ files: [file] }) ? 'share' : 'download';
  } catch {
    return 'download';
  }
}

/** Com'è andata, per la scritta sotto il pulsante. */
export type ShareOutcome = 'shared' | 'cancelled' | 'saved-copied' | 'saved' | 'copied' | 'failed';

/** La scritta dopo l'azione. Pura. */
export function shareStatusText(outcome: ShareOutcome): string {
  switch (outcome) {
    case 'shared':
      return 'SHARED!';
    case 'cancelled':
      return '';
    case 'saved-copied':
      return 'PNG SAVED, TEXT COPIED';
    case 'saved':
      return 'PNG SAVED';
    case 'copied':
      return 'TEXT COPIED';
    case 'failed':
      return 'SHARE NOT AVAILABLE';
  }
}

/** Ciò che le azioni toccano del browser, iniettabile nei test. */
export interface ShareEnv {
  nav: ShareNavigator;
  doc: Pick<Document, 'createElement' | 'body'>;
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  later: (fn: () => void, ms: number) => void;
}

/** Scarica `blob` come `name` con un link temporaneo. Falso se il browser lancia. */
export function downloadBlob(env: ShareEnv, blob: Blob, name: string): boolean {
  try {
    const url = env.urls.createObjectURL(blob);
    const a = env.doc.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    env.doc.body.appendChild(a);
    a.click();
    a.remove();
    // Il download parte dal clic; l'URL si libera un po' dopo, non subito.
    env.later(() => env.urls.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/** Copia `text` negli appunti. Falso senza API o se il browser rifiuta: mai un errore. */
export async function copyText(nav: ShareNavigator, text: string): Promise<boolean> {
  try {
    if (typeof nav.clipboard?.writeText !== 'function') return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Condivide la scheda `blob` del risultato `r`: il foglio di sistema se
 * c'è, altrimenti download più appunti. Un annullo dell'utente sul foglio
 * non fa altro; un altro errore del foglio ripiega sul download.
 */
export async function shareResult(env: ShareEnv, blob: Blob | null, r: ShareResult): Promise<ShareOutcome> {
  const text = shareText(r);
  const name = shareFileName(r);
  const file = blob === null ? null : new File([blob], name, { type: 'image/png' });
  if (chooseShareAction(env.nav, file) === 'share' && file !== null) {
    try {
      await env.nav.share!({ files: [file], text, title: GAME_NAME });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  const saved = blob !== null && downloadBlob(env, blob, name);
  const copied = await copyText(env.nav, text);
  if (saved) return copied ? 'saved-copied' : 'saved';
  return copied ? 'copied' : 'failed';
}

/** Il pulsante, in basso a sinistra: libero sia sul game over sia sui finali. */
export const SHARE_BUTTON: Rect = { x: 36, y: LOGICAL_H - 36 - 52, w: 196, h: 52 };
/** Quanto resta la scritta dell'esito, in millisecondi. */
export const SHARE_STATUS_MS = 3500;

/** Il pulsante: un tasto «S» a sinistra e la scritta SHARE. */
export function drawShareButton(ctx: CanvasRenderingContext2D, r: Rect, busy: boolean): void {
  ctx.save();
  ctx.fillStyle = '#101018';
  ctx.globalAlpha = 0.8;
  ctx.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
  ctx.globalAlpha = 1;
  ctx.fillStyle = busy ? '#8a6a20' : '#ff3399';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#101018';
  ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
  // Il tasto S, come un tasto della tastiera.
  const k = { x: r.x + 10, y: r.y + 10, w: 32, h: 32 };
  ctx.fillStyle = '#dfe6ef';
  ctx.fillRect(k.x, k.y, k.w, k.h);
  drawText(ctx, 'S', k.x + k.w / 2, k.y + 8, 2, '#101018', 'center');
  drawText(ctx, 'SHARE', r.x + 56, r.y + 14, 3, busy ? '#bbbbbb' : '#ffffff');
  ctx.restore();
}

export interface ShareUi {
  /** Da chiamare dopo `app.render`, a ogni fotogramma. */
  draw(ctx: CanvasRenderingContext2D): void;
}

/** Nessun pulsante, nessun tasto: la build senza SHARE. */
export const NO_SHARE_UI: ShareUi = { draw: () => undefined };

/**
 * Collega tasto S e clic/tocco sul pulsante. La scheda si prepara appena una
 * schermata offre un risultato, così al gesto il PNG è già pronto e il
 * foglio di condivisione si apre dentro il gesto dell'utente. Senza
 * `SHARE_BUILD` non collega niente: il bundler toglie il resto, scheda e
 * indirizzo del sito compresi.
 */
export function installShareUi(
  win: Window,
  canvas: HTMLCanvasElement,
  screen: () => ScreenName,
  slot: ShareSlot,
  assets: AssetStore,
  /** A ogni pressione del pulsante (le statistiche della build site). */
  onShare: () => void = () => undefined,
): ShareUi {
  if (!SHARE_BUILD) return NO_SHARE_UI;
  const env: ShareEnv = {
    nav: win.navigator as ShareNavigator,
    doc: win.document,
    urls: URL,
    later: (fn, ms) => void win.setTimeout(fn, ms),
  };
  let card: Promise<Blob | null> | null = null;
  let busy = false;
  let status = '';
  let statusUntil = 0;

  slot.subscribe((r) => {
    card = r === null ? null : renderShareCard(win.document as CardDoc, r, assets);
    status = '';
  });

  const showing = (): boolean => slot.current() !== null && SHARE_SCREENS.includes(screen());
  const hit = (x: number, y: number): boolean =>
    showing() && inside(touchRect(SHARE_BUTTON, canvas.getBoundingClientRect().width / LOGICAL_W), x, y);

  const press = (): void => {
    const r = slot.current();
    if (r === null || busy) return;
    busy = true;
    slot.hold();
    onShare();
    const blob = card ?? renderShareCard(win.document as CardDoc, r, assets);
    void blob
      .then((b) => shareResult(env, b, r))
      .catch((): ShareOutcome => 'failed')
      .then((outcome) => {
        status = shareStatusText(outcome);
        statusUntil = win.performance.now() + SHARE_STATUS_MS;
        busy = false;
      });
  };

  win.addEventListener('keydown', (e) => {
    if (!isShareKey(e, screen(), slot.current() !== null)) return;
    e.preventDefault();
    press();
  });
  canvas.addEventListener('click', (e) => {
    const p = toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
    if (hit(p.x, p.y)) press();
  });
  canvas.addEventListener('pointermove', (e) => {
    // Il puntatore lo azzera `launchUi`, registrato prima: qui lo si accende soltanto.
    const p = toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
    if (hit(p.x, p.y)) canvas.style.cursor = 'pointer';
  });

  return {
    draw(ctx) {
      if (!showing()) return;
      const b = SHARE_BUTTON;
      drawShareButton(ctx, b, busy);
      const line = status !== '' && win.performance.now() < statusUntil ? status : slot.held() ? 'ENTER TO CONTINUE' : '';
      if (line !== '') drawTextOutlined(ctx, line, b.x, b.y - 26, 2, '#ffee55');
    },
  };
}
