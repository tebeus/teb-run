import { createFullRace } from '../../src/game/race';
import { KMH_AT_MAX } from '../../src/game/player';
import { REAL_GRAPH, levelOf } from '../../src/game/stages';
import type { StageGraph } from '../../src/game/stage-graph';
import { laneCentres, laneOf } from '../../src/game/traffic';
import { LANES } from '../../src/render/project';
import type { Actions, AssetStore, RaceSnapshot, SpriteAsset } from '../../src/types';
import { acts } from './race-script';

/**
 * Passo di simulazione dichiarato: un terzo della frequenza di gioco. Serve
 * a tenere il test della taratura sotto i 20 s: con 1/30 il file misurava
 * 21 s, con 1/20 ne misura 14,5. La fisica è integrata con Euler, quindi un
 * passo più grosso è leggermente più generoso, e i limiti dello step 4 sono
 * misurati con questo.
 */
export const DRIVER_DT = 1 / 20;
/** Indice del segmento del giocatore nella fetta visibile (la telecamera sta dietro). */
export const PLAYER_SEGMENT = 4;
/** Quanti segmenti avanti guarda il pilota per scegliere la corsia. */
export const LOOKAHEAD = 40;
/** Sopra questa frazione di velocità mette la marcia alta. */
export const GEAR_UP_PERCENT = 0.3;
/** Curvatura assoluta che fa frenare. */
export const BRAKE_CURVE = 2;
/** Sopra questa frazione di velocità, in curva, frena. */
export const BRAKE_PERCENT = 0.7;
/** Zona morta dello sterzo: sotto questa distanza non corregge. */
export const DEAD_ZONE = 0.03;
/**
 * Bersaglio nella zona di bivio: il centro della carreggiata scelta. La zona
 * si divide in due strade (task 16, che nell'ordine di esecuzione viene prima
 * di questo): all'inizio la strada è ancora una e il centro vale ±0.5, in
 * fondo ±1.8. Mirare a ±0.5 fino alla fine finirebbe **dentro l'isola**, che
 * è terreno e non asfalto.
 */
export function forkTargetX(snapshot: RaceSnapshot, side: 'L' | 'R'): number {
  const seg = snapshot.segments[PLAYER_SEGMENT];
  const roadHalf = seg?.roadHalf ?? 1;
  const median = seg?.median ?? 0;
  const centre = (median + roadHalf) / 2;
  return side === 'L' ? -centre : centre;
}

/** Store finto senza canvas: il motore lo usa solo per `get`, che non deve lanciare. */
export function stubAssets(): AssetStore {
  return {
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: {} as CanvasImageSource,
      w: 64,
      h: 64,
      entry: { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  };
}

/** Curvatura massima in valore assoluto fra due indici della fetta visibile. Pura. */
export function curveAhead(snapshot: RaceSnapshot, from: number, to: number): number {
  let max = 0;
  for (let i = from; i <= to && i < snapshot.segments.length; i++) {
    const c = Math.abs(snapshot.segments[i].curve);
    if (c > max) max = c;
  }
  return max;
}

/** Le corsie della tappa corrente: tre o quattro (spec §9). */
export function centresOf(snapshot: RaceSnapshot): readonly number[] {
  return laneCentres(snapshot.stage.lanes ?? LANES);
}

/** Corsie con davanti un veicolo più lento, entro LOOKAHEAD segmenti. Pura. */
export function blockedAhead(snapshot: RaceSnapshot, playerSpeed: number): boolean[] {
  const centres = centresOf(snapshot);
  const lanes = centres.length;
  const blocked = centres.map(() => false);
  for (let i = PLAYER_SEGMENT; i <= PLAYER_SEGMENT + LOOKAHEAD && i < snapshot.segments.length; i++) {
    for (const car of snapshot.segments[i].cars) {
      if (car.speed < playerSpeed) blocked[laneOf(car.offset, lanes)] = true;
    }
  }
  return blocked;
}

/** Corsia libera più vicina a quella attuale; la propria se è libera. Pura. */
export function targetLane(snapshot: RaceSnapshot, playerSpeed: number): number {
  const centres = centresOf(snapshot);
  const here = laneOf(snapshot.player.x, centres.length);
  const blocked = blockedAhead(snapshot, playerSpeed);
  if (!blocked[here]) return here;
  for (let d = 1; d < centres.length; d++) {
    if (here - d >= 0 && !blocked[here - d]) return here - d;
    if (here + d < centres.length && !blocked[here + d]) return here + d;
  }
  return here;
}

export interface DriverState {
  /** La marcia alta si mette una volta sola. */
  shifted: boolean;
}

/**
 * Azioni di un pilota prudente: gas sempre, marcia alta appena superato il
 * 30%, freno nelle curve strette sopra il 70%, corsia libera, e nella zona di
 * bivio si mette sul lato scelto. Pura rispetto allo snapshot.
 */
export function prudentActions(snapshot: RaceSnapshot, state: DriverState, side: 'L' | 'R'): Actions {
  const speedPercent = Math.max(0, Math.min(1, snapshot.kmh / KMH_AT_MAX));
  const shift = !state.shifted && snapshot.player.gear === 'lo' && speedPercent > GEAR_UP_PERCENT;
  if (shift) state.shifted = true;
  const curve = curveAhead(snapshot, PLAYER_SEGMENT, PLAYER_SEGMENT + 12);
  const brake = curve >= BRAKE_CURVE && speedPercent > BRAKE_PERCENT;
  const targetX =
    snapshot.banner === 'fork'
      ? forkTargetX(snapshot, side)
      : centresOf(snapshot)[targetLane(snapshot, snapshot.player.speed)];
  const dx = targetX - snapshot.player.x;
  return acts({
    accelerate: true,
    brake,
    gearToggle: shift,
    left: dx < -DEAD_ZONE,
    right: dx > DEAD_ZONE,
  });
}

export interface StageMargin {
  id: string;
  level: number;
  /** Secondi che restavano quando la tappa si è chiusa. */
  margin: number;
}

export interface RouteRun {
  margins: StageMargin[];
  finished: boolean;
  gameOver: boolean;
  ticks: number;
  /** Incidenti (`crash`) e urti (`bump`) della corsa. */
  crashes: number;
  bumps: number;
  /** Tick chiusi fuori dall'asfalto (banchina o erba). */
  offRoadTicks: number;
}

export interface DriveOptions {
  dt?: number;
  maxTicks?: number;
  /**
   * Grafo da guidare: il vero di default. La misura dei tempi di guida del
   * pilota bravo passa un grafo con tempi larghissimi, così nessun game over
   * tronca la corsa e il tempo di ogni tappa si legge per intero.
   */
  graph?: StageGraph;
}

/** Un pilota: azioni dallo snapshot, con uno stato suo e il lato del bivio. */
export type Driver = (snapshot: RaceSnapshot, state: DriverState, side: 'L' | 'R') => Actions;

/**
 * Guida un percorso intero con il pilota prudente e riporta, per ogni tappa,
 * i secondi che restavano quando si è chiusa (spec §8, voce Taratura).
 * Il margine è `timeLeft` **all'inizio** del tick in cui la tappa finisce:
 * lo snapshot si prende prima di `update`, quindi è già quello giusto.
 */
export function driveRoute(route: readonly ('L' | 'R')[], options: DriveOptions = {}): RouteRun {
  return driveRouteWith(prudentActions, route, options);
}

/**
 * Come `driveRoute`, con il pilota dato: lo usa anche il pilota bravo di
 * `skilled-driver.ts`, così i due si misurano con la stessa corsa.
 */
export function driveRouteWith(
  driver: Driver,
  route: readonly ('L' | 'R')[],
  options: DriveOptions = {},
): RouteRun {
  const dt = options.dt ?? DRIVER_DT;
  const maxTicks = options.maxTicks ?? 40000;
  const engine = createFullRace({ graph: options.graph ?? REAL_GRAPH, assets: stubAssets(), skipCountdown: true });
  const state: DriverState = { shifted: false };
  const margins: StageMargin[] = [];
  let forks = 0;
  let finished = false;
  let gameOver = false;
  let ticks = 0;
  let crashes = 0;
  let bumps = 0;
  let offRoadTicks = 0;

  while (ticks < maxTicks) {
    ticks++;
    const snapshot = engine.snapshot();
    const before = { id: snapshot.stage.id, timeLeft: snapshot.timeLeft };
    // Lo snapshot è preso prima di `update`: la superficie è quella del tick prima.
    if (snapshot.player.surface !== 'road') offRoadTicks++;
    const side = route[forks] ?? 'R';
    const events = engine.update(dt, driver(snapshot, state, side));
    for (const ev of events) {
      if (ev.type === 'checkpoint') {
        margins.push({ id: before.id, level: levelOf(before.id), margin: before.timeLeft });
        forks++;
      } else if (ev.type === 'finish') {
        margins.push({ id: before.id, level: levelOf(before.id), margin: before.timeLeft });
        finished = true;
      } else if (ev.type === 'gameover') {
        margins.push({ id: before.id, level: levelOf(before.id), margin: 0 });
        gameOver = true;
      } else if (ev.type === 'crash') {
        crashes++;
      } else if (ev.type === 'bump') {
        bumps++;
      }
    }
    if (finished || gameOver) break;
  }
  return { margins, finished, gameOver, ticks, crashes, bumps, offRoadTicks };
}

/** I 16 percorsi completi del grafo, come liste di scelte. */
export function allRoutes(): ('L' | 'R')[][] {
  const routes: ('L' | 'R')[][] = [];
  for (let bits = 0; bits < 16; bits++) {
    routes.push([0, 1, 2, 3].map((i) => (((bits >> i) & 1) === 1 ? 'R' : 'L')));
  }
  return routes;
}
