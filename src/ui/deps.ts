import type { ParticleField } from '../render/effects';
import type { WorldLayers } from '../render/world';
import type { AssetStore, AudioBus, RaceEngine, RaceSnapshot, StageDef } from '../types';
import type { CarSetting } from '../persist/car';
import type { ModeSetting } from '../persist/mode';
import type { ScoresStore } from '../persist/scores';
import type { SystemSignals } from '../core/signals';
import type { ShareSlot } from './share';
import type { InputDevice } from '../core/device';
import type { DailySession } from './dailySession';
import type { DailyStore, InitialsMemory } from '../persist/daily';
import type { StreakStore } from '../persist/streak';
import type { BoardClient } from '../net/types';

/**
 * Dipendenze di cui ogni schermata ha bisogno, iniettate dal chiamante
 * (la pagina di sviluppo di questo binario, o il bootstrap reale in seguito).
 */
export interface ScreenDeps {
  assets: AssetStore;
  audio: AudioBus;
  scores: ScoresStore;
  raceFactory: (stage: StageDef, assets: AssetStore) => RaceEngine;
  /**
   * Motore della strada in autopilota del titolo (spec §11). Su `main` è
   * `createRace`, che non ha traffico né tempo, quindi la modalità
   * attrattiva non può concludersi da sola. Assente, si usa `raceFactory`.
   */
  attractFactory?: (stage: StageDef, assets: AssetStore) => RaceEngine;
  /**
   * `particles` è opzionale: il titolo chiama `renderWorld` senza campo di
   * particelle, la gara gliene passa uno.
   */
  renderWorld: (
    ctx: CanvasRenderingContext2D,
    snapshot: RaceSnapshot,
    assets: AssetStore,
    particles?: ParticleField,
    layers?: WorldLayers,
  ) => void;
  firstStage: StageDef;
  now?: () => number;
  /**
   * Auto scelta (Set 7): la radio la cambia con C, la gara e i finali la
   * leggono. Assente vale l'auto nuova, e la radio non mostra la scelta.
   */
  car?: CarSetting;
  /**
   * Modalità scelta (collaudo utente: due livelli di difficoltà): la radio
   * la cambia con D. Chi costruisce le gare la legge da sé (`main.ts`), le
   * schermate non la passano. Assente, la radio non la mostra.
   */
  mode?: ModeSetting;
  /**
   * Tocchi sul canvas e perdita del fuoco (lancio, punto 5): la gara li
   * legge per il menu di pausa e per la pausa automatica. Assente, la pausa
   * si apre e si usa solo da tastiera e gamepad.
   */
  signals?: SystemSignals;
  /**
   * Il risultato da condividere (lancio, punto 10): game over e finali lo
   * offrono, e dopo una condivisione restano fermi fino a ENTER. Assente,
   * niente pulsante SHARE.
   */
  share?: ShareSlot;
  /**
   * Il dispositivo in uso (lancio, punti 7 e 14): tastiera, gamepad o tocco.
   * Radio, gara e pausa ci scelgono i comandi da scrivere. Assente vale la
   * tastiera, come su un computer senza touch.
   */
  device?: () => InputDevice;
  /** Lo sterzo con inclinazione è acceso? Il suggerimento della gara lo dice. Assente vale spento. */
  tiltOn?: () => boolean;
  /**
   * L'input va ignorato adesso (la pubblicità fra due partite, build
   * crazygames)? Anche M: `app.ts` non lo guarda. Assente vale no.
   */
  inputLocked?: () => boolean;
  /** La finestra del permesso dei sensori è aperta? Il timer della radio intanto si ferma. Assente vale no. */
  tiltAsking?: () => boolean;
  /**
   * La sfida giornaliera in corso (spec classifica e sfida, §3.3): la apre
   * la schermata `daily`, la chiude il titolo. Assente, niente DAILY.
   */
  daily?: DailySession;
  /** Il record DAILY di oggi, in locale. Assente, nessun record. */
  dailyStore?: DailyStore;
  /** La serie di giorni della sfida, sul dispositivo. Assente, niente serie. */
  streak?: StreakStore;
  /** Le ultime iniziali, da cui riparte `nameEntry`. */
  initials?: InitialsMemory;
  /** La classifica mondiale (solo build con `WORLD_BOARD_BUILD`). Assente, solo la TOP 10 locale. */
  board?: BoardClient;
}
