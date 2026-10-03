import { CATALOG } from '../art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import { DEFAULT_CAR } from '../game/car';
import { KMH_AT_MAX, SHOULDER_W } from '../game/player';
import { SIDES } from './ground';
import { FAR_WINDOW, windowProgress } from './palette';
import type { ThemePalette } from './palette';
import { CAMERA_HEIGHT, PLAYER_Z, ROAD_WIDTH, SEGMENT_LENGTH } from './project';
import type { AssetStore, CarChoice, RaceSnapshot, Segment, SpriteName, ThemeId, Weather } from '../types';
import { DOMINANT_MIX, surfaceBlendOf, wetnessOf, type SurfaceBlend } from '../game/surface';

// Tabella della spec §4.4b.
/**
 * Particelle vive al massimo: oltre, la più vecchia viene riciclata. Il tetto
 * deve coprire un'intera vita di emissione, cioè
 * `2 · SKID_SMOKE_PER_WHEEL · 60 · SMOKE_LIFE = 252`: con 96 il riciclo
 * arrivava dopo 16 tick (0,27 s), le nuvolette non avevano tempo di
 * allontanarsi dalla ruota e si sovrapponevano in due dischi bianchi invece
 * di un pennacchio (deroga a spec §4.4b, che chiedeva 48).
 */
export const MAX_PARTICLES = 256;
/** Fumo di derapata: 3 particelle per ruota posteriore per tick. */
export const SKID_SMOKE_PER_WHEEL = 3;
/**
 * Fumo di partenza (burnout): 2 particelle per ruota per tick, come lo
 * spunto dei racer arcade dell'epoca; stesse particelle del fumo di derapata.
 */
export const BURNOUT_SMOKE_PER_WHEEL = 2;
export const DUST_PER_WHEEL = 2;
export const SMOKE_LIFE = 0.7;
export const DUST_LIFE = 0.6;
export const SMOKE_R0 = 10;
export const SMOKE_R1 = 40;
export const DUST_R0 = 10;
export const DUST_R1 = 36;
/** Pixel al secondo verso l'alto: il fumo sale, la polvere meno. */
export const SMOKE_RISE = 45;
export const DUST_RISE = 14;
/** Il fumo va da 0.85 a 0 di alfa; la polvere non è cambiata dal task 21. */
export const SMOKE_ALPHA = 0.85;
export const DUST_ALPHA = 0.55;
/** Sotto questa frazione di velocità il fuori strada non alza polvere. */
export const DUST_MIN_SPEED = 0.1;
/**
 * Sopra questa frazione di velocità l'acceleratore tenuto non è più uno
 * spunto da fermo: non c'è più fumo di partenza (spec §4.4b).
 */
export const BURNOUT_MAX_SPEED = 0.18;
/** rgba(240,240,240) di spec §4.4b: l'alfa la mette `globalAlpha`. */
export const SMOKE_COLOR = '#f0f0f0';
/**
 * Larghezza e altezza a schermo dell'auto del giocatore: la stessa formula di
 * `playerCarSize` (`PLAYER_SCALE = 1 / CAMERA_HEIGHT`), riscritta qui per non
 * importare `world.ts`, che importa questo file. Le proporzioni sono quelle
 * del frame dritto in `public/sprites/manifest.json`: 274×200 dal Set 7
 * (la cabrio del Set 7 è più alta in proporzione della vecchia, 320×200).
 */
export const PLAYER_DW = (CATALOG.player_straight.scale * ROAD_WIDTH * (LOGICAL_W / 2)) / CAMERA_HEIGHT;
export const PLAYER_ASPECT = 200 / 274;
export const PLAYER_DH = PLAYER_DW * PLAYER_ASPECT;
/**
 * Ruote posteriori, appena fuori il fianco dell'auto e all'altezza del mozzo
 * (spec §4.4b: le nuvolette coprono «la parte bassa delle ruote»). A
 * `0.04 · PLAYER_DH` il centro cadeva a 6 px dal fondo dello schermo e metà
 * nuvoletta finiva fuori dal canvas.
 */
/** Sul frame dritto del Set 7 i centri delle ruote stanno a ±0.41 della larghezza. */
export const WHEEL_DX = 0.41 * PLAYER_DW;
export const WHEEL_Y_FROM_BOTTOM = 0.18 * PLAYER_DH;
/**
 * Dove sta la ruota posteriore sul frame dritto di ciascuna auto
 * (`CarChoice`), misurata sul PNG lavorato (`public/sprites/player_straight.png`,
 * `player_classic_straight.png`, `player_retro_straight.png`,
 * `player_sport_straight.png`, `player_super_straight.png`, tutti 200 px di altezza): `dx` è la distanza
 * fra il centro del battistrada e il centro dell'auto, in frazione della
 * LARGHEZZA nativa dello sprite; `aspect` è l'altezza nativa sulla larghezza
 * nativa (`h/w`), la stessa proporzione con cui `playerCarSize` disegna
 * l'auto (spec §4.4 punto 5). Le voci esistono perché le auto, benché
 * disegnate alla stessa larghezza a schermo (`CATALOG` le scala tutte a
 * 0.14, `PLAYER_DW` non dipende dall'auto), hanno proporzioni native
 * diverse: la cabrio nuova del Set 7 è 274×200; la classica 313×200, più
 * larga in proporzione, con il battistrada un poco più vicino al centro; la
 * retrò 249×200 con le gomme strette un poco più verso il centro; la
 * sportiva 255×200 con le gomme larghe quasi sul bordo; la supercar
 * 331×200, bassa e larga, con le gomme a 0.415. La voce `new`
 * riproduce esattamente `WHEEL_DX`/`PLAYER_ASPECT` sopra, in frazione
 * invece che in pixel. Tabella pura.
 */
export const WHEELS_BY_CAR: Readonly<Record<CarChoice, { dx: number; aspect: number }>> = {
  new: { dx: 0.41, aspect: PLAYER_ASPECT },
  classic: { dx: 0.401, aspect: 200 / 313 },
  retro: { dx: 0.397, aspect: 200 / 249 },
  sport: { dx: 0.421, aspect: 200 / 255 },
  super: { dx: 0.415, aspect: 200 / 331 },
};

/** Altezza a schermo dell'auto `car` (spec §4.4 punto 5, `playerCarSize`): stessa
 * larghezza per tutte (`PLAYER_DW`), altezza secondo la proporzione nativa
 * del proprio frame dritto (`WHEELS_BY_CAR`). Pura. */
export function playerDHFor(car: CarChoice): number {
  return PLAYER_DW * WHEELS_BY_CAR[car].aspect;
}

/** Distanza dal centro dello schermo del centro del battistrada di `car`, in
 * pixel (spec §4.4b). Pura. */
export function wheelDXFor(car: CarChoice): number {
  return WHEELS_BY_CAR[car].dx * PLAYER_DW;
}

/** Quanto sopra il fondo dello schermo nasce il fumo/polvere di `car` (spec
 * §4.4b): stessa proporzione (0.18) di `WHEEL_Y_FROM_BOTTOM`, applicata
 * all'altezza a schermo dell'auto scelta. Pura. */
export function wheelYFromBottomFor(car: CarChoice): number {
  return 0.18 * playerDHFor(car);
}
/** Sbandamento della nascita attorno alla ruota, in pixel. */
export const SPAWN_SPREAD_X = 14;
export const SPAWN_SPREAD_Y = 10;
/**
 * Il fumo deriva verso l'esterno a velocità costante (spec §4.4b). A 40 px/s
 * e con la vita utile del pennacchio le nuvolette restavano impilate sulla
 * ruota: a 90 il pennacchio si apre a ventaglio come nei racer arcade dell'epoca.
 */
export const SMOKE_OUTWARD_DRIFT = 90;
/** Deriva laterale massima della polvere, pixel al secondo. */
export const DUST_DRIFT = 26;

// ---------------------------------------------------------------------------
// Particelle nuove del binario I (spec §4.4b).
// ---------------------------------------------------------------------------

/** Terra bruna dello sterrato (fango, non sabbia). */
export const MUD_COLOR = '#8a5a30';
/** Neve sollevata: bianca con un filo d'azzurro, distinta dai fiocchi (`SNOW_COLOR`). */
export const SNOW_SPRAY_COLOR = '#eef4ff';

/** Temi in cui il fuori strada alza erba e paglia invece di polvere. */
export const GRASS_THEMES: readonly ThemeId[] = ['farm', 'alpine'];
/** Frazione di velocità oltre cui compaiono le righe di velocità. */
export const SPEED_LINES_MIN = 0.9;
/**
 * Detriti e scintille di un incidente, in un solo tick. I detriti sono
 * metà pezzi grossi (`fx_debris_large`) e metà ghiaia
 * (`fx_debris_small`): il PNG della ghiaia è una striscia piatta di
 * 300×70, che da sola darebbe solo trattini.
 */
export const CRASH_DEBRIS = 24;
export const CRASH_SPARKS = 18;
/** Velocità di partenza dei detriti e delle scintille, px/s. */
export const CRASH_DEBRIS_SPEED = 320;
export const CRASH_SPARK_SPEED = 620;
/** Righe di velocità: due per tick, e quanto corrono. */
export const SPEED_LINES_PER_TICK = 2;
export const SPEED_LINE_VX = 900;
export const SPEED_LINE_VY = 260;
/** Spruzzi d'acqua per ruota per tick. */
export const SPLASH_PER_WHEEL = 2;

export type ParticleKind =
  | 'smoke'
  | 'dust'
  | 'grass'
  | 'debris'
  | 'gravel'
  | 'spark'
  | 'splash'
  | 'impact'
  | 'speedline'
  | 'mud'
  | 'snowspray';

export interface ParticleSpec {
  /** Secondi di vita. */
  life: number;
  /** Raggio in pixel a inizio e a fine vita. */
  r0: number;
  r1: number;
  /** Alfa a inizio vita; scende a zero alla fine. */
  alpha: number;
  /** Colore del cerchio di ripiego; `null` = `shoulderDark` del tema. */
  colour: string | null;
  /** Sprite del catalogo, disegnato con `drawImage` quando ha misura. */
  sprite: SpriteName;
  /** Accelerazione verso il basso, px/s². */
  gravity: number;
  /**
   * Colore con cui ritingere lo sprite, o assente per disegnarlo com'è.
   * Serve alla terra e alla neve, che riusano la nuvola di polvere (color
   * sabbia) invece di chiedere due PNG nuovi.
   */
  tint?: string;
}

/**
 * Tutto ciò che distingue un tipo di particella dall'altro, in un posto
 * solo (spec §4.4b). Fumo e polvere riusano le costanti che il binario H
 * ha già tarato a occhio sullo schermo, così il loro comportamento non
 * cambia di un pixel.
 */
export const PARTICLE_SPECS: Readonly<Record<ParticleKind, ParticleSpec>> = {
  smoke: { life: SMOKE_LIFE, r0: SMOKE_R0, r1: SMOKE_R1, alpha: SMOKE_ALPHA, colour: SMOKE_COLOR, sprite: 'fx_smoke', gravity: 0 },
  dust: { life: DUST_LIFE, r0: DUST_R0, r1: DUST_R1, alpha: DUST_ALPHA, colour: null, sprite: 'fx_dust_small', gravity: 0 },
  grass: { life: DUST_LIFE, r0: 10, r1: 34, alpha: 0.7, colour: '#3f8f4f', sprite: 'fx_grass_spray', gravity: 240 },
  debris: { life: 0.55, r0: 12, r1: 20, alpha: 0.95, colour: '#8a8a94', sprite: 'fx_debris_large', gravity: 900 },
  gravel: { life: 0.5, r0: 7, r1: 11, alpha: 0.9, colour: '#6f6f79', sprite: 'fx_debris_small', gravity: 900 },
  spark: { life: 0.35, r0: 7, r1: 3, alpha: 1, colour: '#ffd23f', sprite: 'fx_sparks', gravity: 300 },
  splash: { life: 0.5, r0: 12, r1: 38, alpha: 0.8, colour: '#57b8e0', sprite: 'fx_water_splash', gravity: 200 },
  impact: { life: 0.4, r0: 40, r1: 120, alpha: 0.9, colour: '#ffcc55', sprite: 'fx_impact', gravity: 0 },
  speedline: { life: 0.25, r0: 30, r1: 70, alpha: 0.6, colour: '#9ad3ff', sprite: 'fx_speed_lines', gravity: 0 },
  // Terra dello sterrato: bruna, pesante, ricade presto.
  mud: { life: SMOKE_LIFE, r0: 10, r1: 38, alpha: 0.95, colour: MUD_COLOR, sprite: 'fx_dust_small', gravity: 90, tint: MUD_COLOR },
  // Neve sollevata dalle ruote: bianca, leggera come il fumo.
  snowspray: { life: SMOKE_LIFE, r0: 10, r1: 40, alpha: 0.9, colour: SNOW_SPRAY_COLOR, sprite: 'fx_dust_large', gravity: 30, tint: SNOW_SPRAY_COLOR },
};

/** Il fuori strada alza erba in campagna e montagna, polvere altrove. Pura. */
export function dustKind(theme: ThemeId): 'dust' | 'grass' {
  return GRASS_THEMES.includes(theme) ? 'grass' : 'dust';
}

/**
 * Quanti segmenti della fetta visibile separano la telecamera dal
 * giocatore: `updateVisible` parte dalla telecamera, che sta `PLAYER_Z`
 * unità dietro.
 */
export const PLAYER_SEGMENT_OFFSET = Math.round(PLAYER_Z / SEGMENT_LENGTH);

/**
 * Il segmento sotto al giocatore, preso dalla fetta visibile, o null se la
 * fetta è vuota (le schermate che costruiscono uno snapshot a mano). È
 * un'approssimazione a un segmento: serve solo a un effetto visivo. Pura.
 */
export function playerSegment(snapshot: RaceSnapshot): Segment | null {
  const segs = snapshot.segments;
  if (segs.length === 0) return null;
  return segs[Math.min(PLAYER_SEGMENT_OFFSET, segs.length - 1)];
}

/**
 * Spruzzo d'acqua: serve acqua sul segmento del giocatore **e** il
 * giocatore oltre la banchina **su quello stesso lato** (spec §4.4b).
 * Il controllo su `|x|` esclude l'isola centrale del bivio, che è
 * superficie d'erba ma sta dentro la strada. Pura.
 */
export function wantsSplash(snapshot: RaceSnapshot): boolean {
  if (snapshot.crash.active || snapshot.timeLeft <= 0) return false;
  const seg = playerSegment(snapshot);
  if (seg === null || seg.water === undefined) return false;
  const p = snapshot.player;
  if (p.surface !== 'grass' || Math.abs(p.x) <= 1 + SHOULDER_W) return false;
  return (p.x < 0 ? 'left' : 'right') === seg.water;
}

/** Righe di velocità sopra il 90% del massimo, mai in incidente (spec §4.4b). Pura. */
export function wantsSpeedLines(snapshot: RaceSnapshot): boolean {
  if (snapshot.crash.active || snapshot.timeLeft <= 0) return false;
  return speedPercentOf(snapshot) > SPEED_LINES_MIN;
}

/**
 * Spruzzi d'acqua dalle ruote sul bagnato (spec §4.4f): due per ruota
 * per tick, con la stessa particella `'splash'` che il binario I usa per
 * le pozze a bordo strada. Distinto da `wantsSplash`, che chiede
 * `segment.water` e il giocatore **fuori strada** su quel lato: questo
 * chiede la strada bagnata e il giocatore **sopra di essa**, ed è quindi
 * l'altra metà dello stesso effetto.
 */
export const SURFACE_SPRAY_PER_WHEEL = 2;
/**
 * Polvere dalle ruote sullo sterrato (spec §4.4f): tre per ruota per
 * tick, più densa dei due della banchina, perché su una strada di terra
 * la polvere è la cosa che si vede di più.
 */
export const SURFACE_DUST_PER_WHEEL = 3;

/**
 * La superficie sotto le ruote del giocatore, presa dalla fetta
 * visibile. `null` se la fetta è vuota: le schermate che costruiscono
 * uno snapshot a mano (Review Focus 1). Pura.
 */
function playerBlend(snapshot: RaceSnapshot): SurfaceBlend | null {
  const seg = playerSegment(snapshot);
  return seg === null ? null : surfaceBlendOf(seg, weatherOf(snapshot));
}

/** Gara in corso: niente effetti in incidente o a tempo scaduto. Pura. */
function racing(snapshot: RaceSnapshot): boolean {
  return !snapshot.crash.active && snapshot.timeLeft > 0 && speedPercentOf(snapshot) > DUST_MIN_SPEED;
}

/**
 * Se le ruote schizzano acqua (spec §4.4f): strada bagnata sotto di
 * esse e l'auto in movimento. Un tratto di sterrato che copre il
 * bagnato spegne lo spruzzo insieme alla rampa, perché `wetnessOf`
 * scende con la miscela. Pura.
 */
export function wantsSurfaceSpray(snapshot: RaceSnapshot): boolean {
  if (!racing(snapshot)) return false;
  const blend = playerBlend(snapshot);
  return blend !== null && wetnessOf(blend) >= DOMINANT_MIX;
}

/**
 * Se le ruote alzano polvere per com'è la strada, non per dove sono
 * (spec §4.4f): sterrato sotto di esse, oltre metà rampa, e l'auto in
 * movimento. Vale **anche** sull'asfalto, cioè con
 * `player.surface === 'road'`: è la differenza con la polvere della
 * banchina di §4.4b, che chiede di essere fuori strada. Pura.
 */
export function wantsSurfaceDust(snapshot: RaceSnapshot): boolean {
  if (!racing(snapshot)) return false;
  const blend = playerBlend(snapshot);
  return blend !== null && blend.kind === 'dirt' && blend.mix >= DOMINANT_MIX;
}

// ---------------------------------------------------------------------------
// Che cosa sollevano le ruote: una sola decisione (spec §4.4b, §4.4f)
// ---------------------------------------------------------------------------

/**
 * Il fondo sotto le ruote, per quanto riguarda le particelle. `offroad` è
 * banchina ed erba (anche l'isola del bivio); `puddle` è il fuori strada
 * sul lato della pozza (`wantsSplash`).
 */
export type WheelGround = 'asphalt' | 'wet' | 'dirt' | 'snow' | 'offroad' | 'puddle';
/** Che cosa fanno le ruote: derapata, partenza da fermo, o solo girare. */
export type WheelEvent = 'skid' | 'burnout' | 'roll';

export const WHEEL_GROUNDS: readonly WheelGround[] = ['asphalt', 'wet', 'dirt', 'snow', 'offroad', 'puddle'];
export const WHEEL_EVENTS: readonly WheelEvent[] = ['skid', 'burnout', 'roll'];

/**
 * Neve sollevata girando: tre per ruota come la terra, perché anche la
 * neve fresca sulla strada è la cosa che si vede di più.
 */
export const SURFACE_SNOW_PER_WHEEL = 3;

/**
 * Il fondo sotto le ruote dallo snapshot. Fuori strada vince la pozza, poi
 * la banchina; in strada vince il tratto dominante (sterrato o neve) sul
 * bagnato, come in `wantsSurfaceDust`/`wantsSurfaceSpray`. Senza segmenti
 * è asfalto asciutto. Pura.
 */
export function wheelGroundOf(snapshot: RaceSnapshot): WheelGround {
  if (snapshot.player.surface !== 'road') return wantsSplash(snapshot) ? 'puddle' : 'offroad';
  const blend = playerBlend(snapshot);
  if (blend === null) return 'asphalt';
  if (blend.mix >= DOMINANT_MIX && (blend.kind === 'dirt' || blend.kind === 'snow')) return blend.kind;
  return wetnessOf(blend) >= DOMINANT_MIX ? 'wet' : 'asphalt';
}

/** L'evento delle ruote in questo tick, o null se non c'è niente da emettere. Pura. */
export function wheelEventOf(snapshot: RaceSnapshot): WheelEvent | null {
  const kind = emitKind(snapshot);
  if (kind === 'skidSmoke') return 'skid';
  if (kind === 'burnoutSmoke') return 'burnout';
  return racing(snapshot) ? 'roll' : null;
}

/**
 * **La** tabella: che particella sollevano le ruote per fondo ed evento.
 * Il fumo grigio di gomma esiste solo sull'asfalto asciutto; su ogni altro
 * fondo derapata e partenza sollevano il materiale del fondo (terra bruna,
 * neve bianca, acqua, erba o polvere del tema), così due effetti non si
 * sommano mai. Girando sull'asfalto asciutto non si solleva niente. Pura.
 */
export function wheelParticleFor(ground: WheelGround, event: WheelEvent, theme: ThemeId): ParticleKind | null {
  switch (ground) {
    case 'asphalt':
      return event === 'roll' ? null : 'smoke';
    case 'wet':
    case 'puddle':
      return 'splash';
    case 'dirt':
      return 'mud';
    case 'snow':
      return 'snowspray';
    case 'offroad':
      return dustKind(theme);
  }
}

/** Particelle per ruota girando, senza derapata né partenza. Pura. */
function rollCountFor(ground: WheelGround): number {
  switch (ground) {
    case 'asphalt':
      return 0;
    case 'wet':
      return SURFACE_SPRAY_PER_WHEEL;
    case 'puddle':
      return SPLASH_PER_WHEEL;
    case 'dirt':
      return SURFACE_DUST_PER_WHEEL;
    case 'snow':
      return SURFACE_SNOW_PER_WHEEL;
    case 'offroad':
      return DUST_PER_WHEEL;
  }
}

/**
 * Quante particelle per ruota per tick. La derapata ne dà almeno quante il
 * fumo (`SKID_SMOKE_PER_WHEEL`) e sempre una in più del solo girare; la
 * partenza almeno quante il fumo di partenza. Sull'asfalto asciutto sono
 * esattamente i numeri del fumo di prima. Pura.
 */
export function wheelCountFor(ground: WheelGround, event: WheelEvent): number {
  const roll = rollCountFor(ground);
  if (event === 'skid') return ground === 'asphalt' ? SKID_SMOKE_PER_WHEEL : Math.max(SKID_SMOKE_PER_WHEEL, roll + 1);
  if (event === 'burnout') return ground === 'asphalt' ? BURNOUT_SMOKE_PER_WHEEL : Math.max(BURNOUT_SMOKE_PER_WHEEL, roll);
  return roll;
}

/**
 * Scala del raggio: il fumo e il materiale sollevato girando restano come
 * sono; il materiale di derapata e partenza cresce con la velocità, da
 * 0.8 da fermo a 1.4 al massimo. Pura.
 */
export function wheelSizeFor(particle: ParticleKind, event: WheelEvent, speedPercent: number): number {
  if (particle === 'smoke' || event === 'roll') return 1;
  return 0.8 + 0.6 * speedPercent;
}

// ---------------------------------------------------------------------------
// Meteore: neve, pioggia, sabbia (spec §4.4b, §4.4f)
// ---------------------------------------------------------------------------

/**
 * Che cosa cade davanti alla telecamera. Una sola piscina per tutti e
 * tre: non coesistono mai — un tema e un meteo danno **un** tipo — e
 * tre piscine separate sarebbero tre volte la memoria per lo stesso
 * schermo.
 */
export type WeatherMote = 'snow' | 'rain' | 'sand';

/**
 * Slot della piscina, allocati una volta sola. Deve bastare al meteo più
 * fitto (`SNOW_HEAVY = 140`); il numero **vivo** lo decide
 * `weatherCountFor`, e il costo di disegno di un fotogramma è quello,
 * non questo.
 */
export const WEATHER_MAX = 150;

/** Tema che nevica anche senza meteo: le tappe alpine (spec §4.4b, binario H). */
export const SNOW_THEME: ThemeId = 'alpine';
/** Fiocchi della nevicata di tema, invariati dal binario H: 2-1 Pine Pass. */
export const SNOW_FLAKES = 60;
/** Fiocchi delle due tappe con `weather: 'snow'` (3-1, 4-1): più fitto. */
export const SNOW_HEAVY = 140;
/** Raggio di un fiocco, in pixel. */
export const SNOW_R0 = 2;
export const SNOW_R1 = 4;
/** Caduta, in pixel al secondo. */
export const SNOW_FALL_MIN = 40;
export const SNOW_FALL_MAX = 80;
/** Deriva laterale massima, in pixel al secondo. */
export const SNOW_DRIFT = 26;
export const SNOW_ALPHA = 0.8;
export const SNOW_COLOR = '#ffffff';

/** Gocce delle due tappe che piovono (3-0, 4-2). */
export const RAIN_DROPS = 110;
/**
 * Caduta di una goccia, in pixel al secondo. Molto più veloce della
 * neve: una goccia attraversa lo schermo in meno di un secondo e mezzo,
 * ed è quello che la fa leggere come pioggia e non come coriandoli.
 */
export const RAIN_FALL_MIN = 520;
export const RAIN_FALL_MAX = 920;
/**
 * Inclinazione della riga: `dx / dy`. 0.34 è circa 19° dalla verticale,
 * la pioggia di chi corre, non quella di chi sta fermo. La deriva
 * orizzontale della goccia è `RAIN_SLANT` volte la sua caduta, così la
 * riga disegnata è esattamente il suo vettore di velocità in scala.
 */
export const RAIN_SLANT = 0.34;
/** Lunghezza della riga, in pixel. */
export const RAIN_LEN_MIN = 10;
export const RAIN_LEN_MAX = 22;
export const RAIN_COLOR = '#c8e1f5';
export const RAIN_ALPHA = 0.55;
export const RAIN_WIDTH = 1.4;

/** Granelli delle due tempeste di sabbia (3-3, 4-3). */
export const SAND_MOTES = 140;
/**
 * La sabbia **attraversa** la strada: deriva laterale molto più grande
 * della caduta, così si legge come vento e non come pioggia obliqua.
 */
export const SAND_DRIFT_MIN = 240;
export const SAND_DRIFT_MAX = 560;
export const SAND_FALL_MIN = 10;
export const SAND_FALL_MAX = 60;
/** Lunghezza della riga, in pixel: più lunga della pioggia e orizzontale. */
export const SAND_LEN_MIN = 14;
export const SAND_LEN_MAX = 40;
export const SAND_COLOR = '#f6e2a8';
export const SAND_ALPHA = 0.75;
export const SAND_WIDTH = 3;
/**
 * Frazione dell'altezza sopra la quale la sabbia non nasce: il vento
 * radente sta sulla strada, non in cielo, e granelli all'altezza delle
 * nuvole si leggerebbero come sporco sullo schermo.
 */
export const SAND_TOP = 0.42;

/**
 * Una meteora. `r` serve alla neve (un cerchio), `len` alla pioggia e
 * alla sabbia (una riga nel verso della velocità): un campo in più per
 * meteora costa 150 numeri in tutto, e due piscine costerebbero di più.
 */
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  len: number;
}

/**
 * Che cosa cade su una tappa (spec §4.4f). La pioggia e la sabbia
 * vincono sul tema: piovendo in montagna cadono gocce e **non** fiocchi,
 * o si vedrebbero due meteo insieme (Review Focus 4). Senza meteo, nevica
 * solo se il tema è quello che nevica da sempre. Pura.
 */
export function weatherKindFor(theme: ThemeId, weather: Weather): WeatherMote | null {
  if (weather === 'rain') return 'rain';
  if (weather === 'dust') return 'sand';
  if (weather === 'snow') return 'snow';
  return theme === SNOW_THEME ? 'snow' : null;
}

/** Quante meteore vive su una tappa (spec §4.4f). Pura. */
export function weatherCountFor(theme: ThemeId, weather: Weather): number {
  const kind = weatherKindFor(theme, weather);
  if (kind === null) return 0;
  if (kind === 'rain') return RAIN_DROPS;
  if (kind === 'sand') return SAND_MOTES;
  return weather === 'snow' ? SNOW_HEAVY : SNOW_FLAKES;
}

/**
 * Meteo dello snapshot, con il default: `stage.weather` è opzionale, e
 * una ventina di fixture e la schermata del titolo non lo forniscono
 * (Review Focus 1). Pura.
 */
export function weatherOf(snapshot: RaceSnapshot): Weather {
  return snapshot.stage.weather ?? 'clear';
}

/** Centro dello schermo logico: l'auto è sempre lì (spec §4.4 punto 5). */
const LOGICAL_CENTRE_X = LOGICAL_W / 2;
/** Fondo del battistrada di `car`, sullo schermo logico. Pura. */
const logicalBottomYFor = (car: CarChoice): number => LOGICAL_H - wheelYFromBottomFor(car);

/** Velocità in frazione del massimo, dallo snapshot (kmh = percent · 293). Pura. */
export function speedPercentOf(snapshot: RaceSnapshot): number {
  const p = snapshot.kmh / KMH_AT_MAX;
  if (!Number.isFinite(p)) return 0;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * Cosa emettere in questo tick (spec §4.4b): derapata e partenza sono la
 * stessa particella di fumo, ma con un conteggio diverso, quindi restano
 * distinte; nessuna delle tre in pausa, in incidente o a tempo scaduto.
 * Pura.
 */
export function emitKind(snapshot: RaceSnapshot): 'skidSmoke' | 'burnoutSmoke' | 'dust' | 'none' {
  if (snapshot.crash.active || snapshot.timeLeft <= 0) return 'none';
  if (snapshot.player.skidding) return 'skidSmoke';
  const speedPercent = speedPercentOf(snapshot);
  if (
    snapshot.player.accelerating &&
    snapshot.player.surface === 'road' &&
    speedPercent < BURNOUT_MAX_SPEED
  ) {
    return 'burnoutSmoke';
  }
  const offRoad = snapshot.player.surface !== 'road';
  return offRoad && speedPercent > DUST_MIN_SPEED ? 'dust' : 'none';
}

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Secondi vissuti; la particella è viva finché `t < life`. */
  t: number;
  life: number;
  /** Scala del raggio (`wheelSizeFor`), 1 per tutto il resto. */
  size: number;
}

/**
 * Sprite ritinti (`ParticleSpec.tint`), uno per immagine e colore, fatti una
 * volta sola. Senza DOM (i test) o senza contesto 2D si torna all'immagine
 * originale: il colore è un dettaglio, lo sprite no.
 */
const TINT_STRENGTH = 0.82;
/** Un `#rrggbb` è chiaro se la sua luminanza supera metà scala. Pura. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(n)) return false;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 128;
}
const tintCache = new WeakMap<object, Map<string, CanvasImageSource>>();
function tinted(image: CanvasImageSource, w: number, h: number, colour: string): CanvasImageSource {
  let byColour = tintCache.get(image);
  if (byColour === undefined) {
    byColour = new Map();
    tintCache.set(image, byColour);
  }
  const hit = byColour.get(colour);
  if (hit !== undefined) return hit;
  let out: CanvasImageSource = image;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const c = canvas.getContext('2d');
    if (c !== null) {
      c.drawImage(image, 0, 0, canvas.width, canvas.height);
      c.fillStyle = colour;
      if (isLight(colour)) {
        // Colore chiaro (neve): sopra i soli pixel dello sprite, non pieno,
        // così un filo dell'originale tiene l'ombreggiatura delle nuvolette.
        c.globalCompositeOperation = 'source-atop';
        c.globalAlpha = TINT_STRENGTH;
        c.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        // Colore scuro (terra): in moltiplica, che tiene luci e ombre della
        // nuvola; poi la sagoma originale rimaschera i pixel trasparenti.
        c.globalCompositeOperation = 'multiply';
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      out = canvas;
    }
  }
  byColour.set(colour, out);
  return out;
}

export interface ParticleField {
  /**
   * Un tick di gara: invecchia le particelle vive, ne emette di nuove e fa
   * cadere la neve delle tappe alpine. `car` decide dove stanno le ruote
   * (spec §4.4b): assente vale l'auto nuova, come prima di `CarChoice`.
   */
  update(dt: number, snapshot: RaceSnapshot, car?: CarChoice): void;
  /**
   * Scoppio istantaneo, da chiamare sull'evento che lo provoca: la
   * schermata di gara lo fa sull'evento `crash` (spec §4.4b). Non si
   * ricava dallo snapshot, che dice solo che l'incidente è *in corso*.
   */
  burst(kind: 'crash'): void;
  /**
   * Disegna DOPO l'auto del giocatore (spec §4.4b): le nuvolette coprono la
   * parte bassa delle ruote come nei racer arcade dell'epoca. Con `assets` le
   * particelle sono gli sprite `fx_*`; senza, o con un asset di misura
   * zero, restano i cerchi pieni di prima.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    pal: ThemePalette,
    width: number,
    height: number,
    assets?: AssetStore,
  ): void;
  readonly count: number;
  /**
   * Fiocchi di neve in volo: 0 quando piove, quando c'è la sabbia, e
   * fuori dalle tappe che nevicano. Il significato è quello che il
   * binario H ha messo nel contratto (README dei piani) e non cambia.
   */
  readonly snowCount: number;
  /** Meteore in volo, di qualunque tipo: neve, pioggia o sabbia (spec §4.4f). */
  readonly weatherCount: number;
  clear(): void;
}

/**
 * Sistema di particelle a piscina fissa: `MAX_PARTICLES` slot allocati una
 * volta sola, riusati a giro. Nessuna allocazione nel ciclo di gioco. `rng` è
 * iniettabile perché i test devono vedere sempre lo stesso frame.
 */
export function createParticles(rng: () => number = Math.random): ParticleField {
  const pool: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    kind: 'smoke' as ParticleKind,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    t: 0,
    life: 0,
    size: 1,
  }));
  // Prossimo slot da riusare: girando in tondo si ricicla sempre il più vecchio.
  let next = 0;
  // Auto scelta nella radio, aggiornata a ogni `update` (spec §4.4b): decide
  // dove stanno le ruote per le nuvolette e per lo scoppio dell'incidente,
  // che non ha uno snapshot proprio e legge quella dell'ultimo tick.
  let currentCar: CarChoice = DEFAULT_CAR;

  /**
   * Meteore: piscina fissa di `WEATHER_MAX` slot, seminata quando il
   * meteo (o il tema) le chiede e riciclata ai bordi. Vive dentro il
   * campo di particelle, non in un oggetto nuovo, così `renderWorld` e
   * `ScreenDeps` non cambiano firma (binario H, conservato).
   */
  const motes: Mote[] = Array.from({ length: WEATHER_MAX }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 0,
    len: 0,
  }));
  /** Tipo attualmente seminato, o null se la piscina è spenta. */
  let moteKind: WeatherMote | null = null;
  /** Quante meteore sono seminate: le prime `moteCount` slot. */
  let moteCount = 0;
  /**
   * Frazione di meteore ancora visibili, 1 = tutte. Lasciando un meteo
   * durante una transizione fra tappe, segue `FAR_WINDOW` (spec §4.4d) —
   * la stessa finestra che sfuma lo sfondo lontano — così le meteore si
   * diradano insieme al paesaggio invece di spegnersi in un fotogramma
   * (binario H per la neve, generalizzato a pioggia e sabbia).
   */
  let moteFade = 1;

  /** Semina una meteora del tipo dato nel punto dato. */
  const seed = (m: Mote, kind: WeatherMote, x: number, y: number): void => {
    m.x = x;
    m.y = y;
    if (kind === 'snow') {
      m.vx = (rng() * 2 - 1) * SNOW_DRIFT;
      m.vy = SNOW_FALL_MIN + rng() * (SNOW_FALL_MAX - SNOW_FALL_MIN);
      m.r = SNOW_R0 + rng() * (SNOW_R1 - SNOW_R0);
      m.len = 0;
      return;
    }
    if (kind === 'rain') {
      m.vy = RAIN_FALL_MIN + rng() * (RAIN_FALL_MAX - RAIN_FALL_MIN);
      // La riga disegnata è il vettore di velocità in scala: la deriva
      // orizzontale è `RAIN_SLANT` volte la caduta.
      m.vx = m.vy * RAIN_SLANT;
      m.r = 0;
      m.len = RAIN_LEN_MIN + rng() * (RAIN_LEN_MAX - RAIN_LEN_MIN);
      return;
    }
    // Sabbia: il verso del vento è lo stesso per tutti i granelli, o si
    // leggerebbe come sporco invece che come raffica.
    m.vx = SAND_DRIFT_MIN + rng() * (SAND_DRIFT_MAX - SAND_DRIFT_MIN);
    m.vy = SAND_FALL_MIN + rng() * (SAND_FALL_MAX - SAND_FALL_MIN);
    m.r = 0;
    m.len = SAND_LEN_MIN + rng() * (SAND_LEN_MAX - SAND_LEN_MIN);
  };

  /** Semina tutte le meteore sparse sullo schermo, non tutte in cima. */
  const seedAll = (kind: WeatherMote, count: number): void => {
    for (let i = 0; i < count; i++) {
      const y = kind === 'sand' ? LOGICAL_H * SAND_TOP + rng() * LOGICAL_H * (1 - SAND_TOP) : rng() * LOGICAL_H;
      seed(motes[i], kind, rng() * LOGICAL_W, y);
    }
  };

  /** Un passo di caduta, con il riciclo ai bordi. */
  const advance = (dt: number, kind: WeatherMote, count: number): void => {
    for (let i = 0; i < count; i++) {
      const m = motes[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (kind === 'sand') {
        // Il vento attraversa: chi esce a destra rientra a sinistra, a
        // un'altezza nuova nella metà bassa dello schermo.
        if (m.x - m.len > LOGICAL_W) {
          seed(m, kind, -m.len, LOGICAL_H * SAND_TOP + rng() * LOGICAL_H * (1 - SAND_TOP));
        } else if (m.y - m.len > LOGICAL_H) {
          seed(m, kind, rng() * LOGICAL_W, LOGICAL_H * SAND_TOP);
        }
        continue;
      }
      const margin = kind === 'snow' ? m.r : m.len;
      if (m.y - margin > LOGICAL_H) {
        seed(m, kind, rng() * LOGICAL_W, -margin);
      } else if (m.x < -margin) {
        m.x += LOGICAL_W + 2 * margin;
      } else if (m.x > LOGICAL_W + margin) {
        m.x -= LOGICAL_W + 2 * margin;
      }
    }
  };

  /**
   * Un tick della piscina di meteore. Se il tipo voluto è quello
   * seminato, avanza. Se è cambiato e c'è una transizione in corso, le
   * vecchie si diradano prima che le nuove nascano; senza transizione il
   * cambio è immediato, che è il caso di chi entra in gara o cambia
   * tappa fra due temi uguali.
   */
  const stepWeather = (dt: number, snapshot: RaceSnapshot): void => {
    // Il tema si legge **solo** da `snapshot.stage.theme`, insieme al
    // meteo: `snapshot.theme` e `snapshot.stage.theme` coincidono sempre
    // nel motore vero, ma una fixture può farli divergere, e mescolare
    // due fonti per la stessa decisione è la trappola contro cui il
    // task 3 mette in guardia per le palette.
    const weather = weatherOf(snapshot);
    const want = weatherKindFor(snapshot.stage.theme, weather);
    const wantCount = weatherCountFor(snapshot.stage.theme, weather);
    if (want === moteKind && wantCount === moteCount) {
      moteFade = 1;
      if (moteKind !== null) advance(dt, moteKind, moteCount);
      return;
    }
    if (moteKind !== null && snapshot.transition !== undefined) {
      moteFade = 1 - windowProgress(snapshot.transition.t, FAR_WINDOW.from, FAR_WINDOW.to);
      if (moteFade > 0) {
        advance(dt, moteKind, moteCount);
        return;
      }
    }
    moteKind = want;
    moteCount = wantCount;
    moteFade = 1;
    if (want !== null) seedAll(want, wantCount);
  };

  /** Meteore davvero disegnate: il diradamento le toglie dalla coda. */
  const visibleMotes = (): number => (moteKind === null ? 0 : Math.round(moteCount * moteFade));

  /** Nuova particella nello slot più vecchio: nessuna allocazione nel ciclo di gioco. */
  const emit = (kind: ParticleKind, x: number, y: number, vx: number, vy: number, size = 1): void => {
    const p = pool[next];
    next = (next + 1) % MAX_PARTICLES;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.t = 0;
    p.life = PARTICLE_SPECS[kind].life;
    p.size = size;
  };

  /**
   * Particella dalle ruote posteriori, con lo sbandamento di nascita del
   * binario H. `side` è -1 o 1. Con `outward` (derapata e partenza, di
   * qualunque materiale) la particella deriva verso l'esterno a velocità
   * costante e sale come il fumo (spec §4.4b); girando deriva a caso.
   */
  const fromWheel = (kind: ParticleKind, side: -1 | 1, outward: boolean, size: number): void => {
    emit(
      kind,
      LOGICAL_CENTRE_X + side * wheelDXFor(currentCar) + (rng() * 2 - 1) * SPAWN_SPREAD_X,
      logicalBottomYFor(currentCar) + (rng() * 2 - 1) * SPAWN_SPREAD_Y,
      outward ? side * SMOKE_OUTWARD_DRIFT : (rng() * 2 - 1) * DUST_DRIFT,
      outward ? -SMOKE_RISE : -DUST_RISE * (0.6 + 0.8 * rng()),
      size,
    );
  };

  return {
    update(dt: number, snapshot: RaceSnapshot, car: CarChoice = DEFAULT_CAR): void {
      currentCar = car;
      if (!(dt > 0)) return;
      stepWeather(dt, snapshot);
      for (const p of pool) {
        if (p.t >= p.life) continue;
        p.t += dt;
        p.vy += PARTICLE_SPECS[p.kind].gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      // 1. ruote: **una** particella per fondo ed evento (`wheelParticleFor`):
      // fumo grigio solo sull'asfalto asciutto, altrove il materiale del
      // fondo, mai due effetti sommati.
      const event = wheelEventOf(snapshot);
      if (event !== null) {
        const ground = wheelGroundOf(snapshot);
        const particle = wheelParticleFor(ground, event, snapshot.theme);
        const perWheel = wheelCountFor(ground, event);
        if (particle !== null && perWheel > 0) {
          const outward = event !== 'roll';
          const size = wheelSizeFor(particle, event, speedPercentOf(snapshot));
          // `SIDES` è una costante di modulo: il ciclo non alloca per tick.
          for (const side of SIDES) {
            for (let i = 0; i < perWheel; i++) fromWheel(particle, side, outward, size);
          }
        }
      }

      // 2. righe di velocità, dai due margini verso l'esterno e in basso.
      if (wantsSpeedLines(snapshot)) {
        for (let i = 0; i < SPEED_LINES_PER_TICK; i++) {
          const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
          emit(
            'speedline',
            LOGICAL_W / 2 + side * LOGICAL_W * 0.3,
            LOGICAL_H * (0.35 + rng() * 0.5),
            side * SPEED_LINE_VX,
            SPEED_LINE_VY,
          );
        }
      }
    },

    burst(_kind: 'crash'): void {
      // Centro dell'auto: i detriti partono da lì in tutte le direzioni.
      const cx = LOGICAL_CENTRE_X;
      const cy = LOGICAL_H - playerDHFor(currentCar) * 0.5;
      const half = CRASH_DEBRIS / 2;
      for (let i = 0; i < CRASH_DEBRIS; i++) {
        const a = (i / CRASH_DEBRIS) * Math.PI * 2;
        const v = CRASH_DEBRIS_SPEED * (0.5 + rng());
        emit(i < half ? 'debris' : 'gravel', cx, cy, Math.cos(a) * v, Math.sin(a) * v - 120);
      }
      for (let i = 0; i < CRASH_SPARKS; i++) {
        const a = -Math.PI * 0.9 + (i / CRASH_SPARKS) * Math.PI * 0.8;
        const v = CRASH_SPARK_SPEED * (0.6 + rng() * 0.8);
        emit('spark', cx, cy, Math.cos(a) * v, Math.sin(a) * v);
      }
      emit('impact', cx, cy, 0, 0);
    },

    // `_width` e `_height` non servono: le particelle nascono già in
    // coordinate di schermo. Restano nella firma per simmetria con gli altri
    // disegnatori del mondo, che invece le usano.
    draw(
      ctx: CanvasRenderingContext2D,
      pal: ThemePalette,
      _width: number,
      _height: number,
      assets?: AssetStore,
    ): void {
      for (const p of pool) {
        if (p.t >= p.life) continue;
        const spec = PARTICLE_SPECS[p.kind];
        const k = p.t / p.life;
        const r = (spec.r0 + (spec.r1 - spec.r0) * k) * p.size;
        ctx.globalAlpha = spec.alpha * (1 - k);
        // get() non lancia mai: senza PNG arriva il procedurale. Un asset
        // di misura zero (nessun ambiente disegnabile) torna al cerchio.
        const asset = assets?.get(spec.sprite);
        if (asset !== undefined && asset.w > 0 && asset.h > 0) {
          const dw = r * 2;
          const dh = (dw * asset.h) / asset.w;
          const image = spec.tint === undefined ? asset.image : tinted(asset.image, asset.w, asset.h, spec.tint);
          ctx.drawImage(image, p.x - dw / 2, p.y - dh / 2, dw, dh);
        } else {
          ctx.fillStyle = spec.colour ?? pal.shoulderDark;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * 0.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Le meteore stanno davanti a tutto: cadono fra la telecamera e il
      // resto (spec §4.4b, §4.4f).
      const visible = visibleMotes();
      if (moteKind !== null && visible > 0) {
        if (moteKind === 'snow') {
          ctx.globalAlpha = SNOW_ALPHA;
          ctx.fillStyle = SNOW_COLOR;
          for (let i = 0; i < visible; i++) {
            const m = motes[i];
            ctx.beginPath();
            ctx.ellipse(m.x, m.y, m.r, m.r, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const rain = moteKind === 'rain';
          ctx.globalAlpha = rain ? RAIN_ALPHA : SAND_ALPHA;
          ctx.strokeStyle = rain ? RAIN_COLOR : SAND_COLOR;
          ctx.lineWidth = rain ? RAIN_WIDTH : SAND_WIDTH;
          for (let i = 0; i < visible; i++) {
            const m = motes[i];
            // La riga va nel verso della velocità, lunga `len`: una
            // goccia inclinata di `RAIN_SLANT`, un granello quasi
            // orizzontale. Il modulo della velocità è sempre positivo
            // (`vy` non è mai zero per costruzione), quindi non si
            // divide per zero.
            const speed = Math.hypot(m.vx, m.vy);
            const ux = m.vx / speed;
            const uy = m.vy / speed;
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(m.x + ux * m.len, m.y + uy * m.len);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    },
    get count(): number {
      let n = 0;
      for (const p of pool) if (p.t < p.life) n++;
      return n;
    },
    get snowCount(): number {
      return moteKind === 'snow' ? visibleMotes() : 0;
    },
    get weatherCount(): number {
      return visibleMotes();
    },
    clear(): void {
      for (const p of pool) p.life = 0;
      next = 0;
      moteKind = null;
      moteCount = 0;
      moteFade = 1;
    },
  };
}
