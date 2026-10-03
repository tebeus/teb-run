// Nomi di nota in notazione scientifica -> frequenza in Hz. Modulo puro:
// nessun DOM, nessun Web Audio. A4 = 440 Hz, C4 = MIDI 60.

export const A4_FREQ = 440;
export const A4_MIDI = 69;

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-G])([#b]?)(-?\d)$/;

export interface ParsedNote {
  letter: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  accidental: '' | '#' | 'b';
  octave: number;
  /** Numero MIDI: C4 = 60, A4 = 69. */
  midi: number;
}

/** Ritorna null se il nome non è una nota valida. */
export function parseNote(name: string): ParsedNote | null {
  const match = NOTE_RE.exec(name);
  if (match === null) return null;
  const letter = match[1] as ParsedNote['letter'];
  const accidental = match[2] as ParsedNote['accidental'];
  const octave = Number.parseInt(match[3], 10);
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const midi = (octave + 1) * 12 + PITCH_CLASS[letter] + shift;
  return { letter, accidental, octave, midi };
}

export function isNoteName(name: string): boolean {
  return parseNote(name) !== null;
}

/** Lancia se il nome non è valido: i dati dei brani sono codice, non input utente. */
export function noteToMidi(name: string): number {
  const parsed = parseNote(name);
  if (parsed === null) throw new Error(`invalid note name: ${name}`);
  return parsed.midi;
}

export function midiToFreq(midi: number): number {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function noteToFreq(name: string): number {
  return midiToFreq(noteToMidi(name));
}
