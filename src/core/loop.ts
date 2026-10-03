export const STEP = 1 / 60;
export const MAX_ACC = 0.25;

/** Quanti passi fissi eseguire dato l'accumulo e il tempo trascorso. Pura. */
export function stepAccumulator(
  acc: number,
  elapsed: number,
  step = STEP,
  maxAcc = MAX_ACC,
): { steps: number; rest: number } {
  const total = Math.min(acc + elapsed, maxAcc);
  // Epsilon: 0.25 / (1/60) in virgola mobile può dare 14.999999..., non 15.
  const steps = Math.floor(total / step + 1e-9);
  return { steps, rest: Math.max(0, total - steps * step) };
}

export interface LoopHooks {
  update(dt: number): void;
  render(): void;
}

export interface Loop {
  start(): void;
  stop(): void;
}

/** Simulazione a 60 Hz fissi, rendering a ogni frame di requestAnimationFrame. */
export function createLoop(hooks: LoopHooks): Loop {
  let acc = 0;
  let last = 0;
  let raf = 0;
  let running = false;

  const frame = (now: number): void => {
    if (!running) return;
    const elapsed = last === 0 ? 0 : (now - last) / 1000;
    last = now;
    const r = stepAccumulator(acc, elapsed);
    acc = r.rest;
    for (let i = 0; i < r.steps; i++) hooks.update(STEP);
    hooks.render();
    raf = requestAnimationFrame(frame);
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
