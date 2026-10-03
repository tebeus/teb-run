import { describe, expect, test } from 'vitest';
import { emptyActions, mapGamepad, mapKeys, mergeActions } from '../../src/core/input';

const set = (...codes: string[]) => new Set(codes);

describe('mapKeys', () => {
  test('held keys map to held actions', () => {
    const a = mapKeys(set('ArrowUp', 'ArrowLeft'), set());
    expect(a.accelerate).toBe(true);
    expect(a.left).toBe(true);
    expect(a.brake).toBe(false);
    expect(a.right).toBe(false);
  });

  test('alternate keys Z and X work', () => {
    const a = mapKeys(set('KeyZ', 'KeyX'), set());
    expect(a.accelerate).toBe(true);
    expect(a.brake).toBe(true);
  });

  test('momentary actions fire only on the press tick', () => {
    const pressTick = mapKeys(set('Enter', 'ShiftLeft', 'Escape', 'KeyM'), set('Enter', 'ShiftLeft', 'Escape', 'KeyM'));
    expect(pressTick.confirm).toBe(true);
    expect(pressTick.gearToggle).toBe(true);
    expect(pressTick.back).toBe(true);
    expect(pressTick.mute).toBe(true);

    const heldTick = mapKeys(set('Enter', 'ShiftLeft', 'Escape', 'KeyM'), set());
    expect(heldTick.confirm).toBe(false);
    expect(heldTick.gearToggle).toBe(false);
    expect(heldTick.back).toBe(false);
    expect(heldTick.mute).toBe(false);
  });

  test('D is the momentary mode toggle of the radio', () => {
    expect(mapKeys(set('KeyD'), set('KeyD')).modeToggle).toBe(true);
    expect(mapKeys(set('KeyD'), set()).modeToggle).toBe(false);
    expect(emptyActions().modeToggle).toBe(false);
  });

  test('unknown keys are ignored', () => {
    expect(mapKeys(set('KeyQ', 'F5', 'Space'), set('KeyQ'))).toEqual(emptyActions());
  });
});

describe('mapGamepad', () => {
  const pad = (pressed: number[], axis0 = 0) => ({
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
    axes: [axis0, 0, 0, 0],
  });

  test('left stick beyond threshold steers, below threshold does not', () => {
    expect(mapGamepad(pad([], -0.5), []).actions.left).toBe(true);
    expect(mapGamepad(pad([], 0.5), []).actions.right).toBe(true);
    const dead = mapGamepad(pad([], 0.3), []).actions;
    expect(dead.left).toBe(false);
    expect(dead.right).toBe(false);
  });

  test('A accelerates while held but confirms only on press', () => {
    const first = mapGamepad(pad([0]), []);
    expect(first.actions.accelerate).toBe(true);
    expect(first.actions.confirm).toBe(true);
    const second = mapGamepad(pad([0]), first.buttons);
    expect(second.actions.accelerate).toBe(true);
    expect(second.actions.confirm).toBe(false);
  });

  test('triggers, d-pad and menu buttons map as documented', () => {
    const a = mapGamepad(pad([1, 3, 6, 7, 8, 9, 14]), []).actions;
    expect(a.brake).toBe(true);
    expect(a.gearToggle).toBe(true);
    expect(a.accelerate).toBe(true);
    expect(a.back).toBe(true);
    expect(a.confirm).toBe(true);
    expect(a.left).toBe(true);
  });

  test('a pad with fewer buttons than expected does not throw', () => {
    expect(() => mapGamepad({ buttons: [], axes: [] }, [])).not.toThrow();
  });
});

describe('mergeActions', () => {
  test('ORs every field', () => {
    const a = { ...emptyActions(), left: true };
    const b = { ...emptyActions(), confirm: true };
    const m = mergeActions(a, b);
    expect(m.left).toBe(true);
    expect(m.confirm).toBe(true);
    expect(m.right).toBe(false);
  });
});
