// Qualità della build leggera (lancio, punto 12): gli stessi quadri con gli
// sprite PNG del repo e con i WebP che finiscono nelle build site e portal.
// Il server di sviluppo serve i PNG; per il giro WebP ogni richiesta di
// /sprites/*.png riceve il .webp che tools/webp-sprites.py ne fa per la
// build (stessa cache, stessi parametri). Screenshot in e2e/out/light-*.png,
// da guardare a occhio: qui si controlla solo che i due giri disegnino.

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Kind = 'png' | 'webp';

let webpDir = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  test.setTimeout(180_000);
  webpDir = mkdtempSync(join(tmpdir(), 'teb-light-'));
  const names = readdirSync('public/sprites').filter((name) => name.endsWith('.png'));
  execFileSync('python3', ['tools/webp-sprites.py', 'public/sprites', webpDir, '.cache/teb-webp', ...names], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
});

test.afterAll(() => {
  if (webpDir) rmSync(webpDir, { recursive: true, force: true });
});

/** Con `webp`, ogni sprite PNG chiesto arriva come il WebP della build. */
async function serve(page: Page, kind: Kind): Promise<{ webp: number }> {
  const count = { webp: 0 };
  if (kind === 'webp') {
    await page.route(/\/sprites\/[^/?]+\.png(\?.*)?$/, async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop()!.replace(/\.png$/, '.webp');
      count.webp++;
      await route.fulfill({ status: 200, contentType: 'image/webp', body: readFileSync(join(webpDir, name)) });
    });
  }
  return count;
}

/**
 * La partenza di una tappa nel gioco vero, durante il semaforo: l'auto è
 * ferma, quindi i due giri disegnano quasi lo stesso quadro.
 */
async function stageShot(page: Page, kind: Kind, stage: string, label: string): Promise<void> {
  const count = await serve(page, kind);
  await page.goto('/#debug');
  await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
  await page.evaluate((id) => window.__tebrun?.setStartStage(id), stage);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__tebrun?.app.name === 'radio');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__tebrun?.app.name === 'race');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `e2e/out/light-${label}-${kind}.png` });
  await page.screenshot({ path: `e2e/out/light-${label}-${kind}-zoom.png`, clip: { x: 0, y: 160, width: 640, height: 360 } });
  if (kind === 'webp') expect(count.webp).toBeGreaterThan(100);
}

for (const kind of ['png', 'webp'] as const) {
  test(`${kind}: first stage, mid scenery`, async ({ page }) => {
    await stageShot(page, kind, '0-0', 'race-0-0');
  });

  test(`${kind}: a stage with rain`, async ({ page }) => {
    await stageShot(page, kind, '3-0', 'race-3-0-rain');
  });

  test(`${kind}: a stage with snow`, async ({ page }) => {
    await stageShot(page, kind, '4-1', 'race-4-1-snow');
  });

  test(`${kind}: title`, async ({ page }) => {
    const count = await serve(page, kind);
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/out/light-title-${kind}.png` });
    await page.screenshot({ path: `e2e/out/light-title-${kind}-zoom.png`, clip: { x: 320, y: 60, width: 640, height: 360 } });
    if (kind === 'webp') expect(count.webp).toBeGreaterThan(50);
  });

  test(`${kind}: ending illustration with its border, as the ending screen draws it`, async ({ page }) => {
    await serve(page, kind);
    await page.goto('/#debug');
    await page.waitForFunction(() => document.documentElement.dataset.assets === 'all');
    // Sopra il canvas del gioco, che continua a disegnare il titolo.
    await page.evaluate(() => {
      const assets = window.__tebrun!.assets;
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99';
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 1280, 720);
      const art = assets.get('ending_3');
      ctx.drawImage(art.image, 0, 0, 1280, 720);
      const border = assets.get('ending_border');
      ctx.drawImage(border.image, 0, 0, 1280, 720);
      document.body.appendChild(canvas);
    });
    await page.screenshot({ path: `e2e/out/light-ending-${kind}.png` });
    await page.screenshot({ path: `e2e/out/light-ending-${kind}-zoom.png`, clip: { x: 320, y: 180, width: 640, height: 360 } });
  });
}
