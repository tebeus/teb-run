// I controlli del server sulle partite inviate (spec §2.4). Le partite vere
// del pilota esperto passano tutte, pulite e con un incidente, in NORMAL e
// in HARD; le partite truccate (punteggio gonfiato, durata impossibile,
// percorso o finale incoerenti, auto classica, iniziali bloccate, sfida
// sbagliata) no.

import { describe, expect, test } from 'vitest';
import { modeGraph } from '../../src/game/mode';
import { REAL_GRAPH } from '../../src/game/stages';
import { dailyChallenge } from '../../src/shared/daily';
import { durationBounds, maxScore, stagesOfRoute, validateRun, type RunBody } from '../../src/shared/validate';
import { allRoutes, type RouteRun } from '../helpers/prudent-driver';
import { driveRouteExpert, driveRouteExpertWithError } from '../helpers/expert-driver';
import type { Difficulty } from '../../src/types';

const NOW = new Date('2026-10-25T12:00:00Z');

const bodyOf = (run: RouteRun, mode: Difficulty): RunBody => ({
  initials: 'TEB',
  score: run.score,
  mode,
  car: 'new',
  stageId: run.stageId,
  route: run.route.join(''),
  ending: run.ending === undefined ? null : run.ending + 1,
  durationMs: Math.round(run.elapsed * 1000),
});

const graphFor = (mode: Difficulty) => (mode === 'normal' ? REAL_GRAPH : modeGraph(REAL_GRAPH, 'hard'));
const SLOW = 600_000;

describe('real runs of the expert driver pass', () => {
  for (const mode of ['normal', 'hard'] as const) {
    test(`${mode}: the 16 clean runs`, () => {
      const ratios: number[] = [];
      for (const route of allRoutes()) {
        const run = driveRouteExpert(route, { graph: graphFor(mode) });
        expect(run.finished).toBe(true);
        const verdict = validateRun(bodyOf(run, mode), NOW);
        expect(verdict, `${mode} ${route.join('')} ${run.score} in ${run.elapsed.toFixed(1)} s`).toMatchObject({ ok: true });
        const cap = maxScore(stagesOfRoute(run.route.join(''))!, mode, true, run.elapsed);
        ratios.push(cap / run.score);
      }
      // Misurato: il massimo concesso è 2,1-2,5 volte il punteggio dell'esperto
      // in NORMAL e 3,7-4,6 in HARD (dove pesano di più guida e sorpassi). Margine
      // per chi guida meglio dell'esperto, ma non per un punteggio cinque volte tanto.
      expect(Math.min(...ratios)).toBeGreaterThan(1.5);
      expect(Math.max(...ratios)).toBeLessThan(5);
    }, SLOW);

    test(`${mode}: runs with a crash, finished or not`, () => {
      for (const route of allRoutes().filter((_, i) => i % 4 === 0)) {
        for (const errors of [[1], [1, 3], [0, 1, 2, 3, 4]]) {
          const run = driveRouteExpertWithError(route, errors, { graph: graphFor(mode) });
          expect(validateRun(bodyOf(run, mode), NOW), `${mode} ${route.join('')} errors ${errors}`).toMatchObject({ ok: true });
        }
      }
    }, SLOW);
  }
});

const good: RunBody = {
  initials: 'TEB',
  score: 200_000,
  mode: 'normal',
  car: 'retro',
  stageId: '4-2',
  route: 'RLRL',
  ending: 3,
  durationMs: 385_000,
};

describe('rejected runs', () => {
  test('the reference run passes', () => {
    expect(validateRun(good, NOW)).toEqual({
      ok: true,
      row: { board: 'run', day: '2026-10-25', mode: 'normal', initials: 'TEB', score: 200_000, car: 'retro', stageId: '4-2', route: 'RLRL', ending: 3, durationMs: 385_000 },
    });
  });

  test('shape', () => {
    for (const bad of [null, [], 'x', { ...good, extra: 1 }, { ...good, score: -1 }, { ...good, score: 1.5 }, { ...good, mode: 'easy' }, { ...good, durationMs: '1' }, { ...good, daily: '2026-02-30' }]) {
      expect(validateRun(bad, NOW)).toEqual({ ok: false, reason: 'shape' });
    }
  });

  test('classic is never accepted', () => {
    expect(validateRun({ ...good, car: 'classic' }, NOW)).toEqual({ ok: false, reason: 'shape' });
  });

  test('initials', () => {
    for (const initials of ['FUK', 'teb', 'T3B', 'TE']) expect(validateRun({ ...good, initials }, NOW)).toEqual({ ok: false, reason: 'initials' });
  });

  test('route and ending', () => {
    for (const bad of [
      { route: 'RLR' }, // percorso più corto della tappa
      { route: 'RLRLR' },
      { route: 'RLXL' },
      { stageId: '9-9' },
      { ending: 2 }, // la 4-2 porta al finale 3
      { stageId: '3-1', route: 'RLR', ending: 2 }, // un finale prima dell'ultimo livello
    ]) {
      expect(validateRun({ ...good, ...bad }, NOW)).toEqual({ ok: false, reason: 'route' });
    }
  });

  test('duration: under the physical minimum, or over all the time there was', () => {
    expect(validateRun({ ...good, durationMs: 250_000 }, NOW)).toEqual({ ok: false, reason: 'duration' });
    expect(validateRun({ ...good, durationMs: 1_000_000 }, NOW)).toEqual({ ok: false, reason: 'duration' });
    // Game over alla prima tappa dopo pochi secondi: nessun minimo, nessun checkpoint.
    expect(validateRun({ ...good, stageId: '0-0', route: '', ending: null, durationMs: 81_000, score: 9_000 }, NOW)).toMatchObject({ ok: true });
  });

  test('a pause is not race time: the longest legal run still passes', () => {
    // Il tempo di gara si ferma in pausa e durante la pubblicità (prova
    // client: tests/ui/screens/race-duration.test.ts); il massimo del server
    // è il tempo che il gioco concede, quindi una partita che lo usa tutto passa.
    const stages = stagesOfRoute('RLRL')!;
    const { max } = durationBounds(stages, 'normal', true);
    expect(validateRun({ ...good, durationMs: Math.floor((max - 2) * 1000) }, NOW)).toMatchObject({ ok: true });
  });

  test('score', () => {
    const stages = stagesOfRoute('RLRL')!;
    const cap = maxScore(stages, 'normal', true, 385);
    expect(cap).toBeLessThan(1_200_000);
    expect(validateRun({ ...good, score: Math.floor(cap) }, NOW)).toMatchObject({ ok: true });
    expect(validateRun({ ...good, score: Math.ceil(cap) + 1 }, NOW)).toEqual({ ok: false, reason: 'score' });
    expect(validateRun({ ...good, score: 7_300_000 }, NOW)).toEqual({ ok: false, reason: 'score' });
  });
});

describe('daily runs', () => {
  const today = dailyChallenge('2026-10-25');
  const daily = { ...good, car: today.car, mode: today.mode, daily: '2026-10-25' };

  test('today, with the car and mode of the challenge: in the DAILY board of that day', () => {
    expect(validateRun(daily, NOW)).toMatchObject({ ok: true, row: { board: 'daily', day: '2026-10-25' } });
  });

  test('another car or mode: rejected', () => {
    const other = today.car === 'new' ? 'super' : 'new';
    expect(validateRun({ ...daily, car: other }, NOW)).toEqual({ ok: false, reason: 'daily' });
    expect(validateRun({ ...daily, mode: today.mode === 'hard' ? 'normal' : 'hard' }, NOW)).toEqual({ ok: false, reason: 'daily' });
  });

  test("yesterday's challenge: accepted for 15 minutes after midnight, then not; tomorrow's never", () => {
    const at = (iso: string) => new Date(iso);
    expect(validateRun(daily, at('2026-10-26T00:14:59Z'))).toMatchObject({ ok: true, row: { day: '2026-10-25' } });
    expect(validateRun(daily, at('2026-10-26T00:15:01Z'))).toEqual({ ok: false, reason: 'daily' });
    expect(validateRun(daily, at('2026-10-24T23:59:00Z'))).toEqual({ ok: false, reason: 'daily' });
  });
});
