import { describe, expect, test } from 'vitest';
import { BEGINNERS, driveBeginner, extraCarryGraph, launchGraph, type BeginnerProfileName } from '../helpers/beginner-driver';
import { allRoutes } from '../helpers/prudent-driver';
import { driveRouteSkilled } from '../helpers/skilled-driver';

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
  // A verbale, 10 semi per profilo, 15 dei 30 s in più riportabili (spec
  // telefono e finali §0; senza riporto, b43850d, fra parentesi):
  // - solo gas: 0-0 al 75 %, mai al checkpoint (152 s gli servirebbero); 112 s;
  // - attento: 10/10 al checkpoint (0-10,4 s rimasti, riportati tutti), poi
  //   game over alla 1-1 al 69-80 % (59-70 %); 182 s di gara in media (175);
  // - in ritardo: 4/10 al checkpoint (1,7-2,5 s), gli altri alla 0-0 al
  //   92-100 %; chi passa muore alla 1-0 al 64-65 % o alla 1-1 al 56-61 %; 141 s (140);
  // - preciso: 10/10 al checkpoint con 9,8 s, game over alla 1-1 all'80 % (70); 182 s (172).
  // Prudente: 1-0 o 1-1 all'80 % (70), livello 1 superato 0/16, 184 s (174).
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

describe('riporto parziale (spec telefono e finali §0): 15 dei 30 s in più', () => {
  test('a beginner who reaches the checkpoint with less than 15 s keeps them all at the 1-1', () => {
    const now = driveBeginner(BEGINNERS.precise, { seed: 1 });
    const none = driveBeginner(BEGINNERS.precise, { seed: 1, graph: extraCarryGraph(0) });
    expect(now.firstCheckpointLeft).toBeLessThan(15);
    expect(now.stageId).toBe(none.stageId);
    // Gli stessi secondi in più di gara: quelli rimasti alla 0-0.
    expect(now.elapsed - none.elapsed).toBeCloseTo(now.firstCheckpointLeft!, 0);
  }, CASE_TIMEOUT);

  // A verbale: il bravo supera il livello 1 su 16 percorsi su 16 (senza
  // riporto 0/16, a un soffio dal checkpoint), muore al livello 2 al
  // 75-92 %; 249 s di gara in media, 53.467 punti (17.164).
  test('the skilled driver passes level 1 on most routes', () => {
    const passed = allRoutes().filter((r) => driveRouteSkilled(r).margins.filter((m) => m.margin > 0).length >= 2).length;
    expect(passed).toBeGreaterThanOrEqual(12);
  }, CASE_TIMEOUT * 3);
});
