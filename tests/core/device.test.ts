import { describe, expect, test } from 'vitest';
import { deviceAfter, initialDevice } from '../../src/core/device';
import { emptyActions, padActive } from '../../src/core/input';

describe('dispositivo in uso', () => {
  test('un computer senza touch parte e resta sulla tastiera', () => {
    expect(initialDevice({ maxTouchPoints: 0, coarsePointer: false })).toBe('keyboard');
    expect(initialDevice({})).toBe('keyboard');
    // Portatile con schermo touch ma mouse come puntatore principale.
    expect(initialDevice({ maxTouchPoints: 10, coarsePointer: false })).toBe('keyboard');
    expect(deviceAfter('keyboard', { type: 'pointerdown', pointerType: 'mouse' })).toBe('keyboard');
  });

  test('un telefono parte dal tocco', () => {
    expect(initialDevice({ maxTouchPoints: 5, coarsePointer: true })).toBe('touch');
  });

  test('segue l\'ultimo dispositivo usato', () => {
    expect(deviceAfter('keyboard', { type: 'pointerdown', pointerType: 'touch' })).toBe('touch');
    expect(deviceAfter('touch', { type: 'keydown' })).toBe('keyboard');
    expect(deviceAfter('keyboard', { type: 'gamepadconnected' })).toBe('pad');
    expect(deviceAfter('pad', { type: 'pointerdown' })).toBe('pad');
    expect(deviceAfter('pad', { type: 'resize' })).toBe('pad');
  });

  test('padActive: il gamepad chiede qualcosa?', () => {
    expect(padActive(emptyActions())).toBe(false);
    expect(padActive({ ...emptyActions(), left: true })).toBe(true);
  });
});
