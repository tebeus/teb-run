// La sfida giornaliera e la classifica mondiale, contro `npm run dev` con
// `?board=local` (la privata parla con `wrangler dev`, qui finto con
// `page.route`: nessuna richiesta esce). DAILY dal titolo alla TOP 10 col
// solo mouse e col solo tocco, con l'invio e la posizione mostrata; una
// partita normale che entra solo nella classifica mondiale di oggi; e
// offline, dove resta tutto locale e nessun errore arriva al gioco.

import { devices, expect, test, type CDPSession, type Page, type Route } from '@playwright/test';
import { dailyChallenge, dailyKey } from '../src/shared/daily';
import { DAILY_RECT, DAILY_START_RECT } from '../src/ui/titleLayout';
import { CONTINUE_RECT, RETRY_RECT } from '../src/ui/retryMenu';
import { touchLayout } from '../src/ui/touch';
import type { Rect } from '../src/ui/rect';

const API = 'http://localhost:8787';
const OUT = 'e2e/out';
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const NEXT = centre(touchLayout('nameEntry', { tiltAvailable: false, tiltOn: false, cssPerLogical: 1 }).find((b) => b.id === 'next')!.rect);
const RADIO_START = centre(touchLayout('radio', { tiltAvailable: false, tiltOn: false, cssPerLogical: 1 }).find((b) => b.id === 'start')!.rect);
const screenName = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.app.name);

interface Row {
  initials: string;
  score: number;
  car: string;
  stageId: string;
  ending: number | null;
}

/** Un'API finta: classifiche in memoria, /daily con un campione di ieri, POST /score con la posizione. */
async function fakeApi(page: Page, seed: Record<string, Row[]> = {}) {
  const boards: Record<string, Row[]> = { ...seed };
  const posted: Record<string, unknown>[] = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type' };
  const today = dailyKey(new Date());
  const c = dailyChallenge(today);
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/top') {
      const key = `${url.searchParams.get('board')}:${url.searchParams.get('mode')}`;
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ rows: boards[key] ?? [] }) });
    }
    if (url.pathname === '/daily') {
      const page = {
        date: today,
        challenge: { car: c.car, mode: c.mode },
        nextChallengeInMinutes: 300,
        yesterday: { date: 'x', challenge: { car: 'super', mode: 'hard' }, champion: { initials: 'ABC', score: 812345, car: 'super' }, top3: [] },
        today: { top3: [] },
      };
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(page) });
    }
    if (url.pathname === '/score' && req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      posted.push(body);
      const key = `${body.daily ? 'daily' : 'today'}:${body.mode}`;
      const rows = [...(boards[key] ?? []), { initials: body.initials as string, score: body.score as number, car: body.car as string, stageId: body.stageId as string, ending: (body.ending as number) ?? null }].sort((a, b) => b.score - a.score);
      boards[key] = rows;
      const rank = rows.findIndex((r) => r.score === body.score) + 1;
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ rank, total: rows.length }) });
    }
    return route.fulfill({ status: 404, headers: cors });
  });
  return { posted, challenge: c, today };
}

/** Errori del gioco (eccezioni non prese): devono restare zero. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function toPage(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('#game').boundingBox())!;
  return { x: box.x + (p.x * box.width) / 1280, y: box.y + (p.y * box.height) / 720 };
}
async function click(page: Page, p: { x: number; y: number }) {
  const q = await toPage(page, p);
  await page.mouse.click(q.x, q.y);
}
async function tap(page: Page, p: { x: number; y: number }) {
  const q = await toPage(page, p);
  await page.touchscreen.tap(q.x, q.y);
}

/** Un dito tenuto giù (il gas), con il protocollo di Chromium come in touch.spec.ts. */
async function holdFinger(page: Page, p: { x: number; y: number } | null, cdp?: CDPSession): Promise<CDPSession> {
  const session = cdp ?? (await page.context().newCDPSession(page));
  const touchPoints = p === null ? [] : [{ ...(await toPage(page, p)), id: 1 }];
  await session.send('Input.dispatchTouchEvent', { type: p === null ? 'touchEnd' : 'touchStart', touchPoints });
  return session;
}

const GAS = centre(touchLayout('race', { tiltAvailable: false, tiltOn: false, cssPerLogical: 1 }).find((b) => b.id === 'gas')!.rect);

async function boot(page: Page, query = '?board=local') {
  await page.goto(`/${query}#debug`);
  await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
  // Due secondi di tempo: il game over arriva presto.
  await page.evaluate(() => window.__tebrun?.setStartTimeLimit(2));
  await page.waitForTimeout(500);
}

test.describe('DAILY, mouse only', () => {
  test('title, the challenge, the locked radio, the race, game over, initials, the DAILY page with the rank', async ({ page }) => {
    const errors = pageErrors(page);
    const api = await fakeApi(page);
    await boot(page);
    await page.screenshot({ path: `${OUT}/daily-title.png` });
    await click(page, centre(DAILY_RECT));
    await expect.poll(() => screenName(page)).toBe('daily');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/daily-challenge.png` });
    await click(page, centre(DAILY_START_RECT));
    await expect.poll(() => screenName(page)).toBe('radio');
    expect(await page.evaluate(() => [window.__tebrun!.car(), window.__tebrun!.mode()])).toEqual([api.challenge.car, api.challenge.mode]);
    // C sulla radio non cambia l'auto della sfida.
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__tebrun!.car())).toBe(api.challenge.car);
    await page.screenshot({ path: `${OUT}/daily-radio.png` });
    await click(page, { x: 640, y: 560 });
    await expect.poll(() => screenName(page)).toBe('race');
    // In gara il mouse non guida: il gas dalla tastiera, per fare qualche punto.
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/daily-race.png` });
    // Il traffico del giorno: il sale della sfida nella tappa.
    expect(await page.evaluate(() => window.__tebrun!.snapshot()?.stage.trafficSalt)).toBe(api.challenge.trafficSalt);
    await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('gameOver');
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/daily-gameover.png` });
    // La DAILY mondiale è vuota: CONTINUE, poi le iniziali.
    await click(page, centre(CONTINUE_RECT));
    await expect.poll(() => screenName(page)).toBe('nameEntry');
    for (let i = 0; i < 3; i++) {
      await click(page, NEXT);
      await page.waitForTimeout(150);
    }
    await expect.poll(() => screenName(page)).toBe('scores');
    await expect.poll(() => api.posted.length).toBe(1);
    expect(api.posted[0]).toMatchObject({ initials: 'AAA', car: api.challenge.car, mode: api.challenge.mode, daily: api.today, stageId: '0-0', route: '', ending: null });
    expect(api.posted[0].durationMs as number).toBeGreaterThan(2000);
    expect(api.posted[0].durationMs as number).toBeLessThan(6000);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/daily-scores.png` });
    // RETRY rifà la sfida di oggi.
    await page.waitForTimeout(300);
    await click(page, centre(RETRY_RECT));
    await expect.poll(() => screenName(page)).toBe('race');
    expect(await page.evaluate(() => window.__tebrun!.car())).toBe(api.challenge.car);
    expect(errors).toEqual([]);
  });
});

test.describe('world board of today', () => {
  test('a run that only makes the world top 10: initials, sent, and #4 TODAY on the TODAY page', async ({ page }) => {
    const errors = pageErrors(page);
    await page.addInitScript(() => {
      const top = Array.from({ length: 10 }, () => ({ name: 'CPU', score: 9_999_999, stageId: '4-4', route: 'L L L L', date: '2026-10-21T00:00:00.000Z' }));
      localStorage.setItem('tebrun.scores.normal.v1', JSON.stringify(top));
      localStorage.setItem('tebrun.mode.v1', 'normal');
    });
    const row = (initials: string, score: number) => ({ initials, score, car: 'sport', stageId: '3-1', ending: null });
    const api = await fakeApi(page, { 'today:normal': [row('XYZ', 250_000), row('ABC', 120_000), row('QQQ', 90_000)] });
    await boot(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('race');
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('gameOver');
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('nameEntry');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
    }
    await expect.poll(() => screenName(page)).toBe('scores');
    await expect.poll(() => api.posted.length).toBe(1);
    expect(api.posted[0]).not.toHaveProperty('daily');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/board-today.png` });
    // La TOP 10 locale non l'ha presa.
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem('tebrun.scores.normal.v1') ?? '[]').length);
    expect(local).toBe(10);
    expect(errors).toEqual([]);
  });
});

test.describe('offline', () => {
  test('no API at all: DAILY works locally, no initials (no world board), RETRY, no errors', async ({ page }) => {
    const errors = pageErrors(page);
    await page.route(`${API}/**`, (route) => route.abort('internetdisconnected'));
    await boot(page);
    await click(page, centre(DAILY_RECT));
    await expect.poll(() => screenName(page)).toBe('daily');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('race');
    await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('gameOver');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/daily-offline-gameover.png` });
    // Niente CONTINUE: RETRY rifà la sfida.
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('race');
    // Il record DAILY di oggi è salvato in locale.
    const best = await page.evaluate(() => JSON.parse(localStorage.getItem('tebrun.daily.v1') ?? 'null'));
    expect(best?.key).toBe(dailyKey(new Date()));
    expect(errors).toEqual([]);
  });

  test('without ?board=local the dev build asks nothing at all', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith(API)) asked.push(r.url());
    });
    await boot(page, '');
    await click(page, centre(DAILY_RECT));
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('race');
    await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('gameOver');
    expect(asked).toEqual([]);
  });
});

test.describe('DAILY by touch', () => {
  const { defaultBrowserType: _ignored, ...descriptor } = devices['iPhone 13 landscape'];
  test.use(descriptor);

  test('title, the challenge, the radio, the race, game over, initials and the DAILY page, by finger', async ({ page }) => {
    const errors = pageErrors(page);
    const api = await fakeApi(page);
    await boot(page);
    expect(await page.evaluate(() => window.__tebrun?.device())).toBe('touch');
    await tap(page, centre(DAILY_RECT));
    await expect.poll(() => screenName(page)).toBe('daily');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/daily-challenge-phone.png` });
    await tap(page, centre(DAILY_START_RECT));
    await expect.poll(() => screenName(page)).toBe('radio');
    await tap(page, RADIO_START);
    await expect.poll(() => screenName(page)).toBe('race');
    const finger = await holdFinger(page, GAS);
    await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('gameOver');
    await holdFinger(page, null, finger);
    await page.waitForTimeout(900);
    await tap(page, centre(CONTINUE_RECT));
    await expect.poll(() => screenName(page)).toBe('nameEntry');
    for (let i = 0; i < 3; i++) {
      await tap(page, NEXT);
      await page.waitForTimeout(150);
    }
    await expect.poll(() => screenName(page)).toBe('scores');
    await expect.poll(() => api.posted.length).toBe(1);
    expect(api.posted[0]).toMatchObject({ daily: api.today, car: api.challenge.car });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/daily-scores-phone.png` });
    expect(errors).toEqual([]);
  });
});

test.describe('streak of days', () => {
  test('DAY 2 IN A ROW on the title after yesterday and the day before; DAY 3 at the end of today\'s DAILY game', async ({ page }) => {
    const errors = pageErrors(page);
    await fakeApi(page);
    const today = dailyKey(new Date());
    const yesterday = dailyKey(new Date(Date.now() - 24 * 3600 * 1000));
    await page.addInitScript((last) => {
      localStorage.setItem('tebrun.streak.v1', JSON.stringify({ last, count: 2 }));
    }, yesterday);
    await boot(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/streak-title.png` });
    await click(page, centre(DAILY_RECT));
    await expect.poll(() => screenName(page)).toBe('daily');
    await click(page, centre(DAILY_START_RECT));
    await expect.poll(() => screenName(page)).toBe('radio');
    await click(page, { x: 640, y: 560 });
    await expect.poll(() => screenName(page)).toBe('race');
    // Conta al via della gara, col giorno della sfida.
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tebrun.streak.v1') ?? 'null')))
      .toEqual({ last: today, count: 3 });
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('gameOver');
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/streak-gameover.png` });
    expect(errors).toEqual([]);
  });
});
