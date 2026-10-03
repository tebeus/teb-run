import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { initialPlayer } from '../../src/game/player';
import { stageById } from '../../src/game/stages';
import {
  createFlock,
  FLOCK_SIZE,
  SEAGULL_FRAME_S,
  SEAGULL_FRAMES,
  SEAGULL_PARALLAX,
  SEAGULL_W,
  seagullFrameName,
  wrapDelta,
} from '../../src/render/wildlife';
import type { AssetStore, RaceSnapshot, SpriteAsset, ThemeId } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';

function snap(theme: ThemeId, far = 0): RaceSnapshot {
  const stage = { ...stageById('0-0'), theme };
  return {
    segments: [],
    player: initialPlayer(),
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 40,
    score: 0,
    stage,
    level: 0,
    route: [],
    parallax: { far, near: 0, y: 0 },
    theme,
    banner: 'none',
    kmh: 0,
  };
}

const store = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w: 140,
    h: 200,
    entry: CATALOG[name] ?? { kind: 'ui', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

describe('gabbiani in volo (spec §13)', () => {
  test('the wing frame cycles through the three sprites', () => {
    expect(SEAGULL_FRAMES).toBe(3);
    expect(seagullFrameName(0)).toBe('npc_seagull_0');
    expect(seagullFrameName(SEAGULL_FRAME_S * 1.1)).toBe('npc_seagull_1');
    expect(seagullFrameName(SEAGULL_FRAME_S * 2.1)).toBe('npc_seagull_2');
    expect(seagullFrameName(SEAGULL_FRAME_S * 3.1)).toBe('npc_seagull_0');
    for (const name of ['npc_seagull_0', 'npc_seagull_1', 'npc_seagull_2']) {
      expect(CATALOG[name], name).toBeDefined();
    }
  });

  test('the parallax delta wraps the short way round', () => {
    expect(wrapDelta(0.1)).toBeCloseTo(0.1, 10);
    expect(wrapDelta(-0.1)).toBeCloseTo(-0.1, 10);
    // 0.99 → 0.01 è un avanzamento di 0.02, non un salto di -0.98.
    expect(wrapDelta(0.01 - 0.99)).toBeCloseTo(0.02, 10);
    expect(SEAGULL_PARALLAX).toBeGreaterThan(0);
  });

  test('only the beach has seagulls', () => {
    const flock = createFlock(() => 0.5);
    flock.update(1 / 60, snap('beach'));
    expect(flock.visible).toBe(FLOCK_SIZE);
    flock.update(1 / 60, snap('desert'));
    expect(flock.visible).toBe(0);
    const rec = createRecordCtx();
    flock.draw(rec.ctx, store(), LOGICAL_W, LOGICAL_H);
    expect(rec.images()).toHaveLength(0);
  });

  test('the birds are drawn near the horizon, inside the frame', () => {
    const flock = createFlock(() => 0.5);
    flock.update(1 / 60, snap('beach'));
    const rec = createRecordCtx();
    flock.draw(rec.ctx, store(), LOGICAL_W, LOGICAL_H);
    expect(rec.images()).toHaveLength(FLOCK_SIZE);
    for (const op of rec.images()) {
      expect(op.args[0]).toBeGreaterThanOrEqual(-SEAGULL_W);
      expect(op.args[0]).toBeLessThanOrEqual(LOGICAL_W + SEAGULL_W);
      expect(op.args[1]).toBeGreaterThan(0);
      expect(op.args[1]).toBeLessThan(LOGICAL_H / 2);
      expect(op.args[2]).toBeCloseTo(SEAGULL_W, 6);
    }
  });

  test('the birds move across the screen and wrap instead of leaving forever', () => {
    const flock = createFlock(() => 0.5);
    flock.update(1 / 60, snap('beach'));
    const first = createRecordCtx();
    flock.draw(first.ctx, store(), LOGICAL_W, LOGICAL_H);
    for (let i = 0; i < 60; i++) flock.update(1 / 60, snap('beach'));
    const later = createRecordCtx();
    flock.draw(later.ctx, store(), LOGICAL_W, LOGICAL_H);
    expect(later.images()[0].args[0]).not.toBeCloseTo(first.images()[0].args[0], 3);
    // Dopo mezzo minuto sono ancora tutti dentro la banda del frame.
    for (let i = 0; i < 1800; i++) flock.update(1 / 60, snap('beach'));
    const much = createRecordCtx();
    flock.draw(much.ctx, store(), LOGICAL_W, LOGICAL_H);
    expect(much.images()).toHaveLength(FLOCK_SIZE);
    for (const op of much.images()) {
      expect(Number.isFinite(op.args[0])).toBe(true);
      expect(op.args[0]).toBeGreaterThanOrEqual(-SEAGULL_W);
      expect(op.args[0]).toBeLessThanOrEqual(LOGICAL_W + SEAGULL_W);
    }
  });

  test('a curve drifts the flock: the parallax moves them', () => {
    const still = createFlock(() => 0.5);
    const curving = createFlock(() => 0.5);
    still.update(1 / 60, snap('beach', 0));
    curving.update(1 / 60, snap('beach', 0));
    for (let i = 0; i < 30; i++) {
      still.update(1 / 60, snap('beach', 0));
      curving.update(1 / 60, snap('beach', (i * 0.01) % 1));
    }
    const a = createRecordCtx();
    const b = createRecordCtx();
    still.draw(a.ctx, store(), LOGICAL_W, LOGICAL_H);
    curving.draw(b.ctx, store(), LOGICAL_W, LOGICAL_H);
    expect(b.images()[0].args[0]).not.toBeCloseTo(a.images()[0].args[0], 3);
  });
});
