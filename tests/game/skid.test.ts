import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import {
  CENTRIFUGAL,
  MAX_SPEED,
  OFF_ROAD_DECEL,
  OFF_ROAD_LIMIT,
  SKID_ANY_SPEED,
  SKID_CENTRIFUGAL,
  SKID_CURVE,
  SKID_DECEL,
  SKID_SLIDE,
  SKID_SPEED,
  STEER_RATE,
  initialPlayer,
  skidsNow,
  stepPlayer,
} from '../../src/game/player';
import type { Actions, PlayerState } from '../../src/types';

const DT = 1 / 60;
const acts = (over: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...over });
const player = (over: Partial<PlayerState> = {}): PlayerState => ({ ...initialPlayer(), ...over });

describe('costanti di spec §5.1', () => {
  test('they are the table of the spec', () => {
    expect(SKID_SPEED).toBe(0.6);
    expect(SKID_CURVE).toBe(1.5);
    // Deroga a spec §9: 0,85 → 0,95 e −MAX_SPEED/6 → −MAX_SPEED/12 (frena
    // troppo in curva, spec §5/§9).
    expect(SKID_ANY_SPEED).toBe(0.95);
    expect(SKID_SLIDE).toBe(0.6);
    expect(SKID_DECEL).toBe(-MAX_SPEED / 12);
    expect(SKID_CENTRIFUGAL).toBe(2);
  });
});

describe('skidsNow (spec §5.1)', () => {
  const base = { surface: 'road' as const, steer: 1, speedPercent: 0.7, curve: 2, crashActive: false };

  test('a hard curve above 60 per cent skids', () => {
    expect(skidsNow(base)).toBe(true);
    expect(skidsNow({ ...base, curve: -2 })).toBe(true);
  });

  test('the curve threshold is 1.5, included', () => {
    expect(skidsNow({ ...base, curve: SKID_CURVE })).toBe(true);
    expect(skidsNow({ ...base, curve: SKID_CURVE - 0.01 })).toBe(false);
  });

  test('above 95 per cent it skids even on a straight', () => {
    expect(skidsNow({ ...base, curve: 0, speedPercent: SKID_ANY_SPEED + 0.01 })).toBe(true);
    expect(skidsNow({ ...base, curve: 0, speedPercent: SKID_ANY_SPEED })).toBe(false);
  });

  test('below 60 per cent it never skids', () => {
    expect(skidsNow({ ...base, speedPercent: SKID_SPEED })).toBe(false);
    expect(skidsNow({ ...base, speedPercent: 0.59, curve: 6 })).toBe(false);
  });

  test('no skid without steering: releasing the wheel ends it at once', () => {
    expect(skidsNow({ ...base, steer: 0 })).toBe(false);
  });

  test('no skid off the asphalt: there it is dust and rumble (spec §5.1)', () => {
    expect(skidsNow({ ...base, surface: 'shoulder' })).toBe(false);
    expect(skidsNow({ ...base, surface: 'grass' })).toBe(false);
  });

  test('no skid during a crash', () => {
    expect(skidsNow({ ...base, crashActive: true })).toBe(false);
  });

  test('no skid at a standstill', () => {
    expect(skidsNow({ ...base, speedPercent: 0 })).toBe(false);
    expect(skidsNow({ ...base, speedPercent: Number.NaN })).toBe(false);
  });
});

describe('stepPlayer in a skid (spec §5.1)', () => {
  const hard = acts({ accelerate: true, right: true });

  test('it reports the skid and shows the wide steer frame', () => {
    const s = stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.7 }), hard, DT, 2, false);
    expect(s.skidding).toBe(true);
    expect(Math.abs(s.steer)).toBe(2);
  });

  test('the car slides further out than the steering alone', () => {
    const start = player({ gear: 'hi', speed: MAX_SPEED * 0.7 });
    const skidding = stepPlayer(start, hard, DT, 2, false);
    const normal = stepPlayer(start, hard, DT, 0, false);
    expect(skidding.skidding).toBe(true);
    expect(normal.skidding).toBe(false);
    const dx = DT * STEER_RATE * 0.7;
    // sterzo + scivolamento in più, meno la centrifuga raddoppiata
    const expected = dx + dx * SKID_SLIDE - dx * 0.7 * 2 * CENTRIFUGAL * SKID_CENTRIFUGAL;
    expect(skidding.x).toBeCloseTo(expected, 9);
    expect(normal.x).toBeCloseTo(dx, 9);
  });

  test('it costs speed: MAX_SPEED / 12 per second on top of everything else', () => {
    const start = player({ gear: 'hi', speed: MAX_SPEED * 0.7 });
    // Stessa curva per entrambi: così l'attrito di curva (spec §5) si
    // semplifica e resta solo il costo della derapata. Confrontare curva 2 con
    // curva 0 misurerebbe le due cose insieme.
    const skidding = stepPlayer(start, hard, DT, 2, false);
    const gripping = stepPlayer(start, acts({ accelerate: true }), DT, 2, false);
    expect(skidding.skidding).toBe(true);
    expect(gripping.skidding).toBe(false);
    expect(skidding.speed - gripping.speed).toBeCloseTo(SKID_DECEL * DT, 6);
  });

  test('releasing the wheel ends the skid in the same tick', () => {
    const start = player({ gear: 'hi', speed: MAX_SPEED * 0.7, skidding: true });
    const s = stepPlayer(start, acts({ accelerate: true }), DT, 2, false);
    expect(s.skidding).toBe(false);
  });

  test('a coarse tick keeps x inside the limits and the speed non negative', () => {
    let s = player({ gear: 'hi', speed: MAX_SPEED * 0.9 });
    for (let i = 0; i < 40; i++) s = stepPlayer(s, hard, 0.25, 6, false);
    expect(Math.abs(s.x)).toBeLessThanOrEqual(3);
    expect(s.speed).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(s.x)).toBe(true);
  });
});

describe('decelerazione per superficie (spec §5)', () => {
  const gas = acts({ accelerate: true });

  test('on the shoulder the penalty is half the off road one, past 1.5 times the limit', () => {
    const fast = player({ gear: 'hi', speed: OFF_ROAD_LIMIT * 2, x: 1.2 });
    const road = player({ gear: 'hi', speed: OFF_ROAD_LIMIT * 2, x: 0 });
    const a = stepPlayer(fast, gas, DT, 0, false);
    const b = stepPlayer(road, gas, DT, 0, false);
    expect(a.surface).toBe('shoulder');
    expect(a.speed - b.speed).toBeCloseTo((OFF_ROAD_DECEL / 2) * DT, 6);
  });

  test('below 1.5 times the limit the shoulder costs nothing', () => {
    const slow = player({ gear: 'hi', speed: OFF_ROAD_LIMIT * 1.4, x: 1.2 });
    const road = player({ gear: 'hi', speed: OFF_ROAD_LIMIT * 1.4, x: 0 });
    expect(stepPlayer(slow, gas, DT, 0, false).speed).toBeCloseTo(
      stepPlayer(road, gas, DT, 0, false).speed,
      6,
    );
  });

  test('on the grass the full penalty applies past the limit', () => {
    const off = player({ gear: 'hi', speed: OFF_ROAD_LIMIT * 1.2, x: 2 });
    const road = player({ gear: 'hi', speed: OFF_ROAD_LIMIT * 1.2, x: 0 });
    const a = stepPlayer(off, gas, DT, 0, false);
    const b = stepPlayer(road, gas, DT, 0, false);
    expect(a.surface).toBe('grass');
    expect(a.speed - b.speed).toBeCloseTo(OFF_ROAD_DECEL * DT, 6);
  });

  test('the grass settles the speed around the off road limit', () => {
    let s = player({ gear: 'hi', speed: MAX_SPEED, x: 2 });
    for (let i = 0; i < 600; i++) s = stepPlayer(s, gas, DT, 0, false);
    expect(s.speed).toBeGreaterThan(OFF_ROAD_LIMIT * 0.9);
    expect(s.speed).toBeLessThan(OFF_ROAD_LIMIT * 1.2);
  });

  test('the shoulder settles higher than the grass: it is the forgiving lane', () => {
    let shoulder = player({ gear: 'hi', speed: MAX_SPEED, x: 1.2 });
    let grass = player({ gear: 'hi', speed: MAX_SPEED, x: 2 });
    for (let i = 0; i < 600; i++) {
      shoulder = stepPlayer(shoulder, gas, DT, 0, false);
      grass = stepPlayer(grass, gas, DT, 0, false);
    }
    expect(shoulder.speed).toBeGreaterThan(grass.speed);
  });
});
