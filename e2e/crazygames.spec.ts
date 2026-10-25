// La build crazygames come la gioca CrazyGames: dentro un iframe di un'altra
// origine (qui il gioco su 127.0.0.1, la pagina che lo ospita su localhost,
// porte diverse), senza permessi (niente allow="fullscreen" né sensori).
// L'SDK di CrazyGames è finto (servito al posto di quello vero, ambiente
// `local`, con una pubblicità finta che registra le chiamate) o assente
// (la richiesta bloccata, come offline o con un adblock):
// - solo mouse, SDK finto, localStorage bloccato: dal titolo alla gara, il
//   game over, le iniziali, RETRY, la pubblicità fra le due partite (in
//   video), e l'ordine delle chiamate all'SDK;
// - solo tastiera, SDK assente: la radio parte da sola col timer, e RETRY
//   riparte subito, senza aspettare nessuna pubblicità;
// - col tocco, SDK assente: titolo, radio, TILT senza permesso, gara.
// Niente errori, niente richieste fallite o esterne (oltre all'SDK),
// nessuna richiesta di schermo intero. Le build pubbliche non hanno
// `#debug`: lo stato si guarda dai pixel e dalle chiamate all'SDK.

import { devices, expect, test, type Frame, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { COUNTDOWN_SECONDS } from '../src/game/race';
import { STAGES } from '../src/game/stages';
import { touchLayout } from '../src/ui/touch';
import { CONTINUE_RECT, RETRY_INPUT_DELAY_S, RETRY_RECT } from '../src/ui/retryMenu';
import type { ScreenName } from '../src/ui/fsm';
import type { Rect } from '../src/ui/rect';
import { DAILY_RECT } from '../src/ui/titleLayout';

/** `E2E_CRAZYGAMES_PORT` le sposta, se due copie del progetto provano insieme. */
const GAME_PORT = Number(process.env.E2E_CRAZYGAMES_PORT ?? 5430);
const HOST_PORT = GAME_PORT + 1;
const GAME_ORIGIN = `http://127.0.0.1:${GAME_PORT}`;
const HOST_ORIGIN = `http://localhost:${HOST_PORT}`;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/** La pagina ospite: un iframe 16:9 a tutta pagina, senza attributi allow. */
const HOST_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:#222}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe id="game-frame" src="${GAME_ORIGIN}/"></iframe></body></html>`;

let build = '';
const servers: Server[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  build = mkdtempSync(join(tmpdir(), 'teb-e2e-crazygames-'));
  const env = { ...process.env };
  delete env.NODE_ENV;
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'crazygames', '--outDir', build, '--emptyOutDir', '--logLevel', 'warn'], {
    env,
    stdio: 'inherit',
  });
  const game = createServer((req, res) => {
    let file = normalize(join(build, decodeURIComponent(new URL(req.url ?? '/', GAME_ORIGIN).pathname)));
    if (!file.startsWith(build)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  const host = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HOST_HTML));
  await new Promise<void>((resolve) => game.listen(GAME_PORT, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => host.listen(HOST_PORT, 'localhost', resolve));
  servers.push(game, host);
});

test.afterAll(async () => {
  for (const s of servers) await new Promise<void>((resolve) => s.close(() => resolve()));
  if (build) rmSync(build, { recursive: true, force: true });
});

/** Lo script dell'SDK, come lo chiede il gioco (src/core/crazySdk.ts). */
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

/**
 * Errori, richieste fallite o fuori dal gioco, e richieste di schermo intero.
 * La richiesta dell'SDK è l'unica esterna ammessa: servita (finto) o bloccata
 * (assente) da `sdk`, qui non conta.
 */
function watch(page: Page): { errors: string[]; failed: string[]; outside: string[] } {
  const out = { errors: [] as string[], failed: [] as string[], outside: [] as string[] };
  page.on('pageerror', (error) => out.errors.push(error.message));
  page.on('console', (msg) => {
    // La richiesta dell'SDK bloccata apposta lascia il suo errore di rete in console.
    if (msg.type() === 'error' && !msg.text().includes('ERR_FAILED') && !msg.text().includes('ERR_BLOCKED')) out.errors.push(msg.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) out.failed.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    if (r.url() !== SDK_URL) out.failed.push(`failed ${r.url()}`);
  });
  page.on('request', (r) => {
    const origin = new URL(r.url()).origin;
    if (origin !== GAME_ORIGIN && origin !== HOST_ORIGIN && r.url() !== SDK_URL) out.outside.push(r.url());
  });
  return out;
}

/**
 * Un SDK finto al posto di quello vero, nell'ambiente `local`: registra le
 * chiamate in `window.__sdkCalls` e, a `requestAd`, mostra per 2,5 s un
 * riquadro "FAKE AD" sopra il gioco (adStarted dopo 0,3 s, poi adFinished).
 */
const FAKE_SDK = `(() => {
  const calls = (window.__sdkCalls = []);
  const log = (name) => calls.push(name);
  window.CrazyGames = { SDK: {
    environment: 'local',
    init: () => { log('init'); return new Promise((r) => setTimeout(r, 200)); },
    game: {
      gameplayStart: () => log('gameplayStart'),
      gameplayStop: () => log('gameplayStop'),
      loadingStart: () => log('loadingStart'),
      loadingStop: () => log('loadingStop'),
      happytime: () => log('happytime'),
      settings: { muteAudio: false },
      addSettingsChangeListener: () => undefined,
    },
    ad: {
      requestAd: (type, cb) => {
        log('requestAd:' + type);
        const d = document.createElement('div');
        d.textContent = 'FAKE AD (local test)';
        d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);color:#fff;font:bold 48px sans-serif;z-index:9';
        setTimeout(() => { document.body.appendChild(d); log('adStarted'); cb.adStarted && cb.adStarted(); }, 300);
        setTimeout(() => { d.remove(); log('adFinished'); cb.adFinished && cb.adFinished(); }, 2800);
      },
    },
  } };
})();`;

/** L'SDK finto, o nessuno (la richiesta bloccata, come offline o con un adblock). */
async function sdk(page: Page, kind: 'fake' | 'absent'): Promise<void> {
  await page.route(SDK_URL, (route) =>
    kind === 'fake' ? route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SDK }) : route.abort('blockedbyclient'),
  );
}

/** Le chiamate all'SDK finto, nell'iframe. */
function sdkCalls(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => (window as unknown as { __sdkCalls?: string[] }).__sdkCalls ?? []);
}

const centre = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Nel solo iframe del gioco: localStorage che lancia (terze parti bloccate),
 * e requestFullscreen registrato invece che eseguito.
 */
async function blockStorageAndSpyFullscreen(page: Page, storage: 'blocked' | 'top10' = 'blocked'): Promise<void> {
  await page.addInitScript(
    ([gameOrigin, mode]) => {
    if (location.origin !== gameOrigin) return;
    if (mode === 'top10') {
      // Una TOP 10 piena di record irraggiungibili: il game over offre RETRY, non le iniziali.
      const top = Array.from({ length: 10 }, () => ({ name: 'CPU', score: 9_999_999, stageId: '4-4', route: 'L L L L', date: '2026-10-21T00:00:00.000Z' }));
      localStorage.setItem('tebrun.scores.normal.v1', JSON.stringify(top));
    } else {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    }
    const w = window as unknown as { __fullscreenAsked: number };
    w.__fullscreenAsked = 0;
    Element.prototype.requestFullscreen = function () {
      w.__fullscreenAsked++;
      return Promise.resolve();
    };
    },
    [GAME_ORIGIN, storage] as const,
  );
}

async function gameFrame(page: Page): Promise<Frame> {
  await page.goto(`${HOST_ORIGIN}/`);
  const frame = page.frame({ url: `${GAME_ORIGIN}/` });
  expect(frame).not.toBeNull();
  await frame!.waitForLoadState('networkidle');
  // Il titolo, dopo il caricamento della fase iniziale.
  await frame!.waitForFunction(() => document.documentElement.dataset.assets !== undefined, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  return frame!;
}

/** Da un punto logico 1280x720 del gioco a un punto della pagina ospite. */
async function toPage(frame: Frame, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const box = (await frame.locator('#game').boundingBox())!;
  return { x: box.x + (p.x * box.width) / 1280, y: box.y + (p.y * box.height) / 720 };
}

/** Impronta dei pixel del canvas. */
function canvasPrint(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let h = 0;
    for (let i = 0; i < data.length; i += 997) h = (h * 31 + data[i]) >>> 0;
    return h.toString(16);
  });
}


/** Un clic del mouse in un punto logico 1280x720 del gioco. */
async function click(page: Page, frame: Frame, p: { x: number; y: number }): Promise<void> {
  const q = await toPage(frame, p);
  await page.mouse.click(q.x, q.y);
}

const fullscreenAsked = (frame: Frame): Promise<number> =>
  frame.evaluate(() => (window as unknown as { __fullscreenAsked: number }).__fullscreenAsked);

test.describe('mouse only, with a fake SDK', () => {
  test('title, radio, race, game over, initials, RETRY, and the ad between the two games', async ({ browser }) => {
    // Un contesto proprio, per il video della pubblicità finta.
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: 'e2e/out/video', size: { width: 1280, height: 720 } } });
    const page = await context.newPage();
    const limit = STAGES.get('0-0')!.timeLimit;
    test.setTimeout((limit + 120) * 1000);
    const seen = watch(page);
    await sdk(page, 'fake');
    await blockStorageAndSpyFullscreen(page);
    const frame = await gameFrame(page);
    // Lo screenshot non porta il puntatore del sistema: la manina la dice il CSS del canvas.
    const sky = await toPage(frame, { x: 640, y: 300 });
    await page.mouse.move(sky.x, sky.y);
    expect(await frame.evaluate(() => (document.getElementById('game') as HTMLCanvasElement).style.cursor)).toBe('pointer');
    await page.screenshot({ path: 'e2e/out/crazygames-mouse-title.png' });

    // Un clic sul titolo: la radio, col timer.
    await click(page, frame, { x: 640, y: 300 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'e2e/out/crazygames-radio-timer.png' });
    // Un clic sul terzo brano lo sceglie e non parte; un clic sul pannello parte.
    const radio = await canvasPrint(frame);
    await click(page, frame, { x: 640, y: 130 + 2 * 32 + 8 });
    await page.waitForTimeout(600);
    expect(await canvasPrint(frame)).not.toBe(radio);
    await click(page, frame, { x: 640, y: 560 });
    // Dopo il semaforo e GO, la riga dell'obiettivo.
    await page.waitForTimeout((COUNTDOWN_SECONDS + 3) * 1000);
    await page.screenshot({ path: 'e2e/out/crazygames-goal-line.png' });
    expect(await sdkCalls(frame)).toContain('gameplayStart');

    // Nessun gas: il tempo finisce, il game over (la gara esce con gameplayStop).
    // Con la TOP 10 vuota prima le iniziali: CONTINUE, entro i suoi tre secondi.
    await expect.poll(() => sdkCalls(frame), { timeout: (limit + 10) * 1000, intervals: [100] }).toContain('gameplayStop');
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'e2e/out/crazygames-gameover-continue.png' });
    await click(page, frame, centre(CONTINUE_RECT));
    await page.waitForTimeout(1200);
    const next = centre(touchLayout('nameEntry', { tiltAvailable: false, tiltOn: false, cssPerLogical: 1 }).find((b) => b.id === 'next')!.rect);
    await page.screenshot({ path: 'e2e/out/crazygames-initials-mouse.png' });
    for (let i = 0; i < 3; i++) {
      await click(page, frame, next);
      await page.waitForTimeout(200);
    }
    // La TOP 10 con RETRY e MENU.
    await page.waitForTimeout(1200 + RETRY_INPUT_DELAY_S * 1000);
    await page.screenshot({ path: 'e2e/out/crazygames-retry.png' });
    const before = await sdkCalls(frame);
    expect(before.filter((c) => c.startsWith('requestAd'))).toEqual([]);
    expect(before[before.length - 1]).toBe('gameplayStop');

    // RETRY: prima la pubblicità finta, poi la gara.
    await click(page, frame, centre(RETRY_RECT));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'e2e/out/crazygames-fake-ad.png' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'e2e/out/crazygames-after-ad.png' });
    const calls = await sdkCalls(frame);
    const tail = calls.slice(before.length);
    expect(tail).toEqual(['requestAd:midgame', 'adStarted', 'adFinished', 'gameplayStart']);
    // Mai due start o due stop di fila, dall'inizio.
    const play = calls.filter((c) => c === 'gameplayStart' || c === 'gameplayStop');
    for (let i = 1; i < play.length; i++) expect(play[i]).not.toBe(play[i - 1]);
    expect(calls[0]).toBe('init');

    expect(seen.errors).toEqual([]);
    expect(seen.failed).toEqual([]);
    expect(seen.outside).toEqual([]);
    expect(await fullscreenAsked(frame)).toBe(0);
    const video = page.video();
    await context.close();
    await video?.saveAs('e2e/out/crazygames-fake-ad.webm');
  });
});

test('keyboard only, no SDK: the radio starts by itself, and RETRY races at once', async ({ page }) => {
  const limit = STAGES.get('0-0')!.timeLimit;
  test.setTimeout((limit + 90) * 1000);
  const seen = watch(page);
  await sdk(page, 'absent');
  await blockStorageAndSpyFullscreen(page, 'top10');
  const frame = await gameFrame(page);
  expect(await frame.evaluate(() => window.top !== window.self)).toBe(true);
  await page.screenshot({ path: 'e2e/out/crazygames-title.png' });

  // Il fuoco nell'iframe: un clic sul titolo (che porta alla radio).
  await click(page, frame, { x: 640, y: 300 });
  // F non chiede lo schermo intero.
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1500);
  const radio = await canvasPrint(frame);
  // Il timer: senza toccare niente, dopo dieci secondi si è in gara.
  await page.waitForTimeout(10_000);
  expect(await canvasPrint(frame)).not.toBe(radio);
  await page.waitForTimeout((COUNTDOWN_SECONDS + 0.5) * 1000);
  await page.keyboard.down('ArrowUp');
  const moving = await canvasPrint(frame);
  await page.waitForTimeout(2000);
  expect(await canvasPrint(frame)).not.toBe(moving);
  await page.screenshot({ path: 'e2e/out/crazygames-race.png' });
  // Il tempo finisce prima del bivio (gas a tavoletta e nessuno sterzo).
  await page.waitForTimeout((limit - 2) * 1000);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2000 + RETRY_INPUT_DELAY_S * 1000);
  // Nessun record: RETRY e MENU, che restano senza tempo.
  await page.screenshot({ path: 'e2e/out/crazygames-gameover-retry.png' });
  const over = await canvasPrint(frame);
  // RETRY con Invio: la gara riparte subito, senza pubblicità da aspettare.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  expect(await canvasPrint(frame)).not.toBe(over);
  await page.screenshot({ path: 'e2e/out/crazygames-retry-race.png' });

  expect(seen.errors).toEqual([]);
  expect(seen.failed).toEqual([]);
  expect(seen.outside).toEqual([]);
  expect(await fullscreenAsked(frame)).toBe(0);
});

test('DAILY in local only (no world leaderboard here), with the fake SDK: gameplay events, no initials, the local best, and the ad before the next game', async ({ page }) => {
  const limit = STAGES.get('0-0')!.timeLimit;
  test.setTimeout((limit + 120) * 1000);
  const seen = watch(page);
  await sdk(page, 'fake');
  await blockStorageAndSpyFullscreen(page, 'top10');
  const frame = await gameFrame(page);
  // DAILY CHALLENGE dal titolo, col mouse (il clic dà anche il fuoco all'iframe).
  await click(page, frame, centre(DAILY_RECT));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'e2e/out/crazygames-daily.png' });
  // ENTER sulla schermata della sfida, ENTER sulla radio.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout((COUNTDOWN_SECONDS + 0.5) * 1000);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'e2e/out/crazygames-daily-race.png' });
  await page.waitForTimeout((limit - 3) * 1000);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2000 + RETRY_INPUT_DELAY_S * 1000 + 500);
  await page.screenshot({ path: 'e2e/out/crazygames-daily-gameover.png' });
  const calls = await sdkCalls(frame);
  expect(calls).toContain('gameplayStart');
  expect(calls).toContain('gameplayStop');
  // Il primo punteggio DAILY del giorno non fa festa.
  expect(calls).not.toContain('happytime');
  // Il record DAILY di oggi, in locale.
  const best = await frame.evaluate(() => JSON.parse(localStorage.getItem('tebrun.daily.v1') ?? 'null'));
  expect(best?.best.score).toBeGreaterThan(0);
  // Niente CONTINUE (nessuna classifica mondiale qui): RETRY, e prima della seconda partita la pubblicità.
  await page.keyboard.press('Enter');
  await expect.poll(() => sdkCalls(frame)).toContain('requestAd:midgame');
  expect(seen.errors).toEqual([]);
  expect(seen.failed).toEqual([]);
  // Nessuna richiesta fuori dal gioco: né api.tebrun.io né altro.
  expect(seen.outside).toEqual([]);
});

const { defaultBrowserType: _ignored, ...phone } = devices['iPhone 13 landscape'];

test.describe('touch', () => {
  test.use(phone);

  const button = (screen: ScreenName, id: string, k: number): { x: number; y: number } => {
    const b = touchLayout(screen, { tiltAvailable: true, tiltOn: false, cssPerLogical: k }).find((x) => x.id === id)!;
    return { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 };
  };

  test('phone: title, radio, TILT without sensor permission, and the race by finger', async ({ page }) => {
    const seen = watch(page);
    await sdk(page, 'absent');
    await blockStorageAndSpyFullscreen(page);
    const frame = await gameFrame(page);
    const k = (await frame.locator('#game').boundingBox())!.width / 1280;
    const tap = async (p: { x: number; y: number }): Promise<void> => {
      const q = await toPage(frame, p);
      await page.touchscreen.tap(q.x, q.y);
      await page.waitForTimeout(400);
    };
    await page.screenshot({ path: 'e2e/out/crazygames-title-phone.png' });
    const radioBefore = await canvasPrint(frame);
    await tap({ x: 640, y: 320 });
    await page.waitForTimeout(800);
    expect(await canvasPrint(frame)).not.toBe(radioBefore);
    // TILT: senza il permesso dei sensori nell'iframe, nessun errore.
    await tap(button('radio', 'tilt', k));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'e2e/out/crazygames-radio-tilt-phone.png' });
    await tap(button('radio', 'start', k));
    await page.waitForTimeout((COUNTDOWN_SECONDS + 1.5) * 1000);
    // Gas col dito per due secondi: la strada si muove.
    const gas = await toPage(frame, button('race', 'gas', k));
    const cdp = await page.context().newCDPSession(page);
    const before = await canvasPrint(frame);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...gas, id: 1 }] });
    await page.waitForTimeout(2000);
    const after = await canvasPrint(frame);
    await page.screenshot({ path: 'e2e/out/crazygames-race-phone.png' });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(after).not.toBe(before);
    expect(seen.errors).toEqual([]);
    expect(seen.failed).toEqual([]);
    expect(seen.outside).toEqual([]);
    expect(await frame.evaluate(() => (window as unknown as { __fullscreenAsked: number }).__fullscreenAsked)).toBe(0);
  });
});
