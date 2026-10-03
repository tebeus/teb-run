import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { initialPlayer } from '../../src/game/player';
import { updateVisible } from '../../src/game/race';
import {
  FAR_WINDOW,
  PALETTES,
  ROAD_WINDOW,
  SKY_WINDOW,
  TRANSITION_SECONDS,
  blendPalette,
  mixHex,
  windowProgress,
} from '../../src/render/palette';
import { SEGMENT_LENGTH } from '../../src/render/project';
import { renderRoad } from '../../src/render/road';
import type { AssetStore, Segment, SpriteAsset } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeFlatTrack } from '../helpers/segments';

describe('windowProgress (spec §4.4d)', () => {
  test('the three windows are the ones of the spec', () => {
    expect(TRANSITION_SECONDS).toBe(6);
    expect(SKY_WINDOW).toEqual({ from: 0, to: 2.5 });
    expect(ROAD_WINDOW).toEqual({ from: 1.5, to: 4 });
    expect(FAR_WINDOW).toEqual({ from: 3, to: 6 });
  });

  test('it is 0 before the window, 1 after, and smooth in between', () => {
    expect(windowProgress(1, 1.5, 4)).toBe(0);
    expect(windowProgress(1.5, 1.5, 4)).toBe(0);
    expect(windowProgress(4, 1.5, 4)).toBe(1);
    expect(windowProgress(9, 1.5, 4)).toBe(1);
    expect(windowProgress(2.75, 1.5, 4)).toBeCloseTo(0.5, 10);
  });

  test('it leaves both ends flat, like smoothstep', () => {
    expect(windowProgress(1.6, 1.5, 4)).toBeLessThan(0.04);
    expect(windowProgress(3.9, 1.5, 4)).toBeGreaterThan(0.96);
  });

  test('a degenerate window switches at its own instant instead of dividing by zero', () => {
    expect(windowProgress(1, 2, 2)).toBe(0);
    expect(windowProgress(2, 2, 2)).toBe(1);
    expect(windowProgress(3, 2, 2)).toBe(1);
  });
});

describe('mixHex', () => {
  test('the ends are the two colours themselves', () => {
    expect(mixHex('#102030', '#a0b0c0', 0)).toBe('#102030');
    expect(mixHex('#102030', '#a0b0c0', 1)).toBe('#a0b0c0');
  });

  test('halfway is the average of the channels', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });

  test('it clamps t and always returns a six digit lowercase hex', () => {
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 3)).toBe('#ffffff');
    expect(mixHex('#012345', '#6789ab', 0.37)).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('a colour that is not a six digit hex falls back instead of throwing', () => {
    expect(() => mixHex('rgba(0,0,0,0.5)', '#ffffff', 0.5)).not.toThrow();
    expect(mixHex('nope', '#ffffff', 0.9)).toBe('#ffffff');
    expect(mixHex('nope', '#ffffff', 0.1)).toBe('nope');
  });
});

describe('blendPalette (spec §4.4d)', () => {
  const a = PALETTES.beach;
  const b = PALETTES.alpine;

  test('at zero it is the palette it comes from', () => {
    const p = blendPalette(a, b, 0, 0);
    expect(p.sky).toEqual(a.sky);
    expect(p.fog).toBe(a.fog);
    expect(p.grassLight).toBe(a.grassLight);
    expect(p.roadDark).toBe(a.roadDark);
    expect(p.waterLight).toBe(a.waterLight);
    expect(p.lanes).toBe(a.lanes);
    expect(p.asphaltTint).toBe(a.asphaltTint);
  });

  test('at one it is the palette it goes to', () => {
    const p = blendPalette(a, b, 1, 1);
    expect(p.sky).toEqual(b.sky);
    expect(p.fog).toBe(b.fog);
    expect(p.grassLight).toBe(b.grassLight);
    expect(p.shoulderDark).toBe(b.shoulderDark);
    expect(p.rumbleLight).toBe(b.rumbleLight);
    expect(p.lane).toBe(b.lane);
    expect(p.lanes).toBe(b.lanes);
    expect(p.asphaltTint).toBe(b.asphaltTint);
  });

  test('the sky moves on tSky and the road on tRoad, separately', () => {
    const skyFirst = blendPalette(a, b, 1, 0);
    expect(skyFirst.sky).toEqual(b.sky);
    expect(skyFirst.fog).toBe(b.fog);
    expect(skyFirst.grassLight).toBe(a.grassLight);
    expect(skyFirst.roadLight).toBe(a.roadLight);

    const roadFirst = blendPalette(a, b, 0, 1);
    expect(roadFirst.sky).toEqual(a.sky);
    expect(roadFirst.grassLight).toBe(b.grassLight);
  });

  test('halfway every colour sits between the two', () => {
    const p = blendPalette(a, b, 0.5, 0.5);
    expect(p.grassLight).toBe(mixHex(a.grassLight, b.grassLight, 0.5));
    expect(p.sky[0]).toBe(mixHex(a.sky[0], b.sky[0], 0.5));
    expect(p.grassLight).not.toBe(a.grassLight);
    expect(p.grassLight).not.toBe(b.grassLight);
  });

  test('every colour it returns is a hex the renderer can use', () => {
    const p = blendPalette(a, b, 0.3, 0.7);
    const colours = [
      ...p.sky,
      p.fog,
      p.grassLight,
      p.grassDark,
      p.shoulderLight,
      p.shoulderDark,
      p.rumbleLight,
      p.rumbleDark,
      p.roadLight,
      p.roadDark,
      p.lane,
      p.waterLight,
      p.waterDark,
      p.asphaltTint,
    ];
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('the tile names stay the ones of the first palette: the renderer draws both', () => {
    const p = blendPalette(a, b, 1, 1);
    expect(p.ground).toBe(a.ground);
    expect(p.asphalt).toBe(a.asphalt);
    expect(p.bgFar).toBe(a.bgFar);
    expect(p.clouds).toBe(a.clouds);
  });

  test('it does not mutate either palette', () => {
    const before = JSON.stringify([a, b]);
    blendPalette(a, b, 0.4, 0.6);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe('renderRoad con la seconda tessera (spec §4.4d)', () => {
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 512,
      h: 512,
      entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  const visible = (): Segment[] =>
    updateVisible(makeFlatTrack(400), { ...initialPlayer(), z: 20 * SEGMENT_LENGTH }, LOGICAL_W, LOGICAL_H);

  /** Tetto solo per la transizione: terreno e asfalto si disegnano due volte. */
  const TRANSITION_IMAGE_BUDGET = 800;

  test('without an overlay only the tiles of the current theme are drawn', () => {
    const rec = createRecordCtx();
    renderRoad(rec.ctx, visible(), PALETTES.beach, LOGICAL_W, { assets: store(), timeLeft: 60 });
    const names = new Set(rec.images().map((op) => op.image));
    expect(names.has('ground_beach')).toBe(true);
    expect(names.has('ground_alpine')).toBe(false);
  });

  test('with an overlay both tiles are drawn, the new one at the progress alpha', () => {
    const rec = createRecordCtx();
    renderRoad(rec.ctx, visible(), PALETTES.beach, LOGICAL_W, {
      assets: store(),
      timeLeft: 60,
      overlay: { ground: 'ground_alpine', asphalt: 'asphalt', alpha: 0.4 },
    });
    const images = rec.images();
    const old = images.filter((op) => op.image === 'ground_beach');
    const fresh = images.filter((op) => op.image === 'ground_alpine');
    expect(old.length).toBeGreaterThan(0);
    expect(fresh.length).toBe(old.length);
    // La tessera nuova va sopra, con l'alfa del progresso.
    for (const op of fresh) expect(op.alpha).toBeCloseTo(0.4, 10);
    for (const op of old) expect(op.alpha).toBe(1);
    expect(images.indexOf(fresh[0])).toBeGreaterThan(images.indexOf(old[0]));
  });

  test('an overlay at zero draws nothing extra: no invisible work', () => {
    const rec = createRecordCtx();
    renderRoad(rec.ctx, visible(), PALETTES.beach, LOGICAL_W, {
      assets: store(),
      timeLeft: 60,
      overlay: { ground: 'ground_alpine', asphalt: 'asphalt', alpha: 0 },
    });
    expect(rec.images().some((op) => op.image === 'ground_alpine')).toBe(false);
  });

  test('the transition frame stays inside its own image budget', () => {
    const rec = createRecordCtx();
    renderRoad(rec.ctx, visible(), PALETTES.beach, LOGICAL_W, {
      assets: store(),
      timeLeft: 60,
      overlay: { ground: 'ground_alpine', asphalt: 'asphalt', alpha: 0.5 },
    });
    expect(rec.images().length).toBeLessThan(TRANSITION_IMAGE_BUDGET);
  });

  test('the alpha is put back to one at the end of the segment', () => {
    const rec = createRecordCtx();
    renderRoad(rec.ctx, visible(), PALETTES.beach, LOGICAL_W, {
      assets: store(),
      timeLeft: 60,
      overlay: { ground: 'ground_alpine', asphalt: 'asphalt', alpha: 0.5 },
    });
    expect(rec.ctx.globalAlpha).toBe(1);
  });
});
