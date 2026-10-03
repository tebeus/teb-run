// Tunnel Nine: 138 bpm, techno. Composizione originale per TEB RUN, non cita
// nessun brano esistente. La minore, giro di quattro battute Am - F - G - Am.
// Cassa su ogni quarto, arpeggio acido di sedicesimi su pulse1 (duty 12,5%,
// vedi SONG_VOICINGS), charleston fitto, controcanto a colpi secchi su lead2
// dalla variazione in poi, e uno stacco di quattro battute in cui la cassa
// sparisce. 48 battute: intro (8), tema (16), variazione (12), stacco (4),
// ripresa (8).

import { parsePattern, type Song } from '../sequencer';
import { repeat, sections } from './arrange';

export const TUNNEL_NINE: Song = {
  bpm: 138,
  patterns: [
    // 0 silenzio, condiviso da pulse1 e pulse2
    parsePattern('. . . . . . . . . . . . . . . .'),

    // 1..3 pulse1: arpeggio di sedicesimi del tema
    parsePattern('A4 A5 C5 E5 A4 E5 C5 A5 A4 A5 C5 E5 G4 E5 C5 A5', 0.55),
    parsePattern('F4 F5 A4 C5 F4 C5 A4 F5 F4 F5 A4 C5 E4 C5 A4 F5', 0.55),
    parsePattern('G4 G5 B4 D5 G4 D5 B4 G5 G4 G5 B4 D5 F4 D5 B4 G5', 0.55),
    // 4..7 pulse1: variazione, registro alto e una battuta di tensione su E7
    parsePattern('E5 A5 C6 A5 E5 A5 C6 A5 E5 G5 C6 G5 E5 G5 B5 G5', 0.5),
    parsePattern('C5 F5 A5 F5 C5 F5 A5 F5 C5 E5 A5 E5 C5 E5 G5 E5', 0.5),
    parsePattern('D5 G5 B5 G5 D5 G5 B5 G5 D5 F5 B5 F5 D5 F5 A5 F5', 0.5),
    parsePattern('E4 E5 G#4 B4 E4 B4 G#4 E5 E4 E5 G#4 B4 D5 B4 G#4 E5', 0.5),

    // 8..10 pulse2: due colpi secchi per battuta
    parsePattern('A4 . . . . . . . E5 . . . . . . .', 0.5),
    parsePattern('F4 . . . . . . . C5 . . . . . . .', 0.5),
    parsePattern('G4 . . . . . . . D5 . . . . . . .', 0.5),
    // 11..14 pulse2: note tenute sotto la variazione, poi l'accordo di E7
    parsePattern('A4 - - - - - - - - - - - - - - -', 0.4),
    parsePattern('F4 - - - - - - - - - - - - - - -', 0.4),
    parsePattern('G4 - - - - - - - - - - - - - - -', 0.4),
    parsePattern('E4 . . . B4 . . . G#4 . . . B4 . . .', 0.45),

    // 15..17 tri: basso in ottavi, immobile
    parsePattern('A2 . A2 . A2 . A2 . A2 . A2 . A2 . A2 .', 0.95),
    parsePattern('F2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 .', 0.95),
    parsePattern('G2 . G2 . G2 . G2 . G2 . G2 . G2 . G2 .', 0.95),
    // 18..21 tri: salto d'ottava e nota di passaggio
    parsePattern('A2 . A3 . A2 . A2 . A2 . A3 . A2 . G2 .', 0.95),
    parsePattern('F2 . F3 . F2 . F2 . F2 . F3 . F2 . E2 .', 0.95),
    parsePattern('G2 . G3 . G2 . G2 . G2 . G3 . G2 . A2 .', 0.95),
    parsePattern('E2 . E2 . E2 . E2 . E2 . E3 . E2 . E2 .', 0.95),

    // 22..26 drums: cassa su ogni quarto, charleston su ogni sedicesimo
    parsePattern('C2 . . . C2 . . . C2 . . . C2 . . .', 0.9),
    parsePattern('C2 F2:0.25 F2:0.3 F2:0.25 C2 F2:0.25 F2:0.3 F2:0.25 C2 F2:0.25 F2:0.3 F2:0.25 C2 F2:0.25 F2:0.3 F2:0.25', 0.9),
    parsePattern('C2 F2:0.25 F2:0.35 F2:0.25 C2 F2:0.25 D2:0.5 F2:0.25 C2 F2:0.25 F2:0.35 F2:0.25 C2 D2:0.4 D2:0.5 F2:0.4', 0.9),
    parsePattern('C2 F2:0.25 F2:0.3 F2:0.25 C2 D2:0.4 D2:0.5 D2:0.6 C2 D2:0.5 D2:0.6 D2:0.7 C2 D2:0.8 D2:0.9 F2:0.5', 0.9),
    // 26 stacco: la cassa sparisce, restano solo i charleston
    parsePattern('. F2:0.25 F2:0.3 F2:0.25 . F2:0.25 F2:0.3 F2:0.25 . F2:0.25 F2:0.3 F2:0.25 . F2:0.25 F2:0.3 F2:0.25', 0.9),

    // 27..29 lead2: controcanto a colpi secchi sul controtempo, due ottave
    // sopra il basso, che risponde all'arpeggio di pulse1 invece di
    // raddoppiarlo.
    parsePattern('. . E5 . . . C6 . . . E5 . . . A5 .', 0.4),
    parsePattern('. . C5 . . . A5 . . . C5 . . . F5 .', 0.4),
    parsePattern('. . D5 . . . B5 . . . D5 . . . G5 .', 0.4),

    // 30 drums: il groove del tema, con il clap sul secondo e quarto quarto
    parsePattern('C2 F2:0.25 F2:0.3 F2:0.25 C2 F2:0.25 E2:0.6 F2:0.25 C2 F2:0.25 G2:0.3 F2:0.25 C2 F2:0.25 E2:0.6 F2:0.25', 0.9),
    // 31 drums: chiusura con cowbell in apertura, tom e rullante in crescendo
    parsePattern('C2 B2:0.25 F2:0.3 B2:0.25 C2 F2:0.25 E2:0.6 F2:0.25 A2:0.6 A2:0.6 A2:0.7 D2:0.7 C2 D2:0.8 D2:0.9 G2:0.5', 0.9),
  ],
  order: [
    // pulse1: l'arpeggio entra solo col tema
    sections(repeat([0], 8), repeat([1, 2, 3, 1], 4), repeat([4, 5, 6, 7], 3), [4, 5, 6, 7], [1, 2, 3, 1, 4, 5, 6, 7]),
    // pulse2: muto nell'intro e nello stacco
    sections(repeat([0], 4), [8, 9, 10, 8], repeat([8, 9, 10, 8], 4), repeat([11, 12, 13, 14], 3), repeat([0], 4), repeat([8, 9, 10, 8], 2)),
    // tri
    sections(repeat([15, 16, 17, 15], 2), repeat([15, 16, 17, 15], 4), repeat([18, 19, 20, 21], 3), [15, 16, 17, 15], repeat([18, 19, 20, 21], 2)),
    // lead2: tace fino alla variazione, muto nello stacco
    sections(repeat([0], 24), repeat([27, 28, 29, 27], 3), repeat([0], 4), [27, 28, 29, 27, 27, 28, 29, 27]),
    // pad: le note tenute sotto l'arpeggio, per tutte le 48 battute
    repeat([11, 12, 13, 11], 12),
    // drums: cassa nuda, charleston fitto, groove col clap, variazione con
    // le chiusure, stacco senza cassa, ripresa
    sections(repeat([22], 4), [23, 23, 23, 25], repeat([30, 30, 30, 24], 4), repeat([30, 24, 30, 31], 3), repeat([26], 4), [30, 30, 30, 31, 30, 24, 30, 31]),
  ],
};
