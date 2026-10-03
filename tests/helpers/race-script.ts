import { STEP } from '../../src/core/loop';
import { emptyActions } from '../../src/core/input';
import type { Actions, RaceEngine, RaceEvent } from '../../src/types';

/** Azioni complete a partire da poche sovrascritture. */
export function acts(over: Partial<Actions> = {}): Actions {
  return { ...emptyActions(), ...over };
}

export interface ScriptStep {
  /** Quanti tick eseguire con queste azioni. */
  ticks: number;
  actions?: Partial<Actions>;
}

export interface RunResult {
  /** Tutti gli eventi, nell'ordine in cui il motore li ha prodotti. */
  events: RaceEvent[];
  /** Quanti tick sono stati eseguiti. */
  ticks: number;
}

/** Tipi degli eventi raccolti, nell'ordine: comodo per le asserzioni. */
export function eventTypes(events: readonly RaceEvent[]): string[] {
  return events.map((e) => e.type);
}

/**
 * Esegue uno script di azioni sul motore e raccoglie gli eventi. Non tocca
 * `snapshot()`: chi vuole lo stato lo chiede al motore alla fine.
 */
export function simulateRace(engine: RaceEngine, script: readonly ScriptStep[], dt = STEP): RunResult {
  const events: RaceEvent[] = [];
  let ticks = 0;
  for (const step of script) {
    const a = acts(step.actions);
    for (let i = 0; i < step.ticks; i++) {
      events.push(...engine.update(dt, a));
      ticks++;
    }
  }
  return { events, ticks };
}

export interface DriveOptions {
  actions?: Partial<Actions>;
  dt?: number;
  maxTicks?: number;
}

/**
 * Guida con azioni costanti finché `stop` non ritorna vero sugli eventi
 * accumulati, o fino a `maxTicks`. Ritorna tutti gli eventi raccolti.
 */
export function driveUntil(
  engine: RaceEngine,
  stop: (events: readonly RaceEvent[], tick: number) => boolean,
  options: DriveOptions = {},
): RunResult {
  const dt = options.dt ?? STEP;
  const maxTicks = options.maxTicks ?? 20000;
  const a = acts(options.actions);
  const events: RaceEvent[] = [];
  for (let ticks = 1; ticks <= maxTicks; ticks++) {
    events.push(...engine.update(dt, a));
    if (stop(events, ticks)) return { events, ticks };
  }
  return { events, ticks: maxTicks };
}

/** Vero se fra gli eventi ce n'è almeno uno del tipo dato. */
export function has(events: readonly RaceEvent[], type: RaceEvent['type']): boolean {
  return events.some((e) => e.type === type);
}

/**
 * Guida verso un x bersaglio: accelera, mette la marcia alta al primo tick e
 * sterza verso il bersaglio leggendo lo snapshot. Serve ai test che devono
 * arrivare in fondo a una tappa senza finire fuori strada.
 */
export function driveToward(
  engine: RaceEngine,
  targetX: number,
  stop: (events: readonly RaceEvent[], tick: number) => boolean,
  options: DriveOptions = {},
): RunResult {
  const dt = options.dt ?? STEP;
  const maxTicks = options.maxTicks ?? 20000;
  const events: RaceEvent[] = [];
  for (let ticks = 1; ticks <= maxTicks; ticks++) {
    const x = engine.snapshot().player.x;
    events.push(
      ...engine.update(
        dt,
        acts({
          accelerate: true,
          gearToggle: ticks === 1,
          left: x > targetX + 0.02,
          right: x < targetX - 0.02,
          ...options.actions,
        }),
      ),
    );
    if (stop(events, ticks)) return { events, ticks };
  }
  return { events, ticks: maxTicks };
}
