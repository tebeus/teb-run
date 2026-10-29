import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import {
  CAMERA_HEIGHT,
  clamp,
  DRAW_DISTANCE,
  interpolate,
  LANES,
  percentInSegment,
  PLAYER_Z,
  projectPoint,
  ROAD_HALF,
  SEGMENT_LENGTH,
} from '../render/project';
import { CLOUD_DRIFT_PX_S, CLOUDS_TILE_W } from '../render/background';
import { needsTransition, TRANSITION_SECONDS } from '../render/palette';
import { shouldDrawSegment } from '../render/road';
import type {
  Actions,
  AssetStore,
  Banner,
  PlayerState,
  RaceEngine,
  RaceEvent,
  RaceSnapshot,
  Segment,
  StageDef,
  StageTransition,
  Vec3,
} from '../types';
import { applyCrash, noCrash, startCrash, stepCrash, type Crash } from './crash';
import { modeOf } from './mode';
import { initialPlayer, kmh, MAX_SPEED, stepPlayer } from './player';
import { checkpointBonus, finishBonus, overtakeScore, tickScore } from './score';
import { levelOf, type StageGraph } from './stage-graph';
import { gripFor } from './surface';
import {
  carryAfterCheckpoint,
  carryOver,
  CHECKPOINT_BANNER_S,
  expiredSpeed,
  graceOf,
  initialTimer,
  stepBannerClock,
  stepTimer,
  type TimerState,
} from './timer';
import {
  buildTrack,
  commitFork,
  findSegment,
  FORK_AFTER_COMMIT,
  FORK_COMMIT,
  FORK_EXIT_BASE_OFFSET,
  FORK_EXIT_SLOPE,
  FORK_ZONE_SEGMENTS,
  forkDrift,
  markForkExit,
  wrapZ,
  xLimitsOf,
} from './track';
import { checkCollisions, spawnTraffic, stepTraffic } from './traffic';
import { wallCollision } from './wall-hit';

export type Parallax = RaceSnapshot['parallax'];

/** Velocità dei due strati di parallasse (spec §4.4). */
export const PARALLAX_FAR_SPEED = 0.002;
export const PARALLAX_NEAR_SPEED = 0.005;
/** Velocità dello strato nuvole con la curvatura (spec §4.4c). */
export const PARALLAX_CLOUDS_SPEED = 0.001;
/** Deriva costante delle nuvole, in frazioni di striscia al secondo. */
export const CLOUD_DRIFT_PER_S = CLOUD_DRIFT_PX_S / CLOUDS_TILE_W;

/** Durata del conto alla rovescia di partenza, in secondi (spec §4.4e). */
export const COUNTDOWN_SECONDS = 3;
/** Secondi in cui la scritta GO resta a schermo dopo il via (spec §4.4e). */
export const GO_HOLD_S = 0.8;
/**
 * Valore di `countdown` a cui ogni fase del semaforo viene annunciata: la
 * prima rossa si accende subito, la seconda a 2 s, il verde a 1 s.
 */
export const COUNTDOWN_STEP_AT: readonly number[] = [COUNTDOWN_SECONDS, 2, 1];

/**
 * Scorrimento degli strati di sfondo. L'offset cresce con la curvatura del
 * segmento del giocatore moltiplicata per i segmenti percorsi nel passo;
 * `y` segue l'altezza della strada, in unità di cameraHeight e limitato a ±1.
 */
export function computeParallax(
  prev: Parallax,
  curve: number,
  speedPercent: number,
  dt: number,
  playerY = 0,
): Parallax {
  // A velocità massima si percorre un segmento per tick a 60 Hz.
  const segments = speedPercent * 60 * dt;
  const wrap01 = (v: number): number => v - Math.floor(v);
  // Positivo quando la telecamera sale: gli strati scendono verso l'orizzonte,
  // come un oggetto lontano a terra vero, spec 4.4.
  const y = clamp(playerY / CAMERA_HEIGHT, -1, 1);
  return {
    far: wrap01(prev.far + PARALLAX_FAR_SPEED * curve * segments),
    near: wrap01(prev.near + PARALLAX_NEAR_SPEED * curve * segments),
    clouds: wrap01((prev.clouds ?? 0) + PARALLAX_CLOUDS_SPEED * curve * segments + CLOUD_DRIFT_PER_S * dt),
    // Con playerY -0 il risultato sarebbe -0, che Object.is distingue da 0.
    y: y === 0 ? 0 : y,
  };
}

/**
 * Centro laterale della strada a z, in unità mondo, interpolato dentro il
 * segmento: `world.x` vale zero dappertutto tranne dopo il commit del bivio,
 * dove `commitFork` ci scrive la deriva del ramo scelto (bivio v3). La
 * telecamera lo segue, così `player.x` resta sempre relativa alla strada.
 */
export function roadCentreAt(segments: readonly Segment[], z: number): number {
  const wrapped = wrapZ(z, segments.length * SEGMENT_LENGTH);
  const seg = findSegment(segments, wrapped);
  return interpolate(seg.p1.world.x, seg.p2.world.x, percentInSegment(wrapped, SEGMENT_LENGTH));
}

/** Altezza della strada a z, interpolata dentro il segmento. */
export function playerHeightAt(segments: readonly Segment[], z: number): number {
  const wrapped = wrapZ(z, segments.length * SEGMENT_LENGTH);
  const seg = findSegment(segments, wrapped);
  return interpolate(seg.p1.world.y, seg.p2.world.y, percentInSegment(wrapped, SEGMENT_LENGTH));
}

/**
 * Proietta i `DRAW_DISTANCE` segmenti visibili e ritorna la fetta, dal più
 * vicino al più lontano (spec §4.3 e §4.4). Scrive `camera`, `screen` e `clip`
 * nei segmenti passati. La telecamera sta PLAYER_Z dietro al giocatore.
 */
export function updateVisible(
  segments: Segment[],
  player: PlayerState,
  width: number,
  height: number,
): Segment[] {
  const trackLength = segments.length * SEGMENT_LENGTH;
  const playerZ = wrapZ(player.z, trackLength);
  const position = wrapZ(playerZ - PLAYER_Z, trackLength);
  const base = findSegment(segments, position);
  const basePercent = percentInSegment(position, SEGMENT_LENGTH);
  const camX = player.x * ROAD_HALF + roadCentreAt(segments, playerZ);
  const camY = playerHeightAt(segments, playerZ) + CAMERA_HEIGHT;
  const cam: Vec3 = { x: camX, y: camY, z: position };

  const visible: Segment[] = [];
  let x = 0;
  let dx = -(base.curve * basePercent);
  let maxY = height;

  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const seg = segments[(base.index + n) % segments.length];
    // Segmento oltre la fine del tracciato: la telecamera è un giro più avanti.
    const looped = seg.index < base.index;
    cam.z = position - (looped ? trackLength : 0);
    cam.x = camX - x;
    projectPoint(seg.p1, cam, width, height);
    cam.x = camX - x - dx;
    projectPoint(seg.p2, cam, width, height);
    x += dx;
    dx += seg.curve;
    seg.clip = maxY;
    if (shouldDrawSegment(seg)) maxY = seg.p2.screen.y;
    visible.push(seg);
  }
  return visible;
}

/**
 * Motore minimo del binario A: una tappa che si ripete, fisica del giocatore,
 * telecamera e snapshot. Senza traffico, tempo e incidenti: i binari E e F
 * li aggiungono mantenendo questa firma.
 */
export function createRace(stage: StageDef, _assets: AssetStore): RaceEngine {
  const segments = buildTrack(stage);
  const trackLength = segments.length * SEGMENT_LENGTH;
  let player = initialPlayer();
  let parallax: Parallax = { far: 0, near: 0, y: 0 };
  let elapsed = 0;

  return {
    update(dt: number, actions: Actions): RaceEvent[] {
      elapsed += dt;
      const seg = findSegment(segments, player.z);
      const stepped = stepPlayer(
        player,
        actions,
        dt,
        seg.curve,
        false,
        seg.roadHalf,
        seg.median,
        seg.fork === 'zone',
        gripFor(seg, stage.weather),
      );
      player = { ...stepped, z: wrapZ(stepped.z, trackLength) };
      parallax = computeParallax(
        parallax,
        seg.curve,
        player.speed / MAX_SPEED,
        dt,
        playerHeightAt(segments, player.z),
      );
      return [];
    },
    snapshot(): RaceSnapshot {
      return {
        segments: updateVisible(segments, player, LOGICAL_W, LOGICAL_H),
        player,
        crash: { active: false, t: 0, frame: 0 },
        timeLeft: 99,
        score: 0,
        elapsed,
        stage,
        level: 0,
        route: [],
        parallax,
        theme: stage.theme,
        banner: 'none',
        kmh: kmh(player.speed),
      };
    },
  };
}

/**
 * Lato scelto al bivio dal segno di `player.x` all'ultimo segmento (spec §9).
 * x esattamente 0 conta come destra: il segno di 0 non esiste, e servirebbe
 * comunque una scelta. Pura.
 */
export function forkSide(x: number): 'L' | 'R' {
  return x < 0 ? 'L' : 'R';
}

/**
 * Segmenti prima della zona di bivio in cui si vede il cartello
 * `CHOOSE YOUR ROAD` (spec prima tappa e ritorno §4): circa 5 s a tutta
 * velocità. Il banner del bivio arriva solo all'ingresso della zona, e il
 * commit 30 segmenti dopo (circa mezzo secondo): senza preavviso chi stava al
 * centro o a destra finiva a destra senza aver letto niente.
 */
export const FORK_AHEAD_SEGMENTS = 300;
/** Secondi di `LEFT: <tappa>` o `RIGHT: <tappa>` dopo il commit del bivio (§4). */
export const FORK_TAKEN_S = 1.5;

/**
 * Banner corrente, in ordine di priorità: game over, checkpoint, bivio,
 * cartello prima del bivio (spec §8, §11; spec prima tappa e ritorno §4).
 * Pura.
 */
export function currentBanner(state: {
  expired: boolean;
  checkpointLeft: number;
  inForkZone: boolean;
  forkAhead?: boolean;
}): Banner {
  if (state.expired) return 'gameover';
  if (state.checkpointLeft > 0) return 'checkpoint';
  if (state.inForkZone) return 'fork';
  return state.forkAhead === true ? 'forkAhead' : 'none';
}

export interface FullRaceOptions {
  graph: StageGraph;
  /**
   * Non letto da questo motore: qui solo per tenere la firma allineata a
   * `raceFactory(stage, assets)` (spec §"screen deps"), così D può passare
   * lo stesso `AssetStore` a `createRace` e `createFullRace` senza un caso
   * speciale. Riservato a usi futuri (es. audio posizionale dai veicoli).
   */
  assets: AssetStore;
  /** Tappa di partenza; senza questa si parte da `graph.first()`. */
  startStage?: StageDef;
  /**
   * Salta il conto alla rovescia di partenza (spec §4.4e). Lo passano solo
   * i test di taratura, che misurano tempi di percorrenza sui 16 percorsi
   * e non devono pagare tre secondi per tappa. Il gioco vero non lo passa
   * mai.
   */
  skipCountdown?: boolean;
}

/**
 * Motore di gara completo: fisica, traffico, incidenti, tempo, punteggio,
 * bivi e giunzione fra tappe (spec §6, §7, §8, §9).
 *
 * Ordine di un tick, che è anche l'ordine in cui gli eventi escono:
 * tempo → fisica o incidente → fine tappa (checkpoint o finale) → ingresso
 * nella zona di bivio → traffico e sorpassi → collisioni → punteggio,
 * parallasse, banner → game over. Più eventi nello stesso tick sono normali,
 * per esempio un sorpasso e un urto.
 */
export function createFullRace(opts: FullRaceOptions): RaceEngine {
  const { graph } = opts;
  let stage: StageDef = opts.startStage ?? graph.first();
  let segments: Segment[] = buildTrack(stage);
  let cars = spawnTraffic(segments, stage);
  let player: PlayerState = initialPlayer();
  let parallax: Parallax = { far: 0, near: 0, y: 0 };
  let timer: TimerState = initialTimer(stage.timeLimit);
  let crash: Crash = noCrash();
  let score = 0;
  let elapsed = 0;
  let level = levelOf(stage.id);
  let checkpointLeft = 0;
  // Secondi che l'ultimo checkpoint ha aggiunto: serve al banner di
  // spec §4.4e, non alla fisica.
  let extendTime = 0;
  let forkNames: [string, string] | undefined;
  let forkFired = false;
  // Le due tappe per il cartello prima del bivio, calcolate una volta per
  // tappa (`undefined` = non ancora, `null` = ultima tappa, niente bivio).
  let aheadNames: [string, string] | null | undefined;
  // Secondi che restano al `LEFT:`/`RIGHT:` dopo il commit (§4).
  let forkTakenLeft = 0;
  // Lato deciso al commit del bivio (bivio v3), `null` finché non c'è.
  let forkCommit: -1 | 1 | null = null;
  let expiredFromSpeed = 0;
  let switched = false;
  let done = false;
  // null = niente conto alla rovescia (già partiti, o saltato dai test).
  let countdown: number | null = opts.skipCountdown === true ? null : COUNTDOWN_SECONDS;
  // Ultima fase del semaforo già annunciata: -1 = nessuna.
  let countdownStepSeen = -1;
  let transition: StageTransition | null = null;
  // Id dell'ultimo veicolo tamponato: fermo anti-doppio-urto (issue #1 della
  // revisione E). Il pushback di checkCollisions è di un solo segmento, non
  // sempre abbastanza a evitare che il giocatore rientri nella stessa auto al
  // tick successivo; senza fermo quel rientro produce un secondo `bump` sullo
  // stesso urto fisico. Si azzera quando l'auto non è più nel segmento del
  // giocatore, così un urto successivo con la stessa auto (un altro giro,
  // un'altra corsia) torna a contare.
  let bumpedCarId: number | undefined;
  const route: ('L' | 'R')[] = [];

  const stageLength = (): number => segments.length * SEGMENT_LENGTH;
  const forkZoneZ = (): number => (segments.length - FORK_ZONE_SEGMENTS) * SEGMENT_LENGTH;
  const forkCommitZ = (): number => forkZoneZ() + FORK_COMMIT * SEGMENT_LENGTH;
  const hasForkZone = (): boolean => segments[segments.length - FORK_ZONE_SEGMENTS]?.fork === 'zone';
  /**
   * Negli ultimi `FORK_AHEAD_SEGMENTS` segmenti prima della zona di bivio,
   * mai nella prima metà della strada prima della zona: in una tappa corta
   * (quelle dei test) il cartello non deve partire già al via.
   */
  const inForkAhead = (): boolean =>
    hasForkZone() &&
    player.z < forkZoneZ() &&
    player.z >= Math.max(forkZoneZ() - FORK_AHEAD_SEGMENTS * SEGMENT_LENGTH, forkZoneZ() / 2);

  /**
   * Commit del bivio (bivio v3, spec §4.4): il lato si fissa dal segno di
   * `x` (destra se zero, come `forkSide`), il resto della zona diventa la
   * strada scelta che curva verso il suo lato più la scartata che si
   * allontana (`commitFork`), e `x` si sposta sul centro della strada scelta
   * senza che niente a schermo si muova. Poi l'inizio della tappa vecchia,
   * che la telecamera vede oltre la fine della zona, diventa l'anteprima
   * dell'uscita: la stessa strada scartata e la stessa deriva.
   */
  const commit = (): void => {
    const side: -1 | 1 = player.x < 0 ? -1 : 1;
    const base = stage.roadHalf ?? 1;
    const next = graph.next(stage, side < 0 ? 'L' : 'R');
    const shift = commitFork(segments, side, base, next?.roadHalf ?? base);
    player = { ...player, x: player.x + shift };
    if (crash.state.active) crash = { ...crash, startX: crash.startX + shift };
    const last = segments[segments.length - 1].discarded;
    if (last !== undefined) {
      const preview = Math.min(DRAW_DISTANCE, segments.length - FORK_ZONE_SEGMENTS);
      markForkExit(segments, side, Math.abs(last.far), Math.abs(last.far - last.near), base, preview);
      const drift = side * forkDrift(FORK_AFTER_COMMIT, base) * ROAD_HALF;
      for (let i = 0; i < preview; i++) {
        segments[i].p1.world.x = drift;
        segments[i].p2.world.x = drift;
      }
    }
    forkCommit = side;
    forkTakenLeft = FORK_TAKEN_S;
  };

  /** Le due tappe del bivio, o null se questa è l'ultima del percorso. */
  const successors = (): { left: StageDef; right: StageDef } | null => {
    const left = graph.next(stage, 'L');
    const right = graph.next(stage, 'R');
    return left !== null && right !== null ? { left, right } : null;
  };

  /**
   * Giunzione fra tappe (spec §9, §4.4 «Uscita dal bivio»): nuovo array di
   * segmenti, traffico rigenerato, z azzerata a meno dell'avanzo del tick,
   * velocità intatta. `x` resta com'è: dal commit alla punta (bivio v3) è già
   * relativa alla strada scelta. I primi `FORK_EXIT_SEGMENTS` della tappa
   * nuova sono marcati `forkExit` e `discarded` (`markForkExit`) con la
   * strada scartata che riparte da dove l'ultimo segmento della tappa
   * vecchia l'ha lasciata, letto **prima** di sovrascrivere `segments`.
   */
  const switchStage = (next: StageDef, side: 'L' | 'R', overshoot: number): void => {
    switched = true;
    route.push(side);
    // Transizione fra temi diversi, oppure fra due tappe dello stesso
    // tema con cieli diversi (spec §4.4d, deroga 13 del binario K):
    // senza, passando da Red Canyon a Salt Flats il cielo salterebbe in
    // un fotogramma. `fromId` porta l'id della tappa che si lascia, così
    // il renderer sa quale scostamento di palette interpolare.
    transition = needsTransition(stage.id, stage.theme, next.id, next.theme)
      ? { from: stage.theme, to: next.theme, t: 0, fromId: stage.id }
      : null;
    const lastOfOld = segments[segments.length - 1];
    const oldBase = stage.roadHalf ?? 1;
    const forkSideNum: -1 | 1 = side === 'L' ? -1 : 1;
    // Dopo il commit (bivio v3) `x` è già relativa alla strada scelta, che è
    // la sola strada dell'ultimo segmento: niente da ricentrare. Senza
    // commit (una zona saltata in un tick solo non esiste, ma la giunzione
    // non deve dipenderne) vale la ricentratura sulla carreggiata.
    const recenteredX =
      forkCommit !== null ? player.x : player.x - (forkSideNum * (lastOfOld.median + lastOfOld.roadHalf)) / 2;
    // L'uscita comincia esattamente dove la zona ha lasciato la strada
    // scartata: stesso offset, stessa pendenza, stessa larghezza.
    const d = lastOfOld.discarded;
    const start = d !== undefined ? Math.abs(d.far) : FORK_EXIT_BASE_OFFSET;
    const slope = d !== undefined ? Math.abs(d.far - d.near) : FORK_EXIT_SLOPE;
    stage = next;
    level = levelOf(next.id);
    segments = buildTrack(next);
    markForkExit(segments, forkSideNum, start, slope, oldBase);
    forkCommit = null;
    cars = spawnTraffic(segments, next);
    player = { ...player, z: overshoot, x: recenteredX };
    forkNames = undefined;
    forkFired = false;
    aheadNames = undefined;
    forkTakenLeft = 0;
    // issue #7 della revisione E: un incidente ancora attivo alla fine della
    // tappa proseguirebbe la rotazione sul rettilineo di partenza della
    // tappa successiva. La barriera di bordo tappa e la durata di un crash
    // (~15 segmenti) lo rendono raggiungibile; qui si azzera.
    crash = noCrash();
    // I nuovi veicoli di `next` ripartono gli id da 0 (spawnTraffic): un
    // fermo dell'auto precedente punterebbe a un'auto diversa.
    bumpedCarId = undefined;
  };

  return {
    update(dt: number, actions: Actions): RaceEvent[] {
      // Partita finita: niente cresce più, nemmeno il cronometro dell'HUD
      // (minore 6, `elapsed` incrementava ancora dopo il game over/finale).
      if (done) return [];

      const events: RaceEvent[] = [];

      if (countdown !== null) {
        countdown -= dt;
        // Un tick grosso (fino a 0,25 s da core/loop, di più nei test)
        // può attraversare più di una fase: ognuna esce una volta sola e
        // in ordine (spec §4.4e).
        while (countdownStepSeen < 2 && countdown <= COUNTDOWN_STEP_AT[countdownStepSeen + 1]) {
          countdownStepSeen += 1;
          events.push({ type: 'countdown', step: countdownStepSeen as 0 | 1 | 2 });
        }
        if (countdown <= -GO_HOLD_S) countdown = null;
        // Mondo fermo finché il verde non è dato: il `return` anticipato
        // sta prima di `elapsed`, del passo del tempo e del traffico. Il
        // tick in cui il conto attraversa lo zero fa girare il mondo per
        // tutto il suo dt: al massimo 1/60 di secondo regalato, invisibile.
        //
        // Sta **prima** del blocco `transition` di proposito: durante
        // l'attesa il paesaggio non deve cambiare, e alla prima tappa non
        // c'è nessuna transizione in corso.
        //
        // **Effetto collaterale, dichiarato:** questo `return` scarta
        // *tutte* le azioni del tick, `gearToggle` compreso. Chi pilota il
        // gioco dall'esterno (l'autopilota dell'e2e del checkpoint, task
        // 13) deve innestare la marcia alta **dopo** il via, non prima:
        // una cambiata mandata nei tre secondi di attesa si perde e l'auto
        // resta in marcia bassa a 161 km/h.
        if (countdown !== null && countdown > 0) return events;
      }

      elapsed += dt;
      if (transition !== null) {
        const t = transition.t + dt;
        transition = t >= TRANSITION_SECONDS ? null : { from: transition.from, to: transition.to, t, fromId: transition.fromId };
      }
      const prevZ = player.z;
      switched = false;
      // Se la tappa finisce in questo tick, vince lei: il game over pendente
      // dello stesso tick va scartato (spec §9, brief §"più eventi in un tick").
      let stageEnded = false;

      const tick = stepTimer(timer, dt);
      const justExpired = timer.expired === null && tick.state.expired !== null;
      timer = tick.state;
      if (justExpired) expiredFromSpeed = player.speed;

      const seg = findSegment(segments, player.z);
      const limits = xLimitsOf(seg);
      player = stepPlayer(
        player,
        actions,
        dt,
        seg.curve,
        crash.state.active,
        seg.roadHalf,
        seg.median,
        seg.fork === 'zone',
        // L'aderenza del segmento sotto le ruote, con il meteo della
        // tappa corrente (spec §4.4f): `stage` è già aggiornata quando
        // `switchStage` è passata, e `seg` viene dall'array nuovo.
        gripFor(seg, stage.weather),
        limits.min,
        limits.max,
      );
      if (crash.state.active) {
        crash = stepCrash(crash, dt);
        player = applyCrash(crash, player, seg.roadHalf, seg.median);
      } else if (timer.expired !== null) {
        player = { ...player, speed: expiredSpeed(expiredFromSpeed, timer.expired) };
      }

      if (forkCommit === null && hasForkZone() && player.z >= forkCommitZ()) commit();

      if (player.z >= stageLength()) {
        const overshoot = player.z - stageLength();
        // Dopo il commit il lato è quello deciso lì: `x` ora è relativa alla
        // strada scelta, e il suo segno non dice più niente.
        const side = forkCommit !== null ? (forkCommit < 0 ? 'L' : 'R') : forkSide(player.x);
        const next = graph.next(stage, side);
        if (next === null) {
          score += finishBonus(timer.left);
          done = true;
          events.push({ type: 'finish', ending: graph.endingOf(stage), score: Math.round(score) });
          return events;
        }
        // La grazia della tappa (la 0-0 di NORMAL) non si riporta e non
        // fa bonus: chi guida bene arriva alla 1-0 come al lancio.
        const carried = carryAfterCheckpoint(timer.left, graceOf(stage));
        const bonus = checkpointBonus(carried);
        score += bonus;
        extendTime = next.timeLimit;
        timer = { left: carryOver(carried, next.timeLimit), expired: null };
        checkpointLeft = CHECKPOINT_BANNER_S;
        switchStage(next, side, overshoot);
        stageEnded = true;
        events.push({ type: 'checkpoint', bonus, nextStage: next });
      }

      if (!forkFired && player.z >= forkZoneZ()) {
        const both = successors();
        if (both !== null) {
          forkFired = true;
          forkNames = [both.left.name, both.right.name];
          events.push({ type: 'fork', left: both.left, right: both.right });
        }
      }

      // Dopo un cambio tappa non ci sono sorpassi: il traffico è nuovo.
      const overtakes = stepTraffic(
        segments,
        cars,
        dt,
        player.z,
        switched ? player.z : prevZ,
        stage.lanes ?? LANES,
      );
      for (let i = 0; i < overtakes; i++) events.push({ type: 'overtake' });
      score += overtakeScore(overtakes);

      if (!crash.state.active) {
        const collideSeg = findSegment(segments, player.z);
        // Il fermo vale solo mentre l'auto tamponata è ancora nel segmento
        // del giocatore: appena esce (sorpassata, cambiata corsia, o il
        // giocatore è ripartito altrove) un nuovo urto con essa è di nuovo
        // un urto vero (issue #1 della revisione E).
        if (bumpedCarId !== undefined && !collideSeg.cars.some((c) => c.id === bumpedCarId)) {
          bumpedCarId = undefined;
        }
        const carOrSprite = checkCollisions(player, collideSeg, bumpedCarId);
        // La parete si controlla solo se non c'è già un urto: un veicolo
        // davanti vince, è più vicino di un muro laterale.
        const hit =
          carOrSprite.kind === 'none' ? (wallCollision(player, collideSeg) ?? carOrSprite) : carOrSprite;
        if (hit.kind === 'crash') {
          crash = startCrash(player, hit.side, modeOf(stage));
          events.push({ type: 'crash' });
        } else if (hit.kind === 'bump') {
          bumpedCarId = hit.carId;
          player = { ...player, speed: hit.speed, z: Math.max(0, hit.z) };
          events.push({ type: 'bump' });
        } else if (hit.kind === 'stop') {
          player = { ...player, speed: hit.speed, x: hit.x };
        }
      }

      score += tickScore(player.speed / MAX_SPEED, dt, level);
      parallax = computeParallax(
        parallax,
        seg.curve,
        player.speed / MAX_SPEED,
        dt,
        playerHeightAt(segments, player.z),
      );
      checkpointLeft = stepBannerClock(checkpointLeft, dt);
      forkTakenLeft = stepBannerClock(forkTakenLeft, dt);

      // Deviazione dal piano, dichiarata qui (issue #3 della revisione E):
      // la spec §8 manda in game over non appena l'orologio scende sotto
      // zero, senza eccezioni. `stageEnded` in più concede una finestra di
      // grazia fino a ~60 segmenti (i 2 s di decelerazione): chi passa il
      // traguardo entro quella finestra prende il checkpoint invece del
      // game over. La ragione è che un checkpoint e una transizione a game
      // over nello stesso tick sarebbero incoerenti (lo schermo di D adotta
      // la prima transizione), e fra le due la fine tappa deve vincere;
      // l'alternativa sarebbe far vincere sempre l'orologio, perdendo la
      // tappa completata un istante prima dello zero.
      if (tick.gameOver && !stageEnded) {
        done = true;
        events.push({ type: 'gameover', score: Math.round(score), stage });
      }
      return events;
    },
    snapshot(): RaceSnapshot {
      const ahead = !forkFired && inForkAhead();
      if (ahead && aheadNames === undefined) {
        const both = successors();
        aheadNames = both === null ? null : [both.left.name, both.right.name];
      }
      const banner = currentBanner({
        expired: timer.expired !== null,
        checkpointLeft,
        inForkZone: forkFired && player.z >= forkZoneZ(),
        forkAhead: ahead && aheadNames !== null,
      });
      const names = banner === 'fork' ? forkNames : banner === 'forkAhead' ? (aheadNames ?? undefined) : undefined;
      const taken = banner === 'fork' && forkTakenLeft > 0 && forkCommit !== null ? (forkCommit < 0 ? 'L' : 'R') : undefined;
      return {
        segments: updateVisible(segments, player, LOGICAL_W, LOGICAL_H),
        player,
        crash: crash.state,
        timeLeft: timer.left,
        score: Math.round(score),
        elapsed,
        countdown: countdown ?? undefined,
        extendTime: banner === 'checkpoint' ? extendTime : undefined,
        stage,
        level,
        route,
        parallax,
        theme: stage.theme,
        transition: transition ?? undefined,
        banner,
        forkNames: names,
        ...(taken === undefined ? {} : { forkTaken: taken }),
        kmh: kmh(player.speed),
      };
    },
  };
}
