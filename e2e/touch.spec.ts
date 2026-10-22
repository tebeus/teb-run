// Comandi a schermo e tocco (lancio, punti 7 e 14), contro `npm run dev`.
// Telefoni emulati in Chromium (Playwright devices, iPhone e Android): dal
// titolo alla gara solo col dito, gas e sterzo insieme con due dita, pausa
// e ripresa dal pulsante; una partita fino al game over col solo tocco; il
// velo "ruota il telefono" in verticale. Su desktop: il dispositivo resta la
// tastiera e il mouse non guida.

import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';
import { pauseButtons } from '../src/ui/pause';
import { touchLayout } from '../src/ui/touch';
import { CONTINUE_RECT, RETRY_INPUT_DELAY_S, RETRY_RECT } from '../src/ui/retryMenu';
import type { ScreenName } from '../src/ui/fsm';

const screenName = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.app.name);
const snap = (page: Page) =>
  page.evaluate(() => {
    const s = window.__tebrun?.snapshot();
    return s ? { timeLeft: s.timeLeft, kmh: s.kmh, x: s.player.x, countdown: s.countdown ?? null } : null;
  });

/** Il semaforo: null quando è spento (e la gara parte), 'none' senza gara. */
const countdown = (page: Page): Promise<unknown> =>
  page.evaluate(() => {
    const s = window.__tebrun?.snapshot();
    return s ? (s.countdown ?? null) : 'none';
  });

/** Da un punto logico 1280x720 a un punto della pagina, attraverso il letterbox. */
async function toPage(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#game').boundingBox())!;
  return { x: box.x + (p.x * box.width) / 1280, y: box.y + (p.y * box.height) / 720 };
}

/** Quanti px CSS vale un px logico sulla pagina (lo sterzo della gara si misura così). */
async function cssPerLogical(page: Page): Promise<number> {
  return (await page.locator('#game').boundingBox())!.width / 1280;
}

/** Centro logico di un pulsante touch di una schermata, sullo schermo largo `k` px CSS per px logico. */
function button(screen: ScreenName, id: string, k = 1, tiltOn = false): { x: number; y: number } {
  const b = touchLayout(screen, { tiltAvailable: true, tiltOn, cssPerLogical: k }).find((x) => x.id === id)!;
  return { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 };
}

async function tap(page: Page, p: { x: number; y: number }): Promise<void> {
  const q = await toPage(page, p);
  await page.touchscreen.tap(q.x, q.y);
}

const sessions = new WeakMap<Page, CDPSession>();

/** Più dita insieme, con il protocollo di Chromium: i pointer event arrivano come da un telefono. */
async function touches(page: Page, type: 'touchStart' | 'touchEnd', points: { x: number; y: number }[]): Promise<void> {
  // Una sessione per pagina: Chromium ricorda le dita giù per sessione.
  let cdp = sessions.get(page);
  if (cdp === undefined) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  const touchPoints = [];
  for (const [i, p] of points.entries()) touchPoints.push({ ...(await toPage(page, p)), id: i + 1 });
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : touchPoints });
}

async function toRaceByTouch(page: Page, startTimeLimit?: number, startStage?: string): Promise<void> {
  await page.goto('/#debug');
  await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
  expect(await page.evaluate(() => window.__tebrun?.device())).toBe('touch');
  if (startTimeLimit !== undefined) await page.evaluate((s) => window.__tebrun?.setStartTimeLimit(s), startTimeLimit);
  if (startStage !== undefined) await page.evaluate((s) => window.__tebrun?.setStartStage(s), startStage);
  await tap(page, { x: 640, y: 320 });
  await expect.poll(() => screenName(page)).toBe('radio');
  await tap(page, button('radio', 'start'));
  await expect.poll(() => screenName(page)).toBe('race');
}

// `defaultBrowserType` (webkit per l'iPhone) non si può cambiare in un gruppo:
// si prova tutto in Chromium, come chiede il punto 14.
const PHONES = ['iPhone 13 landscape', 'Pixel 7 landscape'] as const;

for (const phone of PHONES) {
  const { defaultBrowserType: _ignored, ...descriptor } = devices[phone];
  const slug = phone.startsWith('iPhone') ? 'iphone' : 'android';

  test.describe(`tocco: ${phone}`, () => {
    test.use(descriptor);

    test('titolo, radio, gara con gas e sterzo insieme, pausa e ripresa', async ({ page }) => {
      await page.goto('/#debug');
      await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
      await tap(page, { x: 640, y: 320 });
      await expect.poll(() => screenName(page)).toBe('radio');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/out/launch-w3a-radio-${slug}.png` });
      await tap(page, button('radio', 'start'));
      await expect.poll(() => screenName(page)).toBe('race');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `e2e/out/launch-w3a-hint-${slug}.png` });
      await expect.poll(() => countdown(page), { timeout: 15_000 }).toBeNull();

      // Due dita: gas e destra insieme.
      const x0 = (await snap(page))!.x;
      await touches(page, 'touchStart', [button('race', 'gas'), button('race', 'right', await cssPerLogical(page))]);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `e2e/out/launch-w3a-controls-${slug}.png` });
      if (slug === 'iphone') await page.screenshot({ path: 'e2e/out/touch-v4.png' });
      const moving = (await snap(page))!;
      await touches(page, 'touchEnd', []);
      expect(moving.kmh).toBeGreaterThan(40);
      expect(moving.x).toBeGreaterThan(x0 + 0.05);

      // Il pulsante pausa apre la stessa pausa di Esc e P: il tempo si ferma.
      await tap(page, button('race', 'pause'));
      await page.waitForTimeout(300);
      const t0 = (await snap(page))!.timeLeft;
      await page.waitForTimeout(1000);
      expect((await snap(page))!.timeLeft).toBe(t0);
      await page.screenshot({ path: `e2e/out/launch-w3a-pause-${slug}.png` });
      const cont = pauseButtons().find((b) => b.choice === 'continue')!;
      await tap(page, { x: cont.x + cont.w / 2, y: cont.y + cont.h / 2 });
      await page.waitForTimeout(1000);
      expect((await snap(page))!.timeLeft).toBeLessThan(t0);
      expect(await screenName(page)).toBe('race');
    });

    test('una partita fino al game over col solo tocco, e RETRY', async ({ page }) => {
      await toRaceByTouch(page, 4);
      await touches(page, 'touchStart', [button('race', 'gas')]);
      await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('gameOver');
      await touches(page, 'touchEnd', []);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e/out/launch-w3a-gameover-${slug}.png` });
      // Un punto dentro sia RETRY sia CONTINUE: con un record si va alle
      // iniziali, senza si riparte. Oltre il mezzo secondo di guardia.
      await page.waitForTimeout(RETRY_INPUT_DELAY_S * 1000);
      const endButton = { x: (CONTINUE_RECT.x + RETRY_RECT.x + RETRY_RECT.w) / 2, y: RETRY_RECT.y + RETRY_RECT.h / 2 };
      await tap(page, endButton);
      await expect.poll(() => screenName(page)).not.toBe('gameOver');
      if ((await screenName(page)) === 'nameEntry') {
        for (let i = 0; i < 3; i++) {
          await tap(page, button('nameEntry', 'next'));
          await page.waitForTimeout(150);
        }
        // Dopo le iniziali, RETRY sulla TOP 10.
        await expect.poll(() => screenName(page)).toBe('scores');
        await page.waitForTimeout(RETRY_INPUT_DELAY_S * 1000 + 100);
        await page.screenshot({ path: `e2e/out/retry-scores-${slug}.png` });
        await tap(page, { x: RETRY_RECT.x + RETRY_RECT.w / 2, y: RETRY_RECT.y + RETRY_RECT.h / 2 });
      }
      await expect.poll(() => screenName(page)).toBe('race');
    });

    test('in verticale: ruota il telefono, e la gara va in pausa', async ({ page }) => {
      await toRaceByTouch(page);
      await expect.poll(() => countdown(page), { timeout: 15_000 }).toBeNull();
      const vp = page.viewportSize()!;
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e/out/launch-w3a-rotate-${slug}.png` });
      const t0 = (await snap(page))!.timeLeft;
      await page.waitForTimeout(800);
      expect((await snap(page))!.timeLeft).toBe(t0);
      // Di nuovo in orizzontale la gara resta in pausa, col menu.
      await page.setViewportSize(vp);
      await page.waitForTimeout(500);
      expect((await snap(page))!.timeLeft).toBe(t0);
    });
  });
}

// Leggibilità dei cerchi su uno sfondo chiaro (sale bianco) e uno scuro (porto sotto la pioggia).
test.describe('tocco, contrasto: iPhone 13 landscape', () => {
  const { defaultBrowserType: _ignored, ...descriptor } = devices['iPhone 13 landscape'];
  test.use(descriptor);

  for (const [stage, look] of [['3-3', 'light'], ['3-0', 'dark']] as const) {
    test(`tappa ${stage} (${look}): gas e sterzo insieme`, async ({ page }) => {
      await toRaceByTouch(page, undefined, stage);
      await expect.poll(() => countdown(page), { timeout: 15_000 }).toBeNull();
      await touches(page, 'touchStart', [button('race', 'gas'), button('race', 'right', await cssPerLogical(page))]);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `e2e/out/touch-v3-${look}.png` });
      const moving = (await snap(page))!;
      await touches(page, 'touchEnd', []);
      expect(moving.kmh).toBeGreaterThan(40);
    });
  }
});

/** Il permesso dei sensori come su iOS, con la risposta scelta (Chromium lo chiede e lo nega da sé). */
async function motionPermission(page: Page, answer: 'granted' | 'denied'): Promise<void> {
  await page.addInitScript((a) => {
    (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission = () =>
      Promise.resolve(a);
  }, answer);
}

// TILT sulla radio: spiegato finché non lo si tocca, acceso pieno, e il permesso negato si dice.
for (const phone of PHONES) {
  const { defaultBrowserType: _ignored, ...descriptor } = devices[phone];
  const suffix = phone.startsWith('iPhone') ? '' : '-android';

  test.describe(`tocco, TILT sulla radio: ${phone}`, () => {
    test.use(descriptor);

    test('TILT OFF con la spiegazione, poi TILT ON acceso e la spiegazione sparisce', async ({ page }) => {
      await motionPermission(page, 'granted');
      await page.goto('/#debug');
      await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
      await tap(page, { x: 640, y: 320 });
      await expect.poll(() => screenName(page)).toBe('radio');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/out/tilt-radio-off${suffix}.png` });
      await tap(page, button('radio', 'tilt'));
      await expect.poll(() => page.evaluate(() => localStorage.getItem('tebrun.tilt.v1'))).toBe('1');
      expect(await page.evaluate(() => localStorage.getItem('tebrun.tiltSeen.v1'))).toBe('1');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/out/tilt-radio-on${suffix}.png` });
    });

    test('permesso negato: MOTION BLOCKED a schermo, e TILT resta spento', async ({ page }) => {
      await motionPermission(page, 'denied');
      await page.goto('/#debug');
      await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
      await tap(page, { x: 640, y: 320 });
      await expect.poll(() => screenName(page)).toBe('radio');
      await tap(page, button('radio', 'tilt'));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/out/tilt-blocked${suffix}.png` });
      expect(await page.evaluate(() => localStorage.getItem('tebrun.tilt.v1'))).toBe('0');
    });
  });
}

// TILT acceso: in gara niente frecce.
test.describe('tocco, TILT in gara: iPhone 13 landscape', () => {
  const { defaultBrowserType: _ignored, ...descriptor } = devices['iPhone 13 landscape'];
  test.use(descriptor);

  for (const tiltOn of [false, true]) {
    test(`TILT ${tiltOn ? 'acceso: niente frecce' : 'spento: frecce'}, il gas va`, async ({ page }) => {
      await motionPermission(page, 'granted');
      await page.goto('/#debug');
      await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
      await tap(page, { x: 640, y: 320 });
      await expect.poll(() => screenName(page)).toBe('radio');
      if (tiltOn) {
        await tap(page, button('radio', 'tilt'));
        await expect.poll(() => page.evaluate(() => localStorage.getItem('tebrun.tilt.v1'))).toBe('1');
      }
      await tap(page, button('radio', 'start'));
      await expect.poll(() => screenName(page)).toBe('race');
      await expect.poll(() => countdown(page), { timeout: 15_000 }).toBeNull();
      const k = await cssPerLogical(page);
      const x0 = (await snap(page))!.x;
      // Gas, e un dito dove con TILT spento c'è la freccia destra.
      await touches(page, 'touchStart', [button('race', 'gas'), button('race', 'right', k)]);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `e2e/out/tilt-race-${tiltOn ? 'on' : 'off'}.png` });
      const moving = (await snap(page))!;
      await touches(page, 'touchEnd', []);
      expect(moving.kmh).toBeGreaterThan(40);
      // Senza sensori che si muovono, con TILT acceso l'auto resta dritta.
      if (tiltOn) expect(Math.abs(moving.x - x0)).toBeLessThan(0.05);
      else expect(moving.x).toBeGreaterThan(x0 + 0.05);
    });
  }
});

// La radio e la gara col tocco su schermi piccoli e grandi: SE, iPhone 14 (844x390), iPad.
const SIZES = [
  { slug: 'iphone-se', device: 'iPhone SE (3rd gen) landscape', viewport: undefined },
  { slug: 'iphone14', device: 'iPhone 13 landscape', viewport: { width: 844, height: 390 } },
  { slug: 'ipad', device: 'iPad (gen 7) landscape', viewport: undefined },
] as const;

for (const size of SIZES) {
  const { defaultBrowserType: _ignored, ...descriptor } = devices[size.device];
  test.describe(`tocco, radio e sterzo: ${size.slug}`, () => {
    test.use(size.viewport === undefined ? descriptor : { ...descriptor, viewport: size.viewport });

    test('la radio a misura di telefono, poi le frecce a un pollice in gara', async ({ page }) => {
      await page.goto('/#debug');
      await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
      await tap(page, { x: 640, y: 320 });
      await expect.poll(() => screenName(page)).toBe('radio');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/out/radio-${size.slug}.png` });
      // Auto e modalità si cambiano toccando i loro pulsanti.
      const car0 = await page.evaluate(() => window.__tebrun?.car());
      await tap(page, button('radio', 'car'));
      await expect.poll(() => page.evaluate(() => window.__tebrun?.car())).not.toBe(car0);
      const mode0 = await page.evaluate(() => window.__tebrun?.mode());
      await tap(page, button('radio', 'mode'));
      await expect.poll(() => page.evaluate(() => window.__tebrun?.mode())).not.toBe(mode0);
      await tap(page, button('radio', 'mode'));
      await tap(page, button('radio', 'start'));
      await expect.poll(() => screenName(page)).toBe('race');
      await expect.poll(() => countdown(page), { timeout: 15_000 }).toBeNull();
      const k = await cssPerLogical(page);
      const x0 = (await snap(page))!.x;
      await touches(page, 'touchStart', [button('race', 'gas'), button('race', 'left', k)]);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `e2e/out/race-${size.slug}.png` });
      const moving = (await snap(page))!;
      await touches(page, 'touchEnd', []);
      expect(moving.kmh).toBeGreaterThan(40);
      expect(moving.x).toBeLessThan(x0 - 0.05);
    });
  });
}

// Schermi quasi quadrati (pieghevoli aperti, iPad in verticale): niente velo, si gioca in letterbox.
test.describe('tocco, schermi quasi quadrati', () => {
  const { defaultBrowserType: _ignored, ...descriptor } = devices['Pixel 7 landscape'];

  for (const shape of [
    { name: '1:1', viewport: { width: 800, height: 800 }, shot: 'fold-square' },
    { name: '4:5', viewport: { width: 720, height: 900 }, shot: 'fold-open' },
  ] as const) {
    test.describe(shape.name, () => {
      test.use({ ...descriptor, viewport: shape.viewport });

      test(`${shape.name}: senza velo, gas e sterzo in letterbox`, async ({ page }) => {
        await toRaceByTouch(page);
        await expect.poll(() => countdown(page), { timeout: 15_000 }).toBeNull();
        const k = await cssPerLogical(page);
        // Il letterbox: largo quanto la finestra, alto 9/16.
        expect(k * 1280).toBeCloseTo(shape.viewport.width, 0);
        const x0 = (await snap(page))!.x;
        await touches(page, 'touchStart', [button('race', 'gas'), button('race', 'left', k)]);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `e2e/out/${shape.shot}.png` });
        const moving = (await snap(page))!;
        await touches(page, 'touchEnd', []);
        expect(moving.kmh).toBeGreaterThan(40);
        expect(moving.x).toBeLessThan(x0 - 0.05);
        // Il tempo scorre: nessun velo, nessuna pausa.
        const t0 = moving.timeLeft;
        await page.waitForTimeout(1200);
        expect((await snap(page))!.timeLeft).toBeLessThan(t0);
      });
    });
  }

  test.describe('aprire il telefono in gara', () => {
    test.use({ ...descriptor, viewport: { width: 832, height: 380 } });

    test('chiuso in orizzontale, poi aperto quasi quadrato col dito sul gas: niente si rompe', async ({ page }) => {
      await toRaceByTouch(page);
      await expect.poll(() => countdown(page), { timeout: 15_000 }).toBeNull();
      await touches(page, 'touchStart', [button('race', 'gas')]);
      await page.waitForTimeout(800);
      expect((await snap(page))!.kmh).toBeGreaterThan(20);
      await page.setViewportSize({ width: 884, height: 1000 });
      await page.waitForTimeout(500);
      await touches(page, 'touchEnd', []);
      expect(await screenName(page)).toBe('race');
      // Il canvas segue: letterbox largo quanto la finestra aperta.
      expect((await cssPerLogical(page)) * 1280).toBeCloseTo(884, 0);
      // Le dita nuove valgono con le misure nuove: il gas riprende.
      const k = await cssPerLogical(page);
      await touches(page, 'touchStart', [button('race', 'gas'), button('race', 'right', k)]);
      await page.waitForTimeout(1500);
      const after = (await snap(page))!;
      await touches(page, 'touchEnd', []);
      expect(after.kmh).toBeGreaterThan(40);
      const t0 = after.timeLeft;
      await page.waitForTimeout(1000);
      expect((await snap(page))!.timeLeft).toBeLessThan(t0);
    });
  });
});

test.describe('desktop senza touch', () => {
  test('solo mouse: titolo, radio (brano, auto), gara, game over, RETRY con la stessa auto, lo stesso brano e la stessa modalità', async ({ page }) => {
    // Una TOP 10 piena di record irraggiungibili: il game over offre RETRY.
    await page.addInitScript(() => {
      const top = Array.from({ length: 10 }, () => ({ name: 'CPU', score: 9_999_999, stageId: '4-4', route: 'L L L L', date: '2026-10-21T00:00:00.000Z' }));
      localStorage.setItem('tebrun.scores.normal.v1', JSON.stringify(top));
    });
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
    await page.evaluate(() => window.__tebrun?.setStartTimeLimit(2));
    await page.mouse.click(640, 300);
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.waitForTimeout(700);
    const car0 = await page.evaluate(() => window.__tebrun!.car());
    await page.mouse.click(160, 200); // l'auto
    await page.mouse.click(640, 130 + 2 * 32 + 8); // il terzo brano: scelto, non parte
    await page.waitForTimeout(300);
    expect(await screenName(page)).toBe('radio');
    const car = await page.evaluate(() => window.__tebrun!.car());
    expect(car).not.toBe(car0);
    await page.mouse.click(640, 560); // fuori dall'elenco: si parte
    await expect.poll(() => screenName(page)).toBe('race');
    await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('gameOver');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'e2e/out/retry-gameover-mouse.png' });
    const mode = await page.evaluate(() => window.__tebrun!.mode());
    await page.mouse.click(550, 654); // RETRY
    await expect.poll(() => screenName(page)).toBe('race');
    expect(await page.evaluate(() => window.__tebrun!.car())).toBe(car);
    expect(await page.evaluate(() => window.__tebrun!.mode())).toBe(mode);
  });

  test('il dispositivo resta la tastiera, il clic parte, il mouse non guida, i comandi a schermo ci sono', async ({ page }) => {
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
    expect(await page.evaluate(() => window.__tebrun?.device())).toBe('keyboard');
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBe(0);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'e2e/out/launch-w3a-radio-desktop.png' });
    // Un clic del mouse fuori dall'elenco dei brani fa partire (ma è il mouse, non il pulsante del tocco).
    await page.mouse.click(button('radio', 'start').x, button('radio', 'start').y);
    await expect.poll(() => screenName(page)).toBe('race');
    expect(await page.evaluate(() => window.__tebrun?.device())).toBe('keyboard');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'e2e/out/launch-w3a-hint-desktop.png' });
    await expect.poll(() => countdown(page), { timeout: 15_000 }).toBeNull();
    // Il mouse tenuto sul gas del telefono non accelera.
    const gas = button('race', 'gas');
    await page.mouse.move(gas.x, gas.y);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();
    expect((await snap(page))!.kmh).toBe(0);
    expect(await page.evaluate(() => window.__tebrun?.device())).toBe('keyboard');
  });
});
