import { describe, expect, test } from 'vitest';
import { createInput } from '../../src/core/input';

const key = (type: string, code: string, repeat = false) =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat });

describe('createInput glue (fake EventTarget, Node)', () => {
  test('gamepad API absent in Node: poll does not throw', () => {
    const t = new EventTarget();
    const input = createInput(t);
    expect(() => input.poll()).not.toThrow();
  });

  test('held ENTER with OS auto-repeat fires confirm exactly once', () => {
    const t = new EventTarget();
    const input = createInput(t);
    t.dispatchEvent(key('keydown', 'Enter'));
    expect(input.poll().confirm).toBe(true);
    t.dispatchEvent(key('keydown', 'Enter', true));
    t.dispatchEvent(key('keydown', 'Enter', true));
    expect(input.poll().confirm).toBe(false);
    expect(input.poll().confirm).toBe(false);
    t.dispatchEvent(key('keyup', 'Enter'));
    t.dispatchEvent(key('keydown', 'Enter'));
    expect(input.poll().confirm).toBe(true);
  });

  test('a tap fully inside one tick (down+up before poll) still counts', () => {
    const t = new EventTarget();
    const input = createInput(t);
    t.dispatchEvent(key('keydown', 'Enter'));
    t.dispatchEvent(key('keyup', 'Enter'));
    expect(input.poll().confirm).toBe(true);
  });

  test('blur clears held keys', () => {
    const t = new EventTarget();
    const input = createInput(t);
    t.dispatchEvent(key('keydown', 'ArrowUp'));
    expect(input.poll().accelerate).toBe(true);
    t.dispatchEvent(new Event('blur'));
    expect(input.poll().accelerate).toBe(false);
  });

  test('mapped keys are preventDefault-ed, unmapped are not', () => {
    const t = new EventTarget();
    createInput(t);
    const up = key('keydown', 'ArrowUp');
    const f5 = key('keydown', 'F5');
    t.dispatchEvent(up);
    t.dispatchEvent(f5);
    expect(up.defaultPrevented).toBe(true);
    expect(f5.defaultPrevented).toBe(false);
  });
});
