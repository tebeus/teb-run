import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { initialPlayer } from '../../src/game/player';
import { stageById } from '../../src/game/stages';
import {
  CRASH_DEBRIS,
  CRASH_SPARKS,
  createParticles,
  dustKind,
  GRASS_THEMES,
  MAX_PARTICLES,
  PARTICLE_SPECS,
  PLAYER_SEGMENT_OFFSET,
  playerSegment,
  SPEED_LINES_MIN,
  wantsSpeedLines,
  wantsSplash,
} from '../../src/render/effects';
import { paletteFor } from '../../src/render/palette';
import type { AssetStore, RaceSnapshot, Segment, SpriteAsset, ThemeId } from '../../src/types';
import { makeSegment } from '../helpers/segments';
import { createRecordCtx } from '../helpers/recordCtx';

function snap(o: {
  theme?: ThemeId;
  x?: number;
  surface?: 'road' | 'shoulder' | 'grass';
  kmh?: number;
  water?: 'left' | 'right';
  segments?: Segment[];
  crash?: boolean;
}): RaceSnapshot {
  const theme = o.theme ?? 'beach';
  const stage = { ...stageById('0-0'), theme };
  const segments =
    o.segments ??
    Array.from({ length: PLAYER_SEGMENT_OFFSET + 3 }, (_, i) => {
      const seg = makeSegment(i);
      seg.themeId = theme;
      if (o.water !== undefined) seg.water = o.water;
      return seg;
    });
  return {
    segments,
    player: {
      ...initialPlayer(),
      x: o.x ?? 0,
      speed: ((o.kmh ?? 0) / 293) * 12000,
      surface: o.surface ?? 'road',
    },
    crash: { active: o.crash ?? false, t: 0, frame: 0 },
    timeLeft: 40,
    score: 0,
    stage,
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme,
    banner: 'none',
    kmh: o.kmh ?? 0,
  };
}

const store = (w = 320, h = 180): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w,
    h,
    entry: CATALOG[name] ?? { kind: 'ui', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

describe('erba e terra fuori strada (spec §4.4b)', () => {
  test('farm and alpine throw grass, the other three throw dust', () => {
    expect([...GRASS_THEMES].sort()).toEqual(['alpine', 'farm']);
    expect(dustKind('farm')).toBe('grass');
    expect(dustKind('alpine')).toBe('grass');
    expect(dustKind('beach')).toBe('dust');
    expect(dustKind('desert')).toBe('dust');
    expect(dustKind('town')).toBe('dust');
  });

  test('off road in the farm the particles are grass, not dust', () => {
    const field = createParticles(() => 0.5);
    field.update(1 / 60, snap({ theme: 'farm', surface: 'grass', x: 1.6, kmh: 200 }));
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('farm'), LOGICAL_W, LOGICAL_H, store());
    expect(rec.images().every((op) => op.image === 'fx_grass_spray')).toBe(true);
    expect(rec.images().length).toBeGreaterThan(0);
  });
});

describe('spruzzi d\'acqua (spec §4.4b)', () => {
  test('the player segment is the one PLAYER_Z ahead of the camera', () => {
    const s = snap({});
    expect(playerSegment(s)?.index).toBe(PLAYER_SEGMENT_OFFSET);
  });

  test('a splash needs water on the very side the player is off the road on', () => {
    expect(wantsSplash(snap({ water: 'left', surface: 'grass', x: -1.6 }))).toBe(true);
    expect(wantsSplash(snap({ water: 'left', surface: 'grass', x: 1.6 }))).toBe(false);
    expect(wantsSplash(snap({ water: 'right', surface: 'grass', x: 1.6 }))).toBe(true);
  });

  test('no splash on a dry theme, on the dry side, or with a short segment slice', () => {
    expect(wantsSplash(snap({ surface: 'grass', x: -1.6 }))).toBe(false);
    expect(wantsSplash(snap({ water: 'left', surface: 'road', x: 0 }))).toBe(false);
    expect(wantsSplash(snap({ water: 'left', surface: 'shoulder', x: -1.2 }))).toBe(false);
    expect(wantsSplash(snap({ water: 'left', surface: 'grass', x: -1.6, segments: [] }))).toBe(false);
    // Isola centrale del bivio: superficie d'erba ma dentro la strada.
    expect(wantsSplash(snap({ water: 'left', surface: 'grass', x: -0.5 }))).toBe(false);
  });

  test('a splash draws the water sprite', () => {
    const field = createParticles(() => 0.5);
    field.update(1 / 60, snap({ water: 'right', surface: 'grass', x: 1.6, kmh: 200 }));
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('beach'), LOGICAL_W, LOGICAL_H, store());
    expect(rec.images().some((op) => op.image === 'fx_water_splash')).toBe(true);
  });
});

describe('righe di velocità (spec §4.4b)', () => {
  test('they appear above ninety per cent and never in a crash or out of time', () => {
    expect(SPEED_LINES_MIN).toBeCloseTo(0.9, 10);
    expect(wantsSpeedLines(snap({ kmh: 293 }))).toBe(true);
    expect(wantsSpeedLines(snap({ kmh: 250 }))).toBe(false);
    expect(wantsSpeedLines(snap({ kmh: 293, crash: true }))).toBe(false);
    expect(wantsSpeedLines({ ...snap({ kmh: 293 }), timeLeft: 0 })).toBe(false);
  });

  test('two streaks per tick, one from each edge', () => {
    const field = createParticles(() => 0.5);
    field.update(1 / 60, snap({ kmh: 293 }));
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('beach'), LOGICAL_W, LOGICAL_H, store(640, 200));
    const lines = rec.images().filter((op) => op.image === 'fx_speed_lines');
    expect(lines).toHaveLength(2);
    // Una nasce a sinistra del centro, l'altra a destra.
    expect(lines[0].args[0]).toBeLessThan(LOGICAL_W / 2);
    expect(lines[1].args[0]).toBeGreaterThan(LOGICAL_W / 2);
  });
});

describe('scoppio dell\'incidente (spec §4.4b)', () => {
  test('a burst emits debris, sparks and a single impact star', () => {
    const field = createParticles(() => 0.5);
    field.burst('crash');
    expect(field.count).toBe(CRASH_DEBRIS + CRASH_SPARKS + 1);
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('beach'), LOGICAL_W, LOGICAL_H, store());
    const names = rec.images().map((op) => op.image);
    expect(names.filter((n) => n === 'fx_impact')).toHaveLength(1);
    expect(names.filter((n) => n === 'fx_sparks')).toHaveLength(CRASH_SPARKS);
    // Metà pezzi grossi e metà ghiaia: due sprite diversi, perché il PNG
    // `fx_debris_small` è una striscia piatta (300x70) e da sola farebbe
    // solo trattini (spec §13).
    expect(names.filter((n) => n === 'fx_debris_large')).toHaveLength(CRASH_DEBRIS / 2);
    expect(names.filter((n) => n === 'fx_debris_small')).toHaveLength(CRASH_DEBRIS / 2);
  });

  test('debris fall: gravity bends them downward', () => {
    // Non si confronta con l'istante zero: i detriti partono anche verso
    // l'alto (`-120` di spinta iniziale) e le scintille partono tutte in
    // alto, quindi nei primi decimi la media sale. La gravità si vede
    // confrontando due istanti **tardi**, quando ha già vinto.
    const field = createParticles(() => 0.5);
    field.burst('crash');
    const meanY = (): number => {
      const rec = createRecordCtx();
      field.draw(rec.ctx, paletteFor('beach'), LOGICAL_W, LOGICAL_H, store());
      const ys = rec.images().map((op) => op.args[1]);
      return ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length);
    };
    for (let i = 0; i < 20; i++) field.update(1 / 60, snap({}));
    const early = meanY();
    for (let i = 0; i < 12; i++) field.update(1 / 60, snap({}));
    const late = meanY();
    expect(late).toBeGreaterThan(early);
    for (const spec of Object.values(PARTICLE_SPECS)) expect(spec.gravity).toBeGreaterThanOrEqual(0);
  });

  test('the pool holds a whole burst on top of a skid', () => {
    // Il tetto è quello che il binario H ha già alzato per il pennacchio
    // di derapata: questo binario non lo cambia (deroga 5).
    expect(MAX_PARTICLES).toBe(256);
    expect(MAX_PARTICLES).toBeGreaterThan(CRASH_DEBRIS + CRASH_SPARKS + 1 + 6);
  });

  test('the alpine snowfall survives the rewrite', () => {
    // La neve del binario H ha una piscina sua, fuori da `MAX_PARTICLES`:
    // `burst` e i tipi nuovi non la toccano.
    const field = createParticles(() => 0.5);
    expect(field.snowCount).toBe(0);
    field.update(1 / 60, snap({ theme: 'alpine' }));
    expect(field.snowCount).toBeGreaterThan(0);
    field.burst('crash');
    expect(field.snowCount).toBeGreaterThan(0);
    field.clear();
    expect(field.snowCount).toBe(0);
  });

  test('a coarse tick never leaves a live particle past its life', () => {
    const field = createParticles(() => 0.5);
    field.burst('crash');
    field.update(0.25, snap({}));
    field.update(0.25, snap({}));
    field.update(0.25, snap({}));
    expect(field.count).toBe(0);
  });
});

describe('sprite di particella e ripiego a cerchi (spec §4.4b)', () => {
  test('without an AssetStore the particles are still circles', () => {
    const field = createParticles(() => 0.5);
    field.burst('crash');
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('beach'), LOGICAL_W, LOGICAL_H);
    expect(rec.images()).toHaveLength(0);
    expect(rec.ops.filter((op) => op.type === 'ellipse').length).toBe(CRASH_DEBRIS + CRASH_SPARKS + 1);
  });

  test('a four-argument draw still works: the fifth parameter is optional', () => {
    // È la forma che usano i test di `tests/render/effects.test.ts` e
    // che questo task non deve rompere.
    const field = createParticles(() => 0.5);
    field.update(1 / 60, snap({ surface: 'grass', x: 1.6, kmh: 200 }));
    const rec = createRecordCtx();
    expect(() => field.draw(rec.ctx, paletteFor('beach'), LOGICAL_W, LOGICAL_H)).not.toThrow();
    expect(rec.ops.filter((op) => op.type === 'ellipse').length).toBeGreaterThan(0);
  });

  test('an asset with no size falls back to the circle too', () => {
    const field = createParticles(() => 0.5);
    field.burst('crash');
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('beach'), LOGICAL_W, LOGICAL_H, store(0, 0));
    expect(rec.images()).toHaveLength(0);
    expect(rec.ops.filter((op) => op.type === 'ellipse').length).toBeGreaterThan(0);
  });

  test('every spec names a sprite that is in the catalog', () => {
    for (const [kind, spec] of Object.entries(PARTICLE_SPECS)) {
      expect(CATALOG[spec.sprite], `${kind} → ${spec.sprite}`).toBeDefined();
    }
  });

  test('the frame leaves the alpha at one', () => {
    const field = createParticles(() => 0.5);
    field.burst('crash');
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('beach'), LOGICAL_W, LOGICAL_H, store());
    expect(rec.ctx.globalAlpha).toBe(1);
  });
});
