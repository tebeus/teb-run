// La prima tappa in NORMAL senza mai cambiare marcia (spec prima tappa e
// ritorno §6): dal titolo al primo checkpoint, col mouse e col tocco, con il
// tempo vero della tabella (110 s). Lo sterzo è un principiante semplice che
// legge lo snapshot di `#debug` e tiene una corsia; il gas è sempre giù.
// Lungo la strada: l'aiuto marcia, il cartello prima del bivio e il lato
// preso, fotografati.

import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';
import { touchLayout } from '../src/ui/touch';

const OUT = 'e2e/out';
const screenName = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.app.name);

async function toPage(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#game').boundingBox())!;
  return { x: box.x + (p.x * box.width) / 1280, y: box.y + (p.y * box.height) / 720 };
}
function button(screen: 'radio' | 'race', id: string, k = 1): { x: number; y: number } {
  const b = touchLayout(screen, { tiltAvailable: false, tiltOn: false, cssPerLogical: k }).find((x) => x.id === id)!;
  return { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 };
}

/** Lo stato che serve al principiante e alle foto, letto dallo snapshot. */
interface Look {
  x: number;
  gear: string;
  stage: string;
  banner: string;
  taken: string | null;
  countdown: boolean;
  timeLeft: number;
  speed: number;
}
const look = (page: Page): Promise<Look | null> =>
  page.evaluate(() => {
    const s = window.__tebrun?.snapshot();
    if (!s) return null;
    return {
      x: s.player.x,
      gear: s.player.gear,
      stage: s.stage.id,
      banner: s.banner,
      taken: s.forkTaken ?? null,
      countdown: s.countdown !== undefined,
      timeLeft: s.timeLeft,
      speed: s.player.speed,
    };
  });

/** Dove sterzare: verso una corsia (x = 0,5), con una zona morta da principiante. */
const TARGET_X = 0.5;
const DEAD = 0.1;
const steerFor = (x: number): 'left' | 'right' | null => (x > TARGET_X + DEAD ? 'left' : x < TARGET_X - DEAD ? 'right' : null);

/**
 * Guida finché la tappa non cambia (il primo checkpoint), con `steer` che
 * applica la decisione. Fotografa al primo aiuto marcia, al cartello e al
 * lato preso; controlla che la marcia resti bassa.
 */
async function driveToCheckpoint(page: Page, slug: string, steer: (dir: 'left' | 'right' | null) => Promise<void>): Promise<{ gears: Set<string>; shots: Set<string> }> {
  const gears = new Set<string>();
  const shots = new Set<string>();
  const deadline = Date.now() + 160_000;
  let hintSince: number | null = null;
  while (Date.now() < deadline) {
    const s = await look(page);
    if (s === null) break;
    if (s.stage !== '0-0') break;
    expect(s.timeLeft, 'time ran out in the 0-0').toBeGreaterThan(0);
    if (!s.countdown) gears.add(s.gear);
    await steer(s.countdown ? null : steerFor(s.x));
    // L'aiuto marcia si vede dopo 2 s al massimo della bassa: lo si
    // fotografa poco dopo.
    if (s.gear === 'lo' && s.speed > 0) hintSince ??= Date.now();
    if (!shots.has('hint') && hintSince !== null && Date.now() - hintSince > 6_000) {
      await page.screenshot({ path: `${OUT}/first-stage-gear-hint-${slug}.png` });
      shots.add('hint');
    }
    if (!shots.has('ahead') && s.banner === 'forkAhead') {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/first-stage-fork-ahead-${slug}.png` });
      shots.add('ahead');
    }
    if (!shots.has('taken') && s.taken !== null) {
      await page.screenshot({ path: `${OUT}/first-stage-fork-taken-${slug}.png` });
      shots.add('taken');
    }
    await page.waitForTimeout(80);
  }
  return { gears, shots };
}

test.describe('first stage in NORMAL without ever shifting', () => {
  test('mouse: title and radio by click, gas held, low gear all the way to the first checkpoint', async ({ page }) => {
    test.setTimeout(200_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
    expect(await page.evaluate(() => window.__tebrun?.mode())).toBe('normal');
    const title = await toPage(page, { x: 640, y: 300 });
    await page.mouse.click(title.x, title.y);
    await expect.poll(() => screenName(page)).toBe('radio');
    const start = await toPage(page, { x: 640, y: 560 });
    await page.mouse.click(start.x, start.y);
    await expect.poll(() => screenName(page)).toBe('race');
    expect((await look(page))?.stage).toBe('0-0');
    // Il mouse non guida: gas e sterzo dalla tastiera, mai Shift.
    await page.keyboard.down('ArrowUp');
    let held: 'left' | 'right' | null = null;
    const { gears, shots } = await driveToCheckpoint(page, 'keyboard', async (dir) => {
      if (dir === held) return;
      if (held !== null) await page.keyboard.up(held === 'left' ? 'ArrowLeft' : 'ArrowRight');
      if (dir !== null) await page.keyboard.down(dir === 'left' ? 'ArrowLeft' : 'ArrowRight');
      held = dir;
    });
    await expect.poll(async () => (await look(page))?.stage, { timeout: 5_000 }).toMatch(/^1-[01]$/);
    await page.screenshot({ path: `${OUT}/first-stage-checkpoint-keyboard.png` });
    await page.keyboard.up('ArrowUp');
    expect([...gears]).toEqual(['lo']);
    expect([...shots].sort()).toEqual(['ahead', 'hint', 'taken']);
    expect(errors).toEqual([]);
  });

  const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7 landscape'];
  test.describe('touch', () => {
    test.use(phone);

    test('touch: title and radio by tap, a finger on GAS, low gear all the way to the first checkpoint', async ({ page }) => {
      test.setTimeout(200_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('/#debug');
      await page.waitForFunction(() => window.__tebrun?.app.name === 'title');
      expect(await page.evaluate(() => window.__tebrun?.device())).toBe('touch');
      const t = await toPage(page, { x: 640, y: 320 });
      await page.touchscreen.tap(t.x, t.y);
      await expect.poll(() => screenName(page)).toBe('radio');
      const s = await toPage(page, button('radio', 'start'));
      await page.touchscreen.tap(s.x, s.y);
      await expect.poll(() => screenName(page)).toBe('race');
      const k = (await page.locator('#game').boundingBox())!.width / 1280;
      const cdp: CDPSession = await page.context().newCDPSession(page);
      const gas = { ...(await toPage(page, button('race', 'gas', k))), id: 1 };
      const left = { ...(await toPage(page, button('race', 'left', k))), id: 2 };
      const right = { ...(await toPage(page, button('race', 'right', k))), id: 3 };
      // Il dito sul gas resta giù; un secondo dito va e viene sullo sterzo.
      // In Chromium `touchEnd` alza le dita che elenca (misurato: con il dito
      // del gas nell'elenco si alzava il gas, non lo sterzo).
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [gas] });
      let held: 'left' | 'right' | null = null;
      const { gears, shots } = await driveToCheckpoint(page, 'touch', async (dir) => {
        if (dir === held) return;
        if (held !== null) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [held === 'left' ? left : right] });
        if (dir !== null) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [gas, dir === 'left' ? left : right] });
        held = dir;
      });
      await expect.poll(async () => (await look(page))?.stage, { timeout: 5_000 }).toMatch(/^1-[01]$/);
      await page.screenshot({ path: `${OUT}/first-stage-checkpoint-touch.png` });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: held === null ? [gas] : [gas, held === 'left' ? left : right] });
      expect([...gears]).toEqual(['lo']);
      expect([...shots].sort()).toEqual(['ahead', 'hint', 'taken']);
      expect(errors).toEqual([]);
    });
  });
});
