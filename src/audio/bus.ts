// Composizione di tutto l'audio dietro l'interfaccia AudioBus di src/types.ts.

import type { AudioBus, Gear, SfxName } from '../types';
import type { AudioSampleReport } from './analysis';
import { createAudioHost, type AudioHost, type AudioScope } from './context';
import { CUSTOM_BASE, customTrackUrl, loadCustomManifest, type CustomEnv, type CustomTrack } from './custom';
import { createDrumKit } from './drums';
import { createSampledEngine } from './engine-sampled';
import { createMusicFx, type MusicFx } from './effects';
import { renderAudioSample, type AudioSampleKind } from './offline';
import { loadSamples, usableBuffer, type SampleEnv, type SampleStore } from './samples';
import { createSequencer, type Sequencer } from './sequencer';
import { createSfx, type SfxPlayer } from './sfx';
import { createSynth, type Synth } from './synth';
import { SONGS, SONG_VOICINGS } from './songs';

export type BusPhase = 'unavailable' | 'locked' | 'running';
export type MusicAction = 'start' | 'stop' | 'none';

/** Quanti effetti a scatto teniamo in attesa del primo gesto utile. */
export const PENDING_SFX_MAX = 3;

/**
 * Guadagno del synth della musica, poco sotto l'unità: lascia un margine
 * prima del limitatore del bus (`effects.ts`), che altrimenti comprimerebbe
 * più del previsto quando chorus e riverbero si sommano in fase.
 */
export const MUSIC_SYNTH_LEVEL = 0.85;

/**
 * Aggiunge un effetto alla coda di attesa tenendo solo i più recenti: se il
 * contesto non parte mai, la coda non cresce. Pura.
 */
export function enqueueSfx(
  queue: readonly SfxName[],
  name: SfxName,
  max: number = PENDING_SFX_MAX,
): SfxName[] {
  const next = [...queue, name];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function busPhase(host: { available: boolean; running: boolean }): BusPhase {
  if (!host.available) return 'unavailable';
  return host.running ? 'running' : 'locked';
}

/** Decisione pura sul sequencer, dato lo stato del bus. */
export function musicAction(state: {
  phase: BusPhase;
  requested: number | null;
  playingIndex: number | null;
}): MusicAction {
  if (state.phase !== 'running') return state.playingIndex === null ? 'none' : 'stop';
  if (state.requested === null) return state.playingIndex === null ? 'none' : 'stop';
  return state.requested === state.playingIndex ? 'none' : 'start';
}

export type MusicSource = 'none' | 'synth' | 'custom';

/**
 * Quale sorgente serve per l'indice chiesto: i primi `SONGS.length` sono
 * sintetici, i successivi sono brani personali, e un indice fuori
 * dall'elenco è come nessuna richiesta. Pura.
 */
export function musicSource(index: number | null, customCount: number): MusicSource {
  if (index === null || !Number.isInteger(index) || index < 0) return 'none';
  if (index < SONGS.length) return 'synth';
  return index - SONGS.length < customCount ? 'custom' : 'none';
}

/** L'elemento vero, se c'è un documento (in Node non c'è). */
function defaultMakeAudio(): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null;
  return document.createElement('audio');
}

function defaultCustomEnv(): CustomEnv {
  return {
    async fetchJson(url: string): Promise<unknown> {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.json();
    },
    log(message: string): void {
      console.info(`[audio] ${message}`);
    },
  };
}

export interface AudioBusOptions {
  /** Ambiente di caricamento dei campioni; i test ne passano uno finto. */
  sampleEnv?: SampleEnv;
  customEnv?: CustomEnv;
  /** Costruttore dell'elemento audio; i test ne passano uno finto. */
  makeAudio?: () => HTMLAudioElement | null;
}

export function createAudioBus(scope?: AudioScope, options: AudioBusOptions = {}): AudioBus {
  const sampleEnv = options.sampleEnv;
  const scopeRef: AudioScope = scope ?? (globalThis as AudioScope);
  const host: AudioHost = createAudioHost(scope);
  let requested: number | null = null;
  let playingIndex: number | null = null;
  // Ripresa dopo la pausa: dove era il brano sintetico quando si è fermato,
  // e se la richiesta in corso vuole riprendere da lì. I brani personali non
  // ne hanno bisogno, perché `<audio>` in pausa tiene da sé il suo punto.
  let resumePoint: { index: number; step: number } | null = null;
  let resumeWanted = false;
  let music: { synth: Synth; sequencer: Sequencer; fx: MusicFx } | null = null;
  let sfxPlayer: SfxPlayer | null = null;
  let waitingForContext = false;
  let pendingSfx: SfxName[] = [];
  let waitingForSfx = false;
  let samples: SampleStore | null = null;
  let sampledTried = false;
  let customTracks: readonly CustomTrack[] = [];
  let custom: { element: HTMLAudioElement; node: MediaElementAudioSourceNode } | null = null;
  /**
   * Ultimo url assegnato all'elemento, per sapere se riselezionare lo stesso
   * brano deve ricaricarlo. `custom.element.src` non basta: il getter del DOM
   * riflette l'URL risolto in assoluto, quindi confrontarlo con l'url
   * relativo che costruiamo (`customTrackUrl`) è sempre falso, e la guardia
   * di `playCustom` non scattava mai (Important 3 della revisione finale).
   */
  let customUrl: string | null = null;

  /**
   * Un `MediaElementAudioSourceNode` si può creare una volta sola per
   * elemento, quindi l'elemento è uno e si riusa cambiandogli `src`. Passa
   * dal master gain, così `M` lo silenzia come tutto il resto.
   */
  function ensureCustom(): boolean {
    if (custom !== null) return true;
    const ctx = host.ctx;
    const master = host.master;
    if (ctx === null || master === null) return false;
    const make = options.makeAudio ?? defaultMakeAudio;
    const element = make();
    if (element === null) return false;
    element.loop = true;
    element.preload = 'none';
    const node = ctx.createMediaElementSource(element);
    node.connect(master);
    custom = { element, node };
    return true;
  }

  function playCustom(trackIndex: number): void {
    const track = customTracks[trackIndex];
    if (track === undefined) return;
    const url = customTrackUrl(CUSTOM_BASE, track.file);
    if (url === null) return;
    if (!ensureCustom() || custom === null) return;
    if (customUrl !== url) {
      custom.element.src = url;
      custom.element.currentTime = 0;
      customUrl = url;
    }
    // play() ritorna una promessa che il browser rifiuta se non c'è stato un
    // gesto utente. Qui siamo dopo unlock(), quindi c'è: se rifiuta comunque,
    // il brano non parte e non c'è altro da fare che non far esplodere il tick.
    void Promise.resolve(custom.element.play()).catch(() => {});
  }

  function stopCustom(): void {
    custom?.element.pause();
  }

  /**
   * Passa al motore campionato se e solo se ci sono **entrambi** i loop: con
   * un solo buffer il crossfade suonerebbe a metà, e il synth V8 è meglio di
   * un motore mezzo muto.
   */
  function useSampledEngineIfReady(): void {
    if (sampledTried) return;
    const ctx = host.ctx;
    const master = host.master;
    if (ctx === null || master === null || samples === null || sfxPlayer === null) return;
    const low = samples.get('engine_low');
    const high = samples.get('engine_high');
    if (!usableBuffer(low) || !usableBuffer(high) || low === null || high === null) {
      sampledTried = true;
      return;
    }
    sampledTried = true;
    sfxPlayer.useSampledEngine(createSampledEngine(ctx, master, { low, high }));
  }

  let kitTried = false;

  /**
   * Collega la batteria campionata al synth della musica. Basta un campione
   * per valerne la pena: quelli che mancano cadono sul colpo sintetico, e un
   * kit misto è meglio di un kit tutto sintetico.
   */
  function useDrumKitIfReady(): void {
    if (kitTried) return;
    const ctx = host.ctx;
    if (ctx === null || samples === null || music === null) return;
    kitTried = true;
    const store = samples;
    const kit = createDrumKit(ctx, music.fx.input, (name) => store.get(name));
    music.synth.useDrumKit(kit.available ? kit : null);
  }

  function ensureNodes(): void {
    if (music !== null) return;
    const ctx = host.ctx;
    const master = host.master;
    if (ctx === null || master === null) return;
    // La musica passa per gli effetti (delay e passa-basso); gli effetti
    // sonori vanno diretti al master, perché un urto con la coda del delay
    // arriverebbe in ritardo sull'immagine.
    const fx = createMusicFx(ctx, master);
    const synth = createSynth(ctx, fx.input);
    synth.setDuty('pulse1', 0.5);
    synth.setDuty('pulse2', 0.25);
    synth.output.gain.value = MUSIC_SYNTH_LEVEL;
    music = { synth, sequencer: createSequencer(ctx, synth), fx };
    sfxPlayer = createSfx(ctx, master);
    // I campioni si caricano solo ora: prima di unlock() non c'è nessun
    // AudioContext con cui decodificarli (spec §13a). `ready` non rifiuta
    // mai, quindi questo `then` non ha bisogno di un `catch`.
    samples = loadSamples(ctx, { env: sampleEnv });
    void samples.ready.then(() => {
      useSampledEngineIfReady();
      useDrumKitIfReady();
    });
    void loadCustomManifest(options.customEnv ?? defaultCustomEnv()).then((tracks) => {
      customTracks = tracks;
    });
  }

  /** Suona gli effetti chiesti prima che il contesto fosse in esecuzione. */
  function flushPendingSfx(): void {
    const queued = pendingSfx;
    pendingSfx = [];
    waitingForSfx = false;
    if (queued.length === 0) return;
    ensureNodes();
    if (sfxPlayer === null) return;
    for (const name of queued) sfxPlayer.play(name);
  }

  function sync(): void {
    const phase = busPhase(host);
    // Questo ramo non cambia: è quello che fa partire, quando il contesto
    // riprende, un brano chiesto mentre era ancora sospeso (Safari).
    if (phase === 'locked' && requested !== null && !waitingForContext) {
      waitingForContext = true;
      host.whenRunning(() => {
        waitingForContext = false;
        ensureNodes();
        sync();
      });
    }
    const source = musicSource(requested, customTracks.length);
    // Un indice fuori dall'elenco vale come "nessuna richiesta": la musica si
    // ferma, non si lancia.
    const action = musicAction({
      phase,
      requested: source === 'none' ? null : requested,
      playingIndex,
    });
    if (action === 'start') {
      ensureNodes();
      if (requested === null) return;
      if (source === 'custom') {
        // Il sequencer e un brano personale non suonano mai insieme.
        music?.sequencer.stop();
        music?.fx.setSweep(null);
        resumePoint = null;
        playCustom(requested - SONGS.length);
        playingIndex = requested;
        return;
      }
      if (music === null) return;
      stopCustom();
      const song = SONGS[requested];
      const voicing = SONG_VOICINGS[requested];
      // Con un indice `number` questi due possono essere undefined, e
      // `musicSource` da solo non basta a convincerne TypeScript.
      if (song === undefined || voicing === undefined) return;
      // Da qui in giù è il ramo sintetico di prima, invariato tranne
      // `fx.start()`, che il task 7 ha aggiunto.
      music.synth.setDuty('pulse1', voicing.pulse1);
      music.synth.setDuty('pulse2', voicing.pulse2);
      music.fx.setBpm(song.bpm);
      music.fx.setSweep(voicing.sweep);
      music.fx.start();
      const from = resumeWanted && resumePoint?.index === requested ? resumePoint.step : 0;
      resumePoint = null;
      music.sequencer.play(song, from);
      playingIndex = requested;
    } else if (action === 'stop') {
      const at = music?.sequencer.position ?? null;
      resumePoint = playingIndex !== null && at !== null ? { index: playingIndex, step: at } : null;
      music?.sequencer.stop();
      // Altrimenti il filtro resta parcheggiato al centro dello sweep del
      // brano appena finito.
      music?.fx.setSweep(null);
      stopCustom();
      playingIndex = null;
    }
  }

  return {
    unlock(): void {
      host.unlock();
      ensureNodes();
      sync();
    },
    playSong(index: number, options?: { resume?: boolean }): void {
      requested = index;
      resumeWanted = options?.resume === true;
      sync();
    },
    get customTracks(): readonly CustomTrack[] {
      return customTracks;
    },
    stopSong(): void {
      requested = null;
      sync();
    },
    sfx(name: SfxName): void {
      if (!host.available) return;
      if (!host.running) {
        // Safari crea il contesto sospeso e resume() è asincrona: senza questa
        // coda il primo effetto del gesto iniziale andrebbe perso.
        pendingSfx = enqueueSfx(pendingSfx, name);
        if (!waitingForSfx) {
          waitingForSfx = true;
          host.whenRunning(flushPendingSfx);
        }
        return;
      }
      ensureNodes();
      sfxPlayer?.play(name);
    },
    setEngine(speedPercent: number, gear: Gear, running: boolean): void {
      if (!host.running) return;
      ensureNodes();
      sfxPlayer?.setEngine(speedPercent, gear, running);
    },
    setSkid(on: boolean): void {
      if (!host.running) return;
      ensureNodes();
      sfxPlayer?.setSkid(on);
    },
    setRumble(on: boolean, speedPercent = 0): void {
      if (!host.running) return;
      ensureNodes();
      sfxPlayer?.setRumble(on, speedPercent);
    },
    setRain(level: number): void {
      if (!host.running) return;
      ensureNodes();
      sfxPlayer?.setRain(level);
    },
    stopAll(): void {
      if (!host.running) return;
      sfxPlayer?.stopAll();
    },
    toggleMute(): boolean {
      return host.toggleMute();
    },
    setHostMute(reason, on) {
      host.setHostMute(reason, on);
    },
    get muted(): boolean {
      return host.muted;
    },
    get available(): boolean {
      return host.available;
    },
    async renderSample(kind: AudioSampleKind, seconds: number): Promise<AudioSampleReport | null> {
      const ctx = host.ctx;
      if (ctx === null) return null;
      ensureNodes();
      if (samples === null) return null;
      await samples.ready;
      const ctor =
        (scopeRef.OfflineAudioContext ?? scopeRef.webkitOfflineAudioContext) ?? undefined;
      if (typeof ctor !== 'function') return null;
      return renderAudioSample(kind, seconds, {
        sampleRate: ctx.sampleRate,
        samples,
        make: (channels, length, rate) => {
          try {
            return new ctor(channels, length, rate);
          } catch {
            return null;
          }
        },
      });
    },
  };
}
