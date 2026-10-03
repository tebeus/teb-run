import { describe, expect, test } from 'vitest';
import { repeat, sections } from '../../src/audio/songs/arrange';
import { songBars, validateSong } from '../../src/audio/sequencer';
import { SONGS, SONG_VOICINGS } from '../../src/audio/songs';

describe('repeat', () => {
  test('repeats the bars the given number of times', () => {
    expect(repeat([1, 2], 3)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  test('zero times gives an empty row', () => {
    expect(repeat([1, 2], 0)).toEqual([]);
  });

  test('it copies, so the caller cannot mutate the source through the result', () => {
    const source = [1, 2];
    const out = repeat(source, 2);
    out[0] = 9;
    expect(source).toEqual([1, 2]);
  });

  test('a non-integer or negative count throws: the orders are code, not input', () => {
    expect(() => repeat([1], 1.5)).toThrow();
    expect(() => repeat([1], -1)).toThrow();
  });
});

describe('sections', () => {
  test('concatenates the sections in order', () => {
    expect(sections([1], [2, 3], repeat([4], 2))).toEqual([1, 2, 3, 4, 4]);
  });

  test('no sections gives an empty row', () => {
    expect(sections()).toEqual([]);
  });
});

describe('the three songs are arranged consistently', () => {
  test('every order row has exactly songBars entries and validateSong is happy', () => {
    for (const song of SONGS) {
      const bars = songBars(song);
      expect(bars).toBe(48);
      for (const row of song.order) expect(row).toHaveLength(bars);
      expect(validateSong(song)).toEqual([]);
    }
  });

  test('there is one voicing per song', () => {
    expect(SONG_VOICINGS).toHaveLength(SONGS.length);
    for (const voicing of SONG_VOICINGS) {
      expect([0.125, 0.25, 0.5]).toContain(voicing.pulse1);
      expect([0.125, 0.25, 0.5]).toContain(voicing.pulse2);
      if (voicing.sweep !== null) {
        expect(voicing.sweep.base).toBeGreaterThan(0);
        expect(voicing.sweep.peak).toBeGreaterThan(voicing.sweep.base);
        expect(voicing.sweep.bars).toBeGreaterThan(0);
      }
    }
  });
});
