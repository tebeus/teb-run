import { describe, expect, test } from 'vitest';
import {
  CROSSFADE_HIGH_FULL,
  CROSSFADE_LOW_FULL,
  crossfadeGains,
  createSampledEngine,
  ENGINE_GEAR_JUMP,
  ENGINE_PITCH_LIFT,
  ENGINE_PITCH_LIFT_SEMITONES,
  ENGINE_RATE_MAX,
  ENGINE_RATE_MIN,
  playbackRateFor,
  SAMPLE_PEAK,
  SAMPLED_ENGINE_MAX_LEVEL,
  SAMPLED_ENGINE_MIN_FRACTION,
  SAMPLED_ENGINE_PEAK_DBFS,
  sampledEngineLevel,
  sampledSaturationCurve,
  SHAPER_PEAK_GAIN,
} from '../../src/audio/engine-sampled';

describe('crossfadeGains', () => {
  test('only the idle loop below the low threshold', () => {
    expect(crossfadeGains(0)).toEqual({ low: 1, high: 0 });
    expect(crossfadeGains(CROSSFADE_LOW_FULL)).toEqual({ low: 1, high: 0 });
    expect(crossfadeGains(0.05)).toEqual({ low: 1, high: 0 });
  });

  test('only the high loop above the high threshold', () => {
    expect(crossfadeGains(CROSSFADE_HIGH_FULL)).toEqual({ low: 0, high: 1 });
    expect(crossfadeGains(0.9)).toEqual({ low: 0, high: 1 });
    expect(crossfadeGains(1)).toEqual({ low: 0, high: 1 });
  });

  test('the two gains always add up to one', () => {
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const g = crossfadeGains(p);
      expect(g.low + g.high).toBeCloseTo(1, 10);
      expect(g.low).toBeGreaterThanOrEqual(0);
      expect(g.high).toBeGreaterThanOrEqual(0);
    }
  });

  test('the high loop rises monotonically across the crossover', () => {
    let last = -1;
    for (let p = CROSSFADE_LOW_FULL; p <= CROSSFADE_HIGH_FULL; p += 0.01) {
      const { high } = crossfadeGains(p);
      expect(high).toBeGreaterThanOrEqual(last);
      last = high;
    }
  });

  test('halfway across the crossover both loops are heard', () => {
    const middle = (CROSSFADE_LOW_FULL + CROSSFADE_HIGH_FULL) / 2;
    const g = crossfadeGains(middle);
    expect(g.low).toBeCloseTo(0.5, 6);
    expect(g.high).toBeCloseTo(0.5, 6);
  });

  test('a speed outside 0..1 or not finite is clamped, never NaN', () => {
    expect(crossfadeGains(-5)).toEqual({ low: 1, high: 0 });
    expect(crossfadeGains(12)).toEqual({ low: 0, high: 1 });
    expect(crossfadeGains(Number.NaN)).toEqual({ low: 1, high: 0 });
    expect(crossfadeGains(Number.POSITIVE_INFINITY)).toEqual({ low: 0, high: 1 });
  });
});

describe('playbackRateFor', () => {
  test('spans exactly the documented range in lo', () => {
    expect(playbackRateFor(0, 'lo')).toBeCloseTo(ENGINE_RATE_MIN, 10);
    expect(playbackRateFor(1, 'lo')).toBeCloseTo(ENGINE_RATE_MAX, 10);
  });

  test('rises monotonically with the speed', () => {
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const rate = playbackRateFor(p, 'lo');
      expect(rate).toBeGreaterThan(last);
      last = rate;
    }
  });

  test('hi drops the pitch by 15%, so shifting up lowers the tone', () => {
    for (const p of [0, 0.3, 0.55, 1]) {
      expect(playbackRateFor(p, 'hi')).toBeCloseTo(playbackRateFor(p, 'lo') * ENGINE_GEAR_JUMP, 10);
      expect(playbackRateFor(p, 'hi')).toBeLessThan(playbackRateFor(p, 'lo'));
    }
  });

  test('the range carries the +7 semitone lift over the recordings', () => {
    // Le registrazioni sono d'epoca, di auto comuni: al tono originale il
    // motore suona come un trattore. Il minimo senza l'innalzamento sarebbe
    // 0,467, che è il numero che questo test protegge.
    expect(ENGINE_PITCH_LIFT).toBeCloseTo(2 ** (ENGINE_PITCH_LIFT_SEMITONES / 12), 10);
    expect(ENGINE_RATE_MIN / ENGINE_PITCH_LIFT).toBeCloseTo(0.4673, 3);
    expect(ENGINE_RATE_MAX / ENGINE_PITCH_LIFT).toBeCloseTo(1.6019, 3);
  });

  test('never returns NaN, whatever comes in', () => {
    for (const p of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3, 9]) {
      expect(Number.isFinite(playbackRateFor(p, 'lo'))).toBe(true);
      expect(Number.isFinite(playbackRateFor(p, 'hi'))).toBe(true);
      expect(playbackRateFor(p, 'lo')).toBeGreaterThan(0);
    }
  });
});

describe('sampledEngineLevel', () => {
  test('is zero with the engine off, whatever the speed', () => {
    for (const p of [0, 0.5, 1, Number.NaN]) {
      expect(sampledEngineLevel(false, p)).toBe(0);
    }
  });

  test('spans from a third of the maximum to the maximum', () => {
    expect(sampledEngineLevel(true, 0)).toBeCloseTo(
      SAMPLED_ENGINE_MAX_LEVEL * SAMPLED_ENGINE_MIN_FRACTION,
      10,
    );
    expect(sampledEngineLevel(true, 1)).toBeCloseTo(SAMPLED_ENGINE_MAX_LEVEL, 10);
  });

  test('rises monotonically and never leaves 0..1', () => {
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const level = sampledEngineLevel(true, p);
      expect(level).toBeGreaterThan(last);
      expect(level).toBeLessThanOrEqual(1);
      last = level;
    }
  });

  test('the maximum lands the peak at the documented -11 dBFS', () => {
    // È il conto che giustifica la costante: picco del campione per il
    // guadagno della saturazione per il volume finale. −11 dBFS dalla
    // correzione I1 della revisione finale (prima era −6, che lasciava il
    // motore 5-6 dB sopra la musica in RMS).
    const peak = SAMPLE_PEAK * SHAPER_PEAK_GAIN * SAMPLED_ENGINE_MAX_LEVEL;
    expect(20 * Math.log10(peak)).toBeCloseTo(SAMPLED_ENGINE_PEAK_DBFS, 6);
    expect(SAMPLED_ENGINE_MAX_LEVEL).toBeCloseTo(0.408, 2);
  });

  test('is louder than the synthetic engine it replaces: that was the point', () => {
    // engineLevel del synth arriva a 0,15. Con SAMPLED_ENGINE_PEAK_DBFS a
    // −11 (I1 della revisione finale) il motore campionato non è più
    // quattro volte il sintetico, ma resta sopra: misurato in browser rms
    // 0,095 a tutto gas contro 0,087-0,096 dei tre brani, alla pari come
    // vuole la spec, non sopra come prima.
    expect(sampledEngineLevel(true, 1)).toBeGreaterThan(0.15 * 2);
  });

  test('survives a speed that is not finite', () => {
    for (const p of [Number.NaN, Number.POSITIVE_INFINITY, -3, 9]) {
      const level = sampledEngineLevel(true, p);
      expect(Number.isFinite(level)).toBe(true);
      expect(level).toBeGreaterThan(0);
    }
  });
});

describe('sampledSaturationCurve', () => {
  test('is odd, passes through zero and stays inside -1..1', () => {
    const curve = sampledSaturationCurve(9);
    expect(curve).toHaveLength(9);
    expect(curve[4]).toBeCloseTo(0, 12);
    expect(curve[0]).toBeCloseTo(-curve[8]!, 12);
    for (const value of curve) expect(Math.abs(value)).toBeLessThanOrEqual(1);
  });

  test('is gentler than the synthetic engine curve', () => {
    // tanh(1.2x) contro tanh(2x): il campione è già saturo di suo, non va
    // schiacciato come le seghe del synth.
    const curve = sampledSaturationCurve(1025);
    const half = curve[Math.floor(1025 * 0.75)]!;
    expect(half).toBeLessThan(Math.tanh(2 * 0.5));
    expect(half).toBeGreaterThan(0.4);
  });
});

// --- La parte con i nodi: contesto finto minimo ---

class P {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    if (!Number.isFinite(v)) throw new TypeError('AudioParam: valore non finito');
    this.value = v;
  }
  cancelScheduledValues(): void {}
}
class N {
  connect(): void {}
  disconnect(): void {}
}
class G extends N {
  gain = new P();
}
class Src extends N {
  buffer: unknown = null;
  loop = false;
  loopEnd = 0;
  playbackRate = new P();
  started = 0;
  stopped = 0;
  start(): void {
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
}
class F extends N {
  type = '';
  frequency = new P();
  Q = new P();
}
class Osc extends N {
  type = '';
  frequency = new P();
  start(): void {}
  stop(): void {}
}
class Shaper extends N {
  curve: Float32Array | null = null;
}

class Ctx {
  currentTime = 0;
  sampleRate = 44100;
  sources: Src[] = [];
  gains: G[] = [];
  census = { source: 0, gain: 0, shaper: 0, filter: 0, osc: 0 };
  createGain(): G {
    this.census.gain += 1;
    const node = new G();
    this.gains.push(node);
    return node;
  }
  createBufferSource(): Src {
    this.census.source += 1;
    const node = new Src();
    this.sources.push(node);
    return node;
  }
  createBiquadFilter(): F {
    this.census.filter += 1;
    return new F();
  }
  createWaveShaper(): Shaper {
    this.census.shaper += 1;
    return new Shaper();
  }
  createOscillator(): Osc {
    this.census.osc += 1;
    return new Osc();
  }
}

const buffer = (): AudioBuffer =>
  ({ length: 44100 * 4, duration: 4, numberOfChannels: 1, sampleRate: 44100 }) as unknown as AudioBuffer;

function rig(): { ctx: Ctx; engine: ReturnType<typeof createSampledEngine> } {
  const ctx = new Ctx();
  const engine = createSampledEngine(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, {
    low: buffer(),
    high: buffer(),
  });
  return { ctx, engine };
}

describe('createSampledEngine', () => {
  test('builds two looping sources, started once, and nothing per frame', () => {
    const { ctx, engine } = rig();
    expect(ctx.sources).toHaveLength(2);
    for (const source of ctx.sources) {
      expect(source.loop).toBe(true);
      expect(source.started).toBe(1);
      expect(source.buffer).not.toBeNull();
    }
    const before = { ...ctx.census };
    for (let i = 0; i < 120; i++) engine.setEngine(i / 120, 'lo', true);
    expect(ctx.census).toEqual(before);
  });

  test('writes the crossfade and the rate on the params', () => {
    const { engine } = rig();
    engine.setEngine(1, 'lo', true);
    expect(engine.gains).toEqual({ low: 0, high: 1 });
    expect(engine.rate).toBeCloseTo(ENGINE_RATE_MAX, 6);
    engine.setEngine(0, 'lo', true);
    expect(engine.gains).toEqual({ low: 1, high: 0 });
    expect(engine.rate).toBeCloseTo(ENGINE_RATE_MIN, 6);
  });

  test('writes the volume on the actual AudioParam, not just the getters', () => {
    // `engine.gains`/`.rate` sono comodità per i test, riletti dallo stato
    // interno: qui si legge invece il nodo `gain` vero che il volume scrive
    // (`ctx.gains[0]`, il primo creato in createSampledEngine è `level`),
    // così un bug che scrivesse il volume sul nodo sbagliato lo direbbe.
    const { ctx, engine } = rig();
    engine.setEngine(1, 'lo', true);
    expect(ctx.gains[0]?.gain.value).toBeCloseTo(SAMPLED_ENGINE_MAX_LEVEL, 6);
    engine.setEngine(0.5, 'lo', false);
    expect(ctx.gains[0]?.gain.value).toBeCloseTo(0, 6);
  });

  test('a speed that is not finite never reaches an AudioParam', () => {
    // setTargetAtTime del finto lancia su un valore non finito, come fa il
    // Web Audio vero: se il clamp non ci fosse, questo test lo direbbe.
    const { engine } = rig();
    expect(() => engine.setEngine(Number.NaN, 'lo', true)).not.toThrow();
    expect(() => engine.setEngine(Number.POSITIVE_INFINITY, 'hi', true)).not.toThrow();
    expect(Number.isFinite(engine.rate)).toBe(true);
  });

  test('stop silences the engine without destroying the nodes', () => {
    const { ctx, engine } = rig();
    engine.setEngine(0.8, 'hi', true);
    engine.stop();
    expect(engine.gains).toEqual({ low: 0, high: 0 });
    for (const source of ctx.sources) expect(source.stopped).toBe(0);
  });

  test('a motore spento the level is zero but the loops keep spinning', () => {
    const { ctx, engine } = rig();
    engine.setEngine(0.5, 'lo', false);
    for (const source of ctx.sources) expect(source.started).toBe(1);
    expect(engine.gains.low + engine.gains.high).toBeCloseTo(1, 6);
    // Il titolo lo dice, ma niente qui sopra lo verifica davvero: `gains` è
    // il mix fra i due loop, non il volume. Il volume vero è sul nodo
    // `level` (ctx.gains[0]).
    expect(ctx.gains[0]?.gain.value).toBeCloseTo(0, 6);
  });
});
