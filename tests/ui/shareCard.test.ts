import { describe, expect, test } from 'vitest';
import { GAME_NAME, SITE_URL } from '../../src/core/config';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { MAP_CURRENT, MAP_NODE_ON, nodeCentreOf, visitedStages } from '../../src/render/routeMap';
import {
  CARD_H,
  CARD_MAP,
  CARD_W,
  drawShareCard,
  renderShareCard,
  resultHeadline,
  shareCardContent,
  shareFileName,
  shareText,
  stageNumber,
  type ShareResult,
} from '../../src/ui/shareCard';
import { createRecordCtx } from '../helpers/recordCtx';

const ending: ShareResult = {
  kind: 'ending',
  score: 1234567,
  time: 254.567,
  mode: 'hard',
  car: 'sport',
  route: ['L', 'R', 'R', 'L'],
  stageId: '4-2',
  stageName: 'Coral Coast',
  ending: 2,
};

const gameOver: ShareResult = {
  kind: 'gameOver',
  score: 4210,
  time: 71.2,
  mode: 'normal',
  car: 'new',
  route: ['R'],
  stageId: '1-1',
  stageName: 'Pine Pass',
};

describe('share card content', () => {
  test('an ending reads ENDING n OF 5, with score, time, mode, car and site', () => {
    expect(shareCardContent(ending)).toEqual({
      name: GAME_NAME,
      outcome: 'GOAL!',
      headline: 'ENDING 3 OF 5',
      stage: 'CORAL COAST',
      score: 'SCORE 1234567',
      time: `TIME 4'14"56`,
      mode: 'HARD',
      car: 'CAR: SPORT',
      site: 'TEBRUN.IO',
    });
  });

  test('a game over reads the stage reached', () => {
    const c = shareCardContent(gameOver);
    expect(c.outcome).toBe('GAME OVER');
    expect(c.headline).toBe('STAGE 2 OF 5');
    expect(c.mode).toBe('NORMAL');
    expect(c.car).toBe('CAR: NEW');
    expect(c.score).toBe('SCORE 0004210');
  });

  test('stage number and headline are safe with malformed data', () => {
    expect(stageNumber('0-0')).toBe(1);
    expect(stageNumber('4-4')).toBe(5);
    expect(stageNumber('nope')).toBe(1);
    expect(resultHeadline({ ...ending, ending: 99 })).toBe('ENDING 5 OF 5');
    expect(resultHeadline({ ...ending, ending: undefined })).toBe('ENDING 1 OF 5');
  });

  test('the short text has name, score, outcome, mode, time and the site, nothing else', () => {
    expect(shareText(ending)).toBe(`${GAME_NAME}: 1234567 points, ENDING 3 OF 5, HARD, 4'14"56. ${SITE_URL}`);
    expect(shareText(gameOver)).toBe(`${GAME_NAME}: 4210 points, STAGE 2 OF 5, NORMAL, 1'11"20. ${SITE_URL}`);
    expect(shareText(ending).length).toBeLessThan(120);
  });

  test('the file name comes from the game name', () => {
    expect(shareFileName(ending)).toBe(`${GAME_NAME.toLowerCase().replace(/ /g, '-')}-1234567.png`);
    expect(shareFileName(ending)).toMatch(/^[a-z0-9-]+\.png$/);
  });
});

describe('drawShareCard', () => {
  test('fills the whole card and lights the route taken on the map', () => {
    const rec = createRecordCtx();
    drawShareCard(rec.ctx, ending, createEmptyAssets());
    const fills = rec.fills();
    expect(fills[0].args).toEqual([0, 0, CARD_W, CARD_H]);
    // Il percorso acceso: i nodi visitati pieni del giallo della mappa, la
    // tappa finale col centro rosso, tutto dentro il riquadro della mappa.
    const inner = { x: CARD_MAP.x + 10, y: CARD_MAP.y + 10, w: CARD_MAP.w - 20, h: CARD_MAP.h - 20 };
    const arcs = rec.ops.filter((op) => op.type === 'arc');
    for (const id of visitedStages(ending.route)) {
      const c = nodeCentreOf(id, inner)!;
      expect(arcs.some((a) => a.args[0] === c.cx && a.args[1] === c.cy)).toBe(true);
    }
    const yellow = rec.ops.filter((op) => op.type === 'fill' && op.fill === MAP_NODE_ON);
    expect(yellow.length).toBe(visitedStages(ending.route).length);
    expect(rec.ops.some((op) => op.type === 'fill' && op.fill === MAP_CURRENT)).toBe(true);
    // Nessun pixel fuori dalla scheda.
    for (const op of rec.ops.filter((o) => o.type === 'fillRect')) {
      const [x, y, w, h] = op.args;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(CARD_W);
      expect(y + h).toBeLessThanOrEqual(CARD_H);
    }
  });

  test('renderShareCard draws on a separate 1200x630 canvas and asks for a PNG', async () => {
    const rec = createRecordCtx();
    let type = '';
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => rec.ctx,
      toBlob: (cb: (b: Blob | null) => void, t: string) => {
        type = t;
        cb(new Blob(['x'], { type: t }));
      },
    };
    const blob = await renderShareCard(
      { createElement: () => canvas as unknown as HTMLCanvasElement },
      gameOver,
      createEmptyAssets(),
    );
    expect(canvas.width).toBe(CARD_W);
    expect(canvas.height).toBe(CARD_H);
    expect(type).toBe('image/png');
    expect(blob?.type).toBe('image/png');
    expect(rec.ops.length).toBeGreaterThan(100);
  });

  test('renderShareCard resolves null without a 2D context', async () => {
    const canvas = { width: 0, height: 0, getContext: () => null };
    const blob = await renderShareCard(
      { createElement: () => canvas as unknown as HTMLCanvasElement },
      gameOver,
      createEmptyAssets(),
    );
    expect(blob).toBeNull();
  });
});
