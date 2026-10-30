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
  // Fasi del MANIFEST di prova con START (0-0, auto new), spec telefono e finali §B.2:
  // 0 titolo e radio, 1 la prima tappa, 2 il resto.
  const PHASE_0 = ['player_retro_straight.webp', 'player_straight.webp', 'title_logo.webp'];
  const PHASE_1 = ['beach_palm_1.webp', 'player_brake.webp', 'traffic_bus.webp'];

  test('ready waits for the title phase only, and the progress counts only that phase', async () => {
    const net = gatedEnv();
    const store = loadAssets({ env: net.env, base: '/s/', start: START });
    await flush();
    expect([...net.asked].sort()).toEqual(PHASE_0);
    expect(store.progress()).toEqual({ done: 1, total: 4 });
    let ready = false;
    void store.ready.then(() => (ready = true));
    net.releaseAll();
    await store.ready;
    expect(ready).toBe(true);
    expect(store.progress()).toEqual({ done: 4, total: 4 });
    expect(store.isLoaded('title_logo')).toBe(true);
    expect(store.isLoaded('beach_palm_1')).toBe(false);
  });

  test('then the first stage comes first in the background, then the rest, a few at a time', async () => {
    const net = gatedEnv();
    const store = loadAssets({ env: net.env, base: '/s/', start: START, concurrency: 2 });
    await flush();
    net.releaseAll();
    await store.ready;
    await flush();
    // La tappa conta anche il frame dritto dell'auto, arrivato col titolo.
    expect(store.stageProgress!(START.stage, 'new')).toEqual({ done: 1, total: 4 });
    expect(net.asked.slice(3).every((f) => PHASE_1.includes(f))).toBe(true);
    for (let i = 0; i < 3 && net.asked.length < 6; i++) {
      for (const f of net.asked.slice(3)) if (PHASE_1.includes(f)) { try { net.release(f); } catch { /* già arrivato */ } }
      await flush();
    }
    for (const f of PHASE_1) if (net.asked.includes(f) && store.stageProgress!(START.stage, 'new').done < 4) { try { net.release(f); } catch { /* già arrivato */ } }
    await flush();
    expect([...net.asked.slice(3, 6)].sort()).toEqual(PHASE_1);
    expect(store.stageProgress!(START.stage, 'new')).toEqual({ done: 4, total: 4 });
    expect(store.requestStage(START.stage, 'new')).toBe(true);
    // Poi le altre auto prima dei temi, i finali per ultimi.
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
    expect(store.progress()).toEqual({ done: 4, total: 4 });
  });

  test('requestStage puts a stage before everything, and says when its files are all settled', async () => {
    const net = gatedEnv();
    const store = loadAssets({ env: net.env, base: '/s/', start: START, concurrency: 1 });
    const alpine = { id: '3-1', theme: 'alpine' };
    expect(store.requestStage(alpine, 'new')).toBe(false);
    await flush();
    net.releaseAll();
    await store.ready;
    await flush();
    // Il primo della fase 1 era già partito; chiesta adesso, la tappa
    // passa davanti al resto della fase 1. `traffic_bus` e `player_brake`
    // servono a entrambe.
    expect(PHASE_1).toContain(net.asked[3]);
    expect(store.requestStage(alpine, 'new')).toBe(false);
    for (let i = 0; i < 6 && !store.requestStage(alpine, 'new'); i++) {
      // Un file che non si decodifica è risolto lo stesso: resta il procedurale.
      const next = net.asked[net.asked.length - 1];
      net.release(next, next !== 'alpine_cow.webp');
      await flush();
    }
    // La palma (solo della 0-0) non è passata davanti, se non era già partita.
    const palm = net.asked.indexOf('beach_palm_1.webp');
    if (palm !== 3) expect(palm).toBeGreaterThan(Math.max(net.asked.indexOf('alpine_cow.webp'), net.asked.indexOf('bg_3-1_far.webp')));
    expect(store.requestStage(alpine, 'new')).toBe(true);
    expect(store.hasStageBg('bg_3-1_far')).toBe(true);
    expect(store.isLoaded('alpine_cow')).toBe(false);
    expect(store.sourceOf('alpine_cow')).toBe('procedural');
    for (let i = 0; i < 5; i++) {
      net.releaseAll();
      await flush();
    }
    expect(store.requestStage({ id: '0-0', theme: 'beach' }, 'new')).toBe(true);
    expect(net.asked.at(-1)).toBe('ending_1.webp');
  });

  test('requestFile puts one file first and says when it is settled; a file not in the manifest is settled', async () => {
    const net = gatedEnv();
    const store = loadAssets({ env: net.env, base: '/s/', start: START, concurrency: 1 });
    await flush();
    net.releaseAll();
    await store.ready;
    await flush();
    expect(store.requestFile!('ending_1')).toBe(false);
    expect(store.requestFile!('map_full')).toBe(true);
    net.release(net.asked[3]);
    await flush();
    expect(net.asked[4]).toBe('ending_1.webp');
    net.release('ending_1.webp');
    await flush();
    expect(store.requestFile!('ending_1')).toBe(true);
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
