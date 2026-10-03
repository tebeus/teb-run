import { describe, expect, test } from 'vitest';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { initialPlayer } from '../../src/game/player';
import { updateVisible } from '../../src/game/race';
import { bucketCars } from '../../src/game/traffic';
import { renderSprites } from '../../src/render/sprites';
import { SEGMENT_LENGTH } from '../../src/render/project';
import type { AssetStore, Car, SpriteAsset } from '../../src/types';
import { CATALOG } from '../../src/art/catalog';
import { makeFlatTrack } from '../helpers/segments';

interface Drawn {
  name: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Contesto finto che registra i `drawImage`. L'immagine di ogni asset porta
 * il nome, così si sa cosa è stato disegnato.
 */
function recorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[] } {
  const drawn: Drawn[] = [];
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    drawImage: (
      image: unknown,
      _sx: number,
      _sy: number,
      _sw: number,
      _sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      drawn.push({ name: (image as { name: string }).name, dx, dy, dw, dh });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, drawn };
}

const assets = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w: 200,
    h: 140,
    entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

const car = (over: Partial<Car> = {}): Car => ({
  id: 1,
  name: 'traffic_sedan',
  offset: 0,
  z: 0,
  speed: 4000,
  percent: 0,
  ...over,
});

describe('renderSprites draws the traffic (spec §4.4)', () => {
  test('a car in a visible segment is drawn with its own sprite', () => {
    const track = makeFlatTrack(400);
    const c = car({ z: 60 * SEGMENT_LENGTH, offset: 0.66 });
    bucketCars(track, [c]);
    const visible = updateVisible(track, { ...initialPlayer(), z: 20 * SEGMENT_LENGTH }, LOGICAL_W, LOGICAL_H);
    const { ctx, drawn } = recorder();
    renderSprites(ctx, visible, assets(), LOGICAL_W);
    expect(drawn.map((d) => d.name)).toContain('traffic_sedan');
  });

  test('a car to the right of the road is drawn to the right of the centre', () => {
    const track = makeFlatTrack(400);
    bucketCars(track, [car({ id: 1, z: 60 * SEGMENT_LENGTH, offset: 0.66 })]);
    const visible = updateVisible(track, { ...initialPlayer(), z: 20 * SEGMENT_LENGTH }, LOGICAL_W, LOGICAL_H);
    const right = recorder();
    renderSprites(right.ctx, visible, assets(), LOGICAL_W);
    const drawnRight = right.drawn.find((d) => d.name === 'traffic_sedan');

    const track2 = makeFlatTrack(400);
    bucketCars(track2, [car({ id: 1, z: 60 * SEGMENT_LENGTH, offset: -0.66 })]);
    const visible2 = updateVisible(track2, { ...initialPlayer(), z: 20 * SEGMENT_LENGTH }, LOGICAL_W, LOGICAL_H);
    const left = recorder();
    renderSprites(left.ctx, visible2, assets(), LOGICAL_W);
    const drawnLeft = left.drawn.find((d) => d.name === 'traffic_sedan');

    expect(drawnRight).toBeDefined();
    expect(drawnLeft).toBeDefined();
    expect(drawnRight!.dx).toBeGreaterThan(LOGICAL_W / 2);
    expect(drawnLeft!.dx).toBeLessThan(LOGICAL_W / 2);
  });

  test('a nearer car is drawn bigger than a farther one', () => {
    const track = makeFlatTrack(400);
    bucketCars(track, [
      car({ id: 1, z: 40 * SEGMENT_LENGTH }),
      car({ id: 2, name: 'traffic_van', z: 120 * SEGMENT_LENGTH }),
    ]);
    const visible = updateVisible(track, { ...initialPlayer(), z: 20 * SEGMENT_LENGTH }, LOGICAL_W, LOGICAL_H);
    const { ctx, drawn } = recorder();
    renderSprites(ctx, visible, assets(), LOGICAL_W);
    const near = drawn.find((d) => d.name === 'traffic_sedan');
    const far = drawn.find((d) => d.name === 'traffic_van');
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    expect(near!.dw).toBeGreaterThan(far!.dw);
  });

  test('the renderer never touches the cars it draws', () => {
    const track = makeFlatTrack(400);
    const c = car({ z: 60 * SEGMENT_LENGTH, offset: 0.4 });
    bucketCars(track, [c]);
    const before = { ...c };
    const visible = updateVisible(track, { ...initialPlayer(), z: 20 * SEGMENT_LENGTH }, LOGICAL_W, LOGICAL_H);
    const { ctx } = recorder();
    renderSprites(ctx, visible, assets(), LOGICAL_W);
    expect(c).toEqual(before);
    expect(track[60].cars).toEqual([c]);
  });

  test('the percent inside the segment moves the car down the screen', () => {
    const at = (percent: number): number => {
      const track = makeFlatTrack(400);
      const c = car({ z: 60 * SEGMENT_LENGTH + percent * SEGMENT_LENGTH });
      bucketCars(track, [c]);
      const visible = updateVisible(track, { ...initialPlayer(), z: 20 * SEGMENT_LENGTH }, LOGICAL_W, LOGICAL_H);
      const { ctx, drawn } = recorder();
      renderSprites(ctx, visible, assets(), LOGICAL_W);
      return drawn.find((d) => d.name === 'traffic_sedan')!.dy;
    };
    // Più avanti nel segmento vuol dire più lontano, quindi più in alto.
    expect(at(0.9)).toBeLessThan(at(0.1));
  });
});
