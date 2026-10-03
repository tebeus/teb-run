// I tre brani della radio, nell'ordine in cui li sceglie la schermata radio.

import type { Song } from '../sequencer';
import { AMBER_LAGOON } from './chillout';
import { MIRRORBALL_MILE } from './disco';
import { TUNNEL_NINE } from './techno';

export const SONGS: readonly [Song, Song, Song] = [MIRRORBALL_MILE, AMBER_LAGOON, TUNNEL_NINE];

export const SONG_TITLES: readonly [string, string, string] = [
  'Mirrorball Mile',
  'Amber Lagoon',
  'Tunnel Nine',
];

export { AMBER_LAGOON, MIRRORBALL_MILE, TUNNEL_NINE };
export { repeat, sections } from './arrange';
export { SONG_VOICINGS, type SongVoicing } from './voicing';
