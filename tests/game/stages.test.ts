import { describe, expect, test } from 'vitest';
import { PALETTES } from '../../src/render/palette';
import {
  createStageGraph,
  indexOf as graphIndexOf,
  levelOf as graphLevelOf,
} from '../../src/game/stage-graph';
import { STAGE_TIME_LIMITS, timeLimitFor } from '../../src/game/timer';
import {
  FIRST_STAGE_ID,
  LAST_LEVEL,
  LEVELS,
  MAX_ROUTE_LENGTH,
  REAL_GRAPH,
  STAGES,
  STAGE_LIST,
  STAGE_SPECS,
  indexOf,
  lengthFor,
  levelOf,
  parseStageId,
  routeString,
  stageById,
  stageCoords,
  stageSeed,
  stageTimeLimit,
  stagesAlongRoute,
  THEME_ROAD,
} from '../../src/game/stages';

describe('STAGE_SPECS', () => {
  test('has the 15 stages of the triangular grid, one id each', () => {
    expect(STAGE_SPECS).toHaveLength(15);
    const ids = STAGE_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(15);
    const expected: string[] = [];
    for (let l = 0; l < LEVELS; l++) for (let i = 0; i <= l; i++) expected.push(`${l}-${i}`);
    expect(ids).toEqual(expected);
  });

  test('every theme is a valid ThemeId with a palette', () => {
    for (const spec of STAGE_SPECS) {
      expect(Object.keys(PALETTES)).toContain(spec.theme);
    }
  });

  test('difficulty stays in 0..1 and never decreases with the level', () => {
    for (const spec of STAGE_SPECS) {
      expect(spec.difficulty).toBeGreaterThan(0);
      expect(spec.difficulty).toBeLessThanOrEqual(1);
    }
    for (let l = 1; l < LEVELS; l++) {
      const prev = Math.max(...STAGE_SPECS.filter((s) => s.id.startsWith(`${l - 1}-`)).map((s) => s.difficulty));
      const min = Math.min(...STAGE_SPECS.filter((s) => s.id.startsWith(`${l}-`)).map((s) => s.difficulty));
      expect(min).toBeGreaterThanOrEqual(prev);
    }
  });

  test('names are unique and non-empty', () => {
    const names = STAGE_SPECS.map((s) => s.name);
    expect(new Set(names).size).toBe(15);
    for (const name of names) {
      expect(name.trim()).not.toBe('');
    }
  });
});

describe('parseStageId and stageCoords', () => {
  test('reads level and index from a well formed id', () => {
    expect(parseStageId('0-0')).toEqual({ level: 0, index: 0 });
    expect(parseStageId('4-4')).toEqual({ level: 4, index: 4 });
    expect(parseStageId('3-1')).toEqual({ level: 3, index: 1 });
  });

  test('rejects malformed ids and points outside the triangle', () => {
    for (const bad of ['', '0', 'x-0', '0-x', '00', '0_0', '5-0', '0-1', '2-3', '10-0', ' 0-0', '0-0 ']) {
      expect(parseStageId(bad)).toBeNull();
    }
  });

  test('stageCoords throws on a malformed id', () => {
    expect(() => stageCoords('nope')).toThrow(/malformed stage id/);
  });
});

describe('stageSeed', () => {
  test('is deterministic, a 32 bit unsigned integer, and collision free over the 15 ids', () => {
    const seeds = STAGE_SPECS.map((s) => stageSeed(s.id));
    expect(new Set(seeds).size).toBe(15);
    for (const seed of seeds) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
    expect(stageSeed('2-1')).toBe(stageSeed('2-1'));
    expect(stageSeed('2-1')).not.toBe(stageSeed('1-2'));
  });
});

describe('lengthFor', () => {
  test('is 3170 + 576 * difficulty, rounded to an integer', () => {
    expect(lengthFor(0)).toBe(3170);
    expect(lengthFor(1)).toBe(3746);
    expect(lengthFor(0.62)).toBe(3527);
    // 576 * 0.15 = 86.39999999999999 in virgola mobile: senza arrotondamento
    // lengthSegments non sarebbe un intero e buildTrack lancerebbe.
    expect(lengthFor(0.15)).toBe(3256);
    expect(Number.isInteger(lengthFor(0.15))).toBe(true);
  });
});

describe('stageTimeLimit', () => {
  test('is the rule of game/timer.ts rounded to whole seconds', () => {
    for (let l = 0; l < LEVELS; l++) {
      for (const d of [0.1, 0.45, 0.7, 0.71, 0.85, 1]) {
        expect(stageTimeLimit(l, d)).toBe(Math.round(timeLimitFor(l, d)));
        expect(Number.isInteger(stageTimeLimit(l, d))).toBe(true);
      }
    }
  });

  test('keeps the base limit of the level when difficulty is 0.7 or less', () => {
    expect(stageTimeLimit(0, 0.15)).toBe(74);
    expect(stageTimeLimit(1, 0.3)).toBe(71);
    expect(stageTimeLimit(2, 0.45)).toBe(80);
    expect(stageTimeLimit(3, 0.65)).toBe(85);
    // Confronto stretto: 0.7 non è "maggiore di 0.7", quindi niente sconto.
    expect(stageTimeLimit(4, 0.7)).toBe(93);
  });

  test('rounds the 0.92 discount above difficulty 0.7', () => {
    expect(timeLimitFor(4, 0.75)).toBeCloseTo(85.56, 10); // la regola non arrotonda
    expect(stageTimeLimit(4, 0.75)).toBe(86); // F sì
    expect(stageTimeLimit(4, 0.85)).toBe(86);
    expect(stageTimeLimit(3, 0.9)).toBe(78); // 85 * 0.92 = 78.2
  });

  /**
   * **Deroga (terzo collaudo utente: «finibile solo con una guida quasi
   * perfetta»).** Le quindici tappe vere hanno un limite proprio
   * (`STAGE_TIME_LIMITS` in `game/timer.ts`), tarato sul pilota esperto
   * tappa per tappa; la regola per livello resta per il grafo demo e per un
   * id fuori tabella.
   */
  test('a real stage takes its own limit, any other id the level rule', () => {
    expect(Object.keys(STAGE_TIME_LIMITS).sort()).toEqual(STAGE_SPECS.map((s) => s.id).sort());
    for (const stage of STAGE_LIST) {
      expect(stage.timeLimit, stage.id).toBe(STAGE_TIME_LIMITS[stage.id]);
      expect(Number.isInteger(stage.timeLimit)).toBe(true);
    }
    expect(stageTimeLimit(4, 0.75, '4-4')).toBe(80);
    expect(stageTimeLimit(4, 0.75, '9-9')).toBe(86);
    expect(stageTimeLimit(4, 0.75)).toBe(86);
  });
});

describe('STAGE_LIST and STAGES', () => {
  test('derives every StageDef field from the table', () => {
    expect(STAGE_LIST).toHaveLength(15);
    expect(STAGES.size).toBe(15);
    for (const spec of STAGE_SPECS) {
      const stage = stageById(spec.id);
      expect(stage.name).toBe(spec.name);
      expect(stage.theme).toBe(spec.theme);
      expect(stage.difficulty).toBe(spec.difficulty);
      expect(stage.lengthSegments).toBe(lengthFor(spec.difficulty));
      expect(stage.seed).toBe(stageSeed(spec.id));
      expect(stage.timeLimit).toBe(stageTimeLimit(levelOf(stage.id), spec.difficulty, spec.id));
    }
  });

  test('stageById throws on an unknown id', () => {
    expect(() => stageById('9-9')).toThrow(/unknown stage id/);
    expect(() => stageById('')).toThrow(/unknown stage id/);
  });

  test('levelOf and indexOf read the position in the grid', () => {
    expect(levelOf('0-0')).toBe(0);
    expect(indexOf('0-0')).toBe(0);
    expect(levelOf('4-3')).toBe(4);
    expect(indexOf('4-3')).toBe(3);
    for (const stage of STAGE_LIST) {
      expect(indexOf(stage.id)).toBeLessThanOrEqual(levelOf(stage.id));
    }
  });

  /**
   * `levelOf` e `indexOf` non sono una seconda implementazione: sono le stesse
   * funzioni di `game/stage-graph.ts`, riesportate. Il confronto di identità è
   * più forte di un confronto di risultati, perché non può divergere.
   */
  test('re-exports the stage-graph helpers of binario E instead of redefining them', () => {
    expect(levelOf).toBe(graphLevelOf);
    expect(indexOf).toBe(graphIndexOf);
  });

  /** La validazione severa della tabella di F resta sua, e non collide con niente di E. */
  test('keeps its own strict parser for validating the table', () => {
    expect(stageCoords('4-3')).toEqual({ level: 4, index: 3 });
    expect(() => stageCoords('demo')).toThrow(/malformed stage id/);
    // Dove E ricade su 0, F rifiuta.
    expect(graphLevelOf('demo')).toBe(0);
    expect(parseStageId('demo')).toBeNull();
  });
});

describe('REAL_GRAPH', () => {
  test('starts at 0-0', () => {
    expect(REAL_GRAPH.first().id).toBe(FIRST_STAGE_ID);
    expect(REAL_GRAPH.first().name).toBe('Palm Bay');
  });

  test('l-i goes to (l+1)-i on the left and (l+1)-(i+1) on the right', () => {
    for (const stage of STAGE_LIST) {
      const level = levelOf(stage.id);
      const index = indexOf(stage.id);
      if (level === LAST_LEVEL) continue;
      expect(REAL_GRAPH.next(stage, 'L')?.id).toBe(`${level + 1}-${index}`);
      expect(REAL_GRAPH.next(stage, 'R')?.id).toBe(`${level + 1}-${index + 1}`);
    }
  });

  test('level 4 has no successors', () => {
    for (const stage of STAGE_LIST.filter((s) => levelOf(s.id) === LAST_LEVEL)) {
      expect(REAL_GRAPH.next(stage, 'L')).toBeNull();
      expect(REAL_GRAPH.next(stage, 'R')).toBeNull();
    }
  });

  test('every stage below level 4 is reachable and the graph has 15 nodes', () => {
    const seen = new Set<string>([REAL_GRAPH.first().id]);
    const frontier = [REAL_GRAPH.first()];
    while (frontier.length > 0) {
      const stage = frontier.pop()!;
      for (const side of ['L', 'R'] as const) {
        const next = REAL_GRAPH.next(stage, side);
        if (next && !seen.has(next.id)) {
          seen.add(next.id);
          frontier.push(next);
        }
      }
    }
    expect(seen.size).toBe(15);
  });

  test('endingOf is the index of the level 4 stage and covers 0..4', () => {
    const finals = STAGE_LIST.filter((s) => levelOf(s.id) === LAST_LEVEL);
    expect(finals.map((s) => REAL_GRAPH.endingOf(s))).toEqual([0, 1, 2, 3, 4]);
  });

  test('endingOf throws for a stage that is not final', () => {
    expect(() => REAL_GRAPH.endingOf(stageById('0-0'))).toThrow(/not a final stage/);
    expect(() => REAL_GRAPH.endingOf(stageById('3-3'))).toThrow(/not a final stage/);
  });

  test('next throws for a stage the graph does not know', () => {
    const fake = { ...stageById('0-0'), id: 'demo' };
    expect(() => REAL_GRAPH.next(fake, 'L')).toThrow(/unknown stage/);
    expect(() => REAL_GRAPH.endingOf(fake)).toThrow(/unknown stage/);
  });

  /**
   * Il motore del binario E sonda il bivio a ogni tick negli ultimi 200
   * segmenti di **ogni** tappa, livello 4 compreso, e `forkFired` non diventa
   * mai vero quando non ci sono successori: se `next()` lanciasse sulle tappe
   * finali il motore morirebbe prima del traguardo (contratto di E, punto 1).
   */
  test('next on a final stage returns null many times over without ever throwing', () => {
    const last = stageById('4-2');
    for (let tick = 0; tick < 500; tick++) {
      expect(REAL_GRAPH.next(last, 'L')).toBeNull();
      expect(REAL_GRAPH.next(last, 'R')).toBeNull();
    }
  });

  /**
   * `REAL_GRAPH` è `createStageGraph` sulle 15 tappe più due guardie: su ogni
   * chiamata legittima deve dare esattamente le stesse risposte del generico.
   * Questo test è ciò che impedisce alle guardie di cambiare il grafo.
   */
  test('is createStageGraph over the 15 stages, plus guards, never a different graph', () => {
    const generic = createStageGraph(STAGE_LIST);
    expect(REAL_GRAPH.first().id).toBe(generic.first().id);
    for (const stage of STAGE_LIST) {
      for (const side of ['L', 'R'] as const) {
        expect(REAL_GRAPH.next(stage, side)?.id ?? null).toBe(generic.next(stage, side)?.id ?? null);
      }
      if (levelOf(stage.id) === LAST_LEVEL) {
        expect(REAL_GRAPH.endingOf(stage)).toBe(generic.endingOf(stage));
      }
    }
  });
});

describe('routeString', () => {
  test('joins the choices with single spaces', () => {
    expect(routeString(['L', 'R', 'L', 'R'])).toBe('L R L R');
    expect(routeString(['R'])).toBe('R');
  });

  test('an empty route is the empty string, the same format nameEntry saves', () => {
    expect(routeString([])).toBe('');
  });
});

describe('stagesAlongRoute', () => {
  test('an empty route is just the first stage', () => {
    expect(stagesAlongRoute([]).map((s) => s.id)).toEqual(['0-0']);
  });

  test('follows the graph and returns one stage more than the choices', () => {
    expect(stagesAlongRoute(['L', 'R', 'R', 'L']).map((s) => s.id)).toEqual(['0-0', '1-0', '2-1', '3-2', '4-2']);
    expect(stagesAlongRoute(['R', 'R', 'R', 'R']).map((s) => s.id)).toEqual(['0-0', '1-1', '2-2', '3-3', '4-4']);
    expect(stagesAlongRoute(['L', 'L', 'L']).map((s) => s.id)).toEqual(['0-0', '1-0', '2-0', '3-0']);
  });

  test('the 16 full routes end on the 5 final stages', () => {
    const ends = new Set<string>();
    for (let bits = 0; bits < 16; bits++) {
      const route = [0, 1, 2, 3].map((i) => ((bits >> i) & 1 ? 'R' : 'L') as 'L' | 'R');
      const stages = stagesAlongRoute(route);
      expect(stages).toHaveLength(5);
      ends.add(stages[4].id);
    }
    expect([...ends].sort()).toEqual(['4-0', '4-1', '4-2', '4-3', '4-4']);
  });

  test('throws on a route longer than the four forks', () => {
    expect(MAX_ROUTE_LENGTH).toBe(4);
    expect(() => stagesAlongRoute(['L', 'L', 'L', 'L', 'L'])).toThrow(/route too long/);
  });
});

describe('corsie e larghezza per tappa (spec §9)', () => {
  test('the wide themes have four lanes, the narrow ones three', () => {
    expect(THEME_ROAD.beach).toEqual({ lanes: 4, roadHalf: 1 });
    expect(THEME_ROAD.desert).toEqual({ lanes: 4, roadHalf: 1 });
    expect(THEME_ROAD.farm).toEqual({ lanes: 4, roadHalf: 1 });
    expect(THEME_ROAD.town).toEqual({ lanes: 3, roadHalf: 0.8 });
    expect(THEME_ROAD.alpine).toEqual({ lanes: 3, roadHalf: 0.8 });
  });

  test('every one of the 15 stages carries the road of its theme', () => {
    for (const stage of STAGE_LIST) {
      const road = THEME_ROAD[stage.theme];
      expect(stage.lanes, stage.id).toBe(road.lanes);
      expect(stage.roadHalf, stage.id).toBe(road.roadHalf);
    }
  });

  test('the fifteen stages are not all the same road', () => {
    const widths = new Set(STAGE_LIST.map((st) => st.roadHalf));
    expect(widths.size).toBe(2);
    expect(STAGE_LIST.filter((st) => st.lanes === 3).length).toBeGreaterThan(3);
    expect(STAGE_LIST.filter((st) => st.lanes === 4).length).toBeGreaterThan(3);
  });
});
