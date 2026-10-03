import { describe, expect, test, vi } from 'vitest';
import { SPRITE_NAMES } from '../../src/art/catalog';
import { browserEnv, loadAssets, type AssetEnv, type Manifest, type Surface } from '../../src/core/assets';
import { createFakeCtx } from '../helpers/fakeCtx';

interface Recorder {
  env: AssetEnv;
  logs: string[];
  loaded: string[];
  surfaces: { w: number; h: number }[];
  blits: { sx: number; sy: number; sw: number; sh: number }[];
}

function fakeEnv(options: {
  manifest?: Manifest | null;
  fetchThrows?: boolean;
  badUrls?: string[];
  sizes?: Record<string, { w: number; h: number }>;
}): Recorder {
  const logs: string[] = [];
  const loaded: string[] = [];
  const surfaces: { w: number; h: number }[] = [];
  const blits: { sx: number; sy: number; sw: number; sh: number }[] = [];
  const env: AssetEnv = {
    async fetchManifest() {
      if (options.fetchThrows) throw new Error('404');
      return options.manifest ?? null;
    },
    async loadImage(url: string) {
      loaded.push(url);
      if (options.badUrls?.includes(url)) throw new Error(`decode failed: ${url}`);
      const size = options.sizes?.[url] ?? { w: 960, h: 200 };
      return { image: {} as CanvasImageSource, w: size.w, h: size.h };
    },
    surface(w: number, h: number): Surface {
      surfaces.push({ w, h });
      return {
        image: {} as CanvasImageSource,
        ctx: createFakeCtx(),
        blit(_src, sx, sy, sw, sh) {
          blits.push({ sx, sy, sw, sh });
        },
      };
    },
    log(message: string) {
      logs.push(message);
    },
  };
  return { env, logs, loaded, surfaces, blits };
}

describe('loadAssets', () => {
  // Attenzione: qui si asserisce solo ciò che vale a OGNI stadio del binario.
  // Alla fine del Task 3 esistono i soli disegnatori dei veicoli, quindi 15 nomi
  // sono `procedural` e 52 `missing`; i task 4-8 spostano i 52 su `procedural`.
  // Il conteggio stretto (67 procedurali, 0 mancanti) è nel Task 8.
  test('manifest assente: nessun PNG, nessun errore, ready risolve', async () => {
    const r = fakeEnv({ fetchThrows: true });
    const store = loadAssets({ env: r.env });
    await expect(store.ready).resolves.toBeUndefined();
    expect(store.stats.png).toBe(0);
    expect(store.stats.procedural + store.stats.missing).toBe(SPRITE_NAMES.length);
    expect(r.loaded).toEqual([]);
  });

  test('la riga di riepilogo finisce nel log', async () => {
    const r = fakeEnv({ manifest: {} });
    const store = loadAssets({ env: r.env });
    await store.ready;
    expect(r.logs.some((l) => l.startsWith('TEB RUN assets:'))).toBe(true);
  });

  test('ogni nome del catalogo è disponibile con la sua voce di catalogo', async () => {
    const r = fakeEnv({ manifest: {} });
    const store = loadAssets({ env: r.env });
    await store.ready;
    for (const name of SPRITE_NAMES) {
      expect(store.has(name), name).toBe(true);
      const asset = store.get(name);
      expect(asset.name).toBe(name);
      expect(asset.w).toBeGreaterThan(0);
      expect(asset.h).toBeGreaterThan(0);
      expect(asset.entry).toBeDefined();
    }
  });

  test('un PNG a frame singolo diventa asset con la misura caricata', async () => {
    const r = fakeEnv({
      manifest: { traffic_van: { file: 'traffic_van.png', w: 300, h: 240 } },
      sizes: { '/sprites/traffic_van.png': { w: 300, h: 240 } },
    });
    const store = loadAssets({ env: r.env });
    await store.ready;
    expect(store.stats.png).toBe(1);
    const asset = store.get('traffic_van');
    expect([asset.w, asset.h]).toEqual([300, 240]);
    expect(r.blits).toEqual([]);
  });

  test('una strip viene tagliata nei frame sulla misura reale del PNG', async () => {
    const r = fakeEnv({
      manifest: { player_strip_turn: { file: 'player_strip_turn.png', w: 960, h: 200, frames: 3 } },
      sizes: { '/sprites/player_strip_turn.png': { w: 900, h: 180 } },
    });
    const store = loadAssets({ env: r.env });
    await store.ready;
    expect(store.stats.png).toBe(3);
    expect(r.blits).toEqual([
      { sx: 0, sy: 0, sw: 300, sh: 180 },
      { sx: 300, sy: 0, sw: 300, sh: 180 },
      { sx: 600, sy: 0, sw: 300, sh: 180 },
    ]);
    expect(store.get('player_left2').w).toBe(300);
    expect(r.loaded.filter((u) => u.endsWith('player_strip_turn.png'))).toHaveLength(1);
  });

  test('un PNG che non decodifica ripiega sul procedurale, gli altri restano PNG', async () => {
    const r = fakeEnv({
      manifest: {
        traffic_van: { file: 'traffic_van.png', w: 300, h: 240 },
        traffic_sedan: { file: 'traffic_sedan.png', w: 280, h: 180 },
      },
      badUrls: ['/sprites/traffic_van.png'],
    });
    const store = loadAssets({ env: r.env });
    await store.ready;
    expect(store.stats.png).toBe(1);
    expect(store.get('traffic_van').w).toBe(300);
    expect(r.logs.some((l) => l.includes('traffic_van.png'))).toBe(true);
  });

  test('strip con frames sbagliato: i frame oltre il conteggio sono procedurali e c\'è un warning', async () => {
    const r = fakeEnv({
      manifest: { player_strip_turn: { file: 'player_strip_turn.png', w: 640, h: 200, frames: 2 } },
      sizes: { '/sprites/player_strip_turn.png': { w: 640, h: 200 } },
    });
    const store = loadAssets({ env: r.env });
    await store.ready;
    expect(store.stats.png).toBe(2);
    expect(store.get('player_left2').w).toBe(320);
    expect(r.logs.some((l) => l.includes('player_strip_turn') && l.includes('3'))).toBe(true);
  });

  test('procedural: true ignora il manifest', async () => {
    const r = fakeEnv({ manifest: { traffic_van: { file: 'traffic_van.png', w: 300, h: 240 } } });
    const store = loadAssets({ env: r.env, procedural: true });
    await store.ready;
    expect(store.stats.png).toBe(0);
    expect(r.loaded).toEqual([]);
  });

  test('get() prima di ready non lancia e non falsa le statistiche', async () => {
    const r = fakeEnv({ manifest: {} });
    const store = loadAssets({ env: r.env });
    const early = store.get('traffic_van');
    expect(early.name).toBe('traffic_van');
    await store.ready;
    expect(store.stats.procedural + store.stats.png + store.stats.missing).toBe(SPRITE_NAMES.length);
  });

  test('un nome fuori catalogo dà un asset magenta e has() false', async () => {
    const r = fakeEnv({ manifest: {} });
    const store = loadAssets({ env: r.env });
    await store.ready;
    expect(store.has('non_esiste')).toBe(false);
    const asset = store.get('non_esiste');
    expect(asset.name).toBe('non_esiste');
    expect(asset.w).toBeGreaterThan(0);
  });

  test('il manifestUrl di default è /sprites/manifest.json', async () => {
    const spy = vi.fn(async () => null);
    const r = fakeEnv({ manifest: {} });
    const store = loadAssets({ env: { ...r.env, fetchManifest: spy } });
    await store.ready;
    expect(spy).toHaveBeenCalledWith('/sprites/manifest.json');
  });

  test('sourceOf riflette il risultato reale dopo il fallback, non l\'intento del manifest (Minor 4)', async () => {
    const r = fakeEnv({
      manifest: {
        traffic_van: { file: 'traffic_van.png', w: 300, h: 240 },
        traffic_sedan: { file: 'traffic_sedan.png', w: 280, h: 180 },
      },
      badUrls: ['/sprites/traffic_van.png'],
    });
    const store = loadAssets({ env: r.env });
    await store.ready;
    // traffic_van è nel manifest ma la sua immagine non decodifica: la
    // sorgente reale ricade sul procedurale, non resta "png".
    expect(store.sourceOf('traffic_van')).toBe('procedural');
    expect(store.sourceOf('traffic_sedan')).toBe('png');
  });

  test('uno sfondo di tappa nel manifest si carica e hasStageBg lo segnala (spec §4.4f facoltativa)', async () => {
    const r = fakeEnv({
      manifest: { 'bg_3-3_far': { file: 'bg_3-3_far.png', w: 2048, h: 220 } },
      sizes: { '/sprites/bg_3-3_far.png': { w: 2048, h: 220 } },
    });
    const store = loadAssets({ env: r.env });
    await store.ready;
    expect(store.hasStageBg('bg_3-3_far')).toBe(true);
    expect(store.get('bg_3-3_far').w).toBe(2048);
    // Il resto delle 30 combinazioni id/tema, assenti dal manifest, non è
    // richiesto: il catalogo non deve richiedere i 30 PNG.
    expect(store.hasStageBg('bg_3-3_near')).toBe(false);
    expect(store.hasStageBg('bg_0-0_far')).toBe(false);
  });

  test('uno sfondo di tappa che non decodifica non lancia e resta assente da hasStageBg', async () => {
    const r = fakeEnv({
      manifest: { 'bg_3-3_far': { file: 'bg_3-3_far.png', w: 2048, h: 220 } },
      badUrls: ['/sprites/bg_3-3_far.png'],
    });
    const store = loadAssets({ env: r.env });
    await expect(store.ready).resolves.toBeUndefined();
    expect(store.hasStageBg('bg_3-3_far')).toBe(false);
    expect(() => store.get('bg_3-3_far')).not.toThrow();
  });

  test('uno sfondo di tappa non finito nel manifest non genera un avviso "ignorato"', async () => {
    const r = fakeEnv({ manifest: { 'bg_3-3_far': { file: 'bg_3-3_far.png', w: 2048, h: 220 } } });
    const store = loadAssets({ env: r.env });
    await store.ready;
    expect(r.logs.some((l) => l.includes('bg_3-3_far') && l.includes('ignorato'))).toBe(false);
  });

  test('procedural: true non carica gli sfondi di tappa', async () => {
    const r = fakeEnv({ manifest: { 'bg_3-3_far': { file: 'bg_3-3_far.png', w: 2048, h: 220 } } });
    const store = loadAssets({ env: r.env, procedural: true });
    await store.ready;
    expect(store.hasStageBg('bg_3-3_far')).toBe(false);
    expect(r.loaded).toEqual([]);
  });

  test('Minor 2: con la vera browserEnv() e senza OffscreenCanvas, ready risolve e get() non lancia mai', async () => {
    // Nessun mock: browserEnv() è la stessa funzione usata in produzione, e
    // in questo ambiente di test (Vitest, node) OffscreenCanvas e document
    // sono già assenti, cioè esattamente il caso di Safari < 16.4.
    const store = loadAssets({ env: browserEnv(), manifestUrl: '/sprites/manifest.json' });
    await expect(store.ready).resolves.toBeUndefined();
    for (const name of SPRITE_NAMES) {
      expect(() => store.get(name)).not.toThrow();
    }
  });
});
