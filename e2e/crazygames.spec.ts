// La build crazygames come la gioca CrazyGames: dentro un iframe di un'altra
// origine (qui il gioco su 127.0.0.1, la pagina che lo ospita su localhost,
// porte diverse), senza permessi (niente allow="fullscreen" né sensori), e
// con localStorage bloccato come in un iframe di terze parti. Una partita da
// tastiera fino al game over, una al tocco fino alla gara; niente errori,
// niente richieste fallite o esterne, nessuna richiesta di schermo intero.
// Le build pubbliche non hanno `#debug`: lo stato si guarda dai pixel.

import { devices, expect, test, type Frame, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { COUNTDOWN_SECONDS } from '../src/game/race';
import { STAGES } from '../src/game/stages';
import { touchLayout } from '../src/ui/touch';
import type { ScreenName } from '../src/ui/fsm';

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

/** Errori, richieste fallite o fuori dal gioco, e richieste di schermo intero. */
function watch(page: Page): { errors: string[]; failed: string[]; outside: string[] } {
  const out = { errors: [] as string[], failed: [] as string[], outside: [] as string[] };
  page.on('pageerror', (error) => out.errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') out.errors.push(msg.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) out.failed.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => out.failed.push(`failed ${r.url()}`));
  page.on('request', (r) => {
    const origin = new URL(r.url()).origin;
    if (origin !== GAME_ORIGIN && origin !== HOST_ORIGIN) out.outside.push(r.url());
  });
  return out;
}

/**
 * Nel solo iframe del gioco: localStorage che lancia (terze parti bloccate),
 * e requestFullscreen registrato invece che eseguito.
 */
async function blockStorageAndSpyFullscreen(page: Page): Promise<void> {
  await page.addInitScript((gameOrigin) => {
    if (location.origin !== gameOrigin) return;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    const w = window as unknown as { __fullscreenAsked: number };
    w.__fullscreenAsked = 0;
    Element.prototype.requestFullscreen = function () {
      w.__fullscreenAsked++;
      return Promise.resolve();
    };
  }, GAME_ORIGIN);
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

test('keyboard: title, radio and a whole game in a cross-origin iframe, storage blocked', async ({ page }) => {
  // Tutta la tappa a tempo pieno, poi il game over.
  const limit = STAGES.get('0-0')!.timeLimit;
  test.setTimeout((limit + 90) * 1000);
  const seen = watch(page);
  await blockStorageAndSpyFullscreen(page);
  const frame = await gameFrame(page);
  expect(await frame.evaluate(() => window.top !== window.self)).toBe(true);
  await page.screenshot({ path: 'e2e/out/crazygames-title.png' });

  // Il fuoco nell'iframe: un clic sul cielo del titolo, lontano dai link.
  const sky = await toPage(frame, { x: 640, y: 40 });
  await page.mouse.click(sky.x, sky.y);
  // F non chiede lo schermo intero; dove c'era ABOUT un clic non apre niente.
  await page.keyboard.press('KeyF');
  const about = await toPage(frame, { x: 200, y: 692 });
  let popups = 0;
  page.on('popup', () => popups++);
  await page.mouse.click(about.x, about.y);
  await page.waitForTimeout(500);
  expect(popups).toBe(0);
  expect(await frame.evaluate(() => (window as unknown as { __fullscreenAsked: number }).__fullscreenAsked)).toBe(0);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout((COUNTDOWN_SECONDS + 1.5) * 1000);
  await page.keyboard.down('ArrowUp');
  const before = await canvasPrint(frame);
  await page.waitForTimeout(2000);
  expect(await canvasPrint(frame)).not.toBe(before);
  await page.screenshot({ path: 'e2e/out/crazygames-race.png' });
  // Il tempo finisce prima del bivio (gas a tavoletta e nessuno sterzo):
  // il game over dura 3 s, si fotografa nel mezzo.
  await page.waitForTimeout((limit - 2 - 1.5 + 1.2) * 1000);
  await page.keyboard.up('ArrowUp');
  await page.screenshot({ path: 'e2e/out/crazygames-gameover.png' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'e2e/out/crazygames-after-gameover.png' });

  expect(seen.errors).toEqual([]);
  expect(seen.failed).toEqual([]);
  expect(seen.outside).toEqual([]);
  expect(await frame.evaluate(() => (window as unknown as { __fullscreenAsked: number }).__fullscreenAsked)).toBe(0);
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
