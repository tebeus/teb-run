import { describe, expect, test } from 'vitest';
import { AUDIO_SAMPLE_KINDS, engineSpeedFor, scheduleSong, songIndexFor } from '../../src/audio/offline';
import { CHANNELS, parsePattern, STEPS_PER_BAR, type NotePlayer, type Song } from '../../src/audio/sequencer';
import { SONGS } from '../../src/audio/songs';

describe('the sample kinds', () => {
  test('three engine speeds and one per song', () => {
    expect(AUDIO_SAMPLE_KINDS).toEqual([
      'engine-idle',
      'engine-mid',
      'engine-full',
      'song-0',
      'song-1',
      'song-2',
    ]);
  });

  test('each kind is either an engine speed or a song, never both', () => {
    for (const kind of AUDIO_SAMPLE_KINDS) {
      const speed = engineSpeedFor(kind);
      const song = songIndexFor(kind);
      expect(speed === null, kind).toBe(song !== null);
    }
  });

  test('the three engine speeds sit on the two sides and the middle of the crossfade', () => {
    expect(engineSpeedFor('engine-idle')).toBeLessThan(0.15);
    expect(engineSpeedFor('engine-mid')).toBeGreaterThan(0.15);
    expect(engineSpeedFor('engine-mid')).toBeLessThan(0.6);
    expect(engineSpeedFor('engine-full')).toBeGreaterThan(0.6);
  });

  test('the song indices point at the three real songs', () => {
    expect(songIndexFor('song-0')).toBe(0);
    expect(songIndexFor('song-2')).toBe(2);
    expect(SONGS[songIndexFor('song-2') ?? -1]).toBeDefined();
  });
});

describe('scheduleSong', () => {
  test('schedules every note of the requested bars, on every channel', () => {
    const played: { channel: string; time: number; noteName: string | undefined }[] = [];
    const player: NotePlayer = {
      playNote: (channel, _f, time, _d, _v, noteName) => played.push({ channel, time, noteName }),
      allNotesOff: () => {},
    };
    const song: Song = {
      bpm: 120,
      patterns: [
        parsePattern('. . . . . . . . . . . . . . . .'),
        parsePattern('C4 . . . C4 . . . C4 . . . C4 . . .'),
      ],
      order: CHANNELS.map(() => [1]),
    };
    const end = scheduleSong(song, player, 2, 0);
    // Quattro note per battuta, due battute, sei canali.
    expect(played).toHaveLength(4 * 2 * CHANNELS.length);
    expect(end).toBeCloseTo(2 * STEPS_PER_BAR * (15 / 120), 6);
    expect(played.every((p) => p.time >= 0 && p.time < end)).toBe(true);
    expect(played[0]?.noteName).toBe('C4');
  });

  test('schedules nothing for zero bars', () => {
    const played: unknown[] = [];
    const player: NotePlayer = { playNote: () => played.push(1), allNotesOff: () => {} };
    scheduleSong(SONGS[0], player, 0, 0);
    expect(played).toHaveLength(0);
  });

  test('the real songs schedule something on every channel in four bars', () => {
    for (const [index, song] of SONGS.entries()) {
      const seen = new Set<string>();
      const player: NotePlayer = {
        playNote: (channel) => seen.add(channel),
        allNotesOff: () => {},
      };
      // Quattro battute dal tema, non dall'intro, dove metà canali tacciono.
      scheduleSong(song, player, 4, 0, 20 * STEPS_PER_BAR);
      expect(seen.size, `brano ${index}: ${[...seen].join(', ')}`).toBeGreaterThanOrEqual(5);
    }
  });

  test('a start offset shifts every note by exactly the same amount', () => {
    const run = (startAt: number): number[] => {
      const times: number[] = [];
      const player: NotePlayer = {
        playNote: (_c, _f, time) => times.push(time),
        allNotesOff: () => {},
      };
      scheduleSong(SONGS[2], player, 1, startAt);
      return times;
    };
    const a = run(0);
    const b = run(5);
    expect(b).toHaveLength(a.length);
    // Non basta che ogni tempo sia >= 5: qui si confrontano due esecuzioni,
    // stesso brano, stesso ordine di note, e ogni tempo della seconda deve
    // cadere esattamente 5 secondi dopo il corrispondente della prima.
    b.forEach((time, i) => expect(time).toBeCloseTo(a[i]! + 5, 10));
  });
});
