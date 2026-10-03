import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import {
  createScoresScreen,
  parseScoresPayload,
  SCORES_DURATION_S,
  stageLabel,
  stepScores,
} from '../../../src/ui/screens/scores';
import { LOGICAL_W } from '../../../src/core/canvas';
import { STAGE_LIST } from '../../../src/game/stages';
import { MAX_NAME_LEN } from '../../../src/persist/scores';
import { go } from '../../../src/ui/fsm';
import type { ScoreEntry } from '../../../src/persist/scores';
import type { ScreenDeps } from '../../../src/ui/deps';

describe('stepScores', () => {
  test('stays without confirm before the duration', () => {
    const r = stepScores({ t: 0 }, 1, emptyActions());
    expect(r.transition).toBeNull();
  });

  test('confirm transitions to title before the duration', () => {
    const r = stepScores({ t: 1 }, 1 / 60, { ...emptyActions(), confirm: true });
    expect(r.transition).toEqual(go('title', undefined));
  });

  test('returns to title after the duration even while a non-confirm key is held', () => {
    let state = { t: 0 };
    let transition = null;
    for (let i = 0; i < SCORES_DURATION_S; i++) {
      const r = stepScores(state, 1, { ...emptyActions(), left: true });
      state = r.state;
      transition = r.transition;
    }
    expect(transition).toEqual(go('title', undefined));
  });

  test('preserves the highlight across ticks', () => {
    const r = stepScores({ t: 0, highlight: 4 }, 1, emptyActions());
    expect(r.state.highlight).toBe(4);
  });
});

describe('parseScoresPayload', () => {
  test('passes through a numeric highlight', () => {
    expect(parseScoresPayload({ highlight: 3 })).toEqual({ highlight: 3 });
  });

  test('returns undefined for missing or malformed input', () => {
    expect(parseScoresPayload(undefined)).toBeUndefined();
    expect(parseScoresPayload({ highlight: 'x' })).toBeUndefined();
    expect(parseScoresPayload({})).toBeUndefined();
  });
});

describe('createScoresScreen', () => {
  test('renders an empty list and a full 10-entry list without throwing', () => {
    const makeDeps = (list: ScoreEntry[]): ScreenDeps => ({
      assets: createEmptyAssets(),
      audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
      scores: { load: () => list, qualifies: () => true, insert: () => -1, clear: () => {} },
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    });
    const ctx = { fillRect() {}, fillStyle: '' } as unknown as CanvasRenderingContext2D;

    const empty = createScoresScreen(makeDeps([]));
    empty.enter(undefined);
    expect(() => empty.render(ctx)).not.toThrow();

    const full: ScoreEntry[] = Array.from({ length: 10 }, (_, i) => ({
      name: `P${i}`,
      score: 1000 - i,
      stageId: '4-4',
      route: 'L R L R',
      date: '2026-01-01T00:00:00.000Z',
    }));
    const withEntries = createScoresScreen(makeDeps(full));
    withEntries.enter({ highlight: 2 });
    expect(() => withEntries.render(ctx)).not.toThrow();
  });

  test('reads the scores store once on enter, not once per render', () => {
    let loadCalls = 0;
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
      scores: {
        load: () => {
          loadCalls++;
          return [];
        },
        qualifies: () => true,
        insert: () => -1,
        clear: () => {},
      },
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    };
    const ctx = { fillRect() {}, fillStyle: '' } as unknown as CanvasRenderingContext2D;
    const screen = createScoresScreen(deps);

    screen.enter(undefined);
    expect(loadCalls).toBe(1);
    screen.render(ctx);
    screen.render(ctx);
    screen.render(ctx);
    expect(loadCalls).toBe(1);
  });
});

describe('stageLabel', () => {
  test('dà il nome in maiuscolo per tutte le 15 tappe del grafo', () => {
    const expected: Record<string, string> = {
      '0-0': 'PALM BAY',
      '1-0': 'SANDSTONE GATE',
      '1-1': 'BLUE LAGOON',
      '2-0': 'RED CANYON',
      '2-1': 'PINE PASS',
      '2-2': 'GOLDEN FIELDS',
      '3-0': 'OLD HARBOR',
      '3-1': 'CLOUD RIDGE',
      '3-2': 'VINE HILLS',
      '3-3': 'SALT FLATS',
      '4-0': 'MARBLE AVENUE',
      '4-1': 'GLACIER ROAD',
      '4-2': 'WINDMILL COAST',
      '4-3': 'DUNE HIGHWAY',
      '4-4': 'SUNSET LAGOON',
    };
    expect(STAGE_LIST.map((s) => s.id).sort()).toEqual(Object.keys(expected).sort());
    for (const [id, name] of Object.entries(expected)) expect(stageLabel(id)).toBe(name);
  });

  test('ripiega su STAGE n per un id sconosciuto o vuoto', () => {
    expect(stageLabel('')).toBe('STAGE 1');
    expect(stageLabel('2-7')).toBe('STAGE 3');
    expect(stageLabel('9-9')).toBe('STAGE 5');
    expect(stageLabel('boh')).toBe('STAGE 1');
  });
});

describe('impaginazione della TOP 10', () => {
  /**
   * Registra i `fillRect` di ogni chiamata a `drawText`: ognuna assegna
   * `fillStyle` una volta sola, quindi ogni assegnazione apre un tratto.
   */
  function recordRuns(render: (ctx: CanvasRenderingContext2D) => void): { y: number; minX: number; maxX: number }[] {
    const runs: { y: number; minX: number; maxX: number }[] = [];
    let current: { y: number; minX: number; maxX: number } | null = null;
    const ctx = {
      set fillStyle(_v: string) {
        current = { y: NaN, minX: Infinity, maxX: -Infinity };
        runs.push(current);
      },
      fillRect(x: number, y: number, w: number) {
        if (current === null) return;
        if (Number.isNaN(current.y)) current.y = y;
        current.minX = Math.min(current.minX, x);
        current.maxX = Math.max(current.maxX, x + w);
      },
    } as unknown as CanvasRenderingContext2D;
    render(ctx);
    return runs.filter((r) => r.maxX > r.minX);
  }

  test('con nome lungo, tappa più lunga, 7 cifre e L L L L le colonne non si toccano', () => {
    const longestStage = STAGE_LIST.reduce((a, b) => (b.name.length > a.name.length ? b : a));
    const worst: ScoreEntry[] = Array.from({ length: 10 }, () => ({
      name: 'W'.repeat(MAX_NAME_LEN),
      score: 7270779,
      stageId: longestStage.id,
      route: 'L L L L',
      date: '2026-01-01T00:00:00.000Z',
    }));
    const screen = createScoresScreen({
      assets: createEmptyAssets(),
      audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
      scores: { load: () => worst, qualifies: () => true, insert: () => -1, clear: () => {} },
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    });
    screen.enter({ highlight: 9 });
    const runs = recordRuns((ctx) => screen.render(ctx));
    // Le righe della tabella: y da 140 in giù, sotto il titolo e la modalità.
    for (let i = 0; i < 10; i++) {
      const y = 140 + i * 40;
      const row = runs.filter((r) => r.y >= y && r.y < y + 16).sort((a, b) => a.minX - b.minX);
      // Rango, nome, punteggio, tappa, percorso; la freccia solo sulla riga evidenziata.
      expect(row).toHaveLength(i === 9 ? 6 : 5);
      for (let k = 1; k < row.length; k++) {
        expect(row[k].minX - row[k - 1].maxX, `riga ${i + 1}, colonna ${k}`).toBeGreaterThanOrEqual(16);
      }
      expect(row[0].minX).toBeGreaterThanOrEqual(0);
      expect(row[row.length - 1].maxX).toBeLessThanOrEqual(LOGICAL_W);
    }
  });
});
