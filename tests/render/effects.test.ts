import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { initialPlayer } from '../../src/game/player';
import { DEMO_STAGE } from '../../src/game/demo-stage';
import {
  BURNOUT_MAX_SPEED,
  BURNOUT_SMOKE_PER_WHEEL,
  DUST_LIFE,
  DUST_MIN_SPEED,
  DUST_PER_WHEEL,
  MAX_PARTICLES,
  PLAYER_DH,
  PLAYER_DW,
  SKID_SMOKE_PER_WHEEL,
  SMOKE_COLOR,
  SMOKE_LIFE,
  SMOKE_R1,
  SNOW_ALPHA,
  SNOW_COLOR,
  SNOW_FALL_MAX,
  SNOW_FALL_MIN,
  SNOW_FLAKES,
  SNOW_R0,
  SNOW_R1,
  SMOKE_OUTWARD_DRIFT,
  WHEEL_DX,
  WHEEL_Y_FROM_BOTTOM,
  WHEELS_BY_CAR,
  createParticles,
  emitKind,
  playerDHFor,
  speedPercentOf,
  wheelDXFor,
  wheelYFromBottomFor,
} from '../../src/render/effects';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { FAR_WINDOW, PALETTES, TRANSITION_SECONDS } from '../../src/render/palette';
import { playerCarSize } from '../../src/render/world';
import type { CarChoice, PlayerState, RaceSnapshot } from '../../src/types';
import { makeAsset } from '../helpers/segments';
import { createRecordCtx } from '../helpers/recordCtx';

const snap = (player: Partial<PlayerState>, over: Partial<RaceSnapshot> = {}): RaceSnapshot => ({
  segments: [],
  player: { ...initialPlayer(), ...player },
  crash: { active: false, t: 0, frame: 0 },
  timeLeft: 60,
  score: 0,
  stage: DEMO_STAGE,
  level: 0,
  route: [],
  parallax: { far: 0, near: 0, y: 0 },
  theme: 'beach',
  banner: 'none',
  kmh: 200,
  ...over,
});

/** Generatore finto: ritorna sempre la stessa sequenza. */
const fakeRng = (): (() => number) => {
  let i = 0;
  const values = [0.1, 0.5, 0.9, 0.3, 0.7];
  return () => values[i++ % values.length];
};

describe('speedPercentOf', () => {
  test('it comes from kmh, clamped to 0..1', () => {
    expect(speedPercentOf(snap({}, { kmh: 293 }))).toBeCloseTo(1, 10);
    expect(speedPercentOf(snap({}, { kmh: 0 }))).toBe(0);
    expect(speedPercentOf(snap({}, { kmh: -10 }))).toBe(0);
    expect(speedPercentOf(snap({}, { kmh: 999 }))).toBe(1);
  });
});

describe('emitKind (spec §4.4b)', () => {
  test('a skid smokes', () => {
    expect(emitKind(snap({ skidding: true }))).toBe('skidSmoke');
  });

  test('off the asphalt above 10 per cent it raises dust', () => {
    expect(emitKind(snap({ surface: 'shoulder' }))).toBe('dust');
    expect(emitKind(snap({ surface: 'grass' }))).toBe('dust');
  });

  test('a standing car on the shoulder emits nothing', () => {
    expect(emitKind(snap({ surface: 'shoulder' }, { kmh: 0 }))).toBe('none');
    expect(emitKind(snap({ surface: 'grass' }, { kmh: 293 * DUST_MIN_SPEED }))).toBe('none');
  });

  test('on the asphalt with grip and no throttle nothing is emitted', () => {
    expect(emitKind(snap({}, { kmh: 293 * (BURNOUT_MAX_SPEED + 0.1) }))).toBe('none');
  });

  test('during a crash and after the time is out nothing is emitted', () => {
    expect(emitKind(snap({ skidding: true }, { crash: { active: true, t: 0.1, frame: 1 } }))).toBe('none');
    expect(emitKind(snap({ skidding: true }, { timeLeft: 0 }))).toBe('none');
  });

  test('the smoke of a skid wins over the dust', () => {
    expect(emitKind(snap({ skidding: true, surface: 'grass' }))).toBe('skidSmoke');
  });

  describe('burnout smoke (spec §4.4b, fumo di partenza)', () => {
    const lowSpeedKmh = 293 * (BURNOUT_MAX_SPEED - 0.05);

    test('holding the throttle below the threshold, on the asphalt, smokes', () => {
      expect(emitKind(snap({ accelerating: true }, { kmh: lowSpeedKmh }))).toBe('burnoutSmoke');
    });

    test('without the throttle held there is no burnout smoke', () => {
      expect(emitKind(snap({ accelerating: false }, { kmh: lowSpeedKmh }))).toBe('none');
    });

    test('past the speed threshold the burnout smoke stops', () => {
      expect(emitKind(snap({ accelerating: true }, { kmh: 293 * BURNOUT_MAX_SPEED }))).toBe('none');
      expect(emitKind(snap({ accelerating: true }, { kmh: 293 * (BURNOUT_MAX_SPEED + 0.2) }))).toBe('none');
    });

    test('off the asphalt the throttle raises dust instead, never burnout smoke', () => {
      expect(emitKind(snap({ accelerating: true, surface: 'grass' }, { kmh: lowSpeedKmh }))).toBe('dust');
    });

    test('a skid still wins over burnout smoke', () => {
      expect(emitKind(snap({ accelerating: true, skidding: true }, { kmh: lowSpeedKmh }))).toBe('skidSmoke');
    });
  });
});

describe('createParticles', () => {
  test('a fresh field is empty', () => {
    expect(createParticles(fakeRng()).count).toBe(0);
  });

  test('a skidding tick emits three particles per rear wheel', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, snap({ skidding: true }));
    expect(field.count).toBe(2 * SKID_SMOKE_PER_WHEEL);
  });

  test('a burnout tick emits two particles per rear wheel', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, snap({ accelerating: true }, { kmh: 293 * (BURNOUT_MAX_SPEED - 0.05) }));
    expect(field.count).toBe(2 * BURNOUT_SMOKE_PER_WHEEL);
  });

  test('a dusty tick emits two particles per rear wheel', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, snap({ surface: 'grass' }));
    expect(field.count).toBe(2 * DUST_PER_WHEEL);
  });

  test('il tetto copre una vita intera di emissione, cosi il pennacchio non viene troncato', () => {
    // Con il tetto sotto questo valore il riciclo taglia le nuvolette prima
    // che si allontanino dalla ruota, e restano due dischi impilati.
    const needed = 2 * SKID_SMOKE_PER_WHEEL * 60 * SMOKE_LIFE;
    expect(MAX_PARTICLES).toBeGreaterThanOrEqual(needed);
  });

  test('the field never holds more than MAX_PARTICLES particles', () => {
    const field = createParticles(fakeRng());
    for (let i = 0; i < 1200; i++) field.update(1 / 600, snap({ skidding: true }));
    expect(field.count).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  test('particles die when their life runs out', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, snap({ skidding: true }));
    expect(field.count).toBeGreaterThan(0);
    field.update(SMOKE_LIFE + 0.01, snap({}));
    expect(field.count).toBe(0);
  });

  test('a coarse tick never leaves a live particle past its life', () => {
    const field = createParticles(fakeRng());
    field.update(0.3, snap({ surface: 'grass' }));
    expect(field.count).toBe(2 * DUST_PER_WHEEL);
    // Due tick grossi sommano 0.6 s, cioè esattamente DUST_LIFE.
    field.update(0.3, snap({}));
    field.update(0.3, snap({}));
    expect(field.count).toBe(0);
    expect(DUST_LIFE).toBe(0.6);
  });

  test('clear empties the field', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, snap({ skidding: true }));
    field.clear();
    expect(field.count).toBe(0);
  });

  test('the same rng draws exactly the same frame', () => {
    const a = createParticles(fakeRng());
    const b = createParticles(fakeRng());
    a.update(1 / 60, snap({ skidding: true }));
    b.update(1 / 60, snap({ skidding: true }));
    const one = createRecordCtx();
    const two = createRecordCtx();
    a.draw(one.ctx, PALETTES.beach, 1280, 720);
    b.draw(two.ctx, PALETTES.beach, 1280, 720);
    expect(two.ops).toEqual(one.ops);
  });

  test('smoke is drawn near the rear wheels, in the lower half of the screen', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, snap({ skidding: true }));
    const rec = createRecordCtx();
    field.draw(rec.ctx, PALETTES.beach, 1280, 720);
    const spots = rec.ops.filter((op) => op.type === 'ellipse');
    expect(spots.length).toBe(2 * SKID_SMOKE_PER_WHEEL);
    for (const op of spots) {
      expect(Math.abs(op.args[0] - 640)).toBeGreaterThan(WHEEL_DX / 2);
      expect(Math.abs(op.args[0] - 640)).toBeLessThan(WHEEL_DX * 2);
      expect(op.args[1]).toBeGreaterThan(360);
      expect(op.args[1]).toBeLessThanOrEqual(720);
    }
  });

  test('smoke drifts outward at exactly SMOKE_OUTWARD_DRIFT px/s, not at random (spec §4.4b)', () => {
    expect(SMOKE_OUTWARD_DRIFT).toBe(90);
    // rng costante: niente sbandamento casuale, così la posizione iniziale è
    // esattamente 640 ± WHEEL_DX e il lato di nascita si legge dal segno.
    const field = createParticles(() => 0.5);
    field.update(1 / 60, snap({ skidding: true }));
    const before = createRecordCtx();
    field.draw(before.ctx, PALETTES.beach, 1280, 720);
    const xsBefore = before.ops.filter((op) => op.type === 'ellipse').map((op) => op.args[0]);
    expect(xsBefore).toHaveLength(2 * SKID_SMOKE_PER_WHEEL);

    // Un secondo tick, senza nuova emissione: solo invecchiamento.
    field.update(1 / 60, snap({}));
    const after = createRecordCtx();
    field.draw(after.ctx, PALETTES.beach, 1280, 720);
    const xsAfter = after.ops.filter((op) => op.type === 'ellipse').map((op) => op.args[0]);

    const dt = 1 / 60;
    for (let i = 0; i < xsBefore.length; i++) {
      const side = xsBefore[i] < 640 ? -1 : 1;
      expect(xsAfter[i] - xsBefore[i]).toBeCloseTo(side * SMOKE_OUTWARD_DRIFT * dt, 9);
    }
  });

  test('dust takes the shoulder colour of the theme', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, snap({ surface: 'grass' }));
    const rec = createRecordCtx();
    field.draw(rec.ctx, PALETTES.town, 1280, 720);
    expect(rec.ops.some((op) => op.type === 'fill' && op.fill === PALETTES.town.shoulderDark)).toBe(true);
  });

  test('an empty field draws nothing and leaves the alpha alone', () => {
    const rec = createRecordCtx();
    createParticles(fakeRng()).draw(rec.ctx, PALETTES.beach, 1280, 720);
    expect(rec.ops).toHaveLength(0);
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  test('a non positive dt neither ages nor emits', () => {
    const field = createParticles(fakeRng());
    field.update(0, snap({ skidding: true }));
    expect(field.count).toBe(0);
  });
});

describe('le ruote seguono la larghezza disegnata dell\'auto', () => {
  test('PLAYER_DW is exactly the width the world draws', () => {
    const asset = makeAsset('player_straight', 274, 200, {
      kind: 'player',
      scale: CATALOG.player_straight.scale,
    });
    expect(PLAYER_DW).toBeCloseTo(playerCarSize(asset, asset, 1280).w, 9);
    expect(PLAYER_DW).toBeCloseTo(232.96, 2);
  });

  test('the wheels sit just outside and below the bottom of the car body (spec §4.4b)', () => {
    expect(WHEEL_DX).toBeCloseTo(0.41 * PLAYER_DW, 9);
    // Cabrio del Set 7: ruote a 95 px dal centro, dentro i 116 del fianco.
    expect(WHEEL_DX).toBeGreaterThan(60);
    expect(WHEEL_DX).toBeLessThan(PLAYER_DW / 2);
    expect(WHEEL_Y_FROM_BOTTOM).toBeCloseTo(0.18 * PLAYER_DH, 9);
    // All'altezza del mozzo: sopra il fondo dell'auto, e con la nuvoletta piu
    // grande ancora tutta dentro il canvas.
    expect(WHEEL_Y_FROM_BOTTOM).toBeGreaterThan(SMOKE_R1 * 0.5);
    expect(WHEEL_Y_FROM_BOTTOM).toBeLessThan(PLAYER_DH * 0.25);
  });
});

describe('le nuvolette seguono la ruota della propria auto (bugfix WHEELS_BY_CAR)', () => {
  // Frazioni misurate sul PNG dritto di ciascuna auto (a 200 px di
  // altezza, `manifest.json`): centro del battistrada rispetto al centro
  // dell'immagine, come frazione della larghezza nativa, media delle due
  // ruote. `player_straight` è 274×200, `player_classic_straight` 313×200,
  // `player_retro_straight` 249×200, `player_sport_straight` 255×200, `player_super_straight` 331×200. Con
  // una frazione sola per tutte il fumo nascerebbe fuori dal battistrada vero.
  const MEASURED_DX_FRACTION: Record<CarChoice, number> = { new: 0.4066, classic: 0.4005, retro: 0.3966, sport: 0.4206, super: 0.4152 };

  test('WHEELS_BY_CAR riproduce esattamente WHEEL_DX/PLAYER_ASPECT per l\'auto nuova', () => {
    expect(WHEELS_BY_CAR.new.dx * PLAYER_DW).toBeCloseTo(WHEEL_DX, 9);
    expect(WHEELS_BY_CAR.new.aspect).toBeCloseTo(PLAYER_DH / PLAYER_DW, 9);
    expect(wheelDXFor('new')).toBeCloseTo(WHEEL_DX, 9);
    expect(wheelYFromBottomFor('new')).toBeCloseTo(WHEEL_Y_FROM_BOTTOM, 9);
    expect(playerDHFor('new')).toBeCloseTo(PLAYER_DH, 9);
  });

  test.each<CarChoice>(['new', 'classic', 'retro', 'sport', 'super'])(
    'il centro del battistrada di %s cade entro 3 px (a 1280) da quello misurato sul PNG',
    (car) => {
      const measured = MEASURED_DX_FRACTION[car] * PLAYER_DW;
      expect(Math.abs(wheelDXFor(car) - measured)).toBeLessThan(3);
    },
  );

  test('la classica è più bassa in proporzione: il fumo nasce più vicino al fondo dello schermo', () => {
    // 313×200 è più largo in proporzione di 274×200: a parità di larghezza a
    // schermo (PLAYER_DW, spec §4.4 punto 5), la classica è disegnata più
    // bassa, e la nuvoletta con lei.
    expect(playerDHFor('classic')).toBeLessThan(playerDHFor('new'));
    expect(wheelYFromBottomFor('classic')).toBeLessThan(wheelYFromBottomFor('new'));
  });

  test('retrò e sportiva sono più alte in proporzione: il fumo nasce più in alto', () => {
    // 249×200 e 255×200 sono più strette in proporzione di 274×200: a parità
    // di larghezza a schermo (PLAYER_DW, spec §4.4 punto 5), sono disegnate
    // più alte, e la nuvoletta con loro.
    for (const car of ['retro', 'sport'] as const) {
      expect(playerDHFor(car)).toBeGreaterThan(playerDHFor('new'));
      expect(wheelYFromBottomFor(car)).toBeGreaterThan(wheelYFromBottomFor('new'));
    }
  });

  test.each<CarChoice>(['new', 'classic', 'retro', 'sport', 'super'])(
    'il fumo di derapata di %s nasce centrato sulla ruota della propria auto',
    (car) => {
      const field = createParticles(() => 0.5);
      field.update(1 / 60, snap({ skidding: true }), car);
      const rec = createRecordCtx();
      field.draw(rec.ctx, PALETTES.beach, 1280, 720);
      const spots = rec.ops.filter((op) => op.type === 'ellipse');
      expect(spots.length).toBe(2 * SKID_SMOKE_PER_WHEEL);
      const dx = wheelDXFor(car);
      for (const op of spots) {
        // rng costante a 0.5: nessuno sbandamento di nascita (SPAWN_SPREAD_*).
        expect(Math.abs(Math.abs(op.args[0] - 640) - dx)).toBeLessThan(1);
      }
    },
  );

  test('senza indicare l\'auto, update si comporta come prima (auto nuova)', () => {
    const withDefault = createParticles(() => 0.5);
    withDefault.update(1 / 60, snap({ skidding: true }));
    const recDefault = createRecordCtx();
    withDefault.draw(recDefault.ctx, PALETTES.beach, 1280, 720);

    const withNew = createParticles(() => 0.5);
    withNew.update(1 / 60, snap({ skidding: true }), 'new');
    const recNew = createRecordCtx();
    withNew.draw(recNew.ctx, PALETTES.beach, 1280, 720);

    expect(recDefault.ops).toEqual(recNew.ops);
  });
});

describe('nevicata delle tappe alpine (addendum del task 15)', () => {
  // Il tema che decide la neve (task 8) si legge da `stage.theme`, non dal
  // solo `theme` in cima allo snapshot: le due fonti coincidono sempre nel
  // motore vero, quindi qui `theme` guida entrambe. `stage.weather` resta
  // assente (come DEMO_STAGE), così il meteo di default è `'clear'` e la
  // nevicata dipende solo dal tema, come prima del task 8.
  const alpine = (over: Partial<RaceSnapshot> = {}): RaceSnapshot => {
    const theme = over.theme ?? 'alpine';
    return {
      ...snap({}),
      ...over,
      theme,
      stage: { ...DEMO_STAGE, theme },
    } as RaceSnapshot;
  };

  test('fuori dalle tappe alpine non nevica', () => {
    const field = createParticles(fakeRng());
    for (const theme of ['beach', 'desert', 'farm', 'town'] as const) {
      field.update(1 / 60, alpine({ theme }));
    }
    expect(field.snowCount).toBe(0);
    const rec = createRecordCtx();
    field.draw(rec.ctx, PALETTES.beach, LOGICAL_W, LOGICAL_H);
    expect(rec.ops.some((op) => op.fill === SNOW_COLOR)).toBe(false);
  });

  test('il primo tick alpino semina i fiocchi su tutto lo schermo', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, alpine());
    expect(field.snowCount).toBe(SNOW_FLAKES);
    const rec = createRecordCtx();
    field.draw(rec.ctx, PALETTES.alpine, LOGICAL_W, LOGICAL_H);
    const flakes = rec.ops.filter((op) => op.type === 'ellipse' && op.fill === SNOW_COLOR);
    expect(flakes).toHaveLength(SNOW_FLAKES);
    for (const f of flakes) {
      expect(f.args[0]).toBeGreaterThanOrEqual(0);
      expect(f.args[0]).toBeLessThanOrEqual(LOGICAL_W);
      expect(f.args[1]).toBeGreaterThanOrEqual(0);
      expect(f.args[1]).toBeLessThanOrEqual(LOGICAL_H);
      expect(f.args[2]).toBeGreaterThanOrEqual(SNOW_R0);
      expect(f.args[2]).toBeLessThanOrEqual(SNOW_R1);
      expect(f.alpha).toBeCloseTo(SNOW_ALPHA, 9);
    }
  });

  test('i fiocchi cadono fra 40 e 80 px/s e derivano di lato', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, alpine());
    const at = (): { x: number; y: number }[] => {
      const rec = createRecordCtx();
      field.draw(rec.ctx, PALETTES.alpine, LOGICAL_W, LOGICAL_H);
      return rec.ops
        .filter((op) => op.type === 'ellipse' && op.fill === SNOW_COLOR)
        .map((op) => ({ x: op.args[0], y: op.args[1] }));
    };
    const before = at();
    const dt = 0.1;
    field.update(dt, alpine());
    const after = at();
    let drifted = 0;
    for (let i = 0; i < before.length; i++) {
      const dy = after[i].y - before[i].y;
      // Chi non e' stato riciclato dal fondo dello schermo.
      if (dy < 0) continue;
      expect(dy).toBeGreaterThanOrEqual(SNOW_FALL_MIN * dt - 1e-9);
      expect(dy).toBeLessThanOrEqual(SNOW_FALL_MAX * dt + 1e-9);
      if (Math.abs(after[i].x - before[i].x) > 1e-9) drifted++;
    }
    expect(drifted).toBeGreaterThan(0);
  });

  test('un fiocco sceso in fondo rientra dall alto', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, alpine());
    // Dieci secondi: ogni fiocco ha attraversato lo schermo piu di una volta.
    for (let i = 0; i < 100; i++) field.update(0.1, alpine());
    const rec = createRecordCtx();
    field.draw(rec.ctx, PALETTES.alpine, LOGICAL_W, LOGICAL_H);
    const flakes = rec.ops.filter((op) => op.type === 'ellipse' && op.fill === SNOW_COLOR);
    expect(flakes).toHaveLength(SNOW_FLAKES);
    for (const f of flakes) {
      expect(f.args[1]).toBeGreaterThan(-SNOW_R1 - 1e-9);
      expect(f.args[1]).toBeLessThanOrEqual(LOGICAL_H + SNOW_R1);
      expect(f.args[0]).toBeGreaterThan(-SNOW_R1 - 1e-9);
      expect(f.args[0]).toBeLessThan(LOGICAL_W + SNOW_R1 + 1e-9);
    }
  });

  test('la nevicata e deterministica dal seme', () => {
    const run = (): number[] => {
      const field = createParticles(fakeRng());
      for (let i = 0; i < 30; i++) field.update(1 / 60, alpine());
      const rec = createRecordCtx();
      field.draw(rec.ctx, PALETTES.alpine, LOGICAL_W, LOGICAL_H);
      return rec.ops.filter((op) => op.fill === SNOW_COLOR).flatMap((op) => op.args);
    };
    expect(run()).toEqual(run());
  });

  test('la neve sta davanti a fumo e polvere', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, alpine({ player: { ...snap({}).player, skidding: true } }));
    const rec = createRecordCtx();
    field.draw(rec.ctx, PALETTES.alpine, LOGICAL_W, LOGICAL_H);
    const lastSmoke = rec.ops.map((op) => op.fill).lastIndexOf(SMOKE_COLOR);
    const firstFlake = rec.ops.findIndex((op) => op.fill === SNOW_COLOR);
    expect(lastSmoke).toBeGreaterThanOrEqual(0);
    expect(firstFlake).toBeGreaterThan(lastSmoke);
  });

  test('clear ferma anche la neve', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, alpine());
    field.clear();
    expect(field.snowCount).toBe(0);
  });

  test('lasciando la montagna la neve si dirada e si ferma entro 6 s (I1)', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, alpine());
    expect(field.snowCount).toBe(SNOW_FLAKES);
    // Giunzione alpine -> beach: il tema salta subito (come fa `race.ts`),
    // la transizione dura TRANSITION_SECONDS (spec §4.4d).
    let t = 0;
    while (t < FAR_WINDOW.from) {
      t += 1 / 60;
      field.update(1 / 60, alpine({ theme: 'beach', transition: { from: 'alpine', to: 'beach', t } }));
    }
    // Prima della finestra FAR la neve non e' ancora diradata.
    expect(field.snowCount).toBe(SNOW_FLAKES);
    while (t < TRANSITION_SECONDS) {
      t += 1 / 60;
      field.update(1 / 60, alpine({ theme: 'beach', transition: { from: 'alpine', to: 'beach', t } }));
    }
    // Fine della finestra FAR: il motore vero lascia cadere la transizione.
    field.update(1 / 60, alpine({ theme: 'beach', transition: undefined }));
    expect(field.snowCount).toBe(0);
    const rec = createRecordCtx();
    field.draw(rec.ctx, PALETTES.beach, LOGICAL_W, LOGICAL_H);
    expect(rec.ops.some((op) => op.fill === SNOW_COLOR)).toBe(false);
  });

  test('a meta della finestra FAR la neve e diradata, non spenta di colpo (I1)', () => {
    const field = createParticles(fakeRng());
    field.update(1 / 60, alpine());
    const mid = (FAR_WINDOW.from + FAR_WINDOW.to) / 2;
    field.update(mid, alpine({ theme: 'beach', transition: { from: 'alpine', to: 'beach', t: mid } }));
    expect(field.snowCount).toBeGreaterThan(0);
    expect(field.snowCount).toBeLessThan(SNOW_FLAKES);
  });
});
