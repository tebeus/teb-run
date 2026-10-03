import { describe, expect, test } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { SEGMENT_LENGTH } from '../../src/render/project';
import {
  easeIn,
  easeInOut,
  easeOut,
  findSegment,
  pickSection,
  SECTION_KINDS,
  sectionWeights,
  wrapZ,
  type SectionKind,
} from '../../src/game/track';
import { makeFlatTrack } from '../helpers/segments';

describe('easings', () => {
  test('all three hit both ends exactly', () => {
    for (const f of [easeIn, easeOut, easeInOut]) {
      expect(f(10, 20, 0)).toBeCloseTo(10, 10);
      expect(f(10, 20, 1)).toBeCloseTo(20, 10);
    }
  });

  test('easeIn starts slow, easeOut starts fast', () => {
    expect(easeIn(0, 10, 0.5)).toBeCloseTo(2.5, 10);
    expect(easeOut(0, 10, 0.5)).toBeCloseTo(7.5, 10);
  });

  test('easeInOut is symmetric around the middle', () => {
    expect(easeInOut(0, 10, 0.5)).toBeCloseTo(5, 10);
    expect(easeInOut(0, 10, 0.25) + easeInOut(0, 10, 0.75)).toBeCloseTo(10, 10);
  });

  test('easings are monotone', () => {
    for (const f of [easeIn, easeOut, easeInOut]) {
      let prev = -Infinity;
      for (let i = 0; i <= 20; i++) {
        const v = f(0, 100, i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });
});

describe('wrapZ', () => {
  test('keeps a value already inside the range', () => {
    expect(wrapZ(0, 1000)).toBe(0);
    expect(wrapZ(999, 1000)).toBe(999);
  });

  test('wraps past the end and at the end exactly', () => {
    expect(wrapZ(1000, 1000)).toBe(0);
    expect(wrapZ(1500, 1000)).toBe(500);
    expect(wrapZ(3200, 1000)).toBe(200);
  });

  test('wraps negative values into the range', () => {
    expect(wrapZ(-1, 1000)).toBe(999);
    expect(wrapZ(-1000, 1000)).toBe(0);
    expect(wrapZ(-1200, 1000)).toBe(800);
  });
});

describe('findSegment', () => {
  const track = makeFlatTrack(10);
  const trackLength = 10 * SEGMENT_LENGTH;

  test('finds the segment containing z', () => {
    expect(findSegment(track, 0).index).toBe(0);
    expect(findSegment(track, 199.99).index).toBe(0);
    expect(findSegment(track, 200).index).toBe(1);
    expect(findSegment(track, 250).index).toBe(1);
    expect(findSegment(track, trackLength - 1).index).toBe(9);
  });

  test('z at or past the end of the track wraps to the start', () => {
    expect(findSegment(track, trackLength).index).toBe(0);
    expect(findSegment(track, trackLength + 250).index).toBe(1);
    expect(findSegment(track, trackLength * 7 + 400).index).toBe(2);
  });

  test('negative z wraps to the end of the track', () => {
    expect(findSegment(track, -1).index).toBe(9);
    expect(findSegment(track, -trackLength - 1).index).toBe(9);
  });

  test('never returns undefined for any z', () => {
    for (const z of [-1e9, -0.5, 0, 12.5, 1e9, trackLength]) {
      expect(findSegment(track, z)).toBeDefined();
    }
  });
});

describe('sectionWeights', () => {
  test('every kind has a positive weight for any difficulty', () => {
    for (const d of [0, 0.15, 0.3, 0.5, 0.85, 1]) {
      const w = sectionWeights(d);
      for (const k of SECTION_KINDS) expect(w[k], `${k} at ${d}`).toBeGreaterThan(0);
    }
  });

  test('straights get rarer and hard curves more common with difficulty', () => {
    const easy = sectionWeights(0);
    const hard = sectionWeights(1);
    expect(hard.straight).toBeLessThan(easy.straight);
    expect(hard.curveHard).toBeGreaterThan(easy.curveHard);
    expect(hard.hillHigh).toBeGreaterThan(easy.hillHigh);
    expect(hard.hillLow).toBeLessThan(easy.hillLow);
  });

  test('there are eleven section kinds', () => {
    expect(SECTION_KINDS).toHaveLength(11);
    expect(new Set(SECTION_KINDS).size).toBe(11);
  });
});

describe('pickSection', () => {
  test('is deterministic for a given seed', () => {
    const a = mulberry32(3);
    const b = mulberry32(3);
    const seqA = Array.from({ length: 20 }, () => pickSection(a, 0.5));
    const seqB = Array.from({ length: 20 }, () => pickSection(b, 0.5));
    expect(seqA).toEqual(seqB);
  });

  test('only returns known kinds', () => {
    const r = mulberry32(11);
    for (let i = 0; i < 500; i++) expect(SECTION_KINDS).toContain(pickSection(r, 0.4));
  });

  test('a hard stage picks more hard curves than an easy one', () => {
    const count = (difficulty: number): number => {
      const r = mulberry32(77);
      let n = 0;
      for (let i = 0; i < 3000; i++) if (pickSection(r, difficulty) === 'curveHard') n++;
      return n;
    };
    expect(count(1)).toBeGreaterThan(count(0) * 3);
  });

  test('an easy stage picks straights most often', () => {
    const r = mulberry32(5);
    const tally = {} as Record<SectionKind, number>;
    for (const k of SECTION_KINDS) tally[k] = 0;
    for (let i = 0; i < 3000; i++) tally[pickSection(r, 0)]++;
    const best = SECTION_KINDS.reduce((a, b) => (tally[a] >= tally[b] ? a : b));
    expect(best).toBe('straight');
  });
});
