import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createNullAudio } from '../../../src/dev/null-audio';
import { createFakeRace } from '../../../src/dev/fake-race';
import { createEndingsStore } from '../../../src/persist/endings';
import { createScoresStore } from '../../../src/persist/scores';
import type { ScreenDeps } from '../../../src/ui/deps';
import { createEndingScreen, newEndingLine, NEW_ENDING_X, NEW_ENDING_Y } from '../../../src/ui/screens/ending';
import {
  cardRect,
  createEndingsScreen,
  ENDINGS_BACK_RECT,
  ENDINGS_VIEW_RECT,
  endingsCount,
  initialEndingsState,
  stepEndings,
} from '../../../src/ui/screens/endings';
import { createScoresScreen, SCORES_ENDINGS_RECT, wantsEndings } from '../../../src/ui/screens/scores';
import { createTitleScreen, endingsButtonLabel, stepTitle, initialTitleState } from '../../../src/ui/screens/title';
import { ENDINGS_RECT } from '../../../src/ui/titleLayout';
import { touchLayout } from '../../../src/ui/touch';
import { MENU_RECT } from '../../../src/ui/retryMenu';
import type { Actions, StageDef } from '../../../src/types';
import { createRecordCtx } from '../../helpers/recordCtx';

const stage: StageDef = { id: '4-2', name: 'Harbour', theme: 'town', lengthSegments: 100, timeLimit: 80, seed: 1, difficulty: 0.9 };
const act = (over: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...over });
const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function deps(over: Partial<ScreenDeps> = {}): ScreenDeps {
  return {
    assets: createEmptyAssets(),
    audio: createNullAudio(),
    scores: createScoresStore(),
    raceFactory: (s, a) => createFakeRace(s, a),
    renderWorld: () => {},
    firstStage: { ...stage, id: '0-0', theme: 'beach' },
    ...over,
  };
}

describe('pagina ENDINGS (spec telefono e finali §C)', () => {
  test('five cards side by side inside the screen, and the count', () => {
    expect(endingsCount(2)).toBe('2 / 5');
    for (let i = 0; i < 5; i++) {
      const r = cardRect(i);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1280);
      if (i > 0) expect(r.x).toBeGreaterThan(cardRect(i - 1).x + cardRect(i - 1).w);
    }
  });

  test('left, right or MAP switch the view; BACK, ESC or ENTER go back to the title', () => {
    let s = initialEndingsState();
    // Il tasto che ha aperto la pagina non cambia vista.
    s = stepEndings(s, act({ right: true }), null).state;
    expect(s.view).toBe('endings');
    s = stepEndings(s, act(), null).state;
    s = stepEndings(s, act({ right: true }), null).state;
    expect(s.view).toBe('map');
    s = stepEndings(s, act(), centre(ENDINGS_VIEW_RECT)).state;
    expect(s.view).toBe('endings');
    expect(stepEndings(s, act({ back: true }), null).transition?.to).toBe('title');
    expect(stepEndings(s, act({ confirm: true }), null).transition?.to).toBe('title');
    expect(stepEndings(s, act(), centre(ENDINGS_BACK_RECT)).transition?.to).toBe('title');
    expect(stepEndings(s, act(), { x: 640, y: 300 }).transition).toBeNull();
  });

  test('seen endings show their image, the others a lock: nothing seen means all locked, without storage too', () => {
    // I lucchetti: il corpo giallo largo 80 di ogni carta chiusa.
    const locks = (screenDeps: ScreenDeps): number => {
      const screen = createEndingsScreen(screenDeps);
      screen.enter(undefined);
      const rec = createRecordCtx();
      screen.render(rec.ctx);
      return rec.fills().filter((op) => op.fill === '#ffcc33' && op.args[2] === 80).length;
    };
    expect(locks(deps())).toBe(5);
    expect(locks(deps({ endings: createEndingsStore() }))).toBe(5);
    const store = createEndingsStore();
    store.recordEnding(1);
    store.recordEnding(4);
    expect(locks(deps({ endings: store }))).toBe(3);
  });
});

describe('come si arriva alla pagina', () => {
  test('from the title: the ENDINGS entry by finger, by click, or third choice of up and down', () => {
    expect(endingsButtonLabel(0)).toBe('ENDINGS 0 / 5');
    expect(stepTitle(initialTitleState(), 1 / 60, act({ endings: true }), true).transition?.to).toBe('endings');
    expect(stepTitle(initialTitleState(), 1 / 60, act({ click: centre(ENDINGS_RECT) }), true).transition?.to).toBe('endings');
    let s = stepTitle(initialTitleState(), 1 / 60, act(), true).state;
    for (const choice of ['daily', 'endings', 'start']) {
      s = stepTitle(s, 1 / 60, act({ brake: true }), true).state;
      expect(s.choice).toBe(choice);
      s = stepTitle(s, 1 / 60, act(), true).state;
    }
    s = stepTitle(s, 1 / 60, act({ accelerate: true }), true).state;
    expect(s.choice).toBe('endings');
    expect(stepTitle(s, 1 / 60, act({ confirm: true }), true).transition?.to).toBe('endings');
    // Il dito ha la sua area, sopra a tutto il resto.
    expect(touchLayout('title', { tiltAvailable: false, tiltOn: false }).find((b) => b.id === 'endings')?.action).toBe('endings');
  });

  test('the title shows ENDINGS n / 5 even with no ending seen', () => {
    const screen = createTitleScreen(deps({ endings: createEndingsStore() }));
    screen.enter(undefined);
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    // La cornice del pulsante nel suo riquadro.
    expect(rec.fills().some((op) => op.args[0] === ENDINGS_RECT.x && op.args[1] === ENDINGS_RECT.y && op.args[2] === ENDINGS_RECT.w)).toBe(true);
  });

  test('from the TOP 10: the button (not over MENU), C or Y', () => {
    expect(SCORES_ENDINGS_RECT.x).toBeGreaterThan(MENU_RECT.x + MENU_RECT.w);
    expect(wantsEndings(act({ gearToggle: true }), null)).toBe(true);
    expect(wantsEndings(act(), centre(SCORES_ENDINGS_RECT))).toBe(true);
    expect(wantsEndings(act(), { x: 640, y: 300 })).toBe(false);
    const screen = createScoresScreen(deps());
    screen.enter(undefined);
    expect(screen.update(1 / 60, act({ gearToggle: true }))?.to).toBe('endings');
    expect(screen.update(1 / 60, act({ click: centre(SCORES_ENDINGS_RECT) }))?.to).toBe('endings');
  });
});

describe('NEW ENDING! a fine partita', () => {
  test('only the first time an ending is seen, with the new count; the stages reached are recorded too', () => {
    const store = createEndingsStore();
    store.recordEnding(0);
    const yellowAt = (screen: ReturnType<typeof createEndingScreen>): boolean => {
      const rec = createRecordCtx();
      screen.render(rec.ctx);
      return rec.fills().some((op) => op.fill === '#ffee55' && op.args[0] >= NEW_ENDING_X && op.args[0] < NEW_ENDING_X + 30 && Math.abs(op.args[1] - NEW_ENDING_Y) < 30);
    };
    const screen = createEndingScreen(deps({ endings: store }));
    screen.enter({ score: 100, ending: 2, stage, route: ['R', 'R', 'L', 'R'] });
    expect(newEndingLine(2)).toBe('NEW ENDING! 2 / 5');
    expect(yellowAt(screen)).toBe(true);
    expect(store.load().seen).toEqual([1, 3]);
    expect(store.load().stages).toEqual(['0-0', '1-1', '2-2', '3-2', '4-3']);
    screen.enter({ score: 100, ending: 2, stage, route: ['R', 'R', 'L', 'R'] });
    expect(yellowAt(screen)).toBe(false);
  });
});
