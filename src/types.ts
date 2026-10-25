// Contratto condiviso tra i binari. Modificare solo con accordo di tutti i piani.

import type { AudioSampleReport } from './audio/analysis';
import type { CustomTrack } from './audio/custom';
import type { AudioSampleKind } from './audio/offline';

export type Vec3 = { x: number; y: number; z: number };
export type Projected = { x: number; y: number; w: number; scale: number };

export type ThemeId = 'beach' | 'desert' | 'alpine' | 'farm' | 'town';
export type SpriteName = string;

/** Superficie sotto le ruote del giocatore (spec §5, voce Superficie). */
export type Surface = 'road' | 'shoulder' | 'grass';

/**
 * Di che cosa è fatta la strada su un tratto (spec §4.4f). Distinto da
 * `Surface`, che dice **dove** stanno le ruote (asfalto, banchina,
 * erba): questo dice **com'è** l'asfalto sotto di esse.
 */
export type SurfaceKind = 'asphalt' | 'dirt' | 'snow' | 'wet';

/** Meteo di una tappa (spec §4.4f e §9). Assente su una tappa vale `'clear'`. */
export type Weather = 'clear' | 'rain' | 'snow' | 'dust';

// Auto e modalità stanno in `shared/kinds.ts`, che il Worker (`api/`) importa senza il resto.
export type { CarChoice, Difficulty } from './shared/kinds';
import type { CarChoice, Difficulty } from './shared/kinds';

/** Strutture laterali continue (spec §4.4c). */
export type WallKind =
  | 'rock_red'
  | 'rock_grey'
  | 'guardrail'
  | 'seawall'
  | 'hedge'
  | 'bridge_rail'
  | 'town_facades';

export interface PlacedSprite {
  name: SpriteName;
  /** Posizione laterale: 0 centro strada, ±1 bordo strada, fino a ±3. */
  offset: number;
  /**
   * Disegna lo sprite specchiato in orizzontale (spec §13): serve ai cartelli
   * di curva, disegnati con la punta a sinistra. Le collisioni non la
   * leggono: `offset` e `collideW` non cambiano.
   */
  flip?: boolean;
  /**
   * `offset` è già la posizione finale dal centro del segmento: niente
   * `forkOffset` né spostamento per la strada scartata (bivio v3). La usano
   * i portali sui due rami della zona di bivio e gli sprite che `race.ts`
   * riporta sulla strada scelta al commit del bivio.
   */
  fixed?: boolean;
}

/**
 * Strada scartata al bivio (bivio v3, spec §4.4): centro e semilarghezza in
 * unità `x` dal centro del segmento, ai due capi `p1` (`near`) e `p2`
 * (`far`), così i bordi restano dritti anche quando si allontana in fretta.
 */
export interface DiscardedRoad {
  near: number;
  far: number;
  halfNear: number;
  halfFar: number;
}

export interface Car {
  id: number;
  name: SpriteName;
  offset: number;
  /** Posizione lungo il tracciato, unità mondo. */
  z: number;
  /** Unità mondo al secondo. */
  speed: number;
  /** Frazione percorsa del segmento corrente, 0..1. */
  percent: number;
}

export interface SegmentPoint {
  world: Vec3;
  camera: Vec3;
  screen: Projected;
}

export interface Segment {
  index: number;
  p1: SegmentPoint;
  p2: SegmentPoint;
  curve: number;
  sprites: PlacedSprite[];
  cars: Car[];
  themeId: ThemeId;
  dark: boolean;
  /** y schermo oltre cui gli sprite del segmento sono nascosti dalle colline. */
  clip: number;
  fork?: 'left' | 'right' | 'zone';
  /** Parete continua per lato, su tratti di 80-400 segmenti (spec §4.4c). */
  wall?: { left?: WallKind; right?: WallKind };
  /** Lato dove il terreno è sostituito da una fascia d'acqua (spec §4.4c). */
  water?: 'left' | 'right';
  /**
   * Semilarghezza totale della carreggiata in unità `x` (1 = semilarghezza
   * normale). Vale 1 fuori dalla zona di bivio, fino a
   * `1 + 1 + FORK_SPLIT_MAX` in fondo alla zona (spec §4.4).
   */
  roadHalf: number;
  /** Semilarghezza dell'isola centrale in unità `x`; 0 finché non c'è (spec §4.4). */
  median: number;
  /**
   * `roadHalf` e `median` al capo lontano `p2` (bivio v3): assenti valgono
   * quelli di `p1`. Nella zona di bivio i rami si allontanano di molto in
   * pochi segmenti, e con un valore solo per segmento i bordi farebbero i
   * gradini.
   */
  roadHalfFar?: number;
  medianFar?: number;
  /**
   * Strada scartata da disegnare (bivio v3): la scrive `race.ts` sui
   * segmenti della zona dopo il commit e sui primi `FORK_EXIT_SEGMENTS`
   * della tappa nuova. Assente altrove.
   */
  discarded?: DiscardedRoad;
  /**
   * Presente sui primi `FORK_EXIT_SEGMENTS` della tappa dopo una giunzione
   * (spec §4.4, «Uscita dal bivio»): `side` è la carreggiata scartata al
   * bivio precedente, `t` va da 0 a 1 (smoothstep) e guida la strada
   * secondaria che si allontana e sparisce. Assente altrove.
   */
  forkExit?: { side: -1 | 1; t: number };
  /**
   * Superficie del tratto (spec §4.4f): sterrato in campagna e deserto,
   * neve in montagna. Assente vale asfalto — o asfalto bagnato se la
   * tappa ha `weather: 'rain'`, che non si scrive sui segmenti. Lo
   * scrive **solo** `placeSurfaces` di `game/track.ts` a costruzione
   * della tappa; il renderer non lo scrive mai (può scrivere solo
   * `clip`). Si legge attraverso `surfaceBlendOf` di `game/surface.ts`,
   * che è l'unico posto dove l'assenza si traduce.
   */
  surfaceKind?: SurfaceKind;
  /**
   * Quanto di `surfaceKind` vale su questo segmento, in `[0, 1]`
   * (spec §4.4f): 1 nel corpo del tratto, e da 0 a 1 con `smoothstep`
   * sulle rampe di `SURFACE_RAMP` segmenti alle due estremità, così il
   * confine fra asfalto e terra non è una riga netta in mezzo alla
   * strada. Assente vale 0.
   */
  surfaceMix?: number;
}

export interface Actions {
  accelerate: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  /** Momentanee: vere solo nel tick della pressione. */
  gearToggle: boolean;
  /** Tasto D: cambia modalità nella radio. */
  modeToggle: boolean;
  confirm: boolean;
  back: boolean;
  mute: boolean;
  /**
   * P, e Start sul gamepad: apre e chiude la pausa in gara (lancio, punto
   * 5). Esc arriva come `back`, che in gara vale anche lui come pausa.
   * Opzionale: assente vale false, così i letterali di `Actions` scritti
   * prima della pausa restano validi.
   */
  pause?: boolean;
  /**
   * Il clic del mouse sul canvas in questo tick, in pixel logici (`ui/mouse.ts`),
   * o null. Solo il mouse: le dita passano da `ui/touch.ts`. Titolo, radio e
   * TOP 10 lo leggono; le altre schermate lo ignorano. Opzionale, come `pause`.
   */
  click?: { x: number; y: number } | null;
  /**
   * Il pulsante DAILY CHALLENGE del titolo, toccato col dito (`ui/touch.ts`):
   * vero solo nel tick del tocco. Tastiera e gamepad lo scelgono con su e giù,
   * il mouse col clic sul pulsante. Opzionale, come `pause`.
   */
  daily?: boolean;
}

export type Gear = 'lo' | 'hi';

export interface PlayerState {
  /** Laterale: -1..1 = bordi strada, limitato a ±3. */
  x: number;
  /** Lungo il tracciato, unità mondo. */
  z: number;
  /** Unità mondo al secondo. */
  speed: number;
  gear: Gear;
  /** Frame di sterzo. */
  steer: -2 | -1 | 0 | 1 | 2;
  offRoad: boolean;
  braking: boolean;
  /**
   * Vero nel tick in cui l'acceleratore è tenuto (spec §4.4b, fumo di
   * partenza). Campo additivo, sullo stesso modello di `braking`.
   */
  accelerating: boolean;
  /** Dove sono le ruote: asfalto, banchina, erba (spec §5). */
  surface: Surface;
  /** Vero nel tick in cui l'auto sta slittando (spec §5.1). Senza stato. */
  skidding: boolean;
  /**
   * Secondi di sterzo continuo nello stesso verso (spec §5, sterzo a tre
   * stati). Campo additivo: si azzera al rilascio o all'inversione.
   */
  steerHeld: number;
}

export interface CrashState {
  active: boolean;
  /** Secondi trascorsi dall'inizio dell'incidente. */
  t: number;
  /** Frame di rotazione 0..3. */
  frame: number;
}

export interface StageDef {
  /** "l-i": l livello 0..4, i indice 0..l. */
  id: string;
  name: string;
  theme: ThemeId;
  lengthSegments: number;
  /** Secondi. */
  timeLimit: number;
  seed: number;
  /** 0..1. */
  difficulty: number;
  /**
   * Corsie della tappa (spec §9): 4 per spiaggia, deserto e campagna, 3 per
   * città e montagna. Opzionale, default 4: una `StageDef` scritta a mano non
   * deve saperlo.
   */
  lanes?: 3 | 4;
  /** Semilarghezza della strada in unità `x`; default 1 (spec §9). */
  roadHalf?: number;
  /**
   * Meteo della tappa (spec §4.4f, §9): pioggia in 3-0 e 4-2, neve in
   * 3-1 e 4-1, tempesta di sabbia in 3-3 e 4-3, sereno nelle altre
   * nove. Opzionale, default `'clear'`: una `StageDef` scritta a mano
   * non deve saperlo.
   */
  weather?: Weather;
  /**
   * Modalità della partita (`Difficulty`): la scrive `withMode` di
   * `game/mode.ts`, la leggono il traffico e l'HUD. Opzionale, default
   * `'normal'`: una `StageDef` scritta a mano non deve saperlo.
   */
  mode?: Difficulty;
  /**
   * Il traffico del giorno della sfida (DAILY): mescolato al seme del
   * traffico, non a quello del tracciato. Stessi veicoli per tappa, stessa
   * densità e stesse regole, solo posizioni, tipi e velocità diversi. Lo
   * scrive `dailyGraph` di `game/daily.ts`; assente, il traffico è quello di
   * sempre.
   */
  trafficSalt?: number;
}

export type Banner = 'none' | 'checkpoint' | 'gameover' | 'fork';

/**
 * Transizione fra due tappe di tema diverso (spec §4.4d): il renderer sa da
 * quale paesaggio a quale, e da quanti secondi.
 */
export interface StageTransition {
  from: ThemeId;
  to: ThemeId;
  /** Secondi dalla giunzione. */
  t: number;
  /**
   * Id della tappa che si sta lasciando (spec §4.4f): durante una
   * transizione servono gli scostamenti di palette di **due** tappe, e
   * `from`/`to` portano solo il tema. Una stringa e non una palette,
   * perché `ThemePalette` vive in `render/palette.ts` e farla entrare
   * qui creerebbe un ciclo con questo file. Opzionale: assente, la
   * transizione usa la palette del tema di partenza, intatta.
   */
  fromId?: string;
}

export interface RaceSnapshot {
  /**
   * Solo i segmenti visibili, già proiettati, dal più vicino al più lontano.
   * Oggetti vivi del motore, condivisi con il renderer, che può scrivere SOLO
   * `clip` durante il disegno. Non conservarli tra un tick e l'altro.
   */
  segments: Segment[];
  player: PlayerState;
  crash: CrashState;
  timeLeft: number;
  score: number;
  /**
   * Secondi dall'inizio della partita, per il tempo di giro dell'HUD
   * (spec §11). Cresce sempre: non si azzera ai checkpoint, a differenza di
   * `timeLeft`. Opzionale, così le schermate che costruiscono uno snapshot a
   * mano non sono obbligate a inventarselo.
   */
  elapsed?: number;
  /**
   * Secondi che restano al via (spec §4.4e): parte da
   * `COUNTDOWN_SECONDS` e scende, resta presente con valore negativo per
   * `GO_HOLD_S` secondi dopo lo zero così la scritta GO sta a schermo, poi
   * sparisce. Assente durante la gara e assente del tutto nel motore
   * minimo `createRace`, che guida la strada del titolo e non aspetta.
   * Mentre è maggiore di zero il mondo è fermo: nessun gas, nessun tempo,
   * nessun traffico, nessun punteggio.
   */
  countdown?: number;
  /**
   * Secondi aggiunti all'ultimo checkpoint (spec §4.4e, §8): è il
   * `timeLimit` della tappa nuova, cioè esattamente quanto `carryOver` ha
   * sommato. Presente **solo** mentre il banner del checkpoint è a
   * schermo; assente altrove e assente in chi costruisce uno snapshot a
   * mano.
   */
  extendTime?: number;
  stage: StageDef;
  level: number;
  route: ('L' | 'R')[];
  /**
   * `clouds` è opzionale: le schermate che costruiscono una parallasse a mano
   * non la forniscono e il renderer la tratta come 0 (spec §4.4c).
   */
  parallax: { far: number; near: number; y: number; clouds?: number };
  theme: ThemeId;
  /**
   * Presente **solo** mentre la transizione è in corso, e solo se le due
   * tappe hanno tema diverso (spec §4.4d). Opzionale: chi costruisce uno
   * snapshot a mano non deve inventarselo.
   */
  transition?: StageTransition;
  banner: Banner;
  forkNames?: [string, string];
  kmh: number;
}

export type RaceEvent =
  | { type: 'checkpoint'; bonus: number; nextStage: StageDef }
  | { type: 'fork'; left: StageDef; right: StageDef }
  | {
      type: 'finish';
      /** 0..4, indice del finale; lo sprite è `ending_${ending + 1}`. */
      ending: number;
      score: number;
    }
  | { type: 'gameover'; score: number; stage: StageDef }
  | { type: 'crash' }
  | { type: 'bump' }
  | { type: 'overtake' }
  /**
   * Una fase del semaforo di partenza è appena cambiata (spec §4.4e):
   * `step` 0 una rossa, 1 due rosse, 2 verde. Emesso una volta per fase,
   * in ordine, anche se un tick grosso ne attraversa più di una. La
   * schermata di gara lo traduce nel `blip` di §10.
   */
  | { type: 'countdown'; step: 0 | 1 | 2 };

export interface RaceEngine {
  update(dt: number, actions: Actions): RaceEvent[];
  snapshot(): RaceSnapshot;
}

export type SpriteKind =
  | 'player'
  | 'car'
  | 'scenery'
  | 'background'
  | 'illustration'
  | 'ui'
  /** Tessera ripetibile per terreno e asfalto (spec §4.4a). */
  | 'texture'
  /** Tessera ripetibile di parete continua (spec §4.4c). */
  | 'wall';

export interface SpriteCatalogEntry {
  kind: SpriteKind;
  /** Larghezza nel mondo come frazione della larghezza strada intera (2000 unità). */
  scale: number;
  solid: boolean;
  /**
   * Larghezza di collisione in unità di `offset` (1 = mezza strada). L'hitbox
   * dell'auto è volutamente circa il 45% della larghezza visiva: non "correggere".
   */
  collideW: number;
  /** 1 = ancora in basso, 0.5 = centro. */
  anchorY: number;
}

export interface SpriteAsset {
  name: SpriteName;
  image: CanvasImageSource;
  w: number;
  h: number;
  entry: SpriteCatalogEntry;
}

export interface AssetStore {
  ready: Promise<void>;
  /**
   * Non lancia mai: un nome sconosciuto o un PNG mancante ritorna il segnaposto
   * magenta con il nome. Non serve chiamare `has` prima.
   */
  get(name: SpriteName): SpriteAsset;
  has(name: SpriteName): boolean;
  stats: { png: number; procedural: number; missing: number };
}

export type SfxName = 'crash' | 'bump' | 'checkpoint' | 'fanfare' | 'blip';

export interface AudioBus {
  /** Da chiamare al primo input utente: crea o riprende l'AudioContext. */
  unlock(): void;
  /**
   * 0..2 sono i tre brani sintetici; da 3 in poi i brani personali
   * (`customTracks[index - 3]`). Un indice fuori dall'elenco ferma la musica
   * invece di lanciare (decisione di contratto del binario J).
   * Con `resume` un brano sintetico fermato da `stopSong` riprende dallo
   * step in cui era (CONTINUE della pausa), invece che dall'inizio; senza,
   * parte dall'inizio come sempre.
   */
  playSong(index: number, options?: { resume?: boolean }): void;
  stopSong(): void;
  sfx(name: SfxName): void;
  setEngine(speedPercent: number, gear: Gear, running: boolean): void;
  setSkid(on: boolean): void;
  /**
   * Rombo di sterrato: vero quando il giocatore non è sull'asfalto e corre,
   * oppure quando la strada stessa è di terra battuta
   * (spec §10, §4.4f). `speedPercent` apre il passa-basso con la
   * velocità: il fruscio della ghiaia sale di tono correndo. Opzionale,
   * e assente vale zero, cioè il timbro del binario H.
   */
  setRumble(on: boolean, speedPercent?: number): void;
  /**
   * Anello di pioggia (spec §10, §4.4f): `level` in `[0, 1]`, 0 è
   * silenzio. Un campione CC0 se c'è, rumore filtrato altrimenti; la
   * schermata di gara lo guida dal meteo della tappa. **Opzionale**: il
   * binario J dichiara che `AudioBus` si allarga solo con membri
   * opzionali, così i bus finti dei test e `src/dev/null-audio.ts` non
   * vanno toccati. Chi la chiama scrive `deps.audio.setRain?.(…)`.
   */
  setRain?(level: number): void;
  /**
   * Spegne subito motore, derapata, sterrato e pioggia (pausa e uscita dalla
   * gara, lancio punto 5). Il prossimo `setEngine` li riaccende. Opzionale
   * come `setRain`: chi la chiama scrive `deps.audio.stopAll?.()`.
   */
  stopAll?(): void;
  /** Ritorna true se ora è muto. */
  toggleMute(): boolean;
  readonly muted: boolean;
  /**
   * Muto da fuori, indipendente da M (`audio/context.ts`): `'ad'` mentre il
   * portale mostra una pubblicità, `'portal'` finché la sua impostazione
   * `muteAudio` lo chiede. Si sente solo se nessuno dei tre dice muto; `muted`
   * resta quello di M, così alla ripresa M è come prima. Opzionale come
   * `setRain`: chi la chiama scrive `deps.audio.setHostMute?.(…)`.
   */
  setHostMute?(reason: 'ad' | 'portal', on: boolean): void;
  /**
   * false se AudioContext è assente o negato: il gioco gira muto e l'HUD mostra
   * l'icona "no audio". `toggleMute` in quel caso non cambia nulla e ritorna true.
   */
  readonly available: boolean;
  /**
   * Brani personali trovati in `public/music/custom/`. **Opzionale**: chi
   * legge scrive `deps.audio.customTracks ?? []`. Assente e lista vuota
   * vogliono dire la stessa cosa: nessun brano personale. `playSong`, sotto,
   * ha comunque dovuto allargarsi (vedi la sua nota): non è rimasto un
   * cambio "solo additivo" al contratto, e `src/dev/null-audio.ts` è stato
   * toccato di conseguenza (revisione finale, Minor 7).
   */
  readonly customTracks?: readonly CustomTrack[];
  /**
   * Renderizza un campione di audio e ne ritorna le misure. Esiste solo per
   * la verifica d'ascolto degli end to end, che la raggiunge da
   * `window.__tebrun` con `#debug`. `null` se il browser non offre
   * OfflineAudioContext o se i campioni non ci sono.
   */
  renderSample?(kind: AudioSampleKind, seconds: number): Promise<AudioSampleReport | null>;
}
