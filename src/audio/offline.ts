// Render offline dell'audio, per la verifica d'ascolto (spec §16). Il gancio
// `#debug` di src/main.ts lo chiama da Playwright: nel browser vero, con i
// campioni veri, con l'OfflineAudioContext vero. Niente finti.
//
// Il sequencer non serve: gira su setInterval, che offline non ha senso.
// `scheduleSong` programma tutte le note di N battute in una volta, usando la
// stessa matematica pura del sequencer (`stepAt`, `stepTime`).

import { analyse, type AudioSampleReport } from './analysis';
import { createDrumKit } from './drums';
import { createSampledEngine } from './engine-sampled';
import { createMusicFx } from './effects';
import { noteToFreq } from './notes';
import type { SampleStore } from './samples';
import {
  CHANNELS,
  stepAt,
  stepDuration,
  STEPS_PER_BAR,
  type NotePlayer,
  type Song,
} from './sequencer';
import { SONGS, SONG_VOICINGS } from './songs';
import { createSynth } from './synth';
import type { Gear } from '../types';

export type AudioSampleKind =
  | 'engine-idle'
  | 'engine-mid'
  | 'engine-full'
  | 'song-0'
  | 'song-1'
  | 'song-2';

export const AUDIO_SAMPLE_KINDS: readonly AudioSampleKind[] = [
  'engine-idle',
  'engine-mid',
  'engine-full',
  'song-0',
  'song-1',
  'song-2',
];

/** Le tre velocità: sotto il crossfade, in mezzo, sopra. Pura. */
export function engineSpeedFor(kind: AudioSampleKind): number | null {
  switch (kind) {
    case 'engine-idle':
      return 0.05;
    case 'engine-mid':
      return 0.375;
    case 'engine-full':
      return 0.95;
    default:
      return null;
  }
}

/** Indice del brano, o null se il tipo è un motore. Pura. */
export function songIndexFor(kind: AudioSampleKind): number | null {
  const match = /^song-(\d)$/.exec(kind);
  if (match === null) return null;
  const index = Number.parseInt(match[1]!, 10);
  return index >= 0 && index < SONGS.length ? index : null;
}

/** Marcia usata per il render: hi alle velocità alte, come in gara. */
export function gearFor(speedPercent: number): Gear {
  return speedPercent > 0.3 ? 'hi' : 'lo';
}

/** Da quale battuta del brano partire: il tema, non l'intro. */
export const RENDER_FROM_STEP = 20 * STEPS_PER_BAR;

/**
 * Programma tutte le note di `bars` battute a partire da `fromStep`. Ritorna
 * il tempo di fine. Usa la stessa matematica del sequencer, senza timer.
 */
export function scheduleSong(
  song: Song,
  player: NotePlayer,
  bars: number,
  startTime: number,
  fromStep: number = 0,
): number {
  const unit = stepDuration(song.bpm);
  const steps = Math.max(0, Math.floor(bars)) * STEPS_PER_BAR;
  for (let offset = 0; offset < steps; offset++) {
    const absStep = fromStep + offset;
    const time = startTime + offset * unit;
    for (let channelIndex = 0; channelIndex < CHANNELS.length; channelIndex++) {
      const channel = CHANNELS[channelIndex];
      if (channel === undefined) continue;
      const step = stepAt(song, channelIndex, absStep);
      if (step === null || step.note === null || step.vel <= 0) continue;
      player.playNote(channel, noteToFreq(step.note), time, unit * step.len, step.vel, step.note);
    }
  }
  return startTime + steps * unit;
}

export interface OfflineDeps {
  sampleRate: number;
  samples: SampleStore;
  /** Costruttore dell'OfflineAudioContext; null se il browser non lo offre. */
  make(channels: number, length: number, sampleRate: number): OfflineAudioContext | null;
}

/**
 * Renderizza `seconds` di un tipo di suono e ne ritorna le misure. `null` se
 * il browser non offre OfflineAudioContext o se il tipo richiede campioni che
 * non ci sono.
 */
export async function renderAudioSample(
  kind: AudioSampleKind,
  seconds: number,
  deps: OfflineDeps,
): Promise<AudioSampleReport | null> {
  const length = Math.max(1, Math.round(seconds * deps.sampleRate));
  const ctx = deps.make(1, length, deps.sampleRate);
  if (ctx === null) return null;

  const speed = engineSpeedFor(kind);
  if (speed !== null) {
    const low = deps.samples.get('engine_low');
    const high = deps.samples.get('engine_high');
    if (low === null || high === null) return null;
    const engine = createSampledEngine(ctx, ctx.destination, { low, high });
    // Una sola scrittura all'inizio: le rampe di setTargetAtTime si
    // completano in una frazione di secondo, e il resto del render è
    // stazionario, che è quello che si vuole misurare.
    engine.setEngine(speed, gearFor(speed), true);
  } else {
    const index = songIndexFor(kind);
    if (index === null) return null;
    const song = SONGS[index];
    const voicing = SONG_VOICINGS[index];
    if (song === undefined || voicing === undefined) return null;
    const fx = createMusicFx(ctx as unknown as AudioContext, ctx.destination);
    fx.setBpm(song.bpm);
    fx.setSweep(voicing.sweep);
    fx.start();
    const synth = createSynth(ctx as unknown as AudioContext, fx.input);
    synth.setDuty('pulse1', voicing.pulse1);
    synth.setDuty('pulse2', voicing.pulse2);
    const kit = createDrumKit(ctx, fx.input, (name) => deps.samples.get(name));
    synth.useDrumKit(kit.available ? kit : null);
    // Quattro battute dal tema: `seconds` deve bastare a contenerle, e il
    // chiamante lo sa (il brano più lento, 92 bpm, fa 10,4 s per 4 battute).
    scheduleSong(song, synth, 4, 0, RENDER_FROM_STEP);
  }

  const rendered = await ctx.startRendering();
  return analyse(rendered.getChannelData(0), rendered.sampleRate);
}
