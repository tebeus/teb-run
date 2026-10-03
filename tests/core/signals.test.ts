import { describe, expect, test } from 'vitest';
import { createSystemSignals, toLogical } from '../../src/core/signals';

describe('toLogical', () => {
  test('scala dal riquadro CSS al canvas logico 1280x720', () => {
    const rect = { left: 100, top: 50, width: 640, height: 360 };
    expect(toLogical(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(toLogical(420, 230, rect)).toEqual({ x: 640, y: 360 });
    expect(toLogical(740, 410, rect)).toEqual({ x: 1280, y: 720 });
  });

  test('fuori dal canvas, o canvas senza area: null', () => {
    const rect = { left: 100, top: 50, width: 640, height: 360 };
    expect(toLogical(99, 60, rect)).toBeNull();
    expect(toLogical(800, 60, rect)).toBeNull();
    expect(toLogical(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe('createSystemSignals', () => {
  function setup() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    });
    return { win, doc, canvas, signals: createSystemSignals(win, doc, canvas) };
  }

  function pointer(x: number, y: number): Event {
    return Object.assign(new Event('pointerdown'), { clientX: x, clientY: y });
  }

  test('blur segna la perdita del fuoco, letta una volta sola', () => {
    const { win, signals } = setup();
    expect(signals.takeFocusLost()).toBe(false);
    win.dispatchEvent(new Event('blur'));
    expect(signals.takeFocusLost()).toBe(true);
    expect(signals.takeFocusLost()).toBe(false);
  });

  test('visibilitychange conta solo quando la scheda si nasconde', () => {
    const { doc, signals } = setup();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(signals.takeFocusLost()).toBe(false);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(signals.takeFocusLost()).toBe(true);
  });

  test('il tocco sul canvas arriva in coordinate logiche, una volta sola', () => {
    const { canvas, signals } = setup();
    expect(signals.takeTap()).toBeNull();
    canvas.dispatchEvent(pointer(640, 400));
    expect(signals.takeTap()).toEqual({ x: 640, y: 400 });
    expect(signals.takeTap()).toBeNull();
  });
});
