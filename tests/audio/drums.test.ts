import { describe, expect, test } from 'vitest';
import {
  createDrumKit,
  DRUM_BY_LETTER,
  DRUM_LEVELS,
  DRUM_OCTAVE,
  DRUM_VOICE_NAMES,
  drumSampleName,
  drumVoiceFor,
  SYNTH_DRUM_VOICES,
} from '../../src/audio/drums';
import { DRUM_SAMPLE_NAMES } from '../../src/audio/samples';
import { isNoteName } from '../../src/audio/notes';

describe('drumVoiceFor', () => {
  test('maps the seven letters of the spec', () => {
    expect(drumVoiceFor('C2')).toBe('kick');
    expect(drumVoiceFor('D2')).toBe('snare');
    expect(drumVoiceFor('E2')).toBe('clap');
    expect(drumVoiceFor('F2')).toBe('hat_closed');
    expect(drumVoiceFor('G2')).toBe('hat_open');
    expect(drumVoiceFor('A2')).toBe('tom');
    expect(drumVoiceFor('B2')).toBe('cowbell');
  });

  test('ignores the octave: the drum is in the letter', () => {
    expect(drumVoiceFor('C2')).toBe(drumVoiceFor('C6'));
    expect(drumVoiceFor('D-1')).toBe('snare');
  });

  test('ignores an accidental instead of refusing the note', () => {
    // Nessun pattern di batteria scrive un diesis, ma se succede il colpo
    // deve suonare, non sparire in silenzio.
    expect(drumVoiceFor('F#2')).toBe('hat_closed');
    expect(drumVoiceFor('Bb2')).toBe('cowbell');
  });

  test('null for anything that is not a note', () => {
    expect(drumVoiceFor(undefined)).toBeNull();
    expect(drumVoiceFor('')).toBeNull();
    expect(drumVoiceFor('H2')).toBeNull();
    expect(drumVoiceFor('kick')).toBeNull();
  });
});

describe('the drum tables', () => {
  test('there are seven voices and each has a sample, a level and a synth voice', () => {
    expect(DRUM_VOICE_NAMES).toHaveLength(7);
    for (const voice of DRUM_VOICE_NAMES) {
      expect(DRUM_SAMPLE_NAMES).toContain(drumSampleName(voice));
      expect(DRUM_LEVELS[voice]).toBeGreaterThan(0);
      expect(DRUM_LEVELS[voice]).toBeLessThanOrEqual(1);
      expect(SYNTH_DRUM_VOICES[voice].filterFreq).toBeGreaterThan(0);
      expect(SYNTH_DRUM_VOICES[voice].env.decay).toBeGreaterThan(0);
    }
  });

  test('every letter of the table is a valid note name at the drum octave', () => {
    for (const letter of Object.keys(DRUM_BY_LETTER)) {
      expect(isNoteName(`${letter}${DRUM_OCTAVE}`), letter).toBe(true);
    }
  });

  test('the synth fallback keeps the kick low and the hats high', () => {
    expect(SYNTH_DRUM_VOICES.kick.filterType).toBe('lowpass');
    expect(SYNTH_DRUM_VOICES.kick.filterFreq).toBeLessThan(300);
    expect(SYNTH_DRUM_VOICES.hat_closed.filterFreq).toBeGreaterThan(5000);
    expect(SYNTH_DRUM_VOICES.hat_open.env.decay).toBeGreaterThan(
      SYNTH_DRUM_VOICES.hat_closed.env.decay,
    );
    expect(SYNTH_DRUM_VOICES.tom.filterType).toBe('lowpass');
  });

  test('every synth drum voice dies out: no sustain on a drum', () => {
    for (const voice of DRUM_VOICE_NAMES) {
      expect(SYNTH_DRUM_VOICES[voice].env.sustain).toBe(0);
    }
  });
});

class P {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(): void {}
}
class N {
  connected = 0;
  disconnected = 0;
  connect(): void {
    this.connected += 1;
  }
  disconnect(): void {
    this.disconnected += 1;
  }
}
class G extends N {
  gain = new P();
}
class Src extends N {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  startedAt = -1;
  stoppedAt = -1;
  start(when: number): void {
    this.startedAt = when;
  }
  stop(when: number): void {
    this.stoppedAt = when;
  }
}

class Ctx {
  currentTime = 10;
  sampleRate = 44100;
  sources: Src[] = [];
  gains: G[] = [];
  createGain(): G {
    const node = new G();
    this.gains.push(node);
    return node;
  }
  createBufferSource(): Src {
    const node = new Src();
    this.sources.push(node);
    return node;
  }
}

const buf = (seconds = 0.2): AudioBuffer =>
  ({ length: Math.round(44100 * seconds), duration: seconds, numberOfChannels: 1, sampleRate: 44100 }) as unknown as AudioBuffer;

describe('createDrumKit', () => {
  test('one node per hit, and none at construction time', () => {
    const ctx = new Ctx();
    const kit = createDrumKit(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, () => buf());
    // Solo il guadagno di uscita del kit: nessuna sorgente finché non si
    // suona. Nessun nodo per frame: i nodi nascono per colpo.
    expect(ctx.sources).toHaveLength(0);
    expect(kit.available).toBe(true);
    kit.hit('kick', 11, 0.8);
    kit.hit('snare', 11.25, 0.5);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]?.startedAt).toBe(11);
    expect(ctx.sources[1]?.startedAt).toBe(11.25);
  });

  test('the per-hit gain is the velocity times the drum level', () => {
    const ctx = new Ctx();
    const kit = createDrumKit(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, () => buf());
    kit.hit('kick', 11, 0.5);
    const gain = ctx.gains[ctx.gains.length - 1];
    expect(gain?.gain.value).toBeCloseTo(0.5 * DRUM_LEVELS.kick, 6);
    kit.hit('hat_closed', 11, 1);
    expect(ctx.gains[ctx.gains.length - 1]?.gain.value).toBeCloseTo(DRUM_LEVELS.hat_closed, 6);
  });

  test('a hit in the past is moved to now, never scheduled backwards', () => {
    const ctx = new Ctx();
    ctx.currentTime = 20;
    const kit = createDrumKit(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, () => buf());
    kit.hit('kick', 5, 0.8);
    expect(ctx.sources[0]?.startedAt).toBe(20);
  });

  test('a velocity of zero or less plays nothing', () => {
    const ctx = new Ctx();
    const kit = createDrumKit(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, () => buf());
    expect(kit.hit('kick', 11, 0)).toBe(false);
    expect(kit.hit('kick', 11, -1)).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });

  test('a missing sample returns false so the synth can take the hit', () => {
    const ctx = new Ctx();
    const kit = createDrumKit(
      ctx as unknown as BaseAudioContext,
      new N() as unknown as AudioNode,
      (name) => (name === 'drums/kick' ? buf() : null),
    );
    expect(kit.hit('kick', 11, 0.8)).toBe(true);
    expect(kit.hit('cowbell', 11, 0.8)).toBe(false);
    expect(ctx.sources).toHaveLength(1);
  });

  test('a kit with no samples at all reports itself unavailable', () => {
    const ctx = new Ctx();
    const kit = createDrumKit(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, () => null);
    expect(kit.available).toBe(false);
    expect(kit.hit('snare', 11, 0.8)).toBe(false);
  });

  test('an unusable buffer counts as missing', () => {
    const ctx = new Ctx();
    const empty = { length: 0, duration: 0, numberOfChannels: 1, sampleRate: 44100 } as unknown as AudioBuffer;
    const kit = createDrumKit(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, () => empty);
    expect(kit.available).toBe(false);
    expect(kit.hit('kick', 11, 0.8)).toBe(false);
  });

  test('each hit disconnects itself when it ends: no node leak over a whole song', () => {
    const ctx = new Ctx();
    const kit = createDrumKit(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, () => buf());
    for (let i = 0; i < 64; i++) kit.hit('hat_closed', 11 + i * 0.1, 0.4);
    expect(ctx.sources).toHaveLength(64);
    for (const source of ctx.sources) {
      expect(source.onended).not.toBeNull();
      source.onended?.();
    }
    for (const gain of ctx.gains.slice(1)) expect(gain.disconnected).toBe(1);
  });

  test('the samples are read once, at construction, not at every hit', () => {
    let reads = 0;
    const ctx = new Ctx();
    const kit = createDrumKit(ctx as unknown as BaseAudioContext, new N() as unknown as AudioNode, () => {
      reads += 1;
      return buf();
    });
    const after = reads;
    kit.hit('kick', 11, 0.8);
    kit.hit('kick', 11.5, 0.8);
    expect(reads).toBe(after);
    expect(after).toBe(7); // uno per strumento
  });
});
