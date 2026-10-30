import { ENDINGS_RECT } from '../../../src/ui/titleLayout';
import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import {
  ATTRACT_CENTRE_DEADZONE,
  ATTRACT_CYCLE_S,
  ATTRACT_PHASE_S,
  ATTRACT_SHIFT_PERCENT,
  ATTRACT_SPEED_PERCENT,
  attractActions,
  createTitleScreen,
  initialTitleState,
  parseTitlePayload,
  stepTitle,
  titleBlinkOn,
} from '../../../src/ui/screens/title';
import { go } from '../../../src/ui/fsm';
import { createNullAudio } from '../../../src/dev/null-audio';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createScoresStore } from '../../../src/persist/scores';
import type { ScreenDeps } from '../../../src/ui/deps';
import { LOGICAL_H, LOGICAL_W } from '../../../src/core/canvas';
import { createRecordCtx } from '../../helpers/recordCtx';
import type { Actions, AssetStore, RaceEngine, RaceSnapshot, SpriteAsset, StageDef } from '../../../src/types';

const stage: StageDef = {
  id: '0-0',
  name: 'Palm Bay',
  theme: 'beach',
  lengthSegments: 2260,
  timeLimit: 75,
  seed: 1,
  difficulty: 0.15,
};

describe('stepTitle', () => {
  test('confirm transitions to radio immediately', () => {
    const r = stepTitle(initialTitleState(), 1 / 60, { ...emptyActions(), confirm: true });
    expect(r.transition).toEqual(go('radio', undefined));
  });

  test('confirm wins even if another action is held at the same time', () => {
    const r = stepTitle(initialTitleState(), 1 / 60, { ...emptyActions(), confirm: true, accelerate: true });
    expect(r.transition).toEqual(go('radio', undefined));
  });

  test('idle timer resets on any held action, other than causing a transition', () => {
    let state = initialTitleState();
    for (let i = 0; i < 60; i++) state = stepTitle(state, 1, { ...emptyActions(), left: true }).state;
    expect(state.idleT).toBe(0);
  });

  test('idle timer accumulates without input and transitions to scores at the threshold', () => {
    let state = initialTitleState();
    let transition = null;
    for (let i = 0; i < ATTRACT_CYCLE_S; i++) {
      const r = stepTitle(state, 1, emptyActions());
      state = r.state;
      transition = r.transition;
    }
    expect(transition).toEqual(go('scores', undefined));
  });

  test('holding a non-confirm action never causes a transition on its own', () => {
    let state = initialTitleState();
    for (let i = 0; i < 100; i++) {
      const r = stepTitle(state, 1 / 60, { ...emptyActions(), left: true });
      state = r.state;
      expect(r.transition).toBeNull();
    }
  });
});

describe('parseTitlePayload', () => {
  test('always returns undefined, regardless of input', () => {
    expect(parseTitlePayload(undefined)).toBeUndefined();
    expect(parseTitlePayload({ garbage: 1 })).toBeUndefined();
  });
});

describe('titleBlinkOn', () => {
  test('is on for at least 70% of a one second cycle, off for the rest', () => {
    expect(titleBlinkOn(0)).toBe(true);
    expect(titleBlinkOn(0.5)).toBe(true);
    expect(titleBlinkOn(0.74)).toBe(true);
    expect(titleBlinkOn(0.76)).toBe(false);
    expect(titleBlinkOn(0.99)).toBe(false);
    expect(titleBlinkOn(1)).toBe(true);
    expect(titleBlinkOn(1.74)).toBe(true);
    expect(titleBlinkOn(1.76)).toBe(false);
  });
});

function snapshotWith(over: { x?: number; kmh?: number; gear?: 'lo' | 'hi' } = {}): RaceSnapshot {
  return {
    segments: [],
    player: {
      x: over.x ?? 0,
      z: 0,
      speed: 0,
      gear: over.gear ?? 'lo',
      steer: 0,
      offRoad: false,
      braking: false,
      accelerating: false,
      surface: 'road',
      skidding: false,
      steerHeld: 0,
    },
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 75,
    score: 0,
    stage,
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme: 'beach',
    banner: 'none',
    kmh: over.kmh ?? 0,
  };
}

describe('attractActions (spec §11)', () => {
  test('it accelerates below the cruising speed and lifts off above it', () => {
    expect(attractActions(snapshotWith({ kmh: 0 })).accelerate).toBe(true);
    expect(attractActions(snapshotWith({ kmh: 293 * (ATTRACT_SPEED_PERCENT - 0.01) })).accelerate).toBe(true);
    expect(attractActions(snapshotWith({ kmh: 293 * (ATTRACT_SPEED_PERCENT + 0.01) })).accelerate).toBe(false);
  });

  test('it steers toward the centre of the road, and not at all inside the deadzone', () => {
    const right = attractActions(snapshotWith({ x: 0.5 }));
    expect([right.left, right.right]).toEqual([true, false]);
    const left = attractActions(snapshotWith({ x: -0.5 }));
    expect([left.left, left.right]).toEqual([false, true]);
    const centre = attractActions(snapshotWith({ x: ATTRACT_CENTRE_DEADZONE }));
    expect([centre.left, centre.right]).toEqual([false, false]);
  });

  test('it never brakes, confirms or mutes: the autopilot must not drive the menus', () => {
    for (const kmh of [0, 100, 293]) {
      const a = attractActions(snapshotWith({ kmh }));
      expect(a.brake).toBe(false);
      expect(a.confirm).toBe(false);
      expect(a.back).toBe(false);
      expect(a.mute).toBe(false);
    }
  });

  test('it shifts up exactly once: the toggle is asked for only while the gear is still low', () => {
    const slow = snapshotWith({ kmh: 293 * (ATTRACT_SHIFT_PERCENT - 0.01), gear: 'lo' });
    expect(attractActions(slow).gearToggle).toBe(false);
    const ready = snapshotWith({ kmh: 293 * (ATTRACT_SHIFT_PERCENT + 0.01), gear: 'lo' });
    expect(attractActions(ready).gearToggle).toBe(true);
    const shifted = snapshotWith({ kmh: 293 * (ATTRACT_SHIFT_PERCENT + 0.01), gear: 'hi' });
    expect(attractActions(shifted).gearToggle).toBe(false);
  });
});

/**
 * Motore finto per l'autopilota: registra le azioni ricevute e avanza x e
 * kmh come farebbe il motore vero, così il test può verificare che il
 * titolo lo piloti e non solo che lo costruisca.
 */
function fakeAttractEngine(): { engine: RaceEngine; actions: Actions[]; snapshots: number } {
  const actions: Actions[] = [];
  let x = 0.4;
  let kmh = 0;
  let snapshots = 0;
  const engine: RaceEngine = {
    update(dt, a) {
      actions.push(a);
      if (a.accelerate) kmh = Math.min(293, kmh + 200 * dt);
      if (a.left) x -= dt;
      if (a.right) x += dt;
      return [];
    },
    snapshot() {
      snapshots++;
      return snapshotWith({ x, kmh });
    },
  };
  return {
    engine,
    actions,
    get snapshots() {
      return snapshots;
    },
  };
}

function makeDeps(): ScreenDeps {
  return {
    assets: createEmptyAssets(),
    audio: createNullAudio(),
    scores: createScoresStore(),
    raceFactory: () => {
      throw new Error('the title must use attractFactory, not raceFactory');
    },
    attractFactory: () => fakeAttractEngine().engine,
    renderWorld: () => {},
    firstStage: stage,
  };
}

describe('createTitleScreen', () => {
  test('renders and updates without throwing', () => {
    const deps = makeDeps();
    const screen = createTitleScreen(deps);
    screen.enter();
    const ctx = { fillRect() {}, fillStyle: '', drawImage() {} } as unknown as CanvasRenderingContext2D;
    expect(() => {
      screen.update(1 / 60, emptyActions());
      screen.render(ctx);
    }).not.toThrow();
  });

  test('it builds the attract engine on enter and drives it every tick', () => {
    const rig = fakeAttractEngine();
    let built = 0;
    const deps: ScreenDeps = {
      ...makeDeps(),
      attractFactory: (s, a) => {
        built++;
        expect(s).toEqual(stage);
        expect(a).toBe(deps.assets);
        return rig.engine;
      },
    };
    const screen = createTitleScreen(deps);
    screen.enter();
    expect(built).toBe(1);

    for (let i = 0; i < 10; i++) screen.update(1 / 60, emptyActions());
    expect(rig.actions).toHaveLength(10);
    // gas da fermo, e sterzo a sinistra perché il finto parte a destra
    expect(rig.actions[0]?.accelerate).toBe(true);
    expect(rig.actions[0]?.left).toBe(true);
  });

  test('it renders the world it is driving, one snapshot per tick', () => {
    const rig = fakeAttractEngine();
    const seen: RaceSnapshot[] = [];
    const deps: ScreenDeps = {
      ...makeDeps(),
      attractFactory: () => rig.engine,
      renderWorld: (_ctx, snap) => seen.push(snap),
    };
    const screen = createTitleScreen(deps);
    const ctx = { fillRect() {}, fillStyle: '', drawImage() {} } as unknown as CanvasRenderingContext2D;

    screen.enter();
    const afterEnter = rig.snapshots;
    expect(afterEnter).toBe(1);
    // Il ciclo attrattivo disegna il mondo solo nella fase 'demo' (spec §11).
    screen.update(ATTRACT_PHASE_S, emptyActions());
    screen.render(ctx);
    screen.render(ctx);
    // due render con un solo update non chiedono un secondo snapshot
    expect(rig.snapshots).toBe(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  test('"PRESS ENTER" moves below the route graph in the map phase (spec §11)', () => {
    // A y = 420 la scritta cadeva dentro il triangolo dei quindici nodi,
    // che `drawRouteMapPanel` disegna a schermo intero (revisione finale,
    // minore parcheggiato). Nella fase mappa deve scendere sotto il grafo.
    const screen = createTitleScreen(makeDeps());
    screen.enter();

    const titleRec = createRecordCtx();
    screen.render(titleRec.ctx);
    // Fuori dalla voce ENDINGS in alto a sinistra (spec telefono e finali §C).
    const titleGlyphY = titleRec.ops
      .filter((op) => op.type === 'fillRect' && op.fill !== '#000000' && op.args[1] > ENDINGS_RECT.y + ENDINGS_RECT.h)
      .map((op) => op.args[1]);
    expect(titleGlyphY.length).toBeGreaterThan(0);
    expect(Math.min(...titleGlyphY)).toBeCloseTo(419, 0);

    // Due fasi intere più un pelo: oltre la finestra di dissolvenza, così
    // niente velo nero copre i fillRect del glifo.
    screen.update(ATTRACT_PHASE_S * 2 + 1, emptyActions());
    const mapRec = createRecordCtx();
    screen.render(mapRec.ctx);
    const mapGlyphY = mapRec.ops
      .filter((op) => op.type === 'fillRect' && op.fill !== '#000000' && op.args[1] > 500)
      .map((op) => op.args[1]);
    expect(mapGlyphY.length).toBeGreaterThan(0);
    expect(Math.min(...mapGlyphY)).toBeCloseTo(679, 0);
    // E non resta più anche alla vecchia quota, dentro il grafo.
    expect(mapRec.ops.some((op) => op.type === 'fillRect' && op.fill !== '#000000' && op.args[1] === 419)).toBe(
      false,
    );
  });

  test('exit throws the attract engine away, and a render right after draws no world', () => {
    const rig = fakeAttractEngine();
    const seen: RaceSnapshot[] = [];
    const deps: ScreenDeps = {
      ...makeDeps(),
      attractFactory: () => rig.engine,
      renderWorld: (_ctx, snap) => seen.push(snap),
    };
    const screen = createTitleScreen(deps);
    const ctx = { fillRect() {}, fillStyle: '', drawImage() {} } as unknown as CanvasRenderingContext2D;

    screen.enter();
    // Il ciclo attrattivo disegna il mondo solo nella fase 'demo' (spec §11).
    screen.update(ATTRACT_PHASE_S, emptyActions());
    screen.render(ctx);
    expect(seen).toHaveLength(1);

    screen.exit?.();
    screen.render(ctx);
    expect(seen).toHaveLength(1);
    // e non guida più nemmeno se qualcuno chiamasse update dopo exit
    const driven = rig.actions.length;
    screen.update(1 / 60, emptyActions());
    expect(rig.actions).toHaveLength(driven);
  });

  test('reads the scores store once on enter, not once per render', () => {
    const rig = fakeAttractEngine();
    const store = createScoresStore();
    store.insert({ name: 'AAA', score: 999, stageId: '0-0', route: 'L', date: '2026-01-01T00:00:00.000Z' });
    let loadCalls = 0;
    const spiedStore = {
      ...store,
      load() {
        loadCalls++;
        return store.load();
      },
    };
    const deps: ScreenDeps = { ...makeDeps(), attractFactory: () => rig.engine, scores: spiedStore };
    const screen = createTitleScreen(deps);
    const ctx = { fillRect() {}, fillStyle: '', drawImage() {} } as unknown as CanvasRenderingContext2D;

    screen.enter();
    expect(loadCalls).toBe(1);
    screen.update(1 / 60, emptyActions());
    screen.render(ctx);
    screen.render(ctx);
    screen.render(ctx);
    expect(loadCalls).toBe(1);
  });

  test('without attractFactory it falls back to raceFactory', () => {
    const rig = fakeAttractEngine();
    let used = 0;
    const base = makeDeps();
    const deps: ScreenDeps = {
      ...base,
      raceFactory: () => {
        used++;
        return rig.engine;
      },
    };
    delete deps.attractFactory;
    const screen = createTitleScreen(deps);
    screen.enter();
    expect(used).toBe(1);
  });
});

/** AssetStore finto in cui solo i nomi dati sono "presenti". */
function assetsWith(present: readonly string[]): AssetStore {
  return {
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: name === 'screen_attract' ? LOGICAL_W : 747,
      h: name === 'screen_attract' ? LOGICAL_H : 300,
      entry: { kind: 'illustration', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
    }),
    has: (name) => present.includes(name),
    stats: { png: present.length, procedural: 0, missing: 0 },
  };
}

describe('sfondo del titolo: la gara vera in autopilota (merge H+G)', () => {
  test('screen_attract e il logo nella fase 0, la gara guidata nella fase demo', () => {
    // Il ruling del merge H+G («niente fermo immagine, sempre il mondo in
    // movimento») vale ora **dentro** il ciclo attrattivo di spec §11: la
    // fase 0 e' l'illustrazione con il logo, la fase 1 e' la strada guidata
    // da `attractFactory` + `attractActions`, la fase 2 la mappa. Nessuna
    // delle tre e' fissa per piu' di ATTRACT_PHASE_S secondi.
    let worldCalls = 0;
    const rec = createRecordCtx();
    const screen = createTitleScreen({
      ...makeDeps(),
      assets: assetsWith(['screen_attract', 'title_logo']),
      renderWorld: () => {
        worldCalls += 1;
      },
    });
    screen.enter(undefined);
    screen.render(rec.ctx);
    expect(worldCalls, 'la fase 0 non disegna il mondo').toBe(0);
    expect(rec.ops.find((op) => op.image === 'screen_attract')).toBeDefined();
    screen.update(ATTRACT_PHASE_S, emptyActions());
    const demo = createRecordCtx();
    screen.render(demo.ctx);
    expect(worldCalls, 'la fase demo disegna il mondo').toBe(1);
    expect(demo.ops.find((op) => op.image === 'screen_attract')).toBeUndefined();
  });

  test('senza nessuna illustrazione disegna comunque il mondo', () => {
    let worldCalls = 0;
    const rec = createRecordCtx();
    const screen = createTitleScreen({
      ...makeDeps(),
      assets: assetsWith([]),
      renderWorld: () => {
        worldCalls += 1;
      },
    });
    screen.enter(undefined);
    screen.update(ATTRACT_PHASE_S, emptyActions());
    screen.render(rec.ctx);
    expect(worldCalls).toBe(1);
  });

  test('il titolo non passa un campo di particelle a renderWorld: niente fumo sotto il logo', () => {
    const seen: (unknown | undefined)[] = [];
    const screen = createTitleScreen({
      ...makeDeps(),
      assets: assetsWith(['title_logo']),
      renderWorld: (_ctx, _snap, _assets, particles) => {
        seen.push(particles);
      },
    });
    screen.enter(undefined);
    screen.update(ATTRACT_PHASE_S, emptyActions());
    screen.render(createRecordCtx().ctx);
    expect(seen).toEqual([undefined]);
  });

  test('le scritte del titolo hanno il contorno scuro', () => {
    const rec = createRecordCtx();
    const screen = createTitleScreen({ ...makeDeps(), assets: assetsWith([]) });
    screen.enter(undefined);
    screen.render(rec.ctx);
    expect(rec.ops.some((op) => op.type === 'fillRect' && op.fill === '#101018')).toBe(true);
  });
});
