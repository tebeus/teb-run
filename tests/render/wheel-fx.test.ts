import { describe, expect, test } from 'vitest';
import { initialPlayer } from '../../src/game/player';
import { stageById } from '../../src/game/stages';
import {
  BURNOUT_MAX_SPEED,
  BURNOUT_SMOKE_PER_WHEEL,
  MUD_COLOR,
  PARTICLE_SPECS,
  PLAYER_SEGMENT_OFFSET,
  SKID_SMOKE_PER_WHEEL,
  SMOKE_COLOR,
  SNOW_COLOR,
  SNOW_SPRAY_COLOR,
  WHEEL_EVENTS,
  WHEEL_GROUNDS,
  createParticles,
  wheelCountFor,
  wheelEventOf,
  wheelGroundOf,
  wheelParticleFor,
  wheelSizeFor,
  type ParticleKind,
  type WheelEvent,
  type WheelGround,
} from '../../src/render/effects';
import { PALETTES } from '../../src/render/palette';
import type { PlayerState, RaceSnapshot, SurfaceKind, ThemeId, Weather } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeSegment } from '../helpers/segments';

/** Fondo ed evento → particella attesa, tema `town` (polvere fuori strada). */
const EXPECTED: Record<WheelGround, Record<WheelEvent, ParticleKind | null>> = {
  asphalt: { skid: 'smoke', burnout: 'smoke', roll: null },
  wet: { skid: 'splash', burnout: 'splash', roll: 'splash' },
  puddle: { skid: 'splash', burnout: 'splash', roll: 'splash' },
  dirt: { skid: 'mud', burnout: 'mud', roll: 'mud' },
  snow: { skid: 'snowspray', burnout: 'snowspray', roll: 'snowspray' },
  offroad: { skid: 'dust', burnout: 'dust', roll: 'dust' },
};

describe('wheelParticleFor: una sola particella per fondo ed evento', () => {
  test('la tabella completa fondo × evento', () => {
    for (const ground of WHEEL_GROUNDS) {
      for (const event of WHEEL_EVENTS) {
        expect(wheelParticleFor(ground, event, 'town'), `${ground}/${event}`).toBe(EXPECTED[ground][event]);
      }
    }
  });

  test('il fumo grigio esiste solo sull\'asfalto asciutto', () => {
    for (const ground of WHEEL_GROUNDS) {
      for (const event of WHEEL_EVENTS) {
        for (const theme of ['beach', 'desert', 'alpine', 'farm', 'town'] as const) {
          if (ground === 'asphalt') continue;
          expect(wheelParticleFor(ground, event, theme)).not.toBe('smoke');
        }
      }
    }
  });

  test('fuori strada in campagna e montagna si solleva erba', () => {
    expect(wheelParticleFor('offroad', 'skid', 'farm')).toBe('grass');
    expect(wheelParticleFor('offroad', 'burnout', 'alpine')).toBe('grass');
  });

  test('sull\'asfalto asciutto i conteggi del fumo sono quelli di sempre', () => {
    expect(wheelCountFor('asphalt', 'skid')).toBe(SKID_SMOKE_PER_WHEEL);
    expect(wheelCountFor('asphalt', 'burnout')).toBe(BURNOUT_SMOKE_PER_WHEEL);
    expect(wheelCountFor('asphalt', 'roll')).toBe(0);
    expect(wheelSizeFor('smoke', 'skid', 1)).toBe(1);
  });

  test('in derapata più particelle che girando, e mai meno del fumo', () => {
    for (const ground of WHEEL_GROUNDS) {
      expect(wheelCountFor(ground, 'skid')).toBeGreaterThanOrEqual(SKID_SMOKE_PER_WHEEL);
      expect(wheelCountFor(ground, 'skid')).toBeGreaterThan(wheelCountFor(ground, 'roll'));
      expect(wheelCountFor(ground, 'burnout')).toBeGreaterThanOrEqual(BURNOUT_SMOKE_PER_WHEEL);
    }
  });

  test('il materiale di derapata cresce con la velocità', () => {
    expect(wheelSizeFor('mud', 'skid', 1)).toBeGreaterThan(wheelSizeFor('mud', 'skid', 0.3));
    expect(wheelSizeFor('mud', 'roll', 1)).toBe(1);
  });

  test('terra bruna e neve bianca, distinte dai fiocchi', () => {
    expect(PARTICLE_SPECS.mud.tint).toBe(MUD_COLOR);
    expect(PARTICLE_SPECS.snowspray.tint).toBe(SNOW_SPRAY_COLOR);
    expect(SNOW_SPRAY_COLOR).not.toBe(SNOW_COLOR);
    // Bruno: il rosso sopra il verde sopra il blu, e scuro.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(MUD_COLOR.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeLessThan(160);
    // Neve: quasi bianca.
    for (const i of [1, 3, 5]) expect(parseInt(SNOW_SPRAY_COLOR.slice(i, i + 2), 16)).toBeGreaterThan(220);
  });
});

/** Snapshot sul fondo voluto, con la guida voluta. */
function on(
  ground: 'asphalt' | 'dirt' | 'snow' | 'shoulder' | 'grass' | 'wet',
  player: Partial<PlayerState>,
  kmh: number,
): RaceSnapshot {
  const weather: Weather = ground === 'wet' ? 'rain' : 'clear';
  const theme: ThemeId = 'town';
  const segments = Array.from({ length: PLAYER_SEGMENT_OFFSET + 3 }, (_, i) => {
    const seg = makeSegment(i);
    seg.themeId = theme;
    if (ground === 'dirt' || ground === 'snow') {
      seg.surfaceKind = ground as SurfaceKind;
      seg.surfaceMix = 1;
    }
    return seg;
  });
  const offRoad = ground === 'shoulder' || ground === 'grass';
  return {
    segments,
    player: {
      ...initialPlayer(),
      surface: offRoad ? ground : 'road',
      x: ground === 'grass' ? 1.6 : ground === 'shoulder' ? 1.1 : 0,
      ...player,
    },
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 40,
    score: 0,
    stage: { ...stageById('0-0'), theme, weather },
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme,
    banner: 'none',
    kmh,
  };
}

const DRIVES: Record<WheelEvent, [Partial<PlayerState>, number]> = {
  skid: [{ skidding: true }, 200],
  burnout: [{ accelerating: true }, 293 * (BURNOUT_MAX_SPEED - 0.04)],
  roll: [{}, 200],
};

describe('createParticles: nessun fumo grigio fuori dall\'asfalto asciutto', () => {
  test('il fondo si legge dallo snapshot', () => {
    expect(wheelGroundOf(on('asphalt', {}, 200))).toBe('asphalt');
    expect(wheelGroundOf(on('wet', {}, 200))).toBe('wet');
    expect(wheelGroundOf(on('dirt', {}, 200))).toBe('dirt');
    expect(wheelGroundOf(on('snow', {}, 200))).toBe('snow');
    expect(wheelGroundOf(on('shoulder', {}, 200))).toBe('offroad');
    expect(wheelGroundOf(on('grass', {}, 200))).toBe('offroad');
  });

  for (const ground of ['dirt', 'snow', 'shoulder', 'grass', 'wet'] as const) {
    for (const event of WHEEL_EVENTS) {
      test(`${ground}, ${event}: niente fumo, e un solo tipo di particella`, () => {
        const [player, kmh] = DRIVES[event];
        const snap = on(ground, player, kmh);
        const field = createParticles(() => 0.5);
        field.update(1 / 60, snap);
        const gr = wheelGroundOf(snap);
        const ev = wheelEventOf(snap);
        expect(ev).not.toBeNull();
        expect(field.count).toBe(2 * wheelCountFor(gr, ev as WheelEvent));
        const rec = createRecordCtx();
        field.draw(rec.ctx, PALETTES.town, 1280, 720);
        const fills = rec.ops.filter((op) => op.type === 'fill').map((op) => op.fill);
        expect(fills.length).toBe(field.count);
        expect(fills).not.toContain(SMOKE_COLOR);
        expect(new Set(fills).size).toBe(1);
      });
    }
  }

  test('asfalto asciutto: derapata e partenza restano fumo grigio', () => {
    for (const event of ['skid', 'burnout'] as const) {
      const [player, kmh] = DRIVES[event];
      const field = createParticles(() => 0.5);
      field.update(1 / 60, on('asphalt', player, kmh));
      expect(field.count).toBe(2 * (event === 'skid' ? SKID_SMOKE_PER_WHEEL : BURNOUT_SMOKE_PER_WHEEL));
      const rec = createRecordCtx();
      field.draw(rec.ctx, PALETTES.town, 1280, 720);
      const fills = rec.ops.filter((op) => op.type === 'fill').map((op) => op.fill);
      expect(new Set(fills)).toEqual(new Set([SMOKE_COLOR]));
    }
  });

  test('asfalto asciutto girando: niente', () => {
    const field = createParticles(() => 0.5);
    field.update(1 / 60, on('asphalt', {}, 200));
    expect(field.count).toBe(0);
  });
});
