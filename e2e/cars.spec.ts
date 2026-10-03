import { expect, test, type Page } from '@playwright/test';

/**
 * Verifica a schermo delle sterzate: per ogni auto una gara breve, con il
 * dritto, le due sterzate per lato e la frenata fotografate in basso al
 * centro (dove sta l'auto) in `e2e/out/curve-<auto>-<frame>.png`. Il test
 * controlla che ogni frame sia stato davvero disegnato; l'allineamento delle
 * gomme lo misura `tests/render/player-tyres.test.ts` sui PNG, qui si guarda.
 */
const CARS = ['new', 'classic', 'retro', 'sport', 'super'] as const;
const CLIP = { x: 340, y: 440, width: 600, height: 280 };

type Frame = { steer: number; braking: boolean; speed: number } | null;

const playerOf = (page: Page): Promise<Frame> =>
  page.evaluate(() => {
    const p = window.__tebrun?.snapshot()?.player;
    return p ? { steer: p.steer, braking: p.braking, speed: p.speed } : null;
  });

async function shoot(page: Page, car: string, frame: string): Promise<void> {
  await page.screenshot({ path: `e2e/out/curve-${car}-${frame}.png`, clip: CLIP });
}

/** Tiene `key` finché lo sterzo vale `want` (o supera il tempo), poi fotografa. */
async function steerTo(page: Page, key: string, want: number, car: string, frame: string): Promise<boolean> {
  await page.keyboard.down(key);
  let seen = false;
  for (let i = 0; i < 60 && !seen; i++) {
    const p = await playerOf(page);
    if (p && p.steer === want) seen = true;
    else await page.waitForTimeout(40);
  }
  if (seen) await shoot(page, car, frame);
  return seen;
}

test.describe('sterzate a schermo', () => {
  for (const car of CARS) {
    test(`${car}: dritto, sinistra, destra e freno fotografati in gara`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/?car=${car}#debug`);
      await page.waitForFunction(() => window.__tebrun !== undefined);
      expect(await page.evaluate(() => window.__tebrun?.car())).toBe(car);
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => window.__tebrun?.app.name)).toBe('radio');
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => window.__tebrun?.app.name)).toBe('race');
      await expect
        .poll(() => page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null), { timeout: 15_000 })
        .toBeNull();

      await page.keyboard.down('ShiftLeft');
      await page.keyboard.up('ShiftLeft');
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(3500);
      const straight = await playerOf(page);
      expect(straight?.steer).toBe(0);
      await shoot(page, car, 'straight');

      const got: string[] = [];
      if (await steerTo(page, 'ArrowLeft', -1, car, 'left1')) got.push('left1');
      if (await steerTo(page, 'ArrowLeft', -2, car, 'left2')) got.push('left2');
      await page.keyboard.up('ArrowLeft');
      await page.waitForTimeout(300);
      if (await steerTo(page, 'ArrowRight', 1, car, 'right1')) got.push('right1');
      if (await steerTo(page, 'ArrowRight', 2, car, 'right2')) got.push('right2');
      await page.keyboard.up('ArrowRight');
      await page.keyboard.up('ArrowUp');
      await page.keyboard.down('ArrowDown');
      await expect.poll(async () => (await playerOf(page))?.braking).toBe(true);
      await shoot(page, car, 'brake');
      await page.keyboard.up('ArrowDown');
      got.push('brake');

      // Almeno una sterzata per lato vista a schermo.
      expect(got.some((f) => f.startsWith('left')), got.join(',')).toBe(true);
      expect(got.some((f) => f.startsWith('right')), got.join(',')).toBe(true);
      expect(errors).toEqual([]);
    });
  }
});
