import { describe, expect, test } from 'vitest';
import { BEGINNERS, driveBeginner, launchGraph, type BeginnerProfileName } from '../helpers/beginner-driver';

/**
 * La prima tappa col pilota principiante (spec prima tappa e ritorno, §1.2):
 * gas sempre, mai il cambio, sterzo in ritardo.
 *
 * L'auto non entra: `createFullRace` non riceve l'auto e nessun modulo di
 * `src/game` legge `CarChoice` (la fisica è la stessa per tutte), quindi una
 * corsa vale per le quattro auto pubbliche.
 */
const CASE_TIMEOUT = 60000;
const PROFILES = Object.keys(BEGINNERS) as BeginnerProfileName[];

describe('prima tappa al lancio (80 s): nessun principiante arriva al checkpoint', () => {
  // A verbale (seme 1): solo gas 52 % (2.910 punti, la prova dal vivo del
  // brief: 2.907), attento 81 %, in ritardo 69 %, preciso 81 %; tutti in
  // `lo`, scaduti a 82 s (80 più i 2 s di frenata del game over).
  test.each(PROFILES)(
    '%s si ferma nella 0-0, in marcia bassa',
    (name) => {
      const run = driveBeginner(BEGINNERS[name], { seed: 1, graph: launchGraph() });
      expect(run.gameOver).toBe(true);
      expect(run.stageId).toBe('0-0');
      expect(run.checkpoints).toBe(0);
      expect(run.everHigh).toBe(false);
      expect(run.gear).toBe('lo');
      expect(run.progress).toBeGreaterThan(0.45);
      expect(run.progress).toBeLessThan(0.85);
    },
    CASE_TIMEOUT,
  );

  test('solo gas: la prova dal vivo del brief, a metà tappa con circa 2.900 punti', () => {
    const run = driveBeginner(BEGINNERS.gas, { graph: launchGraph() });
    expect(run.progress).toBeCloseTo(0.52, 1);
    expect(Math.abs(run.score - 2907)).toBeLessThan(50);
  }, CASE_TIMEOUT);
});

describe('prima tappa a 110 s (spec §3.2): i principianti che sterzano arrivano al primo checkpoint', () => {
  // A verbale, 10 semi per profilo, `CARRY_FIRST_STAGE_EXTRA` falso:
  // - solo gas: 0-0 al 75 %, mai al checkpoint (152 s gli servirebbero);
  // - attento: 10/10 al checkpoint (0-10 s rimasti), poi game over alla 1-1
  //   al 59-70 %; 175 s di gara in media (al lancio 82);
  // - in ritardo: 4/10 al checkpoint, gli altri alla 0-0 al 92-100 %; 140 s;
  // - preciso: 10/10 al checkpoint con 10 s, game over alla 1-1 al 70 %; 172 s.
  test.each(['careful', 'precise'] as const)(
    '%s reaches the first checkpoint, still in low gear',
    (name) => {
      const run = driveBeginner(BEGINNERS[name], { seed: 1 });
      expect(run.checkpoints).toBeGreaterThanOrEqual(1);
      expect(run.firstCheckpointLeft).toBeGreaterThan(0);
      expect(run.everHigh).toBe(false);
    },
    CASE_TIMEOUT,
  );

  test('gas only, without steering, still does not: the 0-0 is not given away', () => {
    const run = driveBeginner(BEGINNERS.gas);
    expect(run.stageId).toBe('0-0');
    expect(run.checkpoints).toBe(0);
  }, CASE_TIMEOUT);
});
