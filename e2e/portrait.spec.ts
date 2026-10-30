// Telefono in verticale (spec telefono e finali §A), contro `npm run dev`:
// si apre in verticale e si vede la tela `#portrait` (illustrazione, logo,
// telefono che gira, sfida di oggi, barra mentre carica); i tocchi non
// arrivano al gioco; girato il telefono si arriva alla gara col dito; di
// nuovo in verticale la gara va in pausa. iPhone SE e iPhone 13, in Chromium.

import { devices, expect, test, type Page } from '@playwright/test';
import { portraitBox } from '../src/ui/portrait';
import { touchLayout } from '../src/ui/touch';

const REPORT = '/Users/teb/project/teb-run-report-telefono';
const screenName = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.app.name);
const timeLeft = (page: Page): Promise<number | undefined> => page.evaluate(() => window.__tebrun?.snapshot()?.timeLeft);

async function tapLogical(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.touchscreen.tap(box.x + (p.x * box.width) / 1280, box.y + (p.y * box.height) / 720);
}

for (const [name, slug] of [['iPhone SE', 'iphone-se'], ['iPhone 13', 'iphone-13']] as const) {
  test.describe(`in verticale: ${name}`, () => {
    const { defaultBrowserType: _ignored, ...descriptor } = devices[name];
    test.use(descriptor);

    test('the portrait screen while loading and on the title, taps do not reach the game, then landscape to the race, and back pauses it', async ({ page }) => {
      test.setTimeout(120_000);
      // Rete lenta per vedere la barra nella tela verticale.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 90_000 });
      await page.goto('/#debug');
      const portrait = page.locator('#portrait');
      await expect(portrait).toBeVisible({ timeout: 30_000 });
      // Il caricamento continua in verticale: la barra c'è finché il titolo non è pronto.
      expect(await page.evaluate(() => document.documentElement.dataset.assets ?? 'loading')).toBe('loading');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${REPORT}/portrait-loading-${slug}.png` });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await page.waitForFunction(() => window.__tebrun?.app.name === 'title', undefined, { timeout: 60_000 });
      await expect(portrait).toBeVisible();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${REPORT}/portrait-title-${slug}.png` });
      const box = (await portrait.boundingBox())!;
      const vp = page.viewportSize()!;
      // La tela copre tutta la finestra: ai lati del disegno 9:16 non si vede il gioco sotto.
      expect(box.width).toBeCloseTo(vp.width, 0);
      expect(box.height).toBeCloseTo(vp.height, 0);
      const inner = portraitBox(vp.width, vp.height);
      for (const x of [1, inner.left - 1, vp.width - 2]) {
        expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id, [Math.max(1, x), vp.height / 2])).toBe('portrait');
      }

      // Un tocco in verticale non arriva al gioco.
      await page.touchscreen.tap(vp.width / 2, vp.height / 2);
      await page.waitForTimeout(500);
      expect(await screenName(page)).toBe('title');

      // Girato il telefono: niente tela, e col dito si arriva alla gara.
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await expect(portrait).toBeHidden();
      await tapLogical(page, { x: 640, y: 320 });
      await expect.poll(() => screenName(page)).toBe('radio');
      const start = touchLayout('radio', { tiltAvailable: true, tiltOn: false, cssPerLogical: 1 }).find((b) => b.id === 'start')!.rect;
      await tapLogical(page, { x: start.x + start.w / 2, y: start.y + start.h / 2 });
      await expect.poll(() => screenName(page)).toBe('race');
      await expect.poll(() => page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null), { timeout: 15_000 }).toBeNull();

      // Di nuovo in verticale: la tela torna e la gara è in pausa.
      await page.setViewportSize(vp);
      await expect(portrait).toBeVisible();
      await page.waitForTimeout(300);
      const t0 = await timeLeft(page);
      await page.waitForTimeout(800);
      expect(await timeLeft(page)).toBe(t0);
      await page.screenshot({ path: `${REPORT}/portrait-race-paused-${slug}.png` });
    });
  });
}
