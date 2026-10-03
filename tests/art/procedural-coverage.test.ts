import { describe, expect, test } from 'vitest';
import { CATALOG, SPRITE_NAMES } from '../../src/art/catalog';
import { PROCEDURAL } from '../../src/art/procedural/index';
import { ILLUSTRATIONS } from '../../src/art/procedural/illustrations';
import { loadAssets, targetSize, type AssetEnv } from '../../src/core/assets';
import { createFakeCtx } from '../helpers/fakeCtx';

describe('copertura del catalogo', () => {
  test('ogni nome del catalogo ha un disegnatore procedurale', () => {
    const missing = SPRITE_NAMES.filter((name) => !PROCEDURAL[name]);
    expect(missing).toEqual([]);
  });

  test('ogni disegnatore corrisponde a un nome del catalogo', () => {
    const extra = Object.keys(PROCEDURAL).filter((name) => !CATALOG[name]);
    expect(extra).toEqual([]);
  });

  test('sono 208 disegnatori, quanti i nomi del catalogo', () => {
    expect(Object.keys(PROCEDURAL)).toHaveLength(SPRITE_NAMES.length);
    expect(Object.keys(PROCEDURAL)).toHaveLength(208);
  });

  test.each(SPRITE_NAMES)('%s disegna alla misura del proprio target senza lanciare', (name) => {
    const { w, h } = targetSize(name);
    const ctx = createFakeCtx();
    PROCEDURAL[name](ctx, w, h);
    expect(ctx.paints, name).toBeGreaterThan(2);
  });

  test('i finali, il logo e la schermata radio sono otto', () => {
    expect(Object.keys(ILLUSTRATIONS).sort()).toEqual([
      'ending_1',
      'ending_2',
      'ending_3',
      'ending_4',
      'ending_5',
      'radio_panel',
      'screen_attract',
      'title_logo',
    ]);
  });

  test('il logo scrive esattamente TEB RUN, contornato e riempito', () => {
    const ctx = createFakeCtx();
    PROCEDURAL.title_logo(ctx, 900, 300);
    const texts = ctx.ops.filter((o) => o.type === 'fillText' || o.type === 'strokeText');
    expect(texts.map((o) => o.text)).toEqual(['TEB RUN', 'TEB RUN']);
  });

  // Questo è il conteggio stretto che il Task 3 non può ancora fare: ora che i
  // disegnatori coprono tutto il catalogo, il manifest assente dà 120 procedurali
  // e nessun mancante.
  test('con tutti i disegnatori un manifest assente dà 208 procedurali e 0 mancanti', async () => {
    const env: AssetEnv = {
      fetchManifest: async () => null,
      loadImage: async () => {
        throw new Error('nessun PNG in questo test');
      },
      surface: () => ({ image: {} as CanvasImageSource, ctx: createFakeCtx(), blit: () => undefined }),
      log: () => undefined,
    };
    const store = loadAssets({ env });
    await store.ready;
    expect(store.stats).toEqual({ png: 0, procedural: SPRITE_NAMES.length, missing: 0 });
    expect(SPRITE_NAMES).toHaveLength(208);
  });
});
