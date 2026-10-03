import { describe, expect, test } from 'vitest';
import {
  CENTRIFUGAL,
  clampGrip,
  GRIP_MIN,
  initialPlayer,
  MAX_SPEED,
  SKID_CURVE,
  SKID_DECEL,
  SKID_SLIDE,
  SKID_SPEED,
  skidsNow,
  stepPlayer,
  STEER_RATE,
  X_LIMIT,
} from '../../src/game/player';
import { SURFACE_GRIP } from '../../src/game/surface';
import { acts } from '../helpers/race-script';
import type { PlayerState } from '../../src/types';

const DT = 1 / 60;
/** Giocatore in corsa, al centro, marcia alta. */
const fast = (over: Partial<PlayerState> = {}): PlayerState => ({
  ...initialPlayer(),
  speed: MAX_SPEED * 0.8,
  gear: 'hi',
  ...over,
});

describe('clampGrip: un divisore sicuro (Review Focus 2)', () => {
  test('one is the identity and the default', () => {
    expect(clampGrip(1)).toBe(1);
    expect(clampGrip(undefined)).toBe(1);
  });

  test('the four declared grips pass through untouched', () => {
    for (const g of Object.values(SURFACE_GRIP)) expect(clampGrip(g)).toBe(g);
  });

  test('zero, negative, NaN and above one are all brought back inside', () => {
    // Senza questa guardia `CENTRIFUGAL / grip` con grip zero darebbe
    // Infinity, `x` diventerebbe NaN, e `clamp(NaN, -3, 3)` ritorna NaN:
    // il giocatore spariva dal tracciato per sempre.
    expect(clampGrip(0)).toBe(GRIP_MIN);
    expect(clampGrip(-2)).toBe(GRIP_MIN);
    expect(clampGrip(Number.NaN)).toBe(1);
    expect(clampGrip(1.5)).toBe(1);
    expect(GRIP_MIN).toBeLessThan(SURFACE_GRIP.snow);
  });
});

describe('soglie di derapata scalate dall aderenza (spec §5.1)', () => {
  test('with full grip the thresholds are the ones of the table', () => {
    const base = { surface: 'road' as const, steer: 1, curve: 0, crashActive: false };
    expect(skidsNow({ ...base, speedPercent: SKID_SPEED + 0.01, curve: SKID_CURVE })).toBe(true);
    expect(skidsNow({ ...base, speedPercent: SKID_SPEED - 0.01, curve: SKID_CURVE })).toBe(false);
    expect(skidsNow({ ...base, speedPercent: 0.9, curve: SKID_CURVE - 0.01 })).toBe(false);
  });

  test('less grip makes the car skid earlier, in speed and in curvature', () => {
    const g = SURFACE_GRIP.snow;
    const base = { surface: 'road' as const, steer: 1, crashActive: false, grip: g };
    // Una velocità che sull asfalto non basta, sulla neve basta.
    const slow = SKID_SPEED * g + 0.01;
    expect(slow).toBeLessThan(SKID_SPEED);
    expect(skidsNow({ ...base, speedPercent: slow, curve: SKID_CURVE * g })).toBe(true);
    expect(skidsNow({ ...base, speedPercent: slow, curve: SKID_CURVE * g, grip: 1 })).toBe(false);
    // Una curva che sull asfalto non basta, sulla neve basta.
    const gentle = SKID_CURVE * g + 0.01;
    expect(gentle).toBeLessThan(SKID_CURVE);
    expect(skidsNow({ ...base, speedPercent: 0.7, curve: gentle })).toBe(true);
    expect(skidsNow({ ...base, speedPercent: 0.7, curve: gentle, grip: 1 })).toBe(false);
  });

  test('an absent grip is full grip: every existing caller keeps its behaviour', () => {
    const base = { surface: 'road' as const, steer: 1, curve: SKID_CURVE, crashActive: false };
    expect(skidsNow({ ...base, speedPercent: 0.7 })).toBe(skidsNow({ ...base, speedPercent: 0.7, grip: 1 }));
  });

  test('skidAnySpeed does not scale: the snow stage stays playable (deroga 5)', () => {
    // Con 0.95 · 0.7 = 0.665 ogni sterzata in rettilineo sopra il 67%
    // sarebbe una derapata: la tappa di neve diventerebbe ingiocabile.
    const base = { surface: 'road' as const, steer: 1, curve: 0, crashActive: false };
    expect(skidsNow({ ...base, speedPercent: 0.7, grip: SURFACE_GRIP.snow })).toBe(false);
    expect(skidsNow({ ...base, speedPercent: 0.96, grip: SURFACE_GRIP.snow })).toBe(true);
  });

  test('off the asphalt there is no skid, whatever the grip', () => {
    for (const surface of ['shoulder', 'grass'] as const) {
      expect(
        skidsNow({ surface, steer: 1, speedPercent: 0.99, curve: 6, crashActive: false, grip: SURFACE_GRIP.snow }),
      ).toBe(false);
    }
  });
});

describe('gli effetti dell aderenza in `stepPlayer` (spec §5)', () => {
  test('less grip pushes the car further out of a curve', () => {
    const state = fast();
    const straight = acts({ accelerate: true });
    const dry = stepPlayer(state, straight, DT, 4, false, 1, 0, false, 1);
    const snow = stepPlayer(state, straight, DT, 4, false, 1, 0, false, SURFACE_GRIP.snow);
    // curve > 0: la strada gira a destra, la centrifuga spinge x al negativo.
    expect(snow.x).toBeLessThan(dry.x);
    const dxDry = state.x - dry.x;
    const dxSnow = state.x - snow.x;
    expect(dxSnow / dxDry).toBeCloseTo(1 / SURFACE_GRIP.snow, 6);
  });

  test('less grip makes the slide in a skid wider', () => {
    // Derapata garantita: curva stretta e velocità alta.
    const state = fast({ speed: MAX_SPEED * 0.9, steer: 1 });
    const right = acts({ accelerate: true, right: true });
    const dry = stepPlayer(state, right, DT, 6, false, 1, 0, false, 1);
    const snow = stepPlayer(state, right, DT, 6, false, 1, 0, false, SURFACE_GRIP.snow);
    expect(dry.skidding).toBe(true);
    expect(snow.skidding).toBe(true);
    // Lo scivolamento è `dx * SKID_SLIDE / grip`, e va nel verso dello sterzo.
    const dx = DT * STEER_RATE * 0.9;
    const slideDry = dx * SKID_SLIDE;
    const slideSnow = dx * (SKID_SLIDE / SURFACE_GRIP.snow);
    expect(snow.x - dry.x).toBeCloseTo(slideSnow - slideDry - dx * 0.9 * 6 * CENTRIFUGAL * 2 * (1 / SURFACE_GRIP.snow - 1), 4);
  });

  test('less grip makes the skid slow the car down less: it slides longer', () => {
    const state = fast({ speed: MAX_SPEED * 0.9, steer: 1 });
    const right = acts({ accelerate: true, right: true });
    const dry = stepPlayer(state, right, DT, 6, false, 1, 0, false, 1);
    const snow = stepPlayer(state, right, DT, 6, false, 1, 0, false, SURFACE_GRIP.snow);
    expect(dry.skidding && snow.skidding).toBe(true);
    // `SKID_DECEL` è negativo: moltiplicarlo per un'aderenza minore di 1
    // lo avvicina a zero, quindi si perde meno velocità.
    expect(snow.speed).toBeGreaterThan(dry.speed);
    expect(snow.speed - dry.speed).toBeCloseTo(-SKID_DECEL * (1 - SURFACE_GRIP.snow) * DT, 4);
  });

  test('full grip reproduces the physics of before, bit for bit', () => {
    const state = fast({ steer: -1 });
    const left = acts({ accelerate: true, left: true, brake: false });
    // Otto argomenti (come ogni chiamante esistente) e nove con grip 1.
    const before = stepPlayer(state, left, DT, 3, false, 1, 0, false);
    const after = stepPlayer(state, left, DT, 3, false, 1, 0, false, 1);
    expect(after).toEqual(before);
  });

  test('a coarse tick with low grip keeps x inside the limit (Review Focus 2)', () => {
    // `core/loop` limita l'accumulato a 0,25 s: un tick può valerli tutti.
    let state = fast({ speed: MAX_SPEED });
    for (let i = 0; i < 40; i++) {
      state = stepPlayer(state, acts({ accelerate: true, right: true }), 0.25, 6, false, 1, 0, false, GRIP_MIN);
      expect(Number.isFinite(state.x)).toBe(true);
      expect(Math.abs(state.x)).toBeLessThanOrEqual(X_LIMIT);
      expect(Number.isFinite(state.speed)).toBe(true);
      expect(state.speed).toBeGreaterThanOrEqual(0);
    }
  });

  test('a grip of zero does not turn the player into a NaN (Review Focus 2)', () => {
    const state = fast();
    const out = stepPlayer(state, acts({ accelerate: true, right: true }), DT, 6, false, 1, 0, false, 0);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Math.abs(out.x)).toBeLessThanOrEqual(X_LIMIT);
    expect(Number.isFinite(out.speed)).toBe(true);
  });

  test('a crash ignores the grip, like it ignores everything else', () => {
    const state = fast({ x: 0.4 });
    const dry = stepPlayer(state, acts({ accelerate: true, right: true }), DT, 6, true, 1, 0, false, 1);
    const snow = stepPlayer(state, acts({ accelerate: true, right: true }), DT, 6, true, 1, 0, false, SURFACE_GRIP.snow);
    expect(snow).toEqual(dry);
  });

  test('the grip does not touch the off road penalty', () => {
    // Fuori strada (`|x| > 1 + SHOULDER_W`) la decelerazione è quella di
    // sempre: l'erba non è una superficie di guida, è una penalità, e
    // sommarle sarebbe una doppia punizione (spec §5).
    const state = fast({ x: 2, speed: MAX_SPEED * 0.9 });
    const dry = stepPlayer(state, acts({ accelerate: true }), DT, 0, false, 1, 0, false, 1);
    const snow = stepPlayer(state, acts({ accelerate: true }), DT, 0, false, 1, 0, false, SURFACE_GRIP.snow);
    expect(snow.speed).toBe(dry.speed);
    expect(snow.surface).toBe('grass');
  });
});
