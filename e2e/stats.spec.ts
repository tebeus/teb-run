// Statistiche senza cookie (lancio, punto 11). `tools/check-builds.mjs
// --keep` costruisce site e portal; un piccolo server statico le serve.
// Chromium risolve l'host finto `play.tebrun.test` su 127.0.0.1, così la
// build site gira su un host che non è locale e conta davvero, senza nessun
// modo di prova nel codice. GoatCounter è intercettato con `page.route` e,
// per sicurezza, il suo host non si risolve: nessuna richiesta esce davvero.

import { expect, test, type Page, type Request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

/** La stessa porta degli e2e della sottocartella: le due suite non girano insieme (workers: 1). */
const PORT = Number(process.env.E2E_SUBFOLDER_PORT ?? 5410);
const FAKE_HOST = 'play.tebrun.test';
const GC = 'https://tebrun.goatcounter.com';

test.use({
  launchOptions: {
    args: [`--host-resolver-rules=MAP ${FAKE_HOST} 127.0.0.1, MAP tebrun.goatcounter.com ~NOTFOUND`],
  },
});

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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const builds = mkdtempSync(join(tmpdir(), 'teb-e2e-stats-builds-'));
  root = mkdtempSync(join(tmpdir(), 'teb-e2e-stats-root-'));
  const env = { ...process.env };
  delete env.NODE_ENV;
  execFileSync(process.execPath, ['tools/check-builds.mjs', '--keep', builds], { env, stdio: 'inherit' });
  cpSync(join(builds, 'site'), join(root, 'site'), { recursive: true });
  cpSync(join(builds, 'portal'), join(root, 'game'), { recursive: true });
  rmSync(builds, { recursive: true, force: true });

  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {
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
  await new Promise<void>((resolve) => server!.listen(PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (root) rmSync(root, { recursive: true, force: true });
});

/** I colpi verso GoatCounter, intercettati e mai mandati. */
async function catchHits(page: Page): Promise<Record<string, string>[]> {
  const hits: Record<string, string>[] = [];
  await page.context().route(`${GC}/**`, (route) => {
    hits.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    return route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') });
  });
  return hits;
}

/** Ogni richiesta che va verso GoatCounter, intercettata o no. */
function watchGoatCounter(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r: Request) => {
    if (r.url().includes('goatcounter')) seen.push(r.url());
  });
  return seen;
}

/** Titolo, radio e qualche secondo di gara: una partita breve. */
async function shortGame(page: Page, url: string, api: string[] = []): Promise<string[]> {
  const errors: string[] = [];
  // La classifica mondiale (solo site): finta, nessuna richiesta esce.
  await page.route('https://api.tebrun.io/**', (route) => {
    api.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"rows":[]}' });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowUp');
  return errors;
}

test('site build on a public host: a page view, then game/start, mode and car, once each', async ({ page }) => {
  const hits = await catchHits(page);
  const errors = await shortGame(page, `http://${FAKE_HOST}:${PORT}/site/`);
  await expect.poll(() => hits.length).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(500);
  expect(hits.map((h) => h.p)).toEqual(['/site/', 'game/start', 'mode/normal', 'car/new']);
  expect(hits[0].e).toBeUndefined();
  expect(hits[0].t).toBe('TEB RUN');
  for (const h of hits.slice(1)) expect(h.e).toBe('true');
  for (const h of hits) {
    expect(h.rnd).toMatch(/^[a-z0-9]+$/);
    expect(Object.keys(h).every((k) => ['p', 't', 'e', 'r', 'rnd'].includes(k))).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('site build on localhost: no request at all (the user\'s own tries do not count)', async ({ page }) => {
  const seen = watchGoatCounter(page);
  await catchHits(page);
  await shortGame(page, `http://localhost:${PORT}/site/`);
  expect(seen).toEqual([]);
});

test('portal build, even on a public host: no request to GoatCounter, none to the world leaderboard', async ({ page }) => {
  const seen = watchGoatCounter(page);
  await catchHits(page);
  const api: string[] = [];
  const errors = await shortGame(page, `http://${FAKE_HOST}:${PORT}/game/`, api);
  expect(seen).toEqual([]);
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});
