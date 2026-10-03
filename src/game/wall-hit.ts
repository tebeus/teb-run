import { WALL_BASE_OFFSET } from '../render/walls';
import { MAX_SPEED } from './player';
import { forkOffset, hidesDiscardedSide } from './track';
import {
  PLAYER_COLLIDE_W,
  SCENERY_CRASH_MIN_PERCENT,
  hitSide,
  overlap,
  pushToCentre,
  type Collision,
} from './traffic';
import type { PlayerState, Segment } from '../types';

/**
 * Larghezza di collisione della parete alla base (spec §4.4c). Con l'hitbox
 * del giocatore la parete si tocca da |x| ≈ 1.34, cioè appena dopo la fine
 * della banchina: si perde l'asfalto, si prende la terra, poi il muro.
 */
export const WALL_COLLIDE_W = 0.1;

/**
 * Urto contro una parete solida: vale la regola dello sprite solido della
 * spec §6 (schianto sopra il 15% della velocità, altrimenti arresto e spinta
 * verso il centro). Ritorna null se non c'è parete o non c'è sovrapposizione.
 * Pura: non muta né il giocatore né il segmento.
 */
export function wallCollision(player: PlayerState, seg: Segment): Collision | null {
  const wall = seg.wall;
  if (wall === undefined) return null;
  const speedPercent = player.speed / MAX_SPEED;
  for (const side of [-1, 1] as const) {
    const kind = side < 0 ? wall.left : wall.right;
    if (kind === undefined) continue;
    // Terzo addendum del collaudo: niente urto contro una parete sul lato
    // della strada scartata (coerente con il renderer, che non la disegna).
    if (hidesDiscardedSide(side, seg)) continue;
    const objX = forkOffset(side * WALL_BASE_OFFSET, seg.roadHalf);
    if (!overlap(player.x, PLAYER_COLLIDE_W, objX, WALL_COLLIDE_W)) continue;
    const hit = hitSide(player.x, objX);
    if (speedPercent > SCENERY_CRASH_MIN_PERCENT) {
      return { kind: 'crash', speed: player.speed, z: player.z, x: player.x, side: hit };
    }
    return {
      kind: 'stop',
      speed: 0,
      z: player.z,
      x: pushToCentre(player.x, PLAYER_COLLIDE_W, objX, WALL_COLLIDE_W),
      side: hit,
    };
  }
  return null;
}
