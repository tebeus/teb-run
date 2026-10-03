import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { DEMO_STAGE } from '../../src/game/demo-stage';
import { DEMO_STAGES } from '../../src/game/demo-graph';
import { initialPlayer } from '../../src/game/player';
import {
  CLOUD_DRIFT_PER_S,
  computeParallax,
  createFullRace,
  createRace,
  PARALLAX_CLOUDS_SPEED,
  PARALLAX_FAR_SPEED,
  PARALLAX_NEAR_SPEED,
  playerHeightAt,
  type Parallax,
  updateVisible,
} from '../../src/game/race';
import { createStageGraph } from '../../src/game/stage-graph';
import { buildTrack, MIN_STAGE_SEGMENTS } from '../../src/game/track';
import { CAMERA_HEIGHT, DRAW_DISTANCE, SEGMENT_LENGTH } from '../../src/render/project';
import { needsTransition, TRANSITION_SECONDS } from '../../src/render/palette';
import { shouldDrawSegment } from '../../src/render/road';
import type { Actions, AssetStore, PlayerState, StageDef } from '../../src/types';
import { makeAsset, makeFlatTrack, makeSegment } from '../helpers/segments';
import { driveToward, has } from '../helpers/race-script';

const DT = 1 / 60;
const acts = (over: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...over });
const player = (over: Partial<PlayerState> = {}): PlayerState => ({ ...initialPlayer(), ...over });

/**
 * AssetStore finto: `createRace` non disegna, ma `get` non deve mai lanciare,
 * come il vero AssetStore.
 */
const stubAssets = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name) => makeAsset(name, 64, 64),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

describe('computeParallax (spec 4.4)', () => {
  const zero: Parallax = { far: 0, near: 0, y: 0 };

  test('a straight road does not move the layers sideways', () => {
    const p = computeParallax(zero, 0, 1, DT);
    expect(p.far).toBe(0);
    expect(p.near).toBe(0);
  });

  test('standing still does not move the layers sideways', () => {
    const p = computeParallax(zero, 6, 0, DT);
    expect(p.far).toBe(0);
    expect(p.near).toBe(0);
  });

  test('the offset grows with curve, speed and time', () => {
    const slow = computeParallax(zero, 4, 0.2, DT);
    const fast = computeParallax(zero, 4, 0.9, DT);
    expect(fast.far).toBeGreaterThan(slow.far);
    const sharper = computeParallax(zero, 6, 0.9, DT);
    expect(sharper.far).toBeGreaterThan(fast.far);
  });

  test('the near layer moves faster than the far one, in the spec ratio', () => {
    const p = computeParallax(zero, 4, 1, DT);
    expect(p.near / p.far).toBeCloseTo(PARALLAX_NEAR_SPEED / PARALLAX_FAR_SPEED, 8);
  });

  test('at full speed one tick advances one segment worth of offset', () => {
    const p = computeParallax(zero, 1, 1, DT);
    expect(p.far).toBeCloseTo(PARALLAX_FAR_SPEED, 10);
  });

  test('offsets stay inside [0, 1) even after many ticks and in both directions', () => {
    let p = zero;
    for (let i = 0; i < 5000; i++) p = computeParallax(p, 6, 1, DT);
    expect(p.far).toBeGreaterThanOrEqual(0);
    expect(p.far).toBeLessThan(1);
    expect(p.near).toBeGreaterThanOrEqual(0);
    expect(p.near).toBeLessThan(1);
    for (let i = 0; i < 5000; i++) p = computeParallax(p, -6, 1, DT);
    expect(p.far).toBeGreaterThanOrEqual(0);
    expect(p.far).toBeLessThan(1);
  });

  test('the vertical offset follows the hill and is clamped', () => {
    // Il layer scende quando la telecamera sale (oggetti lontani a terra più in basso), spec 4.4.
    expect(computeParallax(zero, 0, 1, DT, 0).y).toBe(0);
    expect(computeParallax(zero, 0, 1, DT, 500).y).toBeCloseTo(0.5, 10);
    expect(computeParallax(zero, 0, 1, DT, -500).y).toBeCloseTo(-0.5, 10);
    expect(computeParallax(zero, 0, 1, DT, CAMERA_HEIGHT * 50).y).toBe(1);
    expect(computeParallax(zero, 0, 1, DT, -CAMERA_HEIGHT * 50).y).toBe(-1);
  });

  test('the clouds drift on their own even on a straight, at rest', () => {
    const p = computeParallax(zero, 0, 0, DT);
    expect(p.clouds).toBeCloseTo(CLOUD_DRIFT_PER_S * DT, 12);
  });

  test('the clouds move half as much as the far layer with the curve', () => {
    const p = computeParallax(zero, 4, 1, DT);
    const drift = CLOUD_DRIFT_PER_S * DT;
    expect((p.clouds ?? 0) - drift).toBeCloseTo((p.far * PARALLAX_CLOUDS_SPEED) / PARALLAX_FAR_SPEED, 12);
  });

  test('the cloud offset stays inside [0, 1) after many ticks', () => {
    let p = zero;
    for (let i = 0; i < 20000; i++) p = computeParallax(p, 6, 1, DT);
    expect(p.clouds).toBeGreaterThanOrEqual(0);
    expect(p.clouds).toBeLessThan(1);
  });
});

describe('playerHeightAt', () => {
  test('a flat track is always at height zero', () => {
    const track = makeFlatTrack(10);
    expect(playerHeightAt(track, 0)).toBe(0);
    expect(playerHeightAt(track, 1234)).toBe(0);
  });

  test('it interpolates inside the segment', () => {
    const track = [makeSegment(0), makeSegment(1)];
    track[0].p2.world.y = 1000;
    track[1].p1.world.y = 1000;
    track[1].p2.world.y = 1000;
    expect(playerHeightAt(track, 0)).toBe(0);
    expect(playerHeightAt(track, SEGMENT_LENGTH / 2)).toBeCloseTo(500, 8);
    expect(playerHeightAt(track, SEGMENT_LENGTH)).toBe(1000);
  });

  test('it wraps past the end of the track', () => {
    const track = makeFlatTrack(10);
    expect(playerHeightAt(track, 10 * SEGMENT_LENGTH)).toBe(0);
    expect(playerHeightAt(track, -1)).toBe(0);
  });
});

describe('updateVisible', () => {
  test('it returns exactly drawDistance segments', () => {
    const track = buildTrack(DEMO_STAGE);
    const visible = updateVisible(track, player({ z: 10000 }), LOGICAL_W, LOGICAL_H);
    expect(visible).toHaveLength(DRAW_DISTANCE);
  });

  test('the segments come out ordered from near to far, without gaps', () => {
    const track = buildTrack(DEMO_STAGE);
    const visible = updateVisible(track, player({ z: 10000 }), LOGICAL_W, LOGICAL_H);
    for (let i = 1; i < visible.length; i++) {
      const expected = (visible[0].index + i) % track.length;
      expect(visible[i].index, `position ${i}`).toBe(expected);
    }
  });

  test('every projected value is finite', () => {
    const track = buildTrack(DEMO_STAGE);
    const visible = updateVisible(track, player({ z: 50000, x: 0.5 }), LOGICAL_W, LOGICAL_H);
    for (const s of visible) {
      for (const p of [s.p1, s.p2]) {
        expect(Number.isFinite(p.screen.x), `segment ${s.index}`).toBe(true);
        expect(Number.isFinite(p.screen.y), `segment ${s.index}`).toBe(true);
        expect(Number.isFinite(p.screen.w), `segment ${s.index}`).toBe(true);
        expect(Number.isFinite(p.camera.z), `segment ${s.index}`).toBe(true);
      }
    }
  });

  test('on a flat straight road the road narrows with distance', () => {
    const track = makeFlatTrack(400);
    const visible = updateVisible(track, player({ z: 20000 }), LOGICAL_W, LOGICAL_H);
    const drawn = visible.filter((s) => shouldDrawSegment(s));
    expect(drawn.length).toBeGreaterThan(50);
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i].p1.screen.w, `position ${i}`).toBeLessThan(drawn[i - 1].p1.screen.w);
    }
  });

  test('on a flat straight road the far segments converge on the horizon', () => {
    const track = makeFlatTrack(400);
    const visible = updateVisible(track, player({ z: 20000 }), LOGICAL_W, LOGICAL_H);
    const last = visible[visible.length - 1];
    // L'orizzonte è a H/2; il segmento più lontano ci arriva da poco sotto.
    expect(last.p1.screen.y).toBeGreaterThan(LOGICAL_H / 2);
    expect(last.p1.screen.y).toBeLessThan(LOGICAL_H / 2 + 12);
    expect(last.p1.screen.x).toBeCloseTo(LOGICAL_W / 2, 6);
  });

  test('the nearest segments are behind the camera and are not drawn (Review Focus 2)', () => {
    const track = makeFlatTrack(400);
    const visible = updateVisible(track, player({ z: 20000 }), LOGICAL_W, LOGICAL_H);
    expect(shouldDrawSegment(visible[0])).toBe(false);
    expect(visible[0].p1.camera.z).toBeLessThanOrEqual(0);
    expect(shouldDrawSegment(visible[40])).toBe(true);
  });

  test('clip is filled on every visible segment and never increases going far', () => {
    const track = buildTrack(DEMO_STAGE);
    const visible = updateVisible(track, player({ z: 80000 }), LOGICAL_W, LOGICAL_H);
    expect(visible[0].clip).toBe(LOGICAL_H);
    for (let i = 1; i < visible.length; i++) {
      expect(visible[i].clip, `position ${i}`).toBeLessThanOrEqual(visible[i - 1].clip);
    }
  });

  test('steering right moves the road to the left of the screen', () => {
    const track = makeFlatTrack(400);
    const centred = updateVisible(track, player({ z: 20000, x: 0 }), LOGICAL_W, LOGICAL_H)[60].p1.screen.x;
    const right = updateVisible(track, player({ z: 20000, x: 0.9 }), LOGICAL_W, LOGICAL_H)[60].p1.screen.x;
    expect(right).toBeLessThan(centred);
  });

  test('a hill lifts the camera, so the road ahead stays on screen', () => {
    // Collina lineare: dal segmento 100 in poi la strada sale di 20 unità per segmento.
    const track = makeFlatTrack(400);
    const heightAt = (i: number): number => (i > 100 ? (i - 100) * 20 : 0);
    for (let i = 0; i < track.length; i++) {
      track[i].p1.world.y = heightAt(i);
      track[i].p2.world.y = heightAt(i + 1);
    }
    const visible = updateVisible(track, player({ z: 120 * SEGMENT_LENGTH }), LOGICAL_W, LOGICAL_H);
    expect(visible[40].p1.screen.y).toBeGreaterThan(0);
    expect(visible[40].p1.screen.y).toBeLessThan(LOGICAL_H);
    expect(visible[40].p1.camera.y).toBeLessThan(0);
  });
});

describe('curve accumulation over 300 segments (Review Focus 4)', () => {
  const at = (curve: number, position: number): number => {
    const track = makeFlatTrack(400, curve);
    return updateVisible(track, player({ z: 20000 }), LOGICAL_W, LOGICAL_H)[position].p1.screen.x;
  };

  test('a constant curve bends the road further the farther you look', () => {
    const near = at(4, 30);
    const far = at(4, 200);
    expect(Math.abs(near - LOGICAL_W / 2)).toBeLessThan(Math.abs(far - LOGICAL_W / 2));
  });

  test('a right curve and a left curve are mirror images', () => {
    for (const n of [30, 100, 200, 299]) {
      const right = at(6, n) - LOGICAL_W / 2;
      const left = at(-6, n) - LOGICAL_W / 2;
      expect(left, `position ${n}`).toBeCloseTo(-right, 6);
    }
  });

  test('the hardest curve keeps every projected value finite', () => {
    const track = makeFlatTrack(400, 6);
    const visible = updateVisible(track, player({ z: 20000, x: -3 }), LOGICAL_W, LOGICAL_H);
    for (const s of visible) {
      expect(Number.isFinite(s.p1.screen.x), `segment ${s.index}`).toBe(true);
      expect(Number.isFinite(s.p2.screen.x), `segment ${s.index}`).toBe(true);
    }
  });
});

describe('createRace', () => {
  test('the snapshot describes the demo stage at a standstill', () => {
    const race = createRace(DEMO_STAGE, stubAssets());
    const snap = race.snapshot();
    expect(snap.segments).toHaveLength(DRAW_DISTANCE);
    expect(snap.player.speed).toBe(0);
    expect(snap.player.gear).toBe('lo');
    expect(snap.stage).toBe(DEMO_STAGE);
    expect(snap.theme).toBe(DEMO_STAGE.theme);
    expect(snap.crash).toEqual({ active: false, t: 0, frame: 0 });
    expect(snap.timeLeft).toBe(99);
    expect(snap.score).toBe(0);
    expect(snap.banner).toBe('none');
    expect(snap.level).toBe(0);
    expect(snap.route).toEqual([]);
    expect(snap.kmh).toBe(0);
  });

  test('update reports no events in this track', () => {
    const race = createRace(DEMO_STAGE, stubAssets());
    expect(race.update(DT, acts({ accelerate: true }))).toEqual([]);
  });

  test('accelerating moves the car forward and shows km/h', () => {
    const race = createRace(DEMO_STAGE, stubAssets());
    for (let i = 0; i < 120; i++) race.update(DT, acts({ accelerate: true }));
    const snap = race.snapshot();
    expect(snap.player.z).toBeGreaterThan(0);
    expect(snap.player.speed).toBeGreaterThan(0);
    expect(snap.kmh).toBeGreaterThan(50);
  });

  test('steering moves x and the parallax reacts to curves', () => {
    const race = createRace(DEMO_STAGE, stubAssets());
    for (let i = 0; i < 600; i++) race.update(DT, acts({ accelerate: true, gearToggle: i === 0 }));
    for (let i = 0; i < 60; i++) race.update(DT, acts({ accelerate: true, right: true }));
    const snap = race.snapshot();
    expect(snap.player.x).not.toBe(0);
    expect(snap.parallax.far).toBeGreaterThanOrEqual(0);
    expect(snap.parallax.far).toBeLessThan(1);
  });

  test('z wraps at the end of the track and the world keeps rendering (Review Focus 1)', () => {
    const race = createRace(DEMO_STAGE, stubAssets());
    const trackLength = DEMO_STAGE.lengthSegments * SEGMENT_LENGTH;
    let wrapped = false;
    let previous = 0;
    // 3000 passi da 0,1 s coprono più di una volta il tracciato anche fuori
    // strada (`OFF_ROAD_LIMIT`, un quarto della velocità massima): senza
    // sterzo la centrifuga porta sull'erba alla prima curva.
    for (let i = 0; i < 3000; i++) {
      race.update(0.1, acts({ accelerate: true, gearToggle: i === 0 }));
      const z = race.snapshot().player.z;
      expect(z, `step ${i}`).toBeGreaterThanOrEqual(0);
      expect(z, `step ${i}`).toBeLessThan(trackLength);
      if (z < previous) wrapped = true;
      previous = z;
    }
    expect(wrapped).toBe(true);
    const snap = race.snapshot();
    expect(snap.segments).toHaveLength(DRAW_DISTANCE);
    for (const s of snap.segments) expect(Number.isFinite(s.p1.screen.y)).toBe(true);
  });

  test('a run of 600 ticks never produces a non finite value', () => {
    const race = createRace(DEMO_STAGE, stubAssets());
    for (let i = 0; i < 600; i++) {
      race.update(DT, acts({ accelerate: true, right: i % 3 === 0, brake: i % 97 === 0 }));
      const snap = race.snapshot();
      expect(Number.isFinite(snap.player.x), `tick ${i}`).toBe(true);
      expect(Number.isFinite(snap.player.speed), `tick ${i}`).toBe(true);
      expect(Number.isFinite(snap.kmh), `tick ${i}`).toBe(true);
    }
  });

  test('the demo stage is a beach stage that builds a legal track', () => {
    expect(DEMO_STAGE.theme).toBe('beach');
    expect(DEMO_STAGE.difficulty).toBeCloseTo(0.3, 10);
    expect(DEMO_STAGE.lengthSegments).toBe(3343);
    expect(DEMO_STAGE.id.startsWith('4-')).toBe(false);
    expect(buildTrack(DEMO_STAGE)).toHaveLength(DEMO_STAGE.lengthSegments);
  });

  test('elapsed counts the seconds since the start of the game', () => {
    const race = createRace(DEMO_STAGE, stubAssets());
    expect(race.snapshot().elapsed).toBe(0);
    for (let i = 0; i < 120; i++) race.update(DT, acts({ accelerate: true }));
    expect(race.snapshot().elapsed).toBeCloseTo(2, 6);
  });

  test('elapsed grows even standing still and during a crash', () => {
    const race = createRace(DEMO_STAGE, stubAssets());
    for (let i = 0; i < 60; i++) race.update(DT, acts());
    expect(race.snapshot().elapsed).toBeCloseTo(1, 6);
  });

  test('elapsed is not reset at a checkpoint (spec §11)', () => {
    // Tempo abbondante, come in full-race.test.ts "reach their fork given the
    // time": isola la geometria (arrivare al checkpoint) dal bilanciamento
    // dei tempi reali della tappa (spec §9), lavoro del binario G. Con i 75 s
    // veri di DEMO_GRAPH il game over per tempo scaduto arriva prima del
    // checkpoint (crash e traffico compresi).
    const graph = createStageGraph(DEMO_STAGES.map((s) => ({ ...s, timeLimit: 600 })));
    const race = createFullRace({ graph, assets: stubAssets(), skipCountdown: true });
    const run = driveToward(race, 0.85, (e) => has(e, 'checkpoint'), { maxTicks: 40000 });
    expect(has(run.events, 'checkpoint')).toBe(true);
    const snap = race.snapshot();
    // Il tempo rimanente è ripartito col limite della tappa nuova, il
    // cronometro della partita no.
    expect(snap.elapsed).toBeGreaterThan(5);
    expect(snap.elapsed).toBeCloseTo(run.ticks * DT, 3);
  });
});

describe('createFullRace: transizione fra tappe (spec §4.4d)', () => {
  /** Tappa corta ma legale, così il checkpoint arriva in pochi secondi. */
  const shortStage = (id: string, theme: StageDef['theme']): StageDef => ({
    id,
    name: id,
    theme,
    lengthSegments: MIN_STAGE_SEGMENTS,
    timeLimit: 600,
    seed: 4242,
    difficulty: 0,
  });

  /** 0-0 spiaggia; a sinistra deserto (tema diverso), a destra spiaggia. */
  const graph = () =>
    createStageGraph([shortStage('0-0', 'beach'), shortStage('1-0', 'desert'), shortStage('1-1', 'beach')]);

  const raceTo = (side: number) => {
    const race = createFullRace({ graph: graph(), assets: stubAssets(), skipCountdown: true });
    const run = driveToward(race, side, (e) => has(e, 'checkpoint'));
    expect(has(run.events, 'checkpoint')).toBe(true);
    return race;
  };

  test('there is no transition before the first junction', () => {
    const race = createFullRace({ graph: graph(), assets: stubAssets(), skipCountdown: true });
    race.update(DT, acts({ accelerate: true }));
    expect(race.snapshot().transition).toBeUndefined();
  });

  test('a junction between two themes opens a transition from one to the other', () => {
    const race = raceTo(-0.85);
    const tr = race.snapshot().transition;
    expect(tr).toBeDefined();
    expect(tr?.from).toBe('beach');
    expect(tr?.to).toBe('desert');
    expect(tr?.t).toBeGreaterThanOrEqual(0);
    expect(tr?.t).toBeLessThan(0.1);
    // Lo snapshot porta già il tema nuovo: la transizione dice da dove viene.
    expect(race.snapshot().theme).toBe('desert');
  });

  test('a junction between two stages of the same theme but different skies opens a transition', () => {
    // Deroga 13 del binario K: 0-0 Palm Bay e 1-1 Blue Lagoon sono
    // entrambe spiaggia e hanno cieli diversi (`STAGE_PALETTES`), quindi
    // il passaggio va sfumato o il cielo salterebbe in un fotogramma.
    const race = raceTo(0.85);
    expect(race.snapshot().theme).toBe('beach');
    const tr = race.snapshot().transition;
    expect(tr).toBeDefined();
    expect(tr?.from).toBe('beach');
    expect(tr?.to).toBe('beach');
    expect(tr?.fromId).toBe('0-0');
  });

  test('a junction between two stages with the same palette opens nothing', () => {
    // Due id senza voce in `STAGE_PALETTES`: la palette e identica, e
    // non c'e niente da sfumare.
    const plain = createStageGraph([
      shortStage('0-0', 'beach'),
      shortStage('1-0', 'desert'),
      shortStage('1-1', 'beach'),
    ]);
    expect(needsTransition('demo-a', 'beach', 'demo-b', 'beach')).toBe(false);
    // E la giunzione fra temi diversi resta quella di prima.
    const race = createFullRace({ graph: plain, assets: stubAssets() });
    const run = driveToward(race, -0.85, (e) => has(e, 'checkpoint'));
    expect(has(run.events, 'checkpoint')).toBe(true);
    expect(race.snapshot().transition?.from).toBe('beach');
  });

  test('t grows with dt and the field disappears after six seconds', () => {
    const race = raceTo(-0.85);
    for (let i = 0; i < 60; i++) race.update(DT, acts({ accelerate: true }));
    const half = race.snapshot().transition;
    expect(half?.t).toBeCloseTo(1, 1);
    for (let i = 0; i < 60 * 6; i++) race.update(DT, acts({ accelerate: true }));
    expect(race.snapshot().transition).toBeUndefined();
    expect(TRANSITION_SECONDS).toBe(6);
  });

  test('the transition keeps running during a crash: it is a clock, not an animation', () => {
    const race = raceTo(-0.85);
    for (let i = 0; i < 30; i++) race.update(DT, acts());
    expect(race.snapshot().transition?.t).toBeCloseTo(0.5, 1);
  });
});
