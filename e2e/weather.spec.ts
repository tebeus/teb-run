// Uno screenshot per meteo, dalla pagina del motore: `dev/motore.html`
// monta una tappa sola su `createRace`, senza traffico, senza tempo e
// senza incidenti, quindi ci si arriva in due secondi invece di tre
// tappe. Il gioco vero ha i suoi cinque test in `game.spec.ts`, che
// questo file non tocca (spec §16, §4.4f).

import { expect, test, type Page } from '@playwright/test';
import { STAGE_WEATHER } from '../src/game/stages';

/** Le sei tappe con meteo, più due serene di controllo (spec §4.4f). */
const CASES: readonly { id: string; label: string }[] = [
  { id: '3-0', label: 'rain-town' },
  { id: '4-2', label: 'rain-farm' },
  { id: '3-1', label: 'snow-ridge' },
  { id: '4-1', label: 'snow-glacier' },
  { id: '3-3', label: 'dust-salt' },
  { id: '4-3', label: 'dust-dune' },
  { id: '2-0', label: 'clear-canyon' },
  { id: '2-2', label: 'clear-fields' },
];

/** Guida dritto a tavoletta per `seconds`, poi lascia. */
async function drive(page: Page, seconds: number): Promise<void> {
  await page.keyboard.down('ArrowUp');
  // La marcia alta: senza, non si supera il 55% e la strada scorre piano.
  await page.keyboard.press('Shift');
  await page.waitForTimeout(seconds * 1000);
  await page.keyboard.up('ArrowUp');
}

/** Firma del fotogramma: un campione di pixel, per vedere se cambia. */
async function frameHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    return canvas.toDataURL('image/png').slice(-256);
  });
}

test.describe('meteo e superfici', () => {
  test('the six stages with weather are the ones the spec declares', () => {
    expect(Object.keys(STAGE_WEATHER).sort()).toEqual(['3-0', '3-1', '3-3', '4-1', '4-2', '4-3']);
  });

  for (const { id, label } of CASES) {
    test(`stage ${id} (${label}) drives for two seconds with no console error, and the frame moves`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(`/dev/motore.html?stage=${id}&assets=real`);
      // La pagina parte quando gli asset sono pronti: si aspetta che il
      // canvas abbia disegnato qualcosa invece di un timeout fisso.
      await page.waitForFunction(() => {
        const canvas = document.getElementById('game') as HTMLCanvasElement | null;
        return canvas !== null && canvas.width === 1280;
      });
      await page.waitForTimeout(500);

      const before = await frameHash(page);
      await drive(page, 2);
      const after = await frameHash(page);
      expect(after, 'il fotogramma deve cambiare: la strada scorre').not.toBe(before);

      await page.screenshot({ path: `e2e/out/weather-${id}-${label}.png` });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('a stage with no weather and a stage with rain do not draw the same frame', async ({ page }) => {
    const shot = async (id: string): Promise<string> => {
      await page.goto(`/dev/motore.html?stage=${id}&assets=real`);
      await page.waitForFunction(() => {
        const canvas = document.getElementById('game') as HTMLCanvasElement | null;
        return canvas !== null && canvas.width === 1280;
      });
      await page.waitForTimeout(500);
      return frameHash(page);
    };
    // 3-2 Vine Hills e 4-2 Windmill Coast sono entrambe `farm`: la sola
    // differenza è il meteo e la palette della tappa (spec §4.4f).
    expect(await shot('4-2')).not.toBe(await shot('3-2'));
  });
});
