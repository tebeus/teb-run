import { clamp, SEGMENT_LENGTH } from '../render/project';
import type { Actions, Gear, PlayerState, Surface } from '../types';

// Tabella della spec §5, tutto per secondo.
export const MAX_SPEED = SEGMENT_LENGTH * 60;
export const ACCEL_HI = MAX_SPEED / 5;
export const ACCEL_LO = MAX_SPEED / 3;
export const MAX_SPEED_LO = MAX_SPEED * 0.55;
export const BRAKING = -MAX_SPEED;
export const DECEL = -MAX_SPEED / 5;
export const OFF_ROAD_DECEL = -MAX_SPEED / 2;
export const OFF_ROAD_LIMIT = MAX_SPEED / 4;
export const CENTRIFUGAL = 0.42;
export const STEER_RATE = 2.0;
/**
 * Sotto questa frazione di velocità lo sterzo usa comunque questo minimo
 * (addendum E, fork-bug-report-2): `dx` è proporzionale a `speedPercent`, e
 * a velocità zero (fermo o quasi contro un ostacolo) non si sterzava per
 * niente, un vero soft-lock per chi restava incollato a una barriera
 * centrale del bivio.
 */
export const MIN_STEER_SPEED_PERCENT = 0.15;
/**
 * Secondi di sterzo continuo nello stesso verso che bastano, sopra il 50% di
 * velocità, a passare al frame largo (spec §5, sterzo a tre stati).
 */
export const STEER_HOLD_FOR_STRONG = 0.35;
/** In marcia alta sotto questa frazione di velocità l'accelerazione è dimezzata. */
export const HI_BOG_PERCENT = 0.3;
/** Velocità mostrata a velocità massima (spec §5). */
export const KMH_AT_MAX = 293;
/** Oltre questo valore assoluto x viene riportata al limite (spec §5). */
export const X_LIMIT = 3;

/** Semilarghezze strada coperte dalla banchina, per lato (spec §5). */
export const SHOULDER_W = 0.35;

/** Quanto la spinta cala con la velocità (spec §5): un quarto al massimo. */
export const ACCEL_FALLOFF = 0.75;
/** Coefficiente della perdita di velocità in curva (spec §5). */
export const CURVE_DRAG = 0.012;

/**
 * Accelerazione del gas a una data velocità (spec §5): piena da fermo,
 * `1 - ACCEL_FALLOFF` al massimo. La penalità della marcia alta sotto il 30%
 * si moltiplica con il calo, non lo sostituisce. Pura.
 */
export function accelFor(gear: Gear, speedPercent: number): number {
  const p = Number.isFinite(speedPercent) ? clamp(speedPercent, 0, 1) : 0;
  const base = gear === 'lo' ? ACCEL_LO : p < HI_BOG_PERCENT ? ACCEL_HI * 0.5 : ACCEL_HI;
  return base * (1 - ACCEL_FALLOFF * p);
}

/**
 * Velocità perduta in curva, per secondo (spec §5). Solo sull'asfalto: fuori
 * c'è già la penalità della superficie, e sommarle sarebbe una doppia
 * punizione. Cresce col quadrato della velocità, quindi da fermo è zero. Pura.
 */
export function curveDrag(curve: number, speedPercent: number, surface: Surface): number {
  if (surface !== 'road') return 0;
  const p = clamp(speedPercent, 0, 1);
  return MAX_SPEED * CURVE_DRAG * Math.abs(curve) * p * p;
}

// Tabella della spec §5.1.
/** Frazione di MAX_SPEED sotto la quale non si derapa mai. */
export const SKID_SPEED = 0.6;
/** Curvatura assoluta del segmento che basta a far derapare. */
export const SKID_CURVE = 1.5;
/** Sopra questa frazione si derapa anche in rettilineo. */
export const SKID_ANY_SPEED = 0.95;
/** Scivolamento in più, in frazioni di dx. */
export const SKID_SLIDE = 0.6;
/** Velocità perduta in derapata, per secondo. */
export const SKID_DECEL = -MAX_SPEED / 12;
/** Moltiplicatore della centrifuga in derapata. */
export const SKID_CENTRIFUGAL = 2;

/**
 * Aderenza minima che la fisica accetta (spec §5). Serve come guardia,
 * non come valore di gioco: la superficie più scivolosa del gioco è la
 * neve a 0.7, e `GRIP_MIN` sta sotto. Senza la guardia, un'aderenza a
 * zero renderebbe `CENTRIFUGAL / grip` infinito, `x` diventerebbe `NaN`,
 * e `clamp(NaN, -X_LIMIT, X_LIMIT)` ritorna `NaN`, perché `NaN` non è né
 * minore né maggiore di niente: il giocatore spariva dal tracciato per
 * sempre.
 */
export const GRIP_MIN = 0.5;

/**
 * Un'aderenza usabile come divisore: dentro `[GRIP_MIN, 1]`. Assente
 * vale 1, e un valore non numerico vale 1 — il caso **migliore**, al
 * contrario di `surfaceMixOf`: un `NaN` che arrivasse qui viene da un
 * errore di programmazione, non da un ingresso ostile, e punire chi
 * gioca per un bug del gioco sarebbe la scelta sbagliata. Pura.
 */
export function clampGrip(grip: number | undefined): number {
  if (grip === undefined || Number.isNaN(grip)) return 1;
  return grip < GRIP_MIN ? GRIP_MIN : grip > 1 ? 1 : grip;
}

/**
 * Se l'auto sta slittando in questo tick (spec §5.1). Senza stato: appena si
 * rilascia lo sterzo la derapata finisce. Fuori dall'asfalto non c'è derapata,
 * ci sono polvere e rumore di sterrato. Una velocità non finita vale zero.
 */
export function skidsNow(o: {
  surface: Surface;
  steer: number;
  speedPercent: number;
  curve: number;
  crashActive: boolean;
  /**
   * Aderenza della superficie (spec §5.1): assente vale 1, e ogni
   * chiamante che non la passa vede il comportamento di prima. Abbassa
   * le due soglie di innesco, non la terza: vedi il commento sotto.
   */
  grip?: number;
}): boolean {
  if (o.crashActive || o.surface !== 'road' || o.steer === 0) return false;
  const grip = clampGrip(o.grip);
  if (!(o.speedPercent > SKID_SPEED * grip)) return false;
  // `SKID_ANY_SPEED` **non** si scala (deroga dichiarata, binario K):
  // 0.95 · 0.7 = 0.665 sarebbe sotto `SKID_SPEED`, e ogni sterzata in
  // rettilineo sopra il 67% diventerebbe una derapata per tutta la tappa
  // di neve. La leva per rendere la neve più severa è `SURFACE_GRIP.snow`.
  return Math.abs(o.curve) >= SKID_CURVE * grip || o.speedPercent > SKID_ANY_SPEED;
}

/**
 * Superficie sotto le ruote (spec §5 e §4.4). Il bordo strada appartiene
 * all'asfalto e la banchina è larga `SHOULDER_W` **oltre** il bordo esterno,
 * anche quando la strada è allargata dalla zona di bivio. Dentro l'isola
 * centrale (`|x| < median`) si è sul terreno, tranne dentro la zona di bivio
 * (`inForkZone`, addendum del collaudo): lì l'isola vale banchina, penalità
 * dimezzata invece di doppia, perché chi resta al centro va guidato verso
 * una carreggiata, non piantato sul terreno. Una x non finita vale erba: è
 * il caso peggiore, non il migliore.
 */
export function surfaceOf(x: number, roadHalf = 1, median = 0, inForkZone = false): Surface {
  const a = Math.abs(x);
  if (!(a <= roadHalf + SHOULDER_W)) return 'grass';
  if (a < median) return inForkZone ? 'shoulder' : 'grass';
  return a <= roadHalf ? 'road' : 'shoulder';
}

/**
 * Spinta laterale verso la carreggiata più vicina per chi resta sull'isola
 * centrale della zona di bivio (addendum del collaudo): senza di lei un
 * giocatore fermo al centro non ha alcuna ragione fisica per uscirne.
 * `ISLAND_NUDGE` unità al secondo, verso il segno di `x`, o verso destra se
 * `x` è esattamente zero.
 */
export const ISLAND_NUDGE = 0.6;

export function initialPlayer(): PlayerState {
  return {
    x: 0,
    z: 0,
    speed: 0,
    gear: 'lo',
    steer: 0,
    offRoad: false,
    braking: false,
    accelerating: false,
    surface: 'road',
    skidding: false,
    steerHeld: 0,
  };
}

export function kmh(speed: number): number {
  return (speed / MAX_SPEED) * KMH_AT_MAX;
}

/**
 * Un passo di fisica (spec §5). Ritorna uno stato nuovo, non muta l'ingresso.
 * `curve` è la curvatura del segmento su cui si trova il giocatore.
 * Con `crashActive` l'input è ignorato: speed, x e gear restano al modulo
 * dell'incidente, ma z continua ad avanzare.
 * La penalità della marcia alta è senza stato: vale finché speedPercent < 0.3.
 * `grip` è l'aderenza della superficie (spec §4.4f, §5): 1 è l'asfalto
 * asciutto, e ogni chiamante che la lascia al default vede la fisica di
 * prima, identica. La calcola `gripFor` di `game/surface.ts` dal
 * segmento e dal meteo della tappa, e la passa `game/race.ts`.
 * `xMin` e `xMax` sono i limiti laterali: `±X_LIMIT` di norma; dopo il
 * commit del bivio il lato della strada scartata si chiude al suo bordo
 * interno (bivio v3, `xLimitsOf` in `track.ts`).
 */
export function stepPlayer(
  state: PlayerState,
  actions: Actions,
  dt: number,
  curve: number,
  crashActive: boolean,
  roadHalf = 1,
  median = 0,
  inForkZone = false,
  grip = 1,
  xMin = -X_LIMIT,
  xMax = X_LIMIT,
): PlayerState {
  if (crashActive) {
    return {
      ...state,
      z: state.z + state.speed * dt,
      steer: 0,
      braking: false,
      accelerating: false,
      offRoad: Math.abs(state.x) > 1,
      surface: surfaceOf(state.x, roadHalf, median, inForkZone),
      skidding: false,
      steerHeld: 0,
    };
  }

  const speedPercent = state.speed / MAX_SPEED;
  // Aderenza della superficie (spec §4.4f, §5), usata come divisore:
  // passa sempre da `clampGrip`, che la tiene lontana dallo zero.
  const g = clampGrip(grip);
  // Sterzo minimo anche da fermi (addendum E): solo `dx`, non `speedPercent`
  // stesso, che resta il valore vero per centrifuga e derapata.
  const dx = dt * STEER_RATE * Math.max(speedPercent, MIN_STEER_SPEED_PERCENT);
  const gear: Gear = actions.gearToggle ? (state.gear === 'lo' ? 'hi' : 'lo') : state.gear;

  let x = state.x;
  const steerDir: -1 | 0 | 1 = actions.left && !actions.right ? -1 : actions.right && !actions.left ? 1 : 0;
  if (steerDir === -1) x -= dx;
  else if (steerDir === 1) x += dx;
  let steer: PlayerState['steer'] = steerDir;
  // Sterzo a tre stati (spec §5): steerHeld conta i secondi continui nello
  // stesso verso, e si azzera al rilascio o all'inversione, nello stesso
  // tick in cui succede.
  const prevDir = Math.sign(state.steer);
  const steerHeld = steerDir !== 0 && steerDir === prevDir ? state.steerHeld + dt : 0;
  // La derapata si valuta sulla superficie di partenza: quella finale
  // dipenderebbe dallo scivolamento, che dipende dalla derapata.
  const skidding = skidsNow({
    surface: surfaceOf(state.x, roadHalf, median, inForkZone),
    steer,
    speedPercent,
    curve,
    crashActive: false,
    grip: g,
  });
  if (skidding) {
    // Scivola oltre lo sterzo, verso l'esterno, e con meno presa scivola
    // di più (spec §5.1).
    x += Math.sign(steer) * dx * (SKID_SLIDE / g);
  }
  // Frame di sterzo largo (spec §5): sterzo tenuto abbastanza a velocità
  // sostenuta, oppure controsterzo, oppure derapata.
  const heldStrong = steerHeld >= STEER_HOLD_FOR_STRONG && speedPercent > 0.5;
  if (steer !== 0 && (skidding || steer * curve < 0 || heldStrong)) {
    steer = (steer * 2) as PlayerState['steer'];
  }
  // Centrifuga: spinge verso l'esterno della curva, raddoppiata in
  // derapata e divisa dall'aderenza (spec §5).
  x -= dx * speedPercent * curve * (CENTRIFUGAL / g) * (skidding ? SKID_CENTRIFUGAL : 1);
  x = clamp(x, xMin, xMax);

  // Isola centrale della zona di bivio, meno punitiva (addendum del
  // collaudo): chi resta al centro viene guidato verso la carreggiata più
  // vicina invece di piantarsi sul terreno. Verso destra da x = 0 esatto.
  if (inForkZone && Math.abs(x) < median) {
    const side = x === 0 ? 1 : Math.sign(x);
    x += side * ISLAND_NUDGE * dt;
  }

  let accel: number;
  if (actions.accelerate) {
    accel = accelFor(gear, speedPercent);
  } else if (actions.brake) {
    accel = BRAKING;
  } else {
    accel = DECEL;
  }
  let speed = state.speed + accel * dt;
  // Con meno presa si perde **meno** velocità e si scivola più a lungo:
  // `SKID_DECEL` è negativo, e moltiplicarlo per un'aderenza minore di 1
  // lo avvicina a zero (spec §5.1).
  if (skidding) speed += SKID_DECEL * g * dt;
  // Decelerazione della superficie su cui si finisce, spec §5.
  const surface = surfaceOf(x, roadHalf, median, inForkZone);
  // Perdita di velocità in curva, sull'asfalto (spec §5). Usa la velocità di
  // inizio tick, come tutto il resto del passo.
  speed -= curveDrag(curve, speedPercent, surface) * dt;
  if (surface === 'shoulder' && speed > OFF_ROAD_LIMIT * 1.5) {
    speed += (OFF_ROAD_DECEL / 2) * dt;
  } else if (surface === 'grass' && speed > OFF_ROAD_LIMIT) {
    speed += OFF_ROAD_DECEL * dt;
  }
  speed = clamp(speed, 0, gear === 'lo' ? MAX_SPEED_LO : MAX_SPEED);

  return {
    x,
    z: state.z + speed * dt,
    speed,
    gear,
    steer,
    offRoad: Math.abs(x) > 1,
    braking: actions.brake,
    accelerating: actions.accelerate,
    surface,
    skidding,
    steerHeld,
  };
}
