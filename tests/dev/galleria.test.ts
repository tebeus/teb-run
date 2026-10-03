import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { galleryRows, type GallerySource, type GalleryRow } from '../../src/dev/galleria';
import type { SpriteAsset, SpriteName } from '../../src/types';

/** Store finto: badge e misura vengono dichiarati esplicitamente, non ricalcolati. */
function fakeStore(
  sizes: Partial<Record<SpriteName, { w: number; h: number }>>,
  sources: Partial<Record<SpriteName, GalleryRow['source']>>,
): GallerySource {
  return {
    get(name: SpriteName): SpriteAsset {
      const size = sizes[name] ?? { w: 1, h: 1 };
      return { name, image: {} as CanvasImageSource, w: size.w, h: size.h, entry: CATALOG[name]! };
    },
    sourceOf(name: SpriteName): GalleryRow['source'] {
      return sources[name] ?? 'missing';
    },
  };
}

describe('righe della galleria', () => {
  test('una riga per nome, con tipo e misura reale dello store', () => {
    const store = fakeStore(
      { traffic_van: { w: 300, h: 240 }, common_gantry: { w: 1024, h: 320 } },
      { traffic_van: 'procedural', common_gantry: 'procedural' },
    );
    const rows = galleryRows(['traffic_van', 'common_gantry'], store);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: 'traffic_van',
      kind: 'car',
      source: 'procedural',
      w: 300,
      h: 240,
    });
    expect(rows[1].w).toBe(1024);
  });

  test('il badge viene dallo store, non da un\'ipotesi sul manifest', () => {
    const store = fakeStore({ traffic_van: { w: 300, h: 240 } }, { traffic_van: 'png' });
    expect(galleryRows(['traffic_van'], store)[0].source).toBe('png');
  });

  test('la misura è quella reale dell\'asset caricato, non quella del target', () => {
    // Regressione Minor 4: un target 280x180 con un PNG reale 242x180 non
    // deve mai far leggere "280x180" nel badge.
    const store = fakeStore({ traffic_sedan: { w: 242, h: 180 } }, { traffic_sedan: 'png' });
    const row = galleryRows(['traffic_sedan'], store)[0];
    expect([row.w, row.h]).toEqual([242, 180]);
  });

  test('un PNG che il manifest elenca ma che non decodifica mostra missing/procedural, non png', () => {
    // Lo store, dopo il fallback reale di loadAssets, dice la verità anche
    // quando il manifest mentirebbe (Minor 4: un 404 non deve restare "png").
    const store = fakeStore({ traffic_van: { w: 300, h: 240 } }, { traffic_van: 'procedural' });
    expect(galleryRows(['traffic_van'], store)[0].source).toBe('procedural');
  });

  test("l'ordine dei nomi è rispettato", () => {
    const store = fakeStore(
      { title_logo: { w: 400, h: 100 }, beach_palm_1: { w: 300, h: 520 } },
      { title_logo: 'procedural', beach_palm_1: 'procedural' },
    );
    const rows = galleryRows(['title_logo', 'beach_palm_1'], store);
    expect(rows.map((r) => r.name)).toEqual(['title_logo', 'beach_palm_1']);
  });
});
