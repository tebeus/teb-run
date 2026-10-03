import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { initialPlayer } from '../../src/game/player';
import { updateVisible } from '../../src/game/race';
import { stageById } from '../../src/game/stages';
import { buildTrack } from '../../src/game/track';
import { SEGMENT_LENGTH } from '../../src/render/project';
import {
  createSkidTrail,
  MAX_SKID_SEGMENTS,
  segmentIndexAt,
  SKID_COLOR,
  TYRE_GAP,
  TYRE_W,
} from '../../src/render/skid';
import { renderWorld } from '../../src/render/world';
import type { AssetStore, PlayerState, RaceSnapshot, Segment, SpriteAsset, StageDef } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';

const STAGE: StageDef = stageById('0-0');

function snapshot(o: { z: number; x?: number; skidding: boolean; surface?: PlayerState['surface']; stage?: StageDef }): RaceSnapshot {
  const stage = o.stage ?? STAGE;
  const player: PlayerState = {
    ...initialPlayer(),
    z: o.z,
    x: o.x ?? 0,
    speed: 11000,
    skidding: o.skidding,
    surface: o.surface ?? 'road',
  };
  return {
    segments: [],
    player,
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 50,
    score: 0,
    stage,
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme: stage.theme,
    banner: 'none',
    kmh: 268,
  };
}

describe('strisce di gomma nel mondo (spec §4.4b)', () => {
  test('the segment index comes straight from z', () => {
    expect(segmentIndexAt(0)).toBe(0);
    expect(segmentIndexAt(SEGMENT_LENGTH - 1)).toBe(0);
    expect(segmentIndexAt(SEGMENT_LENGTH)).toBe(1);
    expect(segmentIndexAt(10.5 * SEGMENT_LENGTH)).toBe(10);
    expect(segmentIndexAt(-1)).toBe(0);
  });

  test('nothing is recorded while the car is not skidding', () => {
    const trail = createSkidTrail();
    for (let i = 0; i < 60; i++) trail.update(1 / 60, snapshot({ z: i * 120, skidding: false }));
    expect(trail.count).toBe(0);
  });

  test('skidding marks the segment under the car', () => {
    const trail = createSkidTrail();
    trail.update(1 / 60, snapshot({ z: 40 * SEGMENT_LENGTH + 10, skidding: true }));
    expect(trail.count).toBe(1);
  });

  test('a coarse tick leaves no gap in the trail', () => {
    // core/loop limita l'accumulato a 0,25 s: a velocità massima sono 15
    // segmenti in un tick. Ognuno va marcato, o la striscia è tratteggiata.
    const trail = createSkidTrail();
    trail.update(1 / 60, snapshot({ z: 100 * SEGMENT_LENGTH, skidding: true }));
    trail.update(0.25, snapshot({ z: 115 * SEGMENT_LENGTH, skidding: true }));
    expect(trail.count).toBe(16);
  });

  test('the pool is bounded: the oldest segment is recycled', () => {
    const trail = createSkidTrail();
    for (let i = 0; i < MAX_SKID_SEGMENTS + 200; i++) {
      trail.update(1 / 60, snapshot({ z: i * SEGMENT_LENGTH, skidding: true }));
    }
    expect(trail.count).toBe(MAX_SKID_SEGMENTS);
  });

  test('releasing the skid and skidding again does not join the two stretches', () => {
    const trail = createSkidTrail();
    trail.update(1 / 60, snapshot({ z: 10 * SEGMENT_LENGTH, skidding: true }));
    trail.update(1 / 60, snapshot({ z: 11 * SEGMENT_LENGTH, skidding: false }));
    trail.update(1 / 60, snapshot({ z: 40 * SEGMENT_LENGTH, skidding: true }));
    expect(trail.count).toBe(2);
  });

  test('a new stage wipes the trail: the indices would land on another road', () => {
    const trail = createSkidTrail();
    trail.update(1 / 60, snapshot({ z: 10 * SEGMENT_LENGTH, skidding: true }));
    expect(trail.count).toBe(1);
    trail.update(1 / 60, snapshot({ z: 0, skidding: false, stage: stageById('1-1') }));
    expect(trail.count).toBe(0);
  });

  test('two dark quads per marked segment, on the asphalt, on both sides of the car', () => {
    const segments: Segment[] = buildTrack(STAGE);
    const player: PlayerState = { ...initialPlayer(), z: 300 * SEGMENT_LENGTH, speed: 11000, x: 0.4 };
    const visible = updateVisible(segments, player, LOGICAL_W, LOGICAL_H);
    const trail = createSkidTrail();
    trail.update(1 / 60, snapshot({ z: player.z, x: 0.4, skidding: true }));

    const rec = createRecordCtx();
    trail.draw(rec.ctx, visible);
    const quads = rec.ops.filter((op) => op.type === 'fill' && op.fill === SKID_COLOR);
    expect(quads).toHaveLength(2);
    // Le due strisce stanno una a sinistra e una a destra del centro
    // dell'auto: gli x dei `moveTo` che le aprono lo mostrano.
    const opens = rec.ops.filter((op) => op.type === 'moveTo').map((op) => op.args[0]);
    expect(opens).toHaveLength(2);
    expect(opens[0]).toBeLessThan(opens[1]);
    expect(TYRE_GAP).toBeGreaterThan(TYRE_W / 2);
  });

  test('a marked segment hidden behind a hill is not drawn', () => {
    const segments: Segment[] = buildTrack(STAGE);
    const player: PlayerState = { ...initialPlayer(), z: 300 * SEGMENT_LENGTH, speed: 11000 };
    const visible = updateVisible(segments, player, LOGICAL_W, LOGICAL_H);
    const trail = createSkidTrail();
    trail.update(1 / 60, snapshot({ z: player.z, skidding: true }));
    // clip sopra la cima del segmento: `shouldDrawSegment` lo rifiuta.
    for (const seg of visible) seg.clip = -1;
    const rec = createRecordCtx();
    trail.draw(rec.ctx, visible);
    expect(rec.ops.filter((op) => op.type === 'fill')).toHaveLength(0);
  });

  test('clear empties the trail', () => {
    const trail = createSkidTrail();
    trail.update(1 / 60, snapshot({ z: 10 * SEGMENT_LENGTH, skidding: true }));
    trail.clear();
    expect(trail.count).toBe(0);
  });
});

const store = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w: 256,
    h: 256,
    entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

describe('le strisce dentro renderWorld (spec §4.4b)', () => {
  test('the trail is drawn after the road and before the sprites', () => {
    const segments: Segment[] = buildTrack(STAGE);
    const player: PlayerState = { ...initialPlayer(), z: 300 * SEGMENT_LENGTH, speed: 11000 };
    const visible = updateVisible(segments, player, LOGICAL_W, LOGICAL_H);
    const trail = createSkidTrail();
    trail.update(1 / 60, snapshot({ z: player.z, skidding: true }));

    const rec = createRecordCtx();
    const full: RaceSnapshot = { ...snapshot({ z: player.z, skidding: true }), segments: visible, player };
    renderWorld(rec.ctx, full, store(), undefined, { trail });

    const trailAt = rec.ops.findIndex((op) => op.type === 'fill' && op.fill === SKID_COLOR);
    expect(trailAt, 'nessuna striscia disegnata').toBeGreaterThan(0);
    // Gli sprite e l'auto del giocatore sono `drawImage` e vengono dopo.
    const imageAfter = rec.ops.findIndex((op, i) => i > trailAt && op.type === 'drawImage');
    expect(imageAfter, 'nessuno sprite dopo la striscia').toBeGreaterThan(trailAt);
    // L'asfalto è un `fill` e viene prima.
    const fillBefore = rec.ops.findIndex((op) => op.type === 'fill' && op.fill !== SKID_COLOR);
    expect(fillBefore).toBeGreaterThanOrEqual(0);
    expect(fillBefore).toBeLessThan(trailAt);
  });
});
