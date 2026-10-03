import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAssets, type AssetEnv, type Manifest } from '../../src/core/assets';
import {
  LOADING_BAR_W,
  LOADING_BAR_Y,
  drawLoadingScreen,
  loadingFraction,
  loadingLabel,
  startLoadingScreen,
} from '../../src/ui/loading';
import type { SpriteAsset } from '../../src/types';
import { createFakeCtx } from '../helpers/fakeCtx';
import { createRecordCtx } from '../helpers/recordCtx';

const BAR_COLOR = '#ff5a8c';

describe('loading screen, pure parts', () => {
  test('fraction clamps to 0..1 and survives zero or bad totals', () => {
    expect(loadingFraction({ done: 0, total: 1 })).toBe(0);
    expect(loadingFraction({ done: 5, total: 10 })).toBe(0.5);
    expect(loadingFraction({ done: 12, total: 10 })).toBe(1);
    expect(loadingFraction({ done: 3, total: 0 })).toBe(0);
    expect(loadingFraction({ done: Number.NaN, total: 4 })).toBe(0);
  });

  test('label says done over total with the bitmap glyphs only', () => {
    expect(loadingLabel({ done: 12, total: 150 })).toBe('LOADING 12/150');
    expect(loadingLabel({ done: 200, total: 150 })).toBe('LOADING 150/150');
  });

  test('the bar grows with the progress', () => {
    const barWidth = (done: number, total: number): number => {
      const r = createRecordCtx();
      drawLoadingScreen(r.ctx, { done, total }, null);
      const bar = r.fills().filter((op) => op.fill === BAR_COLOR && op.args[1] === LOADING_BAR_Y);
      return bar.length === 0 ? 0 : bar[0].args[2];
    };
    expect(barWidth(0, 10)).toBe(0);
    expect(barWidth(5, 10)).toBe(LOADING_BAR_W / 2);
    expect(barWidth(10, 10)).toBe(LOADING_BAR_W);
  });

  test('without the logo the name is text; with the logo it is drawn', () => {
    const noLogo = createRecordCtx();
    drawLoadingScreen(noLogo.ctx, { done: 1, total: 2 }, null);
    expect(noLogo.images()).toEqual([]);
    const withLogo = createRecordCtx();
    const logo = { name: 'title_logo', image: { name: 'title_logo' } as unknown as CanvasImageSource, w: 600, h: 200 } as SpriteAsset;
    drawLoadingScreen(withLogo.ctx, { done: 1, total: 2 }, logo);
    expect(withLogo.images().length).toBe(1);
  });

  test('first frame is drawn at once, then every frame until stopped', () => {
    const ctx = createFakeCtx() as unknown as CanvasRenderingContext2D;
    let asked = 0;
    let pending: (() => void) | null = null;
    let cancelled = -1;
    const source = {
      progress: () => {
        asked++;
        return { done: 1, total: 3 };
      },
      isLoaded: () => false,
      get: () => {
        throw new Error('no logo yet');
      },
    };
    const stop = startLoadingScreen(
      ctx,
      source,
      (cb) => {
        pending = cb;
        return 7;
      },
      (id) => {
        cancelled = id;
      },
    );
    expect(asked).toBe(1);
    (pending as unknown as () => void)();
    expect(asked).toBe(2);
    stop();
    expect(cancelled).toBe(7);
    (pending as unknown as () => void)();
    expect(asked).toBe(2);
  });

  test('src/main.ts shows it before awaiting the sprites and stops it after', () => {
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    const start = main.indexOf('startLoadingScreen(ctx, assets)');
    const ready = main.indexOf('await assets.ready');
    const stop = main.indexOf('stopLoading()');
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(ready);
    expect(ready).toBeLessThan(stop);
  });
});

describe('loadAssets progress', () => {
  function env(manifest: Manifest, gate: Promise<void>, bad: string[] = []): AssetEnv {
    return {
      fetchManifest: async () => manifest,
      async loadImage(url: string) {
        await gate;
        if (bad.some((b) => url.endsWith(b))) throw new Error('bad');
        return { image: {} as CanvasImageSource, w: 200, h: 200 };
      },
      surface: () => ({ image: {} as CanvasImageSource, ctx: createFakeCtx(), blit: () => undefined }),
      log: () => undefined,
    };
  }

  test('manifest first, then one step per image file, failures included; full when ready', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const manifest: Manifest = {
      title_logo: { file: 'title_logo.png', w: 200, h: 200 },
      screen_attract: { file: 'screen_attract.png', w: 200, h: 200 },
    } as unknown as Manifest;
    const store = loadAssets({ env: env(manifest, gate, ['screen_attract.png']), base: '/s/' });
    expect(store.progress()).toEqual({ done: 0, total: 1 });
    expect(store.isLoaded('title_logo')).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const mid = store.progress();
    expect(mid.done).toBe(1);
    expect(mid.total).toBe(3);
    open();
    await store.ready;
    expect(store.progress()).toEqual({ done: 3, total: 3 });
    expect(store.isLoaded('title_logo')).toBe(true);
    expect(store.isLoaded('screen_attract')).toBe(false);
  });

  test('without a manifest the bar still ends full', async () => {
    const store = loadAssets({
      env: { ...env({}, Promise.resolve()), fetchManifest: async () => { throw new Error('404'); } },
    });
    await store.ready;
    expect(store.progress()).toEqual({ done: 1, total: 1 });
  });
});
