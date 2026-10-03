import { describe, expect, test, vi } from 'vitest';
import {
  createSampleEnv,
  DRUM_SAMPLE_NAMES,
  ENGINE_SAMPLE_NAMES,
  loadSamples,
  parseSampleManifest,
  sampleUrl,
  usableBuffer,
  type SampleEnv,
} from '../../src/audio/samples';

// Il minimo di AudioContext che serve al loader: solo decodeAudioData, nella
// forma con le callback, che è quella supportata anche dal Safari vecchio.
class FakeDecodeCtx {
  decoded: number[] = [];
  constructor(
    private readonly outcome: (bytes: ArrayBuffer) => { length: number; channels: number } | null,
  ) {}
  decodeAudioData(
    data: ArrayBuffer,
    onOk: (buffer: AudioBuffer) => void,
    onErr: (reason: unknown) => void,
  ): void {
    const shape = this.outcome(data);
    this.decoded.push(data.byteLength);
    if (shape === null) {
      onErr(new Error('non decodificabile'));
      return;
    }
    onOk({
      length: shape.length,
      duration: shape.length / 44100,
      numberOfChannels: shape.channels,
      sampleRate: 44100,
    } as unknown as AudioBuffer);
  }
}

const ALL_NAMES = [...ENGINE_SAMPLE_NAMES, ...DRUM_SAMPLE_NAMES];

const fullManifest = (): Record<string, string> =>
  Object.fromEntries(ALL_NAMES.map((name) => [name, `${name}.ogg`]));

function envWith(manifest: unknown, bytes: (url: string) => Promise<ArrayBuffer>): SampleEnv {
  return {
    fetchJson: () => Promise.resolve(manifest),
    fetchBytes: bytes,
    log: () => {},
  };
}

const okBytes = (url: string): Promise<ArrayBuffer> =>
  Promise.resolve(new ArrayBuffer(url.length + 8));

describe('parseSampleManifest', () => {
  test('keeps the known names and drops everything else', () => {
    const parsed = parseSampleManifest({
      engine_low: 'engine_low.ogg',
      'drums/kick': 'drums/kick.ogg',
      unknown_name: 'x.ogg',
      engine_high: 42,
    });
    expect(parsed).toEqual({ engine_low: 'engine_low.ogg', 'drums/kick': 'drums/kick.ogg' });
  });

  test('a manifest that is not an object is empty, not a throw', () => {
    expect(parseSampleManifest(null)).toEqual({});
    expect(parseSampleManifest('engine_low')).toEqual({});
    expect(parseSampleManifest([1, 2, 3])).toEqual({});
    expect(parseSampleManifest(undefined)).toEqual({});
  });

  test('an empty file name is dropped', () => {
    expect(parseSampleManifest({ engine_low: '   ' })).toEqual({});
  });
});

describe('sampleUrl', () => {
  test('joins the base and the relative file', () => {
    expect(sampleUrl('/audio/', 'engine_low.ogg')).toBe('/audio/engine_low.ogg');
    expect(sampleUrl('/audio/', 'drums/kick.ogg')).toBe('/audio/drums/kick.ogg');
  });

  test('refuses anything that would leave the folder or the origin', () => {
    expect(sampleUrl('/audio/', '../secret.ogg')).toBeNull();
    expect(sampleUrl('/audio/', '/etc/passwd')).toBeNull();
    expect(sampleUrl('/audio/', 'https://example.com/x.ogg')).toBeNull();
    expect(sampleUrl('/audio/', '//example.com/x.ogg')).toBeNull();
    expect(sampleUrl('/audio/', 'a/../../b.ogg')).toBeNull();
  });
});

describe('usableBuffer', () => {
  test('wants at least one frame and one channel', () => {
    const make = (length: number, channels: number): AudioBuffer =>
      ({ length, numberOfChannels: channels, duration: length / 44100 }) as unknown as AudioBuffer;
    expect(usableBuffer(make(1024, 1))).toBe(true);
    expect(usableBuffer(make(0, 1))).toBe(false);
    expect(usableBuffer(make(1024, 0))).toBe(false);
    expect(usableBuffer(null)).toBe(false);
    expect(usableBuffer(undefined)).toBe(false);
  });
});

describe('loadSamples', () => {
  test('loads every name of the manifest', async () => {
    const ctx = new FakeDecodeCtx(() => ({ length: 4096, channels: 1 }));
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: envWith(fullManifest(), okBytes),
    });
    await store.ready;
    expect(store.stats).toEqual({ loaded: 9, missing: 0 });
    expect(store.get('engine_low')).not.toBeNull();
    expect(store.get('drums/cowbell')).not.toBeNull();
  });

  test('a manifest that cannot be read leaves every sample null', async () => {
    const ctx = new FakeDecodeCtx(() => ({ length: 4096, channels: 1 }));
    const messages: string[] = [];
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: {
        fetchJson: () => Promise.reject(new Error('HTTP 404')),
        fetchBytes: okBytes,
        log: (message) => messages.push(message),
      },
    });
    await expect(store.ready).resolves.toBeUndefined();
    for (const name of ALL_NAMES) expect(store.get(name), name).toBeNull();
    expect(store.stats).toEqual({ loaded: 0, missing: 9 });
    expect(messages.join(' ')).toContain('manifest');
  });

  test('a fetch that throws synchronously is still only a missing sample', async () => {
    // È il caso di Node: `fetch('/audio/manifest.json')` su un URL relativo
    // lancia subito, e senza questa protezione la promessa resterebbe
    // rifiutata e non gestita.
    const ctx = new FakeDecodeCtx(() => ({ length: 4096, channels: 1 }));
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: {
        fetchJson: () => {
          throw new TypeError('Failed to parse URL');
        },
        fetchBytes: () => {
          throw new TypeError('Failed to parse URL');
        },
        log: () => {},
      },
    });
    await expect(store.ready).resolves.toBeUndefined();
    expect(store.get('engine_low')).toBeNull();
  });

  test('one broken file does not take the others down', async () => {
    const ctx = new FakeDecodeCtx((bytes) => (bytes.byteLength > 0 ? { length: 4096, channels: 1 } : null));
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: envWith(fullManifest(), (url) =>
        url.includes('engine_high') ? Promise.reject(new Error('HTTP 500')) : okBytes(url),
      ),
    });
    await store.ready;
    expect(store.get('engine_high')).toBeNull();
    expect(store.get('engine_low')).not.toBeNull();
    expect(store.stats).toEqual({ loaded: 8, missing: 1 });
  });

  test('a buffer with no frames counts as missing', async () => {
    const ctx = new FakeDecodeCtx((bytes) =>
      bytes.byteLength > 30 ? { length: 0, channels: 1 } : { length: 4096, channels: 1 },
    );
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: envWith({ engine_low: 'engine_low.ogg', engine_high: 'a-very-long-name-indeed.ogg' }, okBytes),
    });
    await store.ready;
    expect(store.get('engine_high')).toBeNull();
    // `loadSamples` scorre tutti e nove i nomi noti, non solo le voci del
    // manifest: i sette che il manifest non cita sono mancanti anche loro.
    expect(store.stats.loaded).toBe(1);
    expect(store.stats.missing).toBe(ENGINE_SAMPLE_NAMES.length + DRUM_SAMPLE_NAMES.length - 1);
  });

  test('decodeAudioData that rejects counts as missing', async () => {
    const ctx = new FakeDecodeCtx(() => null);
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: envWith({ engine_low: 'engine_low.ogg' }, okBytes),
    });
    await store.ready;
    expect(store.get('engine_low')).toBeNull();
  });

  test('a manifest entry with a hostile path is never fetched', async () => {
    const ctx = new FakeDecodeCtx(() => ({ length: 4096, channels: 1 }));
    const fetchBytes = vi.fn(okBytes);
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: envWith({ engine_low: '../../etc/passwd' }, fetchBytes),
    });
    await store.ready;
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(store.get('engine_low')).toBeNull();
  });

  test('a name missing from the manifest is simply null', async () => {
    const ctx = new FakeDecodeCtx(() => ({ length: 4096, channels: 1 }));
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: envWith({ engine_low: 'engine_low.ogg' }, okBytes),
    });
    await store.ready;
    expect(store.get('engine_low')).not.toBeNull();
    expect(store.get('drums/kick')).toBeNull();
  });

  test('ready resolves once and get works before it too', async () => {
    const ctx = new FakeDecodeCtx(() => ({ length: 4096, channels: 1 }));
    const store = loadSamples(ctx as unknown as BaseAudioContext, {
      env: envWith(fullManifest(), okBytes),
    });
    expect(store.get('engine_low')).toBeNull(); // non ancora decodificato
    await store.ready;
    await store.ready;
    expect(store.get('engine_low')).not.toBeNull();
  });
});

describe('createSampleEnv', () => {
  test('exists and exposes the three members the loader needs', () => {
    const env = createSampleEnv();
    expect(typeof env.fetchJson).toBe('function');
    expect(typeof env.fetchBytes).toBe('function');
    expect(typeof env.log).toBe('function');
  });
});
