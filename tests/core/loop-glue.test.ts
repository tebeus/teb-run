import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createLoop } from '../../src/core/loop';

let originalRaf: typeof globalThis.requestAnimationFrame;
let originalCaf: typeof globalThis.cancelAnimationFrame;
let cbs: Array<(t: number) => void>;

beforeEach(() => {
  originalRaf = globalThis.requestAnimationFrame;
  originalCaf = globalThis.cancelAnimationFrame;
  cbs = [];
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => {
    cbs.push(cb);
    return cbs.length;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
});

describe('createLoop glue (fake requestAnimationFrame)', () => {
  test('a 1/60 s frame yields exactly one update', () => {
    let updates = 0;
    let renders = 0;
    const loop = createLoop({
      update: () => updates++,
      render: () => renders++,
    });
    loop.start();
    cbs.shift()!(1000); // first frame: elapsed 0, no update yet
    expect(updates).toBe(0);
    expect(renders).toBe(1);
    cbs.shift()!(1000 + 1000 / 60);
    expect(updates).toBe(1);
    expect(renders).toBe(2);
    loop.stop();
  });

  test('a 2-minute gap (hidden tab) yields exactly 15 update steps', () => {
    let updates = 0;
    let renders = 0;
    const loop = createLoop({
      update: () => updates++,
      render: () => renders++,
    });
    loop.start();
    cbs.shift()!(1000); // first frame: elapsed 0
    expect(updates).toBe(0);
    expect(renders).toBe(1);
    cbs.shift()!(1000 + 1000 / 60);
    expect(updates).toBe(1);
    cbs.shift()!(1000 + 1000 / 60 + 120_000); // hidden tab for 2 minutes
    expect(updates).toBe(16); // 1 from the previous frame + 15 clamped by MAX_ACC
    expect(renders).toBe(3);
    loop.stop();
  });
});
