import { describe, expect, test } from 'vitest';
import {
  applyCrash,
  crashDuration,
  crashPhase,
  crashSpeed,
  CRASH_TIMING,
  crashX,
  noCrash,
  spinFrame,
  startCrash,
  stepCrash,
} from '../../src/game/crash';
import { initialPlayer, MAX_SPEED } from '../../src/game/player';
import { playerFrameName } from '../../src/render/world';
import type { PlayerState, RaceSnapshot } from '../../src/types';

const DT = 1 / 60;
// I casi qui sotto usano i tempi di HARD, rimasti quelli di prima; quelli di
// NORMAL hanno un blocco loro in fondo.
const HARD = CRASH_TIMING.hard;
const SPIN_DURATION = HARD.spin;
const SETTLE_DURATION = HARD.settle;
const SPIN_STOP_TIME = HARD.stop;
const CRASH_DURATION = crashDuration(HARD);
const player = (over: Partial<PlayerState> = {}): PlayerState => ({ ...initialPlayer(), ...over });

describe('crash phases (spec §7)', () => {
  // Deroga (terzo collaudo utente: «finibile solo con una guida quasi
  // perfetta»): era 1,6 s + 0,6 s, ora un incidente costa ~5 s in più.
  test('spin lasts 4.2 s, settle 2.2 s, then it is over', () => {
    expect(SPIN_DURATION).toBe(4.2);
    expect(SETTLE_DURATION).toBe(2.2);
    expect(CRASH_DURATION).toBeCloseTo(6.4, 10);
    expect(crashPhase(0, HARD)).toBe('spin');
    expect(crashPhase(4.19, HARD)).toBe('spin');
    expect(crashPhase(4.2, HARD)).toBe('settle');
    expect(crashPhase(6.39, HARD)).toBe('settle');
    expect(crashPhase(6.4, HARD)).toBe('none');
  });

  test('the spin frames cycle 0,1,2,3 every 0.1 s', () => {
    expect(spinFrame(0)).toBe(0);
    expect(spinFrame(0.05)).toBe(0);
    expect(spinFrame(0.1)).toBe(1);
    expect(spinFrame(0.2)).toBe(2);
    expect(spinFrame(0.3)).toBe(3);
    expect(spinFrame(0.4)).toBe(0);
    expect(spinFrame(1.5)).toBe(3);
  });

  test('the speed reaches zero in 0.8 s and stays there', () => {
    expect(SPIN_STOP_TIME).toBe(0.8);
    expect(crashSpeed(12000, 0, HARD)).toBe(12000);
    expect(crashSpeed(12000, SPIN_STOP_TIME / 2, HARD)).toBeCloseTo(6000, 10);
    expect(crashSpeed(12000, SPIN_STOP_TIME, HARD)).toBe(0);
    expect(crashSpeed(12000, 1.5, HARD)).toBe(0);
    expect(crashSpeed(12000, 4, HARD)).toBe(0);
  });
});

describe('crashX (spec §7)', () => {
  test('a hit on the right pushes the car left, a hit on the left pushes it right', () => {
    expect(crashX(0.5, 1, 0.8, HARD)).toBeLessThan(0.5);
    expect(crashX(-0.5, -1, 0.8, HARD)).toBeGreaterThan(-0.5);
  });

  test('at the end of the spin the car sits on the far side, inside the road', () => {
    expect(crashX(0.5, 1, SPIN_DURATION - 1e-9, HARD)).toBeCloseTo(-1, 6);
    expect(crashX(-0.5, -1, SPIN_DURATION - 1e-9, HARD)).toBeCloseTo(1, 6);
  });

  test('x stays inside ±1 even starting from off road', () => {
    for (let t = 0; t < CRASH_DURATION; t += 0.05) {
      expect(Math.abs(crashX(2.8, -1, t, HARD)), `t=${t}`).toBeLessThanOrEqual(1);
      expect(Math.abs(crashX(-2.8, 1, t, HARD)), `t=${t}`).toBeLessThanOrEqual(1);
    }
  });

  test('settle brings x back to the middle of the road', () => {
    expect(crashX(0.5, 1, SPIN_DURATION, HARD)).toBeCloseTo(-1, 10);
    expect(crashX(0.5, 1, SPIN_DURATION + SETTLE_DURATION, HARD)).toBeCloseTo(0, 10);
    expect(Math.abs(crashX(0.5, 1, SPIN_DURATION + SETTLE_DURATION / 2, HARD))).toBeLessThan(1);
  });

  test('a head on hit with no side still ends in the middle', () => {
    expect(crashX(0, 0, SPIN_DURATION, HARD)).toBe(0);
    expect(crashX(0, 0, CRASH_DURATION, HARD)).toBe(0);
  });
});

describe('the crash state machine (spec §7)', () => {
  test('a fresh crash is inactive', () => {
    expect(noCrash().state).toEqual({ active: false, t: 0, frame: 0 });
  });

  test('it remembers the speed, the x and the side of the hit', () => {
    const c = startCrash(player({ x: 0.4, speed: 9000 }), 1, 'hard');
    expect(c.state).toEqual({ active: true, t: 0, frame: 0 });
    expect(c.startSpeed).toBe(9000);
    expect(c.startX).toBe(0.4);
    expect(c.side).toBe(1);
  });

  test('it lasts exactly 6.4 s at 60 Hz and then clears itself', () => {
    let c = startCrash(player({ x: 0, speed: 9000 }), 1, 'hard');
    let ticks = 0;
    while (c.state.active) {
      c = stepCrash(c, DT);
      ticks++;
      expect(ticks, 'the crash must end').toBeLessThan(500);
    }
    expect(ticks).toBe(Math.ceil(CRASH_DURATION / DT));
    expect(c.state).toEqual({ active: false, t: 0, frame: 0 });
  });

  test('the frame follows the spin and is 0 during the settle', () => {
    let c = startCrash(player({ speed: 9000 }), 1, 'hard');
    const frames: number[] = [];
    for (let i = 0; i < 66; i++) {
      c = stepCrash(c, 0.1);
      frames.push(c.state.frame);
    }
    // 41 passi di rotazione (fino a 4,1 s; a 4,2 è già assestamento), poi
    // 22 di assestamento (4,2-6,3 s), poi spento.
    expect(frames.slice(0, 41)).toEqual(Array.from({ length: 41 }, (_, i) => (i + 1) % 4));
    expect(frames.slice(41, 63)).toEqual(Array.from({ length: 22 }, () => 0));
    expect(c.state.active).toBe(false);
  });

  test('a step on an inactive crash changes nothing', () => {
    const c = noCrash();
    expect(stepCrash(c, DT)).toBe(c);
  });
});

describe('applyCrash (spec §7)', () => {
  test('it overwrites speed, x and steer while the crash runs', () => {
    const start = player({ x: 0.6, speed: 9000, gear: 'hi', steer: 2, braking: true });
    const c = stepCrash(startCrash(start, 1, 'hard'), 0.25);
    const after = applyCrash(c, { ...start, z: 500 });
    expect(after.speed).toBeCloseTo(crashSpeed(9000, 0.25, HARD), 10);
    expect(after.x).toBeCloseTo(crashX(0.6, 1, 0.25, HARD), 10);
    expect(after.steer).toBe(0);
    expect(after.braking).toBe(false);
    expect(after.z).toBe(500);
  });

  test('the gear is forced to lo in the settle phase, not before', () => {
    const start = player({ x: 0, speed: 9000, gear: 'hi' });
    const spinning = stepCrash(startCrash(start, 1, 'hard'), 1.0);
    expect(applyCrash(spinning, start).gear).toBe('hi');
    const settling = stepCrash(startCrash(start, 1, 'hard'), SPIN_DURATION + 0.1);
    expect(applyCrash(settling, start).gear).toBe('lo');
  });

  test('an inactive crash leaves the player alone', () => {
    const p = player({ x: 0.3, speed: 500 });
    expect(applyCrash(noCrash(), p)).toBe(p);
  });

  test('surface and skidding are recomputed from the eased x, not from the stale player field', () => {
    // crashX confina la x fra -1 e 1 per tutta la durata dell'incidente (il
    // clamp della fase spin, il ventaglio -1..0..1 della fase settle): la
    // superficie durante un incidente è quindi sempre asfalto, anche se la
    // x del giocatore prima dell'urto era fuori strada. Qui il giocatore
    // passato ad applyCrash porta apposta una x=5 (erba) e una surface/
    // skidding stantie: se l'implementazione usasse per errore player.x
    // invece della x calcolata dall'easing, questo test lo rivelerebbe.
    const start = player({ x: 0.6, speed: 9000, gear: 'hi' });
    const c = stepCrash(startCrash(start, 1, 'hard'), 0.25);
    const stale: PlayerState = { ...start, x: 5, surface: 'grass', skidding: true };
    const after = applyCrash(c, stale);
    expect(after.x).toBeCloseTo(crashX(0.6, 1, 0.25, HARD), 10);
    expect(Math.abs(after.x)).toBeLessThanOrEqual(1);
    expect(after.surface).toBe('road');
    expect(after.skidding).toBe(false);
  });

  test('the frames the crash produces are all names the renderer knows', () => {
    let c = startCrash(player({ speed: 9000 }), 1, 'hard');
    const names = new Set<string>();
    while (c.state.active) {
      c = stepCrash(c, DT);
      if (!c.state.active) break;
      const snap = { crash: c.state, player: player(), kmh: 0 } as unknown as RaceSnapshot;
      names.add(playerFrameName(snap));
    }
    expect([...names].sort()).toEqual([
      'player_spin_0',
      'player_spin_1',
      'player_spin_2',
      'player_spin_3',
    ]);
  });
});

describe('applyCrash dentro la zona di bivio (task 15)', () => {
  test('un testacoda che finisce sull isola legge terreno, non asfalto', () => {
    const p = player({ x: 0.2, speed: MAX_SPEED });
    // `crashX` limita x a ±1: il testacoda resta dentro la carreggiata, ma
    // con l'isola larga 0,8 quella x cade sul terreno.
    const crash = stepCrash(startCrash(p, 1, 'hard'), 0.05);
    const onIsland = applyCrash(crash, p, 2.8, 0.8);
    expect(Math.abs(onIsland.x)).toBeLessThan(0.8);
    expect(onIsland.surface).toBe('grass');
    // Fuori dalla zona di bivio la stessa x e asfalto, come prima.
    expect(applyCrash(crash, p).surface).toBe('road');
  });

  test('un testacoda sulla carreggiata resta sull asfalto', () => {
    const p = player({ x: 0.9, speed: MAX_SPEED });
    const crash = stepCrash(startCrash(p, -1, 'hard'), 0.05);
    const after = applyCrash(crash, p, 2.8, 0.8);
    expect(Math.abs(after.x)).toBeGreaterThan(0.8);
    expect(after.surface).toBe('road');
    expect(after.offRoad).toBe(false);
  });

  test('offRoad segue |x| > 1 come stepPlayer, non roadHalf (minore 5)', () => {
    // `crashX` limita sempre x a [-1, 1] (spin) o a un easing verso 0
    // (settle): con una carreggiata divisa larga (roadHalf 2.8) la vecchia
    // regola `|x| > roadHalf` non poteva mai scattare. La regola di spec §5
    // e' `|x| > 1`, la stessa di `stepPlayer`.
    for (const t of [0, SPIN_DURATION * 0.5, SPIN_DURATION + SETTLE_DURATION * 0.5]) {
      const p = player({ x: 0.95, speed: MAX_SPEED });
      const crash = { state: { active: true, t, frame: 0 }, startSpeed: p.speed, startX: p.x, side: 1 as const, timing: HARD };
      const after = applyCrash(crash, p, 2.8, 0.8);
      expect(Math.abs(after.x), `t=${t}`).toBeLessThanOrEqual(1);
      expect(after.offRoad, `t=${t}`).toBe(false);
    }
  });
});

describe('incidente in NORMAL (collaudo utente: NORMAL più facile)', () => {
  const NORMAL = CRASH_TIMING.normal;

  test('spin 2.0 s, settle 1.0 s, stop in 0.5 s: about 3 s in all', () => {
    expect(NORMAL).toEqual({ spin: 2.0, settle: 1.0, stop: 0.5 });
    expect(crashDuration(NORMAL)).toBeCloseTo(3, 10);
    expect(crashPhase(1.99, NORMAL)).toBe('spin');
    expect(crashPhase(2.0, NORMAL)).toBe('settle');
    expect(crashPhase(2.99, NORMAL)).toBe('settle');
    expect(crashPhase(3.0, NORMAL)).toBe('none');
    expect(crashSpeed(12000, 0.25, NORMAL)).toBeCloseTo(6000, 10);
    expect(crashSpeed(12000, 0.5, NORMAL)).toBe(0);
  });

  test('HARD keeps the long crash', () => {
    expect(HARD).toEqual({ spin: 4.2, settle: 2.2, stop: 0.8 });
  });

  test('a NORMAL crash lasts 3 s at 60 Hz, the four frames cycle through the whole spin', () => {
    let c = startCrash(player({ x: 0.5, speed: 9000 }), 1, 'normal');
    let ticks = 0;
    const spinFrames: number[] = [];
    while (c.state.active) {
      c = stepCrash(c, DT);
      ticks++;
      if (c.state.active && crashPhase(c.state.t, NORMAL) === 'spin') spinFrames.push(c.state.frame);
    }
    expect(ticks).toBe(Math.ceil(crashDuration(NORMAL) / DT));
    // Venti frame da 0,1 s: cinque giri completi dei quattro sprite.
    for (let f = 0; f < 4; f++) expect(spinFrames.filter((v) => v === f).length).toBeGreaterThanOrEqual(29);
  });

  test('the NORMAL slide reaches the far side and comes back to the middle without jumps', () => {
    let prev = crashX(0.5, 1, 0, NORMAL);
    for (let t = DT; t <= crashDuration(NORMAL); t += DT) {
      const x = crashX(0.5, 1, t, NORMAL);
      expect(Math.abs(x - prev), `t=${t.toFixed(3)}`).toBeLessThan(0.05);
      prev = x;
    }
    expect(crashX(0.5, 1, NORMAL.spin - 1e-9, NORMAL)).toBeCloseTo(-1, 6);
    expect(crashX(0.5, 1, crashDuration(NORMAL), NORMAL)).toBeCloseTo(0, 10);
  });
});
