import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { DEMO_STAGES } from '../../src/game/demo-graph';
import { initialPlayer, MAX_SPEED } from '../../src/game/player';
import { buildTrack, FORK_ZONE_SEGMENTS } from '../../src/game/track';
import {
  bucketCars,
  CAR_CRASH_MIN_PERCENT,
  checkCollisions,
  hitSide,
  LANES_X,
  PLAYER_COLLIDE_W,
  PUSH_MARGIN,
  pushToCentre,
  segmentIndexOf,
  spawnTraffic,
  stepTraffic,
  TRAFFIC_FREE_START,
} from '../../src/game/traffic';
import { SEGMENT_LENGTH } from '../../src/render/project';
import type { Car, PlayerState, Segment } from '../../src/types';
import { makeFlatTrack, makeSegment } from '../helpers/segments';

const DT = 1 / 60;
const player = (over: Partial<PlayerState> = {}): PlayerState => ({ ...initialPlayer(), ...over });
const car = (over: Partial<Car> = {}): Car => ({
  id: 1,
  name: 'traffic_sedan',
  offset: 0,
  z: 0,
  speed: 1000,
  percent: 0,
  ...over,
});

describe('stepTraffic (spec §6, §8)', () => {
  test('cars move forward by speed * dt and get re-bucketed', () => {
    const track = makeFlatTrack(60);
    const c = car({ offset: LANES_X[2], z: 0, speed: 6000 });
    bucketCars(track, [c]);
    expect(track[0].cars).toHaveLength(1);
    stepTraffic(track, [c], 0.1, 0);
    expect(c.z).toBeCloseTo(600, 10);
    expect(track[0].cars).toHaveLength(0);
    expect(track[3].cars).toEqual([c]);
    expect(c.percent).toBeCloseTo(0, 10);
  });

  test('a car passed by the player counts as one overtake', () => {
    const track = makeFlatTrack(60);
    const c = car({ offset: LANES_X[2], z: 100, speed: 0 });
    bucketCars(track, [c]);
    expect(stepTraffic(track, [c], DT, 150, 50)).toBe(1);
  });

  test('the same car is not counted twice', () => {
    const track = makeFlatTrack(60);
    const c = car({ offset: LANES_X[2], z: 100, speed: 0 });
    bucketCars(track, [c]);
    expect(stepTraffic(track, [c], DT, 150, 50)).toBe(1);
    expect(stepTraffic(track, [c], DT, 250, 150)).toBe(0);
  });

  test('a car that stays ahead is not an overtake', () => {
    const track = makeFlatTrack(60);
    const c = car({ offset: LANES_X[2], z: 1000, speed: 3000 });
    bucketCars(track, [c]);
    expect(stepTraffic(track, [c], DT, 150, 50)).toBe(0);
  });

  test('a car counts as overtaken even if it changes lane in the same tick', () => {
    const track = makeFlatTrack(60);
    const slow = car({ id: 1, offset: LANES_X[1], z: 120, speed: 500 });
    const slower = car({ id: 2, name: 'traffic_truck', offset: LANES_X[1], z: 2000, speed: 100 });
    bucketCars(track, [slow, slower]);
    expect(stepTraffic(track, [slow, slower], DT, 300, 50)).toBe(1);
    // Il veicolo sorpassato ha davvero cambiato corsia in quel tick.
    expect(slow.offset).not.toBe(LANES_X[1]);
  });

  test('without a previous z the traffic still moves and reports no overtake', () => {
    const track = makeFlatTrack(60);
    const c = car({ offset: LANES_X[2], z: 100, speed: 600 });
    bucketCars(track, [c]);
    expect(stepTraffic(track, [c], 0.1, 150)).toBe(0);
    expect(c.z).toBeCloseTo(160, 10);
  });

  test('a car reaching the fork zone recycles before the intro, not an overtake', () => {
    // Con un tracciato piccolo la zona di bivio (320 segmenti, brief del
    // controllore: deroga di geometria) copre quasi tutta la tappa se questa
    // resta a 500: qui ne serve uno grande abbastanza da avere un vero
    // rettilineo di traffico fra intro e bivio, come una tappa reale.
    const track = makeFlatTrack(900);
    const boundary = (900 - FORK_ZONE_SEGMENTS) * SEGMENT_LENGTH;
    const c = car({ offset: LANES_X[2], z: boundary - 50, speed: 6000 });
    bucketCars(track, [c]);
    expect(stepTraffic(track, [c], 0.1, 500, 400)).toBe(0);
    // Non avvolge a inizio tracciato (issue #4 della revisione E): si ricicla
    // subito dopo la zona libera dal traffico (rettilineo di partenza e
    // strada dell'uscita dal bivio, spec §4.4: TRAFFIC_FREE_START segmenti),
    // alla stessa distanza dal bivio che avrebbe avuto wrappando da 0.
    expect(c.z).toBeCloseTo(TRAFFIC_FREE_START * SEGMENT_LENGTH + 550, 10);
  });

  test('a car reaching the fork zone is recycled, never left inside it', () => {
    const track = makeFlatTrack(900);
    const zoneStart = 900 - FORK_ZONE_SEGMENTS;
    const c = car({ offset: LANES_X[2], z: zoneStart * SEGMENT_LENGTH - 50, speed: 6000 });
    bucketCars(track, [c]);
    stepTraffic(track, [c], 0.1, 0, 0);
    expect(segmentIndexOf(c.z, track.length)).toBeLessThan(zoneStart);
    expect(segmentIndexOf(c.z, track.length)).toBeGreaterThanOrEqual(TRAFFIC_FREE_START);
  });

  test('a car far ahead on the other side of the track is not an overtake', () => {
    const track = makeFlatTrack(60);
    const len = 60 * SEGMENT_LENGTH;
    const c = car({ offset: LANES_X[2], z: len / 2 - 50, speed: 6000 });
    bucketCars(track, [c]);
    expect(stepTraffic(track, [c], 0.1, 200, 100)).toBe(0);
  });

  test('a long run keeps every car inside the track and inside a bucket', () => {
    const stage = DEMO_STAGES[0];
    const track = buildTrack(stage);
    const cars = spawnTraffic(track, stage);
    const trackLength = track.length * SEGMENT_LENGTH;
    for (let i = 0; i < 400; i++) stepTraffic(track, cars, DT, (i * 500) % trackLength);
    for (const c of cars) {
      expect(c.z, `car ${c.id}`).toBeGreaterThanOrEqual(0);
      expect(c.z, `car ${c.id}`).toBeLessThan(trackLength);
      expect(track[segmentIndexOf(c.z, track.length)].cars, `car ${c.id}`).toContain(c);
    }
    expect(track.reduce((n, s) => n + s.cars.length, 0)).toBe(cars.length);
  });

  test('the fork zone stays free of traffic over a long run (issue #2 of the E review)', () => {
    const stage = DEMO_STAGES[0];
    const track = buildTrack(stage);
    const cars = spawnTraffic(track, stage);
    const trackLength = track.length * SEGMENT_LENGTH;
    const zoneStart = track.length - FORK_ZONE_SEGMENTS;
    for (let i = 0; i < 2000; i++) {
      stepTraffic(track, cars, DT, (i * 500) % trackLength);
      for (const c of cars) {
        expect(segmentIndexOf(c.z, track.length), `car ${c.id} at tick ${i}`).toBeLessThan(zoneStart);
      }
      for (let seg = zoneStart; seg < track.length; seg++) {
        expect(track[seg].cars, `segment ${seg} at tick ${i}`).toHaveLength(0);
      }
    }
  }, 15000); // la zona (320 segmenti, brief del controllore) allunga il doppio ciclo interno
});

describe('hitSide and pushToCentre (spec §6, §7)', () => {
  test('the side is the side the object sits on', () => {
    expect(hitSide(0, 0.5)).toBe(1);
    expect(hitSide(0, -0.5)).toBe(-1);
    expect(hitSide(0.5, 0.5)).toBe(0);
  });

  test('an object on the right pushes the player left, and the other way round', () => {
    expect(pushToCentre(1.4, 0.3, 1.5, 0.3)).toBeCloseTo(1.2, 10);
    expect(pushToCentre(-1.4, 0.3, -1.5, 0.3)).toBeCloseTo(-1.2, 10);
  });

  test('a player already clear of the object is not moved', () => {
    expect(pushToCentre(0.5, 0.3, 1.5, 0.3)).toBe(0.5);
  });

  test('an object in the middle of the road is not crossed, and pushes towards the player\'s own side', () => {
    // Addendum E (fork-bug-report-2): fermarsi esattamente al bordo della
    // fascia di collisione lasciava il giocatore lì, pronto a rientrare
    // nella barriera centrale successiva; PUSH_MARGIN aggiunge un margine.
    expect(pushToCentre(-0.1, 0.3, 0, 0.18)).toBeCloseTo(-0.24 - PUSH_MARGIN, 10);
    expect(pushToCentre(0.1, 0.3, 0, 0.18)).toBeCloseTo(0.24 + PUSH_MARGIN, 10);
    // x = 0 esatto: verso destra, non verso il centro (il "centro" qui non
    // esiste, l'oggetto e' gia' al centro).
    expect(pushToCentre(0, 0.3, 0, 0.18)).toBeCloseTo(0.24 + PUSH_MARGIN, 10);
  });

  test('the margin is at least 0.05 (addendum E)', () => {
    expect(PUSH_MARGIN).toBeGreaterThanOrEqual(0.05);
  });
});

describe('checkCollisions against cars (spec §6)', () => {
  const segWithCar = (over: Partial<Car> = {}): Segment =>
    makeSegment(0, { cars: [car({ offset: 0, z: 10, ...over })] });

  test('no overlap, no collision', () => {
    const hit = checkCollisions(player({ x: 0.9, speed: 9000, z: 50 }), segWithCar());
    expect(hit.kind).toBe('none');
  });

  test('fast and much faster than the car is a crash, on both sides', () => {
    const right = checkCollisions(player({ x: -0.1, speed: 5000, z: 50 }), segWithCar());
    expect(right.kind).toBe('crash');
    expect(right.side).toBe(1);
    const left = checkCollisions(player({ x: 0.1, speed: 5000, z: 50 }), segWithCar());
    expect(left.kind).toBe('crash');
    expect(left.side).toBe(-1);
  });

  test('at exactly 40 per cent of maxSpeed it is a bump, not a crash', () => {
    const fast = player({ x: 0, speed: MAX_SPEED * CAR_CRASH_MIN_PERCENT, z: 50 });
    expect(checkCollisions(fast, segWithCar()).kind).toBe('bump');
  });

  test('fast enough but not 1.3 times the car speed is a bump', () => {
    const hit = checkCollisions(player({ x: 0, speed: 5000, z: 50 }), segWithCar({ speed: 5000 / 1.3 }));
    expect(hit.kind).toBe('bump');
  });

  test('a bump drops to 80 per cent of the car speed and goes back one segment', () => {
    const hit = checkCollisions(player({ x: 0, speed: 1200, z: 50 }), segWithCar({ speed: 1000 }));
    expect(hit.kind).toBe('bump');
    expect(hit.speed).toBeCloseTo(800, 10);
    expect(hit.z).toBeCloseTo(50 - SEGMENT_LENGTH, 10);
    expect(hit.x).toBe(0);
  });

  test('a bike is narrow enough to be dodged where a truck is not', () => {
    const wide = checkCollisions(player({ x: 0.12, speed: 1200, z: 50 }), segWithCar({ name: 'traffic_truck' }));
    expect(wide.kind).toBe('bump');
    const narrow = checkCollisions(player({ x: 0.12, speed: 1200, z: 50 }), segWithCar({ name: 'traffic_bike' }));
    expect(narrow.kind).toBe('none');
  });

  test('an unknown car name never collides and never throws', () => {
    const hit = checkCollisions(player({ x: 0, speed: 9000, z: 50 }), segWithCar({ name: 'nope' }));
    expect(hit.kind).toBe('none');
  });
});

describe('the bump latch (issue #1 of the E review)', () => {
  test('one physical bump on a single moving car produces exactly one bump event', () => {
    // Riproduce esattamente il bug della revisione: il pushback è di un solo
    // segmento, il giocatore avanza meno di un segmento per tick dopo
    // l'urto, e l'auto tamponata si muove troppo poco per lasciare il
    // segmento nel frattempo. Senza il fermo (`ignoreCarId`) il giocatore
    // rientra nello stesso segmento al tick dopo e viene tamponato di nuovo
    // dalla stessa identica auto.
    const track = makeFlatTrack(60);
    const bumpCar = car({ id: 7, offset: 0, z: 10 * SEGMENT_LENGTH, speed: 1000 });
    bucketCars(track, [bumpCar]);

    // Il giocatore arriva alla fine del segmento dell'auto: dopo il pushback
    // di un segmento intero la posizione nel nuovo segmento resta alla
    // stessa frazione (~0.975), quindi il piccolo avanzamento del tick dopo
    // (0.1 segmenti) è più che sufficiente a farlo rientrare nel segmento
    // dell'auto, che nel frattempo si è spostata troppo poco per uscirne.
    let playerZ = 10 * SEGMENT_LENGTH + 175;
    let playerSpeed = 1200;
    let bumpedCarId: number | undefined;
    let bumps = 0;

    // Solo la finestra immediatamente dopo l'urto: quanto basta a coprire i
    // due tick del bug (spinta indietro, poi il rientro nello stesso
    // segmento), non l'intero tragitto fino a un eventuale nuovo incontro
    // più avanti, che sarebbe un contatto fisico diverso e legittimo.
    for (let tick = 0; tick < 6; tick++) {
      playerZ += playerSpeed * DT;
      stepTraffic(track, [bumpCar], DT, playerZ);
      const seg = track[segmentIndexOf(playerZ, track.length)];
      if (bumpedCarId !== undefined && !seg.cars.some((c) => c.id === bumpedCarId)) {
        bumpedCarId = undefined;
      }
      const hit = checkCollisions(player({ x: 0, speed: playerSpeed, z: playerZ }), seg, bumpedCarId);
      if (hit.kind === 'bump') {
        bumps++;
        bumpedCarId = hit.carId;
        playerSpeed = hit.speed;
        playerZ = Math.max(0, hit.z);
      }
    }

    expect(bumps).toBe(1);
  });
});

describe('checkCollisions against scenery (spec §6)', () => {
  const palmSeg = (offset = 1.5): Segment =>
    makeSegment(0, { sprites: [{ name: 'beach_palm_1', offset }] });

  test('above 15 per cent of maxSpeed it is a crash, on both sides', () => {
    const right = checkCollisions(player({ x: 1.4, speed: MAX_SPEED * 0.2, z: 50 }), palmSeg(1.5));
    expect(right.kind).toBe('crash');
    expect(right.side).toBe(1);
    const left = checkCollisions(player({ x: -1.4, speed: MAX_SPEED * 0.2, z: 50 }), palmSeg(-1.5));
    expect(left.kind).toBe('crash');
    expect(left.side).toBe(-1);
  });

  test('at exactly 15 per cent it stops and is pushed toward the centre', () => {
    const hit = checkCollisions(player({ x: 1.4, speed: MAX_SPEED * 0.15, z: 50 }), palmSeg(1.5));
    expect(hit.kind).toBe('stop');
    expect(hit.speed).toBe(0);
    expect(hit.x).toBeLessThan(1.4);
    expect(hit.z).toBe(50);
  });

  test('a non solid sprite is never hit', () => {
    const seg = makeSegment(0, { sprites: [{ name: 'beach_bush', offset: 1.5 }] });
    expect(CATALOG.beach_bush.solid).toBe(false);
    expect(checkCollisions(player({ x: 1.5, speed: 9000 }), seg).kind).toBe('none');
  });

  test('the fork barriers stop anyone driving down the middle', () => {
    const seg = makeSegment(0, { sprites: [{ name: 'common_barrier', offset: 0 }] });
    const hit = checkCollisions(player({ x: 0, speed: MAX_SPEED * 0.5, z: 50 }), seg);
    expect(hit.kind).toBe('crash');
  });

  test('driving in a lane clears the fork barriers', () => {
    const seg = makeSegment(0, { sprites: [{ name: 'common_barrier', offset: 0 }] });
    const hit = checkCollisions(player({ x: LANES_X[2], speed: MAX_SPEED * 0.5, z: 50 }), seg);
    expect(hit.kind).toBe('none');
  });

  test('a car on the segment wins over a sprite on the same segment', () => {
    const seg = makeSegment(0, {
      cars: [car({ offset: 0, speed: 1000 })],
      sprites: [{ name: 'beach_palm_1', offset: 0 }],
    });
    expect(checkCollisions(player({ x: 0, speed: 1200, z: 50 }), seg).kind).toBe('bump');
  });

  test('the player hitbox is the sedan width', () => {
    expect(PLAYER_COLLIDE_W).toBe(CATALOG.traffic_sedan.collideW);
  });
});
