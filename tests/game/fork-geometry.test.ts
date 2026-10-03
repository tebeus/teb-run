// Bivio v3: una Y vera (deroga «bivio v3, collaudo utente», brief
// .superpowers/sdd/fork-v3-brief.md). Il collaudo dell'utente, per la terza
// volta, «le strade ancora si dividono male»: la v2 allargava la strada al
// doppio e poi apriva due carreggiate parallele. Qui la strada si allarga
// poco fino alla punta, il lato si fissa alla punta (commit), e i due rami
// divergono ad angolo e poi in curva, fino all'orizzonte.
import { describe, expect, test } from 'vitest';
import { LAST_LEVEL, levelOf, REAL_GRAPH, STAGE_LIST } from '../../src/game/stages';
import {
  buildTrack,
  commitFork,
  FORK_AFTER_COMMIT,
  FORK_COMMIT,
  FORK_EXIT_BASE_OFFSET,
  FORK_SPLIT_SLOPE,
  FORK_TIP,
  FORK_TIP_HALF,
  FORK_TURN_CURVE,
  FORK_ZONE_SEGMENTS,
  forkBranchCentre,
  forkBranchHalf,
  forkTurnCurve,
  forkZoneShape,
  MIN_STAGE_SEGMENTS,
  xLimitsOf,
} from '../../src/game/track';
import { createFullRace, updateVisible } from '../../src/game/race';
import { initialPlayer, STEER_RATE, X_LIMIT } from '../../src/game/player';
import { createStageGraph } from '../../src/game/stage-graph';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { PLAYER_Z, SEGMENT_LENGTH } from '../../src/render/project';
import type { AssetStore, RaceEngine, RaceSnapshot, Segment, StageDef } from '../../src/types';
import { makeAsset } from '../helpers/segments';
import { centresOf } from '../helpers/prudent-driver';
import { EXPERT_CONFIG, expertActionsWith } from '../helpers/expert-driver';
import { acts } from '../helpers/race-script';

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
  timeLimit: 600,
  seed: 4242,
  difficulty: 0,
  ...over,
});

const newRace = (stages: readonly StageDef[]): RaceEngine => {
  const graph = createStageGraph(stages);
  return createFullRace({ graph, assets: stubAssets(), startStage: graph.first(), skipCountdown: true });
};

const SHORT = [shortStage('0-0', 'Alpha'), shortStage('1-0', 'Bravo'), shortStage('1-1', 'Charlie')];

describe('forkZoneShape: la forma statica della Y', () => {
  test('before the tip there is one road, widening a little, up to FORK_TIP_HALF', () => {
    expect(forkZoneShape(0)).toEqual({ roadHalf: 1, median: 0 });
    let prev = 1;
    for (let i = 0; i < FORK_TIP; i++) {
      const s = forkZoneShape(i);
      expect(s.median, `i=${i}`).toBe(0);
      expect(s.roadHalf, `i=${i}`).toBeGreaterThanOrEqual(prev);
      expect(s.roadHalf, `i=${i}`).toBeLessThanOrEqual(FORK_TIP_HALF);
      prev = s.roadHalf;
    }
    // Niente più fase «doppia larghezza» della v2: la punta resta una strada
    // poco più larga del normale.
    expect(FORK_TIP_HALF).toBeLessThan(2);
  });

  test('the tip has the same absolute width whatever the base: a narrow town or alpine road widens more', () => {
    expect(forkZoneShape(0, 0.8).roadHalf).toBeCloseTo(0.8, 9);
    expect(forkZoneShape(FORK_TIP, 0.8).roadHalf).toBeCloseTo(FORK_TIP_HALF, 9);
    expect(forkZoneShape(FORK_TIP, 1).roadHalf).toBeCloseTo(FORK_TIP_HALF, 9);
    expect(forkBranchHalf(FORK_TIP, 0.8)).toBeCloseTo(FORK_TIP_HALF / 2, 9);
  });

  test('at the tip the two halves meet with no jump, then the island opens at once', () => {
    const before = forkZoneShape(FORK_TIP - 1e-9);
    const tip = forkZoneShape(FORK_TIP);
    expect(tip.roadHalf).toBeCloseTo(before.roadHalf, 6);
    expect(tip.median).toBeCloseTo(0, 9);
    for (let i = FORK_TIP + 1; i <= FORK_ZONE_SEGMENTS; i++) {
      expect(forkZoneShape(i).median, `i=${i}`).toBeGreaterThan(0);
    }
  });

  test('each branch grows from half the road to the full base width', () => {
    expect(forkBranchHalf(FORK_TIP)).toBeCloseTo(FORK_TIP_HALF / 2, 9);
    expect(forkBranchHalf(FORK_ZONE_SEGMENTS)).toBe(1);
    expect(forkBranchHalf(FORK_ZONE_SEGMENTS, 0.8)).toBeCloseTo(0.8, 9);
  });

  test('the branches split at an angle and never turn parallel: the gap only ever grows', () => {
    const slope = (i: number): number => forkBranchCentre(i + 1) - forkBranchCentre(i);
    expect(slope(FORK_TIP)).toBeCloseTo(FORK_SPLIT_SLOPE, 9);
    for (let i = FORK_TIP; i < FORK_ZONE_SEGMENTS; i++) {
      // Mai sotto il 95 % della pendenza della punta: la deriva si spegne
      // mentre la curva la sostituisce.
      expect(slope(i), `i=${i}`).toBeGreaterThan(0.95 * FORK_SPLIT_SLOPE);
    }
    // Più che lineare nel complesso: in fondo diverge molto più che alla punta.
    expect(slope(FORK_ZONE_SEGMENTS - 1)).toBeGreaterThan(1.5 * FORK_SPLIT_SLOPE);
  });

  test('seen from before the zone, both arms keep moving outwards on screen up to the horizon (a Y, not two parallel roads)', () => {
    // In prospettiva la x a schermo di un ramo è proporzionale a c / d, con d
    // la distanza dalla telecamera: una distanza costante fra i rami
    // convergerebbe al punto di fuga.
    for (const cam of [-40, -10, 0, FORK_TIP - 10]) {
      let prev = 0;
      for (let i = FORK_TIP + 5; i <= FORK_ZONE_SEGMENTS; i++) {
        const d = i - cam + PLAYER_Z / SEGMENT_LENGTH;
        const onScreen = forkBranchCentre(i) / d;
        // Un per cento di tolleranza: appena dopo la punta la deriva si
        // spegne un filo prima che la curva la sostituisca (pendenza al 97 %).
        expect(onScreen, `camera ${cam}, segment ${i}`).toBeGreaterThanOrEqual(0.99 * prev);
        prev = onScreen;
      }
    }
  });

  test('the far arms are well apart: at the end of the zone the branch centres are more than 20 units apart', () => {
    expect(2 * forkBranchCentre(FORK_ZONE_SEGMENTS)).toBeGreaterThan(20);
    expect(FORK_EXIT_BASE_OFFSET).toBeCloseTo(2 * forkBranchCentre(FORK_ZONE_SEGMENTS), 9);
  });

  test('the turn after the commit is an easy curve that ramps in and goes back to zero before the junction', () => {
    expect(forkTurnCurve(0)).toBe(0);
    let peak = 0;
    for (let n = 0; n < FORK_AFTER_COMMIT; n++) peak = Math.max(peak, forkTurnCurve(n));
    expect(peak).toBe(FORK_TURN_CURVE);
    expect(FORK_TURN_CURVE).toBe(2);
    for (let n = FORK_AFTER_COMMIT - 60; n < FORK_AFTER_COMMIT; n++) expect(forkTurnCurve(n)).toBe(0);
  });
});

describe('buildTrack: la zona di bivio è la Y statica', () => {
  test('every real stage but level 4 carries the static Y, with both ends of each segment', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zone = segs.slice(segs.length - FORK_ZONE_SEGMENTS);
      if (levelOf(stage.id) === LAST_LEVEL) {
        for (const seg of zone) expect(seg.fork, stage.id).toBeUndefined();
        continue;
      }
      const base = stage.roadHalf ?? 1;
      zone.forEach((seg, i) => {
        expect(seg.fork).toBe('zone');
        expect(seg.curve).toBe(0);
        expect(seg.roadHalf).toBeCloseTo(forkZoneShape(i, base).roadHalf, 9);
        expect(seg.median).toBeCloseTo(forkZoneShape(i, base).median, 9);
        expect(seg.roadHalfFar).toBeCloseTo(forkZoneShape(i + 1, base).roadHalf, 9);
        expect(seg.medianFar).toBeCloseTo(forkZoneShape(i + 1, base).median, 9);
      });
    }
  });
});

/** Posizioni a schermo dei centri dei due rami (o strada scelta e scartata), capo vicino. */
function branchScreenX(seg: Segment): [number, number] {
  const { x, w } = seg.p1.screen;
  if (seg.discarded !== undefined) return [x, x + seg.discarded.near * w];
  const c = (seg.median + seg.roadHalf) / 2;
  return [x - c * w, x + c * w];
}

describe('commitFork: al commit la vista non cambia', () => {
  test.each([
    [-1, 'left'],
    [1, 'right'],
  ] as const)('committing to the %s side redraws the same Y from a camera just before the tip (%s)', (side, _name) => {
    const stage = STAGE_LIST.find((s) => s.id === '0-0')!;
    const segs = buildTrack(stage);
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    const player = { ...initialPlayer(), z: (zoneStart + FORK_COMMIT) * SEGMENT_LENGTH - 30, x: side * 0.3 };
    const before = updateVisible(segs, player, LOGICAL_W, LOGICAL_H).map((s) => ({
      index: s.index,
      xs: branchScreenX(s),
      w: s.p1.screen.w,
    }));
    const shift = commitFork(segs, side, 1);
    expect(shift).toBeCloseTo(-side * forkBranchCentre(FORK_COMMIT), 9);
    const after = updateVisible(segs, { ...player, x: player.x + shift }, LOGICAL_W, LOGICAL_H);
    let compared = 0;
    for (let k = 0; k < after.length; k++) {
      const seg = after[k];
      if (seg.index < zoneStart + FORK_COMMIT || seg.index >= segs.length) continue;
      if (!(before[k].w > 0.5)) continue;
      const [chosenBefore, otherBefore] = side < 0 ? before[k].xs : [before[k].xs[1], before[k].xs[0]];
      const [chosen, discarded] = branchScreenX(seg);
      expect(chosen, `segment ${seg.index}`).toBeCloseTo(chosenBefore, 3);
      expect(discarded, `segment ${seg.index}`).toBeCloseTo(otherBefore, 3);
      compared++;
    }
    expect(compared).toBeGreaterThan(150);
  });

  test('after the commit the chosen road curves towards its side and the zone is one road plus the discarded one', () => {
    const stage = STAGE_LIST.find((s) => s.id === '0-0')!;
    const segs = buildTrack(stage);
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    commitFork(segs, -1, 1, 0.8);
    const rest = segs.slice(zoneStart + FORK_COMMIT);
    expect(rest.some((s) => s.curve < 0)).toBe(true);
    expect(rest.every((s) => s.curve <= 0)).toBe(true);
    for (const seg of rest) {
      expect(seg.median).toBe(0);
      expect(seg.discarded!.near).toBeGreaterThan(0);
    }
    // In fondo la strada scelta ha la base della tappa nuova, e la curva è finita.
    const last = segs[segs.length - 1];
    expect(last.curve).toBe(0);
    expect(last.roadHalfFar).toBeCloseTo(0.8, 9);
    // La fisica non raggiunge la strada scartata: il suo bordo interno chiude il lato.
    const first = segs[zoneStart + FORK_COMMIT];
    expect(xLimitsOf(first).max).toBeCloseTo(first.discarded!.near - first.discarded!.halfNear, 9);
    expect(xLimitsOf(first).min).toBe(-X_LIMIT);
    expect(xLimitsOf(segs[10])).toEqual({ min: -X_LIMIT, max: X_LIMIT });
  });

  test('every sprite of the rewritten zone keeps its place on screen, and the chosen checkpoint lands on the chosen road', () => {
    const stage = STAGE_LIST.find((s) => s.id === '0-0')!;
    const segs = buildTrack(stage);
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    commitFork(segs, 1, 1);
    const portals = segs
      .slice(zoneStart + FORK_COMMIT)
      .flatMap((s) => s.sprites.filter((p) => p.name === 'race_checkpoint').map((p) => ({ p, s })));
    expect(portals).toHaveLength(2);
    const offsets = portals.map(({ p }) => p.offset).sort((a, b) => a - b);
    expect(offsets[1]).toBeCloseTo(0, 9);
    expect(offsets[0]).toBeCloseTo(portals[0].s.discarded!.near, 9);
  });
});

/** Autopilota che tiene x vicino a `target`, gas pieno e marcia alta. */
function centre(snap: RaceSnapshot, target: number, first: boolean): ReturnType<typeof acts> {
  const dx = target - snap.player.x;
  return acts({ accelerate: true, gearToggle: first, left: dx < -0.05, right: dx > 0.05 });
}

describe('fisica: tenere la freccia al bivio a tavoletta (collaudo utente)', () => {
  // Una tappa per base vera: 0-0 (spiaggia, base 1), 2-1 (montagna, 0,8) e
  // 3-0 (città, 0,8, con la pioggia). Il caso peggiore è la corsia esterna
  // dal lato della freccia: prima della punta ci si sposta di circa
  // un'unità, dopo il ramo porta con sé l'auto ma non la riavvicina
  // (revisione finale K: su 2-1 e 3-0 si finiva sull'erba a 71 km/h).
  const cases = ['0-0', '2-1', '3-0'].flatMap((id) =>
    (['L', 'R'] as const).flatMap((side) =>
      (['same', 'other'] as const).map((lane) => [id, side, lane] as const),
    ),
  );
  test.each(cases)(
    'on %s, holding %s for 1.5 s from the fork banner at full speed, from the outer lane on the %s side, touches the grass for under 70 ticks, never drops under 120 km/h and takes that branch',
    (id, side, lane) => {
      // Tappe vere, col loro traffico, che la zona non ha: le tappe corte da
      // `MIN_STAGE_SEGMENTS` mettono tutto il traffico al segmento 360, che
      // lì cade dentro la zona (`trafficSpan`, da prima del bivio v3).
      const stage = STAGE_LIST.find((s) => s.id === id)!;
      const start: StageDef = { ...stage, timeLimit: 600 };
      const race = createFullRace({ graph: REAL_GRAPH, assets: stubAssets(), startStage: start, skipCountdown: true });
      // Fino alla zona guida il pilota esperto, che non si schianta: con
      // l'incidente lungo (terzo collaudo) uno schianto del prudente lo
      // faceva arrivare al bivio ancora in ripresa. Negli ultimi 150
      // segmenti prima della zona si mette sulla corsia esterna scelta
      // (`prefer`), scansando il traffico se serve.
      const outerFromZ = (stage.lengthSegments - FORK_ZONE_SEGMENTS - 150) * SEGMENT_LENGTH;
      const outerSign = (side === 'L') === (lane === 'same') ? -1 : 1;
      let holdLeft = -1;
      let minKmh = Infinity;
      let where = '';
      let grassTicks = 0;
      let atFork = 0;
      let checkpoint: StageDef | undefined;
      for (let tick = 0; tick < 60 * 200 && checkpoint === undefined; tick++) {
        const snap = race.snapshot();
        if (holdLeft < 0 && snap.banner === 'fork') {
          holdLeft = 90;
          atFork = snap.kmh;
        }
        const holding = holdLeft > 0;
        const centres = centresOf(snap);
        const outer = holdLeft < 0 && snap.player.z > outerFromZ ? outerSign * centres[centres.length - 1] : undefined;
        const a = holding
          ? acts({ accelerate: true, left: side === 'L', right: side === 'R' })
          : expertActionsWith(EXPERT_CONFIG, snap, side, outer);
        if (holding) holdLeft--;
        const events = race.update(1 / 60, a);
        const after = race.snapshot();
        if (holdLeft >= 0) {
          const at = `tick ${tick}, z ${Math.round(after.player.z)}, x ${after.player.x.toFixed(2)}, ${after.player.surface}`;
          if (after.kmh < minKmh) {
            minKmh = after.kmh;
            where = at;
          }
          if (after.player.surface === 'grass') grassTicks++;
        }
        for (const e of events) if (e.type === 'checkpoint') checkpoint = e.nextStage;
      }
      expect(checkpoint?.id).toBe(REAL_GRAPH.next(start, side)?.id);
      // A tavoletta davvero: 90 tick di freccia sono 3 unità di sterzo.
      expect(atFork).toBeGreaterThan(250);
      expect(90 * (STEER_RATE / 60)).toBeCloseTo(3, 9);
      // Chi continua a sterzare verso l'esterno dopo la punta tocca l'erba al
      // bordo del ramo nell'ultimo secondo della freccia (fino a 65 tick
      // misurati, contro gli oltre 100 della punta larga 1,5 per base), e ne
      // esce appena la lascia: la velocità resta sopra i 120 km/h.
      expect(grassTicks).toBeLessThan(70);
      expect(minKmh, where).toBeGreaterThan(120);
    },
  );

  test('the side is fixed at the tip: steering across afterwards does not change the branch', () => {
    const race = newRace(SHORT);
    const tipZ = (MIN_STAGE_SEGMENTS - FORK_ZONE_SEGMENTS + FORK_COMMIT) * SEGMENT_LENGTH;
    let first = true;
    let checkpoint: StageDef | undefined;
    for (let tick = 0; tick < 60 * 120 && checkpoint === undefined; tick++) {
      const snap = race.snapshot();
      // Prima della punta a sinistra, dopo tutto a destra contro il limite.
      const a = snap.player.z < tipZ ? centre(snap, -0.6, first) : acts({ accelerate: true, right: true });
      first = false;
      for (const e of race.update(1 / 60, a)) if (e.type === 'checkpoint') checkpoint = e.nextStage;
      const after = race.snapshot();
      if (after.player.z > tipZ && after.stage.id === '0-0') {
        const seg = after.segments.find((s) => s.index === Math.floor(after.player.z / SEGMENT_LENGTH));
        if (seg?.discarded !== undefined) {
          expect(after.player.x).toBeLessThanOrEqual(seg.discarded.near - seg.discarded.halfNear + 1e-9);
        }
      }
    }
    expect(checkpoint?.id).toBe('1-0');
  });
});

describe('giunzione: la tappa nuova continua la zona senza salti', () => {
  test.each(['L', 'R'] as const)('taking %s, the exit starts exactly where the zone left the discarded road', (side) => {
    const race = newRace(SHORT);
    const target = side === 'L' ? -0.5 : 0.5;
    const tipZ = (MIN_STAGE_SEGMENTS - FORK_ZONE_SEGMENTS + FORK_COMMIT) * SEGMENT_LENGTH;
    let before: RaceSnapshot | undefined;
    let first = true;
    for (let tick = 0; tick < 60 * 120; tick++) {
      const snap = race.snapshot();
      const events = race.update(1 / 60, centre(snap, snap.player.z < tipZ ? target : 0, first));
      first = false;
      if (events.some((e) => e.type === 'checkpoint')) break;
      before = race.snapshot();
    }
    const after = race.snapshot();
    const last = before!.segments.find((s) => s.index === MIN_STAGE_SEGMENTS - 1)!;
    const next = after.segments.find((s) => s.index === 0)!;
    expect(last.discarded).toBeDefined();
    expect(next.discarded!.near).toBeCloseTo(last.discarded!.far, 9);
    expect(next.discarded!.halfNear).toBeCloseTo(last.discarded!.halfFar, 9);
    expect(next.forkExit).toEqual({ side: side === 'L' ? -1 : 1, t: 0 });
    // La strada del giocatore: stessa larghezza, niente ricentratura.
    expect(next.roadHalf).toBeCloseTo(last.roadHalfFar!, 9);
    expect(last.median).toBe(0);
    expect(after.player.x).toBeCloseTo(before!.player.x, 1);
    // Dove sta la strada scartata ora: molto lontana, fuori schermo.
    expect(Math.abs(next.discarded!.near)).toBeGreaterThan(20);
  });
});
