import { describe, expect, test } from 'vitest';
import { modeGraph } from '../../src/game/mode';
import { REAL_GRAPH } from '../../src/game/stages';
import { LEVEL_TIME_LIMITS, STAGE_TIME_LIMITS, STAGE_TIME_LIMITS_HARD } from '../../src/game/timer';
import { allRoutes, driveRoute, DRIVER_DT, type RouteRun } from '../helpers/prudent-driver';
import { driveRouteExpert } from '../helpers/expert-driver';
import { driveRouteSkilled } from '../helpers/skilled-driver';

/**
 * Taratura di spec §8, guidando il motore vero (`createFullRace` sul grafo
 * vero) con piloti scriptati.
 *
 * **Deroga (terzo collaudo utente: «ancora troppo facile, troppi secondi,
 * si vince sempre»).** Il riferimento è il pilota **esperto** di
 * `tests/helpers/expert-driver.ts` (gas sempre, mai il freno, rilascio
 * minimo in curva, corda, traffico evitato in anticipo): deve finire tutti
 * i 16 percorsi senza uscire di strada né urtare, con un margine peggiore
 * per livello fra MIN_MARGIN e MAX_MARGIN secondi, **livello 0 compreso**.
 * MAX_MARGIN è la rete contro il «troppo facile». Il prudente e il bravo
 * non hanno più soglie: quante tappe chiudono si scrive a verbale.
 *
 * Passo dichiarato: DRIVER_DT (1/20 s), un terzo della frequenza di gioco.
 *
 * Due modalità (collaudo utente): la stessa prova per NORMAL, sul grafo
 * vero, e per HARD, sullo stesso grafo passato per `modeGraph`.
 */
const MIN_MARGIN = 3;
/**
 * Richiesta dell'utente: +6 s alla prima tappa, riportati. Il riporto è
 * cumulativo, quindi i 6 s arrivano a ogni tappa dopo: margine peggiore
 * dell'esperto misurato 10,1 / 9,6 / 9,6 / 9,3 / 9,2 s (era 6 prima).
 *
 * Collaudo utente, due livelli di difficoltà: il traffico di NORMAL torna
 * alla densità per segmento tarata (circa +44 % di veicoli), la moto è più
 * grande e più frequente, nessun veicolo rinasce in vista. Stessa tabella,
 * margine peggiore misurato **9,5 / 8,9 / 7,2 / 6,0 / 3,9 s**: sopra 3 s,
 * quindi la tabella resta; il tetto scende a 10.
 *
 * Poi NORMAL più gentile prima del lancio (+2 s al livello 2, +1 s ai
 * livelli 3 e 4): **9,5 / 8,9 / 9,2 / 9,0 / 7,9 s**; con un testacoda
 * l'esperto perde 1 percorso su 16 (era 9).
 *
 * Poi il collaudo su iPhone: «NORMAL deve essere più facile» (+3 s a ogni
 * tappa dei livelli 1-4, riportati, e incidente di ~3 s in NORMAL). È voluto
 * che il pilota pulito arrivi con molti secondi: misurato **9,5 / 11,9 /
 * 15,2 / 18,0 / 19,9 s**. Il tetto sale a 21 s (il misurato più ~1 s),
 * così resta la rete contro un NORMAL ancora più largo senza volerlo; la
 * prova che NORMAL perdona due incidenti è in `balance-error.test.ts`.
 */
const MAX_MARGIN = 21;
/**
 * HARD (collaudo utente: due livelli di difficoltà) ha la sua tabella,
 * `STAGE_TIME_LIMITS_HARD`, tarata perché l'esperto arrivi a ogni
 * checkpoint con 3-5 s di margine peggiore per livello.
 */
const HARD_MAX_MARGIN = 5;
const CASE_TIMEOUT = 20000;

/**
 * Ogni percorso si guida **una volta sola** per pilota: i casi e le righe di
 * taratura leggono la stessa corsa.
 */
const memo = (drive: (route: readonly ('L' | 'R')[]) => RouteRun) => {
  const runs = new Map<string, RouteRun>();
  return (route: readonly ('L' | 'R')[]): RouteRun => {
    const key = route.join('');
    const cached = runs.get(key);
    if (cached !== undefined) return cached;
    const fresh = drive(route);
    runs.set(key, fresh);
    return fresh;
  };
};
const expertRun = memo((route) => driveRouteExpert(route));
const HARD_GRAPH = modeGraph(REAL_GRAPH, 'hard');
const expertHardRun = memo((route) => driveRouteExpert(route, { graph: HARD_GRAPH }));
const skilledRun = memo((route) => driveRouteSkilled(route));
const prudentRun = memo((route) => driveRoute(route));

/** Margine peggiore per livello sui 16 percorsi. */
function worstByLevel(runOf: (route: readonly ('L' | 'R')[]) => RouteRun): number[] {
  const worst = LEVEL_TIME_LIMITS.map(() => Number.POSITIVE_INFINITY);
  for (const route of allRoutes()) {
    for (const m of runOf(route).margins) {
      if (m.margin < worst[m.level]) worst[m.level] = m.margin;
    }
  }
  return worst;
}

const detailOf = (run: RouteRun): string => run.margins.map((m) => `${m.id}:${m.margin.toFixed(1)}`).join(' ');

describe.each([
  ['NORMAL', expertRun, MAX_MARGIN, STAGE_TIME_LIMITS],
  ['HARD', expertHardRun, HARD_MAX_MARGIN, STAGE_TIME_LIMITS_HARD],
] as const)('taratura del pilota esperto in %s (spec §8)', (mode, runOf, maxMargin, limits) => {
  test('the simulation step is the declared one, coarser than the game step', () => {
    expect(DRIVER_DT).toBe(1 / 20);
  });

  test('every stage has its own limit in this mode', () => {
    expect(Object.keys(limits)).toHaveLength(15);
  });

  test.each(allRoutes().map((r) => [r.join(''), r] as const))(
    'route %s is finished by the expert driver, clean, with at least MIN_MARGIN s on every stage',
    (_name, route) => {
      const run = runOf(route);
      const detail = detailOf(run);
      expect(run.gameOver, `game over on route ${route.join('')} (${detail})`).toBe(false);
      expect(run.finished, `route ${route.join('')} did not finish (${detail})`).toBe(true);
      expect(run.margins).toHaveLength(5);
      for (const m of run.margins) {
        expect(m.margin, `stage ${m.id} on route ${route.join('')} (${detail})`).toBeGreaterThanOrEqual(MIN_MARGIN);
      }
      // Il riferimento guida pulito: se esce o urta, la taratura misura i
      // suoi errori, non la pista.
      expect(run.crashes, `crashes on route ${route.join('')}`).toBe(0);
      expect(run.bumps, `bumps on route ${route.join('')}`).toBe(0);
      expect(run.offRoadTicks, `off-road ticks on route ${route.join('')}`).toBe(0);
    },
    CASE_TIMEOUT,
  );

  test(
    'the worst margin of every level, level 0 included, is between MIN_MARGIN and the mode ceiling',
    () => {
      const worst = worstByLevel(runOf);
      // Riga di taratura: è quella che si legge per ritoccare i limiti.
      console.info(
        `taratura (esperto, ${mode}): margine peggiore per livello = ${worst.map((v) => v.toFixed(1)).join(', ')} s ` +
          `con limiti per tappa ${Object.entries(limits).map(([id, t]) => `${id}:${t}`).join(' ')}`,
      );
      for (let level = 0; level < worst.length; level++) {
        expect(worst[level], `level ${level}`).toBeGreaterThanOrEqual(MIN_MARGIN);
        expect(worst[level], `level ${level}`).toBeLessThanOrEqual(maxMargin);
      }
    },
    CASE_TIMEOUT * 2,
  );
});

describe('piloti prudente e bravo: a verbale, senza soglia (spec §8)', () => {
  test.each([
    ['prudent', prudentRun],
    ['skilled', skilledRun],
  ] as const)(
    'how many stages the %s driver closes is reported, for the record',
    (name, runOf) => {
      const routes = allRoutes();
      const finished = routes.filter((r) => runOf(r).finished).length;
      const closed = routes.map((r) => runOf(r).margins.filter((m) => m.margin > 0).length);
      console.info(
        `taratura (${name}): ${finished}/16 percorsi completati; tappe chiuse per percorso = ${closed.join(' ')}`,
      );
      expect(finished).toBeGreaterThanOrEqual(0);
    },
    CASE_TIMEOUT * 2,
  );
});
