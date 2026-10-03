import { describe, expect, test, vi } from 'vitest';
import { busPhase, createAudioBus, enqueueSfx, musicAction, type AudioBusOptions } from '../../src/audio/bus';
import type { AudioContextCtor } from '../../src/audio/context';
import type { CustomEnv } from '../../src/audio/custom';
import { BYPASS_CUTOFF, sweepCentre } from '../../src/audio/effects';
import { DRUM_SAMPLE_NAMES, type SampleEnv } from '../../src/audio/samples';
import { SONGS, SONG_VOICINGS } from '../../src/audio/songs';
import { START_DELAY, STEPS_PER_BAR, resumeStep, songBars } from '../../src/audio/sequencer';

// Il sequencer vero, avvolto per leggere da quale step il bus fa partire
// ogni brano (ripresa dopo la pausa). Nessun altro comportamento cambia.
const seqPlays = vi.hoisted((): number[] => []);
vi.mock('../../src/audio/sequencer', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/audio/sequencer')>();
  return {
    ...mod,
    createSequencer: (...args: Parameters<typeof mod.createSequencer>) => {
      const inner = mod.createSequencer(...args);
      return {
        play(song: Parameters<typeof inner.play>[0], fromStep?: number): void {
          seqPlays.push(fromStep ?? 0);
          inner.play(song, fromStep);
        },
        stop: (): void => inner.stop(),
        get playing(): boolean {
          return inner.playing;
        },
        get position(): number | null {
          return inner.position;
        },
      };
    },
  };
});

// Contesto finto con resume() asincrona, come Safari: `census` conta i nodi
// creati, e gli oscillatori compaiono solo quando qualcosa suona davvero.
class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  // Il finto applica la rampa subito, invece di interpolare nel tempo: qui
  // interessa solo il valore di destinazione, non l'evoluzione temporale.
  setTargetAtTime(target: number): void {
    this.value = target;
  }
  cancelScheduledValues(): void {}
  cancelAndHoldAtTime(): void {}
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeDelay extends FakeNode {
  delayTime = new FakeParam();
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

class FakeOsc extends FakeSource {
  type = 'square';
  frequency = new FakeParam();
  setPeriodicWave(): void {}
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam();
}

class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}

class FakeCtx {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  census = {
    gain: 0,
    osc: 0,
    filter: 0,
    source: 0,
    wave: 0,
    buffer: 0,
    delay: 0,
    shaper: 0,
    decode: 0,
    convolver: 0,
    panner: 0,
    media: 0,
  };
  filters: FakeFilter[] = [];
  delays: FakeDelay[] = [];
  mediaSources: { element: unknown }[] = [];
  createMediaElementSource(element: unknown): { connect(): void; disconnect(): void } {
    this.census.media += 1;
    this.mediaSources.push({ element });
    return { connect: () => {}, disconnect: () => {} };
  }

  resume(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.state = 'running';
        this.onstatechange?.();
        resolve();
      }, 0);
    });
  }
  createGain(): FakeGain {
    this.census.gain += 1;
    return new FakeGain();
  }
  createOscillator(): FakeOsc {
    this.census.osc += 1;
    return new FakeOsc();
  }
  createBiquadFilter(): FakeFilter {
    this.census.filter += 1;
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createDelay(): FakeDelay {
    this.census.delay += 1;
    return new FakeDelay();
  }
  createBufferSource(): FakeBufferSource {
    this.census.source += 1;
    return new FakeBufferSource();
  }
  createPeriodicWave(): object {
    this.census.wave += 1;
    return {};
  }
  createBuffer(channels = 1, length = 16, rate = 48000): AudioBuffer {
    this.census.buffer += 1;
    const data = new Float32Array(length);
    return {
      length,
      duration: length / rate,
      numberOfChannels: channels,
      sampleRate: rate,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
  }
  createWaveShaper(): FakeShaper {
    this.census.shaper += 1;
    return new FakeShaper();
  }
  createConvolver(): { buffer: unknown; normalize: boolean; connect(): void; disconnect(): void } {
    this.census.convolver += 1;
    return { buffer: null as unknown, normalize: true, connect: () => {}, disconnect: () => {} };
  }
  createStereoPanner(): { pan: FakeParam; connect(): void; disconnect(): void } {
    this.census.panner += 1;
    return { pan: new FakeParam(), connect: () => {}, disconnect: () => {} };
  }
  decodeAudioData(_data: ArrayBuffer, onOk: (buffer: AudioBuffer) => void): void {
    this.census.decode += 1;
    onOk({ length: 4096, duration: 0.1, numberOfChannels: 1, sampleRate: this.sampleRate } as unknown as AudioBuffer);
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** `HTMLAudioElement` quanto basta al bus: src, play, pause, loop, volume. */
class FakeAudioElement {
  /** Il valore letteralmente assegnato a `.src`, senza risoluzione. */
  assignedSrc = '';
  loop = false;
  preload = '';
  crossOrigin: string | null = null;
  plays = 0;
  pauses = 0;
  currentTime = 0;
  /**
   * Come nel DOM vero: il getter di `HTMLMediaElement.src` riflette l'URL
   * risolto in assoluto, anche quando l'attributo è stato assegnato con un
   * percorso relativo. Riprodotto qui apposta, perché è la ragione per cui
   * `bus.ts` non poteva confrontare `.src` con l'url relativo (Important 3
   * della revisione finale, `tests/audio/bus.test.ts` sulla riselezione).
   */
  get src(): string {
    return this.assignedSrc === '' ? '' : `http://localhost${this.assignedSrc}`;
  }
  set src(value: string) {
    this.assignedSrc = value;
  }
  play(): Promise<void> {
    this.plays += 1;
    return Promise.resolve();
  }
  pause(): void {
    this.pauses += 1;
  }
}

function rig(
  sampleEnv?: SampleEnv,
  extra: Partial<AudioBusOptions> = {},
): { bus: ReturnType<typeof createAudioBus>; ctx: () => FakeCtx | null } {
  let made: FakeCtx | null = null;
  class Tracked extends FakeCtx {
    constructor() {
      super();
      made = this;
    }
  }
  const bus = createAudioBus(
    { AudioContext: Tracked as unknown as AudioContextCtor },
    { ...(sampleEnv === undefined ? {} : { sampleEnv }), ...extra },
  );
  return { bus, ctx: () => made };
}

describe('busPhase', () => {
  test('maps the host state', () => {
    expect(busPhase({ available: false, running: false })).toBe('unavailable');
    expect(busPhase({ available: false, running: true })).toBe('unavailable');
    expect(busPhase({ available: true, running: false })).toBe('locked');
    expect(busPhase({ available: true, running: true })).toBe('running');
  });
});

describe('musicAction', () => {
  test('starts the requested song', () => {
    expect(musicAction({ phase: 'running', requested: 0, playingIndex: null })).toBe('start');
  });

  test('does nothing when the same song is already playing', () => {
    expect(musicAction({ phase: 'running', requested: 1, playingIndex: 1 })).toBe('none');
  });

  test('restarts when another song is requested', () => {
    expect(musicAction({ phase: 'running', requested: 2, playingIndex: 1 })).toBe('start');
  });

  test('stops when nothing is requested', () => {
    expect(musicAction({ phase: 'running', requested: null, playingIndex: 2 })).toBe('stop');
  });

  test('does nothing when stopping with nothing playing', () => {
    expect(musicAction({ phase: 'running', requested: null, playingIndex: null })).toBe('none');
  });

  test('waits while the context is locked', () => {
    expect(musicAction({ phase: 'locked', requested: 0, playingIndex: null })).toBe('none');
    expect(musicAction({ phase: 'unavailable', requested: 0, playingIndex: null })).toBe('none');
  });

  test('stops music when the context leaves the running state', () => {
    expect(musicAction({ phase: 'locked', requested: 0, playingIndex: 0 })).toBe('stop');
    expect(musicAction({ phase: 'unavailable', requested: 1, playingIndex: 1 })).toBe('stop');
  });
});

describe('createAudioBus without AudioContext', () => {
  test('reports unavailable and muted', () => {
    const bus = createAudioBus({});
    expect(bus.available).toBe(false);
    expect(bus.muted).toBe(true);
  });

  test('is muted and every method is a no-op', () => {
    const bus = createAudioBus({});
    expect(bus.muted).toBe(true);
    expect(() => {
      bus.unlock();
      bus.playSong(0);
      bus.playSong(2);
      bus.stopSong();
      bus.stopSong();
      bus.sfx('crash');
      bus.sfx('blip');
      bus.setEngine(0.5, 'hi', true);
      bus.setEngine(0, 'lo', false);
      bus.setSkid(true);
      bus.setSkid(false);
      bus.setRumble(true);
      bus.setRumble(false);
    }).not.toThrow();
    expect(bus.muted).toBe(true);
    expect(bus.available).toBe(false);
  });

  test('toggleMute changes nothing and always reports muted', () => {
    const bus = createAudioBus({});
    expect(bus.toggleMute()).toBe(true);
    expect(bus.toggleMute()).toBe(true);
    expect(bus.muted).toBe(true);
    expect(bus.available).toBe(false);
  });

  test('unlock before any gesture is safe and idempotent', () => {
    const bus = createAudioBus({});
    expect(() => {
      bus.unlock();
      bus.unlock();
    }).not.toThrow();
    expect(bus.available).toBe(false);
    expect(bus.muted).toBe(true);
  });
});

describe('enqueueSfx', () => {
  test('appends an effect', () => {
    expect(enqueueSfx([], 'crash')).toEqual(['crash']);
    expect(enqueueSfx(['crash'], 'blip')).toEqual(['crash', 'blip']);
  });

  test('keeps only the most recent effects', () => {
    expect(enqueueSfx(['crash', 'bump', 'blip'], 'checkpoint')).toEqual([
      'bump',
      'blip',
      'checkpoint',
    ]);
    expect(enqueueSfx(['crash', 'bump'], 'blip', 2)).toEqual(['bump', 'blip']);
  });
});

describe('createAudioBus with a context that resumes asynchronously', () => {
  test('nothing is created before the first gesture', () => {
    const { bus, ctx } = rig();
    bus.playSong(0);
    bus.sfx('crash');
    bus.setEngine(0.5, 'hi', true);
    bus.setSkid(true);
    bus.setRumble(true);
    expect(ctx()).toBeNull();
    expect(bus.available).toBe(true);
    expect(bus.muted).toBe(false);
  });

  test('a song requested before the gesture starts when the context resumes', async () => {
    const { bus, ctx } = rig();
    bus.playSong(1);
    bus.unlock();
    expect(ctx()).not.toBeNull();
    // il contesto esiste ma è ancora sospeso: nessun oscillatore
    expect(ctx()?.census.osc).toBe(0);
    await tick();
    expect(ctx()?.census.osc ?? 0).toBeGreaterThan(0);
    expect(ctx()?.census.wave).toBeGreaterThan(0);
    bus.stopSong();
  });

  test('a sound effect asked before the gesture plays when the context resumes', async () => {
    const { bus, ctx } = rig();
    bus.sfx('blip');
    bus.unlock();
    expect(ctx()?.census.osc).toBe(0);
    await tick();
    expect(ctx()?.census.osc).toBe(1);
    bus.stopSong();
  });

  test('switching songs and stopping twice does not throw', async () => {
    const { bus, ctx } = rig();
    bus.unlock();
    await tick();
    expect(() => {
      bus.playSong(0);
      bus.playSong(2);
      bus.stopSong();
      bus.stopSong();
    }).not.toThrow();
    expect(ctx()?.census.osc ?? 0).toBeGreaterThan(0);
  });

  test('the engine runs without allocating a node per call', async () => {
    const { bus, ctx } = rig();
    bus.unlock();
    await tick();
    const context = ctx();
    if (context === null) throw new Error('no fake context was built');
    bus.setEngine(0.5, 'hi', true);
    const afterWarmUp = { ...context.census };
    for (let i = 0; i < 120; i++) bus.setEngine(0.5 + i * 1e-6, 'hi', true);
    expect(context.census).toEqual(afterWarmUp);
  });

  test('each song brings its own timbre: the music lowpass follows SONG_VOICINGS', async () => {
    const { bus, ctx } = rig();
    bus.unlock();
    await tick();
    const context = ctx();
    if (context === null) throw new Error('no fake context was built');
    // createMusicFx è il primo a chiedere un filtro in ensureNodes, quindi
    // filters[0] è il passa-basso della musica.
    const musicFilter = context.filters[0];
    expect(musicFilter).toBeDefined();

    bus.playSong(0); // disco: sweep
    const discoSweep = SONG_VOICINGS[0].sweep;
    if (discoSweep === null) throw new Error('the disco song is expected to sweep');
    expect(musicFilter?.frequency.value).toBe(sweepCentre(discoSweep));

    bus.playSong(1); // chill-out: nessuno sweep, filtro aperto
    expect(SONG_VOICINGS[1].sweep).toBeNull();
    expect(musicFilter?.frequency.value).toBe(BYPASS_CUTOFF);

    bus.playSong(2); // techno: sweep più ampio
    const technoSweep = SONG_VOICINGS[2].sweep;
    if (technoSweep === null) throw new Error('the techno song is expected to sweep');
    expect(musicFilter?.frequency.value).toBe(sweepCentre(technoSweep));
    bus.stopSong();
  });

  test('stopSong opens the filter instead of leaving it parked on the last sweep', async () => {
    const { bus, ctx } = rig();
    bus.unlock();
    await tick();
    const context = ctx();
    if (context === null) throw new Error('no fake context was built');
    const musicFilter = context.filters[0];

    bus.playSong(0); // disco: sweep
    const discoSweep = SONG_VOICINGS[0].sweep;
    if (discoSweep === null) throw new Error('the disco song is expected to sweep');
    expect(musicFilter?.frequency.value).toBe(sweepCentre(discoSweep));

    bus.stopSong();
    // Il filtro non deve restare al centro dello sweep del brano finito: la
    // prossima nota del brano successivo si sentirebbe con il taglio vecchio.
    expect(musicFilter?.frequency.value).toBe(BYPASS_CUTOFF);
  });

  test('the music goes through the delay but the sound effects do not', async () => {
    const { bus, ctx } = rig();
    bus.unlock();
    await tick();
    // ora sono tre: quello a tempo più i due del chorus
    expect(ctx()?.census.delay).toBe(3);
  });

  test('no oscillator exists after unlock, three appear with the first song', async () => {
    const { bus, ctx } = rig(sampleEnvNone());
    bus.unlock();
    await tick();
    expect(ctx()?.census.osc).toBe(0);
    bus.playSong(1);
    // Due LFO del chorus, uno dello sweep, più gli oscillatori delle note
    // che il primo tick del sequencer ha già programmato.
    expect(ctx()?.census.osc ?? 0).toBeGreaterThanOrEqual(3);
    bus.stopSong();
  });

  test('CONTINUE resumes a synth song from its step; a plain playSong starts from the top', async () => {
    const { bus, ctx } = rig(sampleEnvNone());
    bus.unlock();
    await tick();
    const c = ctx()!;
    seqPlays.length = 0;
    bus.playSong(1);
    // Avanti di qualche secondo: lo step sentito è ben oltre lo zero.
    c.currentTime = 3.3;
    bus.stopSong();
    bus.playSong(1, { resume: true });
    const song = SONGS[1]!;
    const expected = resumeStep(song.bpm, START_DELAY, 3.3, songBars(song) * STEPS_PER_BAR);
    expect(expected).toBeGreaterThan(0);
    expect(seqPlays).toEqual([0, expected]);
    // Il brano riparte dallo step in cui era, quindi suona di nuovo da lì.
    c.currentTime = 9;
    bus.stopSong();
    bus.playSong(1);
    expect(seqPlays[2]).toBe(0);
    // Riprendere un brano diverso da quello fermato parte dall'inizio.
    bus.stopSong();
    bus.playSong(2, { resume: true });
    expect(seqPlays[3]).toBe(0);
    bus.stopSong();
  });

  test('available and muted follow the host', async () => {
    const { bus } = rig();
    bus.unlock();
    await tick();
    expect(bus.available).toBe(true);
    expect(bus.toggleMute()).toBe(true);
    expect(bus.muted).toBe(true);
    expect(bus.toggleMute()).toBe(false);
    expect(bus.muted).toBe(false);
  });
});

/** Ambiente dei campioni: tutto presente, oppure niente. */
const sampleEnvAll = (): SampleEnv => ({
  fetchJson: () =>
    Promise.resolve({
      engine_low: 'engine_low.ogg',
      engine_high: 'engine_high.ogg',
      'drums/kick': 'drums/kick.ogg',
    }),
  fetchBytes: () => Promise.resolve(new ArrayBuffer(16)),
  log: () => {},
});

const sampleEnvNone = (): SampleEnv => ({
  fetchJson: () => Promise.reject(new Error('HTTP 404')),
  fetchBytes: () => Promise.reject(new Error('HTTP 404')),
  log: () => {},
});

describe('createAudioBus and the engine samples', () => {
  test('nothing is fetched before the first gesture', () => {
    const calls: string[] = [];
    const env: SampleEnv = {
      fetchJson: (url) => {
        calls.push(url);
        return Promise.resolve({});
      },
      fetchBytes: (url) => {
        calls.push(url);
        return Promise.resolve(new ArrayBuffer(0));
      },
      log: () => {},
    };
    let made: FakeCtx | null = null;
    class Tracked extends FakeCtx {
      constructor() {
        super();
        made = this;
      }
    }
    const bus = createAudioBus({ AudioContext: Tracked as unknown as AudioContextCtor }, { sampleEnv: env });
    bus.setEngine(0.5, 'lo', true);
    bus.playSong(0);
    expect(calls).toEqual([]);
    expect(made).toBeNull();
  });

  test('with both loops present the sampled engine takes over and creates no oscillator', async () => {
    const { bus, ctx } = rig(sampleEnvAll());
    bus.unlock();
    await tick();
    const before = ctx()?.census.osc ?? -1;
    bus.setEngine(0.5, 'lo', true);
    // Il motore campionato ha un solo oscillatore, l'LFO del tremolo; il
    // sintetico ne avrebbe quattro (due seghe, la quadra, l'LFO).
    expect((ctx()?.census.osc ?? 0) - before).toBeLessThanOrEqual(1);
    expect(ctx()?.census.source ?? 0).toBeGreaterThanOrEqual(2);
  });

  test('without the samples the engine stays synthetic and nothing rejects', async () => {
    const { bus, ctx } = rig(sampleEnvNone());
    bus.unlock();
    await tick();
    bus.setEngine(0.5, 'lo', true);
    // Quattro oscillatori: due seghe scordate, la quadra un'ottava sotto, l'LFO.
    expect(ctx()?.census.osc ?? 0).toBeGreaterThanOrEqual(4);
  });

  test('with only one of the two loops the engine stays synthetic', async () => {
    const half: SampleEnv = {
      fetchJson: () => Promise.resolve({ engine_low: 'engine_low.ogg' }),
      fetchBytes: () => Promise.resolve(new ArrayBuffer(16)),
      log: () => {},
    };
    const { bus, ctx } = rig(half);
    bus.unlock();
    await tick();
    bus.setEngine(0.5, 'lo', true);
    expect(ctx()?.census.osc ?? 0).toBeGreaterThanOrEqual(4);
  });

  test('a real fetch in Node is only a missing sample, not an unhandled rejection', async () => {
    // Senza env finto il bus usa `fetch` vero: in Node un URL relativo
    // lancia. Se il loader lasciasse scappare il rifiuto, vitest farebbe
    // fallire il file con un unhandled rejection.
    const { bus } = rig();
    bus.unlock();
    await tick();
    await tick();
    expect(() => bus.setEngine(0.4, 'hi', true)).not.toThrow();
  });

  test('with the drum samples present the drums stop being synthetic', async () => {
    const env: SampleEnv = {
      fetchJson: () =>
        Promise.resolve(
          Object.fromEntries(DRUM_SAMPLE_NAMES.map((name) => [name, `${name}.ogg`])),
        ),
      fetchBytes: () => Promise.resolve(new ArrayBuffer(16)),
      log: () => {},
    };
    const { bus, ctx } = rig(env);
    bus.unlock();
    await tick();
    const before = ctx()?.census.source ?? 0;
    bus.playSong(2); // techno: cassa su ogni quarto, parte subito
    // Il primo tick del sequencer programma già la prima battuta: i colpi
    // sono AudioBufferSourceNode, non rumore filtrato.
    expect((ctx()?.census.source ?? 0) - before).toBeGreaterThan(0);
    // E non è nato nessun filtro per i colpi: i campioni non ne hanno bisogno.
    bus.stopSong();
  });

  test('without the drum samples the drums stay synthetic and nothing throws', async () => {
    const { bus } = rig(sampleEnvNone());
    bus.unlock();
    await tick();
    expect(() => {
      bus.playSong(2);
      bus.stopSong();
    }).not.toThrow();
  });
});

describe('createAudioBus and the custom tracks', () => {
  const customEnv = (tracks: unknown): CustomEnv => ({
    fetchJson: () => Promise.resolve(tracks),
    log: () => {},
  });

  test('the tracks are empty until the manifest has been read', async () => {
    const elements: FakeAudioElement[] = [];
    const { bus } = rig(sampleEnvNone(), {
      customEnv: customEnv([{ file: 'a.mp3', title: 'A' }]),
      makeAudio: () => {
        const element = new FakeAudioElement();
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
    });
    expect(bus.customTracks).toEqual([]);
    bus.unlock();
    await tick();
    await tick();
    expect(bus.customTracks).toEqual([{ file: 'a.mp3', title: 'A' }]);
    expect(elements).toHaveLength(0); // nessun elemento prima di suonare
  });

  test('playSong(3) plays the first custom track through the graph', async () => {
    const elements: FakeAudioElement[] = [];
    const { bus, ctx } = rig(sampleEnvNone(), {
      customEnv: customEnv([{ file: 'night drive.mp3', title: 'Night Drive' }]),
      makeAudio: () => {
        const element = new FakeAudioElement();
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
    });
    bus.unlock();
    await tick();
    await tick();
    bus.playSong(3);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.assignedSrc).toBe('/music/custom/night%20drive.mp3');
    expect(elements[0]?.plays).toBe(1);
    expect(elements[0]?.loop).toBe(true);
    // Passa dal grafo, quindi dal master gain, quindi dal mute.
    expect(ctx()?.census.media).toBe(1);
  });

  test('switching custom track reuses the one element: a source node is per element, for life', async () => {
    const elements: FakeAudioElement[] = [];
    const { bus, ctx } = rig(sampleEnvNone(), {
      customEnv: customEnv([
        { file: 'a.mp3', title: 'A' },
        { file: 'b.mp3', title: 'B' },
      ]),
      makeAudio: () => {
        const element = new FakeAudioElement();
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
    });
    bus.unlock();
    await tick();
    await tick();
    bus.playSong(3);
    bus.playSong(4);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.assignedSrc).toBe('/music/custom/b.mp3');
    expect(ctx()?.census.media).toBe(1);
  });

  test('re-requesting the same custom track after it stopped resumes it instead of restarting: Important 3 della revisione finale', async () => {
    // `element.src` (il getter) riflette l'URL risolto in assoluto: un
    // confronto diretto con l'url relativo era sempre falso, e la guardia di
    // playCustom ricaricava l'elemento (azzerando currentTime) ogni volta
    // che si tornava sullo stesso brano dopo uno stop, per esempio dopo che
    // il contesto si è sospeso e ripreso (Safari in background). `playSong`
    // due volte di seguito con lo stesso indice non basta a farlo scattare:
    // il bus lo deduplica già a monte (`musicAction`); serve un giro di
    // stop nel mezzo, come capita davvero quando il contesto lascia
    // "running".
    const elements: FakeAudioElement[] = [];
    const { bus } = rig(sampleEnvNone(), {
      customEnv: customEnv([{ file: 'a.mp3', title: 'A' }]),
      makeAudio: () => {
        const element = new FakeAudioElement();
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
    });
    bus.unlock();
    await tick();
    await tick();
    bus.playSong(3);
    const element = elements[0]!;
    element.currentTime = 42; // si simula che il brano sia già a metà
    bus.stopSong();
    bus.playSong(3); // stesso indice, richiesto di nuovo dopo lo stop
    expect(element.currentTime).toBe(42); // non riavvolto: nessun ricaricamento
    expect(element.plays).toBe(2); // play() si chiama di nuovo, ma senza toccare src/currentTime
  });

  test('a synthetic song stops the custom track and the other way round', async () => {
    const elements: FakeAudioElement[] = [];
    const { bus } = rig(sampleEnvNone(), {
      customEnv: customEnv([{ file: 'a.mp3', title: 'A' }]),
      makeAudio: () => {
        const element = new FakeAudioElement();
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
    });
    bus.unlock();
    await tick();
    await tick();
    bus.playSong(3);
    bus.playSong(0);
    expect(elements[0]?.pauses).toBe(1);
    bus.playSong(3);
    expect(elements[0]?.plays).toBe(2);
  });

  test('stopSong pauses the custom track: leaving the radio must not keep it running', async () => {
    const elements: FakeAudioElement[] = [];
    const { bus } = rig(sampleEnvNone(), {
      customEnv: customEnv([{ file: 'a.mp3', title: 'A' }]),
      makeAudio: () => {
        const element = new FakeAudioElement();
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
    });
    bus.unlock();
    await tick();
    await tick();
    bus.playSong(3);
    bus.stopSong();
    expect(elements[0]?.pauses).toBe(1);
  });

  test('an index past the end of the list stops the music instead of throwing', async () => {
    const { bus } = rig(sampleEnvNone(), { customEnv: customEnv([]) });
    bus.unlock();
    await tick();
    await tick();
    expect(() => {
      bus.playSong(3);
      bus.playSong(99);
      bus.playSong(-1);
    }).not.toThrow();
  });

  test('without a document there is no element and nothing throws', async () => {
    // Node: `document` non esiste. Il bus non deve provarci.
    const { bus } = rig(sampleEnvNone(), { customEnv: customEnv([{ file: 'a.mp3', title: 'A' }]) });
    bus.unlock();
    await tick();
    await tick();
    expect(() => bus.playSong(3)).not.toThrow();
  });
});
