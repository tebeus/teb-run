import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { DEMO_STAGES } from '../../src/game/demo-graph';
import { MAX_SPEED } from '../../src/game/player';
import { buildTrack, FORK_EXIT_SEGMENTS, FORK_ZONE_SEGMENTS, INTRO_SEGMENTS, laneToRoad } from '../../src/game/track';
import {
  avoidOffset,
  blockedLanes,
  bucketCars,
  carCount,
  trafficCountFor,
  trafficReferenceLength,
  EASY_START_DENSITY,
  EASY_START_FRACTION,
  escapeLane,
  LANES_X,
  LANE_NOISE,
  laneCentres,
  laneNoiseFor,
  laneOf,
  moveToward,
  overlap,
  segmentIndexOf,
  spawnCurve,
  spawnTraffic,
  SPEED_JITTER,
  TRAFFIC_FREE_START,
  TRAFFIC_SPEEDS,
} from '../../src/game/traffic';
import { SEGMENT_LENGTH } from '../../src/render/project';
import type { Car, Segment } from '../../src/types';
import { makeFlatTrack } from '../helpers/segments';

const DT = 1 / 60;
const car = (over: Partial<Car> = {}): Car => ({
  id: 1,
  name: 'traffic_sedan',
  offset: 0,
  z: 0,
  speed: 1000,
  percent: 0,
  ...over,
});

describe('overlap (spec §6)', () => {
  test('two boxes on the same spot overlap', () => {
    expect(overlap(0, 0.3, 0, 0.3)).toBe(true);
  });

  test('exact contact is not an overlap', () => {
    expect(overlap(0, 0.3, 0.3, 0.3)).toBe(false);
    expect(overlap(0, 0.3, 0.29999, 0.3)).toBe(true);
  });

  test('zero widths never overlap, not even at the same x', () => {
    expect(overlap(0, 0, 0, 0)).toBe(false);
  });

  test('it is symmetric and sign independent', () => {
    expect(overlap(0.5, 0.3, 0.6, 0.2)).toBe(overlap(0.6, 0.2, 0.5, 0.3));
    expect(overlap(-0.5, 0.3, -0.6, 0.2)).toBe(overlap(0.5, 0.3, 0.6, 0.2));
  });

  test('cars in the two outer lanes never touch', () => {
    // A quattro corsie le esterne sono la 0 e la 3, non la 0 e la 2.
    expect(LANES_X).toHaveLength(4);
    expect(overlap(LANES_X[0], 0.3, LANES_X[3], 0.3)).toBe(false);
  });
});

describe('laneNoiseFor: nessun veicolo sul cordolo ne sopra il vicino (task 15)', () => {
  const NAMES = Object.keys(TRAFFIC_SPEEDS);

  test('a corsia esterna e rumore massimo la sagoma resta dentro il cordolo', () => {
    for (const [lanes, roadHalf] of [
      [4, 1],
      [3, 0.8],
    ] as const) {
      for (const name of NAMES) {
        const centres = laneCentres(lanes);
        const outer = Math.max(...centres.map((c) => Math.abs(c)));
        const offset = outer + laneNoiseFor(name, lanes, roadHalf);
        // laneToRoad manda l'offset di corsia sulla strada vera; la
        // semilarghezza della sagoma e la sua `scale`, in semilarghezze strada.
        const edge = laneToRoad(offset, roadHalf, 0) + CATALOG[name].scale;
        expect(edge, `${name} a ${lanes} corsie`).toBeLessThanOrEqual(roadHalf + 1e-12);
      }
    }
  });

  test('due veicoli in corsie adiacenti con rumore opposto non si sovrappongono', () => {
    for (const [lanes, roadHalf] of [
      [4, 1],
      [3, 0.8],
    ] as const) {
      const centres = laneCentres(lanes);
      for (const name of NAMES) {
        const noise = laneNoiseFor(name, lanes, roadHalf);
        for (let i = 1; i < centres.length; i++) {
          const a = laneToRoad(centres[i - 1] + noise, roadHalf, 0);
          const b = laneToRoad(centres[i] - noise, roadHalf, 0);
          expect(
            overlap(a, CATALOG[name].scale, b, CATALOG[name].scale),
            `due ${name} a ${lanes} corsie`,
          ).toBe(false);
        }
      }
    }
  });

  test('i veicoli stretti tengono il rumore pieno di spec §6', () => {
    expect(laneNoiseFor('traffic_bike', 4, 1)).toBe(LANE_NOISE);
    expect(laneNoiseFor('traffic_sedan', 4, 1)).toBe(LANE_NOISE);
    // L'autobus, larghissimo, lo dimezza.
    expect(laneNoiseFor('traffic_bus', 4, 1)).toBeLessThan(LANE_NOISE);
    expect(laneNoiseFor('traffic_bus', 4, 1)).toBeGreaterThan(0);
  });

  test('una strada di larghezza nulla non ammette rumore', () => {
    expect(laneNoiseFor('traffic_bus', 4, 0)).toBe(0);
  });
});

describe('carCount (spec §6)', () => {
  test('20 cars with no difficulty and 80 at the top', () => {
    expect(carCount(0)).toBe(20);
    expect(carCount(1)).toBe(80);
    expect(carCount(0.15)).toBe(29);
  });

  test('the density per segment is the tuned one whatever the stage length (collaudo: due livelli)', () => {
    for (const d of [0, 0.15, 0.45, 0.85]) {
      const ref = trafficReferenceLength(d);
      expect(carCount(d, ref)).toBe(carCount(d));
      expect(carCount(d, ref * 2)).toBe(Math.round((20 + 60 * d) * 2));
    }
    // 0-0: 3256 segmenti contro i 2260 di riferimento, 29 → 42 veicoli.
    expect(carCount(0.15, 3256)).toBe(42);
  });

  test('HARD has 1.6 times the cars of NORMAL', () => {
    expect(carCount(0.15, 3256, 'hard')).toBe(67);
    expect(carCount(0.85, 3660, 'hard')).toBe(164);
    expect(carCount(0.85, 3660, 'normal')).toBe(102);
  });
});

describe('spawnTraffic (spec §6)', () => {
  const stage = DEMO_STAGES[0];

  test('it spawns as many cars as trafficCountFor says', () => {
    const cars = spawnTraffic(buildTrack(stage), stage);
    expect(cars).toHaveLength(trafficCountFor(stage));
  });

  test('HARD spawns 1.6 times the cars, 10 per cent faster', () => {
    const track = buildTrack(stage);
    const normal = spawnTraffic(track, stage);
    const hard = spawnTraffic(track, { ...stage, mode: 'hard' });
    expect(hard).toHaveLength(Math.round(normal.length * 1.6));
    for (const c of hard) {
      const base = MAX_SPEED * TRAFFIC_SPEEDS[c.name] * 1.1;
      expect(c.speed, `car ${c.id}`).toBeGreaterThanOrEqual(base * (1 - SPEED_JITTER) - 1e-9);
      expect(c.speed, `car ${c.id}`).toBeLessThanOrEqual(base * (1 + SPEED_JITTER) + 1e-9);
    }
  });

  test('the same seed gives exactly the same cars', () => {
    const a = spawnTraffic(buildTrack(stage), stage);
    const b = spawnTraffic(buildTrack(stage), stage);
    expect(b).toEqual(a);
  });

  test('a different seed gives different cars', () => {
    const a = spawnTraffic(buildTrack(stage), stage);
    const other = { ...stage, seed: stage.seed + 1 };
    const b = spawnTraffic(buildTrack(other), other);
    expect(b).not.toEqual(a);
  });

  test('every offset sits in a lane, within the noise of its vehicle', () => {
    for (const c of spawnTraffic(buildTrack(stage), stage)) {
      const lane = LANES_X[laneOf(c.offset)];
      const noise = laneNoiseFor(c.name, stage.lanes ?? 4, stage.roadHalf ?? 1);
      expect(Math.abs(c.offset - lane), `car ${c.id}`).toBeLessThanOrEqual(noise + 1e-12);
      expect(noise).toBeLessThanOrEqual(LANE_NOISE);
    }
  });

  test('every speed is the type fraction of maxSpeed, within 10 per cent', () => {
    for (const c of spawnTraffic(buildTrack(stage), stage)) {
      const base = MAX_SPEED * TRAFFIC_SPEEDS[c.name];
      expect(c.speed, `car ${c.id}`).toBeGreaterThanOrEqual(base * (1 - SPEED_JITTER) - 1e-9);
      expect(c.speed, `car ${c.id}`).toBeLessThanOrEqual(base * (1 + SPEED_JITTER) + 1e-9);
    }
  });

  test('no car sits in the traffic free start (start line and fork exit road) or in the fork zone', () => {
    const track = buildTrack(stage);
    const zoneStart = track.length - FORK_ZONE_SEGMENTS;
    for (const c of spawnTraffic(track, stage)) {
      const i = segmentIndexOf(c.z, track.length);
      expect(i, `car ${c.id}`).toBeGreaterThanOrEqual(TRAFFIC_FREE_START);
      expect(i, `car ${c.id}`).toBeLessThan(zoneStart);
    }
  });

  test('the free start is long enough to be worth having: 360 segments, as long as the fork exit road (terzo addendum del collaudo)', () => {
    expect(TRAFFIC_FREE_START * SEGMENT_LENGTH).toBeGreaterThanOrEqual(3 * MAX_SPEED);
    // Deroga (terzo addendum): FORK_EXIT_SEGMENTS 150→360 vince ora su
    // 3 * INTRO_SEGMENTS (180), non più il contrario.
    expect(TRAFFIC_FREE_START).toBeGreaterThan(3 * INTRO_SEGMENTS);
    expect(TRAFFIC_FREE_START).toBe(FORK_EXIT_SEGMENTS);
  });

  test('the first quarter of the spawn zone holds about half the density of the rest', () => {
    const track = buildTrack(stage);
    const cars = spawnTraffic(track, stage);
    const from = TRAFFIC_FREE_START;
    const to = track.length - FORK_ZONE_SEGMENTS;
    const knee = from + (to - from) * EASY_START_FRACTION;
    const early = cars.filter((c) => segmentIndexOf(c.z, track.length) < knee).length;
    // Densità dimezzata su un quarto: la quota attesa è
    // 0.5 * 0.25 / (0.5 * 0.25 + 0.75) = 1/7 dei veicoli, non 1/4.
    const expected =
      (EASY_START_DENSITY * EASY_START_FRACTION) /
      (EASY_START_DENSITY * EASY_START_FRACTION + (1 - EASY_START_FRACTION));
    const share = early / cars.length;
    expect(share).toBeGreaterThan(expected - 0.06);
    expect(share).toBeLessThan(expected + 0.06);
    // e in ogni caso meno della quota uniforme
    expect(share).toBeLessThan(EASY_START_FRACTION);
  });

  test('a track shorter than the free start plus the fork zone still spawns inside itself', () => {
    // Nessuna tappa del gioco è così corta, ma `spawnTraffic` non deve
    // uscire dall'array di segmenti nemmeno su un tracciato minimo: la
    // deroga ha allungato la zona libera e i due limiti si toccano.
    const track = makeFlatTrack(200);
    const tiny = { ...stage, lengthSegments: 200 };
    const cars = spawnTraffic(track, tiny);
    expect(cars).toHaveLength(trafficCountFor(tiny));
    for (const c of cars) {
      const i = segmentIndexOf(c.z, track.length);
      expect(i, `car ${c.id}`).toBeGreaterThanOrEqual(0);
      expect(i, `car ${c.id}`).toBeLessThan(track.length);
    }
  });

  test('every car is bucketed in the segment that holds its z', () => {
    const track = buildTrack(stage);
    const cars = spawnTraffic(track, stage);
    let bucketed = 0;
    for (const seg of track) {
      for (const c of seg.cars) {
        expect(segmentIndexOf(c.z, track.length)).toBe(seg.index);
        expect(c.percent).toBeGreaterThanOrEqual(0);
        expect(c.percent).toBeLessThan(1);
        bucketed++;
      }
    }
    expect(bucketed).toBe(cars.length);
  });

  test('ids are unique', () => {
    const cars = spawnTraffic(buildTrack(stage), stage);
    expect(new Set(cars.map((c) => c.id)).size).toBe(cars.length);
  });
});

describe('lanes', () => {
  test('laneOf snaps an offset to the nearest of the four lanes', () => {
    expect(laneOf(-0.7)).toBe(0);
    expect(laneOf(-0.1)).toBe(1);
    expect(laneOf(0.2)).toBe(2);
    expect(laneOf(0.6)).toBe(3);
    expect(laneOf(5)).toBe(3);
    expect(laneOf(-5)).toBe(0);
  });

  test('the four lane centres are the ones of the spec', () => {
    expect([...LANES_X]).toEqual([-0.75, -0.25, 0.25, 0.75]);
  });

  test('escapeLane prefers the left free lane and gives up when boxed in', () => {
    expect(escapeLane(1, [false, false, false, false])).toBe(1);
    expect(escapeLane(1, [false, true, false, false])).toBe(0);
    expect(escapeLane(1, [true, true, false, false])).toBe(2);
    expect(escapeLane(0, [true, false, false, false])).toBe(1);
    expect(escapeLane(3, [false, false, false, true])).toBe(2);
    expect(escapeLane(1, [true, true, true, true])).toBe(1);
  });

  test('moveToward never overshoots the target', () => {
    expect(moveToward(-0.66, 0, 0.5)).toBeCloseTo(-0.16, 10);
    expect(moveToward(-0.1, 0, 0.5)).toBe(0);
    expect(moveToward(0.66, 0, 0.5)).toBeCloseTo(0.16, 10);
  });
});

describe('lane avoidance (spec §6)', () => {
  const setup = (slowAt: number): { track: Segment[]; fast: Car; slow: Car } => {
    const track = makeFlatTrack(60);
    const fast = car({ id: 1, offset: LANES_X[0], z: 10 * SEGMENT_LENGTH, speed: 4000 });
    const slow = car({
      id: 2,
      name: 'traffic_truck',
      offset: LANES_X[0],
      z: slowAt * SEGMENT_LENGTH,
      speed: 1000,
    });
    bucketCars(track, [fast, slow]);
    return { track, fast, slow };
  };

  test('a slower car within 20 segments blocks its lane', () => {
    const { track, fast } = setup(20);
    expect(blockedLanes(track, fast)).toEqual([true, false, false, false]);
  });

  test('a slower car further than 20 segments does not block', () => {
    const { track, fast } = setup(31);
    expect(blockedLanes(track, fast)).toEqual([false, false, false, false]);
  });

  test('a blocked car moves toward the free lane at dt * 0.5', () => {
    const { track, fast } = setup(20);
    expect(avoidOffset(track, fast, 1)).toBeCloseTo(-0.25, 10);
    expect(avoidOffset(track, fast, DT)).toBeCloseTo(LANES_X[0] + 0.5 * DT, 10);
  });

  test('a car with a clear lane keeps its offset, noise included', () => {
    const { track, slow } = setup(20);
    slow.offset = LANES_X[0] + 0.07;
    expect(avoidOffset(track, slow, 1)).toBe(LANES_X[0] + 0.07);
  });

  test('a faster car ahead does not make anyone change lane', () => {
    const track = makeFlatTrack(60);
    const back = car({ id: 1, offset: LANES_X[1], z: 10 * SEGMENT_LENGTH, speed: 2000 });
    const front = car({ id: 2, offset: LANES_X[1], z: 15 * SEGMENT_LENGTH, speed: 5000 });
    bucketCars(track, [back, front]);
    expect(avoidOffset(track, back, 1)).toBe(LANES_X[1]);
  });

  test('a slower car behind in the same segment is ignored', () => {
    const track = makeFlatTrack(60);
    const front = car({ id: 1, offset: LANES_X[1], z: 10 * SEGMENT_LENGTH + 150, speed: 5000 });
    const back = car({ id: 2, offset: LANES_X[1], z: 10 * SEGMENT_LENGTH + 10, speed: 1000 });
    bucketCars(track, [front, back]);
    expect(blockedLanes(track, front)).toEqual([false, false, false, false]);
  });
});

describe('spawnCurve (deroga alla spec §6)', () => {
  test('it maps the whole zone: 0 to 0 and 1 to 1', () => {
    expect(spawnCurve(0)).toBeCloseTo(0, 12);
    expect(spawnCurve(1)).toBeCloseTo(1, 12);
  });

  test('it is increasing, so cars keep the order the loop places them in', () => {
    let previous = -1;
    for (let i = 0; i <= 200; i++) {
      const value = spawnCurve(i / 200);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  test('it is continuous at the knee: both branches agree there', () => {
    const uKnee =
      (EASY_START_DENSITY * EASY_START_FRACTION) /
      (EASY_START_DENSITY * EASY_START_FRACTION + (1 - EASY_START_FRACTION));
    expect(spawnCurve(uKnee)).toBeCloseTo(EASY_START_FRACTION, 12);
    expect(spawnCurve(uKnee - 1e-9)).toBeCloseTo(EASY_START_FRACTION, 8);
    expect(spawnCurve(uKnee + 1e-9)).toBeCloseTo(EASY_START_FRACTION, 8);
  });

  test('the early stretch is stretched and the rest is compressed a little', () => {
    // Nel primo tratto la pendenza è 1/mass/d = 1.75, oltre è mass = 0.875.
    expect(spawnCurve(0.05) / 0.05).toBeCloseTo(1.75, 6);
    expect(spawnCurve(0.9) - spawnCurve(0.8)).toBeCloseTo(0.0875, 6);
  });

  test('out of range values are clamped instead of leaving the zone', () => {
    expect(spawnCurve(-1)).toBe(0);
    expect(spawnCurve(2)).toBeCloseTo(1, 12);
  });
});
