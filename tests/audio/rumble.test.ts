import { describe, expect, test } from 'vitest';
import {
  BROWN_GAIN,
  DETUNE_RATIO,
  RUMBLE_CUTOFF,
  RUMBLE_LEVEL,
  SHAPER_SAMPLES,
  brownStep,
  createSfx,
  engineFilterFreq,
  engineFreq,
  fillBrownNoise,
  tremoloFreq,
} from '../../src/audio/sfx';

// Contesto finto minimo, deliberatamente locale: `tests/audio/bus.test.ts` ha
// il suo e il binario G lo sta modificando in parallelo, quindi qui non si
// estrae nessun helper condiviso.
class Param {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  setTargetAtTime(): void {}
  cancelScheduledValues(): void {}
}
class Node {
  connect(): void {}
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
  onended: (() => void) | null = null;
  buffer: unknown = null;
  loop = false;
  start(): void {}
  stop(): void {}
}
class Osc extends Source {
  type = 'square';
  frequency = new Param();
  setPeriodicWave(): void {}
}
class Shaper extends Node {
  curve: Float32Array | null = null;
  oversample = 'none';
}

function fakeCtx(): {
  ctx: AudioContext;
  dest: AudioNode;
  filters: Filter[];
  gains: Gain[];
  oscs: Osc[];
  shapers: Shaper[];
} {
  const filters: Filter[] = [];
  const gains: Gain[] = [];
  const shapers: Shaper[] = [];
  const oscs: Osc[] = [];
  const dest = new Node();
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    destination: dest,
    createGain: () => {
      const g = new Gain();
      gains.push(g);
      return g;
    },
    createOscillator: () => {
      const o = new Osc();
      oscs.push(o);
      return o;
    },
    createBiquadFilter: () => {
      const f = new Filter();
      filters.push(f);
      return f;
    },
    createWaveShaper: () => {
      const sh = new Shaper();
      shapers.push(sh);
      return sh;
    },
    createBufferSource: () => new Source(),
    createPeriodicWave: () => ({}),
    createBuffer: (_ch: number, len: number) => {
      const data = new Float32Array(len);
      return { getChannelData: () => data, length: len };
    },
  };
  return {
    ctx: ctx as unknown as AudioContext,
    dest: dest as unknown as AudioNode,
    filters,
    gains,
    oscs,
    shapers,
  };
}

/** Il passa-basso dello sterrato: 300 Hz e Q 0,7. Il motore usa lo stesso
 *  taglio a velocità zero ma Q 1, quindi il Q è ciò che li distingue. */
const rumbleFilters = (filters: Filter[]): Filter[] =>
  filters.filter((f) => f.type === 'lowpass' && f.frequency.value === RUMBLE_CUTOFF && f.Q.value === 0.7);

describe('brownStep (spec §10: rumore marrone)', () => {
  test('it stays bounded even with a constant input', () => {
    let last = 0;
    for (let i = 0; i < 100000; i++) last = brownStep(last, 1);
    expect(Math.abs(last)).toBeLessThanOrEqual(1);
  });

  test('it is a low pass: one sample moves it only a little', () => {
    expect(Math.abs(brownStep(0, 1))).toBeLessThan(0.05);
    expect(brownStep(0, 0)).toBe(0);
  });

  test('it follows the sign of the input', () => {
    expect(brownStep(0, 1)).toBeGreaterThan(0);
    expect(brownStep(0, -1)).toBeLessThan(0);
  });
});

describe('fillBrownNoise', () => {
  test('it fills the buffer and stays in range', () => {
    const data = new Float32Array(4096);
    fillBrownNoise(data, () => 0.75);
    expect(data.some((v) => v !== 0)).toBe(true);
    for (const v of data) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  test('it is deterministic with a deterministic generator', () => {
    const a = new Float32Array(64);
    const b = new Float32Array(64);
    let i = 0;
    let j = 0;
    fillBrownNoise(a, () => ((i = (i + 7) % 13), i / 13));
    fillBrownNoise(b, () => ((j = (j + 7) % 13), j / 13));
    expect([...b]).toEqual([...a]);
  });

  test('it has more low frequency energy than white noise', () => {
    // Somma dei salti fra campioni: il marrone cambia molto più lentamente.
    const brown = new Float32Array(8192);
    let seed = 1;
    const rng = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    fillBrownNoise(brown, rng);
    let brownJumps = 0;
    let whiteJumps = 0;
    let prevWhite = 0;
    for (let i = 1; i < brown.length; i++) {
      brownJumps += Math.abs(brown[i] - brown[i - 1]);
      const white = rng() * 2 - 1;
      whiteJumps += Math.abs(white - prevWhite);
      prevWhite = white;
    }
    expect(brownJumps).toBeLessThan(whiteJumps / 4);
  });
});

describe('createSfx().setRumble (spec §10)', () => {
  test('nothing is built before the first call', () => {
    const { ctx, dest, filters } = fakeCtx();
    const player = createSfx(ctx, dest);
    const before = filters.length;
    player.setRumble(false);
    expect(filters.length).toBe(before);
  });

  test('turning it on builds a low pass at 300 Hz', () => {
    const { ctx, dest, filters } = fakeCtx();
    const player = createSfx(ctx, dest);
    player.setRumble(true);
    expect(rumbleFilters(filters)).toHaveLength(1);
    expect(RUMBLE_CUTOFF).toBe(300);
    expect(RUMBLE_LEVEL).toBeGreaterThan(0);
    expect(BROWN_GAIN).toBeGreaterThan(1);
  });

  test('turning it on and off again is idempotent and never throws', () => {
    const { ctx, dest, filters } = fakeCtx();
    const player = createSfx(ctx, dest);
    expect(() => {
      player.setRumble(true);
      player.setRumble(true);
      player.setRumble(false);
      player.setRumble(false);
      player.stopAll();
    }).not.toThrow();
    // Un solo nodo per tutta la partita: niente perdite a 60 chiamate al secondo.
    expect(rumbleFilters(filters)).toHaveLength(1);
  });

  test('stopAll silences the rumble even if it was never started', () => {
    const { ctx, dest } = fakeCtx();
    const player = createSfx(ctx, dest);
    expect(() => player.stopAll()).not.toThrow();
  });
});

describe('createSfx().setEngine: motore a otto cilindri (spec §10)', () => {
  test('the first call builds the whole chain and nothing more', () => {
    const { ctx, dest, filters, gains, oscs, shapers } = fakeCtx();
    const player = createSfx(ctx, dest);
    const before = { filters: filters.length, gains: gains.length, oscs: oscs.length };
    player.setEngine(0, 'lo', true);
    // Due seghe, una quadra e l'LFO del tremolo.
    expect(oscs.length - before.oscs).toBe(4);
    // Volume, tremolo, guadagno della quadra, profondità del tremolo.
    expect(gains.length - before.gains).toBe(4);
    expect(filters.length - before.filters).toBe(1);
    expect(shapers).toHaveLength(1);
    expect(shapers[0].curve).not.toBeNull();
    expect(shapers[0].curve?.length).toBe(SHAPER_SAMPLES);
  });

  test('a hundred more calls create nothing', () => {
    const { ctx, dest, filters, gains, oscs, shapers } = fakeCtx();
    const player = createSfx(ctx, dest);
    player.setEngine(0.5, 'hi', true);
    const after = { filters: filters.length, gains: gains.length, oscs: oscs.length, shapers: shapers.length };
    for (let i = 0; i < 100; i++) player.setEngine(0.5 + i * 1e-6, 'hi', true);
    expect({ filters: filters.length, gains: gains.length, oscs: oscs.length, shapers: shapers.length }).toEqual(after);
  });

  test('the two saws sit seven cents apart around the fundamental', () => {
    const { ctx, dest, oscs } = fakeCtx();
    const player = createSfx(ctx, dest);
    player.setEngine(0, 'lo', true);
    const saws = oscs.filter((o) => o.type === 'sawtooth');
    expect(saws).toHaveLength(2);
    const base = engineFreq(0, 'lo');
    expect(saws[0].frequency.value).toBeCloseTo(base * DETUNE_RATIO, 6);
    expect(saws[1].frequency.value).toBeCloseTo(base / DETUNE_RATIO, 6);
  });

  test('the square runs an octave below, and the tremolo starts slow and deep', () => {
    const { ctx, dest, oscs } = fakeCtx();
    const player = createSfx(ctx, dest);
    player.setEngine(0, 'lo', true);
    const square = oscs.find((o) => o.type === 'square');
    const lfo = oscs.find((o) => o.type === 'sine');
    expect(square?.frequency.value).toBeCloseTo(engineFreq(0, 'lo') / 2, 6);
    expect(lfo?.frequency.value).toBeCloseTo(tremoloFreq(0), 6);
  });

  test('the low pass opens with the speed, from 400 Hz to 3000', () => {
    const { ctx, dest, filters } = fakeCtx();
    const player = createSfx(ctx, dest);
    player.setEngine(0, 'lo', true);
    const engineFilter = filters.filter((f) => f.type === 'lowpass' && f.Q.value === 1);
    expect(engineFilter).toHaveLength(1);
    expect(engineFilter[0].frequency.value).toBe(engineFilterFreq(0));
    expect(engineFilterFreq(0)).toBe(400);
    expect(engineFilterFreq(1)).toBe(3000);
  });

  test('the whole chain is safe with a gear change and at a standstill', () => {
    const { ctx, dest } = fakeCtx();
    const player = createSfx(ctx, dest);
    expect(() => {
      player.setEngine(0, 'lo', false);
      player.setEngine(0.5, 'lo', true);
      player.setEngine(0.5, 'hi', true);
      player.setEngine(1, 'hi', true);
      player.stopAll();
    }).not.toThrow();
  });
});

describe('createSfx().useSampledEngine', () => {
  test('switching to null stops the previous sampled engine instead of leaving it running', () => {
    const { ctx, dest } = fakeCtx();
    const player = createSfx(ctx, dest);
    let stops = 0;
    const sampled = {
      setEngine(): void {},
      stop(): void {
        stops += 1;
      },
      rate: 1,
      gains: { low: 1, high: 0 },
    };
    player.useSampledEngine(sampled);
    expect(stops).toBe(0);
    player.useSampledEngine(null);
    expect(stops).toBe(1);
  });

  test('switching to null when no sampled engine was ever set does not throw', () => {
    const { ctx, dest } = fakeCtx();
    const player = createSfx(ctx, dest);
    expect(() => player.useSampledEngine(null)).not.toThrow();
  });

  test('switching from one sampled engine straight to another does not stop the new one', () => {
    const { ctx, dest } = fakeCtx();
    const player = createSfx(ctx, dest);
    let stopsA = 0;
    let stopsB = 0;
    player.useSampledEngine({ setEngine(): void {}, stop: () => (stopsA += 1), rate: 1, gains: { low: 1, high: 0 } });
    player.useSampledEngine({ setEngine(): void {}, stop: () => (stopsB += 1), rate: 1, gains: { low: 1, high: 0 } });
    expect(stopsA).toBe(0);
    expect(stopsB).toBe(0);
  });
});
