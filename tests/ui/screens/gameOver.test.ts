import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import {
  createGameOverScreen,
  GAME_OVER_BG,
  GAME_OVER_DURATION_S,
  gameOverLayout,
  gameOverLines,
  parseGameOverPayload,
  stageLabels,
  stepGameOver,
  type GameOverState,
} from '../../../src/ui/screens/gameOver';
import { go } from '../../../src/ui/fsm';
import type { ScoresStore } from '../../../src/persist/scores';
import type { ScreenDeps } from '../../../src/ui/deps';
import type { AssetStore, SpriteAsset, StageDef } from '../../../src/types';
import { CATALOG } from '../../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../../src/core/canvas';
import { STAGES } from '../../../src/game/stages';
import {
  BIG_CURRENT_R,
  BIG_VISITED_R,
  MAP_CURRENT,
  MAP_EDGE_ON,
  MAP_NODE_ON,
  nodeCentreOf,
  visitedStages,
} from '../../../src/render/routeMap';
import { createRecordCtx, type Recorder } from '../../helpers/recordCtx';

const stage: StageDef = { id: '2-1', name: 'Pine Pass', theme: 'alpine', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0.45 };
const fallbackStage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 };

function state(qualifies: boolean, t = 0): GameOverState {
  return { t, payload: { score: 300, stage, route: ['L'] }, qualifies };
}

describe('stepGameOver', () => {
  test('does nothing before the duration without confirm', () => {
    const r = stepGameOver(state(true), 1, emptyActions());
    expect(r.transition).toBeNull();
  });

  test('confirm routes to nameEntry when qualifying, to scores otherwise', () => {
    expect(stepGameOver(state(true, 1), 1 / 60, { ...emptyActions(), confirm: true }).transition).toEqual(
      go('nameEntry', { score: 300, stageId: '2-1', route: ['L'] }),
    );
    expect(stepGameOver(state(false, 1), 1 / 60, { ...emptyActions(), confirm: true }).transition).toEqual(
      go('scores', undefined),
    );
  });

  test('reaching the duration transitions automatically', () => {
    let s = state(false, GAME_OVER_DURATION_S - 0.5);
    const r = stepGameOver(s, 1, emptyActions());
    expect(r.transition).toEqual(go('scores', undefined));
  });
});

describe('parseGameOverPayload', () => {
  test('passes through a well-formed payload', () => {
    expect(parseGameOverPayload({ score: 40, stage, route: ['R'] }, fallbackStage)).toEqual({
      score: 40,
      stage,
      route: ['R'],
    });
  });

  test('falls back to the given stage and sane defaults for missing or malformed input', () => {
    expect(parseGameOverPayload(undefined, fallbackStage)).toEqual({ score: 0, stage: fallbackStage, route: [] });
  });
});

function makeGameOverDeps(scores: ScoresStore): ScreenDeps {
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

describe('createGameOverScreen', () => {
  test('calls scores.qualifies once on enter and renders without throwing', () => {
    const calls: number[] = [];
    const scores = {
      load: () => [],
      qualifies: (score: number) => {
        calls.push(score);
        return false;
      },
      insert: () => {},
      clear: () => {},
    } as unknown as ScoresStore;
    const screen = createGameOverScreen(makeGameOverDeps(scores));
    screen.enter({ score: 77, stage, route: [] });
    expect(calls).toEqual([77]);
    const rec = createRecordCtx();
    expect(() => screen.render(rec.ctx)).not.toThrow();
  });
});

/** Asset con il nome e la misura vera della mappa (1279x720), per il registratore. */
const namedStore = (w = 1279, h = 720): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w,
    h,
    entry: CATALOG[name] ?? { kind: 'illustration', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

const quietScores = {
  load: () => [],
  qualifies: () => true,
  insert: () => 1,
  clear: () => {},
} as unknown as ScoresStore;

function renderGameOver(
  payload: { score: number; stage: StageDef; route: ('L' | 'R')[] },
  t = 0,
  assets: AssetStore = namedStore(),
): Recorder {
  const screen = createGameOverScreen({ ...makeGameOverDeps(quietScores), assets });
  screen.enter(payload);
  if (t > 0) screen.update(t, emptyActions());
  const rec = createRecordCtx();
  screen.render(rec.ctx);
  return rec;
}

const inside = (r: { x: number; y: number; w: number; h: number }): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= LOGICAL_W && r.y + r.h <= LOGICAL_H;

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('schermata di game over a tutto schermo', () => {
  const far = { score: 1234567, stage: STAGES.get('2-1')!, route: ['L', 'R'] as ('L' | 'R')[] };

  test('the route map takes at least 70% of the width and stays on screen', () => {
    const { map } = gameOverLayout(far);
    expect(map.w).toBeGreaterThanOrEqual(0.7 * LOGICAL_W);
    expect(map.h).toBeGreaterThanOrEqual(0.6 * LOGICAL_H);
    expect(inside(map)).toBe(true);
  });

  test('every node of the graph, with its highlight ring, is inside the map rectangle', () => {
    const { map } = gameOverLayout(far);
    for (let level = 0; level < 5; level++) {
      for (let index = 0; index <= level; index++) {
        const c = nodeCentreOf(`${level}-${index}`, map)!;
        expect(c.cx - BIG_CURRENT_R).toBeGreaterThanOrEqual(map.x);
        expect(c.cx + BIG_CURRENT_R).toBeLessThanOrEqual(map.x + map.w);
        expect(c.cy - BIG_CURRENT_R).toBeGreaterThanOrEqual(map.y);
        expect(c.cy + BIG_CURRENT_R).toBeLessThanOrEqual(map.y + map.h);
      }
    }
  });

  test('title, score and stage lines are on screen and never touch the map or each other', () => {
    for (const payload of [far, { score: 0, stage: fallbackStage, route: [] as ('L' | 'R')[] }]) {
      const l = gameOverLayout(payload);
      const texts = [l.title, l.score, l.stage];
      for (const r of texts) {
        expect(inside(r)).toBe(true);
        expect(overlaps(r, l.map)).toBe(false);
      }
      expect(overlaps(l.title, l.score)).toBe(false);
      expect(overlaps(l.score, l.stage)).toBe(false);
      expect(overlaps(l.title, l.stage)).toBe(false);
    }
  });

  test('the stage names of the route sit under their nodes, on screen, without touching each other or other nodes', () => {
    // Il percorso con i nomi più lunghi, fino in fondo.
    for (const route of [['L', 'L', 'L', 'L'], ['R', 'L', 'R', 'L'], ['R', 'R', 'R', 'R']] as ('L' | 'R')[][]) {
      const visited = visitedStages(route);
      const { map } = gameOverLayout({ score: 1, stage: STAGES.get(visited[visited.length - 1])!, route });
      const labels = stageLabels(visited, map, STAGES.get(visited[visited.length - 1])!);
      expect(labels).toHaveLength(visited.length);
      for (const label of labels) {
        expect(inside(label.rect)).toBe(true);
        for (let level = 0; level < 5; level++) {
          for (let index = 0; index <= level; index++) {
            const c = nodeCentreOf(`${level}-${index}`, map)!;
            const node = { x: c.cx - BIG_VISITED_R, y: c.cy - BIG_VISITED_R, w: 2 * BIG_VISITED_R, h: 2 * BIG_VISITED_R };
            expect(overlaps(label.rect, node), `${label.text} vs ${level}-${index}`).toBe(false);
          }
        }
      }
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) expect(overlaps(labels[i].rect, labels[j].rect)).toBe(false);
      }
    }
  });

  test('the illustration fills the screen whole, not cropped and not stretched', () => {
    const rec = renderGameOver(far);
    const image = rec.images().find((op) => op.image === 'map_full')!;
    const [x, y, w, h] = image.args;
    expect(w / h).toBeCloseTo(1279 / 720, 6);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(LOGICAL_W + 1e-6);
    expect(y + h).toBeLessThanOrEqual(LOGICAL_H + 1e-6);
    // Almeno un lato tocca il bordo: è la misura più grande che ci sta.
    expect(Math.max(w / LOGICAL_W, h / LOGICAL_H)).toBeCloseTo(1, 6);
  });

  test('a map of another shape is letterboxed on the background colour, not stretched', () => {
    const rec = renderGameOver(far, 0, namedStore(800, 800));
    const bg = rec.fills().findIndex((op) => op.fill === GAME_OVER_BG);
    const imageOp = rec.images().find((op) => op.image === 'map_full')!;
    expect(bg).toBeGreaterThanOrEqual(0);
    expect(imageOp.args.slice(0, 4)).toEqual([280, 0, 720, 720]);
    expect(rec.ops.findIndex((op) => op === imageOp)).toBeGreaterThan(rec.ops.indexOf(rec.fills()[bg]));
  });

  test('the visited route is highlighted: filled nodes and the thick route in the highlight colour', () => {
    const rec = renderGameOver(far);
    const visited = visitedStages(far.route);
    const { map } = gameOverLayout(far);
    // Un segmento giallo per salto, sopra un contorno scuro.
    const strokes = rec.ops.filter((op) => op.type === 'stroke').map((op) => op.fill);
    expect(strokes.filter((c) => c === MAP_EDGE_ON)).toHaveLength(visited.length - 1);
    // Ogni tappa percorsa ha il suo disco pieno, grande.
    const arcs = rec.ops.filter((op) => op.type === 'arc');
    for (const id of visited) {
      const c = nodeCentreOf(id, map)!;
      expect(arcs.some((a) => a.args[0] === c.cx && a.args[1] === c.cy && a.args[2] === BIG_VISITED_R)).toBe(true);
    }
    const fills = rec.ops.filter((op) => op.type === 'fill').map((op) => op.fill);
    expect(fills.filter((c) => c === MAP_NODE_ON)).toHaveLength(visited.length);
    expect(fills).toContain(MAP_CURRENT);
  });

  test('the stage where the run ended blinks', () => {
    const ring = (rec: Recorder) =>
      rec.ops.filter((op) => op.type === 'arc' && op.args[2] === BIG_CURRENT_R).length;
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) seen.add(ring(renderGameOver(far, 0.05 + i * 0.1)));
    expect([...seen].sort()).toEqual([0, 1]);
  });

  test('the text is drawn after the map, so nothing covers it', () => {
    const rec = renderGameOver(far);
    const lastMapArc = rec.ops.map((op) => op.type).lastIndexOf('arc');
    const red = rec.ops.findIndex((op) => op.type === 'fillRect' && op.fill === '#ff3333');
    expect(red).toBeGreaterThan(lastMapArc);
  });

  test('save and restore are balanced and the context is left as it was', () => {
    const rec = renderGameOver(far, 0.3);
    const saves = rec.ops.filter((op) => op.type === 'save').length;
    const restores = rec.ops.filter((op) => op.type === 'restore').length;
    expect(saves).toBeGreaterThan(0);
    expect(saves).toBe(restores);
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  test('the header names the stage reached, with its number', () => {
    expect(gameOverLines(far)).toEqual({ title: 'GAME OVER', score: 'SCORE 1234567', stage: 'STAGE 3  PINE PASS' });
  });
});
