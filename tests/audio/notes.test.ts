import { describe, expect, test } from 'vitest';
import {
  A4_FREQ,
  isNoteName,
  midiToFreq,
  noteToFreq,
  noteToMidi,
  parseNote,
} from '../../src/audio/notes';

describe('parseNote', () => {
  test('parses letter, accidental and octave', () => {
    expect(parseNote('C4')).toEqual({ letter: 'C', accidental: '', octave: 4, midi: 60 });
    expect(parseNote('F#3')).toEqual({ letter: 'F', accidental: '#', octave: 3, midi: 54 });
    expect(parseNote('Bb2')).toEqual({ letter: 'B', accidental: 'b', octave: 2, midi: 46 });
  });

  test('rejects malformed names', () => {
    expect(parseNote('')).toBeNull();
    expect(parseNote('H4')).toBeNull();
    expect(parseNote('C')).toBeNull();
    expect(parseNote('C##4')).toBeNull();
    expect(parseNote('c4')).toBeNull();
    expect(parseNote('C4 ')).toBeNull();
    expect(parseNote('C4.5')).toBeNull();
  });
});

describe('noteToMidi', () => {
  test('C4 is 60 and A4 is 69', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
  });

  test('sharps and flats shift by one semitone', () => {
    expect(noteToMidi('F#3')).toBe(noteToMidi('F3') + 1);
    expect(noteToMidi('Bb2')).toBe(noteToMidi('B2') - 1);
    expect(noteToMidi('Gb3')).toBe(noteToMidi('F#3'));
  });

  test('throws on an invalid name', () => {
    expect(() => noteToMidi('X9')).toThrow(/invalid note name/);
  });
});

describe('noteToFreq', () => {
  test('A4 is exactly 440 Hz', () => {
    expect(noteToFreq('A4')).toBe(A4_FREQ);
  });

  test('octaves double and halve the frequency', () => {
    expect(noteToFreq('A3')).toBeCloseTo(220, 6);
    expect(noteToFreq('A5')).toBeCloseTo(880, 6);
  });

  test('F#3 and Gb3 are the same frequency', () => {
    expect(noteToFreq('Gb3')).toBeCloseTo(noteToFreq('F#3'), 10);
  });

  test('known notes match the equal temperament table', () => {
    expect(noteToFreq('C4')).toBeCloseTo(261.626, 3);
    expect(noteToFreq('F#3')).toBeCloseTo(184.997, 3);
    expect(noteToFreq('Bb2')).toBeCloseTo(116.541, 3);
    expect(noteToFreq('C2')).toBeCloseTo(65.406, 3);
    expect(noteToFreq('D4')).toBeCloseTo(293.665, 3);
    expect(noteToFreq('A6')).toBeCloseTo(1760, 3);
    expect(noteToFreq('C6')).toBeCloseTo(1046.502, 3);
  });

  test('throws on an invalid name', () => {
    expect(() => noteToFreq('nope')).toThrow(/invalid note name/);
  });
});

describe('isNoteName', () => {
  test('accepts the names used by the songs and refuses the rest', () => {
    for (const name of ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'Bb2', 'B2', 'C3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'Bb4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6', 'A6']) {
      expect(isNoteName(name)).toBe(true);
    }
    for (const name of ['.', '-', '', 'C', 'Z3', 'c3']) {
      expect(isNoteName(name)).toBe(false);
    }
  });
});

describe('midiToFreq', () => {
  test('is continuous around A4', () => {
    expect(midiToFreq(69)).toBe(440);
    expect(midiToFreq(70) / midiToFreq(69)).toBeCloseTo(Math.pow(2, 1 / 12), 10);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
  });
});
