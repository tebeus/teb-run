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
import { API_IS_PRODUCTION, debugHookOn, FEATURES, SDK_BUILD, STATS_BUILD, WORLD_BOARD_BUILD } from './core/target';
import { API_ORIGIN, DEV_API_ORIGIN } from './core/config';
import { createBoardClient } from './net/board';
import { AD_ENV, GAMEPLAY, PORTAL_SDK } from './core/gameplayEvents';
import { createTilt } from './core/tilt';
import { carFromSearch } from './game/car';
import { modeFromSearch, modeGraph, withMode } from './game/mode';
import { createFullRace, createRace } from './game/race';
import { REAL_GRAPH, STAGES } from './game/stages';
import { createDefaultCarSetting } from './persist/car';
import { createDefaultModeSetting } from './persist/mode';
import { createDefaultScoresStore } from './persist/scores';
import { createDailyStore, createInitialsMemory, defaultStorage } from './persist/daily';
import { dailyGraph } from './game/daily';
import { createDailySession, sessionCar, sessionMode } from './ui/dailySession';
import { createDefaultTiltSeenSetting, createDefaultTiltSetting } from './persist/tilt';
import { renderWorld } from './render/world';
import { createApp } from './ui/app';
import { installLaunchUi } from './ui/launchUi';
import { createShareSlot, installShareUi } from './ui/share';
import { startLoadingScreen } from './ui/loading';
import { createRotateGuard, guardSignals } from './ui/rotate';
import { createTouchControls } from './ui/touch';
import { createMouseClicks } from './ui/mouse';
import { overEndButtons } from './ui/retryMenu';
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
  const chosenCar = createDefaultCarSetting(carFromSearch(window.location.search));
  // La sfida giornaliera (spec classifica e sfida, §3): mentre è in corso
  // auto e modalità sono le sue, senza toccare la scelta salvata.
  const daily = createDailySession();
  const car = sessionCar(chosenCar, daily);
  const graph = REAL_GRAPH;
  // Caricamento a fasi (lancio, punto 12): prima solo titolo, radio e prima
  // tappa con l'auto scelta adesso; il resto arriva in background.
  const first = graph.first();
  const assets = loadAssets({ start: { stage: { id: first.id, theme: first.theme }, car: car.get() } });
  const audio = createAudioBus();
  // L'SDK di CrazyGames (solo build crazygames): si carica in background e
  // il gioco non lo aspetta mai. Il suo `muteAudio` zittisce il gioco.
  if (SDK_BUILD) {
    PORTAL_SDK.start((on) => audio.setHostMute?.('portal', on));
    PORTAL_SDK.loading(true);
    AD_ENV.mute = (on) => audio.setHostMute?.('ad', on);
  }
  // Modalità (collaudo utente: due livelli di difficoltà): `?mode=normal|hard`
  // vince su quella ricordata; senza nessuna delle due è NORMAL.
  const mode = sessionMode(createDefaultModeSetting(modeFromSearch(window.location.search)), daily);
  // Una classifica per modalità: quella della modalità scelta in quel momento.
  // Le partite DAILY non ci entrano (traffico diverso): lo decidono le schermate di fine partita.
  const scores = createDefaultScoresStore(() => mode.get());
  const storage = defaultStorage();
  const dailyStore = createDailyStore(storage);
  const initials = createInitialsMemory(storage);
  // La classifica mondiale (spec classifica e sfida, §2.7): nella build site
  // verso api.tebrun.io; nella privata solo con `?board=local`, verso
  // `wrangler dev` (cartella api/); nelle build portal e crazygames il
  // bundler toglie tutto, indirizzo compreso.
  const boardOrigin = API_IS_PRODUCTION
    ? API_ORIGIN
    : new URLSearchParams(window.location.search).get('board') === 'local'
      ? DEV_API_ORIGIN
      : null;
  const board =
    WORLD_BOARD_BUILD && boardOrigin !== null
      ? createBoardClient({ origin: boardOrigin, fetch: (url, init) => window.fetch(url, init), now: () => performance.now() })
      : undefined;
  // Statistiche senza cookie (lancio, punto 11): solo build site, mai in locale.
  const stats = STATS_BUILD && FEATURES.stats ? createStats(STATS_ENABLED, STATS_ENDPOINT, browserStatsEnv(window)) : NO_STATS;
  stats.pageview();

  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('the page has no canvas#game');
  const ctx = setupCanvas(canvas);
  // Tocchi sul canvas e perdita del fuoco, per il menu di pausa (lancio, punto 5).
  // In verticale sul telefono niente tocchi al gioco, e la gara va in pausa (lancio, punto 14).
  const signals = guardSignals(createSystemSignals(window, document, canvas));
  // Una pubblicità cominciata a gara partita (l'SDK in ritardo): la pausa.
  if (SDK_BUILD) AD_ENV.interrupt = () => signals.raiseFocusLost();
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
  if (SDK_BUILD) PORTAL_SDK.loading(false);
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
    tiltAsking: () => tilt.asking === true,
    daily,
    dailyStore,
    initials,
    ...(board === undefined ? {} : { board }),
    ...(SDK_BUILD ? { inputLocked: () => GAMEPLAY.adRunning() } : {}),
    raceFactory: (stage, a) => {
      // La modalità si legge qui, alla partenza: la radio la cambia solo
      // prima della gara, e il motore la trova nelle tappe del grafo.
      const chosen = mode.get();
      // Nella sfida del giorno anche il traffico del giorno, in ogni tappa.
      const challenge = daily.current();
      const salted = (s: typeof stage) => (challenge === null ? s : { ...s, trafficSalt: challenge.trafficSalt });
      const moded = salted(withMode((startStageId === null ? undefined : STAGES.get(startStageId)) ?? stage, chosen));
      const startStage = startTimeLimit === null ? moded : { ...moded, timeLimit: startTimeLimit };
      const moddedGraph = modeGraph(graph, chosen);
      const race = createFullRace({
        graph: challenge === null ? moddedGraph : dailyGraph(moddedGraph, challenge.trafficSalt),
        assets: a,
        startStage,
      });
      if (debugOn()) lastRace = race;
      stats.startGame(chosen, car.get());
      if (challenge !== null) stats.event(STAT_EVENTS.dailyStart());
      return trackRace(race, stats, startStage.id, challenge !== null);
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

  // Il clic del mouse (titolo, radio, TOP 10): dopo launchUi e share, che
  // tengono per sé i clic sui loro comandi.
  const mouse = createMouseClicks({
    win: window,
    canvas,
    screen: () => app.name,
    ignore: (p) => launchUi.hits(p) || shareUi.hits(p),
    pointerOver: (screen, p) => (screen === 'gameOver' || screen === 'ending') && overEndButtons(p),
  });

  createLoop({
    update: (dt) => {
      const actions = mergeActions(input.poll(), touch.poll());
      actions.click = mouse.poll();
      app.update(dt, actions);
    },
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
