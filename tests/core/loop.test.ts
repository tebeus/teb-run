import { describe, expect, test } from 'vitest';
import { MAX_ACC, STEP, stepAccumulator } from '../../src/core/loop';

describe('stepAccumulator', () => {
  test('one frame at 60 Hz yields exactly one step', () => {
    const r = stepAccumulator(0, STEP);
    expect(r.steps).toBe(1);
    expect(r.rest).toBeCloseTo(0, 9);
  });

  test('remainder carries over to the next frame', () => {
    const r1 = stepAccumulator(0, STEP * 1.5);
    expect(r1.steps).toBe(1);
    expect(r1.rest).toBeCloseTo(STEP * 0.5, 9);
    const r2 = stepAccumulator(r1.rest, STEP * 0.5);
    expect(r2.steps).toBe(1);
    expect(r2.rest).toBeCloseTo(0, 9);
  });

  test('a long pause (hidden tab) is clamped to MAX_ACC', () => {
    const r = stepAccumulator(0, 120);
    expect(r.steps).toBe(Math.floor(MAX_ACC / STEP));
    expect(r.steps).toBe(15);
    expect(r.rest).toBeLessThan(STEP);
  });

  test('a frame shorter than a step yields zero steps', () => {
    const r = stepAccumulator(0, STEP / 3);
    expect(r.steps).toBe(0);
    expect(r.rest).toBeCloseTo(STEP / 3, 9);
  });
});
