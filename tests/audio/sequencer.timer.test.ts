import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  LOOKAHEAD,
  createSequencer,
  parsePattern,
  type NotePlayer,
  type SequencerOptions,
  type Song,
} from '../../src/audio/sequencer';

// Pattern pieni: ogni step di ogni canale ha una nota, così gli attacchi
// attesi cadono uno ogni stepDuration e le asserzioni sui tempi sono strette.
const SONG: Song = {
  bpm: 120,
  patterns: [
    parsePattern('C4 D4 E4 F4 G4 A4 B4 C5 D5 C5 B4 A4 G4 F4 E4 D4'),
    parsePattern('C2 A6 D4 A6 C2 A6 D4 A6 C2 A6 D4 A6 C2 A6 D4 A6'),
    parsePattern('C4:0 . . . . . . . . . . . . . . .'),
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

interface Call {
  channel: string;
  freq: number;
  start: number;
  duration: number;
  velocity: number;
}

/** Per difetto una finestra corta, così un tick programma un solo step. */
function rig(options: SequencerOptions = { lookahead: 0.1 }): {
  clock: { currentTime: number };
  calls: Call[];
  offs: () => number;
  sequencer: ReturnType<typeof createSequencer>;
} {
  const clock = { currentTime: 0 };
  const calls: Call[] = [];
  let offs = 0;
  const player: NotePlayer = {
    playNote(channel, freq, startTime, duration, velocity) {
      calls.push({ channel, freq, start: startTime, duration, velocity });
    },
    allNotesOff() {
      offs += 1;
    },
  };
  return { clock, calls, offs: () => offs, sequencer: createSequencer(clock, player, options) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSequencer', () => {
  test('schedules the first step right after the start delay', () => {
    const { calls, sequencer } = rig();
    sequencer.play(SONG);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.start === 0.06)).toBe(true);
    expect(calls.map((call) => call.channel).sort()).toEqual([
      'drums',
      'lead2',
      'pad',
      'pulse1',
      'pulse2',
      'tri',
    ]);
  });

  test('keeps the song in tempo across many ticks', () => {
    const { clock, calls, sequencer } = rig();
    sequencer.play(SONG);
    for (let tick = 1; tick <= 80; tick++) {
      clock.currentTime = tick * 0.025;
      vi.advanceTimersByTime(25);
    }
    const starts = [...new Set(calls.map((call) => call.start))].sort((a, b) => a - b);
    expect(starts[0]).toBeCloseTo(0.06, 10);
    expect(starts[1]).toBeCloseTo(0.185, 10);
    expect(starts[2]).toBeCloseTo(0.31, 10);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeCloseTo(0.125, 8);
    }
  });

  test('never schedules the same channel and time twice', () => {
    const { clock, calls, sequencer } = rig();
    sequencer.play(SONG);
    for (let tick = 1; tick <= 200; tick++) {
      clock.currentTime = tick * 0.025;
      vi.advanceTimersByTime(25);
    }
    const keys = calls.map((call) => `${call.channel}@${call.start.toFixed(6)}`);
    expect(keys).toHaveLength(new Set(keys).size);
    expect(calls.length).toBeGreaterThan(20);
  });

  test('a throttled tab does not schedule a burst of past notes', () => {
    const { clock, calls, sequencer } = rig();
    sequencer.play(SONG);
    calls.length = 0;
    clock.currentTime = 1;
    vi.advanceTimersByTime(25);
    expect(calls.every((call) => call.start >= 1)).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  test('the default lookahead covers more than a second of music per tick', () => {
    // tab nascosto: il timer scende a un tick al secondo, e un tick deve
    // bastare a coprire il buco, altrimenti si sente una nota al secondo
    expect(LOOKAHEAD).toBeGreaterThanOrEqual(1);
    const { calls, sequencer } = rig({});
    sequencer.play(SONG);
    const starts = [...new Set(calls.map((call) => call.start))].sort((a, b) => a - b);
    expect(starts[0]).toBeCloseTo(0.06, 10);
    const lastStart = starts[starts.length - 1] ?? 0;
    expect(lastStart).toBeGreaterThanOrEqual(1);
    expect(starts).toHaveLength(new Set(starts).size);
  });

  test('a throttled tab with the default lookahead stays in tempo and never repeats', () => {
    const { clock, calls, sequencer } = rig({});
    sequencer.play(SONG);
    for (let second = 1; second <= 5; second++) {
      clock.currentTime = second;
      vi.advanceTimersByTime(1000);
    }
    const keys = calls.map((call) => `${call.channel}@${call.start.toFixed(6)}`);
    expect(keys).toHaveLength(new Set(keys).size);
    const starts = [...new Set(calls.map((call) => call.start))].sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      const gap = (starts[i] ?? 0) - (starts[i - 1] ?? 0);
      expect(gap).toBeCloseTo(0.125, 8);
    }
  });

  test('play while another song is playing stops the first one', () => {
    const { clock, calls, offs, sequencer } = rig();
    sequencer.play(SONG);
    clock.currentTime = 0.5;
    sequencer.play(SONG);
    expect(offs()).toBe(1);
    for (let tick = 1; tick <= 40; tick++) {
      clock.currentTime = 0.5 + tick * 0.025;
      vi.advanceTimersByTime(25);
    }
    const keys = calls.map((call) => `${call.channel}@${call.start.toFixed(6)}`);
    expect(keys).toHaveLength(new Set(keys).size);
  });

  test('stop with nothing playing does nothing', () => {
    const { offs, sequencer } = rig();
    expect(() => {
      sequencer.stop();
      sequencer.stop();
    }).not.toThrow();
    expect(offs()).toBe(0);
    expect(sequencer.playing).toBe(false);
  });

  test('after stop no more notes are scheduled', () => {
    const { clock, calls, sequencer } = rig();
    sequencer.play(SONG);
    sequencer.stop();
    const before = calls.length;
    for (let tick = 1; tick <= 40; tick++) {
      clock.currentTime = tick * 0.025;
      vi.advanceTimersByTime(25);
    }
    expect(calls).toHaveLength(before);
  });

  test('playing reflects the state', () => {
    const { sequencer } = rig();
    expect(sequencer.playing).toBe(false);
    sequencer.play(SONG);
    expect(sequencer.playing).toBe(true);
    sequencer.stop();
    expect(sequencer.playing).toBe(false);
  });

  test('a step with zero velocity is not played', () => {
    const { calls, sequencer } = rig();
    const muteSong: Song = {
      bpm: 120,
      patterns: SONG.patterns,
      order: [[2], [2], [2], [2], [2], [2]],
    };
    sequencer.play(muteSong);
    expect(calls).toHaveLength(0);
  });
});
