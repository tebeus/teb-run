// Le build pubbliche servite da una sottocartella, come le servono itch.io e
// i portali: `tools/check-builds.mjs --keep` costruisce site e portal (e fa
// il loro controllo: niente file classic, source map, percorsi locali), poi
// un piccolo server statico le mette in /play/ e /game/. Titolo, radio e
// gara devono caricare senza errori e senza nessuna richiesta fallita.

import { devices, expect, test, type Page } from '@playwright/test';
// @ts-expect-error: modulo .mjs degli strumenti, senza tipi.
import { measureTitle, SLOW_4G } from '../tools/measure-title.mjs';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

/** `E2E_SUBFOLDER_PORT` la sposta, se due copie del progetto provano insieme. */
const PORT = Number(process.env.E2E_SUBFOLDER_PORT ?? 5410);
const ORIGIN = `http://localhost:${PORT}`;
const FOLDERS = { site: 'play', portal: 'game' } as const;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

let root = '';
let server: Server | null = null;
/** Richieste a cui il server ha risposto 404, per percorso. */
const notFound: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const builds = mkdtempSync(join(tmpdir(), 'teb-e2e-builds-'));
  root = mkdtempSync(join(tmpdir(), 'teb-e2e-root-'));
  const env = { ...process.env };
  delete env.NODE_ENV;
  // Fallisce (e ferma questi test) se il controllo delle build trova qualcosa.
  execFileSync(process.execPath, ['tools/check-builds.mjs', '--keep', builds], { env, stdio: 'inherit' });
  for (const [target, folder] of Object.entries(FOLDERS)) cpSync(join(builds, target), join(root, folder), { recursive: true });
  rmSync(builds, { recursive: true, force: true });

  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', ORIGIN).pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      notFound.push(path);
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server!.listen(PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Impronta dei pixel del canvas, per vedere che il gioco disegna e cambia. */
async function canvasPrint(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let h = 0;
    for (let i = 0; i < data.length; i += 997) h = (h * 31 + data[i]) >>> 0;
    return h.toString(16);
  });
}

/**
 * Titolo, radio e qualche secondo di gara, raccogliendo errori e richieste
 * fallite. Le build pubbliche non accendono `#debug`: niente
 * `window.__tebrun`, lo stato si guarda dalla rete e dai pixel.
 */
async function playFrom(page: Page, url: string): Promise<{ errors: string[]; failed: string[]; sprites: number; api: string[] }> {
  const errors: string[] = [];
  const failed: string[] = [];
  const api: string[] = [];
  let sprites = 0;
  // La classifica mondiale (solo site): finta, nessuna richiesta esce.
  await page.route('https://api.tebrun.io/**', (route) => {
    api.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"rows":[]}' });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    else if (/\/sprites\/.+\.(png|webp)$/.test(response.url())) sprites++;
  });
  page.on('requestfailed', (request) => failed.push(`failed ${request.url()}`));

  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  // Il gancio di diagnostica non esiste, anche con #debug nell'indirizzo.
  expect(await page.evaluate(() => window.__tebrun === undefined)).toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  // Semaforo della partenza, poi gas: la strada deve muoversi.
  await page.waitForTimeout(6000);
  await page.keyboard.down('ArrowUp');
  const before = await canvasPrint(page);
  await page.waitForTimeout(2000);
  const after = await canvasPrint(page);
  await page.keyboard.up('ArrowUp');
  expect(after).not.toBe(before);
  return { errors, failed, sprites, api };
}

for (const [target, folder] of Object.entries(FOLDERS)) {
  test(`${target} build from /${folder}/: title, radio and race load with no error and no 404`, async ({ page }) => {
    const before = notFound.length;
    const { errors, failed, sprites, api } = await playFrom(page, `${ORIGIN}/${folder}/#debug`);
    // La classifica mondiale: la site chiede la top di oggi alla partenza; la portal non chiama mai.
    if (target === 'site') expect(api).toContain('https://api.tebrun.io/top?mode=normal&board=today');
    else expect(api).toEqual([]);
    // Ogni richiesta è rimasta nella sottocartella.
    expect(sprites).toBeGreaterThan(100);
    await page.screenshot({ path: `e2e/out/subfolder-${target}.png` });
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
    expect(notFound.slice(before)).toEqual([]);
  });

  test(`${target} build: #debug is off, and ?car=classic asks for no classic file`, async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => asked.push(new URL(request.url()).pathname));
    await page.goto(`${ORIGIN}/${folder}/?car=classic#debug`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__tebrun === undefined)).toBe(true);
    expect(asked.filter((path) => /classic/i.test(path))).toEqual([]);
  });
}

/**
 * Byte scaricati, misurati dalla rete col Resource Timing del browser
 * (corpo codificato di ogni risposta, documento compreso): fino al segno
 * `teb-assets-initial` (fine della fase iniziale, poi il titolo) e fino a
 * `teb-assets-all` (fine del background). Lancio, punto 12.
 */
async function measureBytes(page: Page, url: string): Promise<{ initial: number; all: number; files: number; seen: number }> {
  let seen = 0;
  page.on('response', (response) => {
    void response.body().then(
      (body) => (seen += body.length),
      () => undefined,
    );
  });
  // Il buffer di partenza tiene 250 voci: qui ce ne vogliono di più.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(2000));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'initial' || document.documentElement.dataset.assets === 'all');
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'all', undefined, { timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  const sums = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const mark = (name: string): number => performance.getEntriesByName(name)[0]?.startTime ?? Infinity;
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const until = (t: number): number =>
      nav.encodedBodySize + res.filter((r) => r.responseEnd <= t).reduce((s, r) => s + r.encodedBodySize, 0);
    return { initial: until(mark('teb-assets-initial')), all: until(mark('teb-assets-all')), files: res.length + 1 };
  });
  return { ...sums, seen };
}

for (const [target, folder] of Object.entries(FOLDERS)) {
  test(`${target} build: at most 1.5 MB before the title and 20 MB in all, measured on the network`, async ({ page }) => {
    const bytes = await measureBytes(page, `${ORIGIN}/${folder}/`);
    const mb = (n: number): string => `${(n / 1e6).toFixed(2)} MB`;
    console.log(`${target}: ${mb(bytes.initial)} before the title, ${mb(bytes.all)} in all (${bytes.files} files)`);
    mkdirSync('e2e/out', { recursive: true });
    writeFileSync(`e2e/out/light-weight-${target}.json`, `${JSON.stringify(bytes, null, 2)}\n`);
    expect(bytes.initial).toBeGreaterThan(500_000);
    expect(bytes.initial).toBeLessThanOrEqual(1_500_000);
    expect(bytes.all).toBeLessThanOrEqual(20_000_000);
    // Il background aggiunge davvero qualcosa, e il conto della pagina torna con quello della rete.
    expect(bytes.all).toBeGreaterThan(bytes.initial);
    expect(Math.abs(bytes.seen - bytes.all)).toBeLessThan(bytes.all * 0.02);
  });
}

test('site build on slow 4G (1.6 Mbit/s, 150 ms), empty cache, phone: the title in under 8 s, and the wait if you start at once', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ ...devices['iPhone 13 landscape'], hasTouch: true });
  const page = await context.newPage();
  await page.route('https://api.tebrun.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"rows":[]}' }),
  );
  const { titleMs, waitMs } = await measureTitle(page, `${ORIGIN}/${FOLDERS.site}/`, SLOW_4G);
  console.log(`slow 4G: title after ${(titleMs / 1000).toFixed(1)} s, wait at an immediate start ${((waitMs ?? 0) / 1000).toFixed(1)} s`);
  mkdirSync('e2e/out', { recursive: true });
  writeFileSync('e2e/out/slow-4g-site.json', `${JSON.stringify({ titleMs, waitMs }, null, 2)}\n`);
  expect(titleMs).toBeLessThan(8000);
  // L'attesa finisce sempre, e la gara parte con la sua grafica.
  expect(waitMs).not.toBeNull();
  await context.close();
});

test('portal build: the ABOUT link on the title opens a new tab, the game stays', async ({ page, context }) => {
  // Nessuna rete esterna negli e2e: la pagina del sito è finta.
  await context.route('https://tebrun.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>ok</title>' }),
  );
  await page.goto(`${ORIGIN}/${FOLDERS.portal}/`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  // ABOUT, secondo link in basso a sinistra (x 164..244, y 684..700).
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.mouse.click(200, 692)]);
  await popup.waitForURL('https://tebrun.io/about/');
  expect(page.url()).toBe(`${ORIGIN}/${FOLDERS.portal}/`);
  // noopener: la scheda nuova non vede il gioco.
  expect(await popup.evaluate(() => window.opener)).toBeNull();
});
