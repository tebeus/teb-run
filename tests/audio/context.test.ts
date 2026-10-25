import { describe, expect, test } from 'vitest';
import {
  MASTER_LEVEL,
  createAudioHost,
  masterGainValue,
  pickAudioContextCtor,
  type AudioContextCtor,
} from '../../src/audio/context';

class FakeParam {
  value = 1;
  ramps: { value: number; time: number }[] = [];
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.ramps.push({ value, time });
    this.value = value;
  }
}

class FakeGain {
  gain = new FakeParam();
  connections = 0;
  connect(): void {
    this.connections += 1;
  }
}

class FakeAudioContext {
  static built = 0;
  state = 'suspended';
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  gains: FakeGain[] = [];
  resumed = 0;
  constructor() {
    FakeAudioContext.built += 1;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  resume(): Promise<void> {
    this.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

/** Come il precedente, ma resume() rifiuta finché `allow` resta falso. */
class DenyingAudioContext extends FakeAudioContext {
  allow = false;
  override resume(): Promise<void> {
    this.resumed += 1;
    if (!this.allow) return Promise.reject(new Error('gesture required'));
    this.state = 'running';
    return Promise.resolve();
  }
}

const fakeCtor = (): AudioContextCtor => FakeAudioContext as unknown as AudioContextCtor;
const throwingCtor = (): AudioContextCtor =>
  class {
    constructor() {
      throw new Error('denied');
    }
  } as unknown as AudioContextCtor;

describe('pickAudioContextCtor', () => {
  test('prefers the standard constructor', () => {
    const standard = fakeCtor();
    const webkit = throwingCtor();
    expect(pickAudioContextCtor({ AudioContext: standard, webkitAudioContext: webkit })).toBe(standard);
  });

  test('falls back to the webkit constructor', () => {
    const webkit = fakeCtor();
    expect(pickAudioContextCtor({ webkitAudioContext: webkit })).toBe(webkit);
  });

  test('returns null when neither exists', () => {
    expect(pickAudioContextCtor({})).toBeNull();
  });
});

describe('masterGainValue', () => {
  test('is zero when muted and the level otherwise', () => {
    expect(masterGainValue(true)).toBe(0);
    expect(masterGainValue(false)).toBe(MASTER_LEVEL);
    expect(masterGainValue(false, 0.25)).toBe(0.25);
  });
});

describe('createAudioHost without AudioContext', () => {
  test('the host is unavailable and reports muted', () => {
    const host = createAudioHost({});
    expect(host.available).toBe(false);
    expect(host.muted).toBe(true);
    expect(host.running).toBe(false);
    expect(host.ctx).toBeNull();
    expect(host.master).toBeNull();
  });

  test('every method is a no-op', () => {
    const host = createAudioHost({});
    expect(() => {
      host.unlock();
      host.unlock();
      host.whenRunning(() => {
        throw new Error('must not run');
      });
    }).not.toThrow();
    expect(host.toggleMute()).toBe(true);
    expect(host.toggleMute()).toBe(true);
    expect(host.muted).toBe(true);
  });

  test('a constructor that throws leaves the host unavailable', () => {
    const host = createAudioHost({ AudioContext: throwingCtor() });
    expect(host.available).toBe(true);
    host.unlock();
    expect(host.available).toBe(false);
    expect(host.muted).toBe(true);
    expect(host.ctx).toBeNull();
    expect(() => host.unlock()).not.toThrow();
  });
});

describe('createAudioHost with a denied resume', () => {
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  function denyingHost(): { host: ReturnType<typeof createAudioHost>; made: DenyingAudioContext[] } {
    const made: DenyingAudioContext[] = [];
    class Tracked extends DenyingAudioContext {
      constructor() {
        super();
        made.push(this);
      }
    }
    return { host: createAudioHost({ AudioContext: Tracked as unknown as AudioContextCtor }), made };
  }

  test('a denied resume leaves the host unavailable and muted', async () => {
    const { host } = denyingHost();
    host.unlock();
    await tick();
    expect(host.available).toBe(false);
    expect(host.muted).toBe(true);
    expect(host.running).toBe(false);
    expect(host.toggleMute()).toBe(true);
    expect(host.muted).toBe(true);
  });

  test('a later gesture retries after a denied resume', async () => {
    const { host, made } = denyingHost();
    host.unlock();
    await tick();
    expect(host.available).toBe(false);
    const ctx = made[0];
    if (ctx !== undefined) ctx.allow = true;
    host.unlock();
    expect(host.available).toBe(true);
    expect(host.running).toBe(true);
    expect(host.muted).toBe(false);
    expect(made).toHaveLength(1);
  });
});

describe('createAudioHost with a context', () => {
  test('unlock creates the context, the master gain and connects it', () => {
    FakeAudioContext.built = 0;
    const host = createAudioHost({ AudioContext: fakeCtor() });
    expect(host.ctx).toBeNull();
    host.unlock();
    const ctx = host.ctx as unknown as FakeAudioContext;
    expect(FakeAudioContext.built).toBe(1);
    expect(ctx.resumed).toBe(1);
    expect(host.running).toBe(true);
    const master = host.master as unknown as FakeGain;
    expect(master.gain.value).toBe(MASTER_LEVEL);
    expect(master.connections).toBe(1);
  });

  test('unlock twice keeps the same context', () => {
    FakeAudioContext.built = 0;
    const host = createAudioHost({ AudioContext: fakeCtor() });
    host.unlock();
    const first = host.ctx;
    host.unlock();
    expect(FakeAudioContext.built).toBe(1);
    expect(host.ctx).toBe(first);
  });

  test('iOS: after an interruption (call, background) the next gesture resumes the context', async () => {
    const host = createAudioHost({ AudioContext: fakeCtor() });
    host.unlock();
    await Promise.resolve();
    const ctx = host.ctx as unknown as FakeAudioContext;
    expect(host.running).toBe(true);
    expect(ctx.resumed).toBe(1);
    // Un gesto con il contesto che gira non lo tocca.
    host.unlock();
    expect(ctx.resumed).toBe(1);
    for (const state of ['interrupted', 'suspended']) {
      ctx.state = state;
      expect(host.running).toBe(false);
      host.unlock();
      await Promise.resolve();
      expect(host.running, state).toBe(true);
    }
    expect(ctx.resumed).toBe(3);
  });

  test('toggleMute twice returns to audible and ramps the master gain', () => {
    const host = createAudioHost({ AudioContext: fakeCtor() });
    host.unlock();
    const master = host.master as unknown as FakeGain;
    expect(host.toggleMute()).toBe(true);
    expect(host.muted).toBe(true);
    expect(master.gain.ramps[0]?.value).toBe(0);
    expect(host.toggleMute()).toBe(false);
    expect(host.muted).toBe(false);
    expect(master.gain.ramps[1]?.value).toBe(MASTER_LEVEL);
  });

  test('host mute (an ad, the portal muteAudio) and M: muted if any of the three says so; M is kept as it was', () => {
    const host = createAudioHost({ AudioContext: fakeCtor() });
    host.unlock();
    const master = host.master as unknown as FakeGain;
    const last = (): number | undefined => master.gain.ramps[master.gain.ramps.length - 1]?.value;
    host.setHostMute('ad', true);
    expect(last()).toBe(0);
    expect(host.muted).toBe(false); // l'icona di M non cambia
    host.setHostMute('ad', false);
    expect(last()).toBe(MASTER_LEVEL);
    // M acceso prima della pubblicità: alla fine resta muto.
    host.toggleMute();
    host.setHostMute('ad', true);
    host.setHostMute('ad', false);
    expect(last()).toBe(0);
    expect(host.muted).toBe(true);
    host.toggleMute();
    expect(last()).toBe(MASTER_LEVEL);
    // muteAudio del portale vince su M: premere M non ridà il suono.
    host.setHostMute('portal', true);
    host.toggleMute();
    host.toggleMute();
    expect(last()).toBe(0);
    // Pubblicità durante muteAudio: alla fine resta muto finché lo chiede il portale.
    host.setHostMute('ad', true);
    host.setHostMute('ad', false);
    expect(last()).toBe(0);
    host.setHostMute('portal', false);
    expect(last()).toBe(MASTER_LEVEL);
  });

  test('host mute before the first gesture: the context is born silent', () => {
    const host = createAudioHost({ AudioContext: fakeCtor() });
    host.setHostMute('portal', true);
    host.unlock();
    expect((host.master as unknown as FakeGain).gain.value).toBe(0);
  });

  test('whenRunning fires once the context is running', () => {
    const host = createAudioHost({ AudioContext: fakeCtor() });
    let calls = 0;
    host.whenRunning(() => {
      calls += 1;
    });
    expect(calls).toBe(0);
    host.unlock();
    expect(calls).toBe(1);
    host.unlock();
    expect(calls).toBe(1);
  });

  test('whenRunning fires immediately when the context already runs', () => {
    const host = createAudioHost({ AudioContext: fakeCtor() });
    host.unlock();
    let calls = 0;
    host.whenRunning(() => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });

  test('a whenRunning callback that throws does not deny audio, and the next callback still runs', () => {
    const host = createAudioHost({ AudioContext: fakeCtor() });
    let secondRan = false;
    host.whenRunning(() => {
      throw new Error('boom');
    });
    host.whenRunning(() => {
      secondRan = true;
    });
    expect(() => host.unlock()).not.toThrow();
    expect(secondRan).toBe(true);
    expect(host.available).toBe(true);
    expect(host.muted).toBe(false);
    expect(host.running).toBe(true);
  });
});

describe('iPhone silent switch: navigator.audioSession (iOS 17+)', () => {
  function fakeCtor(log: string[]) {
    return class {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      onstatechange: (() => void) | null = null;
      createGain() {
        return { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
      }
      resume() {
        log.push('resume');
        this.state = 'running';
        return Promise.resolve();
      }
    } as unknown as AudioContextCtor;
  }

  test('set to playback inside the first gesture, before the context resumes', () => {
    const log: string[] = [];
    const session = {
      _t: 'ambient',
      get type() {
        return this._t;
      },
      set type(v: string) {
        log.push(`session:${v}`);
        this._t = v;
      },
    };
    const host = createAudioHost({ AudioContext: fakeCtor(log), navigator: { audioSession: session } });
    host.unlock();
    expect(log).toEqual(['session:playback', 'resume']);
    host.unlock();
    // Già `playback`: non si riscrive.
    expect(log.filter((l) => l.startsWith('session'))).toHaveLength(1);
  });

  test('absent: no error, audio as before', () => {
    const log: string[] = [];
    const host = createAudioHost({ AudioContext: fakeCtor(log), navigator: {} });
    expect(() => host.unlock()).not.toThrow();
    expect(log).toEqual(['resume']);
    expect(host.available).toBe(true);
  });

  test('a setter that throws: no error, the audio still starts', () => {
    const log: string[] = [];
    const session = {
      get type() {
        return 'ambient';
      },
      set type(_v: string) {
        throw new Error('NotAllowedError');
      },
    };
    const host = createAudioHost({ AudioContext: fakeCtor(log), navigator: { audioSession: session } });
    expect(() => host.unlock()).not.toThrow();
    expect(log).toEqual(['resume']);
  });

  test('M and the host mutes still win: the session only lets iOS play', () => {
    const ramps: number[] = [];
    const Ctor = class {
      state = 'running';
      currentTime = 0;
      destination = {};
      onstatechange: (() => void) | null = null;
      createGain() {
        return { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime: (v: number) => void ramps.push(v) }, connect() {} };
      }
      resume() {
        return Promise.resolve();
      }
    } as unknown as AudioContextCtor;
    const session = { type: 'ambient' };
    const host = createAudioHost({ AudioContext: Ctor, navigator: { audioSession: session } });
    host.unlock();
    expect(session.type).toBe('playback');
    host.setHostMute('ad', true);
    host.setHostMute('ad', false);
    host.toggleMute();
    expect(host.muted).toBe(true);
    expect(ramps).toEqual([0, MASTER_LEVEL, 0]);
  });
});
