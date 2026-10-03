// Pattern, brani e matematica dello scheduling. Modulo puro: nessun DOM,
// nessun Web Audio (createSequencer, aggiunto più avanti, riceve l'orologio
// come parametro e usa solo setInterval).

import { isNoteName, noteToFreq } from './notes';

/**
 * Canali del synth, nell'ordine delle righe di `Song.order`. `drums` sta per
 * ultimo di proposito: è la riga che si riscrive più spesso, e in coda un suo
 * cambio non sposta l'indice di nessuna melodia.
 */
export const CHANNELS = ['pulse1', 'pulse2', 'tri', 'lead2', 'pad', 'drums'] as const;
export type ChannelName = (typeof CHANNELS)[number];

export const STEPS_PER_BAR = 16;
export const MIN_BPM = 60;
export const MAX_BPM = 200;

export interface Step {
  /** Nome nota ('C4', 'F#3') oppure null per silenzio. */
  note: string | null;
  /** Durata in step. */
  len: number;
  /** Velocity 0..1; 0 significa muto. */
  vel: number;
}

/** Esattamente STEPS_PER_BAR step, cioè una battuta di sedicesimi. */
export type Pattern = Step[];

export interface Song {
  bpm: number;
  patterns: Pattern[];
  /** Una riga per canale, nell'ordine di CHANNELS; ogni voce è un indice in patterns. */
  order: number[][];
}

/** Durata di uno step (un sedicesimo) in secondi. */
export function stepDuration(bpm: number): number {
  return 15 / bpm;
}

/** Tempo dello step `stepIndex` dall'inizio del brano, in secondi. */
export function stepTime(bpm: number, stepIndex: number): number {
  return stepIndex * stepDuration(bpm);
}

/** Battute del brano, cioè lunghezza della prima riga di order. */
export function songBars(song: Song): number {
  const first: number[] | undefined = song.order[0];
  return first === undefined ? 0 : first.length;
}

/** Step di un canale a un contatore di step assoluto, con loop sulla riga di order. */
export function stepAt(song: Song, channel: number, absStep: number): Step | null {
  const row: number[] | undefined = song.order[channel];
  if (row === undefined || row.length === 0) return null;
  const bar = Math.floor(absStep / STEPS_PER_BAR) % row.length;
  const patternIndex: number | undefined = row[bar];
  if (patternIndex === undefined) return null;
  const pattern: Pattern | undefined = song.patterns[patternIndex];
  if (pattern === undefined) return null;
  const step: Step | undefined = pattern[absStep % STEPS_PER_BAR];
  return step === undefined ? null : step;
}

export interface ScheduledStep {
  /** Contatore di step assoluto dall'inizio del brano. */
  step: number;
  /** Tempo assoluto dell'AudioContext a cui suonare lo step. */
  time: number;
}

/**
 * Step il cui tempo cade in [nowTime, nowTime + lookahead), partendo da
 * `currentStep`. Gli step già scaduti (tab strozzato) vengono scartati, non
 * programmati nel passato. `nextStep` è il primo step non ancora programmato:
 * passandolo alla chiamata successiva nessuno step viene programmato due volte.
 */
export function stepsToSchedule(
  currentStep: number,
  nowTime: number,
  lookahead: number,
  bpm: number,
  songStartTime: number,
): { steps: ScheduledStep[]; nextStep: number } {
  const unit = stepDuration(bpm);
  let step = currentStep;
  if (songStartTime + stepTime(bpm, step) < nowTime) {
    const behind = Math.ceil((nowTime - songStartTime) / unit);
    step = Math.max(step, behind);
  }
  const steps: ScheduledStep[] = [];
  const horizon = nowTime + lookahead;
  for (;;) {
    const time = songStartTime + stepTime(bpm, step);
    if (time >= horizon) break;
    steps.push({ step, time });
    step += 1;
  }
  return { steps, nextStep: step };
}

/**
 * Step che si sente all'istante `nowTime`, riportato dentro il brano
 * (`totalSteps` step, 0 = nessun avvolgimento). È il punto da cui un brano
 * fermato riprende: lo step in corso si risuona dall'attacco, al più un
 * sedicesimo ripetuto. Prima del primo step vale 0. Pura.
 */
export function resumeStep(bpm: number, songStartTime: number, nowTime: number, totalSteps: number): number {
  const heard = Math.floor((nowTime - songStartTime) / stepDuration(bpm));
  if (!Number.isFinite(heard) || heard <= 0) return 0;
  return totalSteps > 0 ? heard % totalSteps : heard;
}

/**
 * Pattern da una riga compatta di 16 token separati da spazi:
 * `C4` nota, `C4:0.3` nota con velocity, `.` silenzio, `-` prolunga la nota
 * precedente di uno step. Lancia sui dati mal formati: i brani sono codice.
 */
export function parsePattern(spec: string, vel = 0.8): Pattern {
  const tokens = spec.trim().split(/\s+/);
  if (tokens.length !== STEPS_PER_BAR) {
    throw new Error(`pattern needs ${STEPS_PER_BAR} tokens, got ${tokens.length}: ${spec}`);
  }
  const steps: Pattern = [];
  let lastNote = -1;
  let sounding = false;
  for (const token of tokens) {
    if (token === '.') {
      steps.push({ note: null, len: 1, vel: 0 });
      sounding = false;
      continue;
    }
    if (token === '-') {
      const target: Step | undefined = lastNote < 0 ? undefined : steps[lastNote];
      if (!sounding || target === undefined) {
        throw new Error(`tie '-' without a note before it: ${spec}`);
      }
      target.len += 1;
      steps.push({ note: null, len: 1, vel: 0 });
      continue;
    }
    const colon = token.indexOf(':');
    const note = colon < 0 ? token : token.slice(0, colon);
    const velText = colon < 0 ? '' : token.slice(colon + 1);
    if (!isNoteName(note)) throw new Error(`invalid note name '${note}': ${spec}`);
    let velocity = vel;
    if (velText !== '') {
      velocity = Number.parseFloat(velText);
      if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) {
        throw new Error(`invalid velocity '${velText}' in token '${token}': ${spec}`);
      }
    }
    steps.push({ note, len: 1, vel: velocity });
    lastNote = steps.length - 1;
    sounding = true;
  }
  return steps;
}

/** Elenco dei problemi di un brano; vuoto se il brano è coerente. */
export function validateSong(song: Song): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(song.bpm) || song.bpm < MIN_BPM || song.bpm > MAX_BPM) {
    problems.push(`bpm ${song.bpm} outside ${MIN_BPM}..${MAX_BPM}`);
  }
  if (song.patterns.length === 0) problems.push('no patterns');
  song.patterns.forEach((pattern, i) => {
    if (pattern.length !== STEPS_PER_BAR) {
      problems.push(`pattern ${i} has ${pattern.length} steps, expected ${STEPS_PER_BAR}`);
    }
    pattern.forEach((step, j) => {
      if (step.note !== null && !isNoteName(step.note)) {
        problems.push(`pattern ${i} step ${j}: invalid note '${step.note}'`);
      }
      if (!Number.isInteger(step.len) || step.len < 1) {
        problems.push(`pattern ${i} step ${j}: len ${step.len}`);
      }
      if (!Number.isFinite(step.vel) || step.vel < 0 || step.vel > 1) {
        problems.push(`pattern ${i} step ${j}: vel ${step.vel}`);
      }
    });
  });
  if (song.order.length !== CHANNELS.length) {
    problems.push(`order has ${song.order.length} rows, expected ${CHANNELS.length}`);
  }
  const bars = songBars(song);
  song.order.forEach((row, channel) => {
    if (row.length !== bars) {
      problems.push(`order row ${channel} has ${row.length} bars, expected ${bars}`);
    }
    row.forEach((index, bar) => {
      if (!Number.isInteger(index) || index < 0 || index >= song.patterns.length) {
        problems.push(`order row ${channel} bar ${bar}: pattern index ${index} does not exist`);
      }
    });
  });
  return problems;
}

/**
 * Finestra di programmazione in avanti, in secondi. La spec §10 dice 100 ms;
 * qui teniamo 1,2 s di deroga consapevole, perché con il tab nascosto il timer
 * viene strozzato a circa un tick al secondo e con 100 ms si sentirebbe una
 * nota al secondo. `allNotesOff` annulla anche le note programmate e non ancora
 * partite, quindi `stopSong` e il cambio di brano restano netti.
 */
export const LOOKAHEAD = 1.2;
/** Periodo del timer, in millisecondi (spec §10). */
export const TICK_MS = 25;
/** Margine fra il momento di play() e il primo step, per non partire nel passato. */
export const START_DELAY = 0.06;

/** Solo la parte di orologio dell'AudioContext. */
export interface TimeSource {
  readonly currentTime: number;
}

/** Solo la parte del synth che serve al sequencer: `Synth` la soddisfa. */
export interface NotePlayer {
  playNote(
    channel: ChannelName,
    freq: number,
    startTime: number,
    duration: number,
    velocity: number,
    /**
     * Nome della nota così come sta nel pattern. Il canale `drums` scegle il
     * campione dalla lettera (spec §10), e la frequenza non gli basta.
     */
    noteName?: string,
  ): void;
  allNotesOff(fade?: number): void;
}

export interface Sequencer {
  /**
   * Ferma quello che sta suonando e avvia `song` in loop, dall'inizio o
   * dallo step `fromStep` (la ripresa dopo la pausa, vedi `position`).
   */
  play(song: Song, fromStep?: number): void;
  /** Idempotente: chiamarla senza nulla in riproduzione non fa niente. */
  stop(): void;
  readonly playing: boolean;
  /** Step che si sente adesso (`resumeStep`), o null se non suona niente. */
  readonly position: number | null;
}

export interface SequencerOptions {
  lookahead?: number;
  tickMs?: number;
  startDelay?: number;
}

/**
 * Timer sottile intorno alla matematica pura: ogni `tickMs` programma gli step
 * che cadono nei prossimi `lookahead` secondi. Il brano gira in loop perché
 * `stepAt` avvolge il contatore di step sulle righe di `order`.
 */
export function createSequencer(
  clock: TimeSource,
  player: NotePlayer,
  options: SequencerOptions = {},
): Sequencer {
  const lookahead = options.lookahead ?? LOOKAHEAD;
  const tickMs = options.tickMs ?? TICK_MS;
  const startDelay = options.startDelay ?? START_DELAY;

  let song: Song | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let songStart = 0;
  let nextStep = 0;

  function tick(): void {
    const current = song;
    if (current === null) return;
    const planned = stepsToSchedule(nextStep, clock.currentTime, lookahead, current.bpm, songStart);
    nextStep = planned.nextStep;
    const unit = stepDuration(current.bpm);
    for (const scheduled of planned.steps) {
      for (let channelIndex = 0; channelIndex < CHANNELS.length; channelIndex++) {
        const channel: ChannelName | undefined = CHANNELS[channelIndex];
        if (channel === undefined) continue;
        const step = stepAt(current, channelIndex, scheduled.step);
        if (step === null || step.note === null || step.vel <= 0) continue;
        player.playNote(
          channel,
          noteToFreq(step.note),
          scheduled.time,
          unit * step.len,
          step.vel,
          step.note,
        );
      }
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (song !== null) {
      song = null;
      player.allNotesOff();
    }
  }

  function play(next: Song, fromStep = 0): void {
    stop();
    song = next;
    const total = songBars(next) * STEPS_PER_BAR;
    const first = Number.isInteger(fromStep) && fromStep > 0 ? (total > 0 ? fromStep % total : fromStep) : 0;
    // L'inizio del brano si arretra di `first` step: lo step `first` cade
    // dopo il solito margine, e la matematica di stepsToSchedule non cambia.
    songStart = clock.currentTime + startDelay - stepTime(next.bpm, first);
    nextStep = first;
    tick();
    timer = setInterval(tick, tickMs);
  }

  return {
    play,
    stop,
    get playing(): boolean {
      return song !== null;
    },
    get position(): number | null {
      const current = song;
      if (current === null) return null;
      return resumeStep(current.bpm, songStart, clock.currentTime, songBars(current) * STEPS_PER_BAR);
    },
  };
}
