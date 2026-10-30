import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createCarSetting } from '../../../src/persist/car';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createScoresStore } from '../../../src/persist/scores';
import { CRASH_DEBRIS, CRASH_SPARKS, type ParticleField } from '../../../src/render/effects';
import {
  createRaceScreen,
  engineParams,
  handleRaceEvents,
  isSkidding,
  parseRacePayload,
  STAGE_WAIT_S,
} from '../../../src/ui/screens/race';
import { go } from '../../../src/ui/fsm';
import { LOADING_BAR_H, LOADING_BAR_W, LOADING_BAR_Y } from '../../../src/ui/loading';
import { createRecordCtx } from '../../helpers/recordCtx';

const LOADING_BAR_X = (1280 - LOADING_BAR_W) / 2;
import type { ScreenDeps } from '../../../src/ui/deps';
import type { AudioBus, RaceEngine, RaceEvent, RaceSnapshot, StageDef } from '../../../src/types';

function baseAudio(): AudioBus {
  return {
    unlock() {},
    playSong() {},
    stopSong() {},
    sfx() {},
    setEngine() {},
    setSkid() {},
    setRumble() {},
    toggleMute: () => false,
    muted: false,
    available: true,
  };
}

const stage: StageDef = {
  id: '0-0',
  name: 'Palm Bay',
  theme: 'beach',
  lengthSegments: 2260,
  timeLimit: 75,
  seed: 1,
  difficulty: 0.15,
};

function baseSnapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    segments: [],
    player: {
      x: 0,
      z: 0,
      speed: 6000,
      gear: 'hi',
      steer: 0,
      offRoad: false,
      braking: false,
      accelerating: false,
      surface: 'road',
      skidding: false,
      steerHeld: 0,
    },
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 45,
    score: 1200,
    stage,
    level: 0,
    route: ['L', 'R'],
    parallax: { far: 0, near: 0, y: 0 },
    theme: 'beach',
    banner: 'none',
    kmh: 150,
    ...overrides,
  };
}

describe('handleRaceEvents', () => {
  test('checkpoint plays sfx, no transition', () => {
    const events: RaceEvent[] = [{ type: 'checkpoint', bonus: 1000, nextStage: stage }];
    const r = handleRaceEvents(events, baseSnapshot());
    expect(r.sfx).toEqual(['checkpoint']);
    expect(r.transition).toBeNull();
  });

  test('crash and bump each play their own sfx', () => {
    const r = handleRaceEvents([{ type: 'crash' }, { type: 'bump' }], baseSnapshot());
    expect(r.sfx).toEqual(['crash', 'bump']);
    expect(r.transition).toBeNull();
  });

  test('fork and overtake produce no sfx and no transition', () => {
    const r = handleRaceEvents(
      [{ type: 'fork', left: stage, right: stage }, { type: 'overtake' }],
      baseSnapshot(),
    );
    expect(r.sfx).toEqual([]);
    expect(r.transition).toBeNull();
  });

  test('a countdown step plays the blip and changes no screen', () => {
    const { transition, sfx } = handleRaceEvents([{ type: 'countdown', step: 1 }], baseSnapshot());
    expect(sfx).toEqual(['blip']);
    expect(transition).toBeNull();
  });

  test('finish transitions to ending with score, ending number, the snapshot stage and route', () => {
    const snap = baseSnapshot({ route: ['L', 'R', 'L'] });
    const r = handleRaceEvents([{ type: 'finish', ending: 2, score: 9000 }], snap);
    expect(r.transition).toEqual(go('ending', { score: 9000, ending: 2, stage, route: ['L', 'R', 'L'] }));
  });

  test('gameover transitions to gameOver with score, the stage from the event and route from the snapshot', () => {
    const snap = baseSnapshot({ route: ['R'] });
    const otherStage = { ...stage, id: '2-1' };
    const r = handleRaceEvents([{ type: 'gameover', score: 500, stage: otherStage }], snap);
    expect(r.transition).toEqual(go('gameOver', { score: 500, stage: otherStage, route: ['R'] }));
  });

  test('the first transition of a tick wins, not the last, if a tick somehow produced both', () => {
    const snap = baseSnapshot({ route: ['L'] });
    const otherStage = { ...stage, id: '2-1' };
    const finishFirst = handleRaceEvents(
      [{ type: 'finish', ending: 1, score: 100 }, { type: 'gameover', score: 100, stage: otherStage }],
      snap,
    );
    expect(finishFirst.transition).toEqual(go('ending', { score: 100, ending: 1, stage, route: ['L'] }));

    const gameoverFirst = handleRaceEvents(
      [{ type: 'gameover', score: 100, stage: otherStage }, { type: 'finish', ending: 1, score: 100 }],
      snap,
    );
    expect(gameoverFirst.transition).toEqual(go('gameOver', { score: 100, stage: otherStage, route: ['L'] }));
  });
});

describe('parseRacePayload', () => {
  test('passes through a valid song', () => {
    expect(parseRacePayload({ song: 2 })).toEqual({ song: 2 });
  });

  test('passes through custom-track indices at or above 3', () => {
    expect(parseRacePayload({ song: 3 })).toEqual({ song: 3 });
    expect(parseRacePayload({ song: 4 })).toEqual({ song: 4 });
    expect(parseRacePayload({ song: 35 })).toEqual({ song: 35 });
  });

  test('defaults to song 0 for missing or invalid input', () => {
    expect(parseRacePayload(undefined)).toEqual({ song: 0 });
    expect(parseRacePayload({ song: -1 })).toEqual({ song: 0 });
    expect(parseRacePayload({ song: 1.5 })).toEqual({ song: 0 });
    expect(parseRacePayload({ song: 'x' })).toEqual({ song: 0 });
  });
});

describe('engineParams', () => {
  test('derives speedPercent from kmh / 293, clamped to [0, 1]', () => {
    expect(engineParams(baseSnapshot({ kmh: 293 })).speedPercent).toBeCloseTo(1);
    expect(engineParams(baseSnapshot({ kmh: 0 })).speedPercent).toBe(0);
    expect(engineParams(baseSnapshot({ kmh: 500 })).speedPercent).toBe(1);
    expect(engineParams(baseSnapshot({ kmh: -10 })).speedPercent).toBe(0);
  });

  test('running is false when crashed or time is up', () => {
    expect(engineParams(baseSnapshot()).running).toBe(true);
    expect(engineParams(baseSnapshot({ crash: { active: true, t: 0, frame: 0 } })).running).toBe(false);
    expect(engineParams(baseSnapshot({ timeLeft: 0 })).running).toBe(false);
  });
});

describe('isSkidding', () => {
  test('the skid comes from the physics, not from the steering frame', () => {
    const skid = {
      x: 0,
      z: 0,
      speed: 0,
      gear: 'hi' as const,
      steer: 2 as const,
      offRoad: false,
      braking: false,
      accelerating: false,
      surface: 'road' as const,
      skidding: true,
      steerHeld: 0,
    };
    const grip = { ...skid, skidding: false };
    expect(isSkidding(baseSnapshot({ kmh: 250, player: skid }))).toBe(true);
    expect(isSkidding(baseSnapshot({ kmh: 250, player: grip }))).toBe(false);
    expect(isSkidding(baseSnapshot({ kmh: 0, player: skid }))).toBe(true);
  });
});

function scriptedEngine(script: RaceEvent[][]): RaceEngine {
  let i = 0;
  let snap = baseSnapshot();
  return {
    update(_dt, _actions) {
      const events = script[i] ?? [];
      i++;
      return events;
    },
    snapshot() {
      return snap;
    },
  };
}

describe('createRaceScreen', () => {
  function makeDeps(engine: RaceEngine, audio: AudioBus): ScreenDeps {
    return {
      assets: createEmptyAssets(),
      audio,
      scores: createScoresStore(),
      raceFactory: () => engine,
      renderWorld: () => {},
      firstStage: stage,
    };
  }

  test('creates the engine on enter and forwards dt/actions to update', () => {
    let raceFactoryCalls = 0;
    let updateCalls = 0;
    const engine: RaceEngine = {
      update(dt, actions) {
        updateCalls++;
        expect(dt).toBe(1 / 60);
        expect(actions.accelerate).toBe(true);
        return [];
      },
      snapshot: () => baseSnapshot(),
    };
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: baseAudio(),
      scores: createScoresStore(),
      raceFactory: () => {
        raceFactoryCalls++;
        return engine;
      },
      renderWorld: () => {},
      firstStage: stage,
    };
    const screen = createRaceScreen(deps);
    screen.enter({ song: 1 });
    expect(raceFactoryCalls).toBe(1);
    screen.update(1 / 60, { ...emptyActions(), accelerate: true });
    expect(updateCalls).toBe(1);
  });

  test('plays sfx for events and calls setEngine/setSkid every tick', () => {
    const sfxCalls: string[] = [];
    let engineCalls = 0;
    let skidCalls = 0;
    const audio: AudioBus = {
      ...baseAudio(),
      sfx(name) {
        sfxCalls.push(name);
      },
      setEngine() {
        engineCalls++;
      },
      setSkid() {
        skidCalls++;
      },
      setRumble() {},
    };
    const engine = scriptedEngine([[{ type: 'checkpoint', bonus: 1000, nextStage: stage }]]);
    const screen = createRaceScreen(makeDeps(engine, audio));
    screen.enter({ song: 0 });
    screen.update(1 / 60, emptyActions());
    expect(sfxCalls).toEqual(['checkpoint']);
    expect(engineCalls).toBe(1);
    expect(skidCalls).toBe(1);
  });

  test('does not toggle mute itself: ui/app.ts handles actions.mute once for every screen', () => {
    let toggleCalls = 0;
    const audio: AudioBus = {
      ...baseAudio(),
      toggleMute() {
        toggleCalls++;
        return true;
      },
    };
    const engine = scriptedEngine([[], []]);
    const screen = createRaceScreen(makeDeps(engine, audio));
    screen.enter({ song: 0 });
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), mute: true });
    expect(toggleCalls).toBe(0);
  });

  test('returns the transition produced by a terminal event', () => {
    const engine = scriptedEngine([[{ type: 'finish', ending: 0, score: 100 }]]);
    const screen = createRaceScreen(makeDeps(engine, baseAudio()));
    screen.enter({ song: 0 });
    const t = screen.update(1 / 60, emptyActions());
    expect(t?.to).toBe('ending');
  });

  test('a crash event bursts the particle field (spec §4.4b)', () => {
    // Lo scoppio non si ricava dallo snapshot, che dice solo che
    // l'incidente e' in corso: e' l'evento 'crash' a farlo partire.
    const captured: { particles: ParticleField | null } = { particles: null };
    const engine = scriptedEngine([[{ type: 'crash' }]]);
    const deps: ScreenDeps = {
      ...makeDeps(engine, baseAudio()),
      renderWorld: (_ctx, _snapshot, _assets, p) => {
        captured.particles = p ?? null;
      },
    };
    const screen = createRaceScreen(deps);
    screen.enter({ song: 0 });
    screen.update(1 / 60, emptyActions());
    const ctx = { fillRect() {}, fillStyle: '' } as unknown as CanvasRenderingContext2D;
    screen.render(ctx);
    expect(captured.particles?.count).toBe(CRASH_DEBRIS + CRASH_SPARKS + 1);
  });

  test('the race draws the car chosen in the radio (Set 7)', () => {
    const cars: (string | undefined)[] = [];
    const engine = scriptedEngine([[], []]);
    const car = createCarSetting(undefined, 'sport');
    const deps: ScreenDeps = {
      ...makeDeps(engine, baseAudio()),
      car,
      renderWorld: (_ctx, _snapshot, _assets, _p, layers) => {
        cars.push(layers?.car);
      },
    };
    const screen = createRaceScreen(deps);
    screen.enter({ song: 0 });
    screen.update(1 / 60, emptyActions());
    const ctx = { fillRect() {}, fillStyle: '' } as unknown as CanvasRenderingContext2D;
    screen.render(ctx);
    car.toggle();
    screen.render(ctx);
    expect(cars).toEqual(['sport', 'super']);
  });

  test('renders without throwing via renderWorld and the real HUD', () => {
    const engine = scriptedEngine([[]]);
    const screen = createRaceScreen(makeDeps(engine, baseAudio()));
    screen.enter({ song: 0 });
    const ctx = { fillRect() {}, fillStyle: '' } as unknown as CanvasRenderingContext2D;
    expect(() => screen.render(ctx)).not.toThrow();
  });

  test('calls engine.snapshot() only once per tick and reuses it for render', () => {
    let snapshotCalls = 0;
    let updateCalls = 0;
    const engine: RaceEngine = {
      update(_dt, _actions) {
        updateCalls++;
        return [];
      },
      snapshot() {
        snapshotCalls++;
        return baseSnapshot();
      },
    };
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: baseAudio(),
      scores: createScoresStore(),
      raceFactory: () => engine,
      renderWorld: () => {},
      firstStage: stage,
    };
    const screen = createRaceScreen(deps);
    screen.enter({ song: 0 });
    screen.update(1 / 60, emptyActions());
    expect(updateCalls).toBe(1);
    expect(snapshotCalls).toBe(1); // one snapshot for this tick, not two

    const ctx = { fillRect() {}, fillStyle: '' } as unknown as CanvasRenderingContext2D;
    screen.render(ctx);
    expect(snapshotCalls).toBe(1); // render() reuses update()'s snapshot instead of taking its own
  });

  test('exit stops engine and skid sounds and drops the engine', () => {
    const calls: unknown[] = [];
    const audio: AudioBus = {
      ...baseAudio(),
      setEngine(sp, gear, running) {
        calls.push(['engine', sp, gear, running]);
      },
      setSkid(on) {
        calls.push(['skid', on]);
      },
      setRumble() {},
    };
    let renderWorldCalls = 0;
    const engine = scriptedEngine([[]]);
    const deps = { ...makeDeps(engine, audio), renderWorld: () => renderWorldCalls++ };
    const screen = createRaceScreen(deps);
    screen.enter({ song: 0 });
    screen.exit?.();
    expect(calls).toContainEqual(['engine', 0, 'lo', false]);
    expect(calls).toContainEqual(['skid', false]);

    const ctx = { fillRect() {}, fillStyle: '' } as unknown as CanvasRenderingContext2D;
    renderWorldCalls = 0;
    expect(() => screen.render(ctx)).not.toThrow();
    expect(renderWorldCalls).toBe(0); // l'engine è stato droppato: render non ha più nulla da disegnare
  });

  test('exit stops the song too: leaving race for game over or the ending must not leave a personal track looping (Minor 1 della revisione finale)', () => {
    let stopSongCalls = 0;
    const audio: AudioBus = {
      ...baseAudio(),
      stopSong() {
        stopSongCalls++;
      },
    };
    const engine = scriptedEngine([[]]);
    const screen = createRaceScreen(makeDeps(engine, audio));
    screen.enter({ song: 4 }); // un brano personale, per esempio
    screen.exit?.();
    expect(stopSongCalls).toBe(1);
  });
});

describe('createRaceScreen with assets in phases (launch, point 12)', () => {
  /** Uno store a fasi finto: i file di una tappa sono pronti quando `ready` lo dice. */
  function stagedAssets(ready: Set<string>): { assets: ScreenDeps['assets']; asked: string[] } {
    const asked: string[] = [];
    const assets = Object.assign(createEmptyAssets(), {
      requestStage(s: { id: string }, car: string) {
        asked.push(`${s.id}/${car}`);
        return ready.has(s.id);
      },
    });
    return { assets, asked };
  }

  function setup(ready: Set<string>) {
    let updates = 0;
    const engine: RaceEngine = {
      update() {
        updates++;
        return [];
      },
      snapshot: () => baseSnapshot({ stage: { ...stage, id: '2-1', theme: 'alpine' } }),
    };
    const staged = stagedAssets(ready);
    const screen = createRaceScreen({
      assets: staged.assets,
      audio: baseAudio(),
      scores: createScoresStore(),
      car: createCarSetting(undefined, 'retro'),
      raceFactory: () => engine,
      renderWorld: () => {},
      firstStage: stage,
    });
    screen.enter({ song: 0 });
    return { screen, asked: staged.asked, updates: () => updates };
  }

  test('a stage whose sprites have not arrived waits, with the engine still, then starts', () => {
    const ready = new Set<string>();
    const { screen, asked, updates } = setup(ready);
    for (let i = 0; i < 30; i++) screen.update(1 / 60, emptyActions());
    expect(updates()).toBe(0);
    expect(asked[0]).toBe('2-1/retro');
    ready.add('2-1');
    screen.update(1 / 60, emptyActions());
    expect(updates()).toBe(1);
    // Pronta la tappa, passano avanti le due del bivio dopo.
    expect(asked.slice(-2)).toEqual(['3-1/retro', '3-2/retro']);
  });

  test('while it waits it draws the loading bar of the stage, not the road with the fallbacks', () => {
    let worlds = 0;
    const engine: RaceEngine = { update: () => [], snapshot: () => baseSnapshot({ stage: { ...stage, id: '2-1', theme: 'alpine' } }) };
    const assets = Object.assign(createEmptyAssets(), {
      requestStage: () => false,
      stageProgress: () => ({ done: 3, total: 12 }),
    });
    const screen = createRaceScreen({
      assets,
      audio: baseAudio(),
      scores: createScoresStore(),
      raceFactory: () => engine,
      renderWorld: () => void worlds++,
      firstStage: stage,
    });
    screen.enter({ song: 0 });
    screen.update(1 / 60, emptyActions());
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    expect(worlds).toBe(0);
    // La barra di `drawLoadingScreen`, piena per 3 file su 12.
    expect(rec.fills().some((op) => op.args.join() === [LOADING_BAR_X, LOADING_BAR_Y, 160, LOADING_BAR_H].join())).toBe(true);
  });

  test('it waits at most STAGE_WAIT_S seconds (a network hung for a minute), then drives with the fallbacks', () => {
    expect(STAGE_WAIT_S).toBe(60);
    const { screen, updates } = setup(new Set());
    for (let i = 0; i < STAGE_WAIT_S * 60 + 2; i++) screen.update(1 / 60, emptyActions());
    expect(updates()).toBeGreaterThan(0);
    const after = updates();
    screen.update(1 / 60, emptyActions());
    expect(updates()).toBe(after + 1);
  });
});
