import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { CARS, playerFrame } from '../../src/game/car';
import { fillScale, MAX_FILL_SCALE, playerCarSize } from '../../src/render/world';
import { makeAsset } from '../helpers/segments';
import { lastOpaqueRow, readPngAlpha, type PngAlpha } from '../helpers/png';
import { NO_ART } from '../helpers/art';

/** Prima riga con almeno un pixel di alfa oltre la soglia di `contentTopFraction` (32). */
const firstOpaqueRow = (img: PngAlpha, threshold = 32): number => {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) if (img.alpha(x, y) > threshold) return y;
  }
  return 0;
};

describe('fillScale', () => {
  test('lo stesso riempimento del dritto non cambia la scala', () => {
    expect(fillScale(0.1, 0.1)).toBe(1);
  });

  test('una carrozzeria che parte più in basso si ingrandisce quanto serve', () => {
    // Dritto pieno al 91,5 %, frame al 80,5 %: serve 0,915 / 0,805.
    expect(fillScale(17 / 200, 39 / 200)).toBeCloseTo((1 - 17 / 200) / (1 - 39 / 200), 6);
  });

  test('non rimpicciolisce mai e non supera il tetto', () => {
    expect(fillScale(0.3, 0.1)).toBe(1);
    expect(fillScale(0, 0.9)).toBe(MAX_FILL_SCALE);
  });

  test('dati non validi non cambiano niente', () => {
    expect(fillScale(Number.NaN, 0.1)).toBe(1);
    expect(fillScale(0.1, -1)).toBe(1);
    expect(fillScale(1, 0.1)).toBe(1);
  });
});

/**
 * Collaudo: la supercar in curva sembrava più piccola del 7-13 %. Con la
 * correzione di `drawPlayerCar` l'altezza VISIBILE dell'auto (dalla prima
 * all'ultima riga piena) resta quella del dritto, per ogni auto.
 */
const FRAMES = ['left1', 'left2', 'right1', 'right2', 'brake'] as const;
const WIDTH = 1280;

const visibleHeight = (car: (typeof CARS)[number], frame: string): number => {
  const sn = playerFrame(car, 'straight');
  const n = playerFrame(car, frame);
  const sPng = readPngAlpha(`public/sprites/${sn}.png`);
  const png = readPngAlpha(`public/sprites/${n}.png`);
  const straight = makeAsset(sn, sPng.w, sPng.h, { kind: 'player', scale: CATALOG[sn].scale });
  const asset = makeAsset(n, png.w, png.h, { kind: 'player', scale: CATALOG[n].scale });
  const { h } = playerCarSize(straight, asset, WIDTH);
  const fill =
    frame === 'straight' ? 1 : fillScale(firstOpaqueRow(sPng) / sPng.h, firstOpaqueRow(png) / png.h);
  const rows = lastOpaqueRow(png) + 1 - firstOpaqueRow(png);
  return (h * fill * rows) / png.h;
};

describe.skipIf(NO_ART)("l'auto non cambia altezza a schermo passando dal dritto alle curve", () => {
  test.each(CARS.flatMap((car) => FRAMES.map((f) => [car, f] as const)))(
    '%s %s: altezza visibile entro il 4 % del dritto',
    (car, frame) => {
      const straight = visibleHeight(car, 'straight');
      expect(Math.abs(visibleHeight(car, frame) - straight) / straight).toBeLessThanOrEqual(0.04);
    },
  );
});
