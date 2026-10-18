import { describe, expect, test } from 'vitest';
import { UNLOCK_EVENTS, installAudioUnlock } from '../../src/core/audioUnlock';
import { computeLetterbox, computeSafeLetterbox } from '../../src/core/canvas';
import type { InputDevice } from '../../src/core/device';
import { createRotateGuard, guardSignals, wantsRotate } from '../../src/ui/rotate';

describe('telefono in verticale', () => {
  test('si chiede di ruotare solo col tocco e in verticale', () => {
    expect(wantsRotate('touch', 390, 844)).toBe(true);
    expect(wantsRotate('touch', 844, 390)).toBe(false);
    expect(wantsRotate('keyboard', 390, 844)).toBe(false);
    expect(wantsRotate('pad', 390, 844)).toBe(false);
  });

  test('schermi quasi quadrati (pieghevoli aperti, iPad in verticale): niente velo, si gioca in letterbox', () => {
    // Pieghevoli aperti, 1:1 e 4:5.
    expect(wantsRotate('touch', 884, 1060)).toBe(false);
    expect(wantsRotate('touch', 800, 800)).toBe(false);
    expect(wantsRotate('touch', 720, 900)).toBe(false);
    expect(wantsRotate('touch', 400, 500)).toBe(false);
    // iPad in verticale.
    expect(wantsRotate('touch', 768, 1024)).toBe(false);
    expect(wantsRotate('touch', 834, 1194)).toBe(false);
    // Telefoni in verticale, anche lo schermo esterno di un pieghevole chiuso.
    expect(wantsRotate('touch', 375, 667)).toBe(true);
    expect(wantsRotate('touch', 380, 840)).toBe(true);
    expect(wantsRotate('touch', 500, 640)).toBe(true);
  });

  test('il passaggio in verticale mette in pausa una volta, e i tocchi non passano', () => {
    const win = Object.assign(new EventTarget(), { innerWidth: 844, innerHeight: 390 });
    const device: InputDevice = 'touch';
    let taps = 0;
    const inner = {
      takeTap: () => (taps++, { x: 640, y: 400 }),
      takeFocusLost: () => false,
    };
    const signals = guardSignals(inner);
    const guard = createRotateGuard(win, () => device, () => signals.raiseFocusLost());
    signals.setBlocked(guard.blocked);
    expect(guard.blocked()).toBe(false);
    expect(signals.takeFocusLost()).toBe(false);
    expect(signals.takeTap()).toEqual({ x: 640, y: 400 });

    win.innerWidth = 390;
    win.innerHeight = 844;
    win.dispatchEvent(new Event('resize'));
    expect(guard.blocked()).toBe(true);
    expect(signals.takeFocusLost()).toBe(true);
    expect(signals.takeFocusLost()).toBe(false);
    // Il tocco si consuma lo stesso, ma non arriva.
    expect(signals.takeTap()).toBeNull();
    expect(taps).toBe(2);
  });
});

describe('safe area', () => {
  test('senza margini è il letterbox di sempre', () => {
    expect(computeSafeLetterbox(1280, 720)).toEqual(computeLetterbox(1280, 720));
    expect(computeSafeLetterbox(1000, 900)).toEqual(computeLetterbox(1000, 900));
  });

  test('con il notch il gioco sta dentro la parte libera', () => {
    // iPhone in orizzontale: 47 px di notch a sinistra e a destra, 21 di barra sotto.
    const lb = computeSafeLetterbox(844, 390, { top: 0, right: 47, bottom: 21, left: 47 });
    expect(lb.offsetX).toBeGreaterThanOrEqual(47);
    expect(lb.offsetX + lb.cssW).toBeLessThanOrEqual(844 - 47);
    expect(lb.offsetY + lb.cssH).toBeLessThanOrEqual(390 - 21);
    expect(lb.cssW / lb.cssH).toBeCloseTo(16 / 9, 1);
  });

  test('margini assurdi valgono zero', () => {
    expect(computeSafeLetterbox(1280, 720, { top: Number.NaN, right: -5, bottom: 0, left: 0 })).toEqual(computeLetterbox(1280, 720));
  });
});

describe('sblocco audio', () => {
  test('a ogni gesto, anche dopo il primo che attiva: iOS sospende il contesto (chiamata, background) e solo un gesto lo riprende', () => {
    const win = new EventTarget();
    const seen: string[] = [];
    installAudioUnlock(win, () => seen.push('unlock'));
    for (const name of UNLOCK_EVENTS) win.dispatchEvent(new Event(name));
    win.dispatchEvent(new Event('touchend'));
    win.dispatchEvent(new Event('keydown'));
    expect(seen).toHaveLength(UNLOCK_EVENTS.length + 2);
  });

  test('i gesti sono tasto, clic e il rilascio del dito, non solo la visibilità', () => {
    for (const name of ['touchend', 'click', 'pointerup', 'keydown']) expect(UNLOCK_EVENTS).toContain(name);
    expect(UNLOCK_EVENTS).not.toContain('visibilitychange');
  });
});
