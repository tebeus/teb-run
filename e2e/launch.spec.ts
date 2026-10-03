// Seconda ondata del lancio: schermata di caricamento, schermo intero e link
// a privacy e about. Screenshot in e2e/out/launch-w2a-*.png.

import { expect, test, type Page } from '@playwright/test';

/** Colore del pixel logico (x, y) del canvas. */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(
    ([px, py]) => {
      const canvas = document.getElementById('game') as HTMLCanvasElement;
      const d = canvas.getContext('2d')!.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [x, y],
  );
}

test.describe('loading screen', () => {
  test('appears before the title with a growing bar, then the title comes', async ({ page }) => {
    // Sprite lenti: la schermata deve restare visibile abbastanza da vederla.
    await page.route('**/sprites/**/*.png', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 2500));
      await route.continue();
    });
    await page.goto('/#debug');
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => window.__tebrun === undefined)).toBe(true);
    // Il bordo bianco della barra (640 px al centro, a y = 460).
    expect(await pixel(page, 318, 458)).toEqual([255, 255, 255]);
    await page.screenshot({ path: 'e2e/out/launch-w2a-loading.png' });
    await page.waitForFunction(() => window.__tebrun?.app.name === 'title', undefined, { timeout: 30_000 });
  });
});

test.describe('title links', () => {
  test('privacy and about are drawn on the title; a click opens the page (same tab in dev)', async ({ page }) => {
    // Nessuna rete esterna negli e2e: le pagine del sito sono finte.
    await page.context().route('https://tebrun.io/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>ok</title>' }),
    );
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'e2e/out/launch-w2a-title-links.png' });
    // Sottolineatura di PRIVACY (x 20..132, y 702..704).
    expect(await pixel(page, 60, 702)).toEqual([204, 204, 204]);
    await page.mouse.click(60, 692);
    await page.waitForURL('https://tebrun.io/privacy/');
  });
});

const isFullscreen =(page: Page): Promise<boolean> => page.evaluate(() => document.fullscreenElement !== null);

test.describe('fullscreen', () => {
  test('the button on the title and the radio, F toggles, not in race', async ({ page }) => {
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
    // Il pulsante in basso a destra, dopo la dissolvenza d'ingresso del titolo.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'e2e/out/launch-w2a-title.png' });
    // Clic al centro del pulsante (1280 - 16 - 24, 720 - 16 - 24).
    await page.mouse.click(1240, 680);
    await expect.poll(() => isFullscreen(page)).toBe(true);
    await page.screenshot({ path: 'e2e/out/launch-w2a-fullscreen.png' });
    await page.keyboard.press('KeyF');
    await expect.poll(() => isFullscreen(page)).toBe(false);

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__tebrun?.app.name)).toBe('radio');
    await page.keyboard.press('KeyF');
    await expect.poll(() => isFullscreen(page)).toBe(true);
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'e2e/out/launch-w2a-radio.png' });
    await page.keyboard.press('KeyF');
    await expect.poll(() => isFullscreen(page)).toBe(false);

    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__tebrun?.app.name)).toBe('race');
    await page.keyboard.press('KeyF');
    await page.mouse.click(1240, 680);
    await page.waitForTimeout(300);
    expect(await isFullscreen(page)).toBe(false);
  });
});
