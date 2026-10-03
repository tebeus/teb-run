import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { CARS, playerFrame } from '../../src/game/car';
import { PLAYER_CAR_BOTTOM, playerCarSize } from '../../src/render/world';
import { makeAsset } from '../helpers/segments';
import { lastOpaqueRow, readPngAlpha } from '../helpers/png';
import { NO_ART } from '../helpers/art';

/**
 * Le sterzate non devono far «volare» l'auto: passando dal dritto a sinistra,
 * destra o freno, il fondo delle gomme resta alla stessa riga dello schermo.
 * Si misura l'ultima riga non trasparente di ciascun PNG lavorato e la si
 * porta a schermo come fa `drawPlayerCar` (ancoraggio in basso, altezza del
 * dritto della stessa auto, oscillazione a zero), a 1280×720.
 */
const FRAMES = ['straight', 'left1', 'left2', 'right1', 'right2', 'brake'] as const;
const WIDTH = 1280;
const HEIGHT = 720;

const tyreRow = (car: (typeof CARS)[number], frame: string): number => {
  const sn = playerFrame(car, 'straight');
  const n = playerFrame(car, frame);
  const straightPng = readPngAlpha(`public/sprites/${sn}.png`);
  const png = readPngAlpha(`public/sprites/${n}.png`);
  const straight = makeAsset(sn, straightPng.w, straightPng.h, { kind: 'player', scale: CATALOG[sn].scale });
  const asset = makeAsset(n, png.w, png.h, { kind: 'player', scale: CATALOG[n].scale });
  const { h: dh } = playerCarSize(straight, asset, WIDTH);
  const dy = HEIGHT - PLAYER_CAR_BOTTOM - dh;
  return dy + ((lastOpaqueRow(png) + 1) * dh) / png.h;
};

describe.skipIf(NO_ART)('il fondo delle gomme resta alla stessa riga dello schermo in sterzata e in frenata', () => {
  test.each(CARS.flatMap((car) => FRAMES.filter((f) => f !== 'straight').map((f) => [car, f] as const)))(
    '%s %s: gomme entro 2 px da quelle del dritto',
    (car, frame) => {
      const straight = tyreRow(car, 'straight');
      expect(Math.abs(tyreRow(car, frame) - straight)).toBeLessThanOrEqual(2);
    },
  );

  test('il dritto di ogni auto poggia sul fondo previsto (PLAYER_CAR_BOTTOM)', () => {
    for (const car of CARS) {
      expect(Math.abs(tyreRow(car, 'straight') - (HEIGHT - PLAYER_CAR_BOTTOM)), car).toBeLessThanOrEqual(2);
    }
  });
});
