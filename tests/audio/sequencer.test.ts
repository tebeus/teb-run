import { describe, expect, test } from 'vitest';
import {
  CHANNELS,
  STEPS_PER_BAR,
  createSequencer,
  parsePattern,
  songBars,
  stepAt,
  stepDuration,
  stepTime,
  stepsToSchedule,
  validateSong,
  type NotePlayer,
  type Pattern,
  type Song,
} from '../../src/audio/sequencer';

const TINY: Song = {
  bpm: 120,
  patterns: [
    parsePattern('C4 . . . E4 . . . G4 . . . E4 . . .'),
    parsePattern('C2 . . . C2 . . . C2 . . . C2 . . .'),
  ],
  order: [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [1, 1],
  ],
};

describe('stepDuration and stepTime', () => {
  test('a sixteenth at 120 bpm lasts 0.125 s', () => {
    expect(stepDuration(120)).toBeCloseTo(0.125, 10);
  });

  test('one bar of 16 steps at 120 bpm lasts 2 s', () => {
    expect(stepTime(120, STEPS_PER_BAR)).toBeCloseTo(2, 10);
    expect(stepTime(120, 0)).toBe(0);
  });

  test('a slower tempo makes longer steps', () => {
    expect(stepDuration(100)).toBeGreaterThan(stepDuration(128));
    expect(stepDuration(100)).toBeCloseTo(0.15, 10);
  });
});

describe('parsePattern', () => {
  test('16 tokens make 16 steps', () => {
    const pattern = parsePattern('C4 D4 E4 F4 G4 A4 B4 C5 C4 D4 E4 F4 G4 A4 B4 C5');
    expect(pattern).toHaveLength(STEPS_PER_BAR);
    expect(pattern[0]).toEqual({ note: 'C4', len: 1, vel: 0.8 });
  });

  test('a dot is a rest with zero velocity', () => {
    const pattern = parsePattern('. . . . . . . . . . . . . . . .');
    expect(pattern.every((step) => step.note === null && step.vel === 0 && step.len === 1)).toBe(true);
  });

  test('a dash extends the previous note', () => {
    const pattern = parsePattern('C4 - - . . . . . . . . . . . . .');
    expect(pattern[0]).toEqual({ note: 'C4', len: 3, vel: 0.8 });
    expect(pattern[1]).toEqual({ note: null, len: 1, vel: 0 });
    expect(pattern[2]).toEqual({ note: null, len: 1, vel: 0 });
  });

  test('a token can override the velocity', () => {
    const pattern = parsePattern('A6:0.3 . . . . . . . . . . . . . . .');
    expect(pattern[0]).toEqual({ note: 'A6', len: 1, vel: 0.3 });
  });

  test('the default velocity is the second argument', () => {
    const pattern = parsePattern('C4 . . . . . . . . . . . . . . .', 0.45);
    expect(pattern[0]?.vel).toBe(0.45);
  });

  test('throws when the token count is not 16', () => {
    expect(() => parsePattern('C4 D4')).toThrow(/16 tokens/);
    expect(() => parsePattern('. . . . . . . . . . . . . . . . .')).toThrow(/16 tokens/);
  });

  test('throws on an invalid note name', () => {
    expect(() => parsePattern('H4 . . . . . . . . . . . . . . .')).toThrow(/invalid note name/);
  });

  test('throws when a tie has no note before it', () => {
    expect(() => parsePattern('- C4 . . . . . . . . . . . . . .')).toThrow(/tie/);
  });

  test('throws when a tie follows a rest', () => {
    expect(() => parsePattern('C4 . - . . . . . . . . . . . . .')).toThrow(/tie/);
  });

  test('throws on an out of range velocity', () => {
    expect(() => parsePattern('C4:2 . . . . . . . . . . . . . . .')).toThrow(/velocity/);
    expect(() => parsePattern('C4:x . . . . . . . . . . . . . . .')).toThrow(/velocity/);
  });
});

describe('stepAt', () => {
  test('reads the pattern chosen by the order row', () => {
    expect(stepAt(TINY, 0, 0)?.note).toBe('C4');
    expect(stepAt(TINY, 0, 4)?.note).toBe('E4');
    expect(stepAt(TINY, 5, 0)?.note).toBe('C2');
    expect(stepAt(TINY, 0, 1)?.note).toBeNull();
  });

  test('wraps around the end of the order row', () => {
    // 2 battute x 16 step = 32 step, poi si ricomincia
    expect(stepAt(TINY, 0, 32)?.note).toBe('C4');
    expect(stepAt(TINY, 0, 36)?.note).toBe('E4');
  });

  test('returns null for a missing or empty row', () => {
    expect(stepAt(TINY, 9, 0)).toBeNull();
    expect(
      stepAt({ bpm: 120, patterns: TINY.patterns, order: [[], [], [], [], [], []] }, 0, 0),
    ).toBeNull();
  });
});

describe('stepsToSchedule', () => {
  test('schedules only the steps inside the lookahead window', () => {
    const result = stepsToSchedule(0, 0, 0.1, 120, 0);
    expect(result.steps).toEqual([{ step: 0, time: 0 }]);
    expect(result.nextStep).toBe(1);
  });

  test('includes a step that falls exactly on now', () => {
    const result = stepsToSchedule(1, 0.125, 0.1, 120, 0);
    expect(result.steps).toEqual([{ step: 1, time: 0.125 }]);
    expect(result.nextStep).toBe(2);
  });

  test('respects a song start in the future', () => {
    const result = stepsToSchedule(0, 0, 0.1, 128, 0.06);
    expect(result.steps).toEqual([{ step: 0, time: 0.06 }]);
  });

  test('never returns the same step twice across consecutive ticks', () => {
    let next = 0;
    const seen: number[] = [];
    for (let tick = 0; tick < 80; tick++) {
      const result = stepsToSchedule(next, tick * 0.025, 0.1, 120, 0);
      for (const scheduled of result.steps) seen.push(scheduled.step);
      next = result.nextStep;
    }
    expect(seen).toHaveLength(new Set(seen).size);
    expect(seen[0]).toBe(0);
    expect(seen.every((step, i) => i === 0 || step === seen[i - 1] + 1)).toBe(true);
    expect(Math.max(...seen)).toBe(16);
  });

  test('drops stale steps after a long gap instead of scheduling them in the past', () => {
    // il tab è rimasto nascosto un secondo: lo step atteso era 1, ora siamo a 1.0 s
    const result = stepsToSchedule(1, 1, 0.1, 120, 0);
    expect(result.steps).toEqual([{ step: 8, time: 1 }]);
    expect(result.nextStep).toBe(9);
    expect(result.steps.every((scheduled) => scheduled.time >= 1)).toBe(true);
  });

  test('a lookahead wider than one second returns every step in that window', () => {
    const result = stepsToSchedule(0, 0, 1.2, 120, 0);
    expect(result.steps).toHaveLength(10);
    expect(result.nextStep).toBe(10);
    expect(result.steps[9]).toEqual({ step: 9, time: 1.125 });
    const times = result.steps.map((scheduled) => scheduled.time);
    expect(times).toHaveLength(new Set(times).size);
  });
});

describe('validateSong', () => {
  const clone = (): Song => ({
    bpm: TINY.bpm,
    patterns: TINY.patterns.map((pattern) => pattern.map((step) => ({ ...step }))),
    order: TINY.order.map((row) => [...row]),
  });

  test('accepts a well formed song', () => {
    expect(validateSong(TINY)).toEqual([]);
  });

  test('reports a bpm outside 60..200', () => {
    const song = clone();
    song.bpm = 240;
    expect(validateSong(song).join(' ')).toMatch(/bpm/);
    song.bpm = 30;
    expect(validateSong(song).join(' ')).toMatch(/bpm/);
  });

  test('reports a pattern that is not 16 steps', () => {
    const song = clone();
    song.patterns[0] = song.patterns[0].slice(0, 15);
    expect(validateSong(song).join(' ')).toMatch(/15 steps/);
  });

  test('reports an order index that does not exist', () => {
    const song = clone();
    song.order[0] = [0, 7];
    expect(validateSong(song).join(' ')).toMatch(/pattern index 7/);
  });

  test('reports rows of different length', () => {
    const song = clone();
    song.order[1] = [0];
    expect(validateSong(song).join(' ')).toMatch(/1 bars/);
  });

  test('reports an invalid note name', () => {
    const song = clone();
    song.patterns[0][0] = { note: 'H9', len: 1, vel: 0.5 };
    expect(validateSong(song).join(' ')).toMatch(/invalid note 'H9'/);
  });

  test('reports the wrong number of order rows', () => {
    const song = clone();
    song.order = [[0], [0]];
    expect(validateSong(song).join(' ')).toMatch(new RegExp(`expected ${CHANNELS.length}`));
  });

  test('reports a bad length or velocity', () => {
    const song = clone();
    song.patterns[0][0] = { note: 'C4', len: 0, vel: 3 };
    const problems = validateSong(song).join(' ');
    expect(problems).toMatch(/len 0/);
    expect(problems).toMatch(/vel 3/);
  });
});

describe('songBars', () => {
  test('counts the bars of the first order row', () => {
    expect(songBars(TINY)).toBe(2);
    expect(songBars({ bpm: 120, patterns: [], order: [] })).toBe(0);
  });
});

describe('CHANNELS', () => {
  test('there are six channels, in the order of the Song.order rows', () => {
    expect(CHANNELS).toEqual(['pulse1', 'pulse2', 'tri', 'lead2', 'pad', 'drums']);
  });

  test('drums is the last row: rewriting a drum pattern never moves a melody', () => {
    expect(CHANNELS[CHANNELS.length - 1]).toBe('drums');
  });
});

describe('validateSong with six channels', () => {
  const bar = (): Pattern => parsePattern('C4 . . . . . . . . . . . . . . .');

  test('a song with four rows is now a problem', () => {
    const problems = validateSong({ bpm: 120, patterns: [bar()], order: [[0], [0], [0], [0]] });
    expect(problems).toContain('order has 4 rows, expected 6');
  });

  test('six rows of the same length pass', () => {
    expect(
      validateSong({ bpm: 120, patterns: [bar()], order: [[0], [0], [0], [0], [0], [0]] }),
    ).toEqual([]);
  });
});

describe('stepAt on the drums row', () => {
  test('reads the sixth row', () => {
    const song: Song = {
      bpm: 120,
      patterns: [
        parsePattern('. . . . . . . . . . . . . . . .'),
        parsePattern('C2 . . . . . . . . . . . . . . .'),
      ],
      order: [[0], [0], [0], [0], [0], [1]],
    };
    expect(stepAt(song, 5, 0)?.note).toBe('C2');
    expect(stepAt(song, 3, 0)?.note).toBeNull();
  });
});

describe('createSequencer passes the note name along', () => {
  test('the drums channel gets the name, not just the frequency', () => {
    const played: { channel: string; noteName: string | undefined }[] = [];
    const player: NotePlayer = {
      playNote: (channel, _freq, _start, _dur, _vel, noteName) =>
        played.push({ channel, noteName }),
      allNotesOff: () => {},
    };
    const song: Song = {
      bpm: 120,
      patterns: [
        parsePattern('. . . . . . . . . . . . . . . .'),
        parsePattern('C2 . . . . . . . . . . . . . . .'),
      ],
      order: [[0], [0], [0], [0], [0], [1]],
    };
    const sequencer = createSequencer({ currentTime: 0 }, player, { lookahead: 0.1, tickMs: 10_000 });
    sequencer.play(song);
    sequencer.stop();
    const drums = played.filter((p) => p.channel === 'drums');
    expect(drums).toHaveLength(1);
    expect(drums[0]?.noteName).toBe('C2');
  });
});
