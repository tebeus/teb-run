// La collezione dei finali (spec telefono e finali §C), contro `npm run dev`:
// la voce ENDINGS del titolo (con il conto alla rovescia della sfida sotto
// DAILY), la pagina con le carte e la mappa, col mouse e col tocco; poi una
// gara corta fino al traguardo per vedere NEW ENDING! e il finale salvato.

import { devices, expect, test, type Page } from '@playwright/test';
import { ENDINGS_BACK_RECT, ENDINGS_VIEW_RECT } from '../src/ui/endingsLayout';
import { ENDINGS_RECT } from '../src/ui/titleLayout';

const REPORT = '/Users/teb/project/teb-run-report-telefono';
const SEEDED = { seen: [1, 3], stages: ['0-0', '1-0', '1-1', '2-1', '3-1', '4-2'], migrated: true };
const screenName = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.app.name);
const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

async function toPage(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#game').boundingBox())!;
  return { x: box.x + (p.x * box.width) / 1280, y: box.y + (p.y * box.height) / 720 };
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('seeded') === null) {
      localStorage.setItem('tebrun.endings.v1', value);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(SEEDED));
  await page.goto('/#debug');
  await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'all', undefined, { timeout: 60_000 });
}

test('mouse: ENDINGS 2 / 5 on the title, the page with two cards open, the map, back to the title', async ({ page }) => {
  await seed(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${REPORT}/title-countdown-endings.png` });
  const click = async (p: { x: number; y: number }): Promise<void> => {
    const q = await toPage(page, p);
    await page.mouse.click(q.x, q.y);
  };
  await click(centre(ENDINGS_RECT));
  await expect.poll(() => screenName(page)).toBe('endings');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${REPORT}/endings-page-mouse.png` });
  await click(centre(ENDINGS_VIEW_RECT));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${REPORT}/endings-map-mouse.png` });
  await click(centre(ENDINGS_BACK_RECT));
  await expect.poll(() => screenName(page)).toBe('title');
});

test.describe('touch', () => {
  const { defaultBrowserType: _ignored, ...descriptor } = devices['iPhone 13 landscape'];
  test.use(descriptor);

  test('a finger on ENDINGS opens the page, MAP and BACK work', async ({ page }) => {
    await seed(page);
    const tap = async (p: { x: number; y: number }): Promise<void> => {
      const q = await toPage(page, p);
      await page.touchscreen.tap(q.x, q.y);
    };
    await tap(centre(ENDINGS_RECT));
    await expect.poll(() => screenName(page)).toBe('endings');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${REPORT}/endings-page-touch.png` });
    await tap(centre(ENDINGS_VIEW_RECT));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${REPORT}/endings-map-touch.png` });
    await tap(centre(ENDINGS_BACK_RECT));
    await expect.poll(() => screenName(page)).toBe('title');
  });
});

test('a short race to the finish line: NEW ENDING! with the new count, and the ending is saved', async ({ page }) => {
  test.setTimeout(300_000);
  await seed(page);
  // L'ultima tappa del percorso tutto a destra, con tanto tempo: il finale 5.
  await page.evaluate(() => {
    window.__tebrun?.setStartStage('4-4');
    window.__tebrun?.setStartTimeLimit(900);
  });
  await page.keyboard.press('Enter');
  await expect.poll(() => screenName(page)).toBe('radio');
  await page.keyboard.press('Enter');
  await expect.poll(() => screenName(page)).toBe('race');
  await page.waitForFunction(() => window.__tebrun?.snapshot()?.countdown === undefined, undefined, { timeout: 15_000 });
  await page.keyboard.down('ArrowUp');
  await page.keyboard.press('ShiftLeft');
  let held: string | null = null;
  const deadline = Date.now() + 260_000;
  while (Date.now() < deadline && (await screenName(page)) === 'race') {
    const x = await page.evaluate(() => window.__tebrun?.snapshot()?.player.x ?? 0);
    const want = x > 0.15 ? 'ArrowLeft' : x < -0.15 ? 'ArrowRight' : null;
    if (want !== held) {
      if (held !== null) await page.keyboard.up(held);
      if (want !== null) await page.keyboard.down(want);
      held = want;
    }
    await page.waitForTimeout(50);
  }
  if (held !== null) await page.keyboard.up(held);
  await page.keyboard.up('ArrowUp');
  expect(await screenName(page)).toBe('ending');
  // NEW ENDING! lampeggia ogni mezzo secondo: fra 1,0 e 1,5 s è acceso.
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${REPORT}/new-ending.png` });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tebrun.endings.v1') ?? '{}') as { seen: number[] });
  expect(saved.seen).toEqual([1, 3, 5]);
});
