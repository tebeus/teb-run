import { CATALOG } from '../art/catalog';
import { mulberry32, type Rng } from '../core/rng';
import { clamp, ROAD_HALF, SEGMENT_LENGTH } from '../render/project';
import type {
  DiscardedRoad,
  PlacedSprite,
  Segment,
  SpriteCatalogEntry,
  SpriteName,
  StageDef,
  SurfaceKind,
  ThemeId,
  WallKind,
} from '../types';
import { SHOULDER_W, X_LIMIT } from './player';
import { FIRST_STAGE_ID } from './stages';

export function easeIn(a: number, b: number, t: number): number {
  return a + (b - a) * t * t;
}

export function easeOut(a: number, b: number, t: number): number {
  return a + (b - a) * (1 - (1 - t) * (1 - t));
}

export function easeInOut(a: number, b: number, t: number): number {
  return a + (b - a) * (-Math.cos(t * Math.PI) / 2 + 0.5);
}

/** Riporta z in [0, trackLength), anche per z negative. */
export function wrapZ(z: number, trackLength: number): number {
  return ((z % trackLength) + trackLength) % trackLength;
}

/** Segmento che contiene z; il tracciato si ripete, quindi ogni z è valida. */
export function findSegment(segments: readonly Segment[], z: number): Segment {
  const n = segments.length;
  const i = Math.floor(wrapZ(z, n * SEGMENT_LENGTH) / SEGMENT_LENGTH);
  return segments[Math.min(i, n - 1)];
}

export type SectionKind =
  | 'straight'
  | 'curveEasy'
  | 'curveMedium'
  | 'curveHard'
  | 'hillLow'
  | 'hillMedium'
  | 'hillHigh'
  | 'sCurve'
  | 'chicane'
  | 'uphillCurve'
  | 'dualRoad';

export const SECTION_KINDS: readonly SectionKind[] = [
  'straight',
  'curveEasy',
  'curveMedium',
  'curveHard',
  'hillLow',
  'hillMedium',
  'hillHigh',
  'sCurve',
  'chicane',
  'uphillCurve',
  'dualRoad',
];

/** Pesi delle sezioni: con la difficoltà crescono curve strette e colline (spec §9). */
export function sectionWeights(difficulty: number): Record<SectionKind, number> {
  const d = difficulty;
  return {
    straight: 30 - 20 * d,
    curveEasy: 20 - 5 * d,
    curveMedium: 10 + 10 * d,
    curveHard: 3 + 24 * d,
    hillLow: 12 - 4 * d,
    hillMedium: 6 + 6 * d,
    hillHigh: 2 + 8 * d,
    sCurve: 6 + 9 * d,
    chicane: 3 + 18 * d,
    uphillCurve: 4 + 12 * d,
    dualRoad: 3 + 6 * d,
  };
}

/** Sceglie una sezione con i pesi della difficoltà. */
export function pickSection(rng: Rng, difficulty: number): SectionKind {
  const weights = sectionWeights(difficulty);
  let total = 0;
  for (const k of SECTION_KINDS) total += weights[k];
  let pick = rng.next() * total;
  for (const k of SECTION_KINDS) {
    pick -= weights[k];
    if (pick < 0) return k;
  }
  return 'straight';
}

/** Rettilineo piano di partenza (spec §9). */
export const INTRO_SEGMENTS = 60;
/**
 * Zona di bivio in coda alla tappa (spec §9). 320, non 200 (**deroga**, brief
 * del controllore `fork-geometry-brief.md`: il collaudo dell'utente, «la
 * divisione delle strade ancora non funziona», ha mostrato che con 200
 * segmenti la strada si allargava per quasi tutta la zona e l'isola nasceva
 * tardi e sottile — una sola strada larga con barriere in mezzo, non due
 * strade che si allontanano). `MIN_STAGE_SEGMENTS` segue da qui.
 */
export const FORK_ZONE_SEGMENTS = 320;
/**
 * Segmenti della tappa nuova, dopo una giunzione, su cui resta visibile la
 * carreggiata scartata al bivio, sempre più lontana (spec §4.4, «Uscita dal
 * bivio»). Marcati da `race.ts` con `segment.forkExit`. 360, non 150
 * (**deroga, terzo addendum del collaudo**: l'utente vedeva la strada
 * scartata per meno di un secondo dopo la giunzione, poi una sola strada; a
 * ~161 km/h (la velocità di crociera osservata nei fotogrammi) 360 segmenti
 * durano ~11 s, non più ~1,9 s).
 */
export const FORK_EXIT_SEGMENTS = 360;
/**
 * Segmenti liberi da traffico all'inizio di ogni tappa e per tutta la gara.
 * Entra in `trafficSpan`, quindi nessun veicolo nasce o viene riciclato lì.
 *
 * Due vincoli indipendenti si sommano qui e la zona libera è il più stretto
 * che li soddisfa entrambi, cioè il massimo dei due:
 *
 * - spec §4.4, «Uscita dal bivio»: almeno `FORK_EXIT_SEGMENTS` (360, terzo
 *   addendum del collaudo), così un veicolo non appare accanto alla
 *   carreggiata scartata che si allontana;
 * - partenza giocabile (deroga alla spec §6, che non dice niente sulla
 *   partenza): `INTRO_SEGMENTS` (60) sono 12.000 unità, cioè un secondo a
 *   velocità massima, e chi parte tenendo il gas dritto si trovava addosso un
 *   furgone in due o tre secondi. 180 segmenti sono 36.000 unità: da fermo ci
 *   vogliono circa cinque secondi, il tempo di capire che cosa sta succedendo.
 *
 * Con `FORK_EXIT_SEGMENTS` a 360 vince il primo vincolo, non più il secondo
 * (`Math.max` lo decide da solo): il valore è 360, non più 180. Definito
 * **solo** qui; `traffic.ts` lo ri-esporta per chi lo importa da lì.
 */
export const TRAFFIC_FREE_START = Math.max(3 * INTRO_SEGMENTS, FORK_EXIT_SEGMENTS);
/** Segmenti per passo dell'alternanza chiaro/scuro (spec §4.4). */
export const RUMBLE_SEGMENTS = 3;
/** Segmenti riservati per riportare y a zero prima della zona di bivio. */
export const CLOSE_SEGMENTS = 160;
/** Sotto questa lunghezza una tappa non può chiudere in modo corretto. */
export const MIN_STAGE_SEGMENTS = INTRO_SEGMENTS + CLOSE_SEGMENTS + FORK_ZONE_SEGMENTS;

/** Rampa di ingresso e di uscita di un tratto a doppia carreggiata (spec §9). */
export const DUAL_RAMP = 60;
/** Lunghezza totale del tratto, rampe comprese (spec §9). */
export const DUAL_MIN = 300;
export const DUAL_MAX = 500;
/**
 * Segmenti di coda in cui la doppia carreggiata non si emette: la zona di
 * bivio ha già la sua divisione, e due geometrie sovrapposte farebbero
 * crescere `median` due volte.
 */
export const DUAL_TAIL_GUARD = 700;

/**
 * Da offset di **corsia** a posizione sulla strada (spec §9). Fuori da un
 * tratto diviso (`median = 0`, `roadHalf = 1`) è l'identità, quindi si può
 * applicare sempre. Un offset zero va sulla carreggiata destra, come
 * `forkSide(0)`: il segno di zero non esiste. Pura.
 */
export function laneToRoad(offset: number, roadHalf: number, median: number): number {
  const side = offset < 0 ? -1 : 1;
  return side * (median + Math.abs(offset) * (roadHalf - median));
}

/** Curvatura per grado di difficoltà della curva (spec §9). */
const CURVE = { easy: 2, medium: 4, hard: 6 } as const;
/** Dislivello in segmenti per grado di collina (spec §9). */
const HILL = { low: 20, medium: 40, high: 60 } as const;

/**
 * Oltre questa quota le colline puntano verso zero: senza questo vincolo i
 * dislivelli con segno casuale fanno una passeggiata aleatoria e la discesa
 * finale diventa un muro.
 */
export const HILL_BIAS_THRESHOLD = 4000;
/** Quota massima raggiungibile: soglia più il dislivello di una collina alta. */
export const MAX_HILL_Y = HILL_BIAS_THRESHOLD + HILL.high * SEGMENT_LENGTH;
/**
 * Pendenza media massima di una sezione, in frazione di SEGMENT_LENGTH.
 * Con l'easing in-out la pendenza di punta è π/2 volte la media, quindi 0,55
 * tiene ogni segmento sotto un dislivello di SEGMENT_LENGTH (pendenza 1).
 */
export const MAX_SLOPE = 0.55;

/** Direzione della collina: verso zero se la strada è già alta o già bassa. */
function hillDir(segs: readonly Segment[], fallback: number): number {
  const y = lastY(segs);
  if (y > HILL_BIAS_THRESHOLD) return -1;
  if (y < -HILL_BIAS_THRESHOLD) return 1;
  return fallback;
}

/** Dislivello in segmenti, ridotto se la sezione è troppo corta per contenerlo. */
function hillAmount(grade: number, total: number): number {
  return Math.min(grade, MAX_SLOPE * total);
}

function lastY(segs: readonly Segment[]): number {
  return segs.length === 0 ? 0 : segs[segs.length - 1].p2.world.y;
}

function addSegment(segs: Segment[], theme: ThemeId, curve: number, y: number, base = 1): void {
  const n = segs.length;
  segs.push({
    index: n,
    p1: {
      world: { x: 0, y: lastY(segs), z: n * SEGMENT_LENGTH },
      camera: { x: 0, y: 0, z: 0 },
      screen: { x: 0, y: 0, w: 0, scale: 0 },
    },
    p2: {
      world: { x: 0, y, z: (n + 1) * SEGMENT_LENGTH },
      camera: { x: 0, y: 0, z: 0 },
      screen: { x: 0, y: 0, w: 0, scale: 0 },
    },
    curve,
    sprites: [],
    cars: [],
    themeId: theme,
    dark: Math.floor(n / RUMBLE_SEGMENTS) % 2 === 1,
    clip: 0,
    roadHalf: base,
    median: 0,
  });
}

/** Rettilineo piano di n segmenti all'altezza corrente. */
function addStraight(segs: Segment[], theme: ThemeId, n: number, base = 1): void {
  const y = lastY(segs);
  for (let i = 0; i < n; i++) addSegment(segs, theme, 0, y, base);
}

/**
 * Sezione con easing: `enter` segmenti per entrare in curva, `hold` a curvatura
 * piena, `leave` per uscirne; l'altezza sale di `dy` segmenti su tutta la sezione.
 */
function addRoad(
  segs: Segment[],
  theme: ThemeId,
  enter: number,
  hold: number,
  leave: number,
  curve: number,
  dy: number,
  base = 1,
): void {
  const startY = lastY(segs);
  const endY = startY + dy * SEGMENT_LENGTH;
  const total = enter + hold + leave;
  for (let n = 0; n < enter; n++) {
    addSegment(segs, theme, easeIn(0, curve, n / enter), easeInOut(startY, endY, (n + 1) / total), base);
  }
  for (let n = 0; n < hold; n++) {
    addSegment(segs, theme, curve, easeInOut(startY, endY, (enter + n + 1) / total), base);
  }
  for (let n = 0; n < leave; n++) {
    addSegment(
      segs,
      theme,
      easeInOut(curve, 0, n / leave),
      easeInOut(startY, endY, (enter + hold + n + 1) / total),
      base,
    );
  }
}

/**
 * Riporta l'altezza a zero con easing su n segmenti, curvatura zero.
 * n è almeno CLOSE_SEGMENTS e la quota non supera MAX_HILL_Y, quindi la
 * pendenza di punta resta sotto SEGMENT_LENGTH per segmento.
 */
function addFlatten(segs: Segment[], theme: ThemeId, n: number, base = 1): void {
  const startY = lastY(segs);
  for (let i = 0; i < n; i++) addSegment(segs, theme, 0, easeInOut(startY, 0, (i + 1) / n), base);
}

/**
 * Coda della tappa: rettilineo piano. Nella zona di bivio la strada si
 * allarga appena, poi si apre a Y (spec §4.4, bivio v3, `forkZoneShape`),
 * con i valori di entrambi i capi del segmento: il primo segmento della zona
 * comincia alla larghezza di base, quindi l'ingresso non salta.
 */
function addTail(segs: Segment[], theme: ThemeId, n: number, forkZone: boolean, base = 1): void {
  for (let i = 0; i < n; i++) {
    addSegment(segs, theme, 0, 0, base);
    if (!forkZone) continue;
    const seg = segs[segs.length - 1];
    seg.fork = 'zone';
    const near = forkZoneShape(i, base);
    const far = forkZoneShape(i + 1, base);
    seg.roadHalf = near.roadHalf;
    seg.median = near.median;
    seg.roadHalfFar = far.roadHalf;
    seg.medianFar = far.median;
  }
}

/**
 * Tratto a doppia carreggiata: rampa `smoothstep` di `DUAL_RAMP` segmenti,
 * tratto pieno, rampa di uscita. La geometria è quella del bivio (task 16),
 * quindi il renderer, la superficie dell'isola e `forkOffset` valgono già.
 */
function addDualRoad(segs: Segment[], theme: ThemeId, hold: number, base = 1): void {
  const y = lastY(segs);
  const add = (t: number): void => {
    addSegment(segs, theme, 0, y, base);
    const seg = segs[segs.length - 1];
    seg.roadHalf = forkRoadHalf(t, base);
    seg.median = forkMedian(seg.roadHalf, base);
  };
  for (let i = 0; i < DUAL_RAMP; i++) add((i + 1) / DUAL_RAMP);
  for (let i = 0; i < hold; i++) add(1);
  for (let i = 0; i < DUAL_RAMP; i++) add(1 - (i + 1) / DUAL_RAMP);
}

/** Aggiunge una sezione del tipo dato, rimanendo entro `budget` segmenti (budget >= 60). */
export function addKind(
  segs: Segment[],
  theme: ThemeId,
  kind: SectionKind,
  rng: Rng,
  budget: number,
  base = 1,
): void {
  const dir = rng.next() < 0.5 ? -1 : 1;
  const room = kind === 'sCurve' || kind === 'chicane' ? Math.floor(budget / 2) : budget;
  const enter = clamp(rng.int(20, 40), 4, Math.floor(room / 3));
  const hold = clamp(rng.int(30, 80), 4, room - 2 * enter);
  // Lunghezza della sezione: serve a limitare la pendenza delle colline.
  const total = 2 * enter + hold;
  switch (kind) {
    case 'straight':
      addStraight(segs, theme, clamp(rng.int(40, 120), 4, budget), base);
      return;
    case 'curveEasy':
      addRoad(segs, theme, enter, hold, enter, dir * CURVE.easy, 0, base);
      return;
    case 'curveMedium':
      addRoad(segs, theme, enter, hold, enter, dir * CURVE.medium, 0, base);
      return;
    case 'curveHard':
      addRoad(segs, theme, enter, hold, enter, dir * CURVE.hard, 0, base);
      return;
    case 'hillLow':
      addRoad(segs, theme, enter, hold, enter, 0, hillDir(segs, dir) * hillAmount(HILL.low, total), base);
      return;
    case 'hillMedium':
      addRoad(segs, theme, enter, hold, enter, 0, hillDir(segs, dir) * hillAmount(HILL.medium, total), base);
      return;
    case 'hillHigh':
      addRoad(segs, theme, enter, hold, enter, 0, hillDir(segs, dir) * hillAmount(HILL.high, total), base);
      return;
    case 'sCurve':
      addRoad(segs, theme, enter, hold, enter, dir * CURVE.medium, 0, base);
      addRoad(segs, theme, enter, hold, enter, -dir * CURVE.medium, 0, base);
      return;
    case 'chicane': {
      // La S secca dei racer arcade dell'epoca: la prima metà non esce dalla curva e la
      // seconda non ci entra, quindi il segno si ribalta fra due segmenti
      // consecutivi senza passare per lo zero. Con `enter` o `leave` a zero i
      // cicli di `addRoad` non girano: nessuna divisione per zero.
      const strength = rng.next() < 0.5 ? CURVE.medium : CURVE.hard;
      const half = Math.max(4, Math.floor(hold / 2));
      addRoad(segs, theme, enter, half, 0, dir * strength, 0, base);
      addRoad(segs, theme, 0, half, enter, -dir * strength, 0, base);
      return;
    }
    case 'uphillCurve':
      // In salita, o in discesa se la strada è già alta.
      addRoad(
        segs,
        theme,
        enter,
        hold,
        enter,
        dir * CURVE.medium,
        hillDir(segs, 1) * hillAmount(HILL.medium, total),
        base,
      );
      return;
    case 'dualRoad': {
      const dualTotal = clamp(rng.int(DUAL_MIN, DUAL_MAX), 2 * DUAL_RAMP + 20, budget);
      addDualRoad(segs, theme, dualTotal - 2 * DUAL_RAMP, base);
      return;
    }
  }
}

/**
 * Costruisce i segmenti di una tappa, deterministico dal seed (spec §9).
 * Lancia se la tappa è troppo corta o se non chiude con y e curve a zero (spec §15).
 */
export function buildTrack(stage: StageDef): Segment[] {
  if (stage.lengthSegments < MIN_STAGE_SEGMENTS) {
    throw new Error(
      `stage ${stage.id} is too short: ${stage.lengthSegments} segments, minimum ${MIN_STAGE_SEGMENTS}`,
    );
  }
  const rng = mulberry32(stage.seed);
  const segs: Segment[] = [];
  const theme = stage.theme;
  const bodyEnd = stage.lengthSegments - FORK_ZONE_SEGMENTS;
  const base = stage.roadHalf ?? 1;

  addStraight(segs, theme, INTRO_SEGMENTS, base);
  while (bodyEnd - segs.length - CLOSE_SEGMENTS >= 60) {
    let kind = pickSection(rng, stage.difficulty);
    // La doppia carreggiata non si sovrappone alla zona di bivio (spec §9).
    if (kind === 'dualRoad' && segs.length + DUAL_TAIL_GUARD > bodyEnd) kind = 'straight';
    addKind(segs, theme, kind, rng, bodyEnd - segs.length - CLOSE_SEGMENTS, base);
  }
  addFlatten(segs, theme, bodyEnd - segs.length, base);
  addTail(segs, theme, FORK_ZONE_SEGMENTS, !stage.id.startsWith('4-'), base);

  placeScenery(segs, stage, rng);
  // Dopo `placeScenery`, così gli oggetti a bordo strada delle 15 tappe
  // restano identici: l'rng arriva qui con la stessa storia di prima.
  placeWater(segs, stage, rng);
  placeWalls(segs, stage, rng);
  placeGroundDetails(segs, stage, rng);
  placeChevrons(segs, rng);
  placeCurveSigns(segs, rng);
  placeRoadsideLife(segs, stage, rng);
  // Penultima funzione che usa l'rng, prima di `placeSurfaces`:
  // aggiungerne altre fra questa e quella sposterebbe le barche, non
  // ciò che sta prima (spec §13).
  placeSailboats(segs, stage, rng);
  placeSpectators(segs, stage);
  placeForkSigns(segs, stage);
  // Senza rng: i portali non spostano niente di ciò che c'è già.
  placePortals(segs, stage);
  // Per ultima (spec §4.4f): consuma l'Rng, e infilarla prima di
  // un'altra passata cambierebbe ogni oggetto a bordo strada di tutte e
  // quindici le tappe. Non cambia né curvatura né quota, quindi i
  // controlli qui sotto restano validi.
  placeSurfaces(segs, stage, rng);

  const last = segs[segs.length - 1];
  if (segs.length !== stage.lengthSegments) {
    throw new Error(`stage ${stage.id} built ${segs.length} segments, expected ${stage.lengthSegments}`);
  }
  if (last.p2.world.y !== 0 || last.curve !== 0) {
    throw new Error(`stage ${stage.id} does not close flat: y=${last.p2.world.y} curve=${last.curve}`);
  }
  return segs;
}

export interface ThemeScenery {
  /** Sprite a bordo strada del tema, scelti a caso. */
  names: readonly SpriteName[];
  /** Probabilità di piazzare un oggetto per segmento e per lato. */
  density: number;
}

/** Liste e densità per tema (spec §9): palme fitte in beach, cactus radi in desert. */
export const THEME_SCENERY: Record<ThemeId, ThemeScenery> = {
  beach: {
    names: [
      'beach_palm_1',
      'beach_palm_2',
      'beach_umbrella',
      'beach_hut',
      'beach_surf_sign',
      'beach_bush',
      'common_bush_1',
      'beach_bathers',
      // Set 2 (spec §13).
      'beach_lifeguard_tower',
      'beach_boat',
      'beach_rock_arch',
    ],
    density: 0.35,
  },
  desert: {
    names: [
      'desert_cactus_1',
      'desert_cactus_2',
      'desert_rock_1',
      'desert_rock_2',
      'desert_dead_tree',
      'desert_skull_sign',
      'common_boulder',
      // Set 2 (spec §13).
      'desert_pillar',
      'desert_bush_dry',
      'common_boulder_large',
      'common_sign_speed',
    ],
    density: 0.12,
  },
  alpine: {
    names: [
      'alpine_pine_1',
      'alpine_pine_2',
      'alpine_chalet',
      'alpine_fence',
      'alpine_rock',
      'alpine_cow',
      'common_bush_2',
      // Set 2 (spec §13).
      'alpine_snow_pine',
      'alpine_signpost',
      'common_bridge_pylon',
      'common_boulder_large',
    ],
    density: 0.3,
  },
  farm: {
    names: [
      'farm_haybale',
      'farm_windmill',
      'farm_barn',
      'farm_vine_row',
      'farm_oak',
      'farm_sunflowers',
      'common_bush_1',
      // Set 2 (spec §13).
      'farm_tractor',
      'farm_fence_wood',
      'farm_silo',
      'common_sign_speed',
    ],
    density: 0.2,
  },
  town: {
    names: [
      'town_arch',
      'town_column',
      'town_lamp',
      'town_facade',
      'town_fountain',
      'town_cypress',
      'common_bush_2',
      // Set 2 (spec §13).
      'town_cafe',
      'town_bus_stop',
      'town_tower',
      'common_lamp_highway',
    ],
    density: 0.25,
  },
};

/** Offset laterale minimo e massimo degli oggetti a bordo strada (spec §9). */
export const OFFSET_MIN = 1.1;
export const OFFSET_MAX = 2.5;
export const BILLBOARD_EVERY = 120;
/** Deviazione da spec §9: con l'ancoraggio al centro (§4.4) ±1.2 fisso pianterebbe
 * il cartellone sull'asfalto, quindi l'offset è il bordo interno a 1.2 più la
 * semilarghezza mondo del cartellone in unità di offset. */
export const BILLBOARD_OFFSET = 1.2 + CATALOG.common_billboard.scale;

/**
 * Allargamento massimo della doppia carreggiata (`addDualRoad`, spec §9), in
 * unità `x`. **Non** la zona di bivio: quella ha la sua forma a Y
 * (`forkZoneShape`, bivio v3).
 */
export const FORK_SPLIT_MAX = 0.8;

/** Interpolazione con le due estremità piatte: la strada si apre senza spigoli. Pura. */
export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Semilarghezza totale a `t` lungo la doppia carreggiata (`addDualRoad`,
 * spec §9), dalla base della tappa. **Non** usata dalla zona di bivio, che
 * usa `forkZoneShape` (bivio v3). Pura.
 */
export function forkRoadHalf(t: number, base = 1): number {
  return base + smoothstep(t) * (base + FORK_SPLIT_MAX);
}

/** Semilarghezza dell'isola: quanto la strada supera due carreggiate di base. Pura. */
export function forkMedian(roadHalf: number, base = 1): number {
  return Math.max(0, roadHalf - 2 * base);
}

/*
 * Zona di bivio v3: una Y vera (spec §4.4, **deroga «bivio v3, collaudo
 * utente»**, brief `.superpowers/sdd/fork-v3-brief.md`). La v2 allargava la
 * strada al doppio e poi apriva due carreggiate PARALLELE: vicino all'auto
 * se ne vedeva una sola e l'altra solo all'orizzonte. Qui:
 *
 * 1. per `FORK_TIP` segmenti la strada si allarga poco, fino a
 *    `FORK_TIP_HALF`, e la scelta resta libera;
 * 2. alla punta il lato si fissa (commit, `race.ts`) e i due rami si
 *    staccano ad angolo, ciascuno da metà della strada alla larghezza di
 *    base in `FORK_NECK` segmenti;
 * 3. ogni ramo prosegue come la strada che `race.ts` scrive al commit: una
 *    deriva laterale che si spegne in `FORK_DRIFT_DECAY` segmenti più la
 *    curva `forkTurnCurve`, che la sostituisce. La distanza fra i rami cresce
 *    sempre, e più che linearmente dove la curva tiene: in prospettiva i rami
 *    divergono fino all'orizzonte. Al commit la vista non cambia: la
 *    geometria statica **è** quella riscritta, vista da una telecamera che
 *    non ha ancora girato.
 *
 * Perché il commit sta alla punta: con questa telecamera (`PLAYER_Z`, 100°)
 * tutto ciò che sta oltre 30 segmenti si schiaccia in una fascia di 40 pixel
 * sopra l'orizzonte. Una Y leggibile deve aprirsi ad angolo vero (circa 18°
 * per ramo, `FORK_SPLIT_SLOPE`) già vicino all'auto, e un ramo così non si
 * insegue con lo sterzo (1/30 di unità per segmento al massimo): lo segue la
 * deriva, che dopo il commit porta con sé strada e telecamera.
 *
 * Indici `i` della zona da 0 (primo segmento) a `FORK_ZONE_SEGMENTS`
 * (capo lontano dell'ultimo).
 */

/**
 * Segmenti della zona prima della punta: qui si sceglie il lato. Pochi di
 * proposito: la Y si vede già da prima della zona, e chi tiene la freccia
 * per un secondo e mezzo a tavoletta (90 segmenti, 3 unità di sterzo) deve
 * arrivare alla punta ancora sulla strada e trovare subito il suo ramo che
 * curva dalla sua parte, con la centrifuga che lo riporta dentro.
 */
export const FORK_TIP = 30;
/** Primo segmento della zona in cui il lato è deciso (`race.ts`, commit): la punta. */
export const FORK_COMMIT = FORK_TIP;
/** Segmenti dopo la punta in cui un ramo cresce da metà strada alla base. */
export const FORK_NECK = 12;
/**
 * Semilarghezza alla punta, in unità `x` e **non** in basi della tappa
 * (deroga della revisione finale K): poco più larga del normale. Chi tiene
 * la freccia per un secondo e mezzo dalla corsia esterna si sposta di circa
 * un'unità prima della punta a qualunque base, perché lo sterzo non dipende
 * dalla larghezza della strada, e dopo la punta il suo ramo lo porta con sé
 * ma non lo riavvicina. Con 1,5 per base una punta di città o di montagna
 * (base 0,8) era larga 1,2 e lo lasciava sull'erba per quasi due secondi,
 * fino a 71 km/h; con la base 1 finiva sull'erba anche lì, a 107 km/h. Con
 * 1,7 per tutti resta fra asfalto e banchina, sopra i 120 km/h
 * (`fork-geometry.test.ts`).
 */
export const FORK_TIP_HALF = 1.7;
/**
 * Pendenza laterale di ciascun ramo alla punta, in basi per segmento: 0,05
 * sono 65 unità mondo ogni 200, circa 18°. Vista dal gambo della Y ogni ramo
 * arriva all'orizzonte a un quarto di mezzo schermo dal centro già senza la
 * curva, che poi lo porta più in là.
 */
export const FORK_SPLIT_SLOPE = 0.05;
/**
 * Segmenti dopo il commit su cui la deriva laterale del ramo si spegne. Più
 * lenti della curva che la sostituisce (`FORK_TURN_*`): la pendenza vista
 * dei rami non cala mai, quindi non tornano paralleli.
 */
export const FORK_DRIFT_DECAY = 80;
/** Curva dopo il commit: ingresso, pieno, uscita, in segmenti (spec §9). */
export const FORK_TURN_ENTER = 8;
export const FORK_TURN_HOLD = 40;
export const FORK_TURN_LEAVE = 25;
/**
 * Curvatura piena della curva dopo il commit: una curva facile (spec §9),
 * che la centrifuga lascia tenere a tavoletta (0,84 · 2 < `STEER_RATE`).
 */
export const FORK_TURN_CURVE = CURVE.easy;
/**
 * Segmenti in fondo alla zona su cui la strada scelta passa dalla base della
 * tappa vecchia a quella della tappa nuova (spiaggia 1, città 0,8).
 */
export const FORK_BASE_RAMP = 60;
/** Segmenti della zona dopo il commit. */
export const FORK_AFTER_COMMIT = FORK_ZONE_SEGMENTS - FORK_COMMIT;

/** Curvatura, senza segno, dell'`n`-esimo segmento dopo il commit. Pura. */
export function forkTurnCurve(n: number): number {
  if (n < 0) return 0;
  if (n < FORK_TURN_ENTER) return easeIn(0, FORK_TURN_CURVE, n / FORK_TURN_ENTER);
  if (n < FORK_TURN_ENTER + FORK_TURN_HOLD) return FORK_TURN_CURVE;
  const k = n - FORK_TURN_ENTER - FORK_TURN_HOLD;
  if (k < FORK_TURN_LEAVE) return easeInOut(FORK_TURN_CURVE, 0, k / FORK_TURN_LEAVE);
  return 0;
}

/**
 * Spostamento laterale, in unità mondo, del capo vicino dell'`n`-esimo
 * segmento dopo il commit, prodotto dalla curva `forkTurnCurve` con la
 * stessa ricorrenza di `updateVisible` (`x += dx; dx += curve`) da una
 * telecamera ferma prima del commit. Indici da 0 a `FORK_AFTER_COMMIT`.
 */
const TURN_X: readonly number[] = (() => {
  const out = [0];
  let dx = 0;
  for (let n = 0; n < FORK_AFTER_COMMIT; n++) {
    out.push(out[n] + dx);
    dx += forkTurnCurve(n);
  }
  return out;
})();

/**
 * Deriva laterale del ramo, in basi, al capo vicino dell'`n`-esimo segmento
 * dopo il commit: parte con la pendenza `FORK_SPLIT_SLOPE` e si spegne con
 * `smoothstep` in `FORK_DRIFT_DECAY` segmenti.
 */
const DRIFT: readonly number[] = (() => {
  const out = [0];
  for (let n = 0; n < FORK_AFTER_COMMIT; n++) {
    out.push(out[n] + FORK_SPLIT_SLOPE * (1 - smoothstep(n / FORK_DRIFT_DECAY)));
  }
  return out;
})();

/**
 * Deriva laterale della strada scelta dopo il commit, in unità `x`, al capo
 * vicino dell'`n`-esimo segmento (`n` da 0 a `FORK_AFTER_COMMIT`). `race.ts`
 * la scrive in `world.x`, moltiplicata per `ROAD_HALF` e per il lato. Pura.
 */
export function forkDrift(n: number, base = 1): number {
  return base * DRIFT[clamp(Math.round(n), 0, FORK_AFTER_COMMIT)];
}

/**
 * Semilarghezza di un ramo al capo vicino del segmento `i` della zona: da
 * metà della punta alla base in `FORK_NECK` segmenti. Pura.
 */
export function forkBranchHalf(i: number, base = 1): number {
  const k = clamp((i - FORK_TIP) / FORK_NECK, 0, 1);
  const tip = FORK_TIP_HALF / 2;
  return tip + (base - tip) * smoothstep(k);
}

/**
 * Centro di un ramo (il destro; il sinistro è opposto), in unità `x` dal
 * centro della zona, al capo vicino del segmento `i` della zona (da 0 a
 * `FORK_ZONE_SEGMENTS`). Prima della punta i rami non esistono ancora e vale
 * quanto alla punta. Pura.
 */
export function forkBranchCentre(i: number, base = 1): number {
  const n = clamp(Math.round(i - FORK_COMMIT), 0, FORK_AFTER_COMMIT);
  return FORK_TIP_HALF / 2 + forkDrift(n, base) + TURN_X[n] / ROAD_HALF;
}

/**
 * Forma statica della zona di bivio al capo vicino del segmento `i` (da 0 a
 * `FORK_ZONE_SEGMENTS`): prima della punta una strada sola che si allarga
 * fino a `FORK_TIP_HALF`, poi due rami di centro `±forkBranchCentre`
 * e semilarghezza `forkBranchHalf`, cioè `median = c - h` e
 * `roadHalf = c + h`. Continua alla punta. Pura.
 */
export function forkZoneShape(i: number, base = 1): { roadHalf: number; median: number } {
  if (i < FORK_TIP) {
    return { roadHalf: base + (FORK_TIP_HALF - base) * smoothstep(i / FORK_TIP), median: 0 };
  }
  const c = forkBranchCentre(i, base);
  const h = forkBranchHalf(i, base);
  return { roadHalf: c + h, median: Math.max(0, c - h) };
}

/**
 * Offset di uno sprite spostato verso l'esterno dall'allargamento della zona
 * di bivio (spec §4.4): quello che sta sull'asfalto (`|offset| < 1`) non si
 * muove, quello che sta al bordo o oltre segue il bordo esterno. Pura, e
 * usata **identica** dal renderer e dalle collisioni.
 */
export function forkOffset(offset: number, roadHalf: number): number {
  if (Math.abs(offset) < 1) return offset;
  return offset + (roadHalf - 1) * Math.sign(offset);
}

/**
 * Distanza, in unità `x`, fra il centro della strada scelta e quello della
 * scartata al capo lontano dell'ultimo segmento della zona, con base 1: è
 * dove comincia l'uscita dal bivio (spec §4.4, «Uscita dal bivio»). Due volte
 * il centro di un ramo, perché i rami sono simmetrici. `race.ts` usa il
 * valore vero della tappa (`discarded.far` dell'ultimo segmento), che con
 * base diversa da 1 cambia.
 */
export const FORK_EXIT_BASE_OFFSET = 2 * forkBranchCentre(FORK_ZONE_SEGMENTS);
/**
 * Di quanto la strada scartata si allontana ancora per segmento all'uscita
 * (bivio v3): la stessa pendenza con cui lasciava la zona, così il bordo non
 * fa gomiti alla giunzione.
 */
export const FORK_EXIT_SLOPE =
  2 * (forkBranchCentre(FORK_ZONE_SEGMENTS) - forkBranchCentre(FORK_ZONE_SEGMENTS - 1));

/**
 * Centro della carreggiata scartata all'uscita dal bivio, in unità `x`
 * (spec §4.4, «Uscita dal bivio»): `side` è la carreggiata scelta (quella
 * scartata sta sul lato opposto), `t` va da 0 (giunzione) a 1 (ultimo
 * segmento marcato). Bivio v3: prosegue in linea retta da dove la zona l'ha
 * lasciata, `start` più `slope` per segmento. Pura.
 */
export function forkExitOffset(
  side: -1 | 1,
  t: number,
  start: number = FORK_EXIT_BASE_OFFSET,
  slope: number = FORK_EXIT_SLOPE,
): number {
  return -side * (start + slope * t * (FORK_EXIT_SEGMENTS - 1));
}

/**
 * Frazione di `t` per cui la carreggiata scartata resta a piena larghezza,
 * prima di assottigliarsi (**deroga, terzo addendum del collaudo**: con
 * `forkExitHalf` lineare su tutto `[0, 1]` la strada scartata era già
 * sottile un istante dopo la giunzione, troppo presto per leggerla come una
 * strada vera).
 */
export const FORK_EXIT_HALF_HOLD = 0.6;

/**
 * Semilarghezza della carreggiata scartata a `t`: piena (la carreggiata di
 * base, `roadHalfBase = 1`) fino a `FORK_EXIT_HALF_HOLD`, poi lineare a zero
 * (spec §4.4, deroga del terzo addendum). Pura.
 */
export function forkExitHalf(t: number, roadHalfBase = 1): number {
  if (t <= FORK_EXIT_HALF_HOLD) return roadHalfBase;
  return roadHalfBase * (1 - (t - FORK_EXIT_HALF_HOLD) / (1 - FORK_EXIT_HALF_HOLD));
}

/**
 * Strada scartata di un segmento: quella scritta da `race.ts` in
 * `discarded`, o, per un segmento marcato solo con `forkExit`, quella di
 * riferimento con base 1 (`forkExitOffset`, `forkExitHalf`). `null` se il
 * segmento non ne ha. Pura.
 */
export function discardedRoadOf(seg: Segment): DiscardedRoad | null {
  if (seg.discarded !== undefined) return seg.discarded;
  const fe = seg.forkExit;
  if (fe === undefined) return null;
  const off = forkExitOffset(fe.side, fe.t);
  const half = forkExitHalf(fe.t);
  return { near: off, far: off, halfNear: half, halfFar: half };
}

/**
 * Oltre questa distanza, in unità `x`, il bordo interno della strada
 * scartata è abbastanza lontano da non toccare pareti, acqua e scenografia
 * del suo lato (bivio v3): la v2 la lasciava a 4-10 unità e le toglieva per
 * 288 segmenti; la Y la porta a più di 30, e la tappa nuova riavrà le sue
 * pareti e il suo mare dal primo segmento.
 */
export const FORK_EXIT_REACH = 12;

/**
 * Offset finale di uno sprite, dal centro del segmento, in unità `x`: quello
 * che il renderer disegna e che le collisioni controllano (usata **identica**
 * da `sprites.ts` e `traffic.ts`). Uno sprite `fixed` sta dov'è; gli altri
 * si spostano oltre la strada scartata se ci cadrebbero sopra (terzo
 * addendum del collaudo, generalizzato dal bivio v3: solo se la toccano),
 * poi seguono il bordo esterno (`forkOffset`). Pura.
 */
export function spriteOffsetOf(placed: PlacedSprite, seg: Segment): number {
  if (placed.fixed === true) return placed.offset;
  let raw = placed.offset;
  const road = discardedRoadOf(seg);
  if (road !== null && Math.sign(raw) === Math.sign(road.near)) {
    const inner = Math.abs(road.near) - road.halfNear;
    if (inner <= FORK_EXIT_REACH && Math.abs(raw) + SHOULDER_W >= inner) {
      raw = Math.sign(road.near) * (Math.abs(road.near) + road.halfNear + Math.abs(raw));
    }
  }
  return forkOffset(raw, seg.roadHalf);
}

/**
 * Vero se `side` (-1 sinistra, +1 destra, stessa convenzione di
 * `Segment.wall`) è il lato della strada scartata su questo segmento e lei è
 * abbastanza vicina (`FORK_EXIT_REACH`) da coprire pareti e acqua di quel
 * lato: lì non si piazzano né si disegnano (terzo addendum del collaudo). Pura.
 */
export function hidesDiscardedSide(side: -1 | 1, seg: Segment): boolean {
  const road = discardedRoadOf(seg);
  if (road === null || !(road.halfNear > 0) || Math.sign(road.near) !== side) return false;
  return Math.abs(road.near) - road.halfNear <= FORK_EXIT_REACH;
}

/**
 * Limiti laterali della fisica sul segmento (spec §5, `X_LIMIT`): dopo il
 * commit del bivio il bordo interno della strada scartata chiude il lato
 * scartato, che la fisica non vede (bivio v3). Pura.
 */
export function xLimitsOf(seg: Segment): { min: number; max: number } {
  const road = seg.fork === 'zone' ? (seg.discarded ?? null) : null;
  if (road === null) return { min: -X_LIMIT, max: X_LIMIT };
  const inner = Math.min(X_LIMIT, Math.abs(road.near) - road.halfNear);
  return road.near < 0 ? { min: -inner, max: X_LIMIT } : { min: -X_LIMIT, max: inner };
}

/**
 * Segna la strada scartata sui segmenti da `from` in poi per
 * `FORK_EXIT_SEGMENTS` (spec §4.4, «Uscita dal bivio»): `forkExit` per la
 * scenografia, `discarded` per il disegno, dritta da `start` con `slope` per
 * segmento. `t` è la frazione lineare. `race.ts` la chiama sulla tappa nuova
 * alla giunzione e, al commit, sui primi `count` segmenti della tappa
 * vecchia, che la telecamera vede oltre la fine della zona.
 */
export function markForkExit(
  segs: Segment[],
  side: -1 | 1,
  start: number,
  slope: number,
  base = 1,
  count: number = FORK_EXIT_SEGMENTS,
): void {
  const tOf = (i: number): number => Math.min(1, i / (FORK_EXIT_SEGMENTS - 1));
  const n = Math.min(count, FORK_EXIT_SEGMENTS, segs.length);
  for (let i = 0; i < n; i++) {
    const t = tOf(i);
    segs[i].forkExit = { side, t };
    segs[i].discarded = {
      near: -side * (start + slope * i),
      far: -side * (start + slope * (i + 1)),
      halfNear: forkExitHalf(t, base),
      halfFar: forkExitHalf(tOf(i + 1), base),
    };
  }
}

/**
 * Commit del bivio (bivio v3, spec §4.4): da `FORK_COMMIT` alla fine della
 * zona la strada del giocatore diventa la sola strada del segmento, e la
 * scartata diventa `discarded`. Riscrive `curve` (la curva verso il lato
 * scelto), `world.x` (la deriva che si spegne), `roadHalf` (il ramo che
 * cresce da metà strada, poi dalla base `base` a `nextBase` in fondo), `median = 0`, e riporta ogni sprite sulla
 * posizione che aveva, dal centro della strada scelta (`fixed`). Il disegno
 * visto dalla telecamera prima del commit non cambia. Ritorna di quanto
 * spostare `player.x` perché resti dov'era: `-side * forkBranchCentre(FORK_COMMIT)`.
 */
export function commitFork(segs: Segment[], side: -1 | 1, base = 1, nextBase = base): number {
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  const rampFrom = FORK_AFTER_COMMIT - FORK_BASE_RAMP;
  const halfAt = (n: number): number =>
    forkBranchHalf(FORK_COMMIT + n, base) + (nextBase - base) * smoothstep((n - rampFrom) / FORK_BASE_RAMP);
  for (let n = 0; n < FORK_AFTER_COMMIT; n++) {
    const i = FORK_COMMIT + n;
    const seg = segs[zoneStart + i];
    const centre = forkBranchCentre(i, base);
    for (const placed of seg.sprites) {
      placed.offset = spriteOffsetOf(placed, seg) - side * centre;
      placed.fixed = true;
    }
    // `+ 0`: niente zeri negativi da `side * 0` (la fine tappa chiede `curve === 0`).
    seg.curve = side * forkTurnCurve(n) + 0;
    seg.p1.world.x = side * forkDrift(n, base) * ROAD_HALF + 0;
    seg.p2.world.x = side * forkDrift(n + 1, base) * ROAD_HALF + 0;
    seg.roadHalf = halfAt(n);
    seg.roadHalfFar = halfAt(n + 1);
    seg.median = 0;
    seg.medianFar = 0;
    seg.discarded = {
      near: -side * 2 * centre,
      far: -side * 2 * forkBranchCentre(i + 1, base),
      halfNear: forkBranchHalf(i, base),
      halfFar: forkBranchHalf(i + 1, base),
    };
  }
  return -side * forkBranchCentre(FORK_COMMIT, base);
}

/**
 * Offset laterale di un oggetto: `u` in [0, 1] sceglie fra bordo e lontano,
 * `side` è -1 o 1. Il minimo tiene conto della mezza larghezza dell'oggetto,
 * perché l'ancora è in basso al centro (spec §4.4).
 */
export function sceneryOffset(entry: SpriteCatalogEntry, u: number, side: number): number {
  const lo = Math.min(OFFSET_MIN + entry.scale, OFFSET_MAX);
  return side * (lo + u * (OFFSET_MAX - lo));
}

/** Piazza gli oggetti a bordo strada, i cartelloni e gli oggetti della zona di bivio. */
export function placeScenery(segs: Segment[], stage: StageDef, rng: Rng): void {
  const theme = THEME_SCENERY[stage.theme];
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  for (let i = INTRO_SEGMENTS; i < zoneStart; i++) {
    for (const side of [-1, 1] as const) {
      if (rng.next() >= theme.density) continue;
      const name = rng.pick(theme.names);
      segs[i].sprites.push({ name, offset: sceneryOffset(CATALOG[name], rng.next(), side) });
    }
    if (i % BILLBOARD_EVERY === 0) {
      const side = (i / BILLBOARD_EVERY) % 2 === 0 ? -1 : 1;
      segs[i].sprites.push({ name: 'common_billboard', offset: side * BILLBOARD_OFFSET });
    }
  }
  // Zona di bivio: solo il portale con le frecce al centro (spec §4.4).
  // **Deroga, addendum del collaudo**: niente più fila di barriere
  // `common_barrier` al centro. Nei racer arcade dell'epoca al bivio non c'è
  // nessun ostacolo: la strada si apre e basta, e chi tiene il centro finisce
  // su un lato da solo. Con le barriere, chi guidava dritto ci sbatteva
  // proprio sulla punta dell'isola (testacoda, velocità a zero): l'isola è
  // già banchina (`surfaceOf`, `inForkZone`) con la spinta laterale
  // `ISLAND_NUDGE` che porta verso la carreggiata più vicina, e questo basta
  // a far scegliere un lato senza bisogno di un muro invisibile in mezzo.
  if (segs[zoneStart].fork === 'zone') {
    segs[zoneStart].sprites.push({ name: 'common_gantry', offset: 0 });
  }
}

// ---------------------------------------------------------------------------
// Pareti, acqua e dettagli di terreno (spec §4.4a, §4.4c)
// ---------------------------------------------------------------------------

/** Pareti per tema (spec §4.4c). */
export const THEME_WALLS: Record<ThemeId, readonly WallKind[]> = {
  beach: ['seawall', 'bridge_rail'],
  desert: ['rock_red'],
  alpine: ['rock_grey', 'guardrail'],
  farm: ['hedge'],
  town: ['town_facades', 'guardrail'],
};

/** Lunghezza di un tratto di parete, in segmenti (spec §4.4c). */
export const WALL_RUN_MIN = 80;
export const WALL_RUN_MAX = 400;
/** Segmenti liberi fra due tratti sullo stesso lato. */
export const WALL_SPACE_MIN = 120;
export const WALL_SPACE_MAX = 400;
/** Temi che possono avere pareti solo in curva (spec §4.4c: deserto). */
export const CURVE_WALL_THEMES: readonly ThemeId[] = ['desert'];
/** Curvatura assoluta che conta come curva per quei temi. */
export const CURVE_WALL_MIN = 2;
/** Quanti segmenti si cercano in avanti prima di rinunciare a una curva. */
export const CURVE_SEARCH = 240;

/** Temi con tratti d'acqua oltre la banchina (spec §4.4c). */
export const WATER_THEMES: readonly ThemeId[] = ['beach', 'town'];
export const WATER_RUN_MIN = 150;
export const WATER_RUN_MAX = 400;
export const WATER_RUNS_MAX = 3;
/** Le sole pareti che possono stare davanti all'acqua. */
export const WATER_WALLS: readonly WallKind[] = ['seawall', 'bridge_rail', 'guardrail'];

/** Dettagli del fuori strada (spec §4.4a). */
export const DETAIL_NAMES: readonly SpriteName[] = ['ground_tuft', 'ground_stone', 'ground_crack'];
export const DETAIL_EVERY_MIN = 4;
export const DETAIL_EVERY_MAX = 8;
export const DETAIL_OFFSET_MIN = 1.4;
/**
 * Spec §4.4a dice ±2.6, ma `placeScenery` ha già `OFFSET_MAX = 2.5` e
 * `tests/game/track-scenery.test.ts` lo verifica su **tutti** gli sprite
 * piazzati, dettagli compresi: un dettaglio a 2.58 farebbe fallire quel test.
 * Si sta dentro l'inviluppo che il tracciato già dichiara.
 */
export const DETAIL_OFFSET_MAX = 2.5;

/** Primo segmento della zona di bivio, o della coda del livello 4. */
function tailStart(segs: readonly Segment[]): number {
  return segs.length - FORK_ZONE_SEGMENTS;
}

/**
 * Tratti d'acqua su un lato (spec §4.4c). Va chiamata **prima** di
 * `placeWalls`, che sceglie il tipo di parete sapendo dov'è l'acqua.
 */
export function placeWater(segs: Segment[], stage: StageDef, rng: Rng): void {
  if (!WATER_THEMES.includes(stage.theme)) return;
  const zoneStart = tailStart(segs);
  const runs = rng.int(1, WATER_RUNS_MAX);
  for (let n = 0; n < runs; n++) {
    const side = rng.next() < 0.5 ? 'left' : 'right';
    const len = rng.int(WATER_RUN_MIN, WATER_RUN_MAX);
    const last = zoneStart - len;
    if (last <= INTRO_SEGMENTS) continue;
    const start = rng.int(INTRO_SEGMENTS, last);
    for (let i = start; i < Math.min(zoneStart, start + len); i++) segs[i].water = side;
  }
}

/** Il tratto [from, to) ha acqua su `side` in almeno un segmento. */
function touchesWater(segs: readonly Segment[], from: number, to: number, side: 'left' | 'right'): boolean {
  for (let i = from; i < to; i++) if (segs[i].water === side) return true;
  return false;
}

/**
 * Tratti di parete di 80-400 segmenti per lato (spec §4.4c), fuori dal
 * rettilineo di partenza e dalla zona di bivio. Nei temi di
 * `CURVE_WALL_THEMES` un tratto comincia solo su un segmento in curva.
 */
export function placeWalls(segs: Segment[], stage: StageDef, rng: Rng): void {
  const kinds = THEME_WALLS[stage.theme];
  if (kinds.length === 0) return;
  const zoneStart = tailStart(segs);
  const wantsCurve = CURVE_WALL_THEMES.includes(stage.theme);

  for (const side of ['left', 'right'] as const) {
    let i = INTRO_SEGMENTS + rng.int(0, WALL_SPACE_MAX);
    while (i + WALL_RUN_MIN <= zoneStart) {
      let start = i;
      if (wantsCurve) {
        let found = -1;
        for (let k = start; k < Math.min(zoneStart - WALL_RUN_MIN, start + CURVE_SEARCH); k++) {
          if (Math.abs(segs[k].curve) >= CURVE_WALL_MIN) {
            found = k;
            break;
          }
        }
        if (found < 0) {
          i = start + CURVE_SEARCH;
          continue;
        }
        start = found;
      }
      const end = Math.min(zoneStart, start + rng.int(WALL_RUN_MIN, WALL_RUN_MAX));
      // Davanti all'acqua passano solo le pareti di WATER_WALLS.
      const wet = touchesWater(segs, start, end, side);
      const usable = wet ? kinds.filter((k) => WATER_WALLS.includes(k)) : kinds;
      if (usable.length > 0) {
        const kind = rng.pick(usable);
        for (let k = start; k < end; k++) {
          const wall = segs[k].wall ?? {};
          wall[side] = kind;
          segs[k].wall = wall;
        }
      } else {
        // Nessuna parete adatta: l'rng avanza comunque, il tracciato resta
        // deterministico, e il tratto resta aperto sul mare.
        rng.next();
      }
      i = end + rng.int(WALL_SPACE_MIN, WALL_SPACE_MAX);
    }
  }
}

/**
 * Dettagli piccoli e non solidi nel fuori strada, uno ogni 4-8 segmenti a
 * `offset` ±1.4..±2.6 (spec §4.4a).
 */
export function placeGroundDetails(segs: Segment[], stage: StageDef, rng: Rng): void {
  const zoneStart = tailStart(segs);
  const span = DETAIL_OFFSET_MAX - DETAIL_OFFSET_MIN;
  let i = INTRO_SEGMENTS + rng.int(DETAIL_EVERY_MIN, DETAIL_EVERY_MAX);
  while (i < zoneStart) {
    const side = rng.next() < 0.5 ? -1 : 1;
    const name = rng.pick(DETAIL_NAMES);
    segs[i].sprites.push({ name, offset: side * (DETAIL_OFFSET_MIN + rng.next() * span) });
    i += rng.int(DETAIL_EVERY_MIN, DETAIL_EVERY_MAX);
  }
}

// ---------------------------------------------------------------------------
// Tratti di superficie: sterrato e neve (spec §4.4f)
// ---------------------------------------------------------------------------

/**
 * Di che superficie sono i tratti di un tema (spec §4.4f): terra battuta
 * in campagna e deserto, neve in montagna, niente in spiaggia e in
 * città — una spiaggia non ha strade di terra (ha sabbia **oltre** la
 * banchina, che è un'altra cosa) e una città ha l'asfalto. `null` vuol
 * dire «nessun tratto», non «asfalto»: l'asfalto è già il fondo.
 */
export const SURFACE_THEMES: Readonly<Record<ThemeId, SurfaceKind | null>> = {
  beach: null,
  desert: 'dirt',
  alpine: 'snow',
  farm: 'dirt',
  town: null,
};

/** Lunghezza di un tratto, in segmenti (spec §4.4f): da 24 a 60 secondi a velocità piena. */
export const SURFACE_RUN_MIN = 120;
/**
 * Tarato a 200 dal task 12 (leva 1): il margine peggiore di livello 4
 * (4-2 Windmill Coast, pioggia più sterrato) andava portato da 6,2 a
 * almeno 10 s senza toccare `LEVEL_TIME_LIMITS`. Accorciare i tratti non
 * cambia la sensazione di guida di un segmento, riduce solo quanti
 * segmenti la hanno.
 */
export const SURFACE_RUN_MAX = 200;
/**
 * Segmenti di rampa a ogni estremo di un tratto (spec §4.4f). Dodici
 * segmenti sono 2400 unità mondo, cioè circa un quinto di secondo a
 * velocità massima: abbastanza perché il colore cambi senza uno stacco,
 * poco perché non si perda la sensazione di entrare su un'altra strada.
 */
export const SURFACE_RAMP = 12;
/**
 * Lunghezza minima utile di un tratto: due rampe più un segmento di
 * corpo. Sotto questa, il tratto si salta invece di diventare due rampe
 * attaccate che non arrivano mai a `mix = 1`.
 */
export const SURFACE_RUN_MIN_USABLE = 2 * SURFACE_RAMP + 1;
/** Asfalto fra due tratti, in segmenti (spec §4.4f). */
export const SURFACE_SPACE_MIN = 300;
export const SURFACE_SPACE_MAX = 700;
/** Tratti al massimo per tappa (spec §4.4f). */
export const SURFACE_RUNS_MAX = 3;

/**
 * Miscela di un segmento dentro un tratto (spec §4.4f): 0 al primo e
 * all'ultimo segmento, 1 dopo `ramp` segmenti e fino a `ramp` dalla
 * fine, con `smoothstep` in mezzo. Su un tratto più corto di due rampe
 * la rampa si accorcia a metà lunghezza, così il centro arriva comunque
 * a 1. Un `offset` fuori dal tratto vale 0. Pura, e testata da sola: è
 * la sola formula che decide dove finisce l'asfalto e comincia la terra.
 */
export function surfaceRampMix(offset: number, length: number, ramp: number = SURFACE_RAMP): number {
  if (!(length > 0)) return 0;
  if (offset < 0 || offset >= length) return 0;
  const r = Math.min(ramp, Math.floor(length / 2));
  if (!(r > 0)) return 1;
  const fromStart = offset / r;
  const fromEnd = (length - 1 - offset) / r;
  return smoothstep(Math.min(fromStart, fromEnd));
}

/**
 * Dove un tratto che parte da `from` deve fermarsi, al più a `limit`
 * (spec §4.4f): al primo segmento della zona di bivio o di una doppia
 * carreggiata. Cambiare superficie dove la strada si divide renderebbe
 * illeggibile la scelta del bivio, e la doppia carreggiata è già
 * un'eccezione geometrica: due eccezioni sullo stesso segmento sono una
 * di troppo. Pura.
 */
export function surfaceRunEnd(segs: readonly Segment[], from: number, limit: number): number {
  for (let i = from; i < limit; i++) {
    if (segs[i].median > 0 || segs[i].fork !== undefined) return i;
  }
  return limit;
}

/**
 * Marca `[from, to)` con la superficie e la sua rampa. **Scrive**, non
 * somma: due tratti sovrapposti non possono portare `surfaceMix` sopra 1
 * (Review Focus 3). `placeSurfaces` li tiene comunque lontani almeno
 * `SURFACE_SPACE_MIN`, quindi la sovrapposizione non avviene; la regola
 * è qui perché il chiamante non debba fidarsi di quello.
 */
export function markSurfaceRun(segs: Segment[], from: number, to: number, kind: SurfaceKind): void {
  const length = to - from;
  for (let i = from; i < to; i++) {
    segs[i].surfaceKind = kind;
    segs[i].surfaceMix = surfaceRampMix(i - from, length);
  }
}

/**
 * Primo segmento da cui un tratto di superficie può cominciare: dopo il
 * rettilineo di partenza e dopo l'uscita dal bivio (revisione finale K),
 * dove il renderer disegna la strada scartata col fondo del segmento, che
 * altrimenti prenderebbe la terra o la neve del giocatore.
 */
export const SURFACE_FIRST = Math.max(INTRO_SEGMENTS, FORK_EXIT_SEGMENTS);

/**
 * Fino a `SURFACE_RUNS_MAX` tratti di sterrato o di neve per tappa
 * (spec §4.4f), fuori dal rettilineo di partenza e dall'uscita dal bivio
 * (`SURFACE_FIRST`), fuori dalla zona di bivio e fuori dalle doppie
 * carreggiate. **Va chiamata per ultima in
 * `buildTrack`**: consuma l'`Rng`, e infilarla prima di un'altra
 * passata cambierebbe ogni oggetto a bordo strada di tutte e quindici
 * le tappe. Non tocca né curvatura né quota: il tracciato resta quello
 * di prima, segmento per segmento.
 */
export function placeSurfaces(segs: Segment[], stage: StageDef, rng: Rng): void {
  const kind = SURFACE_THEMES[stage.theme];
  if (kind === null) return;
  const zoneStart = tailStart(segs);
  let i = INTRO_SEGMENTS + rng.int(0, SURFACE_SPACE_MAX);
  for (let placed = 0; placed < SURFACE_RUNS_MAX; placed++) {
    if (i + SURFACE_RUN_MIN_USABLE > zoneStart) return;
    const want = rng.int(SURFACE_RUN_MIN, SURFACE_RUN_MAX);
    // Un tratto che comincerebbe nell'uscita dal bivio perde la sua testa,
    // non si sposta: i tratti dopo restano dove la taratura li ha misurati.
    const from = Math.max(i, SURFACE_FIRST);
    const end = surfaceRunEnd(segs, from, Math.min(i + want, zoneStart));
    if (end - from >= SURFACE_RUN_MIN_USABLE) markSurfaceRun(segs, from, end, kind);
    // Si riparte da dove il tratto si è fermato, anche quando è stato
    // scartato: così un ostacolo (una doppia carreggiata) non fa girare
    // il ciclo a vuoto sullo stesso punto.
    i = Math.max(end, i + 1) + rng.int(SURFACE_SPACE_MIN, SURFACE_SPACE_MAX);
  }
}

// ---------------------------------------------------------------------------
// Cartelli di curva e spettatori (spec §13)
// ---------------------------------------------------------------------------

export const CHEVRON_NAME: SpriteName = 'common_sign_chevron';
/** Curvatura da cui una curva merita un cartello: media o più stretta. */
export const CHEVRON_MIN_CURVE = CURVE.medium;
/** Offset del cartello: fuori dall'asfalto, sul lato esterno. */
export const CHEVRON_OFFSET = 1.6;
/** Curvatura da cui una curva conta come stretta (spec §4.4e). */
export const HARD_CURVE = CURVE.hard;
/**
 * Primo segmento utile per un cartello di curva (chevron o segnale): non
 * nel rettilineo di partenza e non nell'uscita dal bivio, dove la strada
 * scartata resta visibile e un cartello confonderebbe la lettura della
 * scena (spec §4.4, «Uscita dal bivio»). `FORK_EXIT_SEGMENTS` (360) domina
 * su `INTRO_SEGMENTS` (60): stessa regola di `SURFACE_FIRST`, qui con nome
 * proprio perché parla di cartelli, non di sterrato.
 */
export const SIGN_ZONE_FIRST = Math.max(INTRO_SEGMENTS, FORK_EXIT_SEGMENTS);
/**
 * Un cartello ogni tanti segmenti nella fila che segna una curva (spec §13,
 * revisione «cartelli di curva visibili»): con `CHEVRON_ROW_STEP_MIN` a 6 e
 * `CHEVRON_ROW_STEP_MAX` a 8 si legge la spaziatura dei pannelli
 * dei racer arcade dell'epoca, non un singolo cartello isolato prima della curva.
 */
export const CHEVRON_ROW_STEP_MIN = 6;
export const CHEVRON_ROW_STEP_MAX = 8;
/** Minimo e massimo cartelli per fila (spec §13). */
export const CHEVRON_ROW_MIN = 3;
export const CHEVRON_ROW_MAX = 8;
/**
 * Quanti cartelli sul lato interno all'ingresso di una curva stretta (spec
 * §13): due, vicini fra loro, non una fila.
 */
export const CHEVRON_INNER_COUNT = 2;
export const CHEVRON_INNER_GAP = 4;

export const CROWD_NAME: SpriteName = 'common_crowd';
export const FLAGMAN_NAME: SpriteName = 'common_flagman';
/**
 * Quanti segmenti prima della fine sta l'uomo con la bandiera. **Non**
 * l'ultimo: `updateVisible` riporta la z in `[0, trackLength)`, quindi
 * all'inizio di una tappa la telecamera sta `PLAYER_Z` (4,2 segmenti) prima
 * della fine del tracciato, e gli ultimi segmenti le finiscono davanti a
 * distanza di un pixel. Uno sprite sull'ultimo segmento si proiettava con
 * scala fino a 0,006 invece di 0,0015 e copriva lo schermo per un fotogramma
 * appena entrati nella tappa. Dodici segmenti lo mettono comunque dietro la
 * telecamera in quell'istante, e restano cinque volte la distanza che serve a
 * vederlo arrivando al traguardo.
 */
export const FLAGMAN_FROM_END = 12;
/** Segmenti di folla alla partenza e prima del traguardo (spec §13). */
export const CROWD_SEGMENTS = 40;
/**
 * Primo segmento con la folla della partenza. **Non** lo zero, per la stessa
 * ragione di `FLAGMAN_FROM_END`: appena entrati in una tappa la telecamera
 * sta `PLAYER_Z` (4,2 segmenti) *prima* dello zero, quindi il giro di
 * `updateVisible` le mette davanti i primi segmenti a distanza di un pixel, e
 * una fila di spettatori larga mezza strada si proiettava a 2920 px, due
 * schermi e un quarto, per un fotogramma. Sei segmenti la tengono sotto i 600
 * px in quell'istante, e a `z = 0` la prima fila è comunque davanti al
 * giocatore, a 361 unità.
 */
export const CROWD_START = 6;
/** Una fila di spettatori ogni quanti segmenti. */
export const CROWD_EVERY = 4;
export const CROWD_OFFSET = 1.5;

// ---------------------------------------------------------------------------
// Portali di partenza, checkpoint e traguardo (spec §4.4e)
// ---------------------------------------------------------------------------

/**
 * Segmento su cui sta il portale di fine tappa (spec §4.4e): lo stesso
 * dell'uomo con la bandiera. Non è l'ultimo, perché la telecamera sta
 * `PLAYER_Z = 839` unità dietro al giocatore, cioè ~4,2 segmenti, e a
 * `player.z = 0` `updateVisible` riporta la posizione della telecamera
 * dentro il tracciato: i primi segmenti che il renderer incontra sono i
 * **penultimi** della stessa tappa, a distanza di un pixel.
 * `FLAGMAN_FROM_END` è la costante che `placeSpectators` usa già per
 * quella ragione, e i portali la riusano invece di raddoppiarla. Pura.
 */
export function portalIndex(segmentCount: number): number {
  return Math.max(0, segmentCount - 1 - FLAGMAN_FROM_END);
}
/** Quanti segmenti in coda alla tappa cadono nella finestra di avvolgimento. */
export const CAMERA_WRAP_GUARD = 6;
/** Offset laterale delle bandiere accanto ai portali. */
export const FLAG_OFFSET = 1.9;

export const START_GANTRY_NAME: SpriteName = 'race_start_gantry';
export const CHECKPOINT_NAME: SpriteName = 'race_checkpoint';
export const GOAL_NAME: SpriteName = 'race_goal';

/**
 * Portali e bandiere (spec §4.4e). Deterministica **senza rng**: si chiama
 * per ultima in `buildTrack` e non sposta di un pelo gli oggetti già
 * piazzati, così le 15 tappe restano quelle di prima più i portali.
 */
export function placePortals(segs: Segment[], stage: StageDef): void {
  // Il portale di partenza (col semaforo dipinto) sta solo sulla prima
  // tappa della gara (spec §4.4e, ruling del controllore): dopo un
  // checkpoint la tappa successiva non ricomincia una gara, quindi non
  // deve avere un secondo portale di partenza 19 segmenti dopo quello di
  // checkpoint. Sul segmento della prima fila di spettatori, non sullo
  // zero: a `player.z = 0` la telecamera sta `PLAYER_Z` unità *prima*
  // dello zero e `updateVisible` gli mette davanti i primi segmenti a
  // distanza di un pixel. `CROWD_START` è la costante che `placeSpectators`
  // usa già per la stessa ragione.
  if (stage.id === FIRST_STAGE_ID) {
    const start = Math.min(CROWD_START, segs.length - 1);
    segs[start].sprites.push({ name: START_GANTRY_NAME, offset: 0 });
    segs[start].sprites.push({ name: 'race_flag_left', offset: -FLAG_OFFSET });
    segs[start].sprites.push({ name: 'race_flag_right', offset: FLAG_OFFSET });
  }

  const at = portalIndex(segs.length);
  // `MIN_STAGE_SEGMENTS` garantisce almeno 420 segmenti, quindi `at` sta
  // sempre oltre il rettilineo di partenza; la guardia c'è perché
  // `placePortals` è esportata e qualcuno potrebbe chiamarla a mano.
  if (at <= INTRO_SEGMENTS) return;

  if (stage.id.startsWith('4-')) {
    segs[at].sprites.push({ name: GOAL_NAME, offset: 0 });
    segs[at].sprites.push({ name: 'race_finish_flags', offset: -FLAG_OFFSET });
    segs[at].sprites.push({ name: 'race_finish_flags', offset: FLAG_OFFSET });
    return;
  }
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  if (at < zoneStart || segs[at].fork !== 'zone') {
    segs[at].sprites.push({ name: CHECKPOINT_NAME, offset: 0 });
    segs[at].sprites.push({ name: 'race_flag_left', offset: -FLAG_OFFSET });
    segs[at].sprites.push({ name: 'race_flag_right', offset: FLAG_OFFSET });
    return;
  }
  // Bivio v3: il portale sta in fondo alla Y, dove i rami sono lontani. Uno
  // per ramo, sul suo centro (`fixed`, niente `forkOffset`): al commit
  // `commitFork` lascia quello scelto sulla strada del giocatore e porta
  // l'altro con la strada scartata, senza che nessuno dei due salti.
  const centre = forkBranchCentre(at - zoneStart, stage.roadHalf ?? 1);
  for (const side of [-1, 1] as const) {
    const c = side * centre;
    segs[at].sprites.push({ name: CHECKPOINT_NAME, offset: c, fixed: true });
    segs[at].sprites.push({ name: 'race_flag_left', offset: c - FLAG_OFFSET, fixed: true });
    segs[at].sprites.push({ name: 'race_flag_right', offset: c + FLAG_OFFSET, fixed: true });
  }
}

/**
 * Primo segmento di ogni tratto con curvatura almeno `minCurve`: è l'inizio
 * di curva che il cartello annuncia. Una chicane dà **un** indice, non due:
 * la curvatura non scende mai sotto la soglia fra le sue due metà. Pura.
 */
export function curveEntries(segs: readonly Segment[], minCurve: number = CHEVRON_MIN_CURVE): number[] {
  const out: number[] = [];
  let inside = false;
  for (let i = 0; i < segs.length; i++) {
    const strong = Math.abs(segs[i].curve) >= minCurve;
    if (strong && !inside) out.push(i);
    inside = strong;
  }
  return out;
}

/**
 * Fine (esclusa) del tratto forte che inizia a `entry`: il primo indice da
 * `entry` con `|curve| < minCurve`. Con una chicane la curvatura non scende
 * mai sotto la soglia fra le due metà (vedi `curveEntries`), quindi lo
 * stesso ciclo copre anche il cambio di segno senza fermarsi a metà. Pura.
 */
export function curveSpanEnd(
  segs: readonly Segment[],
  entry: number,
  minCurve: number = CHEVRON_MIN_CURVE,
): number {
  let i = entry;
  while (i < segs.length && Math.abs(segs[i].curve) >= minCurve) i++;
  return i;
}

/**
 * Quanti cartelli in fila per una curva lunga `span` segmenti con passo
 * `step` (spec §13), non meno di `CHEVRON_ROW_MIN` né più di
 * `CHEVRON_ROW_MAX`. Pura.
 */
function chevronRowCount(span: number, step: number): number {
  return clamp(Math.round(span / step) + 1, CHEVRON_ROW_MIN, CHEVRON_ROW_MAX);
}

/**
 * Una fila di cartelli sul lato esterno di ogni curva media o stretta, dal
 * suo ingresso per tutta la sua lunghezza, un cartello ogni 6-8 segmenti,
 * fra `CHEVRON_ROW_MIN` e `CHEVRON_ROW_MAX` per curva (spec §13, revisione
 * «cartelli di curva visibili»: a 250 km/h un solo cartello 8-16 segmenti
 * prima della curva non si notava). Sulle curve strette anche due cartelli
 * sul lato interno, vicini fra loro, all'ingresso. Con `curve > 0` la
 * strada gira a destra (la centrifuga di spec §5 spinge `x` verso il
 * negativo): l'esterno è a sinistra e il cartello va specchiato; il lato
 * interno è l'opposto, ma la punta segue sempre il verso della curva, non
 * il lato su cui sta il cartello.
 *
 * L'rng estrae **un solo numero per curva**, il passo della fila (6, 7 o
 * 8), riusato per tutti i suoi cartelli: esattamente come la versione
 * precedente estraeva un solo numero per curva (l'anticipo del cartello
 * isolato). Il conteggio dei cartelli e le posizioni interne sono pure, non
 * toccano l'rng: così questa funzione consuma dall'`Rng` la stessa quantità
 * di prima, curva per curva, e non sposta ciò che viene dopo in
 * `buildTrack` più di quanto lo sposti già il solo cambio di contenuto
 * della singola estrazione.
 */
export function placeChevrons(segs: Segment[], rng: Rng): void {
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  const inBounds = (at: number): boolean => at >= SIGN_ZONE_FIRST && at < zoneStart;
  for (const entry of curveEntries(segs)) {
    const step = rng.int(CHEVRON_ROW_STEP_MIN, CHEVRON_ROW_STEP_MAX);
    if (!inBounds(entry)) continue;
    const right = segs[entry].curve > 0;
    const end = curveSpanEnd(segs, entry);
    const count = chevronRowCount(end - entry, step);
    for (let k = 0; k < count; k++) {
      const at = entry + k * step;
      if (!inBounds(at)) break;
      // La punta segue il verso locale della curva: in una chicane il segno
      // si ribalta a metà fila, non solo all'ingresso.
      const local = segs[Math.min(at, segs.length - 1)].curve > 0;
      segs[at].sprites.push({
        name: CHEVRON_NAME,
        offset: (local ? -1 : 1) * CHEVRON_OFFSET,
        flip: local,
      });
    }
    if (Math.abs(peakCurve(segs, entry)) >= HARD_CURVE) {
      for (let k = 0; k < CHEVRON_INNER_COUNT; k++) {
        const inner = entry + k * CHEVRON_INNER_GAP;
        if (!inBounds(inner)) continue;
        segs[inner].sprites.push({
          name: CHEVRON_NAME,
          offset: (right ? 1 : -1) * CHEVRON_OFFSET,
          flip: right,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cartelli di bivio e segnali di curva (spec §4.4e)
// ---------------------------------------------------------------------------

/** Offset laterale dei cartelli del bivio, appena fuori dall'asfalto. */
export const FORK_SIGN_OFFSET = 1.5;
/**
 * Segmenti della zona di bivio a cui stanno le tre coppie di cartelli:
 * all'ingresso, a metà strada dalla punta e alla punta (bivio v3: tutte
 * prima del commit, dove la scelta è ancora aperta; dopo, un cartello
 * accanto al ramo scartato non servirebbe a niente).
 */
export const FORK_SIGN_AT: readonly number[] = [0, FORK_TIP / 2, FORK_TIP];

/**
 * Tre coppie di cartelli nella zona di bivio (spec §4.4e): i due
 * tabelloni verdi con la freccia all'inizio della zona, e i pannelli a
 * chevron verso la punta dell'isola. Tutti **non solidi**: la zona di bivio
 * è dove chi gioca si sposta da un lato all'altro, e un ostacolo lì
 * sarebbe una trappola. Il portale con le frecce (`common_gantry`, spec
 * §4.4) resta dov'è: i cartelli gli stanno accanto, non al suo posto.
 * Deterministica **senza rng**.
 */
export function placeForkSigns(segs: Segment[], _stage: StageDef): void {
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  if (zoneStart < 0 || segs[zoneStart].fork !== 'zone') return;
  const limit = segs.length - CAMERA_WRAP_GUARD;
  for (let k = 0; k < FORK_SIGN_AT.length; k++) {
    const at = zoneStart + FORK_SIGN_AT[k];
    if (at >= limit) continue;
    const left = k === 0 ? 'race_fork_left' : 'race_direction_left';
    const right = k === 0 ? 'race_fork_right' : 'race_direction_right';
    segs[at].sprites.push({ name: left, offset: -FORK_SIGN_OFFSET });
    segs[at].sprites.push({ name: right, offset: FORK_SIGN_OFFSET });
  }
}

/**
 * Probabilità che una curva **media** si guadagni un disco di velocità
 * (spec §13, revisione «cartelli di curva visibili»): resta quella di
 * prima. Le curve **strette** non tirano più a sorteggio: il triangolo di
 * pericolo è sempre lì, spec §4.4e punto 3.
 */
export const CURVE_SIGN_CHANCE = 0.3;
/** Offset del segnale: oltre il chevron, fuori dalla banchina. */
export const CURVE_SIGN_OFFSET = 1.95;
/** Quanti segmenti prima di una curva media sta il disco di velocità. */
export const CURVE_SIGN_LEAD_MIN = 20;
export const CURVE_SIGN_LEAD_MAX = 30;
/**
 * Quanti segmenti prima di una curva stretta sta il triangolo di pericolo
 * (spec §13, revisione «cartelli di curva visibili»): 25-35, non 20-30,
 * perché ora compare **sempre**, non nel 30% dei casi, e merita un preavviso
 * un po' più lungo di quello del disco di velocità sulle curve medie.
 */
export const CAUTION_SIGN_LEAD_MIN = 25;
export const CAUTION_SIGN_LEAD_MAX = 35;
export const CAUTION_SIGN_NAME: SpriteName = 'race_caution_sign';
export const SPEED_SIGN_NAME: SpriteName = 'race_speed_sign';

/**
 * Curvatura di picco della curva che comincia a `entry`, con il suo segno.
 * Serve perché `curveEntries` scatta sul **primo** segmento che supera
 * `CHEVRON_MIN_CURVE`, e quel segmento sta ancora nella rampa d'ingresso
 * (spec §4.3): misurato sulle 15 tappe vere, 140 ingressi di curva e
 * **nessuno** con `|curve| >= HARD_CURVE`, massimo 4,41. Giudicando dalla
 * rampa, `race_caution_sign` non si piazzerebbe mai. Pura.
 */
export function peakCurve(segs: readonly Segment[], entry: number): number {
  let peak = segs[entry].curve;
  for (let i = entry; i < segs.length && Math.abs(segs[i].curve) >= CHEVRON_MIN_CURVE; i++) {
    if (Math.abs(segs[i].curve) > Math.abs(peak)) peak = segs[i].curve;
  }
  return peak;
}

/**
 * Un segnale prima di una curva (spec §4.4e, revisione «cartelli di curva
 * visibili»): triangolo di pericolo **sempre** per le curve strette (25-35
 * segmenti prima), disco di velocità nel 30% dei casi per le medie (20-30
 * segmenti prima). Sul lato esterno, specchiato quando la curva va a
 * destra, come i chevron di §13.
 *
 * Va chiamata **dopo** `placeChevrons` e **prima** di qualunque altra
 * funzione che usi l'rng: una curva stretta non tira più a sorteggio
 * («sempre», non il 30%), ma consuma comunque un numero per il preavviso
 * (`rng.int`); una curva media consuma ancora prima il sorteggio
 * (`rng.next`) e poi, se lo passa, il preavviso. Spostarla sposterebbe
 * tutto ciò che viene dopo. Oggi niente usa l'rng dopo di lei.
 */
export function placeCurveSigns(segs: Segment[], rng: Rng): void {
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  const inBounds = (at: number): boolean => at >= SIGN_ZONE_FIRST && at < zoneStart;
  // Curve dure già coperte dal sorteggio qui sotto: il rincalzo più in
  // basso non le tocca due volte.
  const coveredHard = new Set<number>();
  // Lo stesso identico sorteggio di prima, entrata per entrata: una
  // `next()`, e solo se supera la soglia una `int()`. Cambiano solo il
  // nome e l'intervallo dell'anticipo per una curva dura (25-35, non
  // 20-30): il **consumo** dell'rng resta quello di prima, entrata per
  // entrata, quindi `placeRoadsideLife`/`placeSailboats`/`placeSurfaces`
  // vedono lo stesso stato residuo di prima di questa revisione.
  for (const entry of curveEntries(segs)) {
    // La curva si giudica dal suo **picco**, non dalla rampa d'ingresso:
    // altrimenti nessuna risulta stretta e il triangolo di pericolo non
    // si piazzerebbe mai (spec §4.4e).
    const hard = Math.abs(peakCurve(segs, entry)) >= HARD_CURVE;
    const right = segs[entry].curve > 0;
    if (rng.next() >= CURVE_SIGN_CHANCE) continue;
    const at = hard
      ? entry - rng.int(CAUTION_SIGN_LEAD_MIN, CAUTION_SIGN_LEAD_MAX)
      : entry - rng.int(CURVE_SIGN_LEAD_MIN, CURVE_SIGN_LEAD_MAX);
    if (!inBounds(at)) continue;
    segs[at].sprites.push({
      name: hard ? CAUTION_SIGN_NAME : SPEED_SIGN_NAME,
      offset: (right ? -1 : 1) * CURVE_SIGN_OFFSET,
      flip: right,
    });
    if (hard) coveredHard.add(entry);
  }
  // Rincalzo senza rng (spec §4.4e punto 3: il triangolo è **sempre** lì
  // su una curva dura, non nel 30% dei casi): un anticipo fisso, il
  // centro di 25-35, per ogni curva dura che il sorteggio qui sopra non
  // ha già coperto. Non tocca l'rng: `placeSurfaces` e chi viene dopo non
  // ne risentono.
  const fixedLead = Math.round((CAUTION_SIGN_LEAD_MIN + CAUTION_SIGN_LEAD_MAX) / 2);
  for (const entry of curveEntries(segs)) {
    if (coveredHard.has(entry) || Math.abs(peakCurve(segs, entry)) < HARD_CURVE) continue;
    const at = entry - fixedLead;
    if (!inBounds(at)) continue;
    const right = segs[entry].curve > 0;
    segs[at].sprites.push({ name: CAUTION_SIGN_NAME, offset: (right ? -1 : 1) * CURVE_SIGN_OFFSET, flip: right });
  }
}

// ---------------------------------------------------------------------------
// Vita a bordo strada (spec §13)
// ---------------------------------------------------------------------------

export interface ThemeLife {
  /** Chi si vede in questo tema. */
  names: readonly SpriteName[];
  /** Probabilità di piazzare qualcuno, per segmento e per lato. */
  density: number;
}

/**
 * Chi guarda passare, per tema (spec §13). Densità molto più bassa della
 * scenografia: una figura è un evento, non un arredo. **Deroga
 * dichiarata:** `npc_cyclist` è fermo a bordo strada. Un ciclista che
 * avanza vorrebbe essere un `Car`, e il traffico di §6 tira i `Car` verso
 * il centro delle corsie e li conta nei sorpassi.
 */
export const THEME_LIFE: Record<ThemeId, ThemeLife> = {
  beach: { names: ['npc_surfer', 'npc_photographer', 'npc_couple', 'npc_dog'], density: 0.02 },
  desert: { names: ['npc_photographer', 'npc_couple'], density: 0.008 },
  alpine: { names: ['npc_sheep', 'npc_cyclist', 'npc_photographer', 'npc_dog'], density: 0.014 },
  farm: { names: ['npc_sheep', 'npc_cyclist', 'npc_dog', 'npc_couple'], density: 0.018 },
  town: { names: ['npc_photographer', 'npc_couple', 'npc_dog', 'npc_cyclist'], density: 0.02 },
};

/** Segmenti minimi fra due comparse dello stesso nome (spec §13). */
export const LIFE_MIN_GAP = 60;
/** Offset laterale: appena fuori dall'asfalto, dove si vedono bene. */
export const LIFE_OFFSET_MIN = 1.15;
export const LIFE_OFFSET_MAX = 1.45;

/**
 * Gente, cani e pecore a bordo strada (spec §13): densità bassa per tema,
 * mai lo stesso nome a meno di `LIFE_MIN_GAP` segmenti, deterministica dal
 * seme. Va chiamata **dopo** ogni altra funzione che usa l'rng del
 * tracciato, così non sposta ciò che c'era prima.
 */
export function placeRoadsideLife(segs: Segment[], stage: StageDef, rng: Rng): void {
  const life = THEME_LIFE[stage.theme];
  if (life.names.length === 0) return;
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  const span = LIFE_OFFSET_MAX - LIFE_OFFSET_MIN;
  const lastAt = new Map<SpriteName, number>();
  for (let i = INTRO_SEGMENTS; i < zoneStart; i++) {
    for (const side of [-1, 1] as const) {
      // Un numero per segmento e per lato, sempre: il conteggio dei
      // sorteggi non dipende da chi finisce dove, quindi il tracciato
      // resta lo stesso a ogni costruzione.
      if (rng.next() >= life.density) continue;
      const name = rng.pick(life.names);
      const u = rng.next();
      const before = lastAt.get(name);
      if (before !== undefined && i - before < LIFE_MIN_GAP) continue;
      lastAt.set(name, i);
      segs[i].sprites.push({ name, offset: side * (LIFE_OFFSET_MIN + u * span) });
    }
  }
}

/** Una barca ogni tanto, e solo dove c'è acqua. */
export const SAILBOAT_EVERY = 220;
export const SAILBOAT_OFFSET = 2.4;
export const SAILBOAT_NAME: SpriteName = 'npc_sailboat';

/**
 * Barche a vela sull'acqua del tema spiaggia (spec §13): si piazzano solo
 * sui segmenti che `placeWater` ha marcato, e sul lato dell'acqua, quindi
 * non finiscono mai su un prato. Fuori dai primi `FORK_EXIT_SEGMENTS` e
 * dalla zona di bivio in coda: in entrambe le finestre la geometria della
 * strada può cambiare a runtime (uscita dal bivio, `race.ts markForkExit`;
 * bivio v3), e `road.ts` non disegna l'acqua sul lato scartato, quindi una
 * barca piazzata lì in base alla geometria di `buildTrack` finirebbe sulla
 * sabbia.
 */
export function placeSailboats(segs: Segment[], stage: StageDef, rng: Rng): void {
  if (stage.theme !== 'beach') return;
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  let i = FORK_EXIT_SEGMENTS + rng.int(0, SAILBOAT_EVERY);
  while (i < zoneStart) {
    const water = segs[i].water;
    if (water !== undefined) {
      segs[i].sprites.push({ name: SAILBOAT_NAME, offset: (water === 'left' ? -1 : 1) * SAILBOAT_OFFSET });
    }
    i += rng.int(SAILBOAT_EVERY, SAILBOAT_EVERY * 2);
  }
}

/**
 * Spettatori alla partenza e prima del traguardo, e l'uomo con la bandiera
 * poco prima della fine delle tappe di livello 4 (spec §13), a
 * `FLAGMAN_FROM_END` segmenti dall'ultimo. Deterministica senza rng: i lati
 * si alternano contando le file.
 */
export function placeSpectators(segs: Segment[], stage: StageDef): void {
  const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
  let row = 0;
  const line = (from: number, to: number): void => {
    for (let i = Math.max(0, from); i < Math.min(to, segs.length); i += CROWD_EVERY) {
      const side = row++ % 2 === 0 ? -1 : 1;
      segs[i].sprites.push({ name: CROWD_NAME, offset: side * CROWD_OFFSET });
    }
  };
  line(CROWD_START, CROWD_START + CROWD_SEGMENTS);
  line(zoneStart - CROWD_SEGMENTS, zoneStart);
  if (stage.id.startsWith('4-')) {
    const at = Math.max(0, segs.length - 1 - FLAGMAN_FROM_END);
    segs[at].sprites.push({ name: FLAGMAN_NAME, offset: CROWD_OFFSET });
  }
}
