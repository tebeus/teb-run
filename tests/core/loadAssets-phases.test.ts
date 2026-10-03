// Caricamento a fasi (lancio, punto 12): `ready` aspetta solo la fase
// iniziale, il resto arriva in background e `requestStage` lo fa passare
// avanti; finché un file non c'è, `get` dà il ripiego procedurale.

import { describe, expect, test } from 'vitest';
import { loadAssets, stagedOf, type AssetEnv, type Manifest } from '../../src/core/assets';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createFakeCtx } from '../helpers/fakeCtx';

const entry = (file: string): { file: string; w: number; h: number } => ({ file, w: 100, h: 100 });

const MANIFEST: Manifest = {
  title_logo: entry('title_logo.webp'),
  traffic_bus: entry('traffic_bus.webp'),
  beach_palm_1: entry('beach_palm_1.webp'),
  player_straight: entry('player_straight.webp'),
  player_brake: entry('player_brake.webp'),
  player_retro_straight: entry('player_retro_straight.webp'),
  player_retro_brake: entry('player_retro_brake.webp'),
  alpine_cow: entry('alpine_cow.webp'),
  'bg_3-1_far': entry('bg_3-1_far.webp'),
  ending_1: entry('ending_1.webp'),
};

const START = { stage: { id: '0-0', theme: 'beach' }, car: 'new' };

/** Rete finta: ogni immagine aspetta che il test la lasci arrivare (o fallire). */
function gatedEnv(): {
  env: AssetEnv;
  asked: string[];
  release(file: string, ok?: boolean): void;
  releaseAll(): void;
} {
  const asked: string[] = [];
  const gates = new Map<string, { resolve: () => void; reject: () => void }>();
  const images = new Map<string, CanvasImageSource>();
  const env: AssetEnv = {
    async fetchManifest() {
      return MANIFEST;
    },
    loadImage(url: string) {
      const file = url.split('/').pop()!;
      asked.push(file);
      return new Promise((resolve, reject) => {
        gates.set(file, {
          resolve: () => {
            const image = { file } as unknown as CanvasImageSource;
            images.set(file, image);
            resolve({ image, w: 100, h: 100 });
          },
          reject: () => reject(new Error(`decode failed: ${file}`)),
        });
      });
    },
    surface(w: number, h: number) {
      return { image: { procedural: true, w, h } as unknown as CanvasImageSource, ctx: createFakeCtx(), blit() {} };
    },
    log() {},
  };
  return {
    env,
    asked,
    release(file, ok = true) {
      const gate = gates.get(file);
      if (!gate) throw new Error(`${file} was not asked`);
      gates.delete(file);
      if (ok) gate.resolve();
      else gate.reject();
    },
    releaseAll() {
      for (const file of [...gates.keys()]) this.release(file);
    },
  };
}

/** Lascia girare le promesse già risolte. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('loadAssets in phases', () => {
  test('ready waits for the initial phase only, and the progress counts only that phase', async () => {
    const net = gatedEnv();
    const store = loadAssets({ env: net.env, base: '/s/', start: START });
    await flush();
    expect([...net.asked].sort()).toEqual(
      ['beach_palm_1.webp', 'player_brake.webp', 'player_retro_straight.webp', 'player_straight.webp', 'title_logo.webp', 'traffic_bus.webp'].sort(),
    );
    expect(store.progress()).toEqual({ done: 1, total: 7 });
    let ready = false;
    void store.ready.then(() => (ready = true));
    net.releaseAll();
    await store.ready;
    expect(ready).toBe(true);
    expect(store.progress()).toEqual({ done: 7, total: 7 });
    expect(store.isLoaded('title_logo')).toBe(true);
    expect(store.isLoaded('alpine_cow')).toBe(false);
  });

  test('the rest arrives in the background, a few at a time, and get() swaps the fallback for the image', async () => {
    const net = gatedEnv();
    const store = loadAssets({ env: net.env, base: '/s/', start: START, concurrency: 2 });
    await flush();
    net.releaseAll();
    await store.ready;
    await flush();
    // Due alla volta: le altre auto prima dei temi, i finali per ultimi.
    expect(net.asked.slice(6)).toEqual(['player_retro_brake.webp', 'alpine_cow.webp']);
    const before = store.get('alpine_cow');
    expect((before.image as unknown as { procedural?: boolean }).procedural).toBe(true);
    net.release('alpine_cow.webp');
    await flush();
    expect(store.isLoaded('alpine_cow')).toBe(true);
    expect((store.get('alpine_cow').image as unknown as { file: string }).file).toBe('alpine_cow.webp');
    let all = false;
    void store.all.then(() => (all = true));
    for (let i = 0; i < 5 && !all; i++) {
      net.releaseAll();
      await flush();
    }
    expect(all).toBe(true);
    expect(net.asked.at(-1)).toBe('ending_1.webp');
    // Il background non muove la barra della schermata di caricamento.
    expect(store.progress()).toEqual({ done: 7, total: 7 });
  });

  test('requestStage puts a stage first, and says when its files are all settled', async () => {
    const net = gatedEnv();
    const store = loadAssets({ env: net.env, base: '/s/', start: START, concurrency: 1 });
    const alpine = { id: '3-1', theme: 'alpine' };
    expect(store.requestStage(alpine, 'new')).toBe(false);
    await flush();
    net.releaseAll();
    await store.ready;
    await flush();
    // Il primo del background (l'altra auto) era già partito; dopo di lui,
    // prima dei finali, i due file della tappa chiesta.
    expect(net.asked.slice(6)).toEqual(['player_retro_brake.webp']);
    expect(store.requestStage(alpine, 'new')).toBe(false);
    net.release('player_retro_brake.webp');
    await flush();
    expect(net.asked.slice(7)).toEqual(['alpine_cow.webp']);
    // Un file che non si decodifica è risolto lo stesso: resta il procedurale.
    net.release('alpine_cow.webp', false);
    await flush();
    expect(net.asked.slice(8)).toEqual(['bg_3-1_far.webp']);
    expect(store.requestStage(alpine, 'new')).toBe(false);
    net.release('bg_3-1_far.webp');
    await flush();
    expect(store.requestStage(alpine, 'new')).toBe(true);
    expect(store.hasStageBg('bg_3-1_far')).toBe(true);
    expect(store.isLoaded('alpine_cow')).toBe(false);
    expect(store.sourceOf('alpine_cow')).toBe('procedural');
    expect(store.requestStage({ id: '0-0', theme: 'beach' }, 'new')).toBe(true);
    expect(net.asked.at(-1)).toBe('ending_1.webp');
  });

  test('without start everything is initial, as before', async () => {
    const net = gatedEnv();
    const store = loadAssets({ env: net.env, base: '/s/' });
    await flush();
    expect(net.asked.length).toBe(Object.keys(MANIFEST).length);
    net.releaseAll();
    await store.ready;
    await store.all;
    expect(store.progress().total).toBe(1 + Object.keys(MANIFEST).length);
  });

  test('stagedOf: the real store has phases, a test store does not', () => {
    expect(stagedOf(loadAssets({ env: gatedEnv().env, start: START }))).not.toBeNull();
    expect(stagedOf(createEmptyAssets())).toBeNull();
  });
});
