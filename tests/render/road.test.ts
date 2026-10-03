import { describe, expect, test } from 'vitest';
import { CAMERA_DEPTH, FOG_DENSITY, LANES } from '../../src/render/project';
import {
  exponentialFog,
  FOG_START,
  fogAmount,
  laneMarkerWidth,
  rumbleWidth,
  shouldDrawSegment,
} from '../../src/render/road';
import { makeSegment } from '../helpers/segments';
import type { Segment } from '../../src/types';

/** Segmento visibile: davanti alla telecamera, rivolto avanti, non coperto. */
const visible = (over: Partial<Segment> = {}): Segment => {
  const s = makeSegment(3, over);
  s.p1.camera.z = 2000;
  s.p2.camera.z = 2200;
  s.p1.screen.y = 600;
  s.p2.screen.y = 500;
  s.p1.screen.w = 300;
  s.p2.screen.w = 280;
  s.clip = 720;
  return s;
};

describe('exponentialFog', () => {
  test('no fog at distance zero', () => {
    expect(exponentialFog(0, FOG_DENSITY)).toBe(1);
  });

  test('decreasing with distance and never negative', () => {
    let prev = Infinity;
    for (let i = 0; i <= 10; i++) {
      const v = exponentialFog(i / 10, FOG_DENSITY);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThan(0);
      prev = v;
    }
  });

  test('matches the spec formula at the horizon', () => {
    expect(exponentialFog(1, FOG_DENSITY)).toBeCloseTo(1 / Math.exp(5), 10);
  });
});

describe('fogAmount (spec 4.4: fade past 80 percent of the draw distance)', () => {
  test('there is no fog before 80 percent', () => {
    expect(fogAmount(0)).toBe(0);
    expect(fogAmount(0.5)).toBe(0);
    expect(fogAmount(FOG_START)).toBe(0);
  });

  test('it grows past 80 percent and is nearly full at the horizon', () => {
    expect(fogAmount(0.85)).toBeGreaterThan(0);
    expect(fogAmount(0.85)).toBeLessThan(fogAmount(0.95));
    expect(fogAmount(1)).toBeGreaterThan(0.98);
    expect(fogAmount(1)).toBeLessThanOrEqual(1);
  });

  test('it is clamped past the horizon', () => {
    expect(fogAmount(2)).toBe(fogAmount(1));
  });

  test('it is monotone over the whole range', () => {
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const v = fogAmount(i / 50);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('shouldDrawSegment (Review Focus 2)', () => {
  test('a normal segment is drawn', () => {
    expect(shouldDrawSegment(visible())).toBe(true);
  });

  test('a segment behind the camera is skipped', () => {
    const s = visible();
    s.p1.camera.z = -100;
    expect(shouldDrawSegment(s)).toBe(false);
  });

  test('a segment closer than the camera depth is skipped', () => {
    const s = visible();
    s.p1.camera.z = CAMERA_DEPTH / 2;
    expect(shouldDrawSegment(s)).toBe(false);
    s.p1.camera.z = 0;
    expect(shouldDrawSegment(s)).toBe(false);
  });

  test('a back facing segment is skipped', () => {
    const s = visible();
    s.p2.screen.y = s.p1.screen.y;
    expect(shouldDrawSegment(s)).toBe(false);
    s.p2.screen.y = s.p1.screen.y + 10;
    expect(shouldDrawSegment(s)).toBe(false);
  });

  test('a segment hidden behind a hill already drawn is skipped', () => {
    const s = visible();
    s.clip = 400;
    expect(shouldDrawSegment(s)).toBe(false);
    s.clip = 500;
    expect(shouldDrawSegment(s)).toBe(false);
    s.clip = 501;
    expect(shouldDrawSegment(s)).toBe(true);
  });
});

describe('rumble and lane marker widths', () => {
  test('with three lanes the rumble is a sixth of the half road', () => {
    expect(rumbleWidth(600)).toBeCloseTo(75, 10);
    expect(rumbleWidth(600, LANES)).toBeCloseTo(75, 10);
  });

  test('the lane marker is much thinner than the rumble', () => {
    expect(laneMarkerWidth(640)).toBeCloseTo(20, 10);
    expect(laneMarkerWidth(640)).toBeLessThan(rumbleWidth(640));
  });

  test('both shrink with the projected road width', () => {
    expect(rumbleWidth(100)).toBeLessThan(rumbleWidth(600));
    expect(laneMarkerWidth(100)).toBeLessThan(laneMarkerWidth(600));
  });

  test('many lanes never make the rumble grow', () => {
    expect(rumbleWidth(600, 12)).toBeLessThan(rumbleWidth(600, 3));
    expect(laneMarkerWidth(600, 12)).toBeLessThan(laneMarkerWidth(600, 3));
  });
});
