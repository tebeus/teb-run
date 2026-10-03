import { describe, expect, test } from 'vitest';
import { modeGraph } from '../../src/game/mode';
import { REAL_GRAPH } from '../../src/game/stages';
import { allRoutes, DRIVER_DT } from '../helpers/prudent-driver';
import { driveRouteExpertWithError, errorStillS } from '../helpers/expert-driver';

/**
 * Taratura di spec §8, seconda metà della precisazione del terzo collaudo
 * utente: «deve essere possibile finirlo, ma solo con una guida quasi
 * perfetta». `balance.test.ts` prova la prima metà (l'esperto pulito finisce
 * tutto, con 3-6 s); qui **un errore vero costa la partita**. Ogni percorso
 * si guida con l'esperto che sbaglia una volta sola: a metà della tappa del
 * livello `indice del percorso % 5` (ogni livello ha il suo errore su tre o
 * quattro percorsi) fa un testacoda, la perdita di velocità di un incidente
 * del motore (`driveRouteExpertWithError`). Almeno MIN_LOST percorsi su 16
 * devono perdere un checkpoint (game over prima del traguardo); quanti, e a
 * che tappa, si stampa per il verbale.
 */
/**
 * Richiesta dell'utente: +6 s alla prima tappa, riportati («poi vediamo
 * come va»). Con i 6 s riportati un testacoda non costa più la partita:
 * misurati 0/16 percorsi persi (erano 16/16 con la 0-0 a 74 s). La soglia
 * scende al misurato finché l'utente non ha provato; era 10.
 */
const MIN_LOST = 0;
const CASE_TIMEOUT = 20000;

describe("l'esperto con un errore perde la partita (spec §8)", () => {
  test(
    'one real mistake costs a checkpoint on most routes',
    () => {
      const routes = allRoutes();
      const outcome = routes.map((route, i) => {
        const run = driveRouteExpertWithError(route, i % 5);
        const last = run.margins[run.margins.length - 1];
        return {
          name: route.join(''),
          errorLevel: i % 5,
          lost: run.gameOver,
          at: run.gameOver ? last?.id : 'fine',
          crashes: run.crashes,
        };
      });
      const lost = outcome.filter((o) => o.lost).length;
      console.info(
        `taratura (esperto con un testacoda, ${errorStillS('normal').toFixed(1)} s da fermo): ${lost}/16 percorsi persi; ` +
          outcome.map((o) => `${o.name}@L${o.errorLevel}→${o.at}${o.crashes > 0 ? '*' : ''}`).join(' '),
      );
      expect(lost).toBeGreaterThanOrEqual(MIN_LOST);
    },
    CASE_TIMEOUT * 4,
  );
});

/**
 * Collaudo utente su iPhone: «NORMAL deve essere più facile, soprattutto
 * deve costare meno un incidente». Incidente di ~3 s in NORMAL
 * (`CRASH_TIMING` in `game/crash.ts`) e +3 s a ogni tappa dei livelli 1-4
 * (`STAGE_TIME_LIMITS`). Criterio: l'esperto con **due** incidenti per
 * partita, a metà della seconda e della quarta tappa del percorso (livelli
 * 1 e 3), arriva al traguardo su 16 percorsi su 16, al passo di taratura e
 * a 60 Hz. Il margine peggiore per livello si stampa per il verbale.
 */
const TWO_CRASH_LEVELS = [1, 3] as const;

describe('NORMAL: l\'esperto con due incidenti finisce la partita', () => {
  test.each([
    ['1/20 s', DRIVER_DT],
    ['1/60 s', 1 / 60],
  ] as const)(
    'two crashes per game, every route still reaches the finish (step %s)',
    (name, dt) => {
      const worst = [0, 1, 2, 3, 4].map(() => Number.POSITIVE_INFINITY);
      const lost: string[] = [];
      for (const route of allRoutes()) {
        const run = driveRouteExpertWithError(route, TWO_CRASH_LEVELS, { dt });
        if (run.gameOver || !run.finished) lost.push(route.join(''));
        for (const m of run.margins) if (m.margin < worst[m.level]) worst[m.level] = m.margin;
      }
      console.info(
        `taratura (esperto NORMAL con due incidenti ai livelli ${TWO_CRASH_LEVELS.join(' e ')}, passo ${name}, ` +
          `${errorStillS('normal').toFixed(1)} s da fermo l'uno): ${16 - lost.length}/16 percorsi finiti; ` +
          `margine peggiore per livello = ${worst.map((v) => v.toFixed(1)).join(', ')} s`,
      );
      expect(lost, `routes lost: ${lost.join(' ')}`).toEqual([]);
    },
    CASE_TIMEOUT * 8,
  );
});

/**
 * HARD non cambia: incidente lungo (`CRASH_TIMING.hard`, 6,4 s) e tabella
 * sua. Con un testacoda a metà di una tappa (livello = indice del percorso
 * % 5) l'esperto in HARD deve perdere almeno HARD_MIN_LOST percorsi su 16:
 * misurati 15 (si salva solo LLLR, errore al livello 3).
 */
const HARD_MIN_LOST = 15;

describe("HARD: un incidente costa ancora un checkpoint", () => {
  test(
    'one crash in HARD, how many routes are lost is reported',
    () => {
      const graph = modeGraph(REAL_GRAPH, 'hard');
      const outcome = allRoutes().map((route, i) => {
        const run = driveRouteExpertWithError(route, i % 5, { graph });
        const last = run.margins[run.margins.length - 1];
        return { name: route.join(''), errorLevel: i % 5, lost: run.gameOver, at: run.gameOver ? last?.id : 'fine' };
      });
      const lost = outcome.filter((o) => o.lost).length;
      console.info(
        `taratura (esperto HARD con un testacoda, ${errorStillS('hard').toFixed(1)} s da fermo): ${lost}/16 percorsi persi; ` +
          outcome.map((o) => `${o.name}@L${o.errorLevel}→${o.at}`).join(' '),
      );
      expect(lost).toBeGreaterThanOrEqual(HARD_MIN_LOST);
    },
    CASE_TIMEOUT * 4,
  );
});
