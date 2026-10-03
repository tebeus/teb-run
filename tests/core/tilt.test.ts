import { describe, expect, test } from 'vitest';
import { createTilt, type TiltMemory } from '../../src/core/tilt';

/** Finestra quanto basta: eventi, orientamento in orizzontale, e il costruttore dei sensori. */
function fakeWindow(permission?: () => Promise<string>): { win: Window; tilt: (beta: number) => void } {
  const target = new EventTarget();
  const ctor: { requestPermission?: () => Promise<string> } = {};
  if (permission !== undefined) ctor.requestPermission = permission;
  const win = Object.assign(target, {
    DeviceOrientationEvent: ctor,
    screen: { orientation: { angle: 90 } },
  }) as unknown as Window;
  const tilt = (beta: number): void => {
    target.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma: 0 }));
  };
  return { win, tilt };
}

function memory(initial: boolean): TiltMemory & { saved: boolean[] } {
  let value = initial;
  const saved: boolean[] = [];
  return {
    saved,
    get: () => value,
    set(on) {
      value = on;
      saved.push(on);
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createTilt e la memoria di TILT', () => {
  test('without a permission to ask (Android), a remembered ON is on at once', () => {
    const { win, tilt } = fakeWindow();
    const mem = memory(true);
    const control = createTilt(win, mem);
    expect(control.on).toBe(true);
    expect(control.pending).toBe(false);
    tilt(20);
    expect(control.steer()).toBe(1);
  });

  test('toggling saves the choice', () => {
    const { win } = fakeWindow();
    const mem = memory(false);
    const control = createTilt(win, mem);
    expect(control.on).toBe(false);
    control.toggle();
    expect(control.on).toBe(true);
    control.toggle();
    expect(control.on).toBe(false);
    expect(mem.saved).toEqual([true, false]);
  });

  test('iOS: a remembered ON waits for a gesture, then asks and turns on when granted', async () => {
    let asked = 0;
    const { win, tilt } = fakeWindow(() => {
      asked += 1;
      return Promise.resolve('granted');
    });
    const mem = memory(true);
    const control = createTilt(win, mem);
    expect(asked).toBe(0);
    expect(control.on).toBe(false);
    expect(control.pending).toBe(true);
    control.gesture();
    control.gesture(); // un secondo dito mentre la domanda è aperta: nessuna seconda domanda
    expect(asked).toBe(1);
    await flush();
    expect(control.on).toBe(true);
    expect(control.pending).toBe(false);
    tilt(-20);
    expect(control.steer()).toBe(-1);
    // Già accesa: i gesti dopo non chiedono più niente.
    control.gesture();
    expect(asked).toBe(1);
    expect(mem.saved).toEqual([true]);
  });

  test('iOS: permission denied after the reload goes back to OFF and remembers it, without errors', async () => {
    const { win } = fakeWindow(() => Promise.resolve('denied'));
    const mem = memory(true);
    const control = createTilt(win, mem);
    expect(control.pending).toBe(true);
    control.gesture();
    await flush();
    expect(control.on).toBe(false);
    expect(control.pending).toBe(false);
    expect(mem.get()).toBe(false);
    expect(control.steer()).toBe(0);
    expect(control.refusals).toBe(1);
  });

  test('iOS: TILT pressed and the permission denied counts a refusal, granted does not', async () => {
    const denied = createTilt(fakeWindow(() => Promise.resolve('denied')).win, memory(false));
    expect(denied.refusals).toBe(0);
    denied.toggle();
    await flush();
    expect(denied.on).toBe(false);
    expect(denied.refusals).toBe(1);
    const granted = createTilt(fakeWindow(() => Promise.resolve('granted')).win, memory(false));
    granted.toggle();
    await flush();
    expect(granted.on).toBe(true);
    expect(granted.refusals).toBe(0);
  });

  test('iOS: a permission request that rejects or throws also goes back to OFF', async () => {
    const rejecting = createTilt(fakeWindow(() => Promise.reject(new Error('no gesture'))).win, memory(true));
    rejecting.gesture();
    await flush();
    expect(rejecting.on || rejecting.pending).toBe(false);

    const throwing = createTilt(
      fakeWindow(() => {
        throw new Error('not allowed');
      }).win,
      memory(true),
    );
    expect(() => throwing.gesture()).not.toThrow();
    expect(throwing.on || throwing.pending).toBe(false);
    expect(rejecting.refusals).toBe(1);
    expect(throwing.refusals).toBe(1);
  });

  test('iOS: TILT pressed while waiting switches it off, and a late grant does not turn it on', async () => {
    let grant: (v: string) => void = () => {};
    const { win } = fakeWindow(
      () =>
        new Promise<string>((resolve) => {
          grant = resolve;
        }),
    );
    const mem = memory(true);
    const control = createTilt(win, mem);
    control.toggle();
    expect(control.pending).toBe(false);
    expect(mem.get()).toBe(false);

    // Accesa di nuovo e spenta mentre la domanda è aperta.
    control.toggle();
    control.toggle();
    grant('granted');
    await flush();
    expect(control.on).toBe(false);
    expect(mem.get()).toBe(false);
  });

  test('without sensors nothing turns on, even if remembered', () => {
    const win = Object.assign(new EventTarget(), { screen: { orientation: { angle: 90 } } }) as unknown as Window;
    const control = createTilt(win, memory(true));
    expect(control.available).toBe(false);
    expect(control.on || control.pending).toBe(false);
  });
});
