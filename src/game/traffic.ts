import { CATALOG } from '../art/catalog';
import { mulberry32, type Rng } from '../core/rng';
import { DRAW_DISTANCE, LANES, PLAYER_Z, SEGMENT_LENGTH } from '../render/project';
import type { Car, Difficulty, PlayerState, Segment, SpriteName, StageDef, ThemeId } from '../types';
import { modeOf, TRAFFIC_COUNT_FACTOR, TRAFFIC_SPEED_FACTOR } from './mode';
import { MAX_SPEED } from './player';
import { FORK_ZONE_SEGMENTS, laneToRoad, spriteOffsetOf, TRAFFIC_FREE_START, wrapZ } from './track';

/** Centri delle tre e delle quattro corsie (spec §9). */
const LANE_CENTRES_3: readonly number[] = [-0.66, 0, 0.66];
const LANE_CENTRES_4: readonly number[] = [-0.75, -0.25, 0.25, 0.75];

/** Centri delle quattro corsie, in unità di offset (spec §6). */
export const LANES_X: readonly number[] = LANE_CENTRES_4;
/** Rumore massimo aggiunto al centro della corsia (spec §6). */
export const LANE_NOISE = 0.1;

/**
 * Centri delle corsie di una tappa (spec §9). Un numero di corsie che non
 * conosce ricade su quattro: `LANES_X` resta il default del gioco, non
 * l'unico valore possibile. Pura.
 */
export function laneCentres(lanes: number): readonly number[] {
  return lanes === 3 ? LANE_CENTRES_3 : LANE_CENTRES_4;
}

/**
 * Rumore massimo per un veicolo su una strada di `roadHalf` semilarghezze e
 * `lanes` corsie. `LANE_NOISE` da solo è troppo per i veicoli larghi: la
 * semilarghezza a schermo di uno sprite, in unità di offset, è esattamente la
 * sua `scale`, quindi un autobus (0.2) nella corsia esterna a 4 corsie
 * arrivava a 0,75 + 0,1 + 0,2 = 1,05, cioè sporgeva di 0,05 **sul cordolo**;
 * e due autobus in corsie adiacenti con rumore opposto restavano a 0,3 di
 * distanza contro i 0,4 delle loro sagome, quindi si sovrapponevano a
 * schermo. Qui il rumore si stringe al minimo fra i due vincoli. Pura.
 */
export function laneNoiseFor(name: SpriteName, lanes: number = LANES, roadHalf = 1): number {
  if (!(roadHalf > 0)) return 0;
  const centres = laneCentres(lanes);
  /** Semilarghezza della sagoma in unità di offset di corsia. */
  const half = (CATALOG[name]?.scale ?? 0) / roadHalf;
  let outer = 0;
  for (const c of centres) outer = Math.max(outer, Math.abs(c));
  /** Quanto resta fra la corsia esterna e il cordolo. */
  const edge = 1 - half - outer;
  /** Metà dello spazio libero fra due sagome in corsie adiacenti. */
  const step = centres.length > 1 ? Math.abs(centres[1] - centres[0]) : 2;
  const gap = (step - 2 * half) / 2;
  return Math.max(0, Math.min(LANE_NOISE, edge, gap));
}

/**
 * Frazione di MAX_SPEED per tipo di veicolo (spec §6). `traffic_truck` non
 * ha una voce qui: resta nel catalogo (i test di copertura lo vogliono) ma
 * non si genera più, perché lo sprite consegnato è deformato (addendum del
 * collaudo). Le quattro sportive extra del Set 6, anticipate dal binario I,
 * sono in coda.
 */
export const TRAFFIC_SPEEDS: Readonly<Record<SpriteName, number>> = {
  traffic_van: 0.3,
  traffic_sedan: 0.4,
  traffic_hatchback: 0.35,
  traffic_bike: 0.55,
  traffic_coupe: 0.45,
  traffic_offroad: 0.35,
  traffic_sportscar: 0.5,
  traffic_bus: 0.25,
  traffic_pickup: 0.38,
  traffic_supercar: 0.55,
  traffic_roadster: 0.45,
  traffic_muscle: 0.5,
  traffic_rally: 0.48,
};

/**
 * Ordine fisso: lo spawn deve essere deterministico dal seme, non dall'ordine
 * delle chiavi. `traffic_truck` non c'è più (sprite deformato, addendum del
 * collaudo): resta nel catalogo, ma non viene mai scelto qui.
 */
export const TRAFFIC_NAMES: readonly SpriteName[] = [
  'traffic_van',
  'traffic_sedan',
  'traffic_hatchback',
  'traffic_bike',
  'traffic_coupe',
  'traffic_offroad',
  'traffic_sportscar',
  'traffic_bus',
  'traffic_pickup',
  'traffic_supercar',
  'traffic_roadster',
  'traffic_muscle',
  'traffic_rally',
];

/** Scarto massimo sulla velocità del tipo (spec §6). */
export const SPEED_JITTER = 0.1;
/** Quanti segmenti avanti guarda un veicolo prima di cambiare corsia (spec §6). */
export const LOOKAHEAD_SEGMENTS = 20;
/** Passo del cambio corsia, in unità di offset al secondo (spec §6). */
export const LANE_CHANGE_RATE = 0.5;
/** Larghezza di collisione del giocatore: la stessa della berlina, 0.3 (spec §6). */
export const PLAYER_COLLIDE_W = CATALOG.traffic_sedan.collideW;
/** Soglie di crash contro un veicolo (spec §6). */
export const CAR_CRASH_SPEED_RATIO = 1.3;
export const CAR_CRASH_MIN_PERCENT = 0.4;
/** Soglia di crash contro un oggetto solido (spec §6). */
export const SCENERY_CRASH_MIN_PERCENT = 0.15;
/** Frazione della velocità del veicolo urtato che resta dopo un urto leggero (spec §6). */
export const BUMP_SPEED_FACTOR = 0.8;
/** Sale del seme: il traffico non deve consumare l'rng del tracciato. */
export const TRAFFIC_SEED_SALT = 0x9e3779b9;

/**
 * Segmenti liberi da traffico, ri-esportati da `track.ts` dove il valore è
 * definito una volta sola come `max(3 * INTRO_SEGMENTS, FORK_EXIT_SEGMENTS)`
 * = 180. Qui resta visibile perché `trafficSpan` e `spawnTraffic` lo usano e
 * perché i test del traffico lo importano da questo modulo.
 */
export { TRAFFIC_FREE_START };

/** Frazione iniziale della zona di spawn a densità dimezzata. */
export const EASY_START_FRACTION = 0.25;
/** Densità in quella frazione, rispetto al resto. */
export const EASY_START_DENSITY = 0.5;

/**
 * Ridistribuzione delle posizioni di spawn: `u` è la frazione di veicoli già
 * piazzati (0..1) e il ritorno è la frazione della zona di spawn dove va il
 * prossimo. Nel primo `EASY_START_FRACTION` della zona la densità è
 * `EASY_START_DENSITY` di quella del resto, quindi la funzione lì cresce più
 * in fretta; oltre, la pendenza è costante. È l'inversa della cumulata di
 * quella densità, quindi è continua, crescente, e manda 0 in 0 e 1 in 1: il
 * numero totale di veicoli non cambia, cambia solo dove stanno. Pura.
 *
 * Deroga alla spec §6, che chiede una distribuzione uniforme.
 */
export function spawnCurve(u: number): number {
  const q = EASY_START_FRACTION;
  const d = EASY_START_DENSITY;
  // Massa totale della densità: d sul primo tratto, 1 sul resto.
  const mass = d * q + (1 - q);
  const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
  // Frazione dei veicoli che finisce nel primo tratto.
  const uKnee = (d * q) / mass;
  if (clamped <= uKnee) return (clamped * mass) / d;
  return q + clamped * mass - d * q;
}

/**
 * Lunghezza di tappa su cui è stata tarata la formula di spec §6, in
 * segmenti: 2200 + 400 · difficoltà, prima che le tappe si allungassero due
 * volte (fino a 3170 + 576 · difficoltà) a parità di veicoli.
 */
export const TRAFFIC_REFERENCE_BASE = 2200;
export const TRAFFIC_REFERENCE_PER_DIFFICULTY = 400;

/** Lunghezza di riferimento per la difficoltà data. Pura. */
export function trafficReferenceLength(difficulty: number): number {
  return TRAFFIC_REFERENCE_BASE + TRAFFIC_REFERENCE_PER_DIFFICULTY * difficulty;
}

/**
 * Veicoli di una tappa (spec §6): 20 + 60 · difficoltà su una tappa lunga
 * quanto il riferimento, in proporzione alla lunghezza vera, per il fattore
 * della modalità. **Deroga (collaudo utente: due livelli di difficoltà)**:
 * la formula di spec §6 non guardava la lunghezza, e con le tappe
 * allungate del ~44 % la densità per segmento era scesa di altrettanto;
 * così la densità resta quella tarata qualunque sia la lunghezza. Senza
 * lunghezza vale quella di riferimento, cioè la formula di spec §6. Pura.
 */
export function carCount(
  difficulty: number,
  lengthSegments: number = trafficReferenceLength(difficulty),
  mode: Difficulty = 'normal',
): number {
  const perReference = 20 + 60 * difficulty;
  return Math.round((perReference * lengthSegments * TRAFFIC_COUNT_FACTOR[mode]) / trafficReferenceLength(difficulty));
}

/** Veicoli della tappa `stage`, con la sua lunghezza e la sua modalità. Pura. */
export function trafficCountFor(stage: StageDef): number {
  return carCount(stage.difficulty, stage.lengthSegments, modeOf(stage));
}

/** Seme del traffico derivato da quello della tappa. Pura. */
export function trafficSeed(seed: number): number {
  return (seed ^ TRAFFIC_SEED_SALT) >>> 0;
}

/** Indice del segmento che contiene z, con z riportata nel tracciato. Pura. */
export function segmentIndexOf(z: number, count: number): number {
  const i = Math.floor(wrapZ(z, count * SEGMENT_LENGTH) / SEGMENT_LENGTH);
  return Math.min(i, count - 1);
}

/** Indice della corsia più vicina all'offset dato: 0, 1 o 2. Pura. */
export function laneOf(offset: number, lanes: number = LANES): number {
  const centres = laneCentres(lanes);
  let best = 0;
  for (let i = 1; i < centres.length; i++) {
    if (Math.abs(offset - centres[i]) < Math.abs(offset - centres[best])) best = i;
  }
  return best;
}

/**
 * Vero se due oggetti larghi `w1` e `w2`, centrati in `x1` e `x2`, si
 * sovrappongono. Il contatto esatto (distanza pari alla somma delle
 * semilarghezze) non è sovrapposizione. Pura.
 */
export function overlap(x1: number, w1: number, x2: number, w2: number): boolean {
  return Math.abs(x1 - x2) < (w1 + w2) / 2;
}

/**
 * Corsie con un veicolo più lento davanti a `car`, entro `lookahead` segmenti
 * (spec §6). Legge `segment.cars`, quindi va chiamata su un tracciato già
 * ripartito con `bucketCars`. Pura.
 */
export function blockedLanes(
  segments: readonly Segment[],
  car: Car,
  lookahead = LOOKAHEAD_SEGMENTS,
  lanes: number = LANES,
): boolean[] {
  const blocked = laneCentres(lanes).map(() => false);
  const n = segments.length;
  const start = segmentIndexOf(car.z, n);
  for (let k = 0; k <= lookahead; k++) {
    for (const other of segments[(start + k) % n].cars) {
      if (other.id === car.id) continue;
      // Nello stesso segmento conta solo chi è davvero davanti.
      if (k === 0 && other.z <= car.z) continue;
      if (other.speed < car.speed) blocked[laneOf(other.offset, lanes)] = true;
    }
  }
  return blocked;
}

/**
 * Corsia dove spostarsi: la più vicina libera, preferendo la sinistra a parità.
 * Ritorna la corsia di partenza se è libera o se non c'è via d'uscita. Pura.
 */
export function escapeLane(lane: number, blocked: readonly boolean[]): number {
  if (!blocked[lane]) return lane;
  if (lane - 1 >= 0 && !blocked[lane - 1]) return lane - 1;
  if (lane + 1 < blocked.length && !blocked[lane + 1]) return lane + 1;
  return lane;
}

/** Avvicina `offset` a `target` di al più `step`, senza superarlo. Pura. */
export function moveToward(offset: number, target: number, step: number): number {
  const d = target - offset;
  if (Math.abs(d) <= step) return target;
  return offset + Math.sign(d) * step;
}

/**
 * Nuovo offset di un veicolo (spec §6): se la sua corsia è bloccata da uno
 * più lento entro 20 segmenti, si sposta verso la corsia libera di
 * `dt · LANE_CHANGE_RATE`; altrimenti resta dov'è, rumore compreso. Pura.
 */
export function avoidOffset(segments: readonly Segment[], car: Car, dt: number, lanes: number = LANES): number {
  const lane = laneOf(car.offset, lanes);
  const blocked = blockedLanes(segments, car, LOOKAHEAD_SEGMENTS, lanes);
  if (!blocked[lane]) return car.offset;
  const escape = escapeLane(lane, blocked);
  if (escape === lane) return car.offset;
  return moveToward(car.offset, laneCentres(lanes)[escape], dt * LANE_CHANGE_RATE);
}

/**
 * Riporta ogni veicolo nel suo segmento e ne aggiorna `percent`. Svuota e
 * riempie `segment.cars`: solo il motore scrive lì, i renderer leggono.
 */
export function bucketCars(segments: Segment[], cars: readonly Car[]): void {
  for (const seg of segments) seg.cars.length = 0;
  const trackLength = segments.length * SEGMENT_LENGTH;
  for (const car of cars) {
    const z = wrapZ(car.z, trackLength);
    car.z = z;
    const index = Math.min(Math.floor(z / SEGMENT_LENGTH), segments.length - 1);
    car.percent = (z - index * SEGMENT_LENGTH) / SEGMENT_LENGTH;
    segments[index].cars.push(car);
  }
}

/**
 * Intervallo di segmenti dove il traffico può stare, sia allo spawn sia
 * mentre si muove: dopo la zona libera di `TRAFFIC_FREE_START` segmenti (il
 * rettilineo di partenza e la strada dell'uscita dal bivio, spec §4.4),
 * prima della zona di bivio. Condiviso da `spawnTraffic` e `stepTraffic`
 * così i due non possono
 * divergere. Pura.
 */
export function trafficSpan(segmentCount: number): { from: number; to: number } {
  const from = Math.min(TRAFFIC_FREE_START, segmentCount - 1);
  const to = Math.max(from + 1, segmentCount - FORK_ZONE_SEGMENTS);
  return { from, to };
}

/**
 * Veicoli di una tappa (spec §6), deterministici dal seme: quanti ne dice
 * `trafficCountFor`, con le velocità per il fattore della modalità
 * (`TRAFFIC_SPEED_FACTOR`). Lo spawn salta i
 * primi `TRAFFIC_FREE_START` segmenti e la zona di bivio: il giocatore non
 * parte addosso a un veicolo e la fila di barriere centrali resta libera.
 * Dentro la zona di spawn le posizioni passano per `spawnCurve`, che dimezza
 * la densità nel primo quarto. Questo vale solo qui, allo spawn: `stepTraffic`
 * ricicla i veicoli uniformemente sull'intervallo (righe sotto), quindi dopo
 * il primo giro di riciclo la forma di `spawnCurve` è persa e la densità
 * torna uniforme. La zona resta comunque libera per tutta la gara — questo
 * non cambia — solo la partenza è più facile del resto della tappa, non
 * "sempre" più facile.
 */
export function spawnTraffic(segments: Segment[], stage: StageDef): Car[] {
  const rng = mulberry32(trafficSeed(stage.seed));
  const { from, to } = trafficSpan(segments.length);
  const span = to - from;
  const count = trafficCountFor(stage);
  const speedFactor = TRAFFIC_SPEED_FACTOR[modeOf(stage)];
  const cars: Car[] = [];
  for (let i = 0; i < count; i++) {
    const name = pickTrafficName(rng, stage.theme);
    const centres = laneCentres(stage.lanes ?? LANES);
    const lane = centres[rng.int(0, centres.length - 1)];
    const offset = lane + (rng.next() * 2 - 1) * laneNoiseFor(name, stage.lanes ?? LANES, stage.roadHalf ?? 1);
    const speed = MAX_SPEED * TRAFFIC_SPEEDS[name] * speedFactor * (1 + (rng.next() * 2 - 1) * SPEED_JITTER);
    const index = from + Math.min(span - 1, Math.floor(spawnCurve((i + rng.next()) / count) * span));
    cars.push({
      id: i,
      name,
      offset,
      z: index * SEGMENT_LENGTH + rng.next() * SEGMENT_LENGTH,
      speed,
      percent: 0,
    });
  }
  bucketCars(segments, cars);
  return cars;
}

/**
 * Un passo del traffico (spec §6): cambio corsia, avanzamento, nuova
 * ripartizione nei segmenti. Ritorna quanti veicoli il giocatore ha
 * sorpassato, cioè quanti erano davanti a `prevPlayerZ` e sono finiti dietro
 * a `playerZ` (spec §8): il cambio di ordinamento viene dal movimento del
 * giocatore, quindi servono entrambe le posizioni. Senza `prevPlayerZ` il
 * traffico si muove e i sorpassi risultano zero.
 *
 * Il confronto è fra z assolute, non fra distanze riportate nel tracciato:
 * così un veicolo che passa dalla fine all'inizio del tracciato, o un
 * giocatore che fa lo stesso, non conta come sorpasso.
 *
 * Il cambio corsia legge la ripartizione del tick precedente: i veicoli già
 * mossi in questo giro sono spostati di meno di mezzo segmento, irrilevante
 * su una finestra di 20.
 *
 * Un veicolo non avvolge mai da solo dentro la tappa: non è il giocatore, che
 * a fine tappa passa alla successiva, quindi un traffico che raggiungesse la
 * fine del tracciato teletrasporterebbe all'inizio, tamponando chi si trova
 * lì da dietro dal nulla. Invece, appena un veicolo raggiungerebbe la zona di
 * bivio (`trafficSpan().to`), si ricicla appena dopo il rettilineo di
 * partenza (`trafficSpan().from`): stesso intervallo dello spawn, quindi la
 * fila di barriere centrali resta sempre libera. Se quel punto è davanti al
 * giocatore, dentro la strada visibile, rinasce invece oltre
 * `DRAW_DISTANCE` (`recycleTarget`).
 */
export function stepTraffic(
  segments: Segment[],
  cars: Car[],
  dt: number,
  playerZ: number,
  prevPlayerZ: number = playerZ,
  lanes: number = LANES,
): number {
  const trackLength = segments.length * SEGMENT_LENGTH;
  const { from, to } = trafficSpan(segments.length);
  const recycleFrom = from * SEGMENT_LENGTH;
  const boundary = to * SEGMENT_LENGTH;
  const span = boundary - recycleFrom;
  // Se il giocatore è tornato all'inizio del tracciato il confronto non vale.
  const counting = playerZ >= prevPlayerZ;
  const target = recycleTarget(recycleFrom, boundary, playerZ);
  let overtakes = 0;
  for (const car of cars) {
    const before = car.z;
    car.offset = avoidOffset(segments, car, dt, lanes);
    let z = car.z + car.speed * dt;
    if (z >= boundary) z = target + ((z - boundary) % span);
    car.z = z;
    if (counting && car.z >= before && before > prevPlayerZ && car.z <= playerZ) overtakes++;
  }
  bucketCars(segments, cars);
  return overtakes;
}

/**
 * Segmenti dietro alla telecamera sotto cui un veicolo riciclato alle spalle
 * del giocatore non deve finire: più vicino lo tamponerebbe da dietro dal
 * nulla appena il giocatore rallenta.
 */
export const RECYCLE_BEHIND_SEGMENTS = 20;

/**
 * Dove rinasce un veicolo arrivato alla zona di bivio (collaudo utente:
 * «i veicoli compaiono all'ultimo momento»). Rinascere sempre a
 * `recycleFrom` (subito dopo la zona libera, segmento 360) era giusto
 * finché il giocatore stava più avanti, dove il veicolo spunta alle sue
 * spalle e non si vede; ma nei primi ~330 segmenti di ogni tappa, cioè i
 * primi 5-8 secondi, i veicoli più veloci arrivano al bivio e rinascevano
 * **dentro** la strada visibile, anche a 35 segmenti dal muso. Regola: un
 * veicolo non rinasce mai a meno di `DRAW_DISTANCE` segmenti davanti al
 * giocatore. Se `recycleFrom` è abbastanza dietro la telecamera resta
 * quello; altrimenti il primo punto oltre la strada visibile; su un
 * tracciato troppo corto per entrambe le cose, `recycleFrom` come prima.
 * Pura.
 */
export function recycleTarget(recycleFrom: number, boundary: number, playerZ: number): number {
  const behindLimit = playerZ - PLAYER_Z - RECYCLE_BEHIND_SEGMENTS * SEGMENT_LENGTH;
  if (recycleFrom <= behindLimit) return recycleFrom;
  const ahead = Math.max(recycleFrom, playerZ + DRAW_DISTANCE * SEGMENT_LENGTH);
  return ahead + SEGMENT_LENGTH <= boundary ? ahead : recycleFrom;
}

/** Lato da cui arriva l'urto: +1 se l'oggetto è a destra del giocatore, -1 a sinistra. Pura. */
export function hitSide(playerX: number, objX: number): -1 | 0 | 1 {
  if (objX > playerX) return 1;
  if (objX < playerX) return -1;
  return 0;
}

/**
 * Margine oltre il bordo della fascia di collisione per la spinta contro un
 * oggetto centrato (addendum E, fork-bug-report-2): fermarsi esattamente al
 * bordo lasciava il giocatore pronto a rientrare nella barriera centrale
 * successiva, senza nessuno spazio per allontanarsi lateralmente.
 */
export const PUSH_MARGIN = 0.05;

/**
 * Spinta verso il centro strada dopo un arresto contro un oggetto solido
 * (spec §6): il giocatore esce dalla sovrapposizione dalla parte dello zero.
 * Un oggetto esattamente al centro (le barriere del bivio) non viene
 * attraversato: si esce dal lato dove si è già, con `PUSH_MARGIN` di scarto
 * oltre il bordo della fascia di collisione, verso destra se `x` è
 * esattamente zero. Pura.
 */
export function pushToCentre(x: number, w: number, objX: number, objW: number): number {
  const half = (w + objW) / 2;
  if (objX > 0) return Math.min(x, objX - half);
  if (objX < 0) return Math.max(x, objX + half);
  return x < 0 ? Math.min(x, -half - PUSH_MARGIN) : Math.max(x, half + PUSH_MARGIN);
}

export type CollisionKind = 'none' | 'bump' | 'crash' | 'stop';

export interface Collision {
  kind: CollisionKind;
  /** Velocità dopo l'urto. */
  speed: number;
  /** z dopo l'urto: arretrata di un segmento in caso di `bump`. */
  z: number;
  /** x dopo l'urto: spinta verso il centro in caso di `stop`. */
  x: number;
  /** Lato dell'urto, per l'incidente (spec §7). */
  side: -1 | 0 | 1;
  /**
   * Id del veicolo urtato, solo per `kind: 'bump'`. Serve a chi chiama per
   * tenere un fermo (latch) sull'ultimo veicolo tamponato: il pushback è di
   * un solo segmento, non abbastanza a garantire che il giocatore non vi
   * rientri al tick successivo, il che senza fermo rida un secondo `bump`
   * sullo stesso urto fisico.
   */
  carId?: number;
}

/**
 * Collisioni del giocatore sul segmento dove si trova (spec §6): prima i
 * veicoli, poi gli oggetti solidi; la prima sovrapposizione vince. Pura: non
 * muta né il giocatore né il segmento.
 *
 * `ignoreCarId`, se dato, salta quel veicolo: è il fermo anti-doppio-urto di
 * chi chiama (spec §6, un urto fisico → un evento `bump`).
 */
export function checkCollisions(
  player: PlayerState,
  seg: Segment,
  ignoreCarId?: number,
): Collision {
  const speedPercent = player.speed / MAX_SPEED;

  for (const car of seg.cars) {
    if (car.id === ignoreCarId) continue;
    // Un veicolo tiene un offset di corsia: in un tratto diviso la sua
    // posizione vera sta dentro una delle due carreggiate (spec §9).
    const offset = laneToRoad(car.offset, seg.roadHalf, seg.median);
    const w = CATALOG[car.name]?.collideW ?? 0;
    if (w <= 0 || !overlap(player.x, PLAYER_COLLIDE_W, offset, w)) continue;
    const side = hitSide(player.x, offset);
    if (player.speed > car.speed * CAR_CRASH_SPEED_RATIO && speedPercent > CAR_CRASH_MIN_PERCENT) {
      return { kind: 'crash', speed: player.speed, z: player.z, x: player.x, side };
    }
    return {
      kind: 'bump',
      speed: car.speed * BUMP_SPEED_FACTOR,
      z: player.z - SEGMENT_LENGTH,
      x: player.x,
      side,
      carId: car.id,
    };
  }

  for (const placed of seg.sprites) {
    // Le collisioni concordano con il renderer su dove sta davvero lo
    // sprite (`spriteOffsetOf`, usata identica da `sprites.ts`).
    const offset = spriteOffsetOf(placed, seg);
    const entry = CATALOG[placed.name];
    if (!entry?.solid || entry.collideW <= 0) continue;
    if (!overlap(player.x, PLAYER_COLLIDE_W, offset, entry.collideW)) continue;
    const side = hitSide(player.x, offset);
    if (speedPercent > SCENERY_CRASH_MIN_PERCENT) {
      return { kind: 'crash', speed: player.speed, z: player.z, x: player.x, side };
    }
    return {
      kind: 'stop',
      speed: 0,
      z: player.z,
      x: pushToCentre(player.x, PLAYER_COLLIDE_W, offset, entry.collideW),
      side,
    };
  }

  return { kind: 'none', speed: player.speed, z: player.z, x: player.x, side: 0 };
}

// ---------------------------------------------------------------------------
// Pesi del traffico per tema (spec §6). In coda al file di proposito: il
// binario G modifica la zona di spawn, sopra, e i due lavori non si toccano.
// ---------------------------------------------------------------------------

/**
 * Quanto è probabile ogni veicolo, per tema. Nessun peso è zero: qualunque
 * veicolo può comparire ovunque, solo con frequenze diverse. `traffic_truck`
 * non ha voce: non è in `TRAFFIC_NAMES`, quindi qui non serve un peso.
 * Sportive extra del Set 6 in coda a ogni tema: `traffic_supercar` rara
 * ovunque, `traffic_roadster` più comune a spiaggia/campagna,
 * `traffic_muscle` a deserto/città, `traffic_rally` a campagna/montagna.
 * La moto (collaudo utente: «non si vede mai») pesa 3, e 4 a spiaggia e
 * città, come le auto più comuni.
 */
export const TRAFFIC_WEIGHTS: Record<ThemeId, Readonly<Record<SpriteName, number>>> = {
  beach: {
    traffic_van: 2,
    traffic_sedan: 3,
    traffic_hatchback: 3,
    traffic_bike: 4,
    traffic_coupe: 2,
    traffic_offroad: 1,
    traffic_sportscar: 2,
    traffic_bus: 1,
    traffic_pickup: 1,
    traffic_supercar: 1,
    traffic_roadster: 3,
    traffic_muscle: 1,
    traffic_rally: 1,
  },
  desert: {
    traffic_van: 2,
    traffic_sedan: 2,
    traffic_hatchback: 1,
    traffic_bike: 3,
    traffic_coupe: 1,
    traffic_offroad: 3,
    traffic_sportscar: 1,
    traffic_bus: 1,
    traffic_pickup: 3,
    traffic_supercar: 1,
    traffic_roadster: 1,
    traffic_muscle: 3,
    traffic_rally: 1,
  },
  alpine: {
    traffic_van: 2,
    traffic_sedan: 2,
    traffic_hatchback: 2,
    traffic_bike: 3,
    traffic_coupe: 2,
    traffic_offroad: 3,
    traffic_sportscar: 1,
    traffic_bus: 2,
    traffic_pickup: 2,
    traffic_supercar: 1,
    traffic_roadster: 1,
    traffic_muscle: 1,
    traffic_rally: 3,
  },
  farm: {
    traffic_van: 2,
    traffic_sedan: 2,
    traffic_hatchback: 2,
    traffic_bike: 3,
    traffic_coupe: 1,
    traffic_offroad: 2,
    traffic_sportscar: 1,
    traffic_bus: 1,
    traffic_pickup: 3,
    traffic_supercar: 1,
    traffic_roadster: 3,
    traffic_muscle: 1,
    traffic_rally: 3,
  },
  town: {
    traffic_van: 2,
    traffic_sedan: 3,
    traffic_hatchback: 3,
    traffic_bike: 4,
    traffic_coupe: 2,
    traffic_offroad: 1,
    traffic_sportscar: 2,
    traffic_bus: 3,
    traffic_pickup: 1,
    traffic_supercar: 1,
    traffic_roadster: 1,
    traffic_muscle: 3,
    traffic_rally: 1,
  },
};

/**
 * Un veicolo a caso con i pesi del tema. Scorre `TRAFFIC_NAMES` in ordine
 * fisso e consuma **un solo** numero dell'rng, così lo spawn resta
 * deterministico dal seme come prima dei pesi (spec §9).
 */
export function pickTrafficName(rng: Rng, theme: ThemeId): SpriteName {
  const weights = TRAFFIC_WEIGHTS[theme];
  let total = 0;
  for (const name of TRAFFIC_NAMES) total += weights[name] ?? 0;
  let pick = rng.next() * total;
  for (const name of TRAFFIC_NAMES) {
    pick -= weights[name] ?? 0;
    if (pick < 0) return name;
  }
  return TRAFFIC_NAMES[0];
}
