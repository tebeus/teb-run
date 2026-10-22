// Il clic del mouse: solo il tasto sinistro del mouse vero, dato alle
// schermate in `actions.click`; le dita no (passano da touch.ts, nessun
// doppio evento); i clic sui comandi di contorno restano a loro. Poi cosa
// fa il clic su titolo, radio e TOP 10.

import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { createMouseClicks } from '../../src/ui/mouse';
import { stepTitle, initialTitleState } from '../../src/ui/screens/title';
import { stepScores } from '../../src/ui/screens/scores';
import { createRadioScreen, radioClickTarget, RADIO_LIST_Y, RADIO_ROW_STEP } from '../../src/ui/screens/radio';
import { RADIO_CAR_RECT, RADIO_MODE_RECT } from '../../src/ui/radioTouch';
import { createCarSetting } from '../../src/persist/car';
import { createModeSetting } from '../../src/persist/mode';
import { createScoresStore } from '../../src/persist/scores';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { touchLayout } from '../../src/ui/touch';
import { go } from '../../src/ui/fsm';
import type { ScreenName } from '../../src/ui/fsm';
import type { ScreenDeps } from '../../src/ui/deps';
import type { AudioBus } from '../../src/types';

type Handler = (e: Record<string, unknown>) => void;

function fakeCanvas() {
  const handlers = new Map<string, Handler[]>();
  const canvas = {
    style: { cursor: '' },
    addEventListener: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
  };
  const fire = (name: string, e: Record<string, unknown>): void => {
    for (const fn of handlers.get(name) ?? []) fn(e);
  };
  return { canvas, fire };
}

/** Un punto logico 1280x720 nel canvas finto, largo la metà. */
const css = (x: number, y: number) => ({ clientX: x / 2, clientY: y / 2 });

describe('mouse clicks', () => {
  function setup(screen: ScreenName = 'title', ignore = (_p: { x: number; y: number }) => false) {
    const { canvas, fire } = fakeCanvas();
    let focused = 0;
    const win = Object.assign(new EventTarget(), { focus: () => void focused++ });
    const mouse = createMouseClicks({ win, canvas: canvas as unknown as Parameters<typeof createMouseClicks>[0]['canvas'], screen: () => screen, ignore });
    return { mouse, fire, canvas, focused: () => focused };
  }

  test('a left mouse press gives its logical point once, and focuses the window', () => {
    const { mouse, fire, focused } = setup();
    fire('pointerdown', { pointerType: 'mouse', button: 0, ...css(640, 300) });
    expect(focused()).toBe(1);
    expect(mouse.poll()).toEqual({ x: 640, y: 300 });
    expect(mouse.poll()).toBeNull();
  });

  test('two clicks in the same frame both count, one per tick', () => {
    const { mouse, fire } = setup();
    fire('pointerdown', { pointerType: 'mouse', button: 0, ...css(100, 100) });
    fire('pointerdown', { pointerType: 'mouse', button: 0, ...css(200, 200) });
    expect(mouse.poll()).toEqual({ x: 100, y: 100 });
    expect(mouse.poll()).toEqual({ x: 200, y: 200 });
    expect(mouse.poll()).toBeNull();
  });

  test('fingers, the pen and the other mouse buttons give nothing: no double event with touch.ts', () => {
    const { mouse, fire } = setup();
    fire('pointerdown', { pointerType: 'touch', button: 0, ...css(640, 300) });
    fire('pointerdown', { pointerType: 'pen', button: 0, ...css(640, 300) });
    fire('pointerdown', { pointerType: 'mouse', button: 2, ...css(640, 300) });
    expect(mouse.poll()).toBeNull();
  });

  test('a press on a link, fullscreen or SHARE stays with them', () => {
    const { mouse, fire } = setup('title', (p) => p.y > 680);
    fire('pointerdown', { pointerType: 'mouse', button: 0, ...css(60, 700) });
    expect(mouse.poll()).toBeNull();
  });

  test('the pointer is a hand where a click does something', () => {
    const { fire, canvas } = setup('title');
    fire('pointermove', { pointerType: 'mouse', ...css(640, 300) });
    expect(canvas.style.cursor).toBe('pointer');
    const race = setup('race');
    race.fire('pointermove', { pointerType: 'mouse', ...css(640, 300) });
    expect(race.canvas.style.cursor).toBe('');
  });
});

describe('a click on the title and on the TOP 10', () => {
  test('title: a click goes to the radio, like ENTER', () => {
    const r = stepTitle(initialTitleState(), 1 / 60, { ...emptyActions(), click: { x: 640, y: 300 } });
    expect(r.transition).toEqual(go('radio', undefined));
  });

  test('title: no click, no start', () => {
    expect(stepTitle(initialTitleState(), 1 / 60, { ...emptyActions(), click: null }).transition).toBeNull();
  });

  test('TOP 10 from the attract cycle: a click goes back to the title', () => {
    const r = stepScores({ t: 0 }, 1 / 60, { ...emptyActions(), click: { x: 10, y: 10 } });
    expect(r.transition).toEqual(go('title', undefined));
  });
});

describe('a click on the radio', () => {
  const rowCentre = (i: number) => ({ x: 640, y: RADIO_LIST_Y + i * RADIO_ROW_STEP + 8 });
  const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  test('targets: a song, the car, the mode, and elsewhere the start', () => {
    expect(radioClickTarget('keyboard', 0, 3, rowCentre(2))).toEqual({ kind: 'song', index: 2 });
    expect(radioClickTarget('keyboard', 0, 3, rowCentre(0))).toEqual({ kind: 'song', index: 0 });
    expect(radioClickTarget('keyboard', 0, 3, centre(RADIO_CAR_RECT))).toEqual({ kind: 'car' });
    expect(radioClickTarget('keyboard', 0, 3, centre(RADIO_MODE_RECT))).toEqual({ kind: 'mode' });
    expect(radioClickTarget('keyboard', 0, 3, { x: 640, y: 560 })).toEqual({ kind: 'start' });
  });

  test('with the phone layout, its buttons count too', () => {
    const at = (id: string) => centre(touchLayout('radio', { tiltAvailable: true, tiltOn: false, cssPerLogical: 1 }).find((b) => b.id === id)!.rect);
    expect(radioClickTarget('touch', 0, 3, at('back'))).toEqual({ kind: 'back' });
    expect(radioClickTarget('touch', 0, 3, at('tilt'))).toEqual({ kind: 'none' });
    expect(radioClickTarget('touch', 0, 3, at('prev'))).toEqual({ kind: 'song', index: 2 });
    expect(radioClickTarget('touch', 0, 3, at('next'))).toEqual({ kind: 'song', index: 1 });
    expect(radioClickTarget('touch', 0, 3, at('start'))).toEqual({ kind: 'start' });
  });

  function radio() {
    const played: number[] = [];
    const audio: AudioBus = {
      unlock() {},
      playSong: (i: number) => void played.push(i),
      stopSong() {},
      sfx() {},
      setEngine() {},
      setSkid() {},
      setRumble() {},
      toggleMute: () => false,
      muted: false,
      available: true,
    };
    const car = createCarSetting();
    const mode = createModeSetting();
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio,
      scores: createScoresStore(),
      car,
      mode,
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    };
    const screen = createRadioScreen(deps);
    screen.enter();
    const click = (p: { x: number; y: number }) => screen.update(1 / 60, { ...emptyActions(), click: p });
    return { played, car, mode, click };
  }

  test('a click on a song selects it and plays it, and does not start; a second click on it does not start either', () => {
    const { played, click } = radio();
    expect(click(rowCentre(2))).toBeNull();
    expect(click(rowCentre(2))).toBeNull();
    expect(played).toEqual([0, 2]);
  });

  test('a click on the car changes it, on the mode changes it', () => {
    const { car, mode, click } = radio();
    const c0 = car.get();
    const m0 = mode.get();
    expect(click(centre(RADIO_CAR_RECT))).toBeNull();
    expect(click(centre(RADIO_MODE_RECT))).toBeNull();
    expect(car.get()).not.toBe(c0);
    expect(mode.get()).not.toBe(m0);
  });

  test('a click elsewhere starts the race with the selected song', () => {
    const { click } = radio();
    click(rowCentre(1));
    expect(click({ x: 640, y: 600 })).toEqual(go('race', { song: 1 }));
  });
});
