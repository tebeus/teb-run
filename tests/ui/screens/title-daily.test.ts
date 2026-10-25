// Il titolo con DAILY CHALLENGE (spec §3.3): ENTER e il clic fuori dal
// pulsante partono come sempre; su e giù scelgono DAILY, poi ENTER; un clic o
// un tocco sul pulsante vanno alla sfida. Il titolo chiude la sessione DAILY.

import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createFakeRace } from '../../../src/dev/fake-race';
import { createNullAudio } from '../../../src/dev/null-audio';
import { createScoresStore } from '../../../src/persist/scores';
import { dailyChallenge } from '../../../src/shared/daily';
import { createDailySession } from '../../../src/ui/dailySession';
import { ATTRACT_PHASE_S, createTitleScreen, initialTitleState, PRESS_ENTER_Y, stepTitle, type TitleState } from '../../../src/ui/screens/title';
import { DAILY_RECT } from '../../../src/ui/titleLayout';
import { buttonAt, touchLayout } from '../../../src/ui/touch';
import { LOGICAL_W } from '../../../src/core/canvas';
import type { Actions } from '../../../src/types';
import type { ScreenDeps } from '../../../src/ui/deps';

const act = (a: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...a });
const step = (s: TitleState, a: Partial<Actions>) => stepTitle(s, 1 / 60, act(a), true);
const inDaily = { x: DAILY_RECT.x + 20, y: DAILY_RECT.y + 20 };

describe('title: DAILY CHALLENGE', () => {
  test('ENTER starts as always; down then ENTER goes to the daily challenge; down again back to START', () => {
    let s = step(initialTitleState(), {}).state;
    expect(step(s, { confirm: true }).transition?.to).toBe('radio');
    s = step(s, { brake: true }).state;
    expect(s.choice).toBe('daily');
    expect(step(s, { confirm: true }).transition?.to).toBe('daily');
    s = step(s, {}).state;
    s = step(s, { accelerate: true }).state;
    expect(s.choice).toBe('start');
  });

  test('held keys do not repeat: one press, one change', () => {
    let s = step(initialTitleState(), {}).state;
    s = step(s, { brake: true }).state;
    s = step(s, { brake: true }).state;
    s = step(s, { brake: true }).state;
    expect(s.choice).toBe('daily');
  });

  test('pad A (gas and confirm together) starts the selected item, it does not move the choice', () => {
    const s = step(initialTitleState(), {}).state;
    expect(step(s, { accelerate: true, confirm: true }).transition?.to).toBe('radio');
  });

  test('a click on the button goes to the challenge, anywhere else starts', () => {
    const s = initialTitleState();
    expect(step(s, { click: inDaily }).transition?.to).toBe('daily');
    expect(step(s, { click: { x: 100, y: 200 } }).transition?.to).toBe('radio');
  });

  test('a finger on the button (touch layout) goes to the challenge; elsewhere starts', () => {
    const layout = touchLayout('title', { tiltAvailable: false, tiltOn: false, cssPerLogical: 1 } as never);
    expect(buttonAt(layout, inDaily, 1)?.action).toBe('daily');
    expect(buttonAt(layout, { x: 640, y: 200 }, 1)?.action).toBe('confirm');
    expect(step(initialTitleState(), { daily: true }).transition?.to).toBe('daily');
  });

  test('in the map phase the button is not there: a tap or click on its place starts, as before', () => {
    const s: TitleState = { ...initialTitleState(), idleT: ATTRACT_PHASE_S * 2 + 1 };
    expect(step(s, { daily: true }).transition?.to).toBe('radio');
    expect(step(s, { click: inDaily }).transition?.to).toBe('radio');
  });

  test('without the daily challenge (no session) the title is the one of before', () => {
    let s = stepTitle(initialTitleState(), 1 / 60, act(), false).state;
    s = stepTitle(s, 1 / 60, act({ brake: true }), false).state;
    expect(stepTitle(s, 1 / 60, act({ confirm: true }), false).transition?.to).toBe('radio');
    expect(stepTitle(s, 1 / 60, act({ click: inDaily }), false).transition?.to).toBe('radio');
  });

  test('layout: under the start line, above the links band, inside the screen, big enough for a thumb', () => {
    expect(DAILY_RECT.y).toBeGreaterThan(PRESS_ENTER_Y + 3 * 8 + 8);
    expect(DAILY_RECT.y + DAILY_RECT.h).toBeLessThanOrEqual(630);
    expect(DAILY_RECT.x).toBeGreaterThan(0);
    expect(DAILY_RECT.x + DAILY_RECT.w).toBeLessThan(LOGICAL_W);
    // Sul telefono più piccolo (667 px CSS per 1280 logici) resta oltre 44 px CSS.
    expect(DAILY_RECT.h * (667 / LOGICAL_W)).toBeGreaterThanOrEqual(44);
  });

  test('entering the title closes the daily session', () => {
    const daily = createDailySession();
    daily.start(dailyChallenge('2026-10-25'));
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: createNullAudio(),
      scores: createScoresStore(),
      raceFactory: (s, a) => createFakeRace(s, a),
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 100, timeLimit: 80, seed: 1, difficulty: 0.15 },
      daily,
    };
    createTitleScreen(deps).enter(undefined);
    expect(daily.current()).toBeNull();
  });
});
