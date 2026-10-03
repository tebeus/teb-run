import { describe, expect, test } from 'vitest';
import { surfaceBlendOf } from '../../src/game/surface';
import {
  ASPHALT_TINT_ALPHA,
  DIRT_VEIL,
  DIRT_VEIL_ALPHA,
  DIRT_WEAR_ALPHA,
  drawWetSheen,
  hasKerb,
  kindAlpha,
  kindColour,
  NO_KERB_MIX,
  SNOW_VEIL,
  SNOW_VEIL_ALPHA,
  SNOW_WEAR_ALPHA,
  surfaceRoadColour,
  veilAlpha,
  veilColour,
  WEAR_ALPHA,
  WET_LANE_GLOW,
  WET_LANE_WIDEN,
  WET_SHEEN,
  WET_SHEEN_ALPHA,
  WET_VEIL,
  WET_VEIL_ALPHA,
  WET_VEIL_PULL,
  wearAlphaFor,
  wetLaneColour,
  wetVeilColour,
} from '../../src/render/ground';
import { mixHex, paletteFor } from '../../src/render/palette';
import { drawSegment } from '../../src/render/road';
import type { SurfaceKind } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeSegment } from '../helpers/segments';

const PAL = paletteFor('farm');
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const KINDS: readonly SurfaceKind[] = ['asphalt', 'dirt', 'snow', 'wet'];

/** Segmento proiettato a schermo, con la superficie che si vuole. */
const projected = (over: Parameters<typeof makeSegment>[1] = {}) => {
  const seg = makeSegment(10, over);
  seg.p1.screen = { x: 640, y: 600, w: 300, scale: 0.01 };
  seg.p2.screen = { x: 640, y: 500, w: 150, scale: 0.005 };
  return seg;
};

describe('colori e alfa per superficie (spec §4.4f)', () => {
  test('every kind has a colour and an alpha, all usable', () => {
    for (const kind of KINDS) {
      expect(kindColour(PAL, kind), kind).toMatch(HEX6);
      expect(kindAlpha(kind), kind).toBeGreaterThan(0);
      expect(kindAlpha(kind), kind).toBeLessThanOrEqual(1);
    }
  });

  test('dry asphalt is the stage tint at the alpha of the H track', () => {
    expect(kindColour(PAL, 'asphalt')).toBe(PAL.asphaltTint);
    expect(kindAlpha('asphalt')).toBe(ASPHALT_TINT_ALPHA);
    expect(ASPHALT_TINT_ALPHA).toBe(0.32);
  });

  test('dirt and snow have their own colours, the same on every theme', () => {
    expect(kindColour(paletteFor('desert'), 'dirt')).toBe(DIRT_VEIL);
    expect(kindColour(paletteFor('farm'), 'dirt')).toBe(DIRT_VEIL);
    expect(kindColour(paletteFor('alpine'), 'snow')).toBe(SNOW_VEIL);
    expect(kindAlpha('dirt')).toBe(DIRT_VEIL_ALPHA);
    expect(kindAlpha('snow')).toBe(SNOW_VEIL_ALPHA);
  });

  test('wet keeps the tint of the stage, pulled toward the dark: the two rainy stages stay distinguishable', () => {
    const harbor = paletteFor('town');
    const coast = paletteFor('farm');
    expect(kindColour(harbor, 'wet')).toBe(mixHex(harbor.asphaltTint, WET_VEIL, WET_VEIL_PULL));
    expect(kindColour(coast, 'wet')).not.toBe(kindColour(harbor, 'wet'));
    expect(kindAlpha('wet')).toBe(WET_VEIL_ALPHA);
  });

  test('wetVeilColour has a one slot memory and still answers right when the tint changes', () => {
    const a = wetVeilColour('#405060');
    const b = wetVeilColour('#802010');
    expect(a).not.toBe(b);
    expect(wetVeilColour('#405060')).toBe(a);
    expect(a).toBe(mixHex('#405060', WET_VEIL, WET_VEIL_PULL));
  });
});

describe('veilColour e veilAlpha: la miscela (spec §4.4f)', () => {
  test('a dry segment is exactly what the H track drew', () => {
    const blend = surfaceBlendOf(projected());
    expect(veilColour(PAL, blend)).toBe(PAL.asphaltTint);
    expect(veilAlpha(blend)).toBe(ASPHALT_TINT_ALPHA);
  });

  test('a full dirt segment is dirt, and the ramp is in between', () => {
    const full = surfaceBlendOf(projected({ surfaceKind: 'dirt', surfaceMix: 1 }));
    expect(veilColour(PAL, full)).toBe(DIRT_VEIL);
    expect(veilAlpha(full)).toBe(DIRT_VEIL_ALPHA);
    const half = surfaceBlendOf(projected({ surfaceKind: 'dirt', surfaceMix: 0.5 }));
    expect(veilColour(PAL, half)).toBe(mixHex(PAL.asphaltTint, DIRT_VEIL, 0.5));
    expect(veilAlpha(half)).toBeCloseTo((ASPHALT_TINT_ALPHA + DIRT_VEIL_ALPHA) / 2, 10);
  });

  test('the alpha never leaves [0, 1] for any pairing', () => {
    for (const kind of KINDS) {
      for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
        for (const weather of ['clear', 'rain'] as const) {
          const blend = surfaceBlendOf(projected({ surfaceKind: kind, surfaceMix: mix }), weather);
          const a = veilAlpha(blend);
          expect(a, `${kind} ${mix} ${weather}`).toBeGreaterThanOrEqual(0);
          expect(a, `${kind} ${mix} ${weather}`).toBeLessThanOrEqual(1);
          expect(veilColour(PAL, blend), `${kind} ${mix} ${weather}`).toMatch(HEX6);
        }
      }
    }
  });
});

describe('surfaceRoadColour: la superficie a ogni distanza', () => {
  test('dry asphalt returns the very string it was given: no allocation, no change', () => {
    const blend = surfaceBlendOf(projected());
    const base = PAL.roadLight;
    expect(surfaceRoadColour(PAL, base, blend)).toBe(base);
  });

  test('dirt darkens the flat road colour toward the dirt', () => {
    const blend = surfaceBlendOf(projected({ surfaceKind: 'dirt', surfaceMix: 1 }));
    expect(surfaceRoadColour(PAL, PAL.roadLight, blend)).toBe(
      mixHex(PAL.roadLight, DIRT_VEIL, DIRT_VEIL_ALPHA),
    );
  });

  test('rain darkens the flat road colour even where no run is written', () => {
    const blend = surfaceBlendOf(projected(), 'rain');
    const got = surfaceRoadColour(PAL, PAL.roadLight, blend);
    expect(got).not.toBe(PAL.roadLight);
    expect(got).toBe(mixHex(PAL.roadLight, kindColour(PAL, 'wet'), WET_VEIL_ALPHA));
  });

  test('snow lightens the flat road colour', () => {
    const blend = surfaceBlendOf(projected({ surfaceKind: 'snow', surfaceMix: 1 }));
    const got = surfaceRoadColour(PAL, PAL.roadDark, blend);
    const [r] = [Number.parseInt(got.slice(1, 3), 16)];
    expect(r).toBeGreaterThan(Number.parseInt(PAL.roadDark.slice(1, 3), 16));
  });
});

describe('cordoli e tracce per superficie (spec §4.4f)', () => {
  test('dry asphalt, snow and wet keep their kerb; dirt loses it', () => {
    const at = (kind: SurfaceKind, mix: number): boolean =>
      hasKerb(surfaceBlendOf(projected({ surfaceKind: kind, surfaceMix: mix })));
    expect(at('asphalt', 1)).toBe(true);
    expect(at('snow', 1)).toBe(true);
    expect(at('dirt', 1)).toBe(false);
    expect(hasKerb(surfaceBlendOf(projected(), 'rain'))).toBe(true);
  });

  test('the kerb disappears halfway along the ramp, not at its start', () => {
    const at = (mix: number): boolean =>
      hasKerb(surfaceBlendOf(projected({ surfaceKind: 'dirt', surfaceMix: mix })));
    expect(NO_KERB_MIX).toBe(0.5);
    expect(at(0.5)).toBe(true);
    expect(at(0.51)).toBe(false);
  });

  test('the wear tracks get darker on dirt and on snow, and stay faint on asphalt', () => {
    const at = (kind: SurfaceKind, mix: number, weather: 'clear' | 'rain' = 'clear'): number =>
      wearAlphaFor(surfaceBlendOf(projected({ surfaceKind: kind, surfaceMix: mix }), weather));
    expect(at('asphalt', 0)).toBe(WEAR_ALPHA);
    expect(at('dirt', 1)).toBe(DIRT_WEAR_ALPHA);
    expect(at('snow', 1)).toBe(SNOW_WEAR_ALPHA);
    expect(at('dirt', 0.5)).toBeCloseTo((WEAR_ALPHA + DIRT_WEAR_ALPHA) / 2, 10);
    expect(at('asphalt', 0, 'rain')).toBe(WEAR_ALPHA);
    expect(DIRT_WEAR_ALPHA).toBeGreaterThan(WEAR_ALPHA);
  });
});

describe('il riflesso del bagnato (spec §4.4f)', () => {
  test('the sheen is drawn on a dark wet segment and nowhere else', () => {
    const rec = createRecordCtx();
    drawWetSheen(rec.ctx, projected({ dark: true }), 1);
    const fills = rec.ops.filter((op) => op.type === 'fill');
    expect(fills).toHaveLength(1);
    expect(fills[0].fill).toBe(WET_SHEEN);
  });

  test('no wetness, no sheen, and no alpha left behind', () => {
    const rec = createRecordCtx();
    drawWetSheen(rec.ctx, projected({ dark: true }), 0);
    expect(rec.ops.filter((op) => op.type === 'fill')).toHaveLength(0);
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  test('the sheen alpha follows the wetness and stays tiny', () => {
    const rec = createRecordCtx();
    drawWetSheen(rec.ctx, projected({ dark: true }), 0.5);
    expect(rec.fills().map((op) => op.alpha)).toContain(WET_SHEEN_ALPHA * 0.5);
    expect(WET_SHEEN_ALPHA).toBeLessThan(0.1);
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  test('the lane lines widen and brighten on a wet road', () => {
    expect(WET_LANE_WIDEN).toBe(1.35);
    expect(WET_LANE_GLOW).toBeGreaterThan(0);
    expect(WET_LANE_GLOW).toBeLessThanOrEqual(1);
    const lane = wetLaneColour(PAL.lane, PAL.rumbleLight);
    expect(lane).toBe(mixHex(PAL.lane, PAL.rumbleLight, WET_LANE_GLOW));
  });
});

describe('drawSegment con una superficie (spec §4.4a, §4.4f)', () => {
  const opts = (weather: 'clear' | 'rain') => ({
    assets: {
      ready: Promise.resolve(),
      get: (name: string) => ({
        name,
        image: { name } as unknown as CanvasImageSource,
        w: 512,
        h: 512,
        entry: { kind: 'texture' as const, scale: 1, solid: false, collideW: 0, anchorY: 1 },
      }),
      has: () => true,
      stats: { png: 0, procedural: 0, missing: 0 },
    },
    timeLeft: 40,
    lanes: 4,
    weather,
  });

  test('a dirt segment draws two fewer quads than an asphalt one: the kerb is gone', () => {
    const dry = createRecordCtx();
    drawSegment(dry.ctx, 1280, projected(), PAL, 0, 0.1, opts('clear'));
    const dirt = createRecordCtx();
    drawSegment(dirt.ctx, 1280, projected({ surfaceKind: 'dirt', surfaceMix: 1 }), PAL, 0, 0.1, opts('clear'));
    const fills = (r: ReturnType<typeof createRecordCtx>): number =>
      r.ops.filter((op) => op.type === 'fill').length;
    expect(fills(dirt)).toBe(fills(dry) - 2);
  });

  test('a wet dark segment draws one more quad than a dry one: the sheen', () => {
    const dry = createRecordCtx();
    drawSegment(dry.ctx, 1280, projected({ dark: true }), PAL, 0, 0.1, opts('clear'));
    const wet = createRecordCtx();
    drawSegment(wet.ctx, 1280, projected({ dark: true }), PAL, 0, 0.1, opts('rain'));
    const fills = (r: ReturnType<typeof createRecordCtx>): number =>
      r.ops.filter((op) => op.type === 'fill').length;
    expect(fills(wet)).toBe(fills(dry) + 1);
  });

  test('no weather in the options is dry asphalt: the frame is the one of before', () => {
    const withOpts = createRecordCtx();
    const { weather: _drop, ...noWeather } = opts('clear');
    drawSegment(withOpts.ctx, 1280, projected(), PAL, 0, 0.1, noWeather);
    const withClear = createRecordCtx();
    drawSegment(withClear.ctx, 1280, projected(), PAL, 0, 0.1, opts('clear'));
    expect(withOpts.ops.map((o) => o.type)).toEqual(withClear.ops.map((o) => o.type));
  });

  test('the frame leaves the alpha at one, on every surface', () => {
    for (const kind of KINDS) {
      for (const weather of ['clear', 'rain'] as const) {
        const rec = createRecordCtx();
        drawSegment(rec.ctx, 1280, projected({ surfaceKind: kind, surfaceMix: 1, dark: true }), PAL, 0.2, 0.9, opts(weather));
        expect(rec.ctx.globalAlpha, `${kind} ${weather}`).toBe(1);
      }
    }
  });
});
