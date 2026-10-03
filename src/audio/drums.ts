// Batteria del sequencer: la lettera della nota scegle lo strumento, non la
// frequenza. Questa prima metà è pura e testata in Node; createDrumKit, che
// arriva col task 6, è il collegamento al Web Audio.
//
// Perché la lettera e non la frequenza: con i campioni il timbro non ha più
// niente a che vedere con l'altezza, e scrivere `C2 . F2 . D2` in un pattern
// è leggibile (cassa, charleston, rullante) mentre `C2 . A6 . D4` era un
// codice da ricordare a memoria.

import { usableBuffer, type DrumSampleName } from './samples';
import { parseNote } from './notes';
import type { NoiseVoice } from './synth';

export const DRUM_VOICE_NAMES = [
  'kick',
  'snare',
  'clap',
  'hat_closed',
  'hat_open',
  'tom',
  'cowbell',
] as const;
export type DrumVoiceName = (typeof DRUM_VOICE_NAMES)[number];

/** Ottava in cui i pattern scrivono la batteria: ignorata, serve solo a `parsePattern`. */
export const DRUM_OCTAVE = 2;

/** Spec §10: C cassa, D rullante, E clap, F charleston chiuso, G aperto, A tom, B cowbell. */
export const DRUM_BY_LETTER: Readonly<Record<string, DrumVoiceName>> = {
  C: 'kick',
  D: 'snare',
  E: 'clap',
  F: 'hat_closed',
  G: 'hat_open',
  A: 'tom',
  B: 'cowbell',
};

/**
 * Strumento di un nome di nota, o null se il nome non è una nota. L'ottava e
 * l'alterazione si ignorano: conta solo la lettera. Pura.
 */
export function drumVoiceFor(noteName: string | undefined): DrumVoiceName | null {
  if (noteName === undefined) return null;
  const parsed = parseNote(noteName);
  if (parsed === null) return null;
  return DRUM_BY_LETTER[parsed.letter] ?? null;
}

/** Nome del campione in `public/audio/` per uno strumento. Pura. */
export function drumSampleName(voice: DrumVoiceName): DrumSampleName {
  return `drums/${voice}` as DrumSampleName;
}

/**
 * Volume per strumento, oltre alla velocity del pattern. I campioni escono da
 * `tools/process-audio.py` tutti a -3 dBFS di picco: il bilanciamento del kit
 * lo fa questa tabella, non il file.
 */
export const DRUM_LEVELS: Readonly<Record<DrumVoiceName, number>> = {
  kick: 0.9,
  snare: 0.55,
  clap: 0.45,
  hat_closed: 0.3,
  hat_open: 0.28,
  tom: 0.5,
  cowbell: 0.32,
};

/**
 * Timbri di ripiego, quando i campioni non ci sono: rumore bianco filtrato,
 * cioè la batteria sintetica che il gioco ha sempre avuto, ma scelta dalla
 * lettera invece che dalla frequenza. `sustain: 0` su tutti: una percussione
 * decade, non si tiene.
 */
export const SYNTH_DRUM_VOICES: Readonly<Record<DrumVoiceName, NoiseVoice>> = {
  kick: {
    filterType: 'lowpass',
    filterFreq: 160,
    q: 1,
    env: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 },
  },
  snare: {
    filterType: 'bandpass',
    filterFreq: 1500,
    q: 0.9,
    env: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.03 },
  },
  clap: {
    filterType: 'bandpass',
    filterFreq: 1200,
    q: 2,
    env: { attack: 0.002, decay: 0.06, sustain: 0, release: 0.04 },
  },
  hat_closed: {
    filterType: 'bandpass',
    filterFreq: 9000,
    q: 5,
    env: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 },
  },
  hat_open: {
    filterType: 'bandpass',
    filterFreq: 8000,
    q: 3,
    env: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.06 },
  },
  tom: {
    filterType: 'lowpass',
    filterFreq: 320,
    q: 1.5,
    env: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.04 },
  },
  cowbell: {
    filterType: 'bandpass',
    filterFreq: 2600,
    q: 8,
    env: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.03 },
  },
};

/**
 * Batteria campionata. `hit` ritorna false se quel campione non c'è, e allora
 * il synth fa il colpo sintetico con SYNTH_DRUM_VOICES. L'interfaccia sta qui,
 * non in `synth.ts`, perché `synth.ts` la usa già dal passo 8 di questo task
 * mentre la fabbrica `createDrumKit` arriva col task 6: dichiararla altrove
 * lascerebbe `synth.ts` a non compilare per tre passi.
 */
export interface DrumKit {
  hit(voice: DrumVoiceName, time: number, velocity: number): boolean;
  readonly available: boolean;
}

/** Rilascio del colpo: quanto tiene il nodo oltre la durata del campione. */
export const DRUM_TAIL = 0.05;

/**
 * Batteria campionata: un `AudioBufferSourceNode` e un `GainNode` per colpo.
 * Sono pochi per battuta (al massimo sedici sedicesimi), quindi allocare per
 * colpo va bene: il divieto è allocare per frame, e questo non gira nel ciclo
 * di rendering ma nello scheduling del sequencer.
 *
 * I buffer si leggono una volta sola, alla costruzione: il kit nasce quando
 * `SampleStore.ready` si è risolto, quindi ciò che manca in quel momento
 * manca per sempre, e `hit` non deve rifare la ricerca a ogni colpo.
 */
export function createDrumKit(
  ctx: BaseAudioContext,
  destination: AudioNode,
  get: (name: DrumSampleName) => AudioBuffer | null,
): DrumKit {
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(destination);

  const buffers = new Map<DrumVoiceName, AudioBuffer>();
  for (const voice of DRUM_VOICE_NAMES) {
    const buffer = get(drumSampleName(voice));
    if (usableBuffer(buffer) && buffer !== null) buffers.set(voice, buffer);
  }

  function hit(voice: DrumVoiceName, time: number, velocity: number): boolean {
    if (!(velocity > 0)) return false;
    const buffer = buffers.get(voice);
    if (buffer === undefined) return false;
    // Uno start nel passato farebbe partire il colpo subito e tutto insieme
    // agli altri arretrati: meglio ora, una volta.
    const start = Math.max(time, ctx.currentTime);
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, velocity) * DRUM_LEVELS[voice];
    gain.connect(out);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.onended = (): void => gain.disconnect();
    source.start(start);
    source.stop(start + buffer.duration + DRUM_TAIL);
    return true;
  }

  return {
    hit,
    get available(): boolean {
      return buffers.size > 0;
    },
  };
}
