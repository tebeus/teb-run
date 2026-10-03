import { describe, expect, test } from 'vitest';
import { initialPlayer } from '../../src/game/player';
import { stageById } from '../../src/game/stages';
import {
  createParticles,
  DUST_PER_WHEEL,
  MAX_PARTICLES,
  PLAYER_SEGMENT_OFFSET,
  RAIN_DROPS,
  RAIN_FALL_MAX,
  RAIN_FALL_MIN,
  RAIN_LEN_MAX,
  RAIN_LEN_MIN,
  RAIN_SLANT,
  SAND_DRIFT_MAX,
  SAND_DRIFT_MIN,
  SAND_LEN_MAX,
  SAND_MOTES,
  SAND_TOP,
  SNOW_COLOR,
  SNOW_FLAKES,
  SNOW_HEAVY,
  SNOW_THEME,
  SURFACE_DUST_PER_WHEEL,
  SURFACE_SPRAY_PER_WHEEL,
  WEATHER_MAX,
  wantsSurfaceDust,
  wantsSurfaceSpray,
  weatherCountFor,
  weatherKindFor,
  weatherOf,
  RAIN_COLOR,
  SAND_COLOR,
} from '../../src/render/effects';
import { paletteFor } from '../../src/render/palette';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import type { RaceSnapshot, ThemeId, Weather } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeSegment } from '../helpers/segments';

const THEMES: readonly ThemeId[] = ['beach', 'desert', 'alpine', 'farm', 'town'];
const WEATHERS: readonly Weather[] = ['clear', 'rain', 'snow', 'dust'];

/** Snapshot minimo con il tema e il meteo che si vogliono. */
function snap(theme: ThemeId, weather: Weather, over: Partial<RaceSnapshot> = {}): RaceSnapshot {
  const stage = { ...stageById('0-0'), theme, weather };
  return {
    segments: [makeSegment(0), makeSegment(1), makeSegment(2)],
    player: initialPlayer(),
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 40,
    score: 0,
    stage,
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme,
    banner: 'none',
    kmh: 0,
    ...over,
  };
}

/** Un campo con le meteore già seminate e avanzate di un tick. */
const settled = (theme: ThemeId, weather: Weather, rng = () => 0.5) => {
  const field = createParticles(rng);
  field.update(1 / 60, snap(theme, weather));
  field.update(1 / 60, snap(theme, weather));
  return field;
};

describe('la piscina di meteore: dimensione e conteggi (spec §4.4f)', () => {
  test('the pool is big enough for the heaviest weather, and fixed', () => {
    expect(WEATHER_MAX).toBe(150);
    for (const n of [SNOW_FLAKES, SNOW_HEAVY, RAIN_DROPS, SAND_MOTES]) {
      expect(WEATHER_MAX).toBeGreaterThanOrEqual(n);
    }
    expect(SNOW_HEAVY).toBe(140);
    expect(RAIN_DROPS).toBe(110);
    expect(SAND_MOTES).toBe(140);
    // La nevicata del binario H non cambia di un fiocco.
    expect(SNOW_FLAKES).toBe(60);
    expect(SNOW_THEME).toBe('alpine');
  });

  test('every pairing of theme and weather resolves to exactly one kind, or to none', () => {
    for (const theme of THEMES) {
      for (const weather of WEATHERS) {
        const kind = weatherKindFor(theme, weather);
        expect([null, 'snow', 'rain', 'sand'], `${theme} ${weather}`).toContain(kind);
        const count = weatherCountFor(theme, weather);
        if (kind === null) expect(count, `${theme} ${weather}`).toBe(0);
        else {
          expect(count, `${theme} ${weather}`).toBeGreaterThan(0);
          expect(count, `${theme} ${weather}`).toBeLessThanOrEqual(WEATHER_MAX);
        }
      }
    }
  });

  test('rain falls on every theme it is given, and dust turns into sand', () => {
    for (const theme of THEMES) {
      expect(weatherKindFor(theme, 'rain'), theme).toBe('rain');
      expect(weatherCountFor(theme, 'rain'), theme).toBe(RAIN_DROPS);
      expect(weatherKindFor(theme, 'dust'), theme).toBe('sand');
      expect(weatherCountFor(theme, 'dust'), theme).toBe(SAND_MOTES);
    }
  });

  test('rain on an alpine stage draws drops and no flakes (Review Focus 4)', () => {
    expect(weatherKindFor('alpine', 'rain')).toBe('rain');
    const field = settled('alpine', 'rain');
    expect(field.weatherCount).toBe(RAIN_DROPS);
    expect(field.snowCount).toBe(0);
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('alpine'), LOGICAL_W, LOGICAL_H);
    expect(rec.ops.filter((op) => op.type === 'stroke')).toHaveLength(RAIN_DROPS);
    expect(rec.ops.filter((op) => op.type === 'ellipse')).toHaveLength(0);
  });

  test('Pine Pass keeps the sixty flakes of the H track: the theme snows, not the weather', () => {
    expect(weatherKindFor('alpine', 'clear')).toBe('snow');
    expect(weatherCountFor('alpine', 'clear')).toBe(SNOW_FLAKES);
    const field = settled('alpine', 'clear');
    expect(field.snowCount).toBe(SNOW_FLAKES);
    expect(field.weatherCount).toBe(SNOW_FLAKES);
  });

  test('a snow weather on the mountains makes it snow harder', () => {
    expect(weatherCountFor('alpine', 'snow')).toBe(SNOW_HEAVY);
    expect(SNOW_HEAVY).toBeGreaterThan(SNOW_FLAKES);
    expect(settled('alpine', 'snow').snowCount).toBe(SNOW_HEAVY);
  });

  test('a stage without weather spawns no motes (Review Focus 1)', () => {
    for (const theme of ['beach', 'desert', 'farm', 'town'] as const) {
      const field = createParticles(() => 0.5);
      // Meteo assente del tutto, non `'clear'`: lo snapshot di una
      // schermata che costruisce la tappa a mano.
      const missing = snap(theme, 'clear');
      delete (missing.stage as { weather?: Weather }).weather;
      expect(weatherOf(missing), theme).toBe('clear');
      field.update(1 / 60, missing);
      expect(field.weatherCount, theme).toBe(0);
      expect(field.snowCount, theme).toBe(0);
      const rec = createRecordCtx();
      field.draw(rec.ctx, paletteFor(theme), LOGICAL_W, LOGICAL_H);
      expect(rec.ops.filter((op) => op.type === 'stroke'), theme).toHaveLength(0);
    }
  });
});

describe('come si muovono e come si disegnano (spec §4.4f)', () => {
  test('a drop of rain falls fast and slanted, and is drawn as a line', () => {
    const field = settled('town', 'rain');
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('town'), LOGICAL_W, LOGICAL_H);
    const strokes = rec.ops.filter((op) => op.type === 'stroke');
    expect(strokes).toHaveLength(RAIN_DROPS);
    expect(strokes[0].fill).toBe(RAIN_COLOR);
    // Ogni goccia è un `moveTo` più un `lineTo`, e la linea è obliqua:
    // dx / dy vale `RAIN_SLANT`.
    const moves = rec.ops.filter((op) => op.type === 'moveTo');
    const lines = rec.ops.filter((op) => op.type === 'lineTo');
    expect(moves).toHaveLength(RAIN_DROPS);
    expect(lines).toHaveLength(RAIN_DROPS);
    const dy = lines[0].args[1] - moves[0].args[1];
    const dx = lines[0].args[0] - moves[0].args[0];
    expect(dy).toBeGreaterThanOrEqual(RAIN_LEN_MIN);
    expect(dy).toBeLessThanOrEqual(RAIN_LEN_MAX);
    expect(dx / dy).toBeCloseTo(RAIN_SLANT, 6);
  });

  test('a mote of sand crosses the road: it drifts far more than it falls', () => {
    const field = settled('desert', 'dust');
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('desert'), LOGICAL_W, LOGICAL_H);
    const strokes = rec.ops.filter((op) => op.type === 'stroke');
    expect(strokes).toHaveLength(SAND_MOTES);
    expect(strokes[0].fill).toBe(SAND_COLOR);
    const moves = rec.ops.filter((op) => op.type === 'moveTo');
    const lines = rec.ops.filter((op) => op.type === 'lineTo');
    const dx = Math.abs(lines[0].args[0] - moves[0].args[0]);
    const dy = Math.abs(lines[0].args[1] - moves[0].args[1]);
    expect(dx).toBeGreaterThan(dy);
    expect(dx).toBeLessThanOrEqual(SAND_LEN_MAX);
    expect(SAND_DRIFT_MIN).toBeGreaterThan(RAIN_FALL_MIN / 4);
    expect(SAND_DRIFT_MAX).toBeLessThan(RAIN_FALL_MAX);
  });

  test('the sand stays in the lower part of the screen: it is on the road, not in the sky', () => {
    const field = settled('desert', 'dust', () => 0.1);
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('desert'), LOGICAL_W, LOGICAL_H);
    for (const op of rec.ops.filter((o) => o.type === 'moveTo')) {
      expect(op.args[1]).toBeGreaterThanOrEqual(LOGICAL_H * SAND_TOP - SAND_LEN_MAX);
    }
  });

  test('snow is still drawn as circles, in the colour of the H track', () => {
    const field = settled('alpine', 'clear');
    const rec = createRecordCtx();
    field.draw(rec.ctx, paletteFor('alpine'), LOGICAL_W, LOGICAL_H);
    const ellipses = rec.ops.filter((op) => op.type === 'ellipse');
    expect(ellipses.length).toBeGreaterThanOrEqual(SNOW_FLAKES);
    expect(rec.ops.some((op) => op.type === 'fill' && op.fill === SNOW_COLOR)).toBe(true);
    expect(rec.ops.filter((op) => op.type === 'stroke')).toHaveLength(0);
  });

  test('a coarse tick leaves every mote on screen (Review Focus 2)', () => {
    // `core/loop` limita l'accumulato a 0,25 s: un tick può valerli
    // tutti, e a 920 px/s una goccia cade 230 px, meno di uno schermo.
    for (const [theme, weather] of [
      ['town', 'rain'],
      ['desert', 'dust'],
      ['alpine', 'snow'],
      ['alpine', 'clear'],
    ] as const) {
      const field = createParticles(() => 0.5);
      for (let i = 0; i < 20; i++) field.update(0.25, snap(theme, weather));
      const rec = createRecordCtx();
      field.draw(rec.ctx, paletteFor(theme), LOGICAL_W, LOGICAL_H);
      const points = rec.ops.filter((op) => op.type === 'moveTo' || op.type === 'ellipse');
      expect(points.length, `${theme} ${weather}`).toBeGreaterThan(0);
      for (const op of points) {
        expect(Number.isFinite(op.args[0]), `${theme} ${weather}`).toBe(true);
        expect(op.args[0], `${theme} ${weather}`).toBeGreaterThanOrEqual(-SAND_LEN_MAX);
        expect(op.args[0], `${theme} ${weather}`).toBeLessThanOrEqual(LOGICAL_W + SAND_LEN_MAX);
        expect(op.args[1], `${theme} ${weather}`).toBeGreaterThanOrEqual(-RAIN_LEN_MAX);
        expect(op.args[1], `${theme} ${weather}`).toBeLessThanOrEqual(LOGICAL_H + RAIN_LEN_MAX);
      }
    }
  });

  test('the field leaves the alpha at one, on every weather', () => {
    for (const [theme, weather] of [
      ['town', 'rain'],
      ['desert', 'dust'],
      ['alpine', 'snow'],
      ['beach', 'clear'],
    ] as const) {
      const rec = createRecordCtx();
      settled(theme, weather).draw(rec.ctx, paletteFor(theme), LOGICAL_W, LOGICAL_H);
      expect(rec.ctx.globalAlpha, `${theme} ${weather}`).toBe(1);
    }
  });
});

describe('il cambio di meteo alla giunzione (spec §4.4d)', () => {
  test('leaving a weather thins the motes out instead of switching them off', () => {
    const field = createParticles(() => 0.5);
    field.update(1 / 60, snap('town', 'rain'));
    expect(field.weatherCount).toBe(RAIN_DROPS);
    // Giunzione verso una tappa senza meteo, con la transizione in corso.
    const leaving = (t: number): RaceSnapshot =>
      snap('town', 'clear', { transition: { from: 'town', to: 'town', t, fromId: '3-0' } });
    field.update(1 / 60, leaving(0));
    expect(field.weatherCount).toBe(RAIN_DROPS);
    field.update(1 / 60, leaving(4.5));
    expect(field.weatherCount).toBeGreaterThan(0);
    expect(field.weatherCount).toBeLessThan(RAIN_DROPS);
    field.update(1 / 60, leaving(6));
    expect(field.weatherCount).toBe(0);
  });

  test('entering a weather with no motes before it starts at once, with no fade', () => {
    const field = createParticles(() => 0.5);
    field.update(
      1 / 60,
      snap('town', 'rain', { transition: { from: 'farm', to: 'town', t: 0.1, fromId: '2-2' } }),
    );
    expect(field.weatherCount).toBe(RAIN_DROPS);
  });

  test('a junction without a transition switches the motes at once', () => {
    const field = createParticles(() => 0.5);
    field.update(1 / 60, snap('town', 'rain'));
    field.update(1 / 60, snap('town', 'clear'));
    expect(field.weatherCount).toBe(0);
  });

  test('clear() puts the field back to empty', () => {
    const field = settled('desert', 'dust');
    expect(field.weatherCount).toBeGreaterThan(0);
    field.clear();
    expect(field.weatherCount).toBe(0);
    expect(field.snowCount).toBe(0);
  });
});

describe('spruzzi sul bagnato e polvere sullo sterrato (spec §4.4b, §4.4f)', () => {
  /** Snapshot con la superficie voluta sotto le ruote. */
  const onSurface = (
    kind: 'asphalt' | 'dirt' | 'snow' | 'wet',
    weather: Weather,
    over: { kmh?: number; crash?: boolean; x?: number } = {},
  ): RaceSnapshot => {
    const theme: ThemeId = kind === 'snow' ? 'alpine' : kind === 'dirt' ? 'farm' : 'town';
    const segments = Array.from({ length: PLAYER_SEGMENT_OFFSET + 3 }, (_, i) => {
      const seg = makeSegment(i);
      seg.themeId = theme;
      if (kind === 'dirt' || kind === 'snow') {
        seg.surfaceKind = kind;
        seg.surfaceMix = 1;
      }
      return seg;
    });
    const base = snap(theme, weather, { segments });
    return {
      ...base,
      player: { ...base.player, x: over.x ?? 0, speed: ((over.kmh ?? 250) / 293) * 12000 },
      crash: { active: over.crash ?? false, t: 0, frame: 0 },
      kmh: over.kmh ?? 250,
    };
  };

  test('a wet road throws spray from the wheels, and a dry one does not', () => {
    expect(wantsSurfaceSpray(onSurface('asphalt', 'rain'))).toBe(true);
    expect(wantsSurfaceSpray(onSurface('asphalt', 'clear'))).toBe(false);
  });

  test('a dirt run under the wheels stops the spray even when it rains', () => {
    // 4-2 Windmill Coast: campagna e pioggia, con tratti di sterrato.
    expect(wantsSurfaceSpray(onSurface('dirt', 'rain'))).toBe(false);
    expect(wantsSurfaceDust(onSurface('dirt', 'rain'))).toBe(true);
  });

  test('a dirt run throws dust on the road, not only off it', () => {
    const on = onSurface('dirt', 'clear');
    expect(on.player.surface).toBe('road');
    expect(wantsSurfaceDust(on)).toBe(true);
  });

  test('snow throws neither spray nor dust: it is not water and it is not dirt', () => {
    expect(wantsSurfaceSpray(onSurface('snow', 'clear'))).toBe(false);
    expect(wantsSurfaceDust(onSurface('snow', 'clear'))).toBe(false);
  });

  test('standing still, crashed or out of time there is nothing', () => {
    expect(wantsSurfaceSpray(onSurface('asphalt', 'rain', { kmh: 5 }))).toBe(false);
    expect(wantsSurfaceDust(onSurface('dirt', 'clear', { kmh: 5 }))).toBe(false);
    expect(wantsSurfaceSpray(onSurface('asphalt', 'rain', { crash: true }))).toBe(false);
    expect(wantsSurfaceDust(onSurface('dirt', 'clear', { crash: true }))).toBe(false);
    const expired = { ...onSurface('asphalt', 'rain'), timeLeft: 0 };
    expect(wantsSurfaceSpray(expired)).toBe(false);
  });

  test('a snapshot with no segments at all answers no, and does not throw (Review Focus 1)', () => {
    const empty = { ...onSurface('asphalt', 'rain'), segments: [] };
    expect(() => wantsSurfaceSpray(empty)).not.toThrow();
    expect(wantsSurfaceSpray(empty)).toBe(false);
    expect(wantsSurfaceDust(empty)).toBe(false);
  });

  test('the surface dust is denser than the one of the roadside', () => {
    expect(SURFACE_DUST_PER_WHEEL).toBeGreaterThan(DUST_PER_WHEEL);
    expect(SURFACE_SPRAY_PER_WHEEL).toBeGreaterThan(0);
  });

  test('a tick on a wet road makes particles, and one on a dry road makes fewer', () => {
    const wet = createParticles(() => 0.5);
    wet.update(1 / 60, onSurface('asphalt', 'rain'));
    const dry = createParticles(() => 0.5);
    dry.update(1 / 60, onSurface('asphalt', 'clear'));
    expect(wet.count).toBe(dry.count + 2 * SURFACE_SPRAY_PER_WHEEL);
  });

  test('a tick on a dirt road makes the dense dust, on top of whatever the driving makes', () => {
    const dirt = createParticles(() => 0.5);
    dirt.update(1 / 60, onSurface('dirt', 'clear'));
    const asphalt = createParticles(() => 0.5);
    asphalt.update(1 / 60, onSurface('asphalt', 'clear'));
    expect(dirt.count).toBe(asphalt.count + 2 * SURFACE_DUST_PER_WHEEL);
  });

  test('the surface effects never push the pool past its ceiling', () => {
    const field = createParticles(() => 0.5);
    // Derapata su asfalto bagnato: fumo, spruzzi e tutto il resto.
    const skidding = onSurface('asphalt', 'rain');
    const state = { ...skidding, player: { ...skidding.player, skidding: true } };
    for (let i = 0; i < 300; i++) field.update(1 / 60, state);
    expect(field.count).toBeLessThanOrEqual(MAX_PARTICLES);
  });
});
