import { describe, expect, test } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { STAGE_LIST } from '../../src/game/stages';
import {
  DUAL_MAX,
  DUAL_MIN,
  DUAL_RAMP,
  DUAL_TAIL_GUARD,
  FORK_ZONE_SEGMENTS,
  INTRO_SEGMENTS,
  SECTION_KINDS,
  addKind,
  buildTrack,
  forkMedian,
  forkRoadHalf,
  forkZoneShape,
  laneToRoad,
  sectionWeights,
} from '../../src/game/track';
import { laneCentres, spawnTraffic, stepTraffic } from '../../src/game/traffic';
import type { Segment } from '../../src/types';

/** Il tratto [from, to) in cui `median` è maggiore di zero, se c'è. */
function dualRuns(segs: readonly Segment[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= segs.length; i++) {
    const inside = i < segs.length && segs[i].median > 0;
    if (inside && start < 0) start = i;
    if (!inside && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

describe('laneToRoad (spec §9)', () => {
  test('on a normal road it is the identity', () => {
    for (const o of [-0.85, -0.25, 0, 0.25, 0.75]) {
      expect(laneToRoad(o, 1, 0), `offset ${o}`).toBeCloseTo(o, 12);
    }
  });

  test('on a split road every lane lands inside its own carriageway', () => {
    const rh = 2.8;
    const md = 0.8;
    for (const o of [0.25, 0.75, 0.85]) {
      const x = laneToRoad(o, rh, md);
      expect(x, `offset ${o}`).toBeGreaterThanOrEqual(md);
      expect(x, `offset ${o}`).toBeLessThanOrEqual(rh);
      expect(laneToRoad(-o, rh, md), `offset -${o}`).toBeCloseTo(-x, 12);
    }
  });

  test('the ends of the lane range are the ends of the carriageway', () => {
    expect(laneToRoad(1, 2.8, 0.8)).toBeCloseTo(2.8, 12);
    expect(laneToRoad(-1, 2.8, 0.8)).toBeCloseTo(-2.8, 12);
    expect(laneToRoad(0.5, 2.8, 0.8)).toBeCloseTo(0.8 + 1, 12);
  });

  test('a zero offset goes to the right carriageway, never on the island', () => {
    expect(laneToRoad(0, 2.8, 0.8)).toBeCloseTo(0.8, 12);
    expect(Math.abs(laneToRoad(0, 2.8, 0.8))).toBeGreaterThanOrEqual(0.8);
  });

  test('no lane offset ever maps inside the island', () => {
    for (let i = -20; i <= 20; i++) {
      const o = i / 20;
      expect(Math.abs(laneToRoad(o, 2.8, 0.8)), `offset ${o}`).toBeGreaterThanOrEqual(0.8 - 1e-12);
    }
  });
});

describe('sezione dualRoad (spec §9)', () => {
  test('it is a section kind with a weight that grows with the difficulty', () => {
    expect(SECTION_KINDS).toContain('dualRoad');
    expect(sectionWeights(0).dualRoad).toBeCloseTo(3, 10);
    expect(sectionWeights(1).dualRoad).toBeCloseTo(9, 10);
  });

  test('the ramps are monotone and the island closes again', () => {
    const segs: Segment[] = [];
    addKind(segs, 'town', 'dualRoad', mulberry32(3), 900);
    expect(segs.length).toBeGreaterThanOrEqual(DUAL_MIN);
    expect(segs.length).toBeLessThanOrEqual(DUAL_MAX);
    // Salita, tratto pieno, discesa: la larghezza non torna mai indietro
    // durante la rampa di ingresso, e non risale durante quella di uscita.
    for (let i = 1; i < DUAL_RAMP; i++) {
      expect(segs[i].roadHalf, `ramp in ${i}`).toBeGreaterThanOrEqual(segs[i - 1].roadHalf);
    }
    for (let i = segs.length - DUAL_RAMP + 1; i < segs.length; i++) {
      expect(segs[i].roadHalf, `ramp out ${i}`).toBeLessThanOrEqual(segs[i - 1].roadHalf);
    }
    const last = segs[segs.length - 1];
    expect(last.roadHalf).toBeCloseTo(1, 10);
    expect(last.median).toBe(0);
  });

  test('at full width the road is two complete carriageways', () => {
    const segs: Segment[] = [];
    addKind(segs, 'town', 'dualRoad', mulberry32(3), 900);
    const middle = segs[Math.floor(segs.length / 2)];
    expect(middle.median).toBeCloseTo(0.8, 6);
    // Due carreggiate larghe come la strada di base (qui 1) più l'isola.
    expect(middle.roadHalf).toBeCloseTo(2 * 1 + middle.median, 6);
  });

  test('it is flat and straight: no curve, no climb', () => {
    const segs: Segment[] = [];
    addKind(segs, 'farm', 'dualRoad', mulberry32(11), 900);
    for (const seg of segs) {
      expect(seg.curve).toBe(0);
      expect(seg.p2.world.y).toBe(seg.p1.world.y);
    }
  });

  test('every real stage still closes flat and keeps the fork zone to itself', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const last = segs[segs.length - 1];
      expect(last.curve, stage.id).toBe(0);
      expect(last.p2.world.y, stage.id).toBe(0);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      // Nessun tratto a doppia carreggiata finisce dentro la zona di bivio:
      // là la divisione è quella del bivio, e non si sommano.
      for (const [from, to] of dualRuns(segs)) {
        if (from >= zoneStart) continue; // è la zona di bivio stessa
        expect(to, `${stage.id} run ${from}`).toBeLessThanOrEqual(zoneStart);
      }
    }
  });

  test('the guard keeps the section out of the last 700 segments of the body', () => {
    expect(DUAL_TAIL_GUARD).toBe(700);
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const bodyEnd = segs.length - FORK_ZONE_SEGMENTS;
      for (const [from] of dualRuns(segs)) {
        if (from >= bodyEnd) continue;
        expect(from, `${stage.id} run at ${from}`).toBeLessThanOrEqual(bodyEnd - DUAL_TAIL_GUARD + DUAL_MAX);
      }
    }
  });

  test('it is deterministic from the seed', () => {
    for (const stage of STAGE_LIST) {
      const shape = (segs: Segment[]): string => segs.map((seg) => `${seg.roadHalf}|${seg.median}`).join(';');
      expect(shape(buildTrack(stage)), stage.id).toBe(shape(buildTrack(stage)));
    }
  });
});

describe('il traffico resta sulle carreggiate (spec §9)', () => {
  test('no car sits on the island after two thousand ticks', () => {
    const stage = STAGE_LIST.find((st) => st.theme === 'town') as (typeof STAGE_LIST)[number];
    const segs = buildTrack(stage);
    const cars = spawnTraffic(segs, stage);
    for (let tick = 0; tick < 2000; tick++) {
      stepTraffic(segs, cars, 1 / 60, tick * 100, (tick - 1) * 100);
    }
    let checked = 0;
    for (const seg of segs) {
      if (seg.median <= 0) continue;
      for (const car of seg.cars) {
        checked++;
        const x = laneToRoad(car.offset, seg.roadHalf, seg.median);
        expect(Math.abs(x), `car ${car.id} at ${seg.index}`).toBeGreaterThanOrEqual(seg.median);
        expect(Math.abs(x), `car ${car.id} at ${seg.index}`).toBeLessThanOrEqual(seg.roadHalf);
      }
    }
    // Se il tracciato non ha tratti divisi il test non dimostra niente.
    expect(segs.some((seg) => seg.median > 0)).toBe(true);
    expect(checked).toBeGreaterThan(0);
  });
});

describe('laneCentres (spec §9)', () => {
  test('three lanes are the old centres, four the wide ones', () => {
    expect([...laneCentres(3)]).toEqual([-0.66, 0, 0.66]);
    expect([...laneCentres(4)]).toEqual([-0.75, -0.25, 0.25, 0.75]);
  });

  test('a number of lanes it does not know falls back to four', () => {
    expect(laneCentres(5)).toEqual(laneCentres(4));
    expect(laneCentres(0)).toEqual(laneCentres(4));
  });

  test('every centre is on the asphalt of its own road', () => {
    for (const o of laneCentres(3)) expect(Math.abs(o)).toBeLessThan(0.8);
    for (const o of laneCentres(4)) expect(Math.abs(o)).toBeLessThan(1);
  });
});

describe('larghezza di base per tappa (spec §9)', () => {
  test('a town stage is narrow on every plain segment', () => {
    const town = STAGE_LIST.find((st) => st.theme === 'town') as (typeof STAGE_LIST)[number];
    const segs = buildTrack(town);
    const plain = segs.filter((seg) => seg.median === 0 && seg.fork === undefined);
    expect(plain.length).toBeGreaterThan(1000);
    for (const seg of plain) {
      // Le rampe della doppia carreggiata sono larghe quanto la base o più.
      expect(seg.roadHalf, `segment ${seg.index}`).toBeGreaterThanOrEqual(0.8);
    }
    const straight = segs.slice(0, INTRO_SEGMENTS);
    for (const seg of straight) expect(seg.roadHalf, `segment ${seg.index}`).toBeCloseTo(0.8, 10);
  });

  test('a beach stage keeps the wide road', () => {
    const segs = buildTrack(STAGE_LIST[0]);
    for (const seg of segs.slice(0, INTRO_SEGMENTS)) expect(seg.roadHalf).toBeCloseTo(1, 10);
  });

  test('the fork zone and the dual sections start from the base of the stage', () => {
    const town = STAGE_LIST.find((st) => st.theme === 'town') as (typeof STAGE_LIST)[number];
    const segs = buildTrack(town);
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    expect(segs[zoneStart].roadHalf).toBeCloseTo(0.8, 10);
    const last = segs[segs.length - 1];
    // Bivio v3: due rami larghi come la base, la Y di `forkZoneShape`.
    expect(last.roadHalf - last.median).toBeCloseTo(2 * 0.8, 6);
    expect(last.roadHalf).toBeCloseTo(forkZoneShape(FORK_ZONE_SEGMENTS - 1, 0.8).roadHalf, 6);
  });

  test('forkRoadHalf and forkMedian keep the task 16 numbers with the default base', () => {
    expect(forkRoadHalf(1)).toBeCloseTo(2.8, 12);
    expect(forkMedian(forkRoadHalf(1))).toBeCloseTo(0.8, 12);
    expect(forkRoadHalf(1, 0.8)).toBeCloseTo(2.4, 12);
    expect(forkMedian(forkRoadHalf(1, 0.8), 0.8)).toBeCloseTo(0.8, 12);
    expect(forkMedian(1.4, 0.8)).toBe(0);
  });
});

describe('il traffico di una tappa stretta resta sulla sua strada', () => {
  test('no car leaves the asphalt of a three lane stage', () => {
    const town = STAGE_LIST.find((st) => st.theme === 'town') as (typeof STAGE_LIST)[number];
    const segs = buildTrack(town);
    const cars = spawnTraffic(segs, town);
    expect(cars.length).toBeGreaterThan(0);
    for (const car of cars) {
      expect(Math.abs(car.offset), `car ${car.id}`).toBeLessThanOrEqual(0.66 + 0.1 + 1e-12);
    }
    for (let tick = 0; tick < 2000; tick++) {
      stepTraffic(segs, cars, 1 / 60, tick * 100, (tick - 1) * 100, town.lanes);
    }
    for (const seg of segs) {
      for (const car of seg.cars) {
        const x = laneToRoad(car.offset, seg.roadHalf, seg.median);
        expect(Math.abs(x), `car ${car.id} at ${seg.index}`).toBeLessThanOrEqual(seg.roadHalf + 1e-9);
      }
    }
  });
});
