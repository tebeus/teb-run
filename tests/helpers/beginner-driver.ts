import { mulberry32 } from '../../src/core/rng';
import { createFullRace } from '../../src/game/race';
import { REAL_GRAPH } from '../../src/game/stages';
import type { StageGraph } from '../../src/game/stage-graph';
import { buildTrack } from '../../src/game/track';
import { SEGMENT_LENGTH } from '../../src/render/project';
import type { Gear, RaceSnapshot } from '../../src/types';
import { centresOf, forkTargetX, stubAssets, targetLane } from './prudent-driver';
import { acts } from './race-script';

/**
 * Pilota **principiante** (brief prima tappa e ritorno, spec §1.2): chi apre
 * il gioco per la prima volta e non sa del cambio.
 *
 * - **gas sempre premuto**, mai il freno, **mai il cambio**: resta in `lo`;
 * - lo sterzo legge la distanza dal bersaglio di `lag` secondi prima (il
 *   ritardo di chi reagisce a quello che vede) e ignora gli scarti sotto
 *   `dead` (la zona morta di chi corregge a colpi);
 * - il bersaglio è il centro di una corsia, ricalcolato ogni mezzo secondo
 *   con un errore preso da `mulberry32(seed)`: deterministico;
 * - il profilo `late` cambia corsia quando vede un veicolo più lento, e lo
 *   fa in ritardo: qualche urto col traffico;
 * - nella zona di bivio va a destra, come quasi tutti i giocatori veri
 *   (statistiche del sito, ottobre).
 *
 * Il passo è 1/60 s, la frequenza di gioco: la taratura della prima tappa si
 * gioca su pochi secondi, e un passo più grosso sarebbe più generoso.
 */
export const BEGINNER_DT = 1 / 60;
/** Ogni quanti secondi il principiante sceglie di nuovo dove andare. */
export const RETARGET_S = 0.5;

export type BeginnerProfileName = 'gas' | 'careful' | 'late' | 'precise';

export interface BeginnerProfile {
  /** Sterza? `false` = solo gas, come la prova dal vivo del brief. */
  steers: boolean;
  /** Secondi di ritardo dello sterzo. */
  lag: number;
  /** Zona morta dello sterzo. */
  dead: number;
  /** Ampiezza dell'errore sul bersaglio (±metà). */
  noise: number;
  /** Cambia corsia davanti a un veicolo più lento. */
  dodges: boolean;
}

/** I quattro principianti della spec §1.2. */
export const BEGINNERS: Readonly<Record<BeginnerProfileName, BeginnerProfile>> = {
  gas: { steers: false, lag: 0, dead: 0, noise: 0, dodges: false },
  careful: { steers: true, lag: 0.3, dead: 0.15, noise: 0.3, dodges: false },
  late: { steers: true, lag: 0.4, dead: 0.15, noise: 0.3, dodges: true },
  precise: { steers: true, lag: 0.15, dead: 0.05, noise: 0, dodges: true },
};

export interface BeginnerRun {
  /** Tappa dove la corsa è finita (game over, arrivo o `maxSeconds`). */
  stageId: string;
  /** Frazione della tappa percorsa quando la corsa è finita, 0..1. */
  progress: number;
  gameOver: boolean;
  finished: boolean;
  /** Secondi di gara (`snapshot.elapsed`). */
  elapsed: number;
  /** Secondi di gara al primo checkpoint, o `null`. */
  firstCheckpointAt: number | null;
  /** Tempo che restava al primo checkpoint, o `null`. */
  firstCheckpointLeft: number | null;
  checkpoints: number;
  crashes: number;
  bumps: number;
  score: number;
  /** Marcia a fine corsa: per il principiante è sempre `lo`. */
  gear: Gear;
  /** Se ha mai messo la marcia alta: mai. */
  everHigh: boolean;
}

export interface BeginnerOptions {
  seed?: number;
  graph?: StageGraph;
  /** Tetto di sicurezza, in secondi di gara. */
  maxSeconds?: number;
}

/** Guida una partita intera col principiante `profile`, fino al game over. */
export function driveBeginner(profile: BeginnerProfile, options: BeginnerOptions = {}): BeginnerRun {
  const dt = BEGINNER_DT;
  const rnd = mulberry32(options.seed ?? 1);
  const engine = createFullRace({ graph: options.graph ?? REAL_GRAPH, assets: stubAssets(), skipCountdown: true });
  const lagTicks = Math.round(profile.lag / dt);
  const retarget = Math.round(RETARGET_S / dt);
  const errors: number[] = [];
  let target = 0;
  let firstCheckpointAt: number | null = null;
  let firstCheckpointLeft: number | null = null;
  let checkpoints = 0;
  let crashes = 0;
  let bumps = 0;
  let score = 0;
  let gameOver = false;
  let finished = false;
  let everHigh = false;
  let last: RaceSnapshot = engine.snapshot();
  const maxTicks = Math.round((options.maxSeconds ?? 900) / dt);

  for (let tick = 0; tick < maxTicks; tick++) {
    const s = engine.snapshot();
    last = s;
    if (s.player.gear === 'hi') everHigh = true;
    if (tick % retarget === 0) {
      const centres = centresOf(s);
      const lane = profile.dodges ? targetLane(s, s.player.speed) : Math.floor(centres.length / 2);
      target = centres[lane] + (rnd.next() - 0.5) * profile.noise;
    }
    const aim = s.banner === 'fork' ? forkTargetX(s, 'R') : target;
    errors.push(aim - s.player.x);
    const dx = errors[Math.max(0, errors.length - 1 - lagTicks)];
    const events = engine.update(
      dt,
      acts({
        accelerate: true,
        left: profile.steers && dx < -profile.dead,
        right: profile.steers && dx > profile.dead,
      }),
    );
    for (const ev of events) {
      if (ev.type === 'crash') crashes++;
      else if (ev.type === 'bump') bumps++;
      else if (ev.type === 'checkpoint') {
        checkpoints++;
        if (firstCheckpointAt === null) {
          firstCheckpointAt = engine.snapshot().elapsed ?? 0;
          firstCheckpointLeft = s.timeLeft;
        }
      } else if (ev.type === 'gameover') {
        gameOver = true;
        score = ev.score;
      } else if (ev.type === 'finish') {
        finished = true;
        score = ev.score;
      }
    }
    if (gameOver || finished) break;
  }
  const end = gameOver || finished ? last : engine.snapshot();
  const length = buildTrack(end.stage).length * SEGMENT_LENGTH;
  return {
    stageId: end.stage.id,
    progress: Math.min(1, end.player.z / length),
    gameOver,
    finished,
    elapsed: engine.snapshot().elapsed ?? 0,
    firstCheckpointAt,
    firstCheckpointLeft,
    checkpoints,
    crashes,
    bumps,
    score,
    gear: end.player.gear,
    everHigh,
  };
}

/** Il grafo `graph` con la 0-0 di NORMAL com'era al lancio: 80 s, senza secondi in più. */
export function launchGraph(graph: StageGraph = REAL_GRAPH): StageGraph {
  return {
    ...graph,
    first: () => {
      const { extraTime: _, ...stage } = graph.first();
      return { ...stage, timeLimit: 80 };
    },
  };
}

/**
 * Il grafo `graph` con la 0-0 a 110 s e `carried` dei 30 s in più
 * riportabili (`FIRST_STAGE_EXTRA_CARRY_S` = `carried`): per misurare le
 * varianti senza toccare la costante. 30 = tutti, 0 = nessuno.
 */
export function extraCarryGraph(carried: number, graph: StageGraph = REAL_GRAPH): StageGraph {
  return {
    ...graph,
    first: () => {
      const stage = graph.first();
      return { ...stage, extraTime: { seconds: 30, carried } };
    },
  };
}
