import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import {
  createEndingScreen,
  ENDING_DURATION_S,
  parseEndingPayload,
  stepEnding,
  type EndingState,
  coverRect,
  endingImageRect,
  ENDING_CONGRATS_Y,
  ENDING_SCROLL_MIN_Y,
} from '../../../src/ui/screens/ending';
import { go } from '../../../src/ui/fsm';
import { endingDef } from '../../../src/game/endings';
import { createCarSetting } from '../../../src/persist/car';
import { createScoresStore, type ScoresStore } from '../../../src/persist/scores';
import { createRecordCtx } from '../../helpers/recordCtx';
import type { ScreenDeps } from '../../../src/ui/deps';
import type { AssetStore, CarChoice, SpriteAsset, StageDef } from '../../../src/types';

const stage: StageDef = { id: '4-1', name: 'Glacier Road', theme: 'alpine', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0.8 };
const fallbackStage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 };

function state(qualifies: boolean, t = 0): EndingState {
  return { t, payload: { score: 900, ending: 1, stage, route: ['L', 'R'] }, qualifies };
}

describe('stepEnding', () => {
  test('does nothing before the duration without confirm', () => {
    const r = stepEnding(state(true), 1, emptyActions());
    expect(r.transition).toBeNull();
    expect(r.state.t).toBe(1);
  });

  test('confirm before the duration routes to nameEntry when qualifying, with stageId extracted from the stage', () => {
    const r = stepEnding(state(true, 1), 1 / 60, { ...emptyActions(), confirm: true });
    expect(r.transition).toEqual(go('nameEntry', { score: 900, stageId: '4-1', route: ['L', 'R'] }));
  });

  test('confirm before the duration is RETRY when not qualifying, with the same song', () => {
    const r = stepEnding(state(false, 1), 1 / 60, { ...emptyActions(), confirm: true });
    expect(r.transition).toEqual(go('race', { song: 0 }));
    const withSong: EndingState = { ...state(false, 1), payload: { ...state(false).payload, song: 1 } };
    expect(stepEnding(withSong, 1 / 60, { ...emptyActions(), back: true }).transition).toEqual(go('title', undefined));
    expect(stepEnding(withSong, 1 / 60, { ...emptyActions(), confirm: true }).transition).toEqual(go('race', { song: 1 }));
  });

  test('reaching the duration transitions automatically, even without confirm', () => {
    let s = state(true, ENDING_DURATION_S - 1);
    let transition = null;
    for (let i = 0; i < 60; i++) {
      const r = stepEnding(s, 1 / 60, emptyActions());
      s = r.state;
      transition = r.transition;
      if (transition) break;
    }
    expect(transition).toEqual(go('nameEntry', { score: 900, stageId: '4-1', route: ['L', 'R'] }));
  });
});

describe('parseEndingPayload', () => {
  test('passes through a well-formed payload', () => {
    expect(parseEndingPayload({ score: 10, ending: 2, stage, route: ['L'] }, fallbackStage)).toEqual({
      score: 10,
      ending: 2,
      stage,
      route: ['L'],
    });
  });

  test('falls back to the given stage and sane defaults for missing or malformed input', () => {
    expect(parseEndingPayload(undefined, fallbackStage)).toEqual({
      score: 0,
      ending: 0,
      stage: fallbackStage,
      route: [],
    });
    expect(parseEndingPayload({ score: 'x' }, fallbackStage)).toEqual({
      score: 0,
      ending: 0,
      stage: fallbackStage,
      route: [],
    });
  });
});

function makeEndingDeps(scores: ScoresStore): ScreenDeps {
  return {
    assets: createEmptyAssets(),
    audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
    scores,
    raceFactory: () => {
      throw new Error('unused');
    },
    renderWorld: () => {},
    firstStage: fallbackStage,
  };
}

describe('createEndingScreen', () => {
  test('calls scores.qualifies once on enter, with the payload score', () => {
    const calls: number[] = [];
    const scores = {
      load: () => [],
      qualifies: (score: number) => {
        calls.push(score);
        return true;
      },
      insert: () => {},
      clear: () => {},
    } as unknown as ScoresStore;
    const screen = createEndingScreen(makeEndingDeps(scores));
    screen.enter({ score: 555, ending: 0, stage, route: [] });
    expect(calls).toEqual([555]);
    const ctx = {
      fillRect() {},
      drawImage() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      fillStyle: '',
      beginPath() {},
      arc() {},
      fill() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    expect(() => screen.render(ctx)).not.toThrow();
  });

  test('falls back to firstStage when entered with a malformed payload, without throwing', () => {
    const scores = { load: () => [], qualifies: () => true, insert: () => {}, clear: () => {} } as unknown as ScoresStore;
    const screen = createEndingScreen(makeEndingDeps(scores));
    expect(() => screen.enter(undefined)).not.toThrow();
    const r = screen.update(1 / 60, { ...emptyActions(), confirm: true });
    expect(r).toEqual(go('nameEntry', { score: 0, stageId: fallbackStage.id, route: [] }));
  });
});

describe('coverRect: l illustrazione riempie il frame (task 15)', () => {
  test('una immagine piu larga che alta si ingrandisce fino a coprire l altezza', () => {
    const r = coverRect(1100, 480, 1280, 720);
    expect(r.h).toBeCloseTo(720, 9);
    expect(r.w).toBeGreaterThanOrEqual(1280);
    // Proporzioni conservate.
    expect(r.w / r.h).toBeCloseTo(1100 / 480, 9);
  });

  test('una immagine piu alta che larga si ingrandisce fino a coprire la larghezza', () => {
    const r = coverRect(480, 1100, 1280, 720);
    expect(r.w).toBeCloseTo(1280, 9);
    expect(r.h).toBeGreaterThanOrEqual(720);
  });

  test('una immagine esattamente del riquadro non cambia', () => {
    expect(coverRect(1280, 720, 1280, 720)).toEqual({ w: 1280, h: 720 });
  });

  test('una immagine senza misura torna il riquadro', () => {
    expect(coverRect(0, 0, 1280, 720)).toEqual({ w: 1280, h: 720 });
    expect(coverRect(Number.NaN, 10, 1280, 720)).toEqual({ w: 1280, h: 720 });
  });
});

describe('endingImageRect: finali 16:9 interi, 8:3 in «cover» (consegna v2)', () => {
  test('a 16:9 image fills the frame exactly, nothing cut', () => {
    expect(endingImageRect(1280, 720, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    // Un pixel in meno non la fa ricadere nel «cover».
    expect(endingImageRect(1280, 719, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(endingImageRect(1920, 1080, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  test('an 8:3 image keeps the old cover: full height, centred, cut at the sides', () => {
    const r = endingImageRect(1280, 480, 1280, 720);
    expect(r.h).toBeCloseTo(720, 9);
    expect(r.w).toBeCloseTo(1920, 9);
    expect(r.x).toBeCloseTo(-320, 9);
    expect(r.y).toBeCloseTo(0, 9);
  });

  const drawnRect = (w: number, h: number): number[] => {
    const assets: AssetStore = {
      ready: Promise.resolve(),
      get: (name): SpriteAsset => ({
        name,
        image: { name } as unknown as CanvasImageSource,
        w: name === 'ending_border' ? 1280 : w,
        h: name === 'ending_border' ? 480 : h,
        entry: { kind: 'illustration', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
      }),
      has: () => true,
      stats: { png: 0, procedural: 0, missing: 0 },
    };
    const screen = createEndingScreen({ ...makeEndingDeps(createScoresStore()), assets });
    screen.enter({ score: 1, ending: 0, stage, route: [] });
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    const op = rec.images().find((o) => o.image === 'ending_1');
    expect(op).toBeDefined();
    return op!.args;
  };

  test('the dark band behind the scrolling text also covers the score line, and stays below CONGRATULATIONS', () => {
    const screen = createEndingScreen(makeEndingDeps(createScoresStore()));
    screen.enter({ score: 1, ending: 0, stage, route: [] });
    screen.update(7, emptyActions());
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    const band = rec.ops.find((op) => op.type === 'fillRect' && op.fill === 'rgba(0,0,0,0.55)');
    expect(band).toBeDefined();
    const [, top, , h] = band!.args;
    const scroll = Math.max(ENDING_SCROLL_MIN_Y, 720 - 7 * 60);
    const lines = endingDef(0).lines.length;
    // Riga del punteggio: glifi da 8 px a scala 3 a partire da questa y.
    const scoreTop = scroll + 50 + lines * 26 + 14;
    expect(top + h).toBeGreaterThanOrEqual(scoreTop + 24);
    expect(top).toBeGreaterThanOrEqual(ENDING_CONGRATS_Y + 24);
  });

  test('the screen draws a 16:9 ending at 0,0 1280x720', () => {
    expect(drawnRect(1280, 720)).toEqual([0, 0, 1280, 720]);
  });

  test('the screen still draws an 8:3 ending (the classic car ones) in cover', () => {
    expect(drawnRect(1280, 480)).toEqual([-320, 0, 1920, 720]);
  });
});

describe('i finali seguono l\'auto scelta (Set 7)', () => {
  const store = (known: (name: string) => boolean = () => true): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 1280,
      h: 480,
      entry: { kind: 'illustration', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
    }),
    has: known,
    stats: { png: 0, procedural: 0, missing: 0 },
  });
  const drawn = (car: CarChoice | undefined, ending: number, known?: (name: string) => boolean): string[] => {
    const scores = createScoresStore();
    const deps: ScreenDeps = { ...makeEndingDeps(scores), assets: store(known), car: car === undefined ? undefined : createCarSetting(undefined, car) };
    const screen = createEndingScreen(deps);
    screen.enter({ score: 1, ending, stage, route: [] });
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    return rec.images().map((op) => op.image ?? '');
  };

  const known = (name: string): boolean => !/^ending_(retro|sport)_/.test(name);

  test('retro and sport have no endings of their own: they get the Set 7 ones', () => {
    for (const car of ['retro', 'sport'] as const) {
      expect(drawn(car, 2, known)).toContain('ending_3');
      expect(drawn(car, 0, known)).toContain('ending_1');
    }
    expect(drawn('new', 2, known)).toContain('ending_3');
    expect(drawn(undefined, 2, known)).toContain('ending_3');
  });

  test('the classic car gets its own endings 1-5', () => {
    expect(drawn('classic', 2, known)).toContain('ending_classic_3');
    expect(drawn('classic', 0, known)).toContain('ending_classic_1');
  });

  test('an ending_<car>_N is used as soon as it exists', () => {
    expect(drawn('retro', 2)).toContain('ending_retro_3');
    expect(drawn('sport', 0)).toContain('ending_sport_1');
    expect(drawn('new', 2)).toContain('ending_3');
  });
});
