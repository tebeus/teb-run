import { describe, expect, test } from 'vitest';
import {
  createSfx,
  RAIN_CUTOFF,
  RAIN_GUST_DEPTH,
  RAIN_GUST_HZ,
  RAIN_LEVEL_MAX,
  RUMBLE_CUTOFF,
  RUMBLE_LEVEL,
  RUMBLE_SWEEP,
  rumbleFilterFreq,
} from '../../src/audio/sfx';

// Contesto finto locale, sullo stesso modello di `tests/audio/rumble.test.ts`:
// registra i nodi creati e le scritture sui parametri, e non suona niente.
class Param {
  value = 0;
  ramps: { to: number; at: number }[] = [];
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(to: number, at: number): void {
    this.ramps.push({ to, at });
    this.value = to;
  }
  exponentialRampToValueAtTime(): void {}
  setTargetAtTime(): void {}
  cancelScheduledValues(): void {}
}
class Node {
  connected: unknown[] = [];
  connect(to: unknown): void {
    this.connected.push(to);
  }
  disconnect(): void {}
}
class Gain extends Node {
  gain = new Param();
}
class Filter extends Node {
  type = 'lowpass';
  frequency = new Param();
  Q = new Param();
}
class Source extends Node {
  buffer: unknown = null;
  loop = false;
  started = 0;
  stopped = 0;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
}
class Osc extends Node {
  type = 'sine';
  frequency = new Param();
  detune = new Param();
  started = 0;
  start(): void {
    this.started++;
  }
  stop(): void {}
}

class Ctx {
  currentTime = 0;
  sampleRate = 44100;
  gains: Gain[] = [];
  filters: Filter[] = [];
  sources: Source[] = [];
  oscs: Osc[] = [];
  createGain(): Gain {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): Filter {
    const f = new Filter();
    this.filters.push(f);
    return f;
  }
  createBufferSource(): Source {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  createOscillator(): Osc {
    const o = new Osc();
    this.oscs.push(o);
    return o;
  }
  createWaveShaper(): Node {
    return new Node();
  }
  createBuffer(_ch: number, length: number): { getChannelData: () => Float32Array; length: number } {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length };
  }
  createPeriodicWave(): Node {
    return new Node();
  }
}

const player = () => {
  const ctx = new Ctx();
  const out = new Node();
  const sfx = createSfx(ctx as unknown as AudioContext, out as unknown as AudioNode);
  return { ctx, sfx };
};

describe('le costanti della pioggia e del fruscio (spec §10)', () => {
  test('the rain is brighter than the rumble, and quiet', () => {
    expect(RAIN_CUTOFF).toBe(1400);
    expect(RAIN_CUTOFF).toBeGreaterThan(RUMBLE_CUTOFF);
    expect(RAIN_LEVEL_MAX).toBe(0.16);
    expect(RAIN_LEVEL_MAX).toBeLessThan(0.3);
    expect(RAIN_GUST_HZ).toBeLessThan(1);
    expect(RAIN_GUST_DEPTH).toBeGreaterThan(0);
    expect(RAIN_GUST_DEPTH).toBeLessThan(1);
  });

  test('the dirt rumble opens up with the speed, and never below its floor', () => {
    expect(rumbleFilterFreq(0)).toBe(RUMBLE_CUTOFF);
    expect(rumbleFilterFreq(1)).toBe(RUMBLE_CUTOFF + RUMBLE_SWEEP);
    expect(rumbleFilterFreq(0.5)).toBeCloseTo(RUMBLE_CUTOFF + RUMBLE_SWEEP / 2, 6);
    // Ingressi ostili: la frequenza resta dentro l'intervallo.
    for (const p of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const f = rumbleFilterFreq(p);
      expect(f, String(p)).toBeGreaterThanOrEqual(RUMBLE_CUTOFF);
      expect(f, String(p)).toBeLessThanOrEqual(RUMBLE_CUTOFF + RUMBLE_SWEEP);
    }
  });
});

describe('setRain (Review Focus 5)', () => {
  test('setRain before any rain allocates nothing and never throws', () => {
    const { ctx, sfx } = player();
    const before = ctx.gains.length;
    expect(() => sfx.setRain(0)).not.toThrow();
    expect(ctx.gains).toHaveLength(before);
  });

  test('the first call above zero builds the chain: source, lowpass, gain and the gust LFO', () => {
    const { ctx, sfx } = player();
    const sources = ctx.sources.length;
    const oscs = ctx.oscs.length;
    sfx.setRain(1);
    expect(ctx.sources.length).toBe(sources + 1);
    expect(ctx.oscs.length).toBe(oscs + 1);
    const source = ctx.sources[ctx.sources.length - 1];
    expect(source.loop).toBe(true);
    expect(source.started).toBe(1);
    const lowpass = ctx.filters.filter((f) => f.frequency.value === RAIN_CUTOFF);
    expect(lowpass).toHaveLength(1);
    expect(lowpass[0].type).toBe('lowpass');
    const lfo = ctx.oscs[ctx.oscs.length - 1];
    expect(lfo.frequency.value).toBeCloseTo(RAIN_GUST_HZ, 6);
    expect(lfo.started).toBe(1);
  });

  test('sixty calls allocate one node (Review Focus 5)', () => {
    const { ctx, sfx } = player();
    sfx.setRain(1);
    const after = { gains: ctx.gains.length, sources: ctx.sources.length, oscs: ctx.oscs.length };
    for (let i = 0; i < 60; i++) sfx.setRain(i % 2 === 0 ? 1 : 0.5);
    expect(ctx.gains).toHaveLength(after.gains);
    expect(ctx.sources).toHaveLength(after.sources);
    expect(ctx.oscs).toHaveLength(after.oscs);
  });

  test('the level follows the argument, up to the ceiling, and zero is silence', () => {
    const { ctx, sfx } = player();
    sfx.setRain(1);
    // `ensureRain` costruisce, in ordine: filtro, guadagno del **livello**,
    // sorgente, LFO, guadagno di **profondità** delle raffiche. Quindi
    // l'ultimo guadagno è quello delle raffiche, che vale
    // `RAIN_LEVEL_MAX * RAIN_GUST_DEPTH` e non si scrive mai più: il
    // livello sta al penultimo. Non «correggere» in `- 1`.
    const gain = ctx.gains[ctx.gains.length - 2];
    expect(gain.gain.value).toBeCloseTo(RAIN_LEVEL_MAX, 6);
    sfx.setRain(0.5);
    expect(gain.gain.value).toBeCloseTo(RAIN_LEVEL_MAX * 0.5, 6);
    sfx.setRain(0);
    expect(gain.gain.value).toBe(0);
  });

  test('a level outside [0, 1] or not a number is brought inside', () => {
    const { ctx, sfx } = player();
    sfx.setRain(9);
    // Penultimo: vedi il commento del test qui sopra.
    const gain = ctx.gains[ctx.gains.length - 2];
    expect(gain.gain.value).toBeCloseTo(RAIN_LEVEL_MAX, 6);
    sfx.setRain(Number.NaN);
    expect(gain.gain.value).toBe(0);
    sfx.setRain(-2);
    expect(gain.gain.value).toBe(0);
  });

  test('a null rain buffer falls back to filtered noise (Review Focus 5)', () => {
    const { ctx, sfx } = player();
    expect(() => sfx.useRainSample(null)).not.toThrow();
    sfx.setRain(1);
    const source = ctx.sources[ctx.sources.length - 1];
    // Il ripiego suona il buffer di rumore da un secondo che `createSfx`
    // costruisce comunque, e il passa-basso resta al taglio della pioggia.
    expect(source.buffer).not.toBeNull();
    expect(ctx.filters.some((f) => f.frequency.value === RAIN_CUTOFF)).toBe(true);
  });

  test('a real sample replaces the noise, and the lowpass opens right up', () => {
    const { ctx, sfx } = player();
    const buffer = { length: 441000, duration: 10, sampleRate: 44100, numberOfChannels: 2 } as AudioBuffer;
    sfx.useRainSample(buffer);
    sfx.setRain(1);
    const source = ctx.sources[ctx.sources.length - 1];
    expect(source.buffer).toBe(buffer);
    // Con un campione vero il filtro non deve colorare niente.
    const lowpass = ctx.filters[ctx.filters.length - 1];
    expect(lowpass.frequency.value).toBeGreaterThan(RAIN_CUTOFF * 5);
  });

  test('a sample that arrives after the rain has started swaps the source once', () => {
    const { ctx, sfx } = player();
    sfx.setRain(1);
    const first = ctx.sources[ctx.sources.length - 1];
    const buffer = { length: 441000, duration: 10, sampleRate: 44100, numberOfChannels: 2 } as AudioBuffer;
    sfx.useRainSample(buffer);
    expect(first.stopped).toBe(1);
    const second = ctx.sources[ctx.sources.length - 1];
    expect(second).not.toBe(first);
    expect(second.buffer).toBe(buffer);
    expect(second.started).toBe(1);
  });

  test('stopAll silences the rain too', () => {
    const { ctx, sfx } = player();
    sfx.setRain(1);
    // Penultimo: vedi il commento due test sopra.
    const gain = ctx.gains[ctx.gains.length - 2];
    sfx.stopAll();
    expect(gain.gain.value).toBe(0);
  });
});

describe('setRumble con la velocità (spec §10)', () => {
  test('the level is the one of the H track, and one argument still works', () => {
    const { ctx, sfx } = player();
    sfx.setRumble(true);
    const gain = ctx.gains[ctx.gains.length - 1];
    expect(gain.gain.value).toBeCloseTo(RUMBLE_LEVEL, 6);
  });

  test('the cutoff rises with the speed, without a new node', () => {
    const { ctx, sfx } = player();
    sfx.setRumble(true, 0);
    const nodes = { filters: ctx.filters.length, sources: ctx.sources.length };
    const filter = ctx.filters[ctx.filters.length - 1];
    expect(filter.frequency.value).toBeCloseTo(rumbleFilterFreq(0), 6);
    sfx.setRumble(true, 1);
    expect(filter.frequency.value).toBeCloseTo(rumbleFilterFreq(1), 6);
    expect(ctx.filters).toHaveLength(nodes.filters);
    expect(ctx.sources).toHaveLength(nodes.sources);
  });

  test('switching the rumble off leaves the cutoff alone: nothing is audible anyway', () => {
    const { ctx, sfx } = player();
    sfx.setRumble(true, 1);
    const filter = ctx.filters[ctx.filters.length - 1];
    const high = filter.frequency.value;
    sfx.setRumble(false, 0);
    expect(filter.frequency.value).toBe(high);
    const gain = ctx.gains[ctx.gains.length - 1];
    expect(gain.gain.value).toBe(0);
  });
});
