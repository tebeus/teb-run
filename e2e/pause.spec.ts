// Pausa in gara (lancio, punto 5), contro `npm run dev`: Esc ferma il
// tempo, CONTINUE lo fa ripartire, la perdita del fuoco mette in pausa da
// sola, e i pulsanti del menu si cliccano.

import { expect, test, type Page } from '@playwright/test';
import { pauseButtons } from '../src/ui/pause';

const screenName = (page: Page): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.app.name);
const timeLeft = (page: Page): Promise<number> =>
  page.evaluate(() => window.__tebrun?.snapshot()?.timeLeft ?? -1);

/** Dal titolo alla gara, a semaforo spento e con un secondo di gas. */
async function enterRace(page: Page): Promise<void> {
  await page.goto('/#debug');
  await page.waitForFunction(() => window.__tebrun !== undefined);
  await expect.poll(() => screenName(page)).toBe('title');
  await page.keyboard.press('Enter');
  await expect.poll(() => screenName(page)).toBe('radio');
  await page.keyboard.press('Enter');
  await expect.poll(() => screenName(page)).toBe('race');
  await expect
    .poll(() => page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null), { timeout: 15_000 })
    .toBeNull();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1000);
}

/** Centro di un pulsante del menu: il viewport è 1280x720, come il canvas logico. */
function centreOf(choice: string): { x: number; y: number } {
  const b = pauseButtons().find((button) => button.choice === choice)!;
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

test.describe('pausa', () => {
  test('Esc mette in pausa e il tempo non scende; CONTINUE riprende', async ({ page }) => {
    await enterRace(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const t0 = await timeLeft(page);
    await page.waitForTimeout(1500);
    expect(await timeLeft(page)).toBe(t0);
    expect(await screenName(page)).toBe('race');
    await page.screenshot({ path: 'e2e/out/launch-w2b-pause.png' });

    // Il gas ancora tenuto non muove il cursore: Invio sceglie CONTINUE.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    const t1 = await timeLeft(page);
    expect(t1).toBeLessThan(t0 - 0.5);
    // Niente salto: in un secondo di gara il tempo scende di poco più di un secondo, non dei 2.7 s passati.
    expect(t0 - t1).toBeLessThan(1.4);
    await page.keyboard.up('ArrowUp');
  });

  test('blur mette in pausa; RESTART e TITLE si cliccano', async ({ page }) => {
    await enterRace(page);
    await page.keyboard.up('ArrowUp');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(200);
    const t0 = await timeLeft(page);
    await page.waitForTimeout(1000);
    expect(await timeLeft(page)).toBe(t0);
    await page.screenshot({ path: 'e2e/out/launch-w2b-blur.png' });

    // RESTART col mouse: stessa schermata, gara nuova, semaforo di nuovo acceso.
    const restart = centreOf('restart');
    await page.mouse.click(restart.x, restart.y);
    await expect
      .poll(() => page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null))
      .not.toBeNull();
    expect(await screenName(page)).toBe('race');
    expect(await timeLeft(page)).toBeGreaterThan(t0);

    // P apre, Giù due volte porta a TITLE, e il clic su TITLE torna al titolo.
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(100);
    // Un tick per pressione: due press nello stesso fotogramma valgono uno.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'e2e/out/launch-w2b-title-selected.png' });
    const title = centreOf('title');
    await page.mouse.click(title.x, title.y);
    await expect.poll(() => screenName(page)).toBe('title');
  });

  test('pausa al semaforo: il menu non si sovrappone a READY', async ({ page }) => {
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun !== undefined);
    await expect.poll(() => screenName(page)).toBe('title');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('race');
    await expect
      .poll(() => page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null))
      .not.toBeNull();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const c0 = await page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null);
    expect(c0).not.toBeNull();
    await page.screenshot({ path: 'e2e/out/fix-pause-countdown.png' });
    // Il conto alla rovescia resta fermo con la pausa e riparte a CONTINUE.
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null)).toBe(c0);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null))
      .not.toBe(c0);
  });

  test('Esc sulla radio torna al titolo', async ({ page }) => {
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun !== undefined);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.keyboard.press('Escape');
    await expect.poll(() => screenName(page)).toBe('title');
  });
});
