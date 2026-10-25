// Il traffico del giorno (sfida DAILY, spec §3.2): con il sale cambiano
// posizioni, tipi e velocità dei veicoli, ma non quanti sono, la densità
// lungo la tappa, il tracciato e le regole. Senza sale il traffico è quello
// di sempre, veicolo per veicolo.

import { describe, expect, test } from 'vitest';
import { dailyGraph } from '../../src/game/daily';
import { modeGraph, withMode } from '../../src/game/mode';
import { buildTrack } from '../../src/game/track';
import { REAL_GRAPH, STAGE_LIST } from '../../src/game/stages';
import { spawnTraffic, trafficSpan } from '../../src/game/traffic';
import { SEGMENT_LENGTH } from '../../src/render/project';
import { dailyChallenge } from '../../src/shared/daily';
import type { Car, StageDef } from '../../src/types';

/** Impronta di un traffico: abbastanza per vedere un veicolo spostato. */
const fingerprint = (cars: readonly Car[]): string =>
  cars.map((c) => `${c.name}@${Math.round(c.z)}/${c.offset.toFixed(3)}/${Math.round(c.speed)}`).join(';');

/** Veicoli per quarto della zona di traffico. */
function quarters(stage: StageDef, cars: readonly Car[]): number[] {
  const { from, to } = trafficSpan(stage.lengthSegments);
  const out = [0, 0, 0, 0];
  for (const c of cars) {
    const q = Math.min(3, Math.floor(((c.z / SEGMENT_LENGTH - from) / (to - from)) * 4));
    out[q]++;
  }
  return out;
}

const SALTS = [dailyChallenge('2026-10-25').trafficSalt, dailyChallenge('2026-10-26').trafficSalt];

describe('daily traffic', () => {
  test('without a salt (and with salt 0) the traffic is the usual one, car by car', () => {
    for (const stage of STAGE_LIST) {
      const track = buildTrack(stage);
      const usual = fingerprint(spawnTraffic(track, stage));
      expect(fingerprint(spawnTraffic(buildTrack(stage), { ...stage, trafficSalt: undefined }))).toBe(usual);
      expect(fingerprint(spawnTraffic(buildTrack(stage), { ...stage, trafficSalt: 0 }))).toBe(usual);
    }
  });

  test('the usual traffic has not moved (first cars of the first stage, recorded before the daily challenge)', () => {
    const stage = STAGE_LIST[0];
    const cars = spawnTraffic(buildTrack(stage), stage).slice(0, 3);
    expect(fingerprint(cars)).toBe(FIRST_STAGE_FIRST_CARS);
  });

  for (const mode of ['normal', 'hard'] as const) {
    test(`${mode}: same count and density, different cars, a different traffic each day`, () => {
      for (const base of STAGE_LIST) {
        const stage = withMode(base, mode);
        const usual = spawnTraffic(buildTrack(stage), stage);
        const days = SALTS.map((salt) => spawnTraffic(buildTrack(stage), { ...stage, trafficSalt: salt }));
        for (const cars of days) {
          expect(cars.length).toBe(usual.length);
          expect(fingerprint(cars)).not.toBe(fingerprint(usual));
          // La densità per quarto di zona resta quella di `spawnCurve`: entro un veicolo e mezzo per quarto più il 10 %.
          const a = quarters(stage, usual);
          const b = quarters(stage, cars);
          for (let q = 0; q < 4; q++) expect(Math.abs(a[q] - b[q])).toBeLessThanOrEqual(Math.ceil(usual.length * 0.1) + 1);
        }
        expect(fingerprint(days[0])).not.toBe(fingerprint(days[1]));
      }
    });
  }

  test('the track does not change with the salt', () => {
    for (const stage of STAGE_LIST) {
      const a = buildTrack(stage);
      const b = buildTrack({ ...stage, trafficSalt: SALTS[0] });
      expect(b.length).toBe(a.length);
      expect(b.map((s) => `${s.curve}/${s.p1.world.y}/${s.sprites.length}`)).toEqual(a.map((s) => `${s.curve}/${s.p1.world.y}/${s.sprites.length}`));
    }
  });

  test('dailyGraph salts every stage and keeps the rest of the graph (mode, times, endings)', () => {
    const graph = dailyGraph(modeGraph(REAL_GRAPH, 'hard'), 1234);
    let stage = graph.first();
    for (const side of ['R', 'L', 'R', 'L'] as const) {
      expect(stage.trafficSalt).toBe(1234);
      expect(stage.mode).toBe('hard');
      const plain = modeGraph(REAL_GRAPH, 'hard').next(stage, side)!;
      stage = graph.next(stage, side)!;
      expect({ ...stage, trafficSalt: undefined }).toEqual({ ...plain, trafficSalt: undefined });
    }
    expect(graph.next(stage, 'L')).toBeNull();
    expect(graph.endingOf(stage)).toBe(REAL_GRAPH.endingOf(stage));
  });
});

const FIRST_STAGE_FIRST_CARS =
  'traffic_van@76521/0.761/3802;traffic_muscle@95475/-0.771/5410;traffic_coupe@124043/-0.170/5752';
