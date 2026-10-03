import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { createWipe, wipeAlpha, WIPE_S } from '../../src/ui/transition';
import type { AssetStore, SpriteAsset } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';

const store = (w = 1280, h = 200): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w,
    h,
    entry: CATALOG[name] ?? { kind: 'ui', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

describe('tendina fra schermate (spec §11)', () => {
  test('at rest it is not active and draws nothing', () => {
    const wipe = createWipe();
    expect(wipe.active).toBe(false);
    wipe.update(1 / 60);
    const rec = createRecordCtx();
    wipe.draw(rec.ctx, store(), LOGICAL_W, LOGICAL_H);
    expect(rec.ops).toEqual([]);
  });

  test('it lasts WIPE_S seconds and its progress runs from 0 to 1', () => {
    expect(WIPE_S).toBeCloseTo(0.4, 10);
    const wipe = createWipe();
    wipe.start();
    expect(wipe.active).toBe(true);
    expect(wipe.progress).toBe(0);
    wipe.update(WIPE_S / 2);
    expect(wipe.progress).toBeCloseTo(0.5, 6);
    expect(wipe.active).toBe(true);
    wipe.update(WIPE_S / 2 + 1e-6);
    expect(wipe.active).toBe(false);
  });

  test('while it runs it draws the strip and the sunset, and the strip slides', () => {
    const wipe = createWipe();
    wipe.start();
    wipe.update(WIPE_S * 0.25);
    const early = createRecordCtx();
    wipe.draw(early.ctx, store(), LOGICAL_W, LOGICAL_H);
    const names = early.images().map((op) => op.image);
    expect(names).toContain('transition_wipe');
    expect(names).toContain('transition_sunset');

    wipe.update(WIPE_S * 0.5);
    const late = createRecordCtx();
    wipe.draw(late.ctx, store(), LOGICAL_W, LOGICAL_H);
    const x0 = early.images().find((op) => op.image === 'transition_wipe')!.args[0];
    const x1 = late.images().find((op) => op.image === 'transition_wipe')!.args[0];
    expect(x1).toBeLessThan(x0);
  });

  test('it starts covering the whole frame and fades out to nothing, never cutting it in two', () => {
    expect(wipeAlpha(0)).toBe(1);
    expect(wipeAlpha(1)).toBe(0);
    for (let p = 0; p < 1; p += 0.05) expect(wipeAlpha(p + 0.05)).toBeLessThanOrEqual(wipeAlpha(p));
    const wipe = createWipe();
    wipe.start();
    wipe.update(1 / 60);
    const rec = createRecordCtx();
    wipe.draw(rec.ctx, store(), LOGICAL_W, LOGICAL_H);
    // Il fondo copre tutto il quadro, non una banda.
    expect(rec.fills()[0].args).toEqual([0, 0, LOGICAL_W, LOGICAL_H]);
  });

  test('the images keep their aspect and the palm strip always spans the full width', () => {
    const wipe = createWipe();
    wipe.start();
    wipe.update(WIPE_S * 0.6);
    const rec = createRecordCtx();
    wipe.draw(rec.ctx, store(1280, 200), LOGICAL_W, LOGICAL_H);
    const strips = rec.images().filter((op) => op.image === 'transition_wipe');
    expect(strips).toHaveLength(2);
    for (const op of strips) expect(op.args[2] / op.args[3]).toBeCloseTo(1280 / 200, 6);
    // La prima copia parte a sinistra dello schermo, la seconda (specchiata,
    // disegnata dopo una traslazione) chiude il buco a destra.
    expect(strips[0].args[0]).toBeLessThanOrEqual(0);
    const shift = rec.ops.find((op) => op.type === 'translate')!;
    expect(shift.args[0]).toBeCloseTo(strips[0].args[0] + 2 * LOGICAL_W, 6);
    const sunset = rec.images().find((op) => op.image === 'transition_sunset')!;
    expect(sunset.args[2] / sunset.args[3]).toBeCloseTo(1280 / 200, 6);
  });

  test('save and restore are balanced and the alpha comes back to one', () => {
    const wipe = createWipe();
    wipe.start();
    wipe.update(WIPE_S * 0.3);
    const rec = createRecordCtx();
    wipe.draw(rec.ctx, store(), LOGICAL_W, LOGICAL_H);
    const saves = rec.ops.filter((op) => op.type === 'save').length;
    expect(saves).toBeGreaterThan(0);
    expect(rec.ops.filter((op) => op.type === 'restore').length).toBe(saves);
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  test('a restart begins again from zero', () => {
    const wipe = createWipe();
    wipe.start();
    wipe.update(WIPE_S * 0.9);
    wipe.start();
    expect(wipe.progress).toBe(0);
  });

  test('a coarse tick never leaves the progress outside [0, 1]', () => {
    const wipe = createWipe();
    wipe.start();
    wipe.update(10);
    expect(wipe.progress).toBeLessThanOrEqual(1);
    expect(wipe.progress).toBeGreaterThanOrEqual(0);
    expect(wipe.active).toBe(false);
  });

  test('a zero-sized asset draws nothing and leaves the alpha at one', () => {
    const wipe = createWipe();
    wipe.start();
    wipe.update(WIPE_S / 2);
    const rec = createRecordCtx();
    wipe.draw(rec.ctx, store(0, 0), LOGICAL_W, LOGICAL_H);
    expect(rec.images()).toHaveLength(0);
    expect(rec.ctx.globalAlpha).toBe(1);
  });
});
