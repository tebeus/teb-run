// AudioContext creato in modo pigro al primo gesto utente, master gain e mute.
// Se il browser non offre AudioContext, o la costruzione lancia, l'host diventa
// non disponibile: ogni metodo è un no-op e `muted` risponde true (spec §15).

export type AudioContextCtor = new () => AudioContext;

export type OfflineAudioContextCtor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

export interface AudioScope {
  AudioContext?: AudioContextCtor;
  webkitAudioContext?: AudioContextCtor;
  /** Solo per la verifica d'ascolto del gancio #debug (spec §16). */
  OfflineAudioContext?: OfflineAudioContextCtor;
  webkitOfflineAudioContext?: OfflineAudioContextCtor;
}

/** Volume generale quando non si è muti. */
export const MASTER_LEVEL = 0.6;
/** Durata della dissolvenza del mute, per non fare clic. */
export const MUTE_FADE = 0.02;

export function pickAudioContextCtor(scope: AudioScope): AudioContextCtor | null {
  if (typeof scope.AudioContext === 'function') return scope.AudioContext;
  if (typeof scope.webkitAudioContext === 'function') return scope.webkitAudioContext;
  return null;
}

export function masterGainValue(muted: boolean, level: number = MASTER_LEVEL): number {
  return muted ? 0 : level;
}

export interface AudioHost {
  /** null finché unlock() non riesce, o per sempre se l'audio non è disponibile. */
  readonly ctx: AudioContext | null;
  /** Nodo a cui collegare musica ed effetti. */
  readonly master: GainNode | null;
  /** false se l'audio è impossibile: nessun costruttore, costruzione fallita, resume rifiutato. */
  readonly available: boolean;
  /** true anche quando l'audio non è disponibile. */
  readonly muted: boolean;
  /** true solo se il contesto esiste e sta girando. */
  readonly running: boolean;
  /** Da chiamare dentro un gesto utente: crea il contesto e lo riprende. */
  unlock(): void;
  /** Ritorna true se ora è muto. */
  toggleMute(): boolean;
  /** Chiama `callback` una volta sola, appena il contesto gira (subito se già gira). */
  whenRunning(callback: () => void): void;
}

export function createAudioHost(
  scope: AudioScope = globalThis as AudioScope,
  level: number = MASTER_LEVEL,
): AudioHost {
  let ctor = pickAudioContextCtor(scope);
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  // resume() rifiutato: audio non disponibile finché non arriva un altro gesto.
  let resumeDenied = false;
  const waiting: (() => void)[] = [];

  function notify(): void {
    if (ctx === null || ctx.state !== 'running') return;
    const callbacks = [...waiting];
    waiting.length = 0;
    for (const callback of callbacks) {
      try {
        callback();
      } catch {
        // un callback rotto non deve far credere che l'audio sia negato,
        // né deve impedire agli altri callback in coda di girare.
      }
    }
  }

  function applyGain(): void {
    if (ctx === null || master === null) return;
    const now = ctx.currentTime;
    const param = master.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(masterGainValue(muted, level), now + MUTE_FADE);
  }

  /** Da chiamare dentro il gestore di un gesto utente. Idempotente. */
  function unlock(): void {
    if (ctor === null) return;
    // nuovo gesto: ha senso riprovare dopo un resume rifiutato
    resumeDenied = false;
    if (ctx === null) {
      try {
        ctx = new ctor();
        master = ctx.createGain();
        master.gain.value = masterGainValue(muted, level);
        master.connect(ctx.destination);
        ctx.onstatechange = (): void => notify();
      } catch {
        ctx = null;
        master = null;
        ctor = null;
        return;
      }
    }
    if (ctx.state !== 'running') {
      // Il secondo argomento di `then` scatta solo per un vero rifiuto di
      // resume(): così un'eccezione dentro `notify()` (cioè dentro un
      // callback whenRunning) non viene confusa con un resume negato.
      void Promise.resolve(ctx.resume()).then(notify, () => {
        resumeDenied = true;
      });
    }
    notify();
  }

  return {
    get ctx(): AudioContext | null {
      return ctx;
    },
    get master(): GainNode | null {
      return master;
    },
    get available(): boolean {
      return ctor !== null && !resumeDenied;
    },
    get muted(): boolean {
      return ctor === null || resumeDenied ? true : muted;
    },
    get running(): boolean {
      return ctx !== null && ctx.state === 'running';
    },
    unlock,
    toggleMute(): boolean {
      if (ctor === null || resumeDenied) return true;
      muted = !muted;
      applyGain();
      return muted;
    },
    whenRunning(callback: () => void): void {
      if (ctor === null) return;
      if (ctx !== null && ctx.state === 'running') {
        callback();
        return;
      }
      waiting.push(callback);
    },
  };
}
