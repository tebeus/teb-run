import { describe, expect, test } from 'vitest';
import { STEP } from '../../src/core/loop';
import { createInput } from '../../src/core/input';
import { createFsm, type Screen } from '../../src/ui/fsm';
import { makePlaceholder } from '../../src/ui/screens/placeholder';

const key = (type: string, code: string, repeat = false) =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat });

describe('createFsm glue: transition tick semantics', () => {
  test('a screen that transitions in the same tick a new screen is entered does not get updated twice', () => {
    const log: string[] = [];
    const mk = (name: string, next: 'radio' | 'race' | null): Screen => ({
      enter: () => log.push(`enter:${name}`),
      update: (_dt, a) => {
        log.push(`update:${name}`);
        return a.confirm && next ? { to: next } : null;
      },
      render: () => {},
    });
    const base = {} as Record<string, Screen>;
    for (const n of ['title', 'radio', 'race', 'ending', 'gameOver', 'nameEntry', 'scores']) base[n] = mk(n, null);
    base.title = mk('title', 'radio');
    base.radio = mk('radio', 'race');
    const fsm = createFsm(base as never, 'title');
    fsm.update(STEP, {
      accelerate: false,
      brake: false,
      left: false,
      right: false,
      gearToggle: false,
      modeToggle: false,
      confirm: true,
      back: false,
      mute: false,
    });
    expect(fsm.name).toBe('radio');
    expect(log).toEqual(['enter:title', 'update:title', 'enter:radio']);
  });

  test('held ENTER across a transition advances exactly one screen per physical press', () => {
    const t = new EventTarget();
    const input = createInput(t);
    const screens = {
      title: makePlaceholder('T', 'radio'),
      daily: makePlaceholder('D', 'radio'),
      radio: makePlaceholder('R', 'race'),
      race: makePlaceholder('X', 'ending'),
      ending: makePlaceholder('E', 'nameEntry'),
      gameOver: makePlaceholder('G', 'nameEntry'),
      nameEntry: makePlaceholder('N', 'scores'),
      scores: makePlaceholder('S', 'title'),
      endings: makePlaceholder('F', 'title'),
    };
    const fsm = createFsm(screens, 'title');
    t.dispatchEvent(key('keydown', 'Enter'));
    for (let i = 0; i < 30; i++) {
      if (i > 0) t.dispatchEvent(key('keydown', 'Enter', true));
      fsm.update(STEP, input.poll());
    }
    expect(fsm.name).toBe('radio');
  });
});
