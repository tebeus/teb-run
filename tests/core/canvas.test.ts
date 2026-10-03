import { describe, expect, test } from 'vitest';
import { computeLetterbox, LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';

describe('computeLetterbox', () => {
  test('logical size is 1280x720', () => {
    expect(LOGICAL_W).toBe(1280);
    expect(LOGICAL_H).toBe(720);
  });

  test('exact 16:9 window scales without offset', () => {
    const lb = computeLetterbox(1920, 1080);
    expect(lb.scale).toBeCloseTo(1.5);
    expect(lb.cssW).toBe(1920);
    expect(lb.cssH).toBe(1080);
    expect(lb.offsetX).toBe(0);
    expect(lb.offsetY).toBe(0);
  });

  test('taller window centers vertically', () => {
    const lb = computeLetterbox(1280, 1000);
    expect(lb.scale).toBe(1);
    expect(lb.offsetX).toBe(0);
    expect(lb.offsetY).toBe(140);
  });

  test('wider window centers horizontally', () => {
    const lb = computeLetterbox(2560, 720);
    expect(lb.scale).toBe(1);
    expect(lb.offsetX).toBe(640);
    expect(lb.offsetY).toBe(0);
  });

  test('tiny or portrait windows still give positive sizes and non-negative offsets', () => {
    for (const [w, h] of [[100, 100], [400, 900], [1, 1]] as const) {
      const lb = computeLetterbox(w, h);
      expect(lb.cssW).toBeGreaterThan(0);
      expect(lb.cssH).toBeGreaterThan(0);
      expect(lb.offsetX).toBeGreaterThanOrEqual(0);
      expect(lb.offsetY).toBeGreaterThanOrEqual(0);
      expect(lb.cssW).toBeLessThanOrEqual(w);
      expect(lb.cssH).toBeLessThanOrEqual(h);
    }
  });
});
