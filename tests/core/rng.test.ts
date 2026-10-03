import { describe, expect, test } from 'vitest';
import { mulberry32 } from '../../src/core/rng';

describe('mulberry32', () => {
  test('same seed gives same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds differ', () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  test('next() is in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('int(min, max) is inclusive on both ends and never outside', () => {
    const r = mulberry32(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5]));
  });

  test('pick returns an element of the array', () => {
    const r = mulberry32(5);
    const arr = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 50; i++) expect(arr).toContain(r.pick(arr));
  });
});
