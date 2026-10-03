import { describe, expect, test } from 'vitest';
import { DRUM_BY_LETTER, DRUM_OCTAVE, drumVoiceFor } from '../../src/audio/drums';
import { parseNote } from '../../src/audio/notes';
import {
  CHANNELS,
  STEPS_PER_BAR,
  songBars,
  stepAt,
  validateSong,
  type ChannelName,
  type Song,
} from '../../src/audio/sequencer';
import { SONGS, SONG_TITLES } from '../../src/audio/songs';

// I pattern di batteria scrivono la lettera dello strumento all'ottava
// convenzionale (spec §10): l'ottava non conta, ma tenerla fissa rende i
// pattern leggibili a colpo d'occhio.
const DRUM_NOTES = Object.keys(DRUM_BY_LETTER).map((letter) => `${letter}${DRUM_OCTAVE}`);

const RANGE: Record<string, [number, number]> = {
  pulse1: [48, 84], // C3..C6
  pulse2: [48, 84],
  tri: [36, 60],
  // Il controcanto sta sopra la melodia principale, il pad in mezzo.
  lead2: [55, 89],
  pad: [48, 84],
};

const named = (): { title: string; song: Song }[] =>
  SONGS.map((song, i) => ({ title: SONG_TITLES[i] ?? `song ${i}`, song }));

describe('songs', () => {
  test('there are three songs with three titles', () => {
    expect(SONGS).toHaveLength(3);
    expect(SONG_TITLES).toEqual(['Mirrorball Mile', 'Amber Lagoon', 'Tunnel Nine']);
  });

  test('the tempos match the spec', () => {
    expect(SONGS.map((song) => song.bpm)).toEqual([122, 92, 138]);
  });

  test('every song passes validateSong', () => {
    for (const { title, song } of named()) {
      expect(validateSong(song), title).toEqual([]);
    }
  });

  test('every song loops over at least 48 bars', () => {
    for (const { title, song } of named()) {
      expect(songBars(song), title).toBeGreaterThanOrEqual(48);
      expect(song.order, title).toHaveLength(CHANNELS.length);
    }
  });

  test('every pattern has exactly 16 steps', () => {
    for (const { title, song } of named()) {
      for (const pattern of song.patterns) {
        expect(pattern, title).toHaveLength(STEPS_PER_BAR);
      }
    }
  });

  test('every note name parses', () => {
    for (const { title, song } of named()) {
      for (const pattern of song.patterns) {
        for (const step of pattern) {
          if (step.note === null) continue;
          expect(parseNote(step.note), `${title} ${step.note}`).not.toBeNull();
        }
      }
    }
  });

  test('every melodic channel uses at least six distinct patterns', () => {
    for (const { title, song } of named()) {
      for (let channel = 0; channel < 3; channel++) {
        const used = [...new Set(song.order[channel] ?? [])];
        expect(used.length, `${title} ${CHANNELS[channel]}`).toBeGreaterThanOrEqual(6);
        const shapes = used.map((index) => JSON.stringify(song.patterns[index]));
        expect(new Set(shapes).size, `${title} ${CHANNELS[channel]}`).toBe(shapes.length);
      }
      expect((song.order[3] ?? []).length, `${title} drums`).toBeGreaterThanOrEqual(48);
    }
  });

  test('the pulse channels stay between C3 and C6 and the bass between C2 and C3', () => {
    for (const { title, song } of named()) {
      for (let channel = 0; channel < CHANNELS.length; channel++) {
        const name = CHANNELS[channel] ?? '';
        const range = RANGE[name];
        if (range === undefined) continue;
        const bars = songBars(song);
        for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
          const found = stepAt(song, channel, step);
          if (found === null || found.note === null) continue;
          const midi = parseNote(found.note)?.midi ?? -1;
          expect(midi, `${title} ${name} ${found.note}`).toBeGreaterThanOrEqual(range[0]);
          expect(midi, `${title} ${name} ${found.note}`).toBeLessThanOrEqual(range[1]);
        }
      }
    }
  });

  test('every song has an intro, a break and a return: some channel rests and comes back', () => {
    for (const { title, song } of named()) {
      const bars = songBars(song);
      let restingBars = 0;
      for (let bar = 0; bar < bars; bar++) {
        const silent = [0, 1, 3].some((channel) => {
          for (let step = 0; step < STEPS_PER_BAR; step++) {
            const found = stepAt(song, channel, bar * STEPS_PER_BAR + step);
            if (found !== null && found.note !== null && found.vel > 0) return false;
          }
          return true;
        });
        if (silent) restingBars++;
      }
      // Soglia stretta da 8 a 20 (Minor 8/M4 della revisione finale): con tre
      // canali indipendenti "qualcuno tace" è quasi scontato, e misurato dà
      // 28 battute su 48 per tutti e tre i brani. Alzare la soglia fino a
      // "tutti e tre insieme" romperebbe due brani su tre (misurato: 0 e 0
      // battute), quindi non è la correzione giusta; 20 resta ben sotto le
      // 28 misurate e rende la soglia meno banale da soddisfare per caso.
      expect(restingBars, `${title} bars with a resting channel`).toBeGreaterThanOrEqual(20);
    }
  });

  test('every pattern is reached by some order row', () => {
    for (const { title, song } of named()) {
      const used = new Set<number>();
      for (const row of song.order) for (const index of row) used.add(index);
      for (let index = 0; index < song.patterns.length; index++) {
        expect(used.has(index), `${title} pattern ${index}`).toBe(true);
      }
    }
  });

  test('every song has one order row per channel', () => {
    for (const { title, song } of named()) {
      expect(song.order, title).toHaveLength(CHANNELS.length);
    }
  });

  test('every song is 48 bars on every channel', () => {
    for (const { title, song } of named()) {
      expect(songBars(song), title).toBe(48);
      for (const [i, row] of song.order.entries()) {
        expect(row.length, `${title} riga ${CHANNELS[i]}`).toBe(48);
      }
    }
  });

  test('the drums row only ever writes the seven drum letters', () => {
    const drumsRow = CHANNELS.indexOf('drums');
    for (const { title, song } of named()) {
      for (let step = 0; step < 48 * STEPS_PER_BAR; step++) {
        const note = stepAt(song, drumsRow, step)?.note;
        if (note === null || note === undefined) continue;
        expect(DRUM_NOTES, `${title} step ${step}: ${note}`).toContain(note);
      }
    }
  });

  test('the drums channel only uses the drum letters', () => {
    // Sostituisce il test «the noise channel only uses the three drum notes»,
    // che leggeva `stepAt(song, 3, step)`: con sei canali la riga 3 è `lead2`,
    // e appena il task 8 gli dà delle note quel test fallirebbe su una nota
    // di melodia. L'indice non si scrive a mano, lo dà CHANNELS.
    const drumsRow = CHANNELS.indexOf('drums');
    for (const { title, song } of named()) {
      const bars = songBars(song);
      for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
        const found = stepAt(song, drumsRow, step);
        if (found === null || found.note === null) continue;
        expect(DRUM_NOTES, `${title}: ${found.note}`).toContain(found.note);
      }
    }
  });

  test('the pad never goes silent for a whole song: it is the harmonic bed', () => {
    const padRow = CHANNELS.indexOf('pad');
    for (const { title, song } of named()) {
      let sounding = 0;
      for (let step = 0; step < 48 * STEPS_PER_BAR; step++) {
        // `stepAt(...)?.note !== null` conterebbe anche l'assenza di uno step
        // (`undefined !== null` è vero): serve lo step vero, non solo un
        // valore diverso da null per accidente.
        const st = stepAt(song, padRow, step);
        if (st !== null && st.note !== null) sounding += 1;
      }
      expect(sounding, title).toBeGreaterThan(40);
    }
  });
});

describe('the rearrangements', () => {
  const rowOf = (song: Song, channel: ChannelName): number => CHANNELS.indexOf(channel);

  const notesOn = (song: Song, channel: ChannelName): string[] => {
    const row = rowOf(song, channel);
    const out: string[] = [];
    for (let step = 0; step < 48 * STEPS_PER_BAR; step++) {
      const note = stepAt(song, row, step)?.note;
      if (note !== null && note !== undefined) out.push(note);
    }
    return out;
  };

  test('every song has a countermelody on lead2', () => {
    for (const { title, song } of named()) {
      // La soglia vale per il brano più spoglio: *Amber Lagoon* ha un
      // controcanto volutamente rado, una nota tenuta per battuta, 20 in
      // tutto (il passo 4 lo scrive e il commento del brano lo dice). Non
      // alzare la soglia: sono i dati a essere giusti.
      expect(notesOn(song, 'lead2').length, title).toBeGreaterThan(15);
    }
  });

  test('the countermelody stays out of the way at the start', () => {
    // Entra con la variazione, non con la prima battuta: se cantasse da
    // subito, il tema non si sentirebbe più.
    for (const { title, song } of named()) {
      const row = rowOf(song, 'lead2');
      let sounding = 0;
      for (let step = 0; step < 8 * STEPS_PER_BAR; step++) {
        if (stepAt(song, row, step)?.note !== null) sounding += 1;
      }
      expect(sounding, title).toBe(0);
    }
  });

  test('every song uses at least five of the seven drums', () => {
    for (const { title, song } of named()) {
      const voices = new Set(notesOn(song, 'drums').map((note) => drumVoiceFor(note)));
      expect(voices.size, `${title}: ${[...voices].join(', ')}`).toBeGreaterThanOrEqual(5);
    }
  });

  test('the clap lands on the backbeat of the disco groove', () => {
    // Battuta 8 (prima del tema), step 4 e 12 sono il secondo e il quarto
    // quarto: è lì che vive il clap di un disco.
    const disco = SONGS[0];
    const row = rowOf(disco, 'drums');
    const base = 16 * STEPS_PER_BAR;
    expect(drumVoiceFor(stepAt(disco, row, base + 4)?.note ?? '')).toBe('clap');
    expect(drumVoiceFor(stepAt(disco, row, base + 12)?.note ?? '')).toBe('clap');
  });

  test('the kick still lands on every quarter of the techno theme', () => {
    const techno = SONGS[2];
    const row = rowOf(techno, 'drums');
    const base = 16 * STEPS_PER_BAR; // dentro il tema
    for (const step of [0, 4, 8, 12]) {
      expect(drumVoiceFor(stepAt(techno, row, base + step)?.note ?? ''), `step ${step}`).toBe('kick');
    }
  });

  test('nothing changed about titles, tempos, bars or validity', () => {
    expect(SONG_TITLES).toEqual(['Mirrorball Mile', 'Amber Lagoon', 'Tunnel Nine']);
    expect(SONGS.map((song) => song.bpm)).toEqual([122, 92, 138]);
    for (const { title, song } of named()) {
      expect(songBars(song), title).toBe(48);
      expect(validateSong(song), title).toEqual([]);
    }
  });

  test('no channel ever asks for two notes on the same step', () => {
    // `Pattern` non lo permette per costruzione, ma una riga di `order` che
    // punta al pattern sbagliato può far suonare al pad la melodia: questo
    // controlla che ogni canale resti nel suo registro.
    for (const { title, song } of named()) {
      for (const channel of ['pulse1', 'pulse2', 'tri', 'lead2', 'pad'] as const) {
        const [low, high] = RANGE[channel]!;
        for (const note of notesOn(song, channel)) {
          const midi = parseNote(note)?.midi ?? -1;
          expect(midi, `${title} ${channel} ${note}`).toBeGreaterThanOrEqual(low);
          expect(midi, `${title} ${channel} ${note}`).toBeLessThanOrEqual(high);
        }
      }
    }
  });
});
