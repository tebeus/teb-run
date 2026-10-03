import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import {
  ALL_CARS,
  CARS,
  carFromSearch,
  carsFor,
  carLabel,
  DEFAULT_CAR,
  endingSpriteFor,
  nextCar,
  parseCar,
  playerFrame,
  playerPrefix,
} from '../../src/game/car';
import { initialPlayer } from '../../src/game/player';
import { DEMO_STAGE } from '../../src/game/demo-stage';
import { CAR_KEY, createCarSetting } from '../../src/persist/car';
import type { StorageLike } from '../../src/persist/scores';
import { playerCarSize, playerFrameName } from '../../src/render/world';
import type { CarChoice, RaceSnapshot } from '../../src/types';
import { makeAsset } from '../helpers/segments';
import targetsJson from '../../tools/sprite-targets.json';
import { NO_ART } from '../helpers/art';

const FRAMES = ['straight', 'left1', 'left2', 'right1', 'right2', 'brake', 'spin_0', 'spin_1', 'spin_2', 'spin_3'];
const targets = targetsJson as Record<string, { w: number; h: number }>;
const manifest = JSON.parse(readFileSync('public/sprites/manifest.json', 'utf8')) as Record<
  string,
  { w: number; h: number }
>;

const snapshot = (over: Partial<RaceSnapshot> = {}): RaceSnapshot => ({
  segments: [],
  player: initialPlayer(),
  crash: { active: false, t: 0, frame: 0 },
  timeLeft: 99,
  score: 0,
  stage: DEMO_STAGE,
  level: 0,
  route: [],
  parallax: { far: 0, near: 0, y: 0 },
  theme: 'beach',
  banner: 'none',
  kmh: 0,
  ...over,
});

/** Storage finto in memoria, con la possibilità di farlo lanciare. */
function fakeStorage(start: Record<string, string> = {}, throws = false): StorageLike & { data: Record<string, string> } {
  const data = { ...start };
  return {
    data,
    getItem: (k) => {
      if (throws) throw new Error('blocked');
      return data[k] ?? null;
    },
    setItem: (k, v) => {
      if (throws) throw new Error('blocked');
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('?car= e la scelta dell\'auto (Set 7)', () => {
  test('only new, classic, retro, sport and super are accepted, anything else is null', () => {
    expect(parseCar('new')).toBe('new');
    expect(parseCar('classic')).toBe('classic');
    expect(parseCar('retro')).toBe('retro');
    expect(parseCar('sport')).toBe('sport');
    expect(parseCar('super')).toBe('super');
    for (const v of ['', 'Classic', 'Retro', 'Super', 'old', null, undefined, 'new ']) expect(parseCar(v), String(v)).toBeNull();
  });

  test('carFromSearch reads the query string', () => {
    expect(carFromSearch('?car=retro')).toBe('retro');
    expect(carFromSearch('?car=sport')).toBe('sport');
    expect(carFromSearch('?car=super')).toBe('super');
    expect(carFromSearch('?car=classic')).toBe('classic');
    expect(carFromSearch('?stage=2-1&car=new')).toBe('new');
    expect(carFromSearch('?car=nonexistent')).toBeNull();
    expect(carFromSearch('')).toBeNull();
  });

  test('the default is the new car, C cycles new, classic, retro, sport, super, the label is in the game font alphabet', () => {
    expect(DEFAULT_CAR).toBe('new');
    expect(CARS).toEqual(['new', 'classic', 'retro', 'sport', 'super']);
    expect(nextCar('new')).toBe('classic');
    expect(nextCar('classic')).toBe('retro');
    expect(nextCar('retro')).toBe('sport');
    expect(nextCar('sport')).toBe('super');
    expect(nextCar('super')).toBe('new');
    expect(carLabel('new')).toBe('CAR: NEW');
    expect(carLabel('classic')).toBe('CAR: CLASSIC');
    expect(carLabel('retro')).toBe('CAR: RETRO');
    expect(carLabel('sport')).toBe('CAR: SPORT');
    expect(carLabel('super')).toBe('CAR: SUPER');
  });

  test('each car has its prefix, and every frame name is in the catalog', () => {
    expect(playerPrefix('new')).toBe('player_');
    expect(playerPrefix('classic')).toBe('player_classic_');
    expect(playerPrefix('retro')).toBe('player_retro_');
    expect(playerPrefix('sport')).toBe('player_sport_');
    expect(playerPrefix('super')).toBe('player_super_');
    for (const car of CARS) {
      for (const f of FRAMES) expect(CATALOG[playerFrame(car, f)], `${car} ${f}`).toBeDefined();
    }
  });

  test('playerFrameName adds the prefix of the chosen car', () => {
    expect(playerFrameName(snapshot())).toBe('player_straight');
    expect(playerFrameName(snapshot(), 'retro')).toBe('player_retro_straight');
    const steer = snapshot({ player: { ...initialPlayer(), steer: -2 } });
    expect(playerFrameName(steer, 'retro')).toBe('player_retro_left2');
    const right = snapshot({ player: { ...initialPlayer(), steer: 1 } });
    expect(playerFrameName(right, 'sport')).toBe('player_sport_right1');
    const brake = snapshot({ player: { ...initialPlayer(), braking: true } });
    expect(playerFrameName(brake, 'sport')).toBe('player_sport_brake');
    const crash = snapshot({ crash: { active: true, t: 0.1, frame: 3 } });
    expect(playerFrameName(crash, 'retro')).toBe('player_retro_spin_3');
    expect(playerFrameName(crash, 'classic')).toBe('player_classic_spin_3');
    expect(playerFrameName(crash, 'new')).toBe('player_spin_3');
    expect(playerFrameName(steer, 'super')).toBe('player_super_left2');
  });

  test('the classic car has its own endings 1-5', () => {
    expect(endingSpriteFor('new', 'ending_3')).toBe('ending_3');
    expect(endingSpriteFor('classic', 'ending_3')).toBe('ending_classic_3');
    expect(endingSpriteFor('classic', 'ending_1')).toBe('ending_classic_1');
    for (const n of [1, 2, 3, 4, 5]) expect(CATALOG[`ending_classic_${n}`]).toBeDefined();
  });

  test('retro, sport and super use the Set 7 endings, or their own ending_<car>_N when it exists', () => {
    const inCatalog = (n: string): boolean => CATALOG[n] !== undefined;
    for (const car of ['new', 'retro', 'sport', 'super'] as CarChoice[]) {
      for (const n of [1, 2, 3, 4, 5]) expect(endingSpriteFor(car, `ending_${n}`, inCatalog), car).toBe(`ending_${n}`);
    }
    for (const n of [1, 2, 3, 4, 5]) expect(endingSpriteFor('classic', `ending_${n}`, inCatalog)).toBe(`ending_classic_${n}`);
    expect(endingSpriteFor('retro', 'ending_3')).toBe('ending_3');
    expect(endingSpriteFor('retro', 'ending_3', () => true)).toBe('ending_retro_3');
    expect(endingSpriteFor('sport', 'ending_1', () => true)).toBe('ending_sport_1');
    expect(endingSpriteFor('new', 'ending_3', () => true)).toBe('ending_3');
    expect(endingSpriteFor('sport', 'ending_border', () => true)).toBe('ending_border');
  });

});

describe('le cinque serie di frame hanno la stessa misura a schermo', () => {
  test.skipIf(NO_ART)('both series are complete in the manifest and the targets, with the same catalog scale', () => {
    for (const car of CARS) {
      for (const f of FRAMES) {
        const n = playerFrame(car, f);
        expect(manifest[n], n).toBeDefined();
        expect(targets[n], n).toBeDefined();
        expect(CATALOG[n].scale, n).toBe(CATALOG.player_straight.scale);
      }
    }
  });

  test.skipIf(NO_ART)('the straight frames of the five cars are equally wide on screen, 215-245 px on 1280', () => {
    const size = (car: CarChoice): { w: number; h: number } => {
      const n = playerFrame(car, 'straight');
      const a = makeAsset(n, manifest[n].w, manifest[n].h, { kind: 'player', scale: CATALOG[n].scale });
      return playerCarSize(a, a, 1280);
    };
    expect(size('classic').w).toBeCloseTo(size('new').w, 9);
    expect(size('retro').w).toBeCloseTo(size('new').w, 9);
    expect(size('sport').w).toBeCloseTo(size('new').w, 9);
    expect(size('super').w).toBeCloseTo(size('new').w, 9);
    for (const car of CARS) {
      expect(size(car).w, car).toBeGreaterThan(215);
      expect(size(car).w, car).toBeLessThan(245);
    }
  });

  test.skipIf(NO_ART)('every frame of a car is as tall on screen as its straight frame', () => {
    for (const car of CARS) {
      const sn = playerFrame(car, 'straight');
      const straight = makeAsset(sn, manifest[sn].w, manifest[sn].h, { kind: 'player', scale: 0.14 });
      const h = playerCarSize(straight, straight, 1280).h;
      for (const f of FRAMES) {
        const n = playerFrame(car, f);
        const a = makeAsset(n, manifest[n].w, manifest[n].h, { kind: 'player', scale: 0.14 });
        expect(playerCarSize(straight, a, 1280).h, n).toBeCloseTo(h, 9);
      }
    }
  });
});

describe('createCarSetting: la scelta si ricorda', () => {
  test('without anything saved it is the new car, and toggling saves it', () => {
    const storage = fakeStorage();
    const car = createCarSetting(storage);
    expect(car.get()).toBe('new');
    expect(car.toggle()).toBe('classic');
    expect(storage.data[CAR_KEY]).toBe('classic');
    expect(createCarSetting(storage).get()).toBe('classic');
    expect(car.toggle()).toBe('retro');
    expect(car.toggle()).toBe('sport');
    expect(car.toggle()).toBe('super');
    expect(car.toggle()).toBe('new');
  });

  test('?car= wins over the saved choice and is saved', () => {
    const storage = fakeStorage({ [CAR_KEY]: 'sport' });
    expect(createCarSetting(storage, 'new').get()).toBe('new');
    expect(storage.data[CAR_KEY]).toBe('new');
  });

  test('a garbage or unknown value reads as the default', () => {
    expect(createCarSetting(fakeStorage({ [CAR_KEY]: '{"x":1}' })).get()).toBe('new');
    expect(createCarSetting(fakeStorage({ [CAR_KEY]: 'nonexistent' })).get()).toBe('new');
  });

  test('a throwing storage leaves the choice in memory for the session', () => {
    const car = createCarSetting(fakeStorage({}, true));
    expect(car.get()).toBe('new');
    car.set('super');
    expect(car.get()).toBe('super');
    expect(car.toggle()).toBe('new');
  });
});

describe('la classica solo nella build privata', () => {
  const PUBLIC = carsFor(false);

  test('the private build (and the unit tests) has all five, site and portal have no classic', () => {
    expect(CARS).toEqual(ALL_CARS);
    expect(carsFor(true)).toEqual(['new', 'classic', 'retro', 'sport', 'super']);
    expect(PUBLIC).toEqual(['new', 'retro', 'sport', 'super']);
  });

  test('?car=classic and a saved classic fall back to the new car', () => {
    expect(parseCar('classic', PUBLIC)).toBeNull();
    expect(carFromSearch('?car=classic', PUBLIC)).toBeNull();
    const storage = fakeStorage({ [CAR_KEY]: 'classic' });
    expect(createCarSetting(storage, null, PUBLIC).get()).toBe('new');
    expect(createCarSetting(fakeStorage(), 'classic', PUBLIC).get()).toBe('new');
  });

  test('C skips the classic: new, retro, sport, super, new', () => {
    const car = createCarSetting(fakeStorage(), null, PUBLIC);
    expect([car.toggle(), car.toggle(), car.toggle(), car.toggle()]).toEqual(['retro', 'sport', 'super', 'new']);
    expect(nextCar('new', PUBLIC)).toBe('retro');
  });
});
