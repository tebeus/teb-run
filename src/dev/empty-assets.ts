import type { AssetStore, SpriteAsset, SpriteCatalogEntry, SpriteName } from '../types';

const PLACEHOLDER_ENTRY: SpriteCatalogEntry = { kind: 'scenery', scale: 0.1, solid: false, collideW: 0, anchorY: 1 };

/**
 * Immagine 1x1 magenta. In Node (test) OffscreenCanvas non esiste: si usa
 * un oggetto fittizio con la stessa forma, dato che qui nessuno lo disegna
 * davvero, solo la sua dimensione è verificata.
 */
function makePlaceholderImage(): CanvasImageSource {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, 1, 1);
    }
    return canvas;
  }
  return { width: 1, height: 1 } as unknown as CanvasImageSource;
}

/** AssetStore vuoto: ogni sprite è un segnaposto magenta 1x1, usato prima che il binario C sia collegato. */
export function createEmptyAssets(): AssetStore {
  const placeholder = makePlaceholderImage();
  const asset = (name: SpriteName): SpriteAsset => ({
    name,
    image: placeholder,
    w: 1,
    h: 1,
    entry: PLACEHOLDER_ENTRY,
  });
  return {
    ready: Promise.resolve(),
    get: (name) => asset(name),
    has: () => false,
    stats: { png: 0, procedural: 0, missing: 0 },
  };
}
