import { SEGMENT_LENGTH } from '../../src/render/project';
import type { Segment, SpriteAsset, SpriteCatalogEntry, ThemeId } from '../../src/types';

/** Segmento piatto e rettilineo all'indice dato, con sovrascritture. */
export function makeSegment(index: number, over: Partial<Segment> = {}, theme: ThemeId = 'beach'): Segment {
  return {
    index,
    p1: {
      world: { x: 0, y: 0, z: index * SEGMENT_LENGTH },
      camera: { x: 0, y: 0, z: 0 },
      screen: { x: 0, y: 0, w: 0, scale: 0 },
    },
    p2: {
      world: { x: 0, y: 0, z: (index + 1) * SEGMENT_LENGTH },
      camera: { x: 0, y: 0, z: 0 },
      screen: { x: 0, y: 0, w: 0, scale: 0 },
    },
    curve: 0,
    sprites: [],
    cars: [],
    themeId: theme,
    dark: Math.floor(index / 3) % 2 === 1,
    clip: 0,
    roadHalf: 1,
    median: 0,
    ...over,
  };
}

/** Tracciato piatto di n segmenti, con curvatura costante opzionale. */
export function makeFlatTrack(n: number, curve = 0): Segment[] {
  return Array.from({ length: n }, (_, i) => makeSegment(i, { curve }));
}

/** Sprite finto: l'immagine non viene mai disegnata nei test. */
export function makeAsset(
  name: string,
  w: number,
  h: number,
  entry: Partial<SpriteCatalogEntry> = {},
): SpriteAsset {
  return {
    name,
    image: {} as CanvasImageSource,
    w,
    h,
    entry: { kind: 'scenery', scale: 0.5, solid: false, collideW: 0, anchorY: 1, ...entry },
  };
}
