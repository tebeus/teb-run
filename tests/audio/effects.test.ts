import { describe, expect, test } from 'vitest';
import {
  BYPASS_CUTOFF,
  DELAY_FEEDBACK,
  DELAY_WET,
  MAX_DELAY_TIME,
  MIN_DELAY_TIME,
  RAMP_TIME_CONSTANT,
  createMusicFx,
  delayTime,
  sweepCentre,
  sweepDepth,
  sweepRateHz,
  type FilterSweep,
  CHORUS_DELAYS,
  CHORUS_DEPTH,
  CHORUS_RATES,
  CHORUS_WET,
  fillImpulseResponse,
  impulseSample,
  limiterCurve,
  MUSIC_TRIM,
  MUSIC_TRIM_DB,
  REVERB_DECAY,
  REVERB_SECONDS,
  REVERB_WET,
} from '../../src/audio/effects';
import { stepDuration } from '../../src/audio/sequencer';

describe('delayTime', () => {
  test('three sixteenths at the given tempo', () => {
    expect(delayTime(120)).toBeCloseTo(3 * stepDuration(120), 12);
    expect(delayTime(120)).toBeCloseTo(0.375, 12);
    expect(delayTime(138)).toBeCloseTo(45 / 138, 12);
  });

  test('a faster tempo gives a shorter delay', () => {
    expect(delayTime(138)).toBeLessThan(delayTime(92));
  });

  test('the result always fits the DelayNode built with MAX_DELAY_TIME', () => {
    for (const bpm of [60, 92, 122, 138, 200]) {
      expect(delayTime(bpm)).toBeGreaterThanOrEqual(MIN_DELAY_TIME);
      expect(delayTime(bpm)).toBeLessThanOrEqual(MAX_DELAY_TIME);
    }
  });

  test('a broken tempo gives the minimum instead of NaN', () => {
    expect(delayTime(Number.NaN)).toBe(MIN_DELAY_TIME);
    expect(delayTime(0)).toBe(MIN_DELAY_TIME);
    expect(delayTime(-120)).toBe(MIN_DELAY_TIME);
  });

  test('a very slow tempo is clamped to MAX_DELAY_TIME, not left over the node size', () => {
    expect(delayTime(1)).toBe(MAX_DELAY_TIME);
  });
});

describe('sweep maths', () => {
  const sweep: FilterSweep = { base: 900, peak: 7000, bars: 8 };

  test('centre and depth split the range in two', () => {
    expect(sweepCentre(sweep)).toBe(3950);
    expect(sweepDepth(sweep)).toBe(3050);
    expect(sweepCentre(sweep) - sweepDepth(sweep)).toBe(sweep.base);
    expect(sweepCentre(sweep) + sweepDepth(sweep)).toBe(sweep.peak);
  });

  test('depth is never negative, even with peak below base', () => {
    expect(sweepDepth({ base: 7000, peak: 900, bars: 8 })).toBe(3050);
  });

  test('one full cycle every sweep.bars bars', () => {
    // A 120 bpm una battuta dura 2 s, quindi 8 battute sono 16 s.
    expect(sweepRateHz({ base: 1, peak: 2, bars: 8 }, 120)).toBeCloseTo(1 / 16, 12);
    expect(sweepRateHz({ base: 1, peak: 2, bars: 4 }, 120)).toBeCloseTo(1 / 8, 12);
  });

  test('a broken bar count gives a still LFO instead of NaN', () => {
    expect(sweepRateHz({ base: 1, peak: 2, bars: 0 }, 120)).toBe(0);
    expect(sweepRateHz({ base: 1, peak: 2, bars: Number.NaN }, 120)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Contesto finto per createMusicFx: ogni nodo registra a chi è collegato, così
// il test può controllare la forma del grafo e non solo il numero di nodi.
// ---------------------------------------------------------------------------

class FakeParam {
  value = 0;
  inputs = 0;
  targetCalls: { target: number; timeConstant: number }[] = [];
  // Il finto applica subito il valore di destinazione: qui interessa che
  // apply() usi una rampa (e con quale costante di tempo), non l'evoluzione
  // nel tempo, che il mock non simula.
  setTargetAtTime(target: number, _startTime: number, timeConstant: number): void {
    this.value = target;
    this.targetCalls.push({ target, timeConstant });
  }
}

class FakeNode {
  outputs: unknown[] = [];
  connect(target: unknown): void {
    this.outputs.push(target);
    if (target instanceof FakeParam) target.inputs += 1;
  }
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeDelay extends FakeNode {
  delayTime = new FakeParam();
  constructor(readonly maxDelayTime: number) {
    super();
  }
}

class FakeFilter extends FakeNode {
  type = '';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeOsc extends FakeNode {
  type = '';
  frequency = new FakeParam();
  started = false;
  start(): void {
    this.started = true;
  }
}

function makeCtx(): {
  ctx: AudioContext;
  gains: FakeGain[];
  delays: FakeDelay[];
  filters: FakeFilter[];
  oscs: FakeOsc[];
  convolvers: ({ buffer: unknown; normalize: boolean } & FakeNode)[];
  shapers: ({ curve: Float32Array | null } & FakeNode)[];
} {
  const gains: FakeGain[] = [];
  const delays: FakeDelay[] = [];
  const filters: FakeFilter[] = [];
  const oscs: FakeOsc[] = [];
  const convolvers: ({ buffer: unknown; normalize: boolean } & FakeNode)[] = [];
  const shapers: ({ curve: Float32Array | null } & FakeNode)[] = [];
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    createGain(): FakeGain {
      const node = new FakeGain();
      gains.push(node);
      return node;
    },
    createDelay(max: number): FakeDelay {
      const node = new FakeDelay(max);
      delays.push(node);
      return node;
    },
    createBiquadFilter(): FakeFilter {
      const node = new FakeFilter();
      filters.push(node);
      return node;
    },
    createOscillator(): FakeOsc {
      const node = new FakeOsc();
      oscs.push(node);
      return node;
    },
    createConvolver(): { buffer: unknown; normalize: boolean } & FakeNode {
      const node = Object.assign(new FakeNode(), { buffer: null as unknown, normalize: true });
      convolvers.push(node);
      return node;
    },
    createWaveShaper(): { curve: Float32Array | null } & FakeNode {
      const node = Object.assign(new FakeNode(), { curve: null as Float32Array | null });
      shapers.push(node);
      return node;
    },
    createBuffer(channels: number, length: number, rate: number): AudioBuffer {
      const data = new Float32Array(length);
      return {
        length,
        duration: length / rate,
        numberOfChannels: channels,
        sampleRate: rate,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
    },
  };
  return { ctx: ctx as unknown as AudioContext, gains, delays, filters, oscs, convolvers, shapers };
}

describe('createMusicFx', () => {
  test('builds a lowpass into the destination plus a feedback delay at the spec levels', () => {
    const { ctx, gains, delays, filters, oscs } = makeCtx();
    const out = new FakeNode();
    const fx = createMusicFx(ctx, out as unknown as AudioNode);

    expect(filters).toHaveLength(1);
    expect(filters[0]?.type).toBe('lowpass');
    expect(delays).toHaveLength(3);
    expect(delays[0]?.maxDelayTime).toBe(MAX_DELAY_TIME);
    // input, feedback, wet, chorusWet, reverbWet, trim: il guadagno dell'LFO
    // nasce solo con start()
    expect(gains).toHaveLength(6);
    const feedback = gains[2];
    const wet = gains[3];
    const trim = gains.find((gain) => gain.gain.value === MUSIC_TRIM);
    expect(feedback?.gain.value).toBe(DELAY_FEEDBACK);
    expect(wet?.gain.value).toBe(DELAY_WET);
    // il rientro chiude l'anello sul delay, ed è quello che fa le ripetizioni
    expect(feedback?.outputs).toContain(delays[0]);
    expect(wet?.outputs).toContain(trim);
    expect(fx.input.gain.value).toBe(1);
    // nessun oscillatore prima che un brano chieda lo sweep: il bus costruisce
    // gli effetti già dentro unlock(), quando il contesto può essere sospeso
    expect(oscs).toHaveLength(0);
  });

  test('setBpm writes the delay time of that tempo', () => {
    const { ctx, delays } = makeCtx();
    const fx = createMusicFx(ctx, new FakeNode() as unknown as AudioNode);
    fx.setBpm(138);
    expect(delays[0]?.delayTime.value).toBeCloseTo(delayTime(138), 12);
  });

  test('a sweep centres the cutoff and drives the LFO, and null opens the filter', () => {
    const { ctx, filters, gains, oscs } = makeCtx();
    const fx = createMusicFx(ctx, new FakeNode() as unknown as AudioNode);
    const sweep: FilterSweep = { base: 900, peak: 7000, bars: 8 };

    fx.setBpm(122);
    fx.setSweep(sweep);
    fx.start();
    // Tre LFO: uno dello sweep (i gain statici sono 6: input, trim, feedback,
    // wet, chorusWet, reverbWet), poi i due del chorus. Il guadagno dello
    // sweep è quindi il primo creato in ensureOscillators, gains[6].
    const depth = gains[6];
    expect(oscs).toHaveLength(3);
    expect(oscs[0]?.started).toBe(true);
    expect(filters[0]?.frequency.value).toBe(sweepCentre(sweep));
    expect(depth?.gain.value).toBe(sweepDepth(sweep));
    expect(oscs[0]?.frequency.value).toBeCloseTo(sweepRateHz(sweep, 122), 12);
    // l'LFO somma sul parametro del filtro, non sull'audio
    expect(depth?.outputs).toContain(filters[0]?.frequency);
    expect(filters[0]?.frequency.inputs).toBe(1);

    fx.setSweep(null);
    expect(filters[0]?.frequency.value).toBe(BYPASS_CUTOFF);
    expect(depth?.gain.value).toBe(0);
    expect(oscs[0]?.frequency.value).toBe(0);

    // un secondo sweep riusa lo stesso LFO, non ne costruisce un altro
    fx.setSweep(sweep);
    expect(oscs).toHaveLength(3);
  });

  test('a broken bpm falls back to a usable delay time instead of NaN', () => {
    const { ctx, delays } = makeCtx();
    const fx = createMusicFx(ctx, new FakeNode() as unknown as AudioNode);
    fx.setBpm(Number.NaN);
    expect(Number.isFinite(delays[0]?.delayTime.value ?? Number.NaN)).toBe(true);
    expect(delays[0]?.delayTime.value).toBeCloseTo(delayTime(120), 12);
  });

  test('changes ramp with setTargetAtTime instead of jumping the raw value, to avoid clicks', () => {
    const { ctx, delays, filters, gains } = makeCtx();
    const fx = createMusicFx(ctx, new FakeNode() as unknown as AudioNode);
    const sweep: FilterSweep = { base: 900, peak: 7000, bars: 8 };

    fx.setBpm(138);
    fx.setSweep(sweep);
    fx.start();
    const depth = gains[6];

    expect(delays[0]?.delayTime.targetCalls.at(-1)?.timeConstant).toBe(RAMP_TIME_CONSTANT);
    expect(filters[0]?.frequency.targetCalls.at(-1)?.timeConstant).toBe(RAMP_TIME_CONSTANT);
    expect(depth?.gain.targetCalls.at(-1)?.timeConstant).toBe(RAMP_TIME_CONSTANT);
  });
});

describe('the chorus constants', () => {
  test('two delays in the 12..20 ms window the spec asks for', () => {
    expect(CHORUS_DELAYS).toHaveLength(2);
    for (const delay of CHORUS_DELAYS) {
      expect(delay).toBeGreaterThanOrEqual(0.012);
      expect(delay).toBeLessThanOrEqual(0.02);
    }
    expect(CHORUS_DELAYS[0]).not.toBe(CHORUS_DELAYS[1]);
  });

  test('two slow, mutually prime-ish rates, so the two voices never lock', () => {
    expect(CHORUS_RATES).toHaveLength(2);
    for (const rate of CHORUS_RATES) {
      expect(rate).toBeGreaterThan(0.1);
      expect(rate).toBeLessThan(1);
    }
    expect(CHORUS_RATES[0]).not.toBe(CHORUS_RATES[1]);
  });

  test('the modulation never asks a delay node for a negative time', () => {
    for (const delay of CHORUS_DELAYS) expect(delay - CHORUS_DEPTH).toBeGreaterThan(0);
  });

  test('the sends stay well below unity: these are effects, not the signal', () => {
    expect(CHORUS_WET).toBeLessThan(0.5);
    expect(REVERB_WET).toBeLessThan(0.3);
  });
});

describe('the music bus trim and limiter', () => {
  test('the trim is exactly -3 dB', () => {
    expect(MUSIC_TRIM_DB).toBe(-3);
    expect(MUSIC_TRIM).toBeCloseTo(0.70794578, 6);
  });

  test('the limiter curve is odd, unity slope at the origin, bounded', () => {
    const curve = limiterCurve(1025);
    expect(curve).toHaveLength(1025);
    expect(curve[512]).toBeCloseTo(0, 12);
    expect(curve[0]).toBeCloseTo(-curve[1024]!, 12);
    for (const value of curve) expect(Math.abs(value)).toBeLessThanOrEqual(1);
    // Pendenza 1 nell'origine: ai livelli normali non fa niente di udibile.
    const step = 2 / 1024;
    expect((curve[513]! - curve[512]!) / step).toBeCloseTo(1, 2);
  });

  test('the limiter only bites near full scale', () => {
    const curve = limiterCurve(1025);
    const at = (x: number): number => curve[Math.round(((x + 1) / 2) * 1024)]!;
    // A un quarto di scala l'errore di tanh(0.25) è circa il 2%: trasparente.
    // (0,00508 di distanza assoluta: `toBeCloseTo(0.25, 2)` chiede una soglia
    // di 0,005 e la mancherebbe per un pelo, quindi il confronto è esplicito.)
    expect(Math.abs(at(0.25) - 0.25)).toBeLessThan(0.006);
    // A fondo scala comprime, e non arriva mai a 1.
    expect(at(1)).toBeLessThan(0.77);
    expect(at(1)).toBeGreaterThan(0.7);
  });

  test('the trim alone already clears the measured peak of the disco song', () => {
    // Misurato in revisione: 1,0076 di picco senza attenuazione.
    expect(1.0076 * MUSIC_TRIM).toBeLessThan(0.9);
  });
});

describe('impulseSample', () => {
  test('decays from the start to (almost) nothing at the end', () => {
    const first = Math.abs(impulseSample(0, 1000, REVERB_DECAY, 1));
    const last = Math.abs(impulseSample(999, 1000, REVERB_DECAY, 1));
    expect(first).toBeCloseTo(1, 6);
    expect(last).toBeLessThan(0.05);
  });

  test('is monotonically quieter for a constant noise input', () => {
    let last = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 1000; i += 10) {
      const value = Math.abs(impulseSample(i, 1000, REVERB_DECAY, 1));
      expect(value).toBeLessThanOrEqual(last);
      last = value;
    }
  });

  test('stays inside -1..1 for noise inside -1..1', () => {
    for (const noise of [-1, -0.5, 0, 0.5, 1]) {
      for (const i of [0, 1, 500, 999]) {
        expect(Math.abs(impulseSample(i, 1000, REVERB_DECAY, noise))).toBeLessThanOrEqual(1);
      }
    }
  });

  test('a length of one does not divide by zero', () => {
    expect(Number.isFinite(impulseSample(0, 1, REVERB_DECAY, 1))).toBe(true);
  });
});

describe('fillImpulseResponse', () => {
  test('fills the whole array and leaves it loud at the head, quiet at the tail', () => {
    const data = new Float32Array(2000);
    let seed = 1;
    fillImpulseResponse(data, REVERB_DECAY, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    });
    const energy = (from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += data[i]! * data[i]!;
      return sum / (to - from);
    };
    expect(energy(0, 200)).toBeGreaterThan(energy(1800, 2000) * 10);
    expect(data.some((value) => value !== 0)).toBe(true);
  });

  test('is deterministic given the same generator', () => {
    const make = (): Float32Array => {
      const data = new Float32Array(64);
      let seed = 7;
      fillImpulseResponse(data, REVERB_DECAY, () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      });
      return data;
    };
    expect(Array.from(make())).toEqual(Array.from(make()));
  });
});

describe('createMusicFx: the reverb impulse is deterministic', () => {
  test('two independent graphs get bit-for-bit identical convolver buffers', () => {
    // Prima della correzione, createMusicFx passava Math.random a
    // fillImpulseResponse: due chiamate davano code di riverbero diverse, e
    // il render offline (binario J, task 10) non era deterministico.
    const a = makeCtx();
    createMusicFx(a.ctx, new FakeNode() as unknown as AudioNode);
    const bufferA = a.convolvers[0]?.buffer as AudioBuffer | null;
    if (bufferA === null) throw new Error('no convolver buffer built');

    const b = makeCtx();
    createMusicFx(b.ctx, new FakeNode() as unknown as AudioNode);
    const bufferB = b.convolvers[0]?.buffer as AudioBuffer | null;
    if (bufferB === null) throw new Error('no convolver buffer built');

    const dataA = Array.from(bufferA.getChannelData(0));
    const dataB = Array.from(bufferB.getChannelData(0));
    expect(dataA).toEqual(dataB);
    // E non è un array di soli zero per costruzione del finto: il rumore c'è
    // davvero, solo che non cambia da una chiamata all'altra.
    expect(dataA.some((value) => value !== 0)).toBe(true);
  });
});

describe('createMusicFx: chorus and reverb', () => {
  test('no oscillator exists until start(), and start() is idempotent', () => {
    const { ctx, oscs } = makeCtx();
    const fx = createMusicFx(ctx, new FakeNode() as unknown as AudioNode);
    expect(oscs).toHaveLength(0);
    fx.start();
    // Tre LFO: due del chorus, uno dello sweep del passa-basso.
    expect(oscs).toHaveLength(3);
    fx.start();
    fx.start();
    expect(oscs).toHaveLength(3);
  });

  test('the convolver gets an impulse response as long as the spec says', () => {
    const { ctx, convolvers } = makeCtx();
    createMusicFx(ctx, new FakeNode() as unknown as AudioNode);
    expect(convolvers).toHaveLength(1);
    const buffer = convolvers[0]?.buffer as { length: number } | null;
    // Il finto gira a 48 kHz (`sampleRate` di makeCtx).
    expect(buffer?.length).toBe(Math.round(REVERB_SECONDS * 48000));
  });

  test('setSweep still works without start(), and does not build the LFO by itself', () => {
    const { ctx, oscs } = makeCtx();
    const fx = createMusicFx(ctx, new FakeNode() as unknown as AudioNode);
    fx.setSweep({ base: 500, peak: 5000, bars: 4 });
    fx.setSweep(null);
    expect(oscs).toHaveLength(0);
  });

  test('everything reaches the destination through the trim and the limiter', () => {
    const { ctx, gains, shapers } = makeCtx();
    const out = new FakeNode();
    createMusicFx(ctx, out as unknown as AudioNode);
    // input, feedback, wet, chorusWet, reverbWet, trim
    expect(gains).toHaveLength(6);
    expect(shapers).toHaveLength(1);
    expect(shapers[0]?.curve).not.toBeNull();
    // Nessun guadagno tocca la destinazione: ci arriva solo il limitatore,
    // che è quindi il punto in cui la somma del bus è contenuta.
    expect(gains.filter((gain) => gain.outputs.includes(out))).toHaveLength(0);
    expect(shapers[0]?.outputs).toContain(out);
    const trim = gains.find((gain) => gain.gain.value === MUSIC_TRIM);
    expect(trim).toBeDefined();
    expect(trim?.outputs).toContain(shapers[0]);
  });
});
