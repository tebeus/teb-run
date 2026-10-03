import type { Actions, AssetStore, Banner, Gear, RaceEngine, RaceEvent, RaceSnapshot, StageDef } from '../types';

export const FAKE_MAX_SPEED = 300;
const FAKE_ACCEL = FAKE_MAX_SPEED / 3;
const FAKE_BRAKE = FAKE_MAX_SPEED;
const FAKE_DECEL = FAKE_MAX_SPEED / 4;
const FAKE_STEER = 1.2;

export const FAKE_FORK_AT_S = 15;
const FAKE_FORK_BANNER_S = 3;
export const FAKE_CHECKPOINT_EVERY_S = 20;
const FAKE_CHECKPOINT_BANNER_S = 2;
export const FAKE_CHECKPOINTS_TO_FINISH = 3;
const FAKE_CHECKPOINT_BONUS = 1000;

export interface FakeRaceState {
  stage: StageDef;
  t: number;
  speed: number;
  x: number;
  steer: -2 | -1 | 0 | 1 | 2;
  gear: Gear;
  score: number;
  timeLeft: number;
  checkpoints: number;
  lastCheckpointAt: number;
  forkFired: boolean;
  banner: Banner;
  bannerUntil: number;
  forkNames?: [string, string];
  done: boolean;
}

/** Stato iniziale di una gara finta per una tappa data. Pura. */
export function initialFakeRaceState(stage: StageDef): FakeRaceState {
  return {
    stage,
    t: 0,
    speed: 0,
    x: 0,
    steer: 0,
    gear: 'lo',
    score: 0,
    timeLeft: stage.timeLimit,
    checkpoints: 0,
    lastCheckpointAt: 0,
    forkFired: false,
    banner: 'none',
    bannerUntil: 0,
    forkNames: undefined,
    done: false,
  };
}

/**
 * Un passo della gara finta: velocità che sale con l'accelerazione, tempo
 * che scende, punteggio che sale, un bivio fisso a FAKE_FORK_AT_S, un
 * checkpoint ogni FAKE_CHECKPOINT_EVERY_S, un finale dopo
 * FAKE_CHECKPOINTS_TO_FINISH checkpoint, game over a tempo scaduto. Pura.
 */
export function stepFakeRace(
  state: FakeRaceState,
  dt: number,
  actions: Actions,
): { state: FakeRaceState; events: RaceEvent[] } {
  if (state.done) return { state, events: [] };

  const s: FakeRaceState = { ...state };
  const events: RaceEvent[] = [];
  s.t += dt;

  if (actions.gearToggle) s.gear = s.gear === 'lo' ? 'hi' : 'lo';
  const maxSpeed = s.gear === 'lo' ? FAKE_MAX_SPEED * 0.55 : FAKE_MAX_SPEED;
  if (actions.accelerate) s.speed = Math.min(maxSpeed, s.speed + FAKE_ACCEL * dt);
  else if (actions.brake) s.speed = Math.max(0, s.speed - FAKE_BRAKE * dt);
  else s.speed = Math.max(0, s.speed - FAKE_DECEL * dt);

  let steer: -2 | -1 | 0 | 1 | 2 = 0;
  if (actions.left) {
    s.x = Math.max(-1, s.x - FAKE_STEER * dt);
    steer = -1;
  }
  if (actions.right) {
    s.x = Math.min(1, s.x + FAKE_STEER * dt);
    steer = 1;
  }
  s.steer = steer;

  s.score += (s.speed / FAKE_MAX_SPEED) * 100 * dt;
  s.timeLeft = Math.max(0, s.timeLeft - dt);

  if (!s.forkFired && s.t >= FAKE_FORK_AT_S) {
    s.forkFired = true;
    s.banner = 'fork';
    s.bannerUntil = s.t + FAKE_FORK_BANNER_S;
    s.forkNames = [`${s.stage.name} LEFT`, `${s.stage.name} RIGHT`];
    events.push({
      type: 'fork',
      left: { ...s.stage, id: `${s.stage.id}-l`, name: s.forkNames[0] },
      right: { ...s.stage, id: `${s.stage.id}-r`, name: s.forkNames[1] },
    });
  }

  if (!s.done && s.t - s.lastCheckpointAt >= FAKE_CHECKPOINT_EVERY_S) {
    s.lastCheckpointAt += FAKE_CHECKPOINT_EVERY_S;
    s.checkpoints += 1;
    s.score += FAKE_CHECKPOINT_BONUS;

    if (s.checkpoints >= FAKE_CHECKPOINTS_TO_FINISH) {
      s.done = true;
      s.banner = 'none';
      events.push({ type: 'finish', ending: 0, score: Math.round(s.score) });
    } else {
      s.banner = 'checkpoint';
      s.bannerUntil = s.t + FAKE_CHECKPOINT_BANNER_S;
      events.push({ type: 'checkpoint', bonus: FAKE_CHECKPOINT_BONUS, nextStage: s.stage });
    }
  }

  if (!s.done && s.timeLeft <= 0) {
    s.done = true;
    s.banner = 'gameover';
    events.push({ type: 'gameover', score: Math.round(s.score), stage: s.stage });
  }

  if (!s.done && s.banner !== 'gameover' && s.t >= s.bannerUntil) {
    s.banner = 'none';
  }

  return { state: s, events };
}

/** Snapshot derivato dallo stato finto, nella stessa forma di una gara vera. Pura. */
export function snapshotFromFakeState(state: FakeRaceState): RaceSnapshot {
  const speedPercent = state.speed / FAKE_MAX_SPEED;
  return {
    segments: [],
    player: {
      x: state.x,
      z: state.t * state.speed,
      speed: state.speed,
      gear: state.gear,
      steer: state.steer,
      offRoad: Math.abs(state.x) > 1,
      braking: false,
      accelerating: false,
      surface: 'road',
      skidding: false,
      steerHeld: 0,
    },
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: state.timeLeft,
    score: Math.round(state.score),
    elapsed: state.t,
    stage: state.stage,
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme: state.stage.theme,
    banner: state.banner,
    forkNames: state.forkNames,
    kmh: speedPercent * 293,
  };
}

/** RaceEngine finto per le pagine di sviluppo, prima che il binario A sia collegato. */
export function createFakeRace(stage: StageDef, _assets: AssetStore): RaceEngine {
  let state = initialFakeRaceState(stage);
  return {
    update(dt, actions) {
      const r = stepFakeRace(state, dt, actions);
      state = r.state;
      return r.events;
    },
    snapshot() {
      return snapshotFromFakeState(state);
    },
  };
}
