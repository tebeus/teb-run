import { initialPlayer, MAX_SPEED, stepPlayer } from '../../src/game/player';
import { crashDuration, CRASH_TIMING } from '../../src/game/crash';
import { modeOf } from '../../src/game/mode';
import { levelOf, stageById } from '../../src/game/stages';
import { gripFor } from '../../src/game/surface';
import { CATALOG } from '../../src/art/catalog';
import {
  LANE_CHANGE_RATE,
  laneCentres,
  laneOf,
  LOOKAHEAD_SEGMENTS,
  moveToward,
  PLAYER_COLLIDE_W,
} from '../../src/game/traffic';
import { laneToRoad, spriteOffsetOf, xLimitsOf } from '../../src/game/track';
import { wallCollision } from '../../src/game/wall-hit';
import { LANES, SEGMENT_LENGTH } from '../../src/render/project';
import type { Actions, Car, Difficulty, PlayerState, RaceSnapshot, Segment } from '../../src/types';
import { DRIVER_DT, driveRouteWith, forkTargetX, type DriveOptions, type RouteRun } from './prudent-driver';
import {
  LINE_CURVE,
  LINE_LOOKAHEAD,
  SKILLED_DEAD_ZONE,
  SKILLED_GEAR_DOWN_PERCENT,
  SKILLED_GEAR_UP_PERCENT,
  sliceIndex,
  strongestCurve,
} from './skilled-driver';
import { acts } from './race-script';

/**
 * Pilota di riferimento «esperto» della taratura (spec §8, terzo collaudo
 * utente: «ancora troppo facile, troppi secondi, si vince sempre»). Il
 * bravo di `skilled-driver.ts` frena prima delle curve dure: guida 0-0 in
 * 80 s dove a gas pieno ne bastano 54. Chi gioca davvero tiene il gas.
 * L'esperto:
 *
 * - **gas sempre pieno** e **marcia alta** (la bassa solo per ripartire,
 *   come il bravo); il freno **solo come ultima risorsa**, per il minimo
 *   numero di tick di `brakePlans`, quando nessun piano col gas o di solo
 *   rilascio resta pulito (col traffico più fitto delle due modalità
 *   succedeva di arrivare lanciati su una curva dura dopo una schivata);
 * - nelle curve molla il gas **solo per il tempo minimo**: a ogni tick, con
 *   la fisica vera (`stepPlayer` sui segmenti dello snapshot), prova il
 *   piano «gas adesso, poi `n` tick di rilascio, poi di nuovo gas» per ogni
 *   `n` di `coastPlans`; se almeno uno resta sull'asfalto e non tocca niente
 *   per `horizonS` secondi tiene il gas, altrimenti rilascia. È il punto di
 *   rilascio più tardo che non esce di strada;
 * - **traiettoria di corda**: prima della curva si mette sul bordo interno,
 *   dentro la curva sterza verso l'interno solo quando la centrifuga lo
 *   porta oltre la corda e solo se la sterzata lo tiene davvero più dentro
 *   (sopra il 60 % ogni sterzata in curva è una derapata, che raddoppia la
 *   centrifuga: a velocità piena in curva dura sterzare porta più fuori);
 * - **traffico in anticipo**: la stessa prova in avanti fa avanzare i
 *   veicoli alla loro velocità, con il cambio di corsia del motore, e
 *   controlla i contatti come `checkCollisions` (stesso segmento, fasce
 *   sovrapposte), sprite solidi e pareti compresi. Se la corda tocca
 *   qualcosa prova altri bersagli laterali, dal più vicino alla corda;
 * - al bivio tiene il lato scelto.
 *
 * Le varianti restano in `ExpertConfig` per rifare la scansione
 * (`.superpowers/sdd/difficulty3-report.md`).
 */

/** Varianti del pilota esperto, per la scansione di taratura. */
export interface ExpertConfig {
  /** Secondi della prova in avanti. */
  horizonS: number;
  /**
   * Secondi di rilascio in coda alla prova: il piano deve lasciare una via
   * d'uscita, non arrivare in fondo alla prova sul bordo e senza scampo.
   */
  tailS: number;
  /** Tick di rilascio dopo il tick di gas, provati in ordine: 0 è «gas sempre». */
  coastPlans: readonly number[];
  /**
   * Tolleranza oltre il bordo dell'asfalto nella prova: negativa è una
   * scorta dentro il bordo, contro gli scarti fra prova e corsa vera.
   */
  edge: number;
  /** Corda: frazione della semilarghezza da cui la centrifuga comincia a spingere fuori. */
  apex: number;
  /** In curva sterza solo se la sterzata lo tiene più dentro del lasciar scorrere. */
  smartSteer: boolean;
  /** Distanza dal bordo interno del bersaglio prima della curva, e dei bersagli laterali dai bordi. */
  insideGap: number;
  /** Scorta laterale oltre la somma delle semilarghezze, contro veicoli e sprite. */
  trafficMargin: number;
  /** Se nessun piano è pulito, rilascia comunque (col bersaglio che dura di più). */
  fallbackCoast: boolean;
  /**
   * Tick di freno provati, in ordine, quando nessun piano col gas o di solo
   * rilascio resta pulito; vuoto è «mai il freno».
   */
  brakePlans: readonly number[];
}

export const EXPERT_CONFIG: Readonly<ExpertConfig> = {
  horizonS: 3,
  tailS: 0,
  coastPlans: [0, 2, 4, 8, 12, 16, 24, 32, 48],
  edge: -0.06,
  apex: 0.9,
  smartSteer: true,
  insideGap: 0.12,
  trafficMargin: 0.05,
  fallbackCoast: true,
  brakePlans: [2, 4, 8, 12, 16, 24, 32],
};

/** Passo della prova in avanti. */
export const EXPERT_DT = 1 / 20;
/** Sotto questa frazione di velocità l'esperto non rilascia mai. */
export const EXPERT_MIN_COAST_PERCENT = 0.15;
/** Segmenti davanti in cui si guardano i veicoli. */
const TRAFFIC_WATCH = 200;
/** Bersagli laterali provati quando la corda tocca qualcosa, da bordo a bordo. */
const AIM_STEPS = 8;

function stepOn(
  snapshot: RaceSnapshot,
  seg: Segment,
  p: PlayerState,
  gas: boolean,
  steer: -1 | 0 | 1,
  brake = false,
): PlayerState {
  const limits = xLimitsOf(seg);
  return stepPlayer(
    p,
    acts({ accelerate: gas, brake, left: steer < 0, right: steer > 0 }),
    EXPERT_DT,
    seg.curve,
    false,
    seg.roadHalf ?? 1,
    seg.median,
    false,
    gripFor(seg, snapshot.stage.weather),
    limits.min,
    limits.max,
  );
}

/**
 * La carreggiata sotto `x`: tutta la strada, o nel tratto diviso (isola
 * centrale `median`) quella del lato di `x`.
 */
export function carriageOf(x: number, seg: Segment): { lo: number; hi: number } {
  const roadHalf = seg.roadHalf ?? 1;
  const median = seg.median ?? 0;
  if (median <= 0) return { lo: -roadHalf, hi: roadHalf };
  return x < 0 ? { lo: -roadHalf, hi: -median } : { lo: median, hi: roadHalf };
}

/** Fuori dall'asfalto di più di `edge`: oltre il bordo o dentro l'isola centrale. */
export function offAsphalt(x: number, seg: Segment, edge: number): boolean {
  const a = Math.abs(x);
  const median = seg.median ?? 0;
  return a > (seg.roadHalf ?? 1) + edge || (median > 0 && a < median - edge);
}

/**
 * Se `p` tocca sul segmento `seg` uno sprite solido (con `margin` di scorta
 * laterale) o una parete: la stessa prova di `checkCollisions` e
 * `wallCollision` del motore.
 */
export function hitsScenery(p: PlayerState, seg: Segment, margin: number): boolean {
  for (const placed of seg.sprites) {
    const entry = CATALOG[placed.name];
    if (!entry?.solid || entry.collideW <= 0) continue;
    if (Math.abs(p.x - spriteOffsetOf(placed, seg)) < (PLAYER_COLLIDE_W + entry.collideW) / 2 + margin) return true;
  }
  return wallCollision(p, seg) !== null;
}

/**
 * Sterzo di corda sul segmento `seg`: 0 sul dritto; in curva verso l'interno
 * se si è oltre la corda (più lontani dal bordo interno della carreggiata di
 * `1 - apex` della sua semilarghezza) e, con `smartSteer`, solo se un passo
 * sterzato finisce più dentro di un passo lasciato scorrere.
 */
export function lineSteer(
  snapshot: RaceSnapshot,
  seg: Segment,
  p: PlayerState,
  gas: boolean,
  cfg: Readonly<ExpertConfig>,
): -1 | 0 | 1 {
  if (Math.abs(seg.curve) < LINE_CURVE) return 0;
  const out = seg.curve > 0 ? -1 : 1;
  const { lo, hi } = carriageOf(p.x, seg);
  const inner = out < 0 ? hi : lo;
  if (Math.abs(inner - p.x) <= ((1 - cfg.apex) * (hi - lo)) / 2) return 0;
  const inward = (-out) as -1 | 1;
  if (!cfg.smartSteer) return inward;
  const steered = stepOn(snapshot, seg, p, gas, inward).x * out;
  const free = stepOn(snapshot, seg, p, gas, 0).x * out;
  return steered < free ? inward : 0;
}

/** Sterzo verso `x`, con la zona morta. */
function steerToward(from: number, x: number): -1 | 0 | 1 {
  const dx = x - from;
  return dx < -SKILLED_DEAD_ZONE ? -1 : dx > SKILLED_DEAD_ZONE ? 1 : 0;
}

/** Un veicolo davanti, fotografato in questo tick per la prova in avanti. */
interface Obstacle {
  z: number;
  speed: number;
  offset: number;
  /**
   * Offset estremi verso cui può cambiare corsia dentro la prova: le due
   * corsie accanto se nella sua c'è (o entrerà) un più lento, altrimenti il
   * suo. Quale delle due scelga il motore dipende da chi entra per primo
   * nei suoi 20 segmenti, quindi la prova le tiene entrambe.
   */
  lo: number;
  hi: number;
  median: number;
  w: number;
}

/**
 * I veicoli dei prossimi `TRAFFIC_WATCH` segmenti, con il cambio di corsia
 * del motore (`avoidOffset`): chi ha un veicolo più lento davanti entro
 * `LOOKAHEAD_SEGMENTS` si sposta verso la corsia libera (`escapeLane`) a
 * `LANE_CHANGE_RATE`.
 */
function obstaclesAhead(snapshot: RaceSnapshot, here: number, horizonS: number): Obstacle[] {
  const cars: { car: Car; median: number; w: number }[] = [];
  const last = Math.min(snapshot.segments.length - 1, here + TRAFFIC_WATCH + LOOKAHEAD_SEGMENTS);
  // Da `here - 4`, cioè dalla telecamera: la moto (fino a 0,6 di
  // MAX_SPEED) raggiunge da dietro chi va piano sulla neve.
  for (let i = Math.max(0, here - 4); i <= last; i++) {
    const seg = snapshot.segments[i];
    for (const car of seg.cars) cars.push({ car, median: seg.median ?? 0, w: CATALOG[car.name]?.collideW ?? 0 });
  }
  const lanes = snapshot.stage.lanes ?? LANES;
  const centres = laneCentres(lanes);
  const reach = LOOKAHEAD_SEGMENTS * SEGMENT_LENGTH;
  return cars
    .filter((c) => c.w > 0)
    .map(({ car, median, w }) => {
      const blocked = centres.map(() => false);
      for (const { car: other } of cars) {
        if (other.id === car.id || other.z <= car.z || other.speed >= car.speed) continue;
        // Un più lento che entra nella finestra del motore entro la prova
        // conta già adesso: il cambio di corsia comincerà dentro la prova.
        const closing = (car.speed - other.speed) * horizonS;
        if (other.z - closing > car.z + reach) continue;
        blocked[laneOf(other.offset, lanes)] = true;
      }
      const lane = laneOf(car.offset, lanes);
      const lo = blocked[lane] && lane > 0 ? centres[lane - 1] : car.offset;
      const hi = blocked[lane] && lane < centres.length - 1 ? centres[lane + 1] : car.offset;
      return { z: car.z, speed: car.speed, offset: car.offset, lo, hi, median, w };
    });
}

/**
 * Prova in avanti di un piano: `gasNow` in questo tick, poi `coast` tick di
 * rilascio, poi gas; lo sterzo segue `aim` (`null` è la corda, un numero è
 * una x da raggiungere). Fisica vera sui segmenti dello snapshot, veicoli
 * che avanzano alla loro velocità. Ritorna i secondi fino al primo guaio
 * (oltre il bordo più `edge`, un veicolo, uno sprite solido, una parete),
 * `Infinity` se per `horizonS` secondi non succede niente.
 */
export function planClearFor(
  snapshot: RaceSnapshot,
  aim: number | null,
  gasNow: boolean,
  coast: number,
  obstacles: readonly Obstacle[],
  cfg: Readonly<ExpertConfig>,
  brakeTicks = 0,
): number {
  let p = snapshot.player;
  const steps = Math.round(cfg.horizonS / EXPERT_DT);
  const tail = Math.round(cfg.tailS / EXPERT_DT);
  for (let k = 0; k < steps + tail; k++) {
    const i = sliceIndex(snapshot, p.z);
    if (i >= snapshot.segments.length) return Number.POSITIVE_INFINITY;
    const seg = snapshot.segments[i];
    if (seg.fork === 'zone') return Number.POSITIVE_INFINITY;
    const brake = k < brakeTicks;
    const gas = brake ? false : k === 0 ? gasNow : k > coast && k < steps;
    const steer = aim === null ? lineSteer(snapshot, seg, p, gas, cfg) : steerToward(p.x, aim);
    p = stepOn(snapshot, seg, p, gas, steer, brake);
    const t = (k + 1) * EXPERT_DT;
    if (offAsphalt(p.x, seg, cfg.edge) || hitsScenery(p, seg, cfg.trafficMargin)) return t;
    const roadHalf = seg.roadHalf ?? 1;
    const playerSeg = Math.floor(p.z / SEGMENT_LENGTH);
    for (const o of obstacles) {
      const oz = o.z + o.speed * t;
      if (Math.abs(Math.floor(oz / SEGMENT_LENGTH) - playerSeg) > 1) continue;
      // Il veicolo occupa tutta la fascia fra i due punti dove può essere
      // arrivato cambiando corsia, lui compreso: il cambio può cominciare
      // più tardi, o non cominciare.
      const a = laneToRoad(moveToward(o.offset, o.lo, LANE_CHANGE_RATE * t), roadHalf, o.median);
      const b = laneToRoad(moveToward(o.offset, o.hi, LANE_CHANGE_RATE * t), roadHalf, o.median);
      const gap = p.x < Math.min(a, b) ? Math.min(a, b) - p.x : p.x > Math.max(a, b) ? p.x - Math.max(a, b) : 0;
      if (gap < (PLAYER_COLLIDE_W + o.w) / 2 + cfg.trafficMargin) return t;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Dove vuole stare la corda: `null` in curva (decide `lineSteer`), il bordo
 * interno della carreggiata prima di una curva, altrimenti dov'è (o dentro
 * la carreggiata, se è sul bordo o sull'isola centrale).
 */
function lineTarget(snapshot: RaceSnapshot, here: number, cfg: Readonly<ExpertConfig>): number | null {
  const seg = snapshot.segments[here];
  const { x } = snapshot.player;
  if (seg === undefined) return x;
  if (Math.abs(seg.curve) >= LINE_CURVE) return null;
  const { lo, hi } = carriageOf(x, seg);
  const coming = strongestCurve(snapshot, here, LINE_LOOKAHEAD);
  // Curva > 0 spinge verso x negative: l'interno è a destra.
  if (Math.abs(coming) >= LINE_CURVE) return coming > 0 ? hi - cfg.insideGap : lo + cfg.insideGap;
  return Math.min(hi - cfg.insideGap, Math.max(lo + cfg.insideGap, x));
}

/** Bersagli laterali: la corda, poi `AIM_STEPS + 1` x da bordo a bordo, dalla più vicina alla corda. */
function aimsOf(
  snapshot: RaceSnapshot,
  here: number,
  cfg: Readonly<ExpertConfig>,
  prefer?: number,
): (number | null)[] {
  const seg = snapshot.segments[here];
  const want = prefer ?? lineTarget(snapshot, here, cfg);
  if (seg === undefined) return [want];
  const roadHalf = seg.roadHalf ?? 1;
  const from = want ?? snapshot.player.x;
  const aims: number[] = [];
  for (let k = 0; k <= AIM_STEPS; k++) {
    const aim = -roadHalf + cfg.insideGap + (2 * (roadHalf - cfg.insideGap) * k) / AIM_STEPS;
    if (!offAsphalt(aim, seg, -cfg.insideGap)) aims.push(aim);
  }
  aims.sort((a, b) => Math.abs(a - from) - Math.abs(b - from));
  return [want, ...aims];
}

/**
 * La decisione del tick: gas se c'è un bersaglio laterale e un piano di
 * rilascio che partono col gas e non toccano niente per `horizonS`
 * secondi (il primo trovato, nell'ordine dei bersagli); altrimenti rilascio,
 * col bersaglio che dura di più.
 */
function decide(
  snapshot: RaceSnapshot,
  here: number,
  cfg: Readonly<ExpertConfig>,
  prefer?: number,
): { gas: boolean; aim: number | null; brake?: boolean } {
  const obstacles = obstaclesAhead(snapshot, here, cfg.horizonS);
  const aims = aimsOf(snapshot, here, cfg, prefer);
  const plans = snapshot.player.speed / MAX_SPEED <= EXPERT_MIN_COAST_PERCENT ? [0] : cfg.coastPlans;
  let best: { gas: boolean; aim: number | null; brake?: boolean } = { gas: true, aim: aims[0] };
  let bestT = -1;
  for (const aim of aims) {
    for (const n of plans) {
      const t = planClearFor(snapshot, aim, true, n, obstacles, cfg);
      if (t === Number.POSITIVE_INFINITY) return { gas: true, aim };
      if (t > bestT) {
        bestT = t;
        best = { gas: true, aim };
      }
      // Un guaio nel primo tick non dipende dal rilascio che viene dopo.
      if (t <= EXPERT_DT) break;
    }
  }
  if (plans.length === 1) return best;
  // Già fuori dall'asfalto (dopo un errore) ogni piano fallisce subito:
  // rilasciare lo lascerebbe lì, il gas lo riporta in strada.
  const seg = snapshot.segments[here];
  if (seg !== undefined && offAsphalt(snapshot.player.x, seg, 0)) return best;
  if (cfg.fallbackCoast) bestT = -1;
  for (const aim of aims) {
    const t = planClearFor(snapshot, aim, false, cfg.fallbackCoast ? Number.POSITIVE_INFINITY : plans[plans.length - 1], obstacles, cfg);
    if (t === Number.POSITIVE_INFINITY) return { gas: false, aim };
    if (t > bestT) {
      bestT = t;
      best = { gas: false, aim };
    }
  }
  // Ultima risorsa: il freno, il meno possibile.
  for (const n of cfg.brakePlans) {
    for (const aim of aims) {
      if (planClearFor(snapshot, aim, false, 0, obstacles, cfg, n) === Number.POSITIVE_INFINITY) {
        return { gas: false, aim, brake: true };
      }
    }
  }
  return best;
}

/**
 * Azioni del pilota esperto, variante `cfg`. Pura rispetto allo snapshot.
 * `prefer`, se dato, sostituisce la corda come x voluta: i test che vogliono
 * l'auto su una corsia precisa la ottengono senza rinunciare alla prova
 * contro il traffico.
 */
export function expertActionsWith(
  cfg: Readonly<ExpertConfig>,
  snapshot: RaceSnapshot,
  side: 'L' | 'R',
  prefer?: number,
): Actions {
  const { player } = snapshot;
  const speedPercent = player.speed / MAX_SPEED;
  const shift =
    (player.gear === 'lo' && speedPercent > SKILLED_GEAR_UP_PERCENT) ||
    (player.gear === 'hi' && speedPercent < SKILLED_GEAR_DOWN_PERCENT);
  const here = sliceIndex(snapshot, player.z);
  const seg = snapshot.segments[here];
  let gas = true;
  let brake = false;
  let steer: -1 | 0 | 1;
  if (snapshot.banner === 'fork' || seg?.fork === 'zone') {
    steer = steerToward(player.x, forkTargetX(snapshot, side));
  } else {
    const plan = decide(snapshot, here, cfg, prefer);
    gas = plan.gas;
    brake = plan.brake ?? false;
    steer =
      plan.aim === null ? (seg === undefined ? 0 : lineSteer(snapshot, seg, player, gas, cfg)) : steerToward(player.x, plan.aim);
  }
  return acts({ accelerate: gas, brake, gearToggle: shift, left: steer < 0, right: steer > 0 });
}

/**
 * Tempo teorico di ogni tappa di `stageIds` (in ordine, velocità portata da
 * una all'altra): gas pieno dal via, cambio dell'esperto, strada tutta
 * dritta, niente traffico. È il pavimento che nessun pilota batte.
 */
export function fullThrottleTimes(stageIds: readonly string[], dt = EXPERT_DT): number[] {
  let p = initialPlayer();
  const times: number[] = [];
  let end = 0;
  for (const id of stageIds) {
    end += stageById(id).lengthSegments * SEGMENT_LENGTH;
    let t = 0;
    while (p.z < end) {
      const speedPercent = p.speed / MAX_SPEED;
      const shift =
        (p.gear === 'lo' && speedPercent > SKILLED_GEAR_UP_PERCENT) ||
        (p.gear === 'hi' && speedPercent < SKILLED_GEAR_DOWN_PERCENT);
      p = stepPlayer(p, acts({ accelerate: true, gearToggle: shift }), dt, 0, false);
      t += dt;
    }
    times.push(t);
  }
  return times;
}

/** Guida un percorso intero con il pilota esperto (vedi `driveRoute`). */
export function driveRouteExpert(
  route: readonly ('L' | 'R')[],
  options: DriveOptions = {},
  cfg: Readonly<ExpertConfig> = EXPERT_CONFIG,
): RouteRun {
  return driveRouteWith((snapshot, _state, side) => expertActionsWith(cfg, snapshot, side), route, options);
}

/**
 * Secondi da fermo del testacoda simulato: quanto l'incidente del motore
 * (`game/crash.ts`) tiene l'auto ferma dopo che la velocità è arrivata a
 * zero, cioè la sua durata meno il tempo di arresto, nella modalità `mode`.
 */
export function errorStillS(mode: Difficulty): number {
  const timing = CRASH_TIMING[mode];
  return crashDuration(timing) - timing.stop;
}

/**
 * L'esperto con **degli** errori (spec §8): a metà della tappa di ogni
 * livello di `errorLevels` (uno solo, o una lista: un errore per livello)
 * fa un testacoda simulato, cioè la perdita di velocità di un incidente del
 * motore dovunque capiti, senza dipendere da dove sono le pareti o il
 * traffico: freno fino a fermo, `errorStillS` secondi fermo (della modalità
 * della tappa), poi riparte da esperto (in Lo, come dopo un incidente).
 * Fuori da quei tratti guida identico all'esperto.
 */
export function driveRouteExpertWithError(
  route: readonly ('L' | 'R')[],
  errorLevels: number | readonly number[],
  options: DriveOptions = {},
  cfg: Readonly<ExpertConfig> = EXPERT_CONFIG,
): RouteRun {
  const pending = new Set(typeof errorLevels === 'number' ? [errorLevels] : errorLevels);
  let phase: 'driving' | 'braking' | 'still' = 'driving';
  let still = 0;
  return driveRouteWith(
    (snapshot, _state, side) => {
      const { player, stage } = snapshot;
      const half = (stage.lengthSegments * SEGMENT_LENGTH) / 2;
      const level = levelOf(stage.id);
      if (phase === 'driving' && pending.has(level) && player.z >= half) {
        pending.delete(level);
        phase = 'braking';
      }
      if (phase === 'braking') {
        if (player.speed > 0) return acts({ brake: true });
        phase = 'still';
        still = errorStillS(modeOf(stage));
      }
      if (phase === 'still') {
        still -= options.dt ?? DRIVER_DT;
        if (still > 0) return acts({ gearToggle: player.gear === 'hi' });
        phase = 'driving';
      }
      return expertActionsWith(cfg, snapshot, side);
    },
    route,
    options,
  );
}
