// Amber Lagoon: 92 bpm, chill-out. Composizione originale per TEB RUN, non
// cita nessun brano esistente. Fa maggiore, giro di quattro battute
// Fmaj7 - Dm7 - Bbmaj7 - C7. Accordi lunghi su pulse2 (duty 25%, vedi
// SONG_VOICINGS), melodia rada su pulse1, cassa morbida, molti silenzi,
// controcanto rarissimo su lead2 dalla variazione in poi.
// 48 battute: intro (4), tema (16), variazione (12), stacco (8), ripresa (8).

import { parsePattern, type Song } from '../sequencer';
import { repeat, sections } from './arrange';

export const AMBER_LAGOON: Song = {
  bpm: 92,
  patterns: [
    // 0 silenzio, condiviso da pulse1, lead2 e drums quando tacciono
    parsePattern('. . . . . . . . . . . . . . . .'),

    // 1..4 pulse1: melodia del tema, due note lunghe per battuta
    parsePattern('. . . . A4 - - - . . C5 - - - . .', 0.6),
    parsePattern('. . . . F4 - - - . . A4 - - - . .', 0.6),
    parsePattern('. . . . D5 - - - . . F5 - - - . .', 0.6),
    parsePattern('. . . . E5 - - - . . G5 - - - . .', 0.6),
    // 5..8 pulse1: variazione, entra sul battere e scende
    parsePattern('C5 - - - . . E5 - - . D5 - - - . .', 0.55),
    parsePattern('A4 - - - . . D5 - - . C5 - - - . .', 0.55),
    parsePattern('F5 - - - . . A5 - - . G5 - - - . .', 0.55),
    parsePattern('G5 - - - . . E5 - - . C5 - - - . .', 0.55),

    // 9..12 pulse2: accordi lunghi, posizione bassa
    parsePattern('F4 - - - - - - - A4 - - - - - - -', 0.45),
    parsePattern('D4 - - - - - - - F4 - - - - - - -', 0.45),
    parsePattern('Bb4 - - - - - - - D5 - - - - - - -', 0.45),
    parsePattern('C5 - - - - - - - E5 - - - - - - -', 0.45),
    // 13..16 pulse2: le stesse armonie in rivolto alto
    parsePattern('A4 - - - - - - - E5 - - - - - - -', 0.4),
    parsePattern('F4 - - - - - - - C5 - - - - - - -', 0.4),
    parsePattern('D5 - - - - - - - A5 - - - - - - -', 0.4),
    parsePattern('E5 - - - - - - - Bb5 - - - - - - -', 0.4),

    // 17..20 tri: fondamentale tenuta per tutta la battuta
    parsePattern('F2 - - - - - - - - - - - - - - -', 0.85),
    parsePattern('D2 - - - - - - - - - - - - - - -', 0.85),
    parsePattern('Bb2 - - - - - - - - - - - - - - -', 0.85),
    parsePattern('C3 - - - - - - - - - - - - - - -', 0.85),
    // 21..24 tri: due mezze note, un po' di movimento
    parsePattern('F2 - - - - - - - C3 - - - - - - -', 0.85),
    parsePattern('D2 - - - - - - - A2 - - - - - - -', 0.85),
    parsePattern('Bb2 - - - - - - - F2 - - - - - - -', 0.85),
    parsePattern('C3 - - - - - - - G2 - - - - - - -', 0.85),

    // 25..27 drums: cassa morbida sul primo e sul terzo quarto, poco altro
    parsePattern('C2:0.5 . . . . . F2:0.2 . C2:0.4 . . . . . F2:0.2 .', 0.5),
    parsePattern('C2:0.5 . . . F2:0.2 . . . C2:0.4 . . . F2:0.2 . D2:0.3 .', 0.5),
    parsePattern('C2:0.5 . . . . . F2:0.2 . C2:0.4 . F2:0.2 . D2:0.3 . D2:0.4 F2:0.25', 0.5),

    // 28..31 lead2: controcanto rarissimo, una nota tenuta per battuta, che
    // entra a metà. In un chill-out il silenzio è metà dell'arrangiamento.
    parsePattern('. . . . . . . . . . C5 - - - . .', 0.35),
    parsePattern('. . . . . . . . . . A4 - - - . .', 0.35),
    parsePattern('. . . . . . . . . . F5 - - - . .', 0.35),
    parsePattern('. . . . . . . . . . G5 - - - . .', 0.35),

    // 32 drums: il clap morbido sul terzo quarto prende il posto del rullante
    parsePattern('C2:0.5 . . . . . F2:0.2 . E2:0.45 . . . . . G2:0.2 .', 0.5),
    // 33 drums: chiusura di frase con un tom e il charleston aperto in coda
    parsePattern('C2:0.5 . . . F2:0.2 . . . E2:0.45 . A2:0.35 . D2:0.3 . A2:0.4 G2:0.25', 0.5),
  ],
  order: [
    // pulse1: entra solo col tema, tace nell'intro e nello stacco
    sections(repeat([0], 4), repeat([1, 2, 3, 4], 4), repeat([5, 6, 7, 8], 3), repeat([0], 8), [1, 2, 3, 4, 5, 6, 7, 8]),
    // pulse2: il tappeto di accordi non si ferma mai
    sections([9, 10, 11, 12], repeat([9, 10, 11, 12], 4), repeat([13, 14, 15, 16], 3), repeat([9, 10, 11, 12], 2), repeat([13, 14, 15, 16], 2)),
    // tri
    sections([17, 18, 19, 20], repeat([17, 18, 19, 20], 4), repeat([21, 22, 23, 24], 3), repeat([17, 18, 19, 20], 2), repeat([21, 22, 23, 24], 2)),
    // lead2: entra con la variazione, tace per tutto lo stacco
    sections(repeat([0], 20), repeat([28, 29, 30, 31], 3), repeat([0], 8), [28, 29, 30, 31, 28, 29, 30, 31]),
    // pad: i rivolti alti, che in un chill-out sono il pezzo forte
    repeat([13, 14, 15, 16], 12),
    // drums: silenzio nell'intro, cassa e charleston nel tema, clap e tom
    // nella variazione, silenzio nella prima metà dello stacco
    sections(repeat([0], 4), repeat([25, 25, 25, 26], 4), repeat([32, 32, 32, 33], 3), repeat([0], 4), [25, 26, 25, 27], [32, 32, 32, 33, 32, 32, 32, 33]),
  ],
};
