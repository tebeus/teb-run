import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createScoresStore } from '../../../src/persist/scores';
import {
  createNameEntryScreen,
  NAME_ENTRY_TIMEOUT_S,
  parseNameEntryPayload,
  stepNameEntry,
  type NameEntryState,
} from '../../../src/ui/screens/nameEntry';
import { go } from '../../../src/ui/fsm';
import type { ScreenDeps } from '../../../src/ui/deps';
import { LOGICAL_W } from '../../../src/core/canvas';
import { createRecordCtx } from '../../helpers/recordCtx';

function initial(): NameEntryState {
  return {
    letters: ['A', 'A', 'A'],
    cursor: 0,
    t: 0,
    prevUp: false,
    prevDown: false,
    prevAdvance: false,
    // seeded: true because these fixtures represent a screen already
    // running past its first tick; the "seed the first tick" behaviour is
    // exercised separately below via createNameEntryScreen, which starts
    // unseeded the way `enter()` really does.
    seeded: true,
    payload: { score: 100, stageId: '0-0', route: ['L'] },
    done: false,
  };
}

describe('stepNameEntry: letter cycling', () => {
  test('accelerate cycles the current letter forward, once per press', () => {
    let state = initial();
    let r = stepNameEntry(state, 1 / 60, { ...emptyActions(), accelerate: true });
    state = r.state;
    expect(state.letters[0]).toBe('B');
    r = stepNameEntry(state, 1 / 60, { ...emptyActions(), accelerate: true }); // held: no repeat
    state = r.state;
    expect(state.letters[0]).toBe('B');
  });

  test('brake cycles the current letter backward and wraps Z -> A vs A -> Z', () => {
    let state: NameEntryState = { ...initial(), letters: ['A', 'A', 'A'] };
    let r = stepNameEntry(state, 1 / 60, { ...emptyActions(), brake: true });
    expect(r.state.letters[0]).toBe('Z');
  });
});

describe('stepNameEntry: cursor and commit', () => {
  test('right advances the cursor, once per press, without committing before the third letter', () => {
    let state = initial();
    let r = stepNameEntry(state, 1 / 60, { ...emptyActions(), right: true });
    state = r.state;
    expect(state.cursor).toBe(1);
    expect(r.commit).toBe(false);

    r = stepNameEntry(state, 1 / 60, { ...emptyActions(), right: true }); // held: no repeat
    state = r.state;
    expect(state.cursor).toBe(1);
  });

  test('confirming the third letter commits, marking done', () => {
    let state: NameEntryState = { ...initial(), cursor: 2 };
    const r = stepNameEntry(state, 1 / 60, { ...emptyActions(), confirm: true });
    expect(r.commit).toBe(true);
    expect(r.state.done).toBe(true);
  });

  test('after done, further steps are no-ops: no repeated commit', () => {
    let state: NameEntryState = { ...initial(), cursor: 2, done: true };
    const r = stepNameEntry(state, 1 / 60, { ...emptyActions(), confirm: true });
    expect(r.commit).toBe(false);
  });

  test('a 30 second timeout commits whatever name was reached, even mid-entry', () => {
    let state = initial();
    // change only the first letter, then let the timer run out without advancing
    state = stepNameEntry(state, 1 / 60, { ...emptyActions(), accelerate: true }).state;
    state = stepNameEntry(state, 1 / 60, emptyActions()).state; // release accelerate
    let commit = false;
    for (let i = 0; i < NAME_ENTRY_TIMEOUT_S * 60; i++) {
      const r = stepNameEntry(state, 1 / 60, emptyActions());
      state = r.state;
      if (r.commit) commit = true;
    }
    expect(commit).toBe(true);
    expect(state.letters).toEqual(['B', 'A', 'A']);
  });
});

describe('stepNameEntry: no phantom advance on entry', () => {
  test('a key already held on the very first observed tick is not treated as a fresh press', () => {
    // Simulates a player still holding RIGHT from the ending/game-over
    // screen when nameEntry.enter() runs: initialNameEntryState() sets
    // seeded: false, so this first tick must not consume the held key as
    // an advance.
    let state: NameEntryState = { ...initial(), seeded: false };
    let r = stepNameEntry(state, 1 / 60, { ...emptyActions(), right: true }); // held over, must not advance
    state = r.state;
    expect(state.cursor).toBe(0);
    expect(r.commit).toBe(false);

    r = stepNameEntry(state, 1 / 60, emptyActions()); // release
    state = r.state;
    r = stepNameEntry(state, 1 / 60, { ...emptyActions(), right: true }); // first real press
    state = r.state;
    expect(state.cursor).toBe(1);
  });
});

describe('parseNameEntryPayload', () => {
  test('passes through a well-formed payload', () => {
    expect(parseNameEntryPayload({ score: 10, stageId: '1-0', route: ['L'] })).toEqual({
      score: 10,
      stageId: '1-0',
      route: ['L'],
    });
  });

  test('defaults missing or malformed fields', () => {
    expect(parseNameEntryPayload(undefined)).toEqual({ score: 0, stageId: '', route: [] });
  });
});

describe('createNameEntryScreen', () => {
  test('inserts the entered name into scores on commit, with route joined by spaces, and highlights its rank', () => {
    const scores = createScoresStore();
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
      scores,
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    };
    const screen = createNameEntryScreen(deps);
    screen.enter({ score: 4200, stageId: '3-2', route: ['L', 'R', 'L'] });

    // The very first tick after entry seeds the edge-detection state (see
    // stepNameEntry), so it must be a clear tick before real presses count.
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), right: true });
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), right: true });
    screen.update(1 / 60, emptyActions());
    const t = screen.update(1 / 60, { ...emptyActions(), right: true });

    expect(t).toEqual(go('scores', { highlight: 0, retry: { song: 0 } }));
    expect(scores.load()).toEqual([
      { name: 'AAA', score: 4200, stageId: '3-2', route: 'L R L', date: expect.any(String) },
    ]);
  });

  test('highlight is undefined when the score does not make the top 10', () => {
    const scores = createScoresStore();
    for (let i = 0; i < 10; i++) {
      scores.insert({ name: `P${i}`, score: 1000 - i, stageId: '0-0', route: '', date: '2026-01-01T00:00:00.000Z' });
    }
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
      scores,
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    };
    const screen = createNameEntryScreen(deps);
    screen.enter({ score: 1, stageId: '0-0', route: [] }); // too low to make the table

    // The very first tick after entry seeds the edge-detection state (see
    // stepNameEntry), so it must be a clear tick before real presses count.
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), right: true });
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), right: true });
    screen.update(1 / 60, emptyActions());
    const t = screen.update(1 / 60, { ...emptyActions(), right: true });

    expect(t).toEqual(go('scores', { highlight: undefined, retry: { song: 0 } }));
  });

  test('a key held over from the previous screen on entry does not shortcut the three-letter entry', () => {
    const scores = createScoresStore();
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
      scores,
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    };
    const screen = createNameEntryScreen(deps);
    screen.enter({ score: 4200, stageId: '3-2', route: ['L', 'R', 'L'] });

    // RIGHT is already held on the very first tick, as if carried over from
    // ending/game over's own confirm key. Without the fix, this alone would
    // advance the cursor and the entry would commit one press early.
    screen.update(1 / 60, { ...emptyActions(), right: true });
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), right: true }); // 1st real press
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), right: true }); // 2nd real press
    screen.update(1 / 60, emptyActions());
    const t = screen.update(1 / 60, { ...emptyActions(), right: true }); // 3rd real press: commits

    expect(t).toEqual(go('scores', { highlight: 0, retry: { song: 0 } }));
    expect(scores.load()).toEqual([
      { name: 'AAA', score: 4200, stageId: '3-2', route: 'L R L', date: expect.any(String) },
    ]);
  });

  test('renders without throwing', () => {
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
      scores: createScoresStore(),
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    };
    const screen = createNameEntryScreen(deps);
    screen.enter({ score: 1, stageId: '0-0', route: [] });
    const ctx = {
      fillRect() {},
      fillStyle: '',
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      drawImage() {},
    } as unknown as CanvasRenderingContext2D;
    expect(() => screen.render(ctx)).not.toThrow();
  });

  test('one cursor under the current letter, pointing up, inside a balanced save/restore', () => {
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: { unlock() {}, playSong() {}, stopSong() {}, sfx() {}, setEngine() {}, setSkid() {}, setRumble() {}, toggleMute: () => false, muted: false, available: true },
      scores: createScoresStore(),
      raceFactory: () => {
        throw new Error('unused');
      },
      renderWorld: () => {},
      firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    };
    const screen = createNameEntryScreen(deps);
    screen.enter({ score: 1, stageId: '0-0', route: [] });
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    expect(rec.images()).toHaveLength(1);
    expect(rec.ops.filter((op) => op.type === 'save')).toHaveLength(1);
    expect(rec.ops.filter((op) => op.type === 'restore')).toHaveLength(1);
    const rotate = rec.ops.find((op) => op.type === 'rotate');
    expect(rotate?.args[0]).toBeCloseTo(-Math.PI / 2, 9);
    // Prima lettera: il cursore sta sotto x = LOGICAL_W / 2 - 60.
    const translate = rec.ops.find((op) => op.type === 'translate');
    expect(translate?.args[0]).toBe(LOGICAL_W / 2 - 60);
  });
});
