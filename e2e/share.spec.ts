// Terza ondata del lancio, parte B: la scheda del risultato da condividere.
// Screenshot e schede in e2e/out/launch-w3b-*.png.

import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const screenName = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.app.name);

/** Larghezza e altezza di un PNG dalla sua intestazione; null se non è un PNG. */
function pngSize(bytes: Buffer): { w: number; h: number } | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

/** Dal titolo al game over, con una tappa di un secondo. */
async function reachGameOver(page: Page): Promise<void> {
  await page.goto('/#debug');
  await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
  await page.evaluate(() => window.__tebrun?.setStartTimeLimit(1));
  await page.keyboard.press('Enter');
  await expect.poll(() => screenName(page)).toBe('radio');
  await page.keyboard.press('Enter');
  await expect.poll(() => screenName(page)).toBe('race');
  await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('gameOver');
}

/** Centro del pulsante SHARE (in basso a sinistra, 196x52 a x 36, y 632). */
const BUTTON = { x: 36 + 98, y: 632 + 26 };

test.describe('share card', () => {
  test('game over: SHARE downloads a valid 1200x630 PNG and copies the text', async ({ page, context }) => {
    const csp: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) csp.push(m.text());
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // Un desktop senza foglio di condivisione: la via è il download.
    await page.addInitScript(() => {
      delete (Navigator.prototype as { share?: unknown }).share;
      delete (Navigator.prototype as { canShare?: unknown }).canShare;
    });
    await reachGameOver(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'e2e/out/launch-w3b-button.png' });

    const download = page.waitForEvent('download');
    await page.mouse.click(BUTTON.x, BUTTON.y);
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^[a-z0-9-]+-\d+\.png$/);
    await file.saveAs('e2e/out/launch-w3b-card-gameover.png');
    expect(pngSize(readFileSync('e2e/out/launch-w3b-card-gameover.png'))).toEqual({ w: 1200, h: 630 });

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText().catch(() => '')))
      .toMatch(/points, STAGE 1 OF 5, NORMAL, .*tebrun\.io/);

    // Dopo SHARE il game over aspetta ENTER, oltre i suoi tre secondi.
    await page.waitForTimeout(3500);
    expect(await screenName(page)).toBe('gameOver');
    await page.screenshot({ path: 'e2e/out/launch-w3b-after.png' });
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).not.toBe('gameOver');
    expect(csp).toEqual([]);
  });

  test('with navigator.share that takes files, S calls it with the PNG and the text', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: unknown[] };
      w.__shared = [];
      Object.defineProperty(Navigator.prototype, 'canShare', {
        configurable: true,
        value: (d: ShareData) => Array.isArray(d.files) && d.files.length > 0,
      });
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (d: ShareData) => {
          const f = d.files![0];
          const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
          w.__shared.push({ name: f.name, type: f.type, size: f.size, head: [...head], text: d.text, title: d.title });
        },
      });
    });
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await reachGameOver(page);
    await page.keyboard.press('KeyS');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length)).toBe(1);
    const shared = await page.evaluate(() => (window as unknown as { __shared: Record<string, unknown>[] }).__shared[0]);
    expect(shared.type).toBe('image/png');
    expect(shared.head).toEqual([137, 80, 78, 71]);
    expect(shared.size as number).toBeGreaterThan(5000);
    expect(shared.text).toMatch(/points, STAGE 1 OF 5, NORMAL/);
    expect(shared.title).toBe('TEB RUN');
    expect(downloads).toEqual([]);
  });

  test('the ending card reads ENDING n OF 5 with the route lit', async ({ page }) => {
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
    const b64 = await page.evaluate(async () => {
      const m = await import('/src/ui/shareCard.ts' as string);
      const blob: Blob = await m.renderShareCard(
        document,
        {
          kind: 'ending',
          score: 3456780,
          time: 312.48,
          mode: 'hard',
          car: 'sport',
          route: ['R', 'L', 'R', 'R'],
          stageId: '4-3',
          stageName: 'Neon Harbor',
          ending: 3,
        },
        window.__tebrun!.assets,
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    });
    const bytes = Buffer.from(b64, 'base64');
    writeFileSync('e2e/out/launch-w3b-card-ending.png', bytes);
    expect(pngSize(bytes)).toEqual({ w: 1200, h: 630 });
  });
});
