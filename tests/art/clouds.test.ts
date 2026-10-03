import { describe, expect, test } from 'vitest';
import { CLOUDS, CLOUDS_H, CLOUDS_W, CLOUD_TONES, cloudStrip } from '../../src/art/procedural/clouds';
import { PALETTES } from '../../src/render/palette';
import type { ThemeId } from '../../src/types';
import { createFakeCtx, drawnBounds } from '../helpers/fakeCtx';

const THEMES: ThemeId[] = ['beach', 'desert', 'alpine', 'farm', 'town'];

describe('CLOUDS (spec §4.4c, §13: 2048x256 trasparenti)', () => {
  test('there is one strip per theme and the palette points at it', () => {
    expect(Object.keys(CLOUDS).sort()).toEqual(THEMES.map((t) => `bg_${t}_clouds`).sort());
    for (const theme of THEMES) {
      expect(CLOUDS[PALETTES[theme].clouds], theme).toBeDefined();
    }
  });

  test('the strip never covers the sky with a full rectangle', () => {
    for (const [name, draw] of Object.entries(CLOUDS)) {
      const ctx = createFakeCtx();
      draw(ctx, CLOUDS_W, CLOUDS_H);
      const covers = ctx.ops.some(
        (op) => op.type === 'fillRect' && op.args[2] >= CLOUDS_W && op.args[3] >= CLOUDS_H,
      );
      expect(covers, name).toBe(false);
    }
  });

  test('every strip paints clouds and stays inside the strip', () => {
    for (const [name, draw] of Object.entries(CLOUDS)) {
      const b = drawnBounds(draw, CLOUDS_W, CLOUDS_H);
      expect(b.ctx.paints, name).toBeGreaterThan(20);
      expect(b.minX, name).toBeGreaterThanOrEqual(0);
      expect(b.maxX, name).toBeLessThanOrEqual(CLOUDS_W);
      expect(b.minY, name).toBeGreaterThanOrEqual(0);
      expect(b.maxY, name).toBeLessThanOrEqual(CLOUDS_H);
    }
  });

  test('the same seed draws the same strip', () => {
    const one = createFakeCtx();
    const two = createFakeCtx();
    cloudStrip(one, 512, 128, 5, CLOUD_TONES.beach);
    cloudStrip(two, 512, 128, 5, CLOUD_TONES.beach);
    expect(two.ops).toEqual(one.ops);
  });

  test('two themes never draw the same strip', () => {
    const shapes = Object.values(CLOUDS).map((draw) => {
      const ctx = createFakeCtx();
      draw(ctx, 512, 128);
      return JSON.stringify(ctx.ops);
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});
