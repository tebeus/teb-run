import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { createFsm, go, type Screen, type ScreenName, type Transition } from '../../src/ui/fsm';

function fakeScreen(next: Transition | null, log: string[], name: string): Screen {
  return {
    enter(payload) {
      log.push(`enter:${name}:${JSON.stringify(payload ?? null)}`);
    },
    update() {
      return next;
    },
    render() {
      log.push(`render:${name}`);
    },
    exit() {
      log.push(`exit:${name}`);
    },
  };
}

function allScreens(log: string[], overrides: Partial<Record<ScreenName, Screen>>): Record<ScreenName, Screen> {
  const names: ScreenName[] = ['title', 'radio', 'race', 'ending', 'gameOver', 'nameEntry', 'scores'];
  const base = {} as Record<ScreenName, Screen>;
  for (const n of names) base[n] = fakeScreen(null, log, n);
  return { ...base, ...overrides };
}

describe('createFsm', () => {
  test('enters the initial screen on creation', () => {
    const log: string[] = [];
    const fsm = createFsm(allScreens(log, {}), 'title');
    expect(fsm.name).toBe('title');
    expect(log).toEqual(['enter:title:null']);
  });

  test('stays on the screen when update returns null', () => {
    const log: string[] = [];
    const fsm = createFsm(allScreens(log, {}), 'title');
    fsm.update(1 / 60, emptyActions());
    expect(fsm.name).toBe('title');
  });

  test('follows a transition and passes the payload to enter', () => {
    const log: string[] = [];
    const screens = allScreens(log, {
      title: fakeScreen({ to: 'race', payload: { song: 2 } }, log, 'title'),
    });
    const fsm = createFsm(screens, 'title');
    fsm.update(1 / 60, emptyActions());
    expect(fsm.name).toBe('race');
    expect(log).toContain('enter:race:{"song":2}');
  });

  test('render delegates to the current screen only', () => {
    const log: string[] = [];
    const fsm = createFsm(allScreens(log, {}), 'scores');
    fsm.render({} as CanvasRenderingContext2D);
    expect(log.filter((l) => l.startsWith('render:'))).toEqual(['render:scores']);
  });

  test('exit of the current screen is called before enter of the next one', () => {
    const log: string[] = [];
    const screens = allScreens(log, {
      title: fakeScreen({ to: 'race', payload: { song: 2 } }, log, 'title'),
    });
    const fsm = createFsm(screens, 'title');
    fsm.update(1 / 60, emptyActions());
    expect(log).toEqual(['enter:title:null', 'exit:title', 'enter:race:{"song":2}']);
  });

  test('a screen without exit does not throw on transition', () => {
    const log: string[] = [];
    const screens = allScreens(log, {
      title: {
        enter() {
          log.push('enter:title:null');
        },
        update() {
          return { to: 'race' };
        },
        render() {},
      },
    });
    const fsm = createFsm(screens, 'title');
    expect(() => fsm.update(1 / 60, emptyActions())).not.toThrow();
    expect(fsm.name).toBe('race');
  });

  test('go builds a transition with a typed payload', () => {
    expect(go('race', { song: 1 })).toEqual({ to: 'race', payload: { song: 1 } });
  });
});
