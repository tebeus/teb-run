import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import {
  ACCEL_FALLOFF,
  ACCEL_HI,
  ACCEL_LO,
  BRAKING,
  CENTRIFUGAL,
  CURVE_DRAG,
  DECEL,
  HI_BOG_PERCENT,
  STEER_HOLD_FOR_STRONG,
  accelFor,
  curveDrag,
  initialPlayer,
  kmh,
  KMH_AT_MAX,
  MAX_SPEED,
  MAX_SPEED_LO,
  MIN_STEER_SPEED_PERCENT,
  OFF_ROAD_DECEL,
  OFF_ROAD_LIMIT,
  SHOULDER_W,
  STEER_RATE,
  stepPlayer,
  surfaceOf,
  X_LIMIT,
} from '../../src/game/player';
import type { Actions, PlayerState, Surface } from '../../src/types';

const DT = 1 / 60;
const acts = (over: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...over });
const player = (over: Partial<PlayerState> = {}): PlayerState => ({ ...initialPlayer(), ...over });

/** Ripete n passi con gli stessi ingressi. */
const run = (state: PlayerState, actions: Actions, n: number, curve = 0, crash = false): PlayerState => {
  let s = state;
  for (let i = 0; i < n; i++) s = stepPlayer(s, actions, DT, curve, crash);
  return s;
};

describe('constants (spec 5)', () => {
  test('match the spec table exactly', () => {
    expect(MAX_SPEED).toBe(12000);
    expect(ACCEL_HI).toBe(MAX_SPEED / 5);
    expect(ACCEL_LO).toBe(MAX_SPEED / 3);
    expect(MAX_SPEED_LO).toBe(MAX_SPEED * 0.55);
    expect(BRAKING).toBe(-MAX_SPEED);
    expect(DECEL).toBe(-MAX_SPEED / 5);
    expect(OFF_ROAD_DECEL).toBe(-MAX_SPEED / 2);
    expect(OFF_ROAD_LIMIT).toBe(MAX_SPEED / 4);
    expect(CENTRIFUGAL).toBe(0.42);
    expect(STEER_RATE).toBe(2);
    expect(X_LIMIT).toBe(3);
  });

  test('kmh shows 293 at full speed', () => {
    expect(kmh(MAX_SPEED)).toBe(KMH_AT_MAX);
    expect(kmh(0)).toBe(0);
    expect(kmh(MAX_SPEED / 2)).toBeCloseTo(146.5, 6);
  });

  test('the player starts still, centred and in low gear', () => {
    expect(initialPlayer()).toEqual({
      x: 0,
      z: 0,
      speed: 0,
      gear: 'lo',
      steer: 0,
      offRoad: false,
      braking: false,
      accelerating: false,
      surface: 'road',
      skidding: false,
      steerHeld: 0,
    });
  });
});

describe('speed', () => {
  test('accelerating in high gear reaches max speed and stops there', () => {
    // Da fermo in alta si paga la penalità sotto il 30% e il calo di spinta
    // (spec §5): 10,9 s, quindi 600 tick non bastano più.
    expect(run(player({ gear: 'hi' }), acts({ accelerate: true }), 1200).speed).toBe(MAX_SPEED);
  });

  test('accelerating in low gear is capped at the low gear limit', () => {
    expect(run(player({ gear: 'lo' }), acts({ accelerate: true }), 600).speed).toBe(MAX_SPEED_LO);
  });

  test('low gear accelerates harder than high gear at the same speed', () => {
    const start = MAX_SPEED * 0.4;
    const lo = stepPlayer(player({ gear: 'lo', speed: start }), acts({ accelerate: true }), DT, 0, false);
    const hi = stepPlayer(player({ gear: 'hi', speed: start }), acts({ accelerate: true }), DT, 0, false);
    expect(lo.speed - start).toBeCloseTo(ACCEL_LO * (1 - ACCEL_FALLOFF * 0.4) * DT, 9);
    expect(hi.speed - start).toBeCloseTo(ACCEL_HI * (1 - ACCEL_FALLOFF * 0.4) * DT, 9);
  });

  test('high gear below 30 percent accelerates at half power', () => {
    const start = MAX_SPEED * (HI_BOG_PERCENT - 0.1);
    const s = stepPlayer(player({ gear: 'hi', speed: start }), acts({ accelerate: true }), DT, 0, false);
    expect(s.speed - start).toBeCloseTo(ACCEL_HI * 0.5 * (1 - ACCEL_FALLOFF * 0.2) * DT, 9);
  });

  test('coasting slows down and never goes below zero', () => {
    const start = MAX_SPEED * 0.5;
    const one = stepPlayer(player({ gear: 'hi', speed: start }), acts(), DT, 0, false);
    expect(one.speed - start).toBeCloseTo(DECEL * DT, 9);
    expect(run(player({ gear: 'hi', speed: start }), acts(), 600).speed).toBe(0);
  });

  test('braking from a standstill stays at zero', () => {
    expect(run(player({ gear: 'hi', speed: 0 }), acts({ brake: true }), 30).speed).toBe(0);
  });

  test('braking is stronger than coasting', () => {
    const start = MAX_SPEED * 0.8;
    const braked = stepPlayer(player({ gear: 'hi', speed: start }), acts({ brake: true }), DT, 0, false);
    expect(braked.speed - start).toBeCloseTo(BRAKING * DT, 9);
    expect(braked.braking).toBe(true);
  });

  test('accelerating tracks whether the throttle is held (spec §4.4b, burnout smoke)', () => {
    expect(stepPlayer(player(), acts({ accelerate: true }), DT, 0, false).accelerating).toBe(true);
    expect(stepPlayer(player(), acts(), DT, 0, false).accelerating).toBe(false);
    expect(stepPlayer(player(), acts({ brake: true }), DT, 0, false).accelerating).toBe(false);
  });

  test('dropping to low gear above the low limit clamps the speed', () => {
    const s = stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.9 }), acts({ gearToggle: true }), DT, 0, false);
    expect(s.gear).toBe('lo');
    expect(s.speed).toBe(MAX_SPEED_LO);
  });
});

describe('gear', () => {
  test('gearToggle flips the gear and toggling twice returns', () => {
    const up = stepPlayer(player(), acts({ gearToggle: true }), DT, 0, false);
    expect(up.gear).toBe('hi');
    expect(stepPlayer(up, acts({ gearToggle: true }), DT, 0, false).gear).toBe('lo');
  });

  test('without gearToggle the gear is kept', () => {
    expect(stepPlayer(player({ gear: 'hi' }), acts(), DT, 0, false).gear).toBe('hi');
  });
});

describe('steering', () => {
  test('there is still a minimum steering while standing still (addendum E, fork-bug-report-2)', () => {
    // Prima non si sterzava affatto da fermi: chi restava incastrato contro
    // una barriera centrale a velocità zero non aveva alcun modo di
    // allontanarsi lateralmente e ripartire. `MIN_STEER_SPEED_PERCENT`
    // garantisce un minimo di sterzo anche da fermi o quasi.
    const expected = DT * STEER_RATE * MIN_STEER_SPEED_PERCENT;
    expect(stepPlayer(player({ speed: 0 }), acts({ left: true }), DT, 0, false).x).toBeCloseTo(-expected, 9);
    expect(stepPlayer(player({ speed: 0 }), acts({ right: true }), DT, 0, false).x).toBeCloseTo(expected, 9);
  });

  test('below the floor, speedPercent does not reduce the steering further', () => {
    const slow = MAX_SPEED * (MIN_STEER_SPEED_PERCENT * 0.5);
    const expected = DT * STEER_RATE * MIN_STEER_SPEED_PERCENT;
    expect(stepPlayer(player({ speed: slow }), acts({ right: true }), DT, 0, false).x).toBeCloseTo(expected, 9);
  });

  test('above the floor, steering follows the real speedPercent as before', () => {
    const speed = MAX_SPEED * 0.5;
    const expected = DT * STEER_RATE * 0.5;
    expect(stepPlayer(player({ speed }), acts({ right: true }), DT, 0, false).x).toBeCloseTo(expected, 9);
  });

  test('left moves x down, right moves x up, by dt * steerRate * speedPercent', () => {
    const speed = MAX_SPEED * 0.5;
    const expected = DT * STEER_RATE * 0.5;
    expect(stepPlayer(player({ gear: 'hi', speed }), acts({ left: true }), DT, 0, false).x).toBeCloseTo(-expected, 9);
    expect(stepPlayer(player({ gear: 'hi', speed }), acts({ right: true }), DT, 0, false).x).toBeCloseTo(expected, 9);
  });

  test('left and right together cancel out', () => {
    const s = stepPlayer(
      player({ gear: 'hi', speed: MAX_SPEED * 0.5 }),
      acts({ left: true, right: true }),
      DT,
      0,
      false,
    );
    expect(s.x).toBe(0);
    expect(s.steer).toBe(0);
  });

  test('steer frame is 1 at low speed even after a long hold', () => {
    const s = run(player({ gear: 'hi', speed: MAX_SPEED * 0.2 }), acts({ left: true }), 60, 0);
    expect(s.steer).toBe(-1);
  });

  test('a fresh steer at high speed starts light: the hold has not built up yet', () => {
    expect(stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.8 }), acts({ right: true }), DT, 0, false).steer).toBe(1);
  });

  test('steer frame is 2 when counter steering a curve at low speed', () => {
    expect(stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.2 }), acts({ left: true }), DT, 4, false).steer).toBe(-2);
  });

  test('steer frame is 1 when steering into the curve at low speed', () => {
    expect(stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.2 }), acts({ right: true }), DT, 4, false).steer).toBe(1);
  });

  test('steer frame is 0 without input', () => {
    expect(stepPlayer(player({ gear: 'hi', speed: MAX_SPEED }), acts(), DT, 4, false).steer).toBe(0);
  });
});

describe('steerHeld and the three steering states (spec §5)', () => {
  test('STEER_HOLD_FOR_STRONG is the table value', () => {
    expect(STEER_HOLD_FOR_STRONG).toBe(0.35);
  });

  test('holding the wheel accumulates seconds in the same direction', () => {
    const s1 = stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.8 }), acts({ right: true }), DT, 0, false);
    expect(s1.steerHeld).toBe(0);
    const s2 = stepPlayer(s1, acts({ right: true }), DT, 0, false);
    expect(s2.steerHeld).toBeCloseTo(DT, 9);
    const s3 = stepPlayer(s2, acts({ right: true }), DT, 0, false);
    expect(s3.steerHeld).toBeCloseTo(2 * DT, 9);
  });

  test('releasing the wheel resets steerHeld at once', () => {
    let s = stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.8 }), acts({ right: true }), DT, 0, false);
    for (let i = 0; i < 30; i++) s = stepPlayer(s, acts({ right: true }), DT, 0, false);
    expect(s.steerHeld).toBeGreaterThan(0);
    const released = stepPlayer(s, acts(), DT, 0, false);
    expect(released.steerHeld).toBe(0);
  });

  test('reversing direction resets steerHeld at once, on the reversal tick', () => {
    let s = stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.8 }), acts({ right: true }), DT, 0, false);
    for (let i = 0; i < 30; i++) s = stepPlayer(s, acts({ right: true }), DT, 0, false);
    const reversed = stepPlayer(s, acts({ left: true }), DT, 0, false);
    expect(reversed.steerHeld).toBe(0);
  });

  test('below the hold threshold, at speed and in a straight, the frame stays light', () => {
    let s = player({ gear: 'hi', speed: MAX_SPEED * 0.8 });
    const ticksUnderThreshold = Math.floor(STEER_HOLD_FOR_STRONG / DT) - 2;
    for (let i = 0; i < ticksUnderThreshold; i++) s = stepPlayer(s, acts({ right: true }), DT, 0, false);
    expect(s.steerHeld).toBeLessThan(STEER_HOLD_FOR_STRONG);
    expect(s.steer).toBe(1);
  });

  test('past the hold threshold, above half speed, the frame turns wide', () => {
    let s = player({ gear: 'hi', speed: MAX_SPEED * 0.8 });
    const ticksPastThreshold = Math.ceil(STEER_HOLD_FOR_STRONG / DT) + 2;
    for (let i = 0; i < ticksPastThreshold; i++) s = stepPlayer(s, acts({ right: true }), DT, 0, false);
    expect(s.steerHeld).toBeGreaterThanOrEqual(STEER_HOLD_FOR_STRONG);
    expect(s.steer).toBe(2);
  });

  test('a long hold below half speed never turns wide by itself', () => {
    let s = player({ gear: 'hi', speed: MAX_SPEED * 0.4 });
    for (let i = 0; i < 90; i++) s = stepPlayer(s, acts({ right: true }), DT, 0, false);
    expect(s.steerHeld).toBeGreaterThan(STEER_HOLD_FOR_STRONG);
    expect(s.steer).toBe(1);
  });

  test('counter steering and skidding still promote instantly, hold or not', () => {
    // Controsterzo: promuove al primo tick, senza aver mai accumulato hold.
    expect(stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.2 }), acts({ left: true }), DT, 4, false).steerHeld).toBe(0);
    expect(stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.2 }), acts({ left: true }), DT, 4, false).steer).toBe(-2);
  });
});

describe('centrifugal force (spec 5)', () => {
  test('a right curve pushes the car left, a left curve pushes it right', () => {
    const speed = MAX_SPEED * 0.6;
    const right = stepPlayer(player({ gear: 'hi', speed }), acts(), DT, 4, false);
    const left = stepPlayer(player({ gear: 'hi', speed }), acts(), DT, -4, false);
    expect(right.x).toBeLessThan(0);
    expect(left.x).toBeGreaterThan(0);
    expect(right.x).toBeCloseTo(-DT * STEER_RATE * 0.6 * 0.6 * 4 * CENTRIFUGAL, 9);
  });

  test('it scales with speed and is zero when still', () => {
    const slow = stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.2 }), acts(), DT, 4, false);
    const fast = stepPlayer(player({ gear: 'hi', speed: MAX_SPEED * 0.9 }), acts(), DT, 4, false);
    expect(Math.abs(fast.x)).toBeGreaterThan(Math.abs(slow.x));
    expect(stepPlayer(player({ speed: 0 }), acts(), DT, 6, false).x).toBe(0);
  });
});

describe('off road (spec 5)', () => {
  test('off road above the limit loses extra speed', () => {
    const start = MAX_SPEED * 0.8;
    const on = stepPlayer(player({ gear: 'hi', speed: start, x: 0.5 }), acts({ accelerate: true }), DT, 0, false);
    const off = stepPlayer(player({ gear: 'hi', speed: start, x: 2 }), acts({ accelerate: true }), DT, 0, false);
    expect(off.speed - on.speed).toBeCloseTo(OFF_ROAD_DECEL * DT, 9);
    expect(off.offRoad).toBe(true);
    expect(on.offRoad).toBe(false);
  });

  test('off road below the limit loses nothing extra', () => {
    const start = OFF_ROAD_LIMIT * 0.9;
    const off = stepPlayer(player({ gear: 'hi', speed: start, x: 2 }), acts({ accelerate: true }), DT, 0, false);
    const on = stepPlayer(player({ gear: 'hi', speed: start, x: 0 }), acts({ accelerate: true }), DT, 0, false);
    expect(off.speed).toBeCloseTo(on.speed, 9);
  });

  test('off road settles near the off road limit while accelerating', () => {
    const s = run(player({ gear: 'hi', speed: MAX_SPEED, x: 2 }), acts({ accelerate: true }), 600);
    expect(s.speed).toBeGreaterThan(OFF_ROAD_LIMIT * 0.9);
    expect(s.speed).toBeLessThan(OFF_ROAD_LIMIT * 1.2);
  });
});

describe('limits and extreme input (Review Focus 5)', () => {
  test('steering right for ten seconds stops at x = 3', () => {
    const s = run(player({ gear: 'hi', speed: MAX_SPEED }), acts({ right: true, accelerate: true }), 600);
    expect(s.x).toBe(X_LIMIT);
    expect(s.offRoad).toBe(true);
  });

  test('steering left for ten seconds stops at x = -3', () => {
    expect(run(player({ gear: 'hi', speed: MAX_SPEED }), acts({ left: true, accelerate: true }), 600).x).toBe(-X_LIMIT);
  });

  test('a hard curve at full speed never pushes x past the limit', () => {
    const s = run(player({ gear: 'hi', speed: MAX_SPEED }), acts({ accelerate: true }), 1200, 6);
    expect(s.x).toBeGreaterThanOrEqual(-X_LIMIT);
    expect(s.x).toBeLessThanOrEqual(X_LIMIT);
  });

  test('toggling the gear every tick keeps the state valid', () => {
    const s = run(player(), acts({ gearToggle: true, accelerate: true }), 600);
    expect(['lo', 'hi']).toContain(s.gear);
    expect(s.speed).toBeGreaterThanOrEqual(0);
    expect(s.speed).toBeLessThanOrEqual(MAX_SPEED);
  });

  test('speed, x and z stay finite under 3000 ticks of extreme input', () => {
    const s = run(player({ gear: 'hi' }), acts({ accelerate: true, right: true }), 3000, -6);
    expect(Number.isFinite(s.speed)).toBe(true);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Number.isFinite(s.z)).toBe(true);
  });
});

describe('position and immutability', () => {
  test('z advances by speed times dt', () => {
    const s = stepPlayer(player({ gear: 'hi', speed: 6000, z: 100 }), acts(), DT, 0, false);
    expect(s.z).toBeCloseTo(100 + s.speed * DT, 9);
  });

  test('z is not wrapped here: the race engine owns the track length', () => {
    const s = run(player({ gear: 'hi', speed: MAX_SPEED }), acts({ accelerate: true }), 60);
    expect(s.z).toBeGreaterThan(MAX_SPEED * 0.9);
  });

  test('the input state is never mutated', () => {
    const start = player({ gear: 'hi', speed: 5000, x: 0.5 });
    const copy = { ...start };
    stepPlayer(start, acts({ left: true, accelerate: true }), DT, 3, false);
    expect(start).toEqual(copy);
  });
});

describe('during a crash the input is ignored (spec 7)', () => {
  test('speed, x and gear are left alone, z still advances', () => {
    const start = player({ gear: 'hi', speed: 5000, x: 0.8, steer: 2 });
    const s = stepPlayer(
      start,
      acts({ accelerate: true, left: true, gearToggle: true, brake: true }),
      DT,
      4,
      true,
    );
    expect(s.speed).toBe(5000);
    expect(s.x).toBe(0.8);
    expect(s.steer).toBe(0);
    expect(s.gear).toBe('hi');
    expect(s.braking).toBe(false);
    expect(s.accelerating).toBe(false);
    expect(s.steerHeld).toBe(0);
    expect(s.z).toBeCloseTo(5000 * DT, 9);
  });
});

describe('surfaceOf (spec §5, voce Superficie)', () => {
  test('the shoulder is 0.35 half-widths wide', () => {
    expect(SHOULDER_W).toBe(0.35);
  });

  test('the asphalt reaches the road edge, included', () => {
    expect(surfaceOf(0)).toBe('road');
    expect(surfaceOf(1)).toBe('road');
    expect(surfaceOf(-1)).toBe('road');
    expect(surfaceOf(0.99)).toBe('road');
  });

  test('past the edge and up to 1.35 it is the shoulder, either side', () => {
    expect(surfaceOf(1.01)).toBe('shoulder');
    expect(surfaceOf(1.35)).toBe('shoulder');
    expect(surfaceOf(-1.2)).toBe('shoulder');
  });

  test('past the shoulder it is grass', () => {
    expect(surfaceOf(1.36)).toBe('grass');
    expect(surfaceOf(3)).toBe('grass');
    expect(surfaceOf(-2.5)).toBe('grass');
  });

  test('a non finite x counts as grass, never as road', () => {
    const outside: Surface = 'grass';
    expect(surfaceOf(Number.NaN)).toBe(outside);
    expect(surfaceOf(Number.POSITIVE_INFINITY)).toBe(outside);
  });

  test('a split segment has asphalt between the island and the outer edge', () => {
    // Fine della zona di bivio: roadHalf 2.8, isola 0.8.
    expect(surfaceOf(0, 2.8, 0.8)).toBe('grass');
    expect(surfaceOf(0.5, 2.8, 0.8)).toBe('grass');
    expect(surfaceOf(0.8, 2.8, 0.8)).toBe('road');
    expect(surfaceOf(1.8, 2.8, 0.8)).toBe('road');
    expect(surfaceOf(2.8, 2.8, 0.8)).toBe('road');
    expect(surfaceOf(3, 2.8, 0.8)).toBe('shoulder');
    expect(surfaceOf(-1.8, 2.8, 0.8)).toBe('road');
  });

  test('a widened segment without an island is all asphalt', () => {
    expect(surfaceOf(0, 1.9, 0)).toBe('road');
    expect(surfaceOf(1.9, 1.9, 0)).toBe('road');
    expect(surfaceOf(2.2, 1.9, 0)).toBe('shoulder');
  });

  test('without the two arguments it behaves exactly as before', () => {
    expect(surfaceOf(0)).toBe('road');
    expect(surfaceOf(1.2)).toBe('shoulder');
    expect(surfaceOf(2)).toBe('grass');
  });
});

describe('stepPlayer reports the surface it is on', () => {
  test('a fresh player starts on the road, not skidding', () => {
    expect(initialPlayer().surface).toBe('road');
    expect(initialPlayer().skidding).toBe(false);
  });

  test('the surface follows x after the step', () => {
    const s = stepPlayer(player({ x: 1.2, speed: 100 }), acts({}), DT, 0, false);
    expect(s.surface).toBe('shoulder');
    expect(s.offRoad).toBe(true);
  });

  test('during a crash the surface is still reported and skidding is off', () => {
    const s = stepPlayer(player({ x: 2, speed: 5000 }), acts({ left: true }), DT, 0, true);
    expect(s.surface).toBe('grass');
    expect(s.skidding).toBe(false);
  });
});

describe('accelFor (spec §5: la spinta cala con la velocità)', () => {
  test('the falloff is the value of the spec table', () => {
    expect(ACCEL_FALLOFF).toBe(0.75);
  });

  test('from a standstill the push is full, near the top it is a quarter', () => {
    expect(accelFor('lo', 0)).toBeCloseTo(ACCEL_LO, 9);
    expect(accelFor('hi', 1)).toBeCloseTo(ACCEL_HI * 0.25, 9);
  });

  test('it falls off linearly in between', () => {
    expect(accelFor('hi', 0.4)).toBeCloseTo(ACCEL_HI * 0.7, 9);
    expect(accelFor('lo', 0.4)).toBeCloseTo(ACCEL_LO * 0.7, 9);
  });

  test('the high gear penalty below 30 per cent multiplies with the falloff', () => {
    expect(accelFor('hi', 0.2)).toBeCloseTo(ACCEL_HI * 0.5 * 0.85, 9);
  });

  test('it never turns negative and clamps a speed outside 0..1', () => {
    expect(accelFor('hi', 3)).toBeCloseTo(ACCEL_HI * 0.25, 9);
    expect(accelFor('hi', -2)).toBeCloseTo(ACCEL_HI * 0.5, 9);
    expect(accelFor('hi', Number.NaN)).toBeGreaterThan(0);
  });

  test('zero to full speed takes about eight seconds, shifting at 55 per cent (spec §5)', () => {
    // Il calcolo della spec: 2,13 s in bassa fino a 0,55, poi 5,70 s in alta.
    let state = player({ gear: 'lo' });
    let ticks = 0;
    while (state.speed < MAX_SPEED && ticks < 60 * 20) {
      const shift = state.gear === 'lo' && state.speed >= MAX_SPEED_LO;
      state = stepPlayer(state, acts({ accelerate: true, gearToggle: shift }), DT, 0, false);
      ticks++;
    }
    expect(state.speed).toBe(MAX_SPEED);
    expect(ticks / 60).toBeGreaterThan(7);
    expect(ticks / 60).toBeLessThan(9);
  });
});

describe('curveDrag (spec §5: si perde velocità in curva)', () => {
  test('the coefficient is the value of the spec table', () => {
    // Deroga a spec §9: 0,03 → 0,012 (frena troppo in curva, spec §5/§9).
    expect(CURVE_DRAG).toBe(0.012);
  });

  test('it grows with the curve and with the square of the speed', () => {
    expect(curveDrag(3, 0.8, 'road')).toBeCloseTo(MAX_SPEED * 0.012 * 3 * 0.64, 6);
    expect(curveDrag(6, 0.8, 'road')).toBeCloseTo(2 * curveDrag(3, 0.8, 'road'), 6);
    expect(curveDrag(3, 0.4, 'road')).toBeCloseTo(curveDrag(3, 0.8, 'road') / 4, 6);
  });

  test('the direction of the curve does not matter', () => {
    expect(curveDrag(-4, 0.5, 'road')).toBeCloseTo(curveDrag(4, 0.5, 'road'), 9);
  });

  test('there is no drag on a straight, at a standstill, or off the asphalt', () => {
    expect(curveDrag(0, 1, 'road')).toBe(0);
    expect(curveDrag(6, 0, 'road')).toBe(0);
    expect(curveDrag(6, 1, 'shoulder')).toBe(0);
    expect(curveDrag(6, 1, 'grass')).toBe(0);
  });

  /**
   * Velocità a cui il gas e la perdita in curva si fanno pari. Isola la
   * dinamica longitudinale riportando `x` a 0 a ogni tick: senza sterzo la
   * centrifuga (invariata dai task 1-6, fuori scope qui) spinge l'auto
   * sull'erba in circa un secondo, e da lì la penalità fuori strada
   * coprirebbe la misura dell'attrito di curva sull'asfalto, che è quello
   * che questo test vuole isolare.
   */
  const settle = (curve: number): number => {
    let state = player({ gear: 'hi', speed: MAX_SPEED });
    for (let i = 0; i < 60 * 30; i++) {
      state = { ...stepPlayer(state, acts({ accelerate: true }), DT, curve, false), x: 0 };
    }
    return state.speed / MAX_SPEED;
  };

  test('full throttle in a curve settles where the formula says (spec §5/§9)', () => {
    // Deroga: 144·|curve|·p² + 1800p - 2400 = 0 (accelHi·(1 − 0,75p) =
    // maxSpeed·0,012·|curve|·p²): p = 0,963 a curva 5, 0,924 a 6, 0,860 a 8.
    // Sotto curva ≈4,17 la radice supera 1: la spinta residua a piena
    // velocità (600 al secondo) batte sempre la perdita, e l'auto non frena
    // più affatto in curva (vedi il test sotto).
    const easy = settle(5);
    expect(easy).toBeGreaterThan(0.94);
    expect(easy).toBeLessThan(0.98);
    const tight = settle(6);
    expect(tight).toBeGreaterThan(0.9);
    expect(tight).toBeLessThan(0.94);
    const tighter = settle(8);
    expect(tighter).toBeGreaterThan(0.83);
    expect(tighter).toBeLessThan(0.89);
  });

  test('the tighter the curve, the slower the equilibrium', () => {
    expect(settle(10)).toBeLessThan(settle(8));
    expect(settle(8)).toBeLessThan(settle(6));
    expect(settle(6)).toBeLessThan(settle(5));
  });

  test('a gentle to medium curve does not slow the car down at all (spec §9, deroga)', () => {
    // La perdita in curva è cambiata da 0,03 a 0,012 (spec §5/§9): fino a
    // curva ≈4,17 la spinta residua a piena velocità (600 al secondo) batte
    // sempre la perdita (144·|curve|, cioè 216 a 1,5 e 576 a 4), quindi
    // l'auto non frena più in curve morbide o medie, solo in quelle strette.
    expect(settle(1.5)).toBe(1);
    expect(settle(2)).toBe(1);
    expect(settle(3)).toBe(1);
    expect(settle(4)).toBe(1);
  });

  test('a straight at full throttle stays at full speed', () => {
    let state = player({ gear: 'hi', speed: MAX_SPEED });
    for (let i = 0; i < 120; i++) state = stepPlayer(state, acts({ accelerate: true }), DT, 0, false);
    expect(state.speed).toBe(MAX_SPEED);
  });
});

describe('stepPlayer sull isola centrale del bivio (spec §4.4, task 15)', () => {
  test('al centro di una strada divisa si e sul terreno e si perde velocita', () => {
    const start: PlayerState = { ...initialPlayer(), x: 0, speed: MAX_SPEED, gear: 'hi' };
    // roadHalf 2.8 e median 0.8: le due carreggiate sono complete, al centro
    // c'e l'isola. `x = 0` cade dentro l'isola, non sull'asfalto.
    expect(surfaceOf(0, 2.8, 0.8)).toBe('grass');
    const after = stepPlayer(start, acts({ accelerate: true }), 1 / 60, 0, false, 2.8, 0.8);
    expect(after.surface).toBe('grass');
    expect(after.speed).toBeLessThan(start.speed);
  });

  test('sulla carreggiata scelta si e sull asfalto e si accelera', () => {
    const start: PlayerState = { ...initialPlayer(), x: 1.8, speed: MAX_SPEED * 0.5, gear: 'hi' };
    expect(surfaceOf(1.8, 2.8, 0.8)).toBe('road');
    const after = stepPlayer(start, acts({ accelerate: true }), 1 / 60, 0, false, 2.8, 0.8);
    expect(after.surface).toBe('road');
    expect(after.speed).toBeGreaterThan(start.speed);
  });

  test('il bordo interno dell isola appartiene al terreno, quello esterno all asfalto', () => {
    expect(surfaceOf(0.79, 2.8, 0.8)).toBe('grass');
    expect(surfaceOf(0.8, 2.8, 0.8)).toBe('road');
  });
});

describe('isola meno punitiva dentro la zona di bivio (addendum del collaudo)', () => {
  test('sull isola, dentro la zona di bivio, la superficie e banchina, non terreno', () => {
    expect(surfaceOf(0.05, 2.8, 0.4, true)).toBe('shoulder');
    expect(surfaceOf(-0.3, 2.8, 0.4, true)).toBe('shoulder');
  });

  test('fuori dalla zona di bivio niente cambia: resta terreno', () => {
    expect(surfaceOf(0.05, 2.8, 0.4, false)).toBe('grass');
    expect(surfaceOf(0.05, 2.8, 0.4)).toBe('grass');
  });

  test('la fisica spinge verso la carreggiata piu vicina, mai verso il terreno', () => {
    let state: PlayerState = { ...initialPlayer(), x: 0.05, speed: 0 };
    let sawGrass = false;
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      state = stepPlayer(state, acts(), dt, 0, false, 2.8, 0.4, true);
      if (state.surface === 'grass') sawGrass = true;
    }
    expect(sawGrass).toBe(false);
    // Spinta di ISLAND_NUDGE unità/s verso destra (x parte positivo): in un
    // secondo esce dall'isola (median 0.4) e resta sulla carreggiata scelta.
    expect(state.x).toBeGreaterThanOrEqual(0.4);
    expect(surfaceOf(state.x, 2.8, 0.4, true)).not.toBe('grass');
  });

  test('da x = 0 la spinta va verso destra', () => {
    let state: PlayerState = { ...initialPlayer(), x: 0, speed: 0 };
    state = stepPlayer(state, acts(), 1 / 60, 0, false, 2.8, 0.4, true);
    expect(state.x).toBeGreaterThan(0);
  });

  test('da x negativo la spinta va verso sinistra', () => {
    let state: PlayerState = { ...initialPlayer(), x: -0.1, speed: 0 };
    state = stepPlayer(state, acts(), 1 / 60, 0, false, 2.8, 0.4, true);
    expect(state.x).toBeLessThan(-0.1);
  });

  test('fuori dalla zona di bivio (inForkZone assente) la spinta non scatta', () => {
    const state = stepPlayer({ ...initialPlayer(), x: 0.05, speed: 0 }, acts(), 1 / 60, 0, false, 2.8, 0.4);
    expect(state.x).toBe(0.05);
    expect(state.surface).toBe('grass');
  });
});
