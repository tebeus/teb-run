import { describe, expect, test } from 'vitest';
import { CHANNELS } from '../../src/audio/sequencer';
import { noteToFreq } from '../../src/audio/notes';
import {
  CHANNEL_ENVELOPES,
  CHANNEL_LEVELS,
  CHANNEL_PAN,
  PULSE_DUTIES,
  createSynth,
  envelopePoints,
  noiseVoiceFor,
  pulseHarmonics,
  type Envelope,
} from '../../src/audio/synth';

const PULSE: Envelope = { attack: 0.005, decay: 0.04, sustain: 0.7, release: 0.06 };
const increasing = (points: { time: number }[]): boolean =>
  points.every((point, i) => i === 0 || point.time > points[i - 1].time);

describe('pulseHarmonics', () => {
  test('a 50% duty has only odd sine harmonics', () => {
    const { real, imag } = pulseHarmonics(0.5, 8);
    for (const value of real) expect(Math.abs(value)).toBeLessThan(1e-9);
    expect(Math.abs(imag[2])).toBeLessThan(1e-9);
    expect(Math.abs(imag[4])).toBeLessThan(1e-9);
    expect(imag[1]).toBeGreaterThan(0);
    expect(imag[3]).toBeGreaterThan(0);
  });

  test('the first sine harmonic of a square wave is 4/pi', () => {
    expect(pulseHarmonics(0.5, 4).imag[1]).toBeCloseTo(4 / Math.PI, 10);
  });

  test('a 25% duty has cosine harmonics too', () => {
    const { real, imag } = pulseHarmonics(0.25, 5);
    expect(real[1]).toBeCloseTo(2 / Math.PI, 10);
    expect(imag[1]).toBeCloseTo(2 / Math.PI, 10);
  });

  test('index 0 carries no DC offset', () => {
    for (const duty of PULSE_DUTIES) {
      const { real, imag } = pulseHarmonics(duty, 6);
      expect(real[0]).toBe(0);
      expect(imag[0]).toBe(0);
      expect(real).toHaveLength(6);
      expect(imag).toHaveLength(6);
    }
  });
});

describe('envelopePoints', () => {
  test('starts at zero, peaks at the velocity and ends at zero', () => {
    const points = envelopePoints(PULSE, 1, 0.5, 1);
    expect(points[0]).toEqual({ time: 1, value: 0 });
    expect(points[1]).toEqual({ time: 1.005, value: 1 });
    expect(points[points.length - 1]?.value).toBe(0);
    expect(points[points.length - 1]?.time).toBeCloseTo(1.56, 10);
  });

  test('times are strictly increasing', () => {
    expect(increasing(envelopePoints(PULSE, 1, 0.5, 1))).toBe(true);
    expect(increasing(envelopePoints(PULSE, 0, 0.02, 0.8))).toBe(true);
    expect(increasing(envelopePoints(PULSE, 0, 0.0005, 0.5))).toBe(true);
    expect(increasing(envelopePoints({ attack: 0.05, decay: 0.05, sustain: 0.5, release: 0.05 }, 0, 0.1, 1))).toBe(true);
  });

  test('the sustain level is velocity times sustain', () => {
    const points = envelopePoints(PULSE, 0, 0.5, 0.5);
    expect(points[2]?.value).toBeCloseTo(0.35, 10);
    expect(points[3]?.value).toBeCloseTo(0.35, 10);
  });

  test('compresses attack and decay into a very short note', () => {
    const points = envelopePoints(PULSE, 0, 0.02, 0.8);
    expect(points[1]?.time).toBeLessThan(0.02);
    expect(points[1]?.value).toBeCloseTo(0.8, 10);
    expect(points[points.length - 1]?.time).toBeCloseTo(0.08, 10);
    expect(increasing(points)).toBe(true);
  });

  test('clamps the velocity to 0..1', () => {
    expect(envelopePoints(PULSE, 0, 0.3, 5)[1]?.value).toBe(1);
    expect(envelopePoints(PULSE, 0, 0.3, -2)[1]?.value).toBe(0);
  });

  test('a percussive envelope with zero sustain still ends at zero', () => {
    const points = envelopePoints({ attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 }, 0, 0.1, 0.9);
    expect(points[0]?.value).toBe(0);
    expect(points[1]?.value).toBeCloseTo(0.9, 10);
    expect(points[points.length - 1]?.value).toBe(0);
    expect(increasing(points)).toBe(true);
  });
});

describe('noiseVoiceFor', () => {
  test('a low note is a lowpass kick', () => {
    const voice = noiseVoiceFor(noteToFreq('C2'));
    expect(voice.filterType).toBe('lowpass');
    expect(voice.env.sustain).toBe(0);
  });

  test('a mid note is a bandpass snare', () => {
    const voice = noiseVoiceFor(noteToFreq('D4'));
    expect(voice.filterType).toBe('bandpass');
    expect(voice.filterFreq).toBe(1500);
  });

  test('a high note is a short bandpass hi-hat', () => {
    const voice = noiseVoiceFor(noteToFreq('A6'));
    expect(voice.filterType).toBe('bandpass');
    expect(voice.q).toBe(5);
    expect(voice.env.decay).toBeLessThan(0.05);
  });

  test('the three drum notes give three different voices', () => {
    const voices = ['C2', 'D4', 'A6'].map((note) => JSON.stringify(noiseVoiceFor(noteToFreq(note))));
    expect(new Set(voices).size).toBe(3);
  });

  test('the thresholds are 200 and 1200 Hz', () => {
    expect(noiseVoiceFor(199).filterType).toBe('lowpass');
    expect(noiseVoiceFor(200).filterFreq).toBe(1500);
    expect(noiseVoiceFor(1199).filterFreq).toBe(1500);
    expect(noiseVoiceFor(1200).filterFreq).toBe(9000);
  });
});

describe('channel tables', () => {
  test('every channel has an envelope and a level', () => {
    for (const channel of CHANNELS) {
      expect(CHANNEL_ENVELOPES[channel].attack).toBeGreaterThan(0);
      expect(CHANNEL_LEVELS[channel]).toBeGreaterThan(0);
      expect(CHANNEL_LEVELS[channel]).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(CHANNEL_ENVELOPES).sort()).toEqual([...CHANNELS].sort());
    expect(Object.keys(CHANNEL_LEVELS).sort()).toEqual([...CHANNELS].sort());
  });

  test('the three duties of the spec are available', () => {
    expect([...PULSE_DUTIES]).toEqual([0.125, 0.25, 0.5]);
  });
});

// Contesto finto per createSynth: i nodi registrano le chiamate ricevute
// così i test possono controllare i tempi di start/stop e la sequenza di
// automazione del gain, invece dei soli conteggi di nodi.
class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

interface ParamCall {
  method: string;
  args: number[];
}

/** Param "moderno": ha cancelAndHoldAtTime, come Chrome. */
class ModernParam {
  value = 0;
  calls: ParamCall[] = [];
  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.calls.push({ method: 'setValueAtTime', args: [value, time] });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.calls.push({ method: 'linearRampToValueAtTime', args: [value, time] });
  }
  cancelScheduledValues(time: number): void {
    this.calls.push({ method: 'cancelScheduledValues', args: [time] });
  }
  cancelAndHoldAtTime(time: number): void {
    this.calls.push({ method: 'cancelAndHoldAtTime', args: [time] });
  }
}

/** Param "legacy": niente cancelAndHoldAtTime, come Firefox. */
class LegacyParam {
  value = 0;
  calls: ParamCall[] = [];
  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.calls.push({ method: 'setValueAtTime', args: [value, time] });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.calls.push({ method: 'linearRampToValueAtTime', args: [value, time] });
  }
  cancelScheduledValues(time: number): void {
    this.calls.push({ method: 'cancelScheduledValues', args: [time] });
  }
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  startTime: number | null = null;
  stopTime: number | null = null;
  start(time: number): void {
    this.startTime = time;
  }
  stop(time: number): void {
    this.stopTime = time;
  }
}

class FakeOsc extends FakeSource {
  type = 'square';
  frequency = { value: 0 };
  setPeriodicWave(): void {}
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  loop = false;
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = { value: 0 };
  Q = { value: 0 };
}

function makeFakeCtx(ParamCtor: new () => ModernParam | LegacyParam): {
  ctx: Record<string, unknown>;
  gains: { gain: ModernParam | LegacyParam }[];
  sources: FakeSource[];
  panners: ({ pan: ModernParam | LegacyParam } & FakeNode)[];
} {
  const gains: { gain: ModernParam | LegacyParam }[] = [];
  const sources: FakeSource[] = [];
  const panners: ({ pan: ModernParam | LegacyParam } & FakeNode)[] = [];
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    createGain(): { gain: ModernParam | LegacyParam } & FakeNode {
      const node = Object.assign(new FakeNode(), { gain: new ParamCtor() });
      gains.push(node);
      return node;
    },
    createOscillator(): FakeOsc {
      const osc = new FakeOsc();
      sources.push(osc);
      return osc;
    },
    createBiquadFilter(): FakeFilter {
      return new FakeFilter();
    },
    createBufferSource(): FakeBufferSource {
      const source = new FakeBufferSource();
      sources.push(source);
      return source;
    },
    createPeriodicWave(): object {
      return {};
    },
    createBuffer(
      _channels: number,
      length: number,
      _sampleRate: number,
    ): { getChannelData: () => Float32Array } {
      const data = new Float32Array(Math.max(1, length));
      return { getChannelData: () => data };
    },
    createStereoPanner(): { pan: ModernParam | LegacyParam } & FakeNode {
      const node = Object.assign(new FakeNode(), { pan: new ParamCtor() });
      panners.push(node);
      return node;
    },
  };
  return { ctx, gains, sources, panners };
}

describe('createSynth: allNotesOff silences unstarted notes', () => {
  test('a note scheduled in the future never sounds (cancelAndHoldAtTime branch)', () => {
    const { ctx, gains, sources } = makeFakeCtx(ModernParam);
    const synth = createSynth(ctx as unknown as AudioContext, new FakeNode() as unknown as AudioNode);
    const startTime = 5;
    synth.playNote('pulse1', 440, startTime, 0.2, 0.8);

    const source = sources[sources.length - 1];
    const noteGain = gains[gains.length - 1];
    expect(source).toBeDefined();
    expect(noteGain).toBeDefined();
    expect(source?.startTime).toBe(startTime);

    synth.allNotesOff(0.03);

    // stop() è richiamato con un tempo ben precedente allo start: la nota
    // programmata nel futuro non suonerà mai.
    expect(source?.stopTime).not.toBeNull();
    expect(source?.stopTime as number).toBeLessThan(startTime);
    // il gain è azzerato tramite cancelAndHoldAtTime seguito da una rampa a 0.
    const param = noteGain?.gain as ModernParam;
    expect(param.calls.some((call) => call.method === 'cancelAndHoldAtTime')).toBe(true);
    expect(param.value).toBe(0);
  });

  test('the fallback branch without cancelAndHoldAtTime also silences the note', () => {
    const { ctx, gains, sources } = makeFakeCtx(LegacyParam);
    const synth = createSynth(ctx as unknown as AudioContext, new FakeNode() as unknown as AudioNode);
    const startTime = 5;
    synth.playNote('tri', 220, startTime, 0.2, 0.8);

    const source = sources[sources.length - 1];
    const noteGain = gains[gains.length - 1];

    synth.allNotesOff(0.03);

    expect(source?.stopTime).not.toBeNull();
    expect(source?.stopTime as number).toBeLessThan(startTime);
    const param = noteGain?.gain as LegacyParam;
    expect('cancelAndHoldAtTime' in param).toBe(false);
    expect(param.calls.some((call) => call.method === 'cancelScheduledValues')).toBe(true);
    expect(param.calls.some((call) => call.method === 'setValueAtTime')).toBe(true);
    expect(param.value).toBe(0);
  });
});

describe('CHANNEL_PAN', () => {
  test('covers every channel and stays inside -1..1', () => {
    for (const channel of CHANNELS) {
      expect(CHANNEL_PAN[channel], channel).toBeGreaterThanOrEqual(-1);
      expect(CHANNEL_PAN[channel], channel).toBeLessThanOrEqual(1);
    }
  });

  test('bass and drums stay centred, the melodic voices spread out', () => {
    expect(CHANNEL_PAN.tri).toBe(0);
    expect(CHANNEL_PAN.drums).toBe(0);
    expect(CHANNEL_PAN.pad).toBeLessThan(0);
    expect(CHANNEL_PAN.lead2).toBeGreaterThan(0);
  });

  test('a context without createStereoPanner still plays, mono', () => {
    // Il contesto finto di questo file è `makeFakeCtx(ParamCtor)`, non una
    // classe: si costruisce così e gli si toglie il metodo.
    const { ctx } = makeFakeCtx(ModernParam);
    delete (ctx as unknown as Record<string, unknown>).createStereoPanner;
    expect(() => {
      const synth = createSynth(ctx as unknown as AudioContext, new FakeNode() as unknown as AudioNode);
      synth.playNote('pad', 220, 0, 0.2, 0.5);
    }).not.toThrow();
  });
});
