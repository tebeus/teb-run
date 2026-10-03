// Timbro di ogni brano: duty dei due canali pulse e sweep del passa-basso.
// Sta fuori da `Song` di proposito: la forma di `Song` è il contratto del
// sequencer (spec §10) e non cambia. Tabella pura, nessun Web Audio.

import type { FilterSweep } from '../effects';
import type { PulseDuty } from '../synth';

export interface SongVoicing {
  pulse1: PulseDuty;
  pulse2: PulseDuty;
  /** null: nessuno sweep, il filtro resta aperto. */
  sweep: FilterSweep | null;
}

/**
 * Nell'ordine di `SONGS`. Il disco muove il taglio lentamente su otto
 * battute; il chill-out non lo muove affatto; il techno lo muove su quattro
 * battute con l'arpeggio a duty 12,5%, che è il suono acido.
 */
export const SONG_VOICINGS: readonly [SongVoicing, SongVoicing, SongVoicing] = [
  { pulse1: 0.5, pulse2: 0.25, sweep: { base: 900, peak: 7000, bars: 8 } },
  { pulse1: 0.25, pulse2: 0.25, sweep: null },
  { pulse1: 0.125, pulse2: 0.5, sweep: { base: 600, peak: 9000, bars: 4 } },
];
