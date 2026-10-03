import { loadAssets } from './core/assets';
import { createAudioBus } from './audio/bus';
import { setupCanvas } from './core/canvas';
import { showStartupError, startupErrorMessage } from './core/fatal';
import { installAudioUnlock } from './core/audioUnlock';
import { createDeviceTracker } from './core/device';
import { createInput, mergeActions } from './core/input';
import { createLoop } from './core/loop';
import { createSystemSignals } from './core/signals';
import { STATS_ENABLED, STATS_ENDPOINT } from './core/config';
import { browserStatsEnv, createStats, NO_STATS, STAT_EVENTS, trackRace } from './core/stats';
import { debugHookOn, FEATURES, STATS_BUILD } from './core/target';
import { createTilt } from './core/tilt';
import { carFromSearch } from './game/car';
import { modeFromSearch, modeGraph, withMode } from './game/mode';
import { createFullRace, createRace } from './game/race';
import { REAL_GRAPH, STAGES } from './game/stages';
import { createDefaultCarSetting } from './persist/car';
import { createDefaultModeSetting } from './persist/mode';
import { createDefaultScoresStore } from './persist/scores';
import { createDefaultTiltSeenSetting, createDefaultTiltSetting } from './persist/tilt';
import { renderWorld } from './render/world';
import { createApp } from './ui/app';
import { installLaunchUi } from './ui/launchUi';
import { createShareSlot, installShareUi } from './ui/share';
import { startLoadingScreen } from './ui/loading';
import { createRotateGuard, guardSignals } from './ui/rotate';
import { createTouchControls } from './ui/touch';
import type { Fsm } from './ui/fsm';
import type { AssetStore, AudioBus, CarChoice, Difficulty, RaceEngine, RaceSnapshot } from './types';
import type { AudioSampleKind } from './audio/offline';
import type { InputDevice } from './core/device';
import type { AudioSampleReport } from './audio/analysis';

/** Riferimenti esposti su `window.__tebrun` solo con `#debug` (per gli e2e). */
export interface DebugHandles {
  app: Fsm;
  audio: AudioBus;
  assets: AssetStore;
  /**
   * Verifica d'ascolto degli end to end (spec §16): renderizza un campione
   * di audio con un OfflineAudioContext e ne ritorna le misure. Assente se
   * il bus non la offre.
   */
  renderAudioSample?(kind: AudioSampleKind, seconds: number): Promise<AudioSampleReport | null>;
  /**
   * Snapshot dell'ultimo motore di gara costruito, o null se non ne è
   * ancora stato costruito nessuno (spec §16). Sola lettura, solo con
   * `#debug`: serve agli end to end per osservare `countdown`, `banner`
   * ed `extendTime` invece di indovinarli dai pixel. Dopo la fine di una
   * gara il riferimento resta, e lo snapshot è quello finale: chi lo
   * legge guarda anche `app.name`.
   */
  snapshot(): RaceSnapshot | null;
  /**
   * Tempo della tappa di partenza per le gare costruite da qui in poi;
   * `null` torna alla tabella. Solo con `#debug`: il test del checkpoint
   * misura il checkpoint, non l'abilità del suo autopilota, e con la tappa
   * lunga il tempo vero non gli lascia margine per gli incidenti. Le tappe
   * dopo il checkpoint tengono il loro tempo.
   */
  setStartTimeLimit(seconds: number | null): void;
  /**
   * Tappa di partenza delle gare costruite da qui in poi (un id come `4-1`);
   * `null` o un id sconosciuto tornano alla prima. Solo con `#debug`: agli
   * screenshot dei controlli touch servono sfondi chiari e scuri.
   */
  setStartStage(id: string | null): void;
  /** Auto scelta in questo momento (Set 7): la radio la cambia con C. */
  car(): CarChoice;
  /** Modalità scelta in questo momento: la radio la cambia con D. */
  mode(): Difficulty;
  /** Dispositivo in uso: tastiera, gamepad o tocco (lancio, punti 7 e 14). */
  device(): InputDevice;
}

declare global {
  interface Window {
    __tebrun?: DebugHandles;
  }
}

/** Frammento che accende il gancio di diagnostica (solo build privata e sviluppo). */
export const DEBUG_HASH = '#debug';

/** Il gancio è acceso adesso? Nelle build site e portal mai. */
const debugOn = (): boolean => debugHookOn(FEATURES, window.location.hash, DEBUG_HASH);

/** `performance.mark('teb-assets-<phase>')` e `data-assets` sul documento. */
function markAssetPhase(phase: 'initial' | 'all'): void {
  try {
    performance.mark(`teb-assets-${phase}`);
  } catch {
    // Resource Timing assente: resta l'attributo
  }
  document.documentElement.dataset.assets = phase;
}

/**
 * Bootstrap del gioco. Il "boot" non è una schermata: si attende
 * `assets.ready` e poi si costruisce l'app (decisione di contratto del
 * README dei piani).
 */
async function main(): Promise<void> {
  // Auto del giocatore (Set 7): `?car=new|classic|retro|sport|super` vince su quella
  // ricordata; senza nessuna delle due è la cabrio nuova.
  const car = createDefaultCarSetting(carFromSearch(window.location.search));
  const graph = REAL_GRAPH;
  // Caricamento a fasi (lancio, punto 12): prima solo titolo, radio e prima
  // tappa con l'auto scelta adesso; il resto arriva in background.
  const first = graph.first();
  const assets = loadAssets({ start: { stage: { id: first.id, theme: first.theme }, car: car.get() } });
  const audio = createAudioBus();
  // Modalità (collaudo utente: due livelli di difficoltà): `?mode=normal|hard`
  // vince su quella ricordata; senza nessuna delle due è NORMAL.
  const mode = createDefaultModeSetting(modeFromSearch(window.location.search));
  // Una classifica per modalità: quella della modalità scelta in quel momento.
  const scores = createDefaultScoresStore(() => mode.get());
  // Statistiche senza cookie (lancio, punto 11): solo build site, mai in locale.
  const stats = STATS_BUILD && FEATURES.stats ? createStats(STATS_ENABLED, STATS_ENDPOINT, browserStatsEnv(window)) : NO_STATS;
  stats.pageview();

  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('the page has no canvas#game');
  const ctx = setupCanvas(canvas);
  // Tocchi sul canvas e perdita del fuoco, per il menu di pausa (lancio, punto 5).
  // In verticale sul telefono niente tocchi al gioco, e la gara va in pausa (lancio, punto 14).
  const signals = guardSignals(createSystemSignals(window, document, canvas));
  // Tastiera, gamepad o tocco: i comandi a schermo seguono l'ultimo usato (lancio, punti 7 e 14).
  const device = createDeviceTracker(window);
  const rotate = createRotateGuard(window, device.current, () => signals.raiseFocusLost());
  signals.setBlocked(rotate.blocked);
  const input = createInput(window, device.notePad);

  // L'AudioContext vuole un gesto utente (Safari, iOS al primo tocco): vedi core/audioUnlock.
  installAudioUnlock(window, () => audio.unlock());

  // Schermata di caricamento, subito, fino a quando gli sprite sono pronti.
  const stopLoading = startLoadingScreen(ctx, assets);
  await assets.ready;
  stopLoading();
  // Segni per chi misura (e2e/weight.spec.ts): fine della fase iniziale e
  // fine del background, nel Resource Timing e sul <html>. Nessun dato.
  markAssetPhase('initial');
  void assets.all.then(() => markAssetPhase('all'));

  // Riferimento all'ultimo motore di gara costruito, per il gancio di
  // diagnostica. Vive qui e non nella schermata: `createRaceScreen` non
  // deve sapere niente degli end to end. Assegnato solo con `#debug`:
  // altrimenti terrebbe in vita il motore finito (~2500 segmenti e il suo
  // traffico) fino alla gara dopo, contro l'intento di `race.ts exit()`
  // («il motore va buttato»).
  let lastRace: RaceEngine | null = null;
  // Tempo forzato della tappa di partenza, solo dal gancio di diagnostica.
  let startTimeLimit: number | null = null;
  // Tappa di partenza forzata, solo dal gancio di diagnostica.
  let startStageId: string | null = null;

  // Il risultato da condividere a fine partita (lancio, punto 10).
  const share = createShareSlot();

  // TILT ricordato fra un caricamento e l'altro, come auto e modalità.
  const tilt = createTilt(window, createDefaultTiltSetting());

  const app = createApp({
    assets,
    share,
    audio,
    scores,
    car,
    mode,
    signals,
    device: device.current,
    // Ricordato acceso e in attesa del permesso conta già come acceso, come per i pulsanti.
    tiltOn: () => tilt.on || tilt.pending,
    raceFactory: (stage, a) => {
      // La modalità si legge qui, alla partenza: la radio la cambia solo
      // prima della gara, e il motore la trova nelle tappe del grafo.
      const chosen = mode.get();
      const moded = withMode((startStageId === null ? undefined : STAGES.get(startStageId)) ?? stage, chosen);
      const startStage = startTimeLimit === null ? moded : { ...moded, timeLimit: startTimeLimit };
      const race = createFullRace({ graph: modeGraph(graph, chosen), assets: a, startStage });
      if (debugOn()) lastRace = race;
      stats.startGame(chosen, car.get());
      return trackRace(race, stats, startStage.id);
    },
    // La strada del titolo gira su `createRace`: nessun traffico, nessun
    // tempo, nessun incidente, quindi la modalità attrattiva non finisce mai.
    attractFactory: (stage, a) => createRace(stage, a),
    renderWorld,
    firstStage: graph.first(),
  });

  // Solo con #debug (e solo nella build privata): riferimenti in sola lettura per i test end to end, che
  // altrimenti dovrebbero indovinare lo stato del gioco dai pixel.
  if (debugOn()) {
    const handles: DebugHandles = {
      app,
      audio,
      assets,
      snapshot: () => lastRace?.snapshot() ?? null,
      setStartTimeLimit: (seconds) => {
        startTimeLimit = seconds;
      },
      setStartStage: (id) => {
        startStageId = id;
      },
      car: () => car.get(),
      mode: () => mode.get(),
      device: device.current,
    };
    if (typeof audio.renderSample === 'function') {
      handles.renderAudioSample = (kind, seconds) => audio.renderSample!(kind, seconds);
    }
    window.__tebrun = handles;
  }

  // Schermo intero (tasto F, clic o tocco sul pulsante) e link del titolo.
  const launchUi = installLaunchUi(window, canvas, () => app.name);
  const shareUi = installShareUi(window, canvas, () => app.name, share, assets, () =>
    stats.event(STAT_EVENTS.share()),
  );
  // Controlli a schermo per le dita (lancio, punto 14): col mouse e la tastiera non fanno niente.
  const touch = createTouchControls({
    win: window,
    canvas,
    screen: () => app.name,
    device: device.current,
    tilt,
    tiltSeen: createDefaultTiltSeenSetting(),
    blocked: rotate.blocked,
  });

  createLoop({
    update: (dt) => app.update(dt, mergeActions(input.poll(), touch.poll())),
    render: () => {
      app.render(ctx);
      launchUi.draw(ctx);
      shareUi.draw(ctx);
      touch.draw(ctx);
      rotate.draw(ctx);
    },
  }).start();
}

void main().catch((reason: unknown) => {
  const message = startupErrorMessage(reason);
  console.error(message, reason);
  showStartupError(document, message);
});
