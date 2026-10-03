import { describe, expect, test } from 'vitest';
import { parseNote } from '../../src/audio/notes';
import {
  ARPEGGIOS,
  BLIP_NOTE,
  DETUNE_RATIO,
  ENGINE_LEVEL_EPSILON,
  SHAPER_DRIVE,
  SUB_GAIN,
  engineFilterFreq,
  engineFreq,
  engineLevel,
  saturationCurve,
  shouldUpdateParam,
  tremoloDepth,
  tremoloFreq,
} from '../../src/audio/sfx';

describe('engineFreq', () => {
  test('follows the spec formula in lo', () => {
    expect(engineFreq(0, 'lo')).toBe(60);
    expect(engineFreq(0.5, 'lo')).toBe(180);
    expect(engineFreq(1, 'lo')).toBe(300);
  });

  test('follows the spec formula in hi', () => {
    expect(engineFreq(0, 'hi')).toBe(40);
    expect(engineFreq(0.5, 'hi')).toBe(140);
    expect(engineFreq(1, 'hi')).toBe(240);
  });

  test('clamps the speed to 0..1 and survives NaN', () => {
    expect(engineFreq(-3, 'lo')).toBe(60);
    expect(engineFreq(9, 'lo')).toBe(300);
    expect(engineFreq(Number.NaN, 'hi')).toBe(40);
  });
});

describe('engineFilterFreq (spec §10)', () => {
  test('it opens from 400 Hz at rest to 3000 at full speed', () => {
    expect(engineFilterFreq(0)).toBe(400);
    expect(engineFilterFreq(1)).toBe(3000);
    expect(engineFilterFreq(0.5)).toBeGreaterThan(engineFilterFreq(0.25));
  });
});

describe('engineLevel', () => {
  test('is zero when the engine is off', () => {
    expect(engineLevel(false, 0.9)).toBe(0);
  });

  test('grows with the speed while running', () => {
    expect(engineLevel(true, 0)).toBeCloseTo(0.05, 10);
    expect(engineLevel(true, 1)).toBeCloseTo(0.15, 10);
    expect(engineLevel(true, 1)).toBeLessThanOrEqual(1);
  });
});

describe('shouldUpdateParam', () => {
  test('ignores changes below epsilon', () => {
    expect(shouldUpdateParam(180, 180.4, 1)).toBe(false);
    expect(shouldUpdateParam(180, 181.2, 1)).toBe(true);
    expect(shouldUpdateParam(0.1, 0.1 + ENGINE_LEVEL_EPSILON, ENGINE_LEVEL_EPSILON)).toBe(true);
  });

  test('the first write always happens', () => {
    expect(shouldUpdateParam(-1, 60, 1)).toBe(true);
  });
});

describe('ARPEGGIOS', () => {
  test('the checkpoint arpeggio is four notes and the fanfare eight', () => {
    expect(ARPEGGIOS.checkpoint).toHaveLength(4);
    expect(ARPEGGIOS.fanfare).toHaveLength(8);
  });

  test('every arpeggio note name parses', () => {
    for (const notes of [ARPEGGIOS.checkpoint, ARPEGGIOS.fanfare]) {
      for (const note of notes) {
        expect(parseNote(note.note), note.note).not.toBeNull();
      }
    }
    expect(parseNote(BLIP_NOTE)).not.toBeNull();
  });

  test('times are strictly increasing, durations positive, velocities in range', () => {
    for (const notes of [ARPEGGIOS.checkpoint, ARPEGGIOS.fanfare]) {
      notes.forEach((note, i) => {
        if (i > 0) expect(note.at).toBeGreaterThan(notes[i - 1]?.at ?? 0);
        expect(note.dur).toBeGreaterThan(0);
        expect(note.vel).toBeGreaterThan(0);
        expect(note.vel).toBeLessThanOrEqual(1);
      });
    }
  });

  test('the arpeggios stay inside the pulse register C3..C6', () => {
    for (const notes of [ARPEGGIOS.checkpoint, ARPEGGIOS.fanfare]) {
      for (const note of notes) {
        const midi = parseNote(note.note)?.midi ?? -1;
        expect(midi).toBeGreaterThanOrEqual(48);
        expect(midi).toBeLessThanOrEqual(84);
      }
    }
  });
});

describe('tremoloFreq e tremoloDepth (spec §10)', () => {
  test('the wobble speeds up and fades out with the speed', () => {
    expect(tremoloFreq(0)).toBe(9);
    expect(tremoloFreq(1)).toBe(15);
    expect(tremoloDepth(0)).toBeCloseTo(0.35, 10);
    expect(tremoloDepth(1)).toBe(0);
  });

  test('both clamp a speed outside 0..1 and survive NaN', () => {
    expect(tremoloFreq(-1)).toBe(9);
    expect(tremoloFreq(4)).toBe(15);
    expect(tremoloDepth(-1)).toBeCloseTo(0.35, 10);
    expect(tremoloDepth(4)).toBe(0);
    expect(tremoloFreq(Number.NaN)).toBe(9);
  });
});

describe('saturationCurve (spec §10)', () => {
  test('it is tanh(2x) over minus one to one', () => {
    const curve = saturationCurve(5);
    expect(curve).toHaveLength(5);
    expect(curve[0]).toBeCloseTo(Math.tanh(-SHAPER_DRIVE), 6);
    expect(curve[2]).toBeCloseTo(0, 10);
    expect(curve[4]).toBeCloseTo(Math.tanh(SHAPER_DRIVE), 6);
  });

  test('it is monotone and odd', () => {
    const curve = saturationCurve(1025);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThan(curve[i - 1]);
    expect(curve[0]).toBeCloseTo(-curve[curve.length - 1], 10);
  });

  test('it saturates: the ends are inside plus or minus one', () => {
    const curve = saturationCurve();
    expect(Math.abs(curve[0])).toBeLessThan(1);
    expect(Math.abs(curve[0])).toBeGreaterThan(0.9);
  });

  test('a degenerate size still gives a usable curve', () => {
    expect(saturationCurve(1).length).toBeGreaterThanOrEqual(3);
  });
});

describe('DETUNE_RATIO', () => {
  test('it is exactly seven cents', () => {
    expect(DETUNE_RATIO).toBeCloseTo(Math.pow(2, 7 / 1200), 9);
    expect(1200 * Math.log2(DETUNE_RATIO)).toBeCloseTo(7, 9);
  });

  test('the sub octave is half the fundamental, at half gain', () => {
    expect(SUB_GAIN).toBe(0.5);
  });
});
