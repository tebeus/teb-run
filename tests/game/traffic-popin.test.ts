import { describe, expect, test } from 'vitest';
import { MAX_SPEED } from '../../src/game/player';
import { STAGE_LIST } from '../../src/game/stages';
import { buildTrack, FORK_ZONE_SEGMENTS } from '../../src/game/track';
import {
  RECYCLE_BEHIND_SEGMENTS,
  recycleTarget,
  segmentIndexOf,
  spawnTraffic,
  stepTraffic,
  TRAFFIC_FREE_START,
} from '../../src/game/traffic';
import { DRAW_DISTANCE, PLAYER_Z, SEGMENT_LENGTH } from '../../src/render/project';
import type { StageDef } from '../../src/types';

/**
 * Collaudo utente: «i veicoli compaiono all'ultimo momento». Causa
 * riprodotta qui: un veicolo arrivato al bivio rinasceva sempre al segmento
 * `TRAFFIC_FREE_START`, e nei primi ~330 segmenti di ogni tappa quel punto
 * è **dentro** la strada visibile (fino a 35 segmenti dal muso, 2-6 volte
 * per tappa). Regola: un veicolo non entra, non rinasce e non viene
 * riposizionato mai a meno di `DRAW_DISTANCE` segmenti davanti al giocatore.
 */

/** Scarto per tick: la distanza di un veicolo cambia di meno di un segmento. */
const EDGE = 5;

/**
 * Guida `stage` con un giocatore finto che accelera fino a `topPercent` e,
 * se `stopAt` è dato, si ferma lì per `stopS` secondi. Ritorna le comparse:
 * veicoli che al tick prima erano fuori dalla strada visibile (oltre
 * `DRAW_DISTANCE` o ben dietro la telecamera) e ora ci sono dentro, lontani
 * dal bordo in fondo.
 */
function popIns(stage: StageDef, topPercent: number, stopAt?: number, stopS = 20): string[] {
  const segs = buildTrack(stage);
  const cars = spawnTraffic(segs, stage);
  const n = segs.length;
  const dt = 1 / 30;
  const end = (n - FORK_ZONE_SEGMENTS - 10) * SEGMENT_LENGTH;
  let z = 0;
  let speed = 0;
  let stopped = 0;
  const prev = new Map<number, number>();
  const found: string[] = [];
  for (let t = 0; t < 90 && z < end; t += dt) {
    const pz = z;
    if (stopAt !== undefined && z >= stopAt * SEGMENT_LENGTH && stopped < stopS) {
      speed = 0;
      stopped += dt;
    } else {
      speed = Math.min(MAX_SPEED * topPercent, speed + MAX_SPEED * 0.25 * dt);
    }
    z += speed * dt;
    stepTraffic(segs, cars, dt, z, pz, stage.lanes);
    const ps = Math.floor(z / SEGMENT_LENGTH);
    for (const c of cars) {
      const d = segmentIndexOf(c.z, n) - ps;
      const was = prev.get(c.id);
      if (d >= 0 && d < DRAW_DISTANCE - EDGE && was !== undefined && (was >= DRAW_DISTANCE || was < -EDGE)) {
        found.push(`${stage.id} t=${t.toFixed(1)} car ${c.id} ${c.name} at +${d} (was ${was})`);
      }
      prev.set(c.id, d);
    }
  }
  return found;
}

describe('niente veicoli che compaiono all ultimo momento', () => {
  test('the free start is longer than the visible road, so a stage never spawns a car in sight', () => {
    expect(TRAFFIC_FREE_START).toBeGreaterThanOrEqual(DRAW_DISTANCE);
    for (const stage of STAGE_LIST) {
      for (const c of spawnTraffic(buildTrack(stage), stage)) {
        expect(c.z, `${stage.id} car ${c.id}`).toBeGreaterThanOrEqual(DRAW_DISTANCE * SEGMENT_LENGTH);
      }
    }
  });

  test('recycleTarget keeps the start of the traffic zone when it is well behind the camera', () => {
    const from = 360 * SEGMENT_LENGTH;
    const to = 2800 * SEGMENT_LENGTH;
    const far = from + PLAYER_Z + (RECYCLE_BEHIND_SEGMENTS + 1) * SEGMENT_LENGTH;
    expect(recycleTarget(from, to, far)).toBe(from);
  });

  test('recycleTarget moves the car past the visible road when the start of the zone is in sight', () => {
    const from = 360 * SEGMENT_LENGTH;
    const to = 2800 * SEGMENT_LENGTH;
    for (const seg of [0, 60, 200, 355, 370]) {
      const playerZ = seg * SEGMENT_LENGTH;
      const target = recycleTarget(from, to, playerZ);
      expect(target, `player at ${seg}`).toBeGreaterThanOrEqual(playerZ + DRAW_DISTANCE * SEGMENT_LENGTH);
      expect(target, `player at ${seg}`).toBeGreaterThanOrEqual(from);
      expect(target, `player at ${seg}`).toBeLessThan(to);
    }
  });

  test('on a track too short for both rules the car still recycles inside the traffic zone', () => {
    const from = 360 * SEGMENT_LENGTH;
    const to = 500 * SEGMENT_LENGTH;
    expect(recycleTarget(from, to, 300 * SEGMENT_LENGTH)).toBe(from);
  });

  test.each(STAGE_LIST.map((s) => [s.id, s] as const))(
    'stage %s: no car pops up inside the visible road, driving flat out or stopping early',
    (_id, stage) => {
      expect(popIns(stage, 0.9)).toEqual([]);
      // Fermo in mezzo alla zona libera: i veicoli arrivati al bivio
      // rinascerebbero proprio davanti.
      expect(popIns(stage, 0.9, 250)).toEqual([]);
      // Fermo appena dopo: il punto di rinascita è a pochi segmenti dietro.
      expect(popIns(stage, 0.9, TRAFFIC_FREE_START + 5)).toEqual([]);
    },
    30000,
  );
});
