import { MAX_SPEED, stepPlayer } from '../../src/game/player';
import { createStageGraph, type StageGraph } from '../../src/game/stage-graph';
import { STAGE_LIST } from '../../src/game/stages';
import { gripFor } from '../../src/game/surface';
import { CATALOG } from '../../src/art/catalog';
import { laneOf, PLAYER_COLLIDE_W } from '../../src/game/traffic';
import { laneToRoad, xLimitsOf } from '../../src/game/track';
import { SEGMENT_LENGTH } from '../../src/render/project';
import type { Actions, PlayerState, RaceSnapshot, Segment } from '../../src/types';
import {
  blockedAhead,
  centresOf,
  driveRouteWith,
  forkTargetX,
  targetLane,
  type DriveOptions,
  type DriverState,
  type RouteRun,
} from './prudent-driver';
import { acts } from './race-script';

/**
 * Pilota di riferimento «bravo» della taratura (spec §8, secondo collaudo
 * utente: «ancora troppo facile»). Il prudente tiene il gas anche quando
 * frena — e nel motore il gas vince sul freno, quindi quella frenata non
 * frena —, sterza verso la sua corsia anche in piena curva (e in curva
 * sopra il 60 % ogni sterzata è una derapata) e non rimette la marcia alta
 * dopo un incidente: è molto più lento di chi gioca. Il bravo:
 *
 * - **gas pieno** e **marcia alta**, con la bassa solo per ripartire: la
 *   tiene fino al 55 % (dove la bassa si ferma) e ci torna sotto il 50 %,
 *   dopo un urto o uno schianto (che riporta comunque la bassa);
 * - **freno solo prima e dentro le curve dure**: curvatura sopra la media
 *   (`CURVE_MEDIUM`), che esiste solo nei tratti di curva dura di
 *   `game/track.ts`. E **solo quanto basta**: a ogni tick prova in avanti,
 *   con la fisica vera (`stepPlayer` sui segmenti dello snapshot), se a gas
 *   pieno resterebbe sull'asfalto per i prossimi `HORIZON_S` secondi; frena
 *   un tick solo se no. Nelle curve medie, dove il freno non serve, alza il
 *   piede allo stesso modo (rilascio, non freno);
 * - in curva prende la **corda**: si mette sul lato interno prima che la
 *   centrifuga lo porti fuori, e sterza solo quando la centrifuga lo
 *   spinge oltre la corda, non per inseguire il centro di una corsia;
 * - **corsia libera** dal traffico con lo stesso codice del prudente
 *   (`targetLane`, `blockedAhead`), e al bivio il lato scelto
 *   (`forkTargetX`), più uno scarto d'emergenza quando un veicolo più
 *   lento è sulla traiettoria (`dodge`).
 *
 * Scansione di taratura (`.superpowers/sdd/difficulty2-report.md`), tempo
 * di guida totale sui 16 percorsi: prudente 9460 s; bravo "alla lettera"
 * (soglia fissa di freno sulle curve dure, corsia del prudente) 8071 s;
 * questo 7657 s, il più veloce delle varianti provate. Le varianti restano
 * in `SkilledConfig` per rifare la scansione.
 */

/**
 * Curvature di `CURVE` in `game/track.ts` (non esportata): facile 2, media
 * 4, dura 6. Una curvatura **sopra la media** esiste solo in un tratto di
 * curva dura (rampa d'ingresso compresa, o chicane dura): è il segnale del
 * freno.
 */
export const CURVE_MEDIUM = 4;
/** Sotto questa curvatura la strada conta come dritta per la traiettoria. */
export const LINE_CURVE = 1.5;
/**
 * Cambio: la bassa spinge `ACCEL_LO` (un terzo di `MAX_SPEED` al secondo)
 * contro il quinto della alta, e la alta sotto il 30 % spinge la metà, ma la
 * bassa si ferma a `MAX_SPEED_LO` (55 %). Il bravo sta in bassa fino a
 * lì e scala di nuovo sotto `SKILLED_GEAR_DOWN_PERCENT` (dopo un urto o una
 * frenata forte), come chi gioca a un racer arcade.
 */
export const SKILLED_GEAR_UP_PERCENT = 0.54;
export const SKILLED_GEAR_DOWN_PERCENT = 0.5;
/** Secondi di prova in avanti: una curva dura intera, rampe comprese, a velocità piena. */
export const HORIZON_S = 3;
/** Segmenti davanti in cui una curva accende la prova in avanti (3 s a velocità piena). */
export const CURVE_WATCH = 180;
/** Sotto questa frazione di velocità il bravo non rallenta mai. */
export const MIN_SLOW_PERCENT = 0.35;
/** Passo della prova in avanti. */
export const HORIZON_DT = 1 / 20;
/** Segmenti davanti in cui una curva decide la traiettoria di corda. */
export const LINE_LOOKAHEAD = 45;
/** Corda: frazione della semilarghezza da cui la centrifuga comincia a spingere fuori. */
export const APEX = 0.75;
/** Quanto la prova tollera oltre il bordo: la banchina è larga 0,35 e rallenta poco. */
export const EDGE_ALLOWANCE = 0.1;
/** Segmenti davanti in cui un veicolo più lento sulla traiettoria fa scartare. */
export const DODGE_LOOKAHEAD = 20;
/** Margine laterale in più, oltre alla somma delle semilarghezze, per lo scarto. */
export const DODGE_MARGIN = 0.12;
/** Zona morta dello sterzo, come il prudente. */
export const SKILLED_DEAD_ZONE = 0.03;

/** Indice nello snapshot del segmento che contiene z. */
export function sliceIndex(snapshot: RaceSnapshot, z: number): number {
  const n = snapshot.stage.lengthSegments;
  const i = Math.floor(z / SEGMENT_LENGTH) - snapshot.segments[0].index;
  return ((i % n) + n) % n;
}

/** Curvatura firmata più forte nei prossimi `lookahead` segmenti, dal giocatore. */
export function strongestCurve(snapshot: RaceSnapshot, from: number, lookahead: number): number {
  let best = 0;
  const last = Math.min(snapshot.segments.length - 1, from + lookahead);
  for (let i = from; i <= last; i++) {
    const c = snapshot.segments[i].curve;
    if (Math.abs(c) > Math.abs(best)) best = c;
  }
  return best;
}

/**
 * Sterzo di corda: con la curva `curve` la centrifuga spinge verso
 * `-sign(curve)`. Si sterza verso l'interno solo se si è oltre la corda
 * (`APEX` della semilarghezza verso l'interno), altrimenti si lascia
 * scivolare: ogni sterzata in curva sopra il 60 % è una derapata.
 */
function apexSteer(x: number, curve: number, roadHalf: number): -1 | 0 | 1 {
  const out = curve > 0 ? -1 : 1;
  const u = x * out;
  return u > -APEX * roadHalf ? ((-out) as -1 | 1) : 0;
}

/**
 * Prova in avanti a gas pieno con lo sterzo di corda: `true` se per
 * `HORIZON_S` secondi non si esce oltre il bordo più `EDGE_ALLOWANCE`.
 * Senza traffico: il traffico lo evita la corsia.
 */
export function staysOnRoad(snapshot: RaceSnapshot, start: PlayerState): boolean {
  let p = start;
  const steps = Math.round(HORIZON_S / HORIZON_DT);
  for (let k = 0; k < steps; k++) {
    const i = sliceIndex(snapshot, p.z);
    if (i >= snapshot.segments.length) return true;
    const seg: Segment = snapshot.segments[i];
    const roadHalf = seg.roadHalf ?? 1;
    if (seg.fork === 'zone') return true;
    const steer = Math.abs(seg.curve) >= LINE_CURVE ? apexSteer(p.x, seg.curve, roadHalf) : 0;
    const limits = xLimitsOf(seg);
    p = stepPlayer(
      p,
      acts({ accelerate: true, left: steer < 0, right: steer > 0 }),
      HORIZON_DT,
      seg.curve,
      false,
      roadHalf,
      seg.median,
      false,
      gripFor(seg, snapshot.stage.weather),
      limits.min,
      limits.max,
    );
    if (Math.abs(p.x) > roadHalf + EDGE_ALLOWANCE) return false;
  }
  return true;
}

/** Se nei segmenti davanti c'è un tratto di curva dura (curvatura sopra la media). */
export function hardCurveAhead(snapshot: RaceSnapshot, from: number, lookahead: number): boolean {
  return Math.abs(strongestCurve(snapshot, from, lookahead)) > CURVE_MEDIUM;
}

/**
 * Scarto d'emergenza: il veicolo più lento più vicino che, entro
 * `DODGE_LOOKAHEAD` segmenti, si sovrappone alla x del giocatore. Ritorna
 * il verso che lo scansa, o 0 se la traiettoria è libera. La scelta della
 * corsia (`targetLane`) guarda le corsie, non il tragitto per arrivarci:
 * questo copre il cambio di corsia che taglia la strada a un veicolo.
 */
function dodge(snapshot: RaceSnapshot, from: number): -1 | 0 | 1 {
  const { player } = snapshot;
  const last = Math.min(snapshot.segments.length - 1, from + DODGE_LOOKAHEAD);
  for (let i = from; i <= last; i++) {
    const seg = snapshot.segments[i];
    for (const car of seg.cars) {
      if (car.speed >= player.speed) continue;
      const offset = laneToRoad(car.offset, seg.roadHalf ?? 1, seg.median ?? 0);
      const w = CATALOG[car.name]?.collideW ?? PLAYER_COLLIDE_W;
      const reach = (PLAYER_COLLIDE_W + w) / 2 + DODGE_MARGIN;
      if (Math.abs(player.x - offset) >= reach) continue;
      const roadHalf = seg.roadHalf ?? 1;
      // Verso il lato con più strada libera oltre il veicolo.
      const roomLeft = offset - reach + roadHalf;
      const roomRight = roadHalf - (offset + reach);
      return roomRight > roomLeft ? 1 : -1;
    }
  }
  return 0;
}

/** Bersaglio laterale: bivio, corda della curva in arrivo, o corsia libera. */
function lateral(snapshot: RaceSnapshot, side: 'L' | 'R', here: number, cfg: Readonly<SkilledConfig>): -1 | 0 | 1 {
  const { player } = snapshot;
  const seg = snapshot.segments[here];
  const roadHalf = seg?.roadHalf ?? 1;
  const toward = (x: number): -1 | 0 | 1 => {
    const dx = x - player.x;
    return dx < -SKILLED_DEAD_ZONE ? -1 : dx > SKILLED_DEAD_ZONE ? 1 : 0;
  };
  if (snapshot.banner === 'fork' || seg?.fork === 'zone') return toward(forkTargetX(snapshot, side));
  const away = cfg.dodge ? dodge(snapshot, here) : 0;
  if (away !== 0) return away;
  if (!cfg.apex) return prudentSteer(snapshot, side);
  const centres = centresOf(snapshot);
  const lanes = centres.length;
  const now = seg?.curve ?? 0;
  if (Math.abs(now) >= LINE_CURVE) {
    // Dentro la curva: corda, salvo un veicolo più lento nella corsia.
    const blocked = blockedAhead(snapshot, player.speed);
    if (!blocked[laneOf(player.x, lanes)]) return apexSteer(player.x, now, roadHalf);
    return toward(centres[targetLane(snapshot, player.speed)]);
  }
  const coming = strongestCurve(snapshot, here, LINE_LOOKAHEAD);
  if (Math.abs(coming) >= LINE_CURVE) {
    // Curva in arrivo: la corsia libera più interna.
    // Curva > 0 spinge verso x negative: l'interno è a destra, l'ultima
    // corsia; curva < 0 il contrario.
    const blocked = blockedAhead(snapshot, player.speed);
    const order = centres.map((_, i) => i);
    if (coming > 0) order.reverse();
    const inside = order.find((i) => !blocked[i]);
    if (inside !== undefined) return toward(centres[inside]);
  }
  return toward(centres[targetLane(snapshot, player.speed)]);
}

/** Varianti del pilota, per la scansione di taratura. */
export interface SkilledConfig {
  /** Prova in avanti con la fisica vera, o soglia fissa `hardPercent`. */
  mpc: boolean;
  hardPercent: number;
  hardLookahead: number;
  /** Corda in curva, o la corsia del prudente. */
  apex: boolean;
  /** Scarto d'emergenza dal veicolo sulla traiettoria. */
  dodge: boolean;
  /** Bassa fino al 55 % e scalata sotto il 50 %, o solo alta come il prudente. */
  downshift: boolean;
}

/** Il pilota bravo della taratura: tutte le tecniche accese. */
export const SKILLED_CONFIG: Readonly<SkilledConfig> = {
  mpc: true,
  hardPercent: 0.5,
  hardLookahead: 12,
  apex: true,
  dodge: true,
  downshift: true,
};

/** Azioni del pilota bravo, variante `cfg`. Pura rispetto allo snapshot. */
export function skilledActionsWith(
  cfg: Readonly<SkilledConfig>,
  snapshot: RaceSnapshot,
  side: 'L' | 'R',
): Actions {
  const { player } = snapshot;
  const speedPercent = player.speed / MAX_SPEED;
  const shift = cfg.downshift
    ? (player.gear === 'lo' && speedPercent > SKILLED_GEAR_UP_PERCENT) ||
      (player.gear === 'hi' && speedPercent < SKILLED_GEAR_DOWN_PERCENT)
    : player.gear === 'lo' && speedPercent > 0.3;
  const here = sliceIndex(snapshot, player.z);
  let slowDown: boolean;
  let brake: boolean;
  if (cfg.mpc) {
    // La prova in avanti serve solo se una curva è vicina: sul dritto il gas
    // è sempre giusto, e la prova costa 60 passi di fisica. Sotto
    // `MIN_SLOW_PERCENT` non si rallenta mai: da fermo sulla banchina la
    // prova fallirebbe per sempre.
    const curveNear = Math.abs(strongestCurve(snapshot, here, CURVE_WATCH)) >= LINE_CURVE;
    slowDown = speedPercent > MIN_SLOW_PERCENT && curveNear && !staysOnRoad(snapshot, player);
    brake = slowDown && hardCurveAhead(snapshot, here, 90);
  } else {
    brake = speedPercent > cfg.hardPercent && hardCurveAhead(snapshot, here, cfg.hardLookahead);
    slowDown = brake;
  }
  const steer = cfg.apex || cfg.dodge ? lateral(snapshot, side, here, cfg) : prudentSteer(snapshot, side);
  return acts({
    accelerate: !slowDown,
    brake,
    gearToggle: shift,
    left: steer < 0,
    right: steer > 0,
  });
}

/** Azioni del pilota bravo della taratura. */
export function skilledActions(snapshot: RaceSnapshot, _state: DriverState, side: 'L' | 'R'): Actions {
  return skilledActionsWith(SKILLED_CONFIG, snapshot, side);
}

/** Lo sterzo del prudente: corsia libera, lato del bivio. */
function prudentSteer(snapshot: RaceSnapshot, side: 'L' | 'R'): -1 | 0 | 1 {
  const targetX =
    snapshot.banner === 'fork'
      ? forkTargetX(snapshot, side)
      : centresOf(snapshot)[targetLane(snapshot, snapshot.player.speed)];
  const dx = targetX - snapshot.player.x;
  return dx < -SKILLED_DEAD_ZONE ? -1 : dx > SKILLED_DEAD_ZONE ? 1 : 0;
}

/** Guida un percorso intero con il pilota bravo (vedi `driveRoute`). */
export function driveRouteSkilled(
  route: readonly ('L' | 'R')[],
  options: DriveOptions = {},
  cfg: Readonly<SkilledConfig> = SKILLED_CONFIG,
): RouteRun {
  return driveRouteWith((snapshot, _state, side) => skilledActionsWith(cfg, snapshot, side), route, options);
}

/**
 * Le 15 tappe vere con un tempo larghissimo: nessun game over, quindi la
 * corsa arriva sempre in fondo e il tempo di ogni tappa si misura intero.
 */
export function untimedGraph(seconds = 9999): StageGraph {
  return createStageGraph(STAGE_LIST.map((s) => ({ ...s, timeLimit: seconds })));
}

/**
 * Tempo di guida per tappa, nell'ordine del percorso: budget della tappa
 * (limite più riporto) meno il margine. Va letto su una corsa di
 * `untimedGraph(seconds)`.
 */
export function stageTimes(run: RouteRun, seconds = 9999): number[] {
  const times: number[] = [];
  let budget = seconds;
  for (const m of run.margins) {
    times.push(budget - m.margin);
    budget = m.margin + seconds;
  }
  return times;
}
