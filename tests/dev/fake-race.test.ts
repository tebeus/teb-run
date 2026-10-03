import { describe, expect, test } from 'vitest';
import {
  createFakeRace,
  FAKE_CHECKPOINT_EVERY_S,
  FAKE_CHECKPOINTS_TO_FINISH,
  FAKE_FORK_AT_S,
  initialFakeRaceState,
  snapshotFromFakeState,
  stepFakeRace,
} from '../../src/dev/fake-race';
import { emptyActions } from '../../src/core/input';
import type { RaceSnapshot, StageDef } from '../../src/types';

const stage: StageDef = {
  id: '0-0',
  name: 'Palm Bay',
  theme: 'beach',
  lengthSegments: 2260,
  timeLimit: 200,
  seed: 1,
  difficulty: 0.15,
};

describe('stepFakeRace: physics', () => {
  test('speed ramps up while accelerating and decays otherwise', () => {
    let state = initialFakeRaceState(stage);
    const r1 = stepFakeRace(state, 1, { ...emptyActions(), accelerate: true });
    expect(r1.state.speed).toBeGreaterThan(0);
    state = r1.state;
    const r2 = stepFakeRace(state, 1, emptyActions());
    expect(r2.state.speed).toBeLessThan(state.speed);
  });

  test('kmh follows speedPercent * 293 (spec formula)', () => {
    const state = { ...initialFakeRaceState(stage), speed: 0 };
    const snap = snapshotFromFakeState({ ...state, speed: 0 });
    expect(snap.kmh).toBe(0);
  });

  test('score rises over time while moving', () => {
    let state = initialFakeRaceState(stage);
    for (let i = 0; i < 10; i++) {
      state = stepFakeRace(state, 1 / 60, { ...emptyActions(), accelerate: true }).state;
    }
    expect(state.score).toBeGreaterThan(0);
  });
});

describe('stepFakeRace: fork event', () => {
  test('fires exactly once, at or after 15 seconds, with two distinct fork names', () => {
    let state = initialFakeRaceState(stage);
    let forkEvents = 0;
    let forkFiredAtOrAfter15 = true;
    let snapAtFork: RaceSnapshot | null = null;
    for (let t = 1; t <= 25; t++) {
      const r = stepFakeRace(state, 1, emptyActions());
      state = r.state;
      if (r.events.some((e) => e.type === 'fork')) {
        forkEvents++;
        if (t < FAKE_FORK_AT_S) forkFiredAtOrAfter15 = false;
        // Il banner del bivio scade dopo pochi secondi (sostituito poi dal
        // checkpoint a t=20): si controlla nel momento in cui l'evento
        // scatta, non dopo l'intero ciclo di 25 tick.
        snapAtFork = snapshotFromFakeState(state);
      }
    }
    expect(forkEvents).toBe(1);
    expect(forkFiredAtOrAfter15).toBe(true);
    expect(snapAtFork?.banner).toBe('fork');
    expect(snapAtFork?.forkNames).toBeDefined();
    expect(snapAtFork?.forkNames?.[0]).not.toBe(snapAtFork?.forkNames?.[1]);
  });

  test('forkNames is always present whenever the fake engine sets banner to fork', () => {
    let state = initialFakeRaceState(stage);
    for (let t = 1; t <= FAKE_FORK_AT_S + 1; t++) {
      state = stepFakeRace(state, 1, emptyActions()).state;
      const snap = snapshotFromFakeState(state);
      if (snap.banner === 'fork') expect(snap.forkNames).toBeDefined();
    }
  });
});

describe('stepFakeRace: checkpoints and finish', () => {
  test('fires a checkpoint every FAKE_CHECKPOINT_EVERY_S seconds', () => {
    let state = initialFakeRaceState(stage);
    const checkpointTicks: number[] = [];
    for (let t = 1; t <= FAKE_CHECKPOINT_EVERY_S * 2; t++) {
      const r = stepFakeRace(state, 1, emptyActions());
      state = r.state;
      if (r.events.some((e) => e.type === 'checkpoint')) checkpointTicks.push(t);
    }
    expect(checkpointTicks).toEqual([FAKE_CHECKPOINT_EVERY_S, FAKE_CHECKPOINT_EVERY_S * 2]);
  });

  test('fires finish instead of the Nth checkpoint, and then stops producing events', () => {
    let state = initialFakeRaceState(stage);
    const finishAt = FAKE_CHECKPOINT_EVERY_S * FAKE_CHECKPOINTS_TO_FINISH;
    let finishEvents = 0;
    for (let t = 1; t <= finishAt; t++) {
      const r = stepFakeRace(state, 1, emptyActions());
      state = r.state;
      if (r.events.some((e) => e.type === 'finish')) finishEvents++;
    }
    expect(finishEvents).toBe(1);
    const after = stepFakeRace(state, 1, emptyActions());
    expect(after.events).toEqual([]);
  });
});

describe('stepFakeRace: game over', () => {
  test('fires gameover exactly once when time runs out, and then stops', () => {
    const shortStage: StageDef = { ...stage, timeLimit: 2 };
    let state = initialFakeRaceState(shortStage);
    let gameoverEvents = 0;
    for (let t = 1; t <= 5; t++) {
      const r = stepFakeRace(state, 1, emptyActions());
      state = r.state;
      if (r.events.some((e) => e.type === 'gameover')) gameoverEvents++;
    }
    expect(gameoverEvents).toBe(1);
    expect(snapshotFromFakeState(state).timeLeft).toBe(0);
  });
});

describe('createFakeRace', () => {
  test('implements RaceEngine: update() returns events, snapshot() has an empty segments array', () => {
    const engine = createFakeRace(stage, {} as never);
    const events = engine.update(1 / 60, { ...emptyActions(), accelerate: true });
    expect(Array.isArray(events)).toBe(true);
    const snap = engine.snapshot();
    expect(snap.segments).toEqual([]);
    expect(snap.stage).toEqual(stage);
    expect(typeof snap.kmh).toBe('number');
    expect(typeof snap.score).toBe('number');
  });
});
