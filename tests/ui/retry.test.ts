// RETRY a fine partita: il menu da solo, poi la partita intera nell'app
// (motore finto): dopo un game over, dopo un finale e dopo le iniziali,
// RETRY riparte subito in gara con la stessa auto, lo stesso brano e la
// stessa modalità, senza passare dal titolo né dalla radio. MENU ed Esc
// tornano al titolo.

import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createFakeRace, FAKE_CHECKPOINT_EVERY_S, FAKE_CHECKPOINTS_TO_FINISH } from '../../src/dev/fake-race';
import { renderFakeWorld } from '../../src/dev/fake-world';
import { createNullAudio } from '../../src/dev/null-audio';
import { createScoresStore, type ScoresStore } from '../../src/persist/scores';
import { createCarSetting } from '../../src/persist/car';
import { createModeSetting } from '../../src/persist/mode';
import { createApp } from '../../src/ui/app';
import { gameOverLines } from '../../src/ui/screens/gameOver';
import { STAGES } from '../../src/game/stages';
import {
  bestLine,
  isNewBest,
  personalBest,
  CONTINUE_RECT,
  initialRetryMenu,
  MENU_RECT,
  RETRY_INPUT_DELAY_S,
  RETRY_RECT,
  stepRetryMenu,
} from '../../src/ui/retryMenu';
import { createRecordCtx } from '../helpers/recordCtx';
import type { ScreenDeps } from '../../src/ui/deps';
import type { Actions, StageDef } from '../../src/types';
import type { Rect } from '../../src/ui/rect';

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const ready = { ...initialRetryMenu(), t: RETRY_INPUT_DELAY_S };
const act = (a: Partial<Actions>): Actions => ({ ...emptyActions(), ...a });

describe('the RETRY menu', () => {
  test('RETRY is selected: ENTER retries', () => {
    expect(stepRetryMenu(ready, 1 / 60, act({ confirm: true })).chosen).toBe('retry');
  });

  test('left or right moves to MENU and back; Esc is MENU', () => {
    let s = stepRetryMenu(ready, 1 / 60, act({ right: true })).state;
    expect(s.choice).toBe('menu');
    expect(stepRetryMenu(s, 1 / 60, act({ right: true })).state.choice).toBe('menu'); // tenuto: niente
    s = stepRetryMenu(s, 1 / 60, act({})).state;
    expect(stepRetryMenu(s, 1 / 60, act({ confirm: true })).chosen).toBe('menu');
    s = stepRetryMenu(s, 1 / 60, act({ left: true })).state;
    expect(s.choice).toBe('retry');
    expect(stepRetryMenu(ready, 1 / 60, act({ back: true })).chosen).toBe('menu');
  });

  test('a tap or a click picks the button under it; elsewhere it picks nothing, and ENTER of the same tick does not count', () => {
    expect(stepRetryMenu(ready, 1 / 60, act({}), centre(RETRY_RECT)).chosen).toBe('retry');
    expect(stepRetryMenu(ready, 1 / 60, act({ confirm: true }), centre(MENU_RECT)).chosen).toBe('menu');
    expect(stepRetryMenu(ready, 1 / 60, act({ confirm: true }), { x: 640, y: 300 }).chosen).toBeNull();
  });

  test('for half a second after it opens nothing counts (A of the pad is also the gas)', () => {
    expect(stepRetryMenu(initialRetryMenu(), 1 / 60, act({ confirm: true })).chosen).toBeNull();
    expect(stepRetryMenu(initialRetryMenu(), 1 / 60, act({}), centre(RETRY_RECT)).chosen).toBeNull();
  });

  test('the buttons stay clear of SHARE, of the ending map and of the screen edge', () => {
    const share: Rect = { x: 36, y: 632, w: 196, h: 52 };
    const endingMap: Rect = { x: 1020, y: 545, w: 240, h: 150 };
    const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    for (const r of [RETRY_RECT, MENU_RECT, CONTINUE_RECT]) {
      expect(overlaps(r, share)).toBe(false);
      expect(overlaps(r, endingMap)).toBe(false);
      expect(r.y + r.h).toBeLessThanOrEqual(720);
      expect(r.h).toBeGreaterThanOrEqual(80);
    }
    expect(RETRY_RECT.w).toBeGreaterThan(MENU_RECT.w);
  });
});

const stage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 2260, timeLimit: 5, seed: 1, difficulty: 0.15 };

interface Rig {
  app: ReturnType<typeof createApp>;
  songs: number[];
  races: { car: string; mode: string }[];
  deps: ScreenDeps;
  taps: { x: number; y: number }[];
}

/** L'app con il motore finto: `timeLimit` corto per il game over, lungo per arrivare al finale. */
function rig(timeLimit: number, scores: ScoresStore = createScoresStore()): Rig {
  const songs: number[] = [];
  const races: { car: string; mode: string }[] = [];
  const taps: { x: number; y: number }[] = [];
  const car = createCarSetting();
  const mode = createModeSetting();
  const audio = createNullAudio();
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
    audio: { ...audio, playSong: (i: number) => void songs.push(i) },
    scores,
    car,
    mode,
    raceFactory: (s, a) => {
      races.push({ car: car.get(), mode: mode.get() });
      return createFakeRace({ ...s, timeLimit }, a);
    },
    // La strada del titolo non conta come gara.
    attractFactory: (s, a) => createFakeRace(s, a),
    renderWorld: renderFakeWorld,
    firstStage: stage,
    signals: { takeTap: () => taps.shift() ?? null, takeFocusLost: () => false },
    now: () => 0,
  };
  return { app: createApp(deps), songs, races, deps, taps };
}

/** Dal titolo alla gara, col secondo brano, l'altra auto e l'altra modalità. */
function startWithChoices(r: Rig): void {
  r.app.update(1 / 60, act({ confirm: true }));
  expect(r.app.name).toBe('radio');
  r.app.update(1 / 60, act({ right: true }));
  r.app.update(1 / 60, act({}));
  r.app.update(1 / 60, act({ right: true })); // brano 2
  r.app.update(1 / 60, act({ gearToggle: true })); // l'auto dopo
  r.app.update(1 / 60, act({ modeToggle: true })); // HARD
  r.app.update(1 / 60, act({ confirm: true }));
  expect(r.app.name).toBe('race');
}

const never: ScoresStore = { load: () => [], qualifies: () => false, insert: () => -1, clear: () => {} };

describe('RETRY in the whole game', () => {
  test('after a game over: RETRY races again at once, same car, same song, same mode', () => {
    const r = rig(5, never);
    startWithChoices(r);
    for (let i = 0; i < 8 && r.app.name === 'race'; i++) r.app.update(1, act({}));
    expect(r.app.name).toBe('gameOver');
    const songsBefore = r.songs.length;
    r.app.update(RETRY_INPUT_DELAY_S, act({}));
    r.app.update(1 / 60, act({ confirm: true }));
    expect(r.app.name).toBe('race');
    expect(r.races).toHaveLength(2);
    expect(r.races[1]).toEqual(r.races[0]);
    expect(r.races[1]).not.toEqual({ car: createCarSetting().get(), mode: createModeSetting().get() });
    expect(r.songs.slice(songsBefore)).toEqual([2]);
  });

  test('after an ending: RETRY by a click on the button', () => {
    const r = rig(200, never);
    startWithChoices(r);
    for (let t = 0; t <= FAKE_CHECKPOINT_EVERY_S * FAKE_CHECKPOINTS_TO_FINISH + 1 && r.app.name === 'race'; t++) r.app.update(1, act({}));
    expect(r.app.name).toBe('ending');
    r.app.update(RETRY_INPUT_DELAY_S, act({}));
    r.taps.push(centre(RETRY_RECT));
    r.app.update(1 / 60, act({}));
    expect(r.app.name).toBe('race');
    expect(r.races[1]).toEqual(r.races[0]);
    expect(r.songs[r.songs.length - 1]).toBe(2);
  });

  test('a record: first the initials, then RETRY on the TOP 10', () => {
    const r = rig(5);
    startWithChoices(r);
    for (let i = 0; i < 8 && r.app.name === 'race'; i++) r.app.update(1, act({}));
    expect(r.app.name).toBe('gameOver');
    // CONTINUE (ENTER) porta alle iniziali.
    r.app.update(1 / 60, act({ confirm: true }));
    expect(r.app.name).toBe('nameEntry');
    r.app.update(1 / 60, act({}));
    for (let i = 0; i < 3; i++) {
      r.app.update(1 / 60, act({ right: true }));
      r.app.update(1 / 60, act({}));
    }
    expect(r.app.name).toBe('scores');
    expect(r.deps.scores.load()).toHaveLength(1);
    // La TOP 10 dopo le iniziali non torna da sola al titolo.
    r.app.update(30, act({}));
    expect(r.app.name).toBe('scores');
    r.app.update(1 / 60, act({ confirm: true }));
    expect(r.app.name).toBe('race');
    expect(r.races[1]).toEqual(r.races[0]);
    expect(r.songs[r.songs.length - 1]).toBe(2);
  });

  test('MENU, by a click, goes back to the title', () => {
    const r = rig(5, never);
    startWithChoices(r);
    for (let i = 0; i < 8 && r.app.name === 'race'; i++) r.app.update(1, act({}));
    r.app.update(RETRY_INPUT_DELAY_S, act({}));
    r.taps.push(centre(MENU_RECT));
    r.app.update(1 / 60, act({}));
    expect(r.app.name).toBe('title');
  });

  test('the game over draws RETRY and MENU, or CONTINUE when the initials come first', () => {
    const draws = (scores: ScoresStore) => {
      const r = rig(5, scores);
      startWithChoices(r);
      for (let i = 0; i < 8 && r.app.name === 'race'; i++) r.app.update(1, act({}));
      const rec = createRecordCtx();
      r.app.update(1, act({})); // oltre la tendina
      r.app.render(rec.ctx);
      return (rect: Rect) => rec.fills().some((op) => op.args[0] === rect.x && op.args[1] === rect.y && op.args[2] === rect.w);
    };
    const plain = draws(never);
    expect(plain(RETRY_RECT)).toBe(true);
    expect(plain(MENU_RECT)).toBe(true);
    expect(plain(CONTINUE_RECT)).toBe(false);
    const record = draws(createScoresStore());
    expect(record(CONTINUE_RECT)).toBe(true);
    expect(record(RETRY_RECT)).toBe(false);
  });
});

describe('the personal best at the end of a game', () => {
  test('the best is the top of the local TOP 10, 0 when empty', () => {
    expect(personalBest([])).toBe(0);
    expect(personalBest([{ score: 300 }, { score: 9000 }, { score: 12 }])).toBe(9000);
  });

  test('NEW BEST! when the score beats it, BEST otherwise; never a time', () => {
    expect(isNewBest(9001, 9000)).toBe(true);
    expect(isNewBest(9000, 9000)).toBe(false);
    expect(bestLine(9001, 9000)).toBe('NEW BEST!');
    expect(bestLine(500, 9000)).toBe('BEST 9000');
    expect(bestLine(500, 9000)).not.toMatch(/\bS\b|SEC|TIME/);
  });

  test('the game over writes the best next to the score, and the stage reached under it', () => {
    const stage = STAGES.get('2-1')!;
    const lines = gameOverLines({ score: 1200, stage, route: ['L', 'R'] }, 5000);
    expect(lines.score).toBe('SCORE 1200   BEST 5000');
    expect(lines.stage).toBe('STAGE 3  PINE PASS');
    expect(gameOverLines({ score: 6000, stage, route: [] }, 5000).score).toBe('SCORE 6000   NEW BEST!');
  });

  test('the ending writes the stage and the best above RETRY', () => {
    const scores = createScoresStore();
    scores.insert({ name: 'AAA', score: 99999, stageId: '0-0', route: '', date: '' });
    const r = rig(200, { ...scores, qualifies: () => false });
    startWithChoices(r);
    for (let t = 0; t <= FAKE_CHECKPOINT_EVERY_S * FAKE_CHECKPOINTS_TO_FINISH + 1 && r.app.name === 'race'; t++) r.app.update(1, act({}));
    expect(r.app.name).toBe('ending');
    r.app.update(1, act({}));
    const rec = createRecordCtx();
    r.app.render(rec.ctx);
    // Il testo bitmap è fatto di fillRect: righe gialle a scala 3 appena sopra RETRY.
    const bestRow = rec.fills().filter((op) => op.fill === '#ffee55' && op.args[1] >= RETRY_RECT.y - 36 && op.args[1] < RETRY_RECT.y - 12);
    expect(bestRow.length).toBeGreaterThan(0);
  });
});
