// Misura ripetibile del caricamento in rete lenta (spec telefono e finali
// §B.3): apre una build con la cache vuota, come un iPhone 13 in
// orizzontale, con la rete rallentata (di norma 4G lento: 1,6 Mbit/s e
// 150 ms), e misura:
// - `titleMs`: dall'inizio della navigazione al titolo pronto (il segno
//   `teb-assets-initial` di src/main.ts);
// - `waitMs`: quanto la gara aspetta gli sprite della prima tappa se si
//   preme start appena il titolo c'è (`teb-stage-wait-start`/`-end`); 0 se
//   non aspetta.
// La usa e2e/subfolder.spec.ts; da sola, contro un indirizzo qualunque:
//
//   node tools/measure-title.mjs https://play.tebrun.io/ [kbps] [latencyMs]

import { chromium, devices } from '@playwright/test';

/** 4G lento del brief: 1,6 Mbit/s in discesa, 150 ms di latenza. */
export const SLOW_4G = { kbps: 1600, latencyMs: 150 };

/**
 * Misura su `page` (un contesto Chromium nuovo, cache vuota). `start`:
 * preme ENTER sul titolo e sulla radio appena possibile e misura l'attesa.
 */
export async function measureTitle(page, url, { kbps = SLOW_4G.kbps, latencyMs = SLOW_4G.latencyMs, start = true } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: latencyMs,
    downloadThroughput: (kbps * 1000) / 8,
    uploadThroughput: (750 * 1000) / 8,
  });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => ['initial', 'all'].includes(document.documentElement.dataset.assets ?? ''), undefined, {
    timeout: 120_000,
    polling: 50,
  });
  const titleMs = await page.evaluate(() => performance.getEntriesByName('teb-assets-initial')[0]?.startTime ?? NaN);
  if (!start) return { titleMs, waitMs: null };
  // Titolo → radio → gara, il più presto possibile.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  // Se la gara aspetta, il segno arriva subito; se non arriva, non aspetta.
  const waited = await page
    .waitForFunction(() => document.documentElement.dataset.stageWait === 'on', undefined, { timeout: 3000, polling: 50 })
    .then(() => true)
    .catch(() => false);
  if (!waited) return { titleMs, waitMs: 0 };
  await page.waitForFunction(() => document.documentElement.dataset.stageWait === 'off', undefined, { timeout: 120_000, polling: 50 });
  const waitMs = await page.evaluate(() => {
    const at = (name) => performance.getEntriesByName(name)[0]?.startTime ?? NaN;
    return at('teb-stage-wait-end') - at('teb-stage-wait-start');
  });
  return { titleMs, waitMs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [url, kbps, latencyMs] = process.argv.slice(2);
  if (!url) {
    console.error('usage: node tools/measure-title.mjs URL [kbps] [latencyMs]');
    process.exit(2);
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13 landscape'], hasTouch: true });
  const page = await context.newPage();
  const out = await measureTitle(page, url, {
    kbps: kbps ? Number(kbps) : SLOW_4G.kbps,
    latencyMs: latencyMs ? Number(latencyMs) : SLOW_4G.latencyMs,
  });
  console.log(JSON.stringify({ url, ...out }));
  await browser.close();
}
