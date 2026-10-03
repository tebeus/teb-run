import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { noteToFreq } from '../../src/audio/notes';
import {
  createSequencer,
  parsePattern,
  resumeStep,
  type NotePlayer,
  type Song,
} from '../../src/audio/sequencer';

// Due battute: 32 step da 0,125 s a 120 bpm. pulse1 suona una scala, così
// la nota dice da quale step il brano è ripartito.
const SONG: Song = {
  bpm: 120,
  patterns: [
    parsePattern('C4 D4 E4 F4 G4 A4 B4 C5 D5 C5 B4 A4 G4 F4 E4 D4'),
    parsePattern('C3 D3 E3 F3 G3 A3 B3 C4 D4 C4 B3 A3 G3 F3 E3 D3'),
  ],
  order: [
    [0, 1],
    [0, 1],
    [0, 1],
    [0, 1],
    [0, 1],
    [0, 1],
  ],
};

function rig(): {
  clock: { currentTime: number };
  pulse1: { freq: number; start: number }[];
  sequencer: ReturnType<typeof createSequencer>;
} {
  const clock = { currentTime: 0 };
  const pulse1: { freq: number; start: number }[] = [];
  const player: NotePlayer = {
    playNote(channel, freq, startTime) {
      if (channel === 'pulse1') pulse1.push({ freq, start: startTime });
    },
    allNotesOff() {},
  };
  return { clock, pulse1, sequencer: createSequencer(clock, player, { lookahead: 0.1 }) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resumeStep', () => {
  test('is the step heard at that instant, 0 before the first one', () => {
    expect(resumeStep(120, 1, 0.5, 32)).toBe(0);
    expect(resumeStep(120, 1, 1, 32)).toBe(0);
    expect(resumeStep(120, 1, 1.124, 32)).toBe(0);
    expect(resumeStep(120, 1, 1.125, 32)).toBe(1);
    expect(resumeStep(120, 1, 1 + 0.125 * 21 + 0.06, 32)).toBe(21);
  });

  test('wraps on the length of the song, and 0 steps means no wrap', () => {
    expect(resumeStep(120, 0, 0.125 * 37 + 0.01, 32)).toBe(5);
    expect(resumeStep(120, 0, 0.125 * 37 + 0.01, 0)).toBe(37);
  });
});

describe('ripresa del brano sintetico dopo la pausa', () => {
  test('position follows the clock, and is null when nothing plays', () => {
    const { clock, sequencer } = rig();
    expect(sequencer.position).toBeNull();
    sequencer.play(SONG);
    expect(sequencer.position).toBe(0);
    clock.currentTime = 0.06 + 0.125 * 21 + 0.03;
    expect(sequencer.position).toBe(21);
    sequencer.stop();
    expect(sequencer.position).toBeNull();
  });

  test('play from the saved position starts on that step, not on the first', () => {
    const { clock, pulse1, sequencer } = rig();
    sequencer.play(SONG);
    for (let tick = 1; tick <= 28; tick++) {
      clock.currentTime = tick * 0.025;
      vi.advanceTimersByTime(25);
    }
    // 0,7 s: si sente lo step 5 (A4).
    const at = sequencer.position;
    expect(at).toBe(5);
    sequencer.stop();

    // Dieci secondi di pausa, poi CONTINUE.
    clock.currentTime = 10.7;
    pulse1.length = 0;
    sequencer.play(SONG, at ?? 0);
    expect(pulse1[0]?.freq).toBe(noteToFreq('A4'));
    expect(pulse1[0]?.start).toBeCloseTo(10.76, 9);
    for (let tick = 1; tick <= 6; tick++) {
      clock.currentTime = 10.7 + tick * 0.025;
      vi.advanceTimersByTime(25);
    }
    // Poi il brano va avanti in tempo: B4 uno step dopo.
    expect(pulse1[1]?.freq).toBe(noteToFreq('B4'));
    expect(pulse1[1]?.start).toBeCloseTo(10.885, 9);
    expect(sequencer.position).toBe(5);
  });

  test('a position in the second bar resumes in the second bar, and is wrapped on the song', () => {
    const { pulse1, sequencer } = rig();
    sequencer.play(SONG, 16 + 3);
    expect(pulse1[0]?.freq).toBe(noteToFreq('F3'));
    pulse1.length = 0;
    sequencer.play(SONG, 32 + 2);
    expect(pulse1[0]?.freq).toBe(noteToFreq('E4'));
  });

  test('without a step the song starts from the beginning as before', () => {
    const { pulse1, sequencer } = rig();
    sequencer.play(SONG);
    expect(pulse1[0]?.freq).toBe(noteToFreq('C4'));
    expect(pulse1[0]?.start).toBeCloseTo(0.06, 9);
  });
});
