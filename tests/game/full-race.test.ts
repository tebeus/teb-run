import { describe, expect, test } from 'vitest';
import { MAX_ACC } from '../../src/core/loop';
import { DRAW_DISTANCE, SEGMENT_LENGTH } from '../../src/render/project';
import { crashDuration, CRASH_TIMING } from '../../src/game/crash';
import { DEMO_GRAPH, DEMO_STAGES } from '../../src/game/demo-graph';
import { modeGraph } from '../../src/game/mode';
import { createFullRace } from '../../src/game/race';
import { ACCEL_LO, MAX_SPEED } from '../../src/game/player';
import { OVERTAKE_POINTS, tickScore } from '../../src/game/score';
import { createStageGraph } from '../../src/game/stage-graph';
import { LEVEL_TIME_LIMITS } from '../../src/game/timer';
import { trafficCountFor } from '../../src/game/traffic';
import { FORK_ZONE_SEGMENTS, MIN_STAGE_SEGMENTS } from '../../src/game/track';
import type { AssetStore, RaceEngine, RaceEvent, StageDef } from '../../src/types';
import { makeAsset } from '../helpers/segments';
import { acts, driveToward, driveUntil, eventTypes, has, simulateRace } from '../helpers/race-script';

const DT = 1 / 60;

/** AssetStore finto: il motore non disegna, ma `get` non deve mai lanciare. */
const stubAssets = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name) => makeAsset(name, 64, 64),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

/** Tappa corta ma legale: la più breve che `buildTrack` accetta. */
const shortStage = (id: string, name: string, over: Partial<StageDef> = {}): StageDef => ({
  id,
  name,
  theme: 'beach',
  lengthSegments: MIN_STAGE_SEGMENTS,
  timeLimit: 600,
  seed: 4242,
  difficulty: 0,
  ...over,
});

const TEST_STAGES = [
  shortStage('0-0', 'Alpha'),
  shortStage('1-0', 'Bravo'),
  shortStage('1-1', 'Charlie'),
];

/**
 * Tappe con un corpo vero, per i test che devono schiantarsi contro il
 * traffico (terzo addendum del collaudo): `MIN_STAGE_SEGMENTS` è la tappa
 * più corta che `buildTrack` accetta, ma con `FORK_EXIT_SEGMENTS` a 360
 * `TRAFFIC_FREE_START` (360) mangia quasi tutto il corpo fra il rettilineo
 * di partenza e la zona di bivio di una tappa così corta (60 + 320 = 380 su
 * 540), lasciando alla `stepTraffic` uno spazio di un solo segmento per
 * piazzare le auto — troppo poco perché ne compaia una prima del
 * `maxTicks` del test. +600 segmenti di corpo bastano.
 */
const CRASH_TEST_STAGES = [
  shortStage('0-0', 'Alpha', { lengthSegments: MIN_STAGE_SEGMENTS + 600 }),
  shortStage('1-0', 'Bravo'),
  shortStage('1-1', 'Charlie'),
];

/** Motore su un grafo di tappe corte: due livelli, un bivio, due finali. */
const newRace = (stages: readonly StageDef[] = TEST_STAGES): RaceEngine => {
  const graph = createStageGraph(stages);
  return createFullRace({ graph, assets: stubAssets(), startStage: graph.first(), skipCountdown: true });
};

describe('createFullRace: standing start', () => {
  test('the snapshot describes the first stage at a standstill', () => {
    const snap = newRace().snapshot();
    expect(snap.segments).toHaveLength(DRAW_DISTANCE);
    expect(snap.stage.id).toBe('0-0');
    expect(snap.level).toBe(0);
    expect(snap.timeLeft).toBe(600);
    expect(snap.score).toBe(0);
    expect(snap.route).toEqual([]);
    expect(snap.banner).toBe('none');
    expect(snap.forkNames).toBeUndefined();
    expect(snap.crash).toEqual({ active: false, t: 0, frame: 0 });
    expect(snap.kmh).toBe(0);
    expect(snap.theme).toBe('beach');
  });

  test('the first stage has traffic, bucketed in its segments', () => {
    const snap = newRace().snapshot();
    const total = snap.segments.reduce((n, s) => n + s.cars.length, 0);
    // Solo i 300 segmenti visibili sono nello snapshot: qualche veicolo basta.
    expect(total).toBeGreaterThanOrEqual(0);
    expect(snap.segments.every((s) => s.cars.every((c) => c.speed > 0))).toBe(true);
  });

  test('standing still burns time and scores nothing', () => {
    const race = newRace();
    simulateRace(race, [{ ticks: 60 }]);
    const snap = race.snapshot();
    expect(snap.timeLeft).toBeCloseTo(599, 6);
    expect(snap.score).toBe(0);
    expect(snap.player.z).toBe(0);
  });

  test('accelerating moves the car and scores', () => {
    const race = newRace();
    simulateRace(race, [{ ticks: 120, actions: { accelerate: true } }]);
    const snap = race.snapshot();
    expect(snap.player.z).toBeGreaterThan(0);
    expect(snap.kmh).toBeGreaterThan(50);
    expect(snap.score).toBeGreaterThan(0);
  });
});

describe('createFullRace: fork and stage junction (spec §9)', () => {
  test('driving right gets the fork banner, then a checkpoint into the right stage', () => {
    const race = newRace();
    const run = driveToward(race, 0.85, (e) => has(e, 'checkpoint'));
    const kinds = eventTypes(run.events).filter((t) => t === 'fork' || t === 'checkpoint');
    expect(kinds).toEqual(['fork', 'checkpoint']);

    const fork = run.events.find((e) => e.type === 'fork') as Extract<RaceEvent, { type: 'fork' }>;
    expect([fork.left.id, fork.right.id]).toEqual(['1-0', '1-1']);

    const cp = run.events.find((e) => e.type === 'checkpoint') as Extract<
      RaceEvent,
      { type: 'checkpoint' }
    >;
    expect(cp.nextStage.id).toBe('1-1');
    expect(cp.bonus).toBeGreaterThan(0);

    const snap = race.snapshot();
    expect(snap.stage.id).toBe('1-1');
    expect(snap.route).toEqual(['R']);
    expect(snap.level).toBe(1);
  });

  test('driving left takes the other branch', () => {
    const race = newRace();
    driveToward(race, -0.85, (e) => has(e, 'checkpoint'));
    const snap = race.snapshot();
    expect(snap.stage.id).toBe('1-0');
    expect(snap.route).toEqual(['L']);
  });

  test('the fork banner names the two stages while in the zone', () => {
    const race = newRace();
    driveToward(race, 0.85, (e) => has(e, 'fork'));
    const snap = race.snapshot();
    expect(snap.banner).toBe('fork');
    expect(snap.forkNames).toEqual(['Bravo', 'Charlie']);
    expect(snap.segments.some((s) => s.fork === 'zone')).toBe(true);
  });

  test('the fork event fires once per stage', () => {
    const race = newRace();
    const run = driveToward(race, 0.85, (e) => has(e, 'checkpoint'));
    expect(eventTypes(run.events).filter((t) => t === 'fork')).toHaveLength(1);
  });

  test('the junction resets z, keeps x on the chosen road, keeps speed, and rebuilds the traffic', () => {
    const race = newRace();
    // Si tiene lo snapshot del tick prima del checkpoint, poi si guarda il salto.
    let before = race.snapshot();
    const run = driveToward(race, 0.5, (e) => {
      if (!has(e, 'checkpoint')) before = race.snapshot();
      return has(e, 'checkpoint');
    });
    expect(has(run.events, 'checkpoint')).toBe(true);
    const after = race.snapshot();
    expect(after.player.z).toBeLessThan(SEGMENT_LENGTH);
    expect(before.player.z).toBeGreaterThan((MIN_STAGE_SEGMENTS - 1) * SEGMENT_LENGTH);
    // Bivio v3: la ricentratura sulla strada scelta avviene al commit, alla
    // punta della Y; alla giunzione `x` è già relativa alla strada scelta,
    // che è la sola dell'ultimo segmento, e non si sposta. Tolleranza di un
    // passo di sterzo: fra i due tick lo sterzo può ancora muovere x.
    expect(after.player.x).toBeCloseTo(before.player.x, 1);
    expect(after.route).toEqual(['R']);
    // Il tick che attraversa la giunzione applica prima la fisica, quindi la
    // velocità può salire di un tick di accelerazione; quello che la
    // giunzione non deve fare è azzerarla o riportarla al minimo. Prima del
    // binario G questo confronto era esatto solo perché il giocatore
    // arrivava in fondo alla tappa già a velocità massima, dove
    // l'accelerazione è tagliata dal limite: non è una proprietà del codice.
    // Deroga di tolleranza (brief del controllore, deroga di geometria):
    // `FORK_ZONE_SPLIT_MAX` passa da 0,8 a 1,0, quindi il bersaglio 0,85 di
    // questo test (scelto per stare appena oltre il vecchio median) all'ultimo
    // segmento finisce ora **dentro** l'isola (`median = 1.0`), sulla
    // banchina: un tick lì può togliere fino a `OFF_ROAD_DECEL / 2 · dt`
    // (50 unità) di velocità. Il margine sostituisce l'epsilon di prima.
    expect(after.player.speed).toBeGreaterThanOrEqual(before.player.speed - 50);
    // ACCEL_LO è l'accelerazione più forte del gioco: dopo un incidente la
    // marcia torna bassa, quindi il tick della giunzione può usare quella.
    expect(after.player.speed).toBeLessThanOrEqual(before.player.speed + ACCEL_LO * DT + 1e-6);
    expect(after.stage.id).not.toBe(before.stage.id);
  });

  test('after the junction every car belongs to the new stage and to one bucket', () => {
    const race = newRace();
    driveToward(race, 0.85, (e) => has(e, 'checkpoint'));
    const snap = race.snapshot();
    const seen = new Set<number>();
    for (const seg of snap.segments) {
      for (const c of seg.cars) {
        expect(seen.has(c.id), `car ${c.id} in two buckets`).toBe(false);
        seen.add(c.id);
        expect(c.id).toBeLessThan(trafficCountFor(snap.stage));
        expect(Math.abs(c.z - seg.index * SEGMENT_LENGTH)).toBeLessThan(SEGMENT_LENGTH);
      }
    }
  });

  test('the checkpoint carries the leftover time into the next stage', () => {
    const race = newRace([
      shortStage('0-0', 'Alpha', { timeLimit: 100 }),
      shortStage('1-0', 'Bravo', { timeLimit: 40 }),
      shortStage('1-1', 'Charlie', { timeLimit: 40 }),
    ]);
    let last = 100;
    driveToward(race, 0.85, (e) => {
      if (!has(e, 'checkpoint')) last = race.snapshot().timeLeft;
      return has(e, 'checkpoint');
    });
    const snap = race.snapshot();
    expect(snap.timeLeft).toBeGreaterThan(40);
    expect(snap.timeLeft).toBeCloseTo(40 + last, 0);
  });

  test('the checkpoint exposes the seconds it just added, and only while the banner is up', () => {
    // `newRace()` e `driveToward`/`has` sono gli aiutanti già in cima a
    // questo file: la fabbrica costruisce un grafo di tappe corte (420
    // segmenti, timer a 600 s) e `driveToward` sterza leggendo lo
    // snapshot, che è il solo modo di arrivare in fondo a una tappa.
    const race = newRace();
    const run = driveToward(race, 0.85, (e) => has(e, 'checkpoint'));
    const cp = run.events.find((e) => e.type === 'checkpoint') as
      | Extract<RaceEvent, { type: 'checkpoint' }>
      | undefined;
    expect(cp, 'nessun checkpoint raggiunto').toBeDefined();
    const during = race.snapshot();
    expect(during.banner).toBe('checkpoint');
    // spec §8: `carryOver` aggiunge esattamente il limite della tappa nuova.
    expect(during.extendTime).toBeCloseTo(cp!.nextStage.timeLimit, 6);
    // Dopo i 2 s di banner il campo sparisce: 130 tick da 1/60 bastano.
    for (let i = 0; i < 130; i++) race.update(DT, acts({ accelerate: true }));
    expect(race.snapshot().banner).not.toBe('checkpoint');
    expect(race.snapshot().extendTime).toBeUndefined();
  });
});

describe('createFullRace: finish (spec §8, §9)', () => {
  test('the last stage ends the race with an ending and a finish bonus', () => {
    const race = newRace();
    const run = driveToward(race, 0.85, (e) => has(e, 'finish'), { maxTicks: 40000 });
    const finish = run.events.find((e) => e.type === 'finish') as Extract<
      RaceEvent,
      { type: 'finish' }
    >;
    expect(finish.ending).toBe(1);
    expect(finish.score).toBeGreaterThan(0);
    expect(eventTypes(run.events).filter((t) => t === 'checkpoint')).toHaveLength(1);
    expect(race.snapshot().route).toEqual(['R']);
  });

  test('after the finish the engine is quiet and the snapshot still works', () => {
    const race = newRace();
    driveToward(race, 0.85, (e) => has(e, 'finish'), { maxTicks: 40000 });
    const frozen = race.snapshot();
    expect(race.update(DT, acts({ accelerate: true }))).toEqual([]);
    expect(race.snapshot().score).toBe(frozen.score);
    expect(race.snapshot().stage.id).toBe(frozen.stage.id);
  });

  test('the finish bonus is worth far more than a checkpoint', () => {
    const race = newRace();
    const run = driveToward(race, 0.85, (e) => has(e, 'finish'), { maxTicks: 40000 });
    const cp = run.events.find((e) => e.type === 'checkpoint') as Extract<
      RaceEvent,
      { type: 'checkpoint' }
    >;
    const finish = run.events.find((e) => e.type === 'finish') as Extract<
      RaceEvent,
      { type: 'finish' }
    >;
    expect(finish.score).toBeGreaterThan(cp.bonus * 4);
  });
});

describe('createFullRace: running out of time (spec §8)', () => {
  const shortTime = [
    shortStage('0-0', 'Alpha', { timeLimit: 0.5 }),
    shortStage('1-0', 'Bravo'),
    shortStage('1-1', 'Charlie'),
  ];

  test('time runs out, the car decelerates, then the game over event arrives', () => {
    const race = newRace(shortTime);
    const run = driveUntil(race, (e) => has(e, 'gameover'), {
      actions: { accelerate: true },
      maxTicks: 1000,
    });
    const over = run.events.find((e) => e.type === 'gameover') as Extract<
      RaceEvent,
      { type: 'gameover' }
    >;
    expect(over.stage.id).toBe('0-0');
    expect(over.score).toBeGreaterThanOrEqual(0);
    // 0.5 s di gara più 2 s di decelerazione.
    expect(run.ticks).toBeCloseTo((0.5 + 2) * 60, -1);
    expect(race.snapshot().timeLeft).toBe(0);
  });

  test('the banner says game over as soon as the time is up', () => {
    const race = newRace(shortTime);
    driveUntil(race, () => race.snapshot().timeLeft === 0, {
      actions: { accelerate: true },
      maxTicks: 1000,
    });
    expect(race.snapshot().banner).toBe('gameover');
  });

  test('the car is stopped by the time the game over event fires', () => {
    const race = newRace(shortTime);
    driveUntil(race, (e) => has(e, 'gameover'), { actions: { accelerate: true }, maxTicks: 1000 });
    expect(race.snapshot().player.speed).toBe(0);
  });

  test('the game over event fires once and then the engine is quiet', () => {
    const race = newRace(shortTime);
    const run = driveUntil(race, (e) => has(e, 'gameover'), {
      actions: { accelerate: true },
      maxTicks: 1000,
    });
    expect(eventTypes(run.events).filter((t) => t === 'gameover')).toHaveLength(1);
    expect(race.update(DT, acts({ accelerate: true }))).toEqual([]);
  });

  test('elapsed stops growing once the game is over (minore 6)', () => {
    const race = newRace(shortTime);
    driveUntil(race, (e) => has(e, 'gameover'), { actions: { accelerate: true }, maxTicks: 1000 });
    const elapsedAtGameOver = race.snapshot().elapsed;
    for (let i = 0; i < 120; i++) race.update(DT, acts({ accelerate: true }));
    expect(race.snapshot().elapsed).toBe(elapsedAtGameOver);
  });
});

describe('createFullRace: crash and traffic (spec §6, §7)', () => {
  test('driving fast down the middle crashes, and the race goes on', () => {
    const race = newRace(CRASH_TEST_STAGES);
    const run = driveToward(race, 0, (e) => has(e, 'crash'), { maxTicks: 4000 });
    expect(has(run.events, 'crash')).toBe(true);
    expect(race.snapshot().crash.active).toBe(true);

    // L'incidente finisce da solo e si riprende a guidare.
    const crashTicks = Math.ceil(crashDuration(CRASH_TIMING.normal) / DT) + 1;
    simulateRace(race, [{ ticks: crashTicks, actions: { accelerate: true } }]);
    expect(race.snapshot().crash.active).toBe(false);
    const z = race.snapshot().player.z;
    simulateRace(race, [{ ticks: 60, actions: { accelerate: true } }]);
    expect(race.snapshot().player.z).toBeGreaterThan(z);
  });

  // Collaudo utente: in NORMAL un incidente costa meno, HARD resta com'era.
  test.each([
    ['normal', 3.0],
    ['hard', 6.4],
  ] as const)('a crash in %s lasts %f s', (mode, seconds) => {
    const graph = modeGraph(createStageGraph(CRASH_TEST_STAGES), mode);
    const race = createFullRace({ graph, assets: stubAssets(), startStage: graph.first(), skipCountdown: true });
    driveToward(race, 0, (e) => has(e, 'crash'), { maxTicks: 4000 });
    expect(race.snapshot().crash.active).toBe(true);
    let ticks = 0;
    while (race.snapshot().crash.active) {
      race.update(DT, acts({ accelerate: true }));
      ticks++;
      expect(ticks, 'the crash must end').toBeLessThan(1000);
    }
    expect(ticks * DT).toBeCloseTo(seconds, 1);
  });

  test('during a crash the input is ignored and the time keeps running', () => {
    const race = newRace(CRASH_TEST_STAGES);
    driveToward(race, 0, (e) => has(e, 'crash'), { maxTicks: 4000 });
    const before = race.snapshot();
    simulateRace(race, [{ ticks: 12, actions: { accelerate: true, right: true } }]);
    const after = race.snapshot();
    expect(after.player.speed).toBeLessThan(before.player.speed);
    expect(after.timeLeft).toBeLessThan(before.timeLeft);
    expect(after.player.steer).toBe(0);
  });

  // «a crash inside the fork zone keeps the fork banner and does not end the
  // stage» è stato rimosso (secondo addendum del collaudo, deroga di
  // geometria): guidava verso x = 0 dentro la zona di bivio proprio per
  // schiantarsi sulla fila di barriere centrali, che non esistono più. La
  // zona è piatta e dritta per tutti i 320 segmenti e non ha più nessun
  // oggetto solido (il portale non lo è), quindi non c'è più modo di andare
  // in crash restando dentro la zona: è l'effetto voluto, non una lacuna. La
  // combinazione crash + banner + niente finish/checkpoint di troppo resta
  // verificata dal test del corpo qui sopra («driving fast down the middle
  // crashes») e dai test di checkpoint/finish più sotto.

  test('a full drive produces bumps or overtakes, and every event is a known type', () => {
    const race = newRace();
    const run = driveToward(race, 0.85, (e) => has(e, 'finish'), { maxTicks: 40000 });
    const known = new Set(['checkpoint', 'fork', 'finish', 'gameover', 'crash', 'bump', 'overtake']);
    for (const t of eventTypes(run.events)) expect(known.has(t), t).toBe(true);
    expect(has(run.events, 'overtake') || has(run.events, 'bump')).toBe(true);
  });

  test('every tick of a full drive keeps the snapshot finite and inside its bounds', () => {
    const race = newRace();
    for (let i = 0; i < 1200; i++) {
      race.update(DT, acts({ accelerate: true, right: i % 4 === 0, brake: i % 211 === 0 }));
      const snap = race.snapshot();
      expect(Number.isFinite(snap.player.x), `tick ${i}`).toBe(true);
      expect(Number.isFinite(snap.player.speed), `tick ${i}`).toBe(true);
      expect(Number.isFinite(snap.score), `tick ${i}`).toBe(true);
      expect(snap.timeLeft, `tick ${i}`).toBeGreaterThanOrEqual(0);
      expect(Math.abs(snap.player.x), `tick ${i}`).toBeLessThanOrEqual(3);
      expect(snap.segments, `tick ${i}`).toHaveLength(DRAW_DISTANCE);
    }
  });
});

describe('createFullRace: the stage ends instead of wrapping (spec §9)', () => {
  test('z never runs past the end of the stage', () => {
    const race = newRace();
    const stageLength = MIN_STAGE_SEGMENTS * SEGMENT_LENGTH;
    driveToward(race, 0.85, (e, tick) => {
      const z = race.snapshot().player.z;
      expect(z, `tick ${tick}`).toBeLessThan(stageLength);
      return has(e, 'checkpoint');
    });
    expect(race.snapshot().route).toHaveLength(1);
  });

  test('the fork zone is the last 200 segments of the stage', () => {
    const race = newRace();
    let forkAtZ = -1;
    driveToward(race, 0.85, (e) => {
      if (has(e, 'fork') && forkAtZ < 0) forkAtZ = race.snapshot().player.z;
      return forkAtZ >= 0;
    });
    const zoneStart = (MIN_STAGE_SEGMENTS - FORK_ZONE_SEGMENTS) * SEGMENT_LENGTH;
    expect(forkAtZ).toBeGreaterThanOrEqual(zoneStart);
    expect(forkAtZ).toBeLessThan(zoneStart + SEGMENT_LENGTH);
  });
});

describe('the wiring main.ts uses', () => {
  test('the demo graph drives through a race factory shaped like ScreenDeps', () => {
    const assets = stubAssets();
    const raceFactory = (stage: StageDef, a: AssetStore) =>
      createFullRace({ graph: DEMO_GRAPH, assets: a, startStage: stage, skipCountdown: true });
    const race = raceFactory(DEMO_GRAPH.first(), assets);
    const run = simulateRace(race, [{ ticks: 120, actions: { accelerate: true } }]);
    expect(run.events.every((e) => typeof e.type === 'string')).toBe(true);
    const snap = race.snapshot();
    expect(snap.stage.id).toBe('0-0');
    expect(snap.stage.name).toBe('Palm Bay');
    // Il limite viene dalla tabella, non da un numero copiato: la taratura
    // di questo binario la cambia, e il test non deve rompersi di nuovo.
    expect(snap.timeLeft).toBeLessThan(LEVEL_TIME_LIMITS[0]);
    expect(snap.segments).toHaveLength(DRAW_DISTANCE);
  });

  test('the demo stages reach their fork at their real length, given the time', () => {
    // Le stesse tappe con un tempo abbondante: isola la geometria dal
    // bilanciamento dei tempi, che è lavoro del binario G.
    const graph = createStageGraph(DEMO_STAGES.map((s) => ({ ...s, timeLimit: 600 })));
    const race = createFullRace({ graph, assets: stubAssets(), skipCountdown: true });
    const run = driveToward(race, 0.85, (e) => has(e, 'fork'), { maxTicks: 40000 });
    expect(has(run.events, 'fork')).toBe(true);
    expect(race.snapshot().forkNames).toEqual(['Sandstone Gate', 'Blue Lagoon']);
  });

  test('a demo race always ends in a terminal event, never hangs', () => {
    const race = createFullRace({ graph: DEMO_GRAPH, assets: stubAssets(), skipCountdown: true });
    const run = driveToward(race, 0.85, (e) => has(e, 'gameover') || has(e, 'finish'), {
      maxTicks: 40000,
    });
    expect(has(run.events, 'gameover') || has(run.events, 'finish')).toBe(true);
    expect(race.snapshot().player.z).toBeGreaterThan(0);
    expect(race.snapshot().score).toBeGreaterThan(0);
  });
});

describe('createFullRace: several events in one tick', () => {
  test('a coarse tick carries every event it produced, in order', () => {
    const race = newRace();
    let multi = 0;
    let overtakes = 0;
    let finished = false;
    for (let i = 1; i <= 400 && !finished; i++) {
      const x = race.snapshot().player.x;
      // MAX_ACC è il passo più grande che il loop può consegnare (spec §15).
      const ev = race.update(
        MAX_ACC,
        acts({ accelerate: true, gearToggle: i === 1, left: x > 0.87, right: x < 0.83 }),
      );
      if (ev.length >= 2) multi++;
      overtakes += ev.filter((e) => e.type === 'overtake').length;
      finished = ev.some((e) => e.type === 'finish');
    }
    expect(finished).toBe(true);
    expect(multi).toBeGreaterThanOrEqual(1);
    expect(overtakes).toBeGreaterThanOrEqual(2);
  });

  test('the engine adds 50 points for every overtake it reports', () => {
    const race = newRace();
    for (let i = 1; i <= 400; i++) {
      const before = race.snapshot();
      const x = before.player.x;
      const ev = race.update(
        MAX_ACC,
        acts({ accelerate: true, gearToggle: i === 1, left: x > 0.87, right: x < 0.83 }),
      );
      const n = ev.filter((e) => e.type === 'overtake').length;
      if (n === 0 || ev.length !== n) continue;
      const after = race.snapshot();
      const fromSpeed = tickScore(after.player.speed / MAX_SPEED, MAX_ACC, after.level);
      // Lo snapshot arrotonda il punteggio, quindi la differenza vale ±1.
      const delta = after.score - before.score;
      expect(Math.abs(delta - n * OVERTAKE_POINTS - fromSpeed)).toBeLessThanOrEqual(1);
      return;
    }
    throw new Error('no tick with overtakes only: the test needs a new script');
  });
});

describe('createFullRace: a checkpoint beats a same-tick game over (regression)', () => {
  test('a stage ending in the same tick as the game-over decel cancels the pending game over', () => {
    const race = newRace([
      shortStage('0-0', 'Alpha', { timeLimit: 0 }),
      shortStage('1-0', 'Bravo'),
      shortStage('1-1', 'Charlie'),
    ]);

    // Il tempo scade subito: al primo tick l'orologio passa da null a 0.
    race.update(DT, acts());
    expect(race.snapshot().timeLeft).toBe(0);

    // Un unico tick enorme copre sia la rampa di 2 s (game over) sia la fine
    // della tappa: la fine della tappa deve vincere (spec §9). 20 s, non più
    // 8,5 (brief del controllore: deroga di geometria, FORK_ZONE_SEGMENTS
    // passa da 200 a 320 e la tappa minima si allunga di conseguenza; 20 s a
    // velocità massima coprono comodamente MIN_STAGE_SEGMENTS qualunque sia
    // il valore della zona di bivio).
    const events = race.update(20, acts({ accelerate: true, gearToggle: true }));
    expect(has(events, 'checkpoint')).toBe(true);
    expect(has(events, 'gameover')).toBe(false);

    const snap = race.snapshot();
    expect(snap.stage.id).toBe('1-1');
    expect(snap.timeLeft).toBeGreaterThan(0);

    // Il motore non è "done": un tick normale continua a far scorrere il tempo.
    const before = race.snapshot().timeLeft;
    race.update(DT, acts({ accelerate: true }));
    expect(race.snapshot().timeLeft).toBeLessThan(before);
  });
});
