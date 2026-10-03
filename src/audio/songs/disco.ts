// Mirrorball Mile: 122 bpm, disco. Composizione originale per TEB RUN, non
// cita nessun brano esistente. La minore, giro di quattro battute
// Am7 - Dm7 - G7 - Cmaj7. Cassa in quattro, clap sul controtempo, charleston
// aperto sul terzo quarto, basso in ottava, stab di accordi su pulse2, melodia
// tenuta su pulse1, controcanto su lead2 dalla variazione in poi, pad di
// accordi tenuti sotto tutto.
// 48 battute: intro (8), tema (16), variazione (12), stacco (4), ripresa (8).

import { parsePattern, type Song } from '../sequencer';
import { repeat, sections } from './arrange';

export const MIRRORBALL_MILE: Song = {
  bpm: 122,
  patterns: [
    // 0 silenzio, condiviso da pulse1 nell'intro e nello stacco
    parsePattern('. . . . . . . . . . . . . . . .'),

    // 1..4 pulse1: melodia del tema, una battuta per accordo
    parsePattern('. . A4 . C5 . E5 - - . D5 - . C5 - -', 0.75),
    parsePattern('. . D5 . F5 . A5 - - . G5 - . F5 - -', 0.75),
    parsePattern('. . G4 . B4 . D5 - - . F5 - . D5 - -', 0.75),
    parsePattern('. . C5 . E5 . G5 - - . E5 - . C5 - -', 0.75),
    // 5..8 pulse1: variazione un'ottava sopra, attacco sul battere
    parsePattern('E5 - . A5 - - . G5 - . E5 . C5 - . .', 0.7),
    parsePattern('F5 - . A5 - - . C6 - . A5 . F5 - . .', 0.7),
    parsePattern('D5 - . G5 - - . F5 - . D5 . B4 - . .', 0.7),
    parsePattern('E5 - . C6 - - . B5 - . G5 . E5 - . .', 0.7),

    // 9..12 pulse2: stab di accordo in controtempo, tre note veloci
    parsePattern('. . A4 C5 E5 . . . . . A4 C5 E5 . . .', 0.5),
    parsePattern('. . D5 F5 A5 . . . . . D5 F5 A5 . . .', 0.5),
    parsePattern('. . G4 B4 D5 . . . . . G4 B4 D5 . . .', 0.5),
    parsePattern('. . C5 E5 G5 . . . . . C5 E5 G5 . . .', 0.5),
    // 13..16 pulse2: le stesse armonie tenute, per intro e stacco
    parsePattern('A4 - - - - - - - C5 - - - - - - -', 0.45),
    parsePattern('D5 - - - - - - - F5 - - - - - - -', 0.45),
    parsePattern('B4 - - - - - - - D5 - - - - - - -', 0.45),
    parsePattern('C5 - - - - - - - E5 - - - - - - -', 0.45),

    // 17..20 tri: basso in ottava, il marchio del disco
    parsePattern('A2 . A3 . A2 . A3 . A2 . A3 . A2 . A3 .', 0.95),
    parsePattern('D2 . D3 . D2 . D3 . D2 . D3 . D2 . D3 .', 0.95),
    parsePattern('G2 . G3 . G2 . G3 . G2 . G3 . G2 . G3 .', 0.95),
    parsePattern('C2 . C3 . C2 . C3 . C2 . C3 . C2 . C3 .', 0.95),
    // 21..24 tri: variante camminata, con la nota di passaggio in fondo
    parsePattern('A2 . A2 A3 . A2 . A3 A2 . A2 A3 . G2 . A2', 0.95),
    parsePattern('D2 . D2 D3 . D2 . D3 D2 . D2 D3 . C3 . D2', 0.95),
    parsePattern('G2 . G2 G3 . G2 . G3 G2 . G2 G3 . F2 . G2', 0.95),
    parsePattern('C2 . C2 C3 . C2 . C3 C2 . C2 C3 . D2 . C2', 0.95),

    // 25..29 drums: cassa in quattro, charleston sul controtempo. Le lettere
    // sono gli strumenti (spec §10): C cassa, D rullante, F charleston chiuso.
    parsePattern('C2 . F2:0.3 . C2 . F2:0.3 D2 C2 . F2:0.3 . C2 . F2:0.3 D2', 0.85),
    parsePattern('C2 . F2:0.3 . C2 F2:0.3 F2:0.4 D2 C2 . F2:0.3 . C2 F2:0.3 D2 D2:0.6', 0.85),
    parsePattern('C2 . F2:0.3 . C2 . F2:0.3 D2 C2 D2:0.5 D2:0.6 D2:0.7 C2 D2:0.8 D2:0.9 F2:0.5', 0.85),
    parsePattern('. . F2:0.3 . . . F2:0.3 . . . F2:0.3 . . . F2:0.3 .', 0.8),
    parsePattern('. . F2:0.3 D2 . . F2:0.3 . . . F2:0.3 D2 . . F2:0.4 F2:0.3', 0.8),

    // 30..33 lead2: controcanto, entra dopo il battere e tiene la nota di
    // colore dell'accordo (la settima o la nona), così non raddoppia pulse1.
    parsePattern('. . . . . E5 . G5 . . A5 - - . . .', 0.4),
    parsePattern('. . . . . A5 . C6 . . D6 - - . . .', 0.4),
    parsePattern('. . . . . B4 . D5 . . F5 - - . . .', 0.4),
    parsePattern('. . . . . G5 . B5 . . C6 - - . . .', 0.4),

    // 34 drums: il groove del tema, con il clap sul secondo e quarto quarto
    parsePattern('C2 . F2:0.3 . E2:0.7 . F2:0.3 . C2 . G2:0.35 . E2:0.7 . F2:0.3 D2:0.5', 0.85),
    // 35 drums: stessa cosa con la cowbell su ogni ottavo, il marchio del disco
    parsePattern('C2 B2:0.3 F2:0.3 B2:0.3 E2:0.7 B2:0.3 F2:0.3 B2:0.3 C2 B2:0.3 G2:0.35 B2:0.3 E2:0.7 B2:0.3 F2:0.3 D2:0.5', 0.85),
    // 36 drums: chiusura di frase con i tom e il rullante in crescendo
    parsePattern('C2 . F2:0.3 . E2:0.7 . F2:0.3 . A2:0.6 A2:0.6 A2:0.7 . D2:0.7 D2:0.8 D2:0.9 G2:0.5', 0.85),
  ],
  order: [
    // pulse1: tace per tutta l'intro e per lo stacco
    sections(repeat([0], 8), repeat([1, 2, 3, 4], 4), repeat([5, 6, 7, 8], 3), repeat([0], 4), [1, 2, 3, 4, 5, 6, 7, 8]),
    // pulse2: accordi tenuti, poi stab, poi tenuti di nuovo nello stacco
    sections([13, 14, 15, 16], [9, 10, 11, 12], repeat([9, 10, 11, 12], 4), repeat([13, 14, 15, 16], 3), [13, 14, 15, 16], repeat([9, 10, 11, 12], 2)),
    // tri: mai assente, è lui che tiene il pezzo in piedi
    sections(repeat([17, 18, 19, 20], 2), repeat([17, 18, 19, 20], 4), repeat([21, 22, 23, 24], 3), [17, 18, 19, 20], repeat([21, 22, 23, 24], 2)),
    // lead2: tace fino alla variazione, poi canta; muto nello stacco
    sections(repeat([0], 24), repeat([30, 31, 32, 33], 3), repeat([0], 4), [30, 31, 32, 33, 30, 31, 32, 33]),
    // pad: gli accordi tenuti sotto tutto, per tutte le 48 battute
    repeat([13, 14, 15, 16], 12),
    // drums: solo charleston, groove nudo, groove col clap, variazione con
    // cowbell e chiusure, stacco senza cassa, ripresa
    sections(repeat([28], 4), [25, 26, 25, 27], repeat([34, 34, 34, 35], 4), repeat([34, 35, 34, 36], 3), repeat([29], 4), [34, 34, 34, 36, 34, 35, 34, 36]),
  ],
};
