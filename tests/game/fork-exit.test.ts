import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { initialPlayer, surfaceOf } from '../../src/game/player';
import { createFullRace } from '../../src/game/race';
import { createStageGraph } from '../../src/game/stage-graph';
import { STAGE_LIST } from '../../src/game/stages';
import {
  buildTrack,
  FORK_EXIT_BASE_OFFSET,
  FORK_EXIT_HALF_HOLD,
  FORK_EXIT_REACH,
  FORK_EXIT_SEGMENTS,
  FORK_EXIT_SLOPE,
  FORK_ZONE_SEGMENTS,
  forkBranchCentre,
  forkExitHalf,
  forkExitOffset,
  forkOffset,
  hidesDiscardedSide,
  markForkExit,
  MIN_STAGE_SEGMENTS,
  smoothstep,
  spriteOffsetOf,
  TRAFFIC_FREE_START,
} from '../../src/game/track';
import { checkCollisions } from '../../src/game/traffic';
import { DRAW_DISTANCE } from '../../src/render/project';
import type { AssetStore, DiscardedRoad, RaceEngine, RaceSnapshot, Segment, StageDef } from '../../src/types';
import { makeAsset } from '../helpers/segments';
import { driveToward, has } from '../helpers/race-script';

const stubAssets = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name) => makeAsset(name, 64, 64),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

const shortStage = (id: string, name: string, over: Partial<StageDef> = {}): StageDef => ({
  id,
  name,
  theme: 'beach',
  lengthSegments: MIN_STAGE_SEGMENTS,
  // Grafo con timeLimit gonfiato (come già fa full-race.test.ts): qui
  // interessa solo arrivare alla giunzione, non il tempo di gara.
  timeLimit: 600,
  seed: 4242,
  difficulty: 0,
  ...over,
});

const TEST_STAGES = [
  shortStage('0-0', 'Alpha'),
  shortStage('1-0', 'Bravo'),
  shortStage('1-1', 'Charlie'),
];

const newRace = (stages: readonly StageDef[] = TEST_STAGES): RaceEngine => {
  const graph = createStageGraph(stages);
  return createFullRace({ graph, assets: stubAssets(), startStage: graph.first(), skipCountdown: true });
};

/** Guida fino alla giunzione e ritorna lo snapshot subito dopo. */
function snapshotAfterJunction(targetX: number): RaceSnapshot {
  const race = newRace();
  let after: RaceSnapshot | null = null;
  driveToward(race, targetX, (events) => {
    const fired = has(events, 'checkpoint');
    if (fired) after = race.snapshot();
    return fired;
  });
  if (after === null) throw new Error('checkpoint never fired');
  return after;
}

describe('forkExitOffset e forkExitHalf (spec §4.4, «Uscita dal bivio»)', () => {
  test('FORK_EXIT_SEGMENTS is the spec value, and traffic waits at least as long', () => {
    // 360, non 150 (terzo addendum del collaudo): l'utente vedeva la strada
    // scartata per meno di un secondo, poi una sola strada.
    expect(FORK_EXIT_SEGMENTS).toBe(360);
    expect(TRAFFIC_FREE_START).toBeGreaterThanOrEqual(FORK_EXIT_SEGMENTS);
  });

  test('at t = 0 the discarded carriageway sits at its own base offset', () => {
    expect(forkExitOffset(1, 0)).toBeCloseTo(-FORK_EXIT_BASE_OFFSET, 12);
    expect(forkExitOffset(-1, 0)).toBeCloseTo(FORK_EXIT_BASE_OFFSET, 12);
  });

  test('it moves further away as t grows, on the side opposite to the one chosen, in a straight line', () => {
    // Bivio v3: prosegue dritta con la pendenza con cui lasciava la zona.
    expect(forkExitOffset(1, 1)).toBeCloseTo(-(FORK_EXIT_BASE_OFFSET + FORK_EXIT_SLOPE * (FORK_EXIT_SEGMENTS - 1)), 9);
    expect(Math.abs(forkExitOffset(1, 1))).toBeGreaterThan(Math.abs(forkExitOffset(1, 0)));
    expect(forkExitOffset(-1, 0.5) - forkExitOffset(-1, 0.25)).toBeCloseTo(
      forkExitOffset(-1, 0.75) - forkExitOffset(-1, 0.5),
      9,
    );
  });

  test('the discarded carriageway starts exactly where the zone left it, with the same slope', () => {
    // Bivio v3: in fondo alla zona i due rami sono simmetrici, quindi dal
    // centro della strada scelta la scartata sta a due volte il centro di
    // un ramo, e se ne va a due volte la sua pendenza.
    expect(FORK_EXIT_BASE_OFFSET).toBeCloseTo(2 * forkBranchCentre(FORK_ZONE_SEGMENTS), 12);
    expect(FORK_EXIT_SLOPE).toBeCloseTo(
      2 * (forkBranchCentre(FORK_ZONE_SEGMENTS) - forkBranchCentre(FORK_ZONE_SEGMENTS - 1)),
      12,
    );
    expect(forkExitOffset(1, 0)).toBeCloseTo(-FORK_EXIT_BASE_OFFSET, 12);
  });

  test('the half width holds full, then shrinks from the base carriageway to nothing (terzo addendum del collaudo)', () => {
    // Piena fino a FORK_EXIT_HALF_HOLD (0,6), poi lineare a zero: non più
    // lineare su tutto [0, 1], che assottigliava la strada scartata troppo
    // presto per leggerla come una strada vera.
    expect(forkExitHalf(0)).toBe(1);
    expect(forkExitHalf(FORK_EXIT_HALF_HOLD)).toBe(1);
    expect(forkExitHalf(1)).toBe(0);
    const mid = (FORK_EXIT_HALF_HOLD + 1) / 2;
    expect(forkExitHalf(mid)).toBeCloseTo(0.5, 12);
  });

  test('both are pure', () => {
    expect(forkExitOffset(1, 0.3)).toBe(forkExitOffset(1, 0.3));
    expect(forkExitHalf(0.3)).toBe(forkExitHalf(0.3));
  });
});

describe('surfaceOf keeps the fork exit road as grass, with no change to the function', () => {
  test('the discarded carriageway sits well beyond the shoulder of the new road', () => {
    // A t = 0 il centro della carreggiata scartata è a più di 20 unità (bivio
    // v3), ben oltre roadHalf (1) + SHOULDER_W (0.35): resta erba.
    expect(surfaceOf(forkExitOffset(1, 0))).toBe('grass');
  });
});

describe('smoothstep applied to the exit progress (spec §4.4)', () => {
  test('it is monotonic and flat at both ends, like the fork zone widening', () => {
    const samples = Array.from({ length: 10 }, (_, i) => smoothstep(i / 9));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(1);
  });
});

describe('createFullRace marks forkExit on the new stage after the junction', () => {
  test('driving right, the visible forkExit segments carry side 1 and an increasing t', () => {
    const snap = snapshotAfterJunction(0.85);
    expect(snap.stage.id).toBe('1-1');
    const marked = snap.segments
      .filter((s) => s.index < FORK_EXIT_SEGMENTS)
      .sort((a, b) => a.index - b.index);
    // FORK_EXIT_SEGMENTS (360, terzo addendum del collaudo) supera
    // DRAW_DISTANCE (300): la finestra visibile appena dopo la giunzione non
    // arriva a vederli tutti, e i pochi segmenti in fondo (la telecamera sta
    // PLAYER_Z dietro il giocatore, quindi avvolge sul fondo della tappa
    // nuova) non sono marcati. Non tutti i FORK_EXIT_SEGMENTS sono già
    // visibili: la crescita continua nei tick successivi.
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(DRAW_DISTANCE);
    expect(marked.length).toBeLessThanOrEqual(FORK_EXIT_SEGMENTS);
    for (const seg of marked) {
      expect(seg.forkExit, `segment ${seg.index}`).toBeDefined();
      expect(seg.forkExit?.side).toBe(1);
    }
    expect(marked[0].forkExit?.t).toBe(0);
    for (let i = 1; i < marked.length; i++) {
      expect(marked[i].forkExit!.t).toBeGreaterThanOrEqual(marked[i - 1].forkExit!.t);
    }
  });

  test('segments past FORK_EXIT_SEGMENTS have no forkExit', () => {
    const snap = snapshotAfterJunction(0.85);
    const untouched = snap.segments.filter((s) => s.index >= FORK_EXIT_SEGMENTS);
    expect(untouched.length).toBeGreaterThan(0);
    for (const seg of untouched) expect(seg.forkExit).toBeUndefined();
  });

  test('driving left marks side -1 instead', () => {
    const snap = snapshotAfterJunction(-0.85);
    expect(snap.stage.id).toBe('1-0');
    const first = snap.segments.find((s) => s.index === 0);
    expect(first?.forkExit?.side).toBe(-1);
  });

  // Bivio v3: dopo il commit `x` è relativa alla strada scelta; mezza
  // carreggiata dal centro è la linea naturale, non il bordo.
  const carriagewayCentre = 0.5;

  test('after the junction the player sits back on the road, near the centre (spec §4.4)', () => {
    const snap = snapshotAfterJunction(carriagewayCentre);
    expect(Math.abs(snap.player.x)).toBeLessThanOrEqual(0.5);
    expect(snap.player.surface).toBe('road');
  });

  test('the same is true taking the left branch, mirrored', () => {
    const snap = snapshotAfterJunction(-carriagewayCentre);
    expect(Math.abs(snap.player.x)).toBeLessThanOrEqual(0.5);
    expect(snap.player.surface).toBe('road');
  });
});

describe('spriteOffsetOf e hidesDiscardedSide (terzo addendum del collaudo, generalizzati dal bivio v3)', () => {
  const plain = (): Segment => ({ ...buildTrack(STAGE_LIST[0])[0], sprites: [] });
  const near = (): DiscardedRoad => ({ near: -2.5, far: -2.6, halfNear: 1, halfFar: 1 });
  const far = (): DiscardedRoad => ({ near: -30, far: -30.2, halfNear: 1, halfFar: 1 });

  test('without a discarded road it is forkOffset; a fixed sprite stays where it is', () => {
    const seg = plain();
    for (const offset of [-2.5, -1.1, 0, 1.5]) {
      expect(spriteOffsetOf({ name: 'common_boulder', offset }, seg)).toBe(forkOffset(offset, seg.roadHalf));
    }
    const wide = { ...seg, roadHalf: 5 };
    expect(spriteOffsetOf({ name: 'race_checkpoint', offset: 7, fixed: true }, wide)).toBe(7);
  });

  test('a sprite that would fall on a near discarded road is moved beyond it; the other side is untouched', () => {
    const seg = { ...plain(), discarded: near() };
    const moved = spriteOffsetOf({ name: 'common_boulder', offset: -2.5 }, seg);
    expect(moved).toBeLessThan(-(2.5 + 1));
    expect(spriteOffsetOf({ name: 'common_boulder', offset: 2.5 }, seg)).toBe(forkOffset(2.5, seg.roadHalf));
    // Uno sprite sull'asfalto della strada scelta non la tocca.
    expect(spriteOffsetOf({ name: 'common_boulder', offset: -0.5 }, seg)).toBe(-0.5);
  });

  test('a far discarded road (the v3 exit, more than FORK_EXIT_REACH away) moves nothing and hides nothing', () => {
    const seg = { ...plain(), discarded: far() };
    expect(Math.abs(far().near) - far().halfNear).toBeGreaterThan(FORK_EXIT_REACH);
    expect(spriteOffsetOf({ name: 'common_boulder', offset: -2.5 }, seg)).toBe(forkOffset(-2.5, seg.roadHalf));
    expect(hidesDiscardedSide(-1, seg)).toBe(false);
    expect(hidesDiscardedSide(1, seg)).toBe(false);
  });

  test('hidesDiscardedSide: true only on the side of a near discarded road', () => {
    expect(hidesDiscardedSide(-1, plain())).toBe(false);
    const seg = { ...plain(), discarded: near() };
    expect(hidesDiscardedSide(-1, seg)).toBe(true);
    expect(hidesDiscardedSide(1, seg)).toBe(false);
    // Un segmento marcato solo con `forkExit` usa la strada di riferimento
    // (base 1, a più di 20 unità): lontana.
    expect(hidesDiscardedSide(-1, { ...plain(), forkExit: { side: 1, t: 0 } })).toBe(false);
  });

  test("il renderer (sprites.ts) e le collisioni (traffic.ts) concordano sull'offset vero di uno sprite", () => {
    // checkCollisions usa `spriteOffsetOf` esattamente come renderSprites:
    // un giocatore sulla posizione spostata trova lo sprite, uno al centro no.
    const seg = { ...plain(), discarded: near(), sprites: [{ name: 'common_boulder' as const, offset: -1.5 }] };
    const worldX = spriteOffsetOf(seg.sprites[0], seg);
    const entry = CATALOG.common_boulder;
    const onIt = { ...initialPlayer(), x: worldX, speed: 12000 };
    const clearOfIt = { ...initialPlayer(), x: 0, speed: 12000 };
    expect(checkCollisions(onIt, seg).kind).not.toBe('none');
    expect(checkCollisions(clearOfIt, seg).kind).toBe('none');
    expect(Math.abs(worldX - forkOffset(-1.5, seg.roadHalf))).toBeGreaterThan(entry.collideW);
  });

  test('on the real stages the exit moves no sprite and hides no wall or water: the new stage keeps its scenery', () => {
    for (const stage of STAGE_LIST) {
      for (const side of [-1, 1] as const) {
        const segs = buildTrack(stage);
        markForkExit(segs, side, FORK_EXIT_BASE_OFFSET * 0.8, FORK_EXIT_SLOPE, stage.roadHalf ?? 1);
        for (let i = 0; i < FORK_EXIT_SEGMENTS; i++) {
          const seg = segs[i];
          expect(hidesDiscardedSide(side === 1 ? -1 : 1, seg), `${stage.id} seg ${i}`).toBe(false);
          for (const placed of seg.sprites) {
            expect(spriteOffsetOf(placed, seg), `${stage.id} seg ${i} ${placed.name}`).toBe(
              forkOffset(placed.offset, seg.roadHalf),
            );
          }
        }
      }
    }
  });
});
