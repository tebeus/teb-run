import { describe, expect, test } from 'vitest';
import { MAX_SPEED } from '../../src/game/player';
import { FORK_ZONE_SEGMENTS, MIN_STAGE_SEGMENTS, buildTrack } from '../../src/game/track';
import { SEGMENT_LENGTH } from '../../src/render/project';
import { LAST_LEVEL, STAGE_LIST, levelOf, stagesAlongRoute } from '../../src/game/stages';
import type { StageDef } from '../../src/types';

/**
 * Stima **di modello**, non una garanzia di giocabilità: qui si controlla solo
 * che i numeri derivati (spec §8, §9) lascino margine a un moto ideale, non
 * che una partita reale sia vincibile. Un giocatore modellato tiene l'80 %
 * della velocità massima senza mai perderla (era il 70 %: vedi MIN_SLACK);
 * copre `MAX_SPEED * 0.8` unità mondo al secondo, e una tappa lunga
 * `lengthSegments * SEGMENT_LENGTH` unità costa
 *
 *   secondsFor(stage) = lengthSegments * SEGMENT_LENGTH / (MAX_SPEED * 0.8)
 *
 * secondi. Il modello **non** carica alcun costo per uno schianto, un urto,
 * il fuoripista o una curva presa larga: sono tutti a costo zero. Il budget
 * non è il solo `timeLimit`: a ogni checkpoint il tempo residuo si somma al
 * limite della tappa successiva (spec §8), quindi la verifica segue un
 * percorso intero:
 *
 *   budget(0) = timeLimit(0)
 *   budget(n) = timeLimit(n) + budget(n-1) - secondsFor(stage(n-1))
 *
 * e chiede che a ogni tappa resti almeno MIN_SLACK secondi. Le tappe di
 * livello 4 hanno il limite scalato ×0,92 e da sole non basterebbero: è per
 * costruzione, il riporto dei livelli precedenti le copre.
 *
 * La revisione finale del binario F (`.superpowers/sdd/binario-f-struttura/
 * final-review-report.md`) ha guidato tre driver scriptati sul motore vero
 * (`createFullRace` su `REAL_GRAPH`) e misurato il divario che questo modello
 * ignora:
 *
 * - a piena velocità tenendo il centro strada: game over su Palm Bay all'83 %
 *   della tappa, con 8 schianti;
 * - a piena velocità scegliendo la corsia più libera: game over su una tappa
 *   di livello 2 su tutti i 16 percorsi;
 * - pianificando la corsia, frenando nel traffico, tenendo il 70 %: game over
 *   su una tappa di livello 2 o 3 su tutti i 16 percorsi.
 *
 * Presa da sola, la tappa costava al driver cauto 62-67 s contro i 54-60 s
 * modellati qui (0-2 schianti); Palm Bay da sola è arrivata a 51,3 s nella
 * corsa migliore, vicina ai 53,8 s del modello. Il modello è quindi corretto
 * per un giro pulito a piena velocità: il divario, 6-12 s a tappa, è la tassa
 * che qui non si paga, e il riporto fra tappe non basta ad assorbirla dal
 * livello 2 in su. Il ribilanciamento vero (traffico, costo dello schianto)
 * appartiene al binario G; questo file resta la stima di modello da cui
 * partire, non la prova che si possa vincere.
 */
const DRIVE_SPEED_FRACTION = 0.8;
const DRIVE_SPEED = MAX_SPEED * DRIVE_SPEED_FRACTION;
/**
 * Margine minimo richiesto. Era 10 s; con la taratura sul pilota bravo
 * (secondo collaudo utente: «ancora troppo facile») il modello al 70 % va
 * quasi quanto il bravo vero. **Terzo collaudo utente** («ancora troppo
 * facile»): la taratura segue il pilota esperto, che su Palm Bay va in
 * media al 78 % della velocità massima (69,9 s guidati), e al 70 % il
 * modello non finirebbe più: la frazione sale all'80 % (67,8 s modellati),
 * il passo di un giro pulito dell'esperto. Margine peggiore modellato 6,2 s.
 */
const MIN_SLACK = 3;

function secondsFor(stage: StageDef): number {
  return (stage.lengthSegments * SEGMENT_LENGTH) / DRIVE_SPEED;
}

/** I 16 percorsi completi del grafo, come liste di scelte. */
function allRoutes(): ('L' | 'R')[][] {
  const routes: ('L' | 'R')[][] = [];
  for (let bits = 0; bits < 16; bits++) {
    routes.push([0, 1, 2, 3].map((i) => ((bits >> i) & 1 ? 'R' : 'L') as 'L' | 'R'));
  }
  return routes;
}

describe('buildTrack over the 15 real stages', () => {
  test('every stage is long enough for the builder', () => {
    for (const stage of STAGE_LIST) {
      expect(stage.lengthSegments).toBeGreaterThanOrEqual(MIN_STAGE_SEGMENTS);
    }
  });

  test('builds the exact number of segments and closes flat', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      expect(segs).toHaveLength(stage.lengthSegments);
      const last = segs[segs.length - 1];
      expect(last.p2.world.y).toBe(0);
      expect(last.curve).toBe(0);
    }
  });

  test('is deterministic from the seed', () => {
    for (const stage of STAGE_LIST) {
      const a = buildTrack(stage);
      const b = buildTrack(stage);
      expect(a.map((s) => s.curve)).toEqual(b.map((s) => s.curve));
      expect(a.map((s) => s.p2.world.y)).toEqual(b.map((s) => s.p2.world.y));
      expect(a.map((s) => s.sprites.map((p) => `${p.name}@${p.offset}`).join(','))).toEqual(
        b.map((s) => s.sprites.map((p) => `${p.name}@${p.offset}`).join(',')),
      );
    }
  });

  test('two stages never share a track', () => {
    const shapes = STAGE_LIST.map((s) => buildTrack(s).map((seg) => seg.curve).join(','));
    expect(new Set(shapes).size).toBe(STAGE_LIST.length);
  });

  test('no segment climbs or drops more than its own length', () => {
    for (const stage of STAGE_LIST) {
      for (const seg of buildTrack(stage)) {
        const dy = Math.abs(seg.p2.world.y - seg.p1.world.y);
        expect(dy).toBeLessThanOrEqual(SEGMENT_LENGTH);
      }
    }
  });

  test('levels 0 to 3 end with a flat fork zone of 200 segments', () => {
    for (const stage of STAGE_LIST.filter((s) => levelOf(s.id) < LAST_LEVEL)) {
      const segs = buildTrack(stage);
      const zone = segs.slice(segs.length - FORK_ZONE_SEGMENTS);
      expect(zone).toHaveLength(FORK_ZONE_SEGMENTS);
      for (const seg of zone) {
        expect(seg.fork).toBe('zone');
        expect(seg.curve).toBe(0);
        expect(seg.p1.world.y).toBe(0);
        expect(seg.p2.world.y).toBe(0);
      }
      expect(segs[segs.length - FORK_ZONE_SEGMENTS - 1].fork).toBeUndefined();
    }
  });

  test('level 4 has no fork zone, only a flat finish straight', () => {
    for (const stage of STAGE_LIST.filter((s) => levelOf(s.id) === LAST_LEVEL)) {
      const segs = buildTrack(stage);
      for (const seg of segs) expect(seg.fork).toBeUndefined();
      for (const seg of segs.slice(segs.length - FORK_ZONE_SEGMENTS)) {
        expect(seg.curve).toBe(0);
        expect(seg.p2.world.y).toBe(0);
      }
    }
  });
});

describe('crash-free model estimate at 80 % of max speed (not a playability guarantee)', () => {
  test('the model uses 9600 world units per second', () => {
    expect(DRIVE_SPEED).toBe(9600);
  });

  // Deroga (collaudo utente: troppo facile, due volte): tappe ~20 % più
  // lunghe a ogni collaudo (`BASE_LENGTH_SEGMENTS`/`LENGTH_PER_DIFFICULTY`,
  // `game/stages.ts`), la fascia sale da 50-62 a 64-73 e poi a 77-88 s al
  // 70 %; al passo dell'80 % (terzo collaudo) è 67-77 s.
  test('a stage taken alone models 67 to 77 seconds of crash-free driving', () => {
    for (const stage of STAGE_LIST) {
      expect(secondsFor(stage)).toBeGreaterThan(67);
      expect(secondsFor(stage)).toBeLessThan(77);
    }
  });

  test('every one of the 16 routes keeps at least MIN_SLACK modelled seconds in hand', () => {
    for (const route of allRoutes()) {
      const stages = stagesAlongRoute(route);
      let budget = 0;
      let carry = 0;
      for (const stage of stages) {
        budget = stage.timeLimit + carry;
        const slack = budget - secondsFor(stage);
        expect(slack, `stage ${stage.id} on route ${route.join('')}`).toBeGreaterThanOrEqual(MIN_SLACK);
        carry = slack;
      }
      expect(carry, `finish of route ${route.join('')}`).toBeGreaterThan(0);
    }
  });

  test('the hardest route is 0-0 1-1 2-2 3-3 4-3 and the model still finishes with time left', () => {
    const stages = stagesAlongRoute(['R', 'R', 'R', 'L']);
    expect(stages.map((s) => s.id)).toEqual(['0-0', '1-1', '2-2', '3-3', '4-3']);
    let carry = 0;
    for (const stage of stages) carry = stage.timeLimit + carry - secondsFor(stage);
    expect(carry).toBeGreaterThan(20);
  });
});
