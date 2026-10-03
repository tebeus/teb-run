import { describe, expect, test } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { STAGE_LIST, stageById } from '../../src/game/stages';
import { surfaceBlendOf, surfaceMixOf } from '../../src/game/surface';
import {
  buildTrack,
  FORK_EXIT_SEGMENTS,
  FORK_ZONE_SEGMENTS,
  INTRO_SEGMENTS,
  markSurfaceRun,
  placeSurfaces,
  SURFACE_RAMP,
  SURFACE_RUN_MAX,
  SURFACE_RUN_MIN,
  SURFACE_RUN_MIN_USABLE,
  SURFACE_RUNS_MAX,
  SURFACE_SPACE_MIN,
  SURFACE_THEMES,
  surfaceRampMix,
  surfaceRunEnd,
} from '../../src/game/track';
import type { Segment, ThemeId } from '../../src/types';
import { makeFlatTrack } from '../helpers/segments';

/** Indici dei segmenti marcati, in ordine. */
const marked = (segs: readonly Segment[]): number[] =>
  segs.filter((s) => s.surfaceKind !== undefined).map((s) => s.index);

/** I tratti come coppie [primo, ultimo] di indici contigui. */
const runs = (segs: readonly Segment[]): [number, number][] => {
  const out: [number, number][] = [];
  for (const i of marked(segs)) {
    const last = out[out.length - 1];
    if (last !== undefined && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
};

describe('SURFACE_THEMES e le costanti dei tratti (spec §4.4f)', () => {
  test('dirt in the desert and in the countryside, snow in the mountains, nothing on the beach or in town', () => {
    expect(SURFACE_THEMES.desert).toBe('dirt');
    expect(SURFACE_THEMES.farm).toBe('dirt');
    expect(SURFACE_THEMES.alpine).toBe('snow');
    expect(SURFACE_THEMES.beach).toBeNull();
    expect(SURFACE_THEMES.town).toBeNull();
  });

  test('every theme has an entry, so a theme added later cannot be forgotten', () => {
    const themes: readonly ThemeId[] = ['beach', 'desert', 'alpine', 'farm', 'town'];
    for (const t of themes) expect(Object.keys(SURFACE_THEMES)).toContain(t);
    expect(Object.keys(SURFACE_THEMES)).toHaveLength(themes.length);
  });

  test('the constants are the ones the spec declares, and a run has room for two ramps', () => {
    expect(SURFACE_RUN_MIN).toBe(120);
    // 200, non 300: leva 1 del task 12 (taratura del binario K).
    expect(SURFACE_RUN_MAX).toBe(200);
    expect(SURFACE_RAMP).toBe(12);
    expect(SURFACE_RUNS_MAX).toBe(3);
    expect(SURFACE_RUN_MIN_USABLE).toBe(2 * SURFACE_RAMP + 1);
    expect(SURFACE_RUN_MIN).toBeGreaterThan(SURFACE_RUN_MIN_USABLE);
  });
});

describe('surfaceRampMix: la rampa (spec §4.4f)', () => {
  test('a long run is flat at one in the middle and zero at both ends', () => {
    const n = 200;
    expect(surfaceRampMix(0, n)).toBe(0);
    expect(surfaceRampMix(SURFACE_RAMP, n)).toBe(1);
    expect(surfaceRampMix(100, n)).toBe(1);
    expect(surfaceRampMix(n - 1 - SURFACE_RAMP, n)).toBe(1);
    expect(surfaceRampMix(n - 1, n)).toBe(0);
  });

  test('the two ramps are symmetric', () => {
    const n = 200;
    for (let k = 0; k <= SURFACE_RAMP; k++) {
      expect(surfaceRampMix(k, n)).toBeCloseTo(surfaceRampMix(n - 1 - k, n), 12);
    }
  });

  test('the ramp rises without going back', () => {
    let prev = -1;
    for (let k = 0; k <= SURFACE_RAMP; k++) {
      const now = surfaceRampMix(k, 200);
      expect(now).toBeGreaterThan(prev);
      prev = now;
    }
  });

  test('surfaceMix never leaves the unit interval (Review Focus 3)', () => {
    for (const n of [0, 1, 2, 24, 25, 26, 120, 300]) {
      for (let k = -3; k < n + 3; k++) {
        const mix = surfaceRampMix(k, n);
        expect(mix, `offset ${k} of ${n}`).toBeGreaterThanOrEqual(0);
        expect(mix, `offset ${k} of ${n}`).toBeLessThanOrEqual(1);
        expect(Number.isFinite(mix), `offset ${k} of ${n}`).toBe(true);
      }
    }
  });

  test('a run shorter than two ramps still has a peak, and a zero length run has none', () => {
    // Con `length = 2 * ramp + 1` la rampa si accorcia a metà lunghezza
    // e il centro arriva a 1 esatto.
    const n = SURFACE_RUN_MIN_USABLE;
    expect(surfaceRampMix(SURFACE_RAMP, n)).toBe(1);
    expect(surfaceRampMix(0, n)).toBe(0);
    expect(surfaceRampMix(n - 1, n)).toBe(0);
    expect(surfaceRampMix(0, 0)).toBe(0);
  });

  test('a ramp of zero segments is a step: every segment is fully the run', () => {
    expect(surfaceRampMix(0, 10, 0)).toBe(1);
    expect(surfaceRampMix(9, 10, 0)).toBe(1);
  });
});

describe('surfaceRunEnd: dove un tratto si ferma (Review Focus 3)', () => {
  test('a clear stretch runs to the limit', () => {
    expect(surfaceRunEnd(makeFlatTrack(400), 100, 300)).toBe(300);
  });

  test('a run stops at the first dual carriageway segment', () => {
    const segs = makeFlatTrack(400);
    segs[220].median = 0.4;
    expect(surfaceRunEnd(segs, 100, 300)).toBe(220);
  });

  test('a run stops at the first fork segment', () => {
    const segs = makeFlatTrack(400);
    segs[180].fork = 'zone';
    expect(surfaceRunEnd(segs, 100, 300)).toBe(180);
  });

  test('a run that starts on a forbidden segment has length zero', () => {
    const segs = makeFlatTrack(400);
    segs[100].median = 0.4;
    expect(surfaceRunEnd(segs, 100, 300)).toBe(100);
  });
});

describe('markSurfaceRun: scrive, non somma', () => {
  test('the run writes the kind and the ramp on every segment it covers', () => {
    const segs = makeFlatTrack(400);
    markSurfaceRun(segs, 100, 200, 'dirt');
    expect(marked(segs)).toEqual(Array.from({ length: 100 }, (_, i) => 100 + i));
    expect(segs[100].surfaceMix).toBe(0);
    expect(segs[100 + SURFACE_RAMP].surfaceMix).toBe(1);
    expect(segs[199].surfaceMix).toBe(0);
    expect(segs[99].surfaceKind).toBeUndefined();
    expect(segs[200].surfaceKind).toBeUndefined();
  });

  test('two overlapping runs cannot push the mix above one: the second writes over the first', () => {
    const segs = makeFlatTrack(400);
    markSurfaceRun(segs, 100, 200, 'dirt');
    markSurfaceRun(segs, 150, 250, 'snow');
    for (const seg of segs) {
      expect(surfaceMixOf(seg)).toBeLessThanOrEqual(1);
      expect(surfaceMixOf(seg)).toBeGreaterThanOrEqual(0);
    }
    expect(segs[160].surfaceKind).toBe('snow');
    expect(segs[120].surfaceKind).toBe('dirt');
  });
});

describe('placeSurfaces sulle tappe vere (spec §4.4f)', () => {
  test('a beach stage and a town stage get no run at all', () => {
    for (const id of ['0-0', '1-1', '4-4', '3-0', '4-0']) {
      const segs = buildTrack(stageById(id));
      expect(marked(segs), `stage ${id}`).toEqual([]);
    }
  });

  test('a desert, a farm and an alpine stage all get at least one run', () => {
    for (const id of ['1-0', '2-0', '2-2', '3-2', '2-1', '3-1', '4-1', '3-3', '4-3', '4-2']) {
      const segs = buildTrack(stageById(id));
      expect(runs(segs).length, `stage ${id}`).toBeGreaterThanOrEqual(1);
    }
  });

  test('every run carries the kind of its theme, and only that kind', () => {
    for (const stage of STAGE_LIST) {
      const want = SURFACE_THEMES[stage.theme];
      const kinds = new Set(buildTrack(stage).map((s) => s.surfaceKind).filter((k) => k !== undefined));
      if (want === null) expect(kinds.size, stage.id).toBe(0);
      else expect([...kinds], stage.id).toEqual([want]);
    }
  });

  test('no surface run enters the intro, the fork zone or a dual carriageway (Review Focus 3)', () => {
    // Questo test copre di riflesso due delle attese della Review Focus
    // 3: «nessun cordolo soppresso dentro la zona di bivio» segue da
    // «nessun `surfaceKind` dentro la zona», perché `hasKerb` guarda solo
    // `surfaceKind`; e i segmenti di `addFlatten` stanno fra il corpo e
    // la zona di bivio, quindi un tratto che li raggiungesse verrebbe
    // troncato dal limite `zoneStart` come tutti gli altri. Nessuno dei
    // due ha un test proprio, e va bene così: non hanno codice proprio.
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (const seg of segs) {
        if (seg.surfaceKind === undefined) continue;
        expect(seg.index, `${stage.id} segment ${seg.index}`).toBeGreaterThanOrEqual(INTRO_SEGMENTS);
        expect(seg.index, `${stage.id} segment ${seg.index}`).toBeLessThan(zoneStart);
        expect(seg.median, `${stage.id} segment ${seg.index}`).toBe(0);
        expect(seg.fork, `${stage.id} segment ${seg.index}`).toBeUndefined();
      }
    }
  });

  test('no surface run starts inside the fork exit: the discarded road never takes the player\'s dirt or snow', () => {
    // I primi `FORK_EXIT_SEGMENTS` di ogni tappa mostrano la strada scartata
    // al bivio (spec §4.4, «Uscita dal bivio»), che il renderer disegna col
    // fondo del segmento: un tratto lì la sporcherebbe di terra o di neve.
    for (const stage of STAGE_LIST) {
      for (const seg of buildTrack(stage)) {
        if (seg.surfaceKind === undefined) continue;
        expect(seg.index, `${stage.id} segment ${seg.index}`).toBeGreaterThanOrEqual(FORK_EXIT_SEGMENTS);
      }
    }
  });

  test('surfaceMix stays in the unit interval on all fifteen stages (Review Focus 3)', () => {
    for (const stage of STAGE_LIST) {
      for (const seg of buildTrack(stage)) {
        const mix = seg.surfaceMix;
        if (mix === undefined) continue;
        expect(mix, `${stage.id} segment ${seg.index}`).toBeGreaterThanOrEqual(0);
        expect(mix, `${stage.id} segment ${seg.index}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('at most SURFACE_RUNS_MAX runs, each at least usable and at most SURFACE_RUN_MAX long', () => {
    for (const stage of STAGE_LIST) {
      const list = runs(buildTrack(stage));
      expect(list.length, stage.id).toBeLessThanOrEqual(SURFACE_RUNS_MAX);
      for (const [from, to] of list) {
        const length = to - from + 1;
        expect(length, `${stage.id} run at ${from}`).toBeGreaterThanOrEqual(SURFACE_RUN_MIN_USABLE);
        expect(length, `${stage.id} run at ${from}`).toBeLessThanOrEqual(SURFACE_RUN_MAX);
      }
    }
  });

  test('two runs on the same stage never touch: there is asphalt between them', () => {
    for (const stage of STAGE_LIST) {
      const list = runs(buildTrack(stage));
      for (let i = 1; i < list.length; i++) {
        expect(list[i][0] - list[i - 1][1] - 1, stage.id).toBeGreaterThanOrEqual(SURFACE_SPACE_MIN);
      }
    }
  });

  test('every run begins and ends with a ramp: no hard edge across the road', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (const [from, to] of runs(segs)) {
        expect(segs[from].surfaceMix, `${stage.id} at ${from}`).toBe(0);
        expect(segs[to].surfaceMix, `${stage.id} at ${to}`).toBe(0);
        expect(segs[from + SURFACE_RAMP].surfaceMix, `${stage.id} at ${from}`).toBe(1);
      }
    }
  });

  test('the same seed gives the same runs, a different seed does not', () => {
    const stage = stageById('2-0');
    expect(runs(buildTrack(stage))).toEqual(runs(buildTrack(stage)));
    const other = { ...stage, seed: stage.seed + 1 };
    expect(runs(buildTrack(other))).not.toEqual(runs(buildTrack(stage)));
  });

  test('placeSurfaces on a track with no room places nothing and does not throw', () => {
    const segs = makeFlatTrack(INTRO_SEGMENTS + FORK_ZONE_SEGMENTS + 4);
    for (let i = segs.length - FORK_ZONE_SEGMENTS; i < segs.length; i++) segs[i].fork = 'zone';
    expect(() => placeSurfaces(segs, stageById('2-0'), mulberry32(7))).not.toThrow();
    expect(marked(segs)).toEqual([]);
  });

  test('a segment with a run resolves to that surface, and one without to asphalt (Review Focus 1)', () => {
    const stage = stageById('2-0');
    const segs = buildTrack(stage);
    const [from, to] = runs(segs)[0];
    const middle = Math.floor((from + to) / 2);
    expect(surfaceBlendOf(segs[middle], stage.weather)).toEqual({
      base: 'asphalt',
      kind: 'dirt',
      mix: 1,
    });
    expect(surfaceBlendOf(segs[INTRO_SEGMENTS - 1], stage.weather)).toEqual({
      base: 'asphalt',
      kind: 'asphalt',
      mix: 0,
    });
  });
});
