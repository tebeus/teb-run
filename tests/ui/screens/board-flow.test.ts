// Iniziali e classifica mondiale (spec §2.7): le iniziali ripartono dalle
// ultime, la lista di blocco risponde subito, l'invio va in background con
// i dati giusti, la TOP 10 locale non prende le partite DAILY; la classifica
// mostra le pagine mondiali solo con i dati arrivati, la posizione appena
// arriva, e offline solo LOCAL.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createNullAudio } from '../../../src/dev/null-audio';
import { createInitialsMemory } from '../../../src/persist/daily';
import { createScoresStore } from '../../../src/persist/scores';
import { dailyChallenge } from '../../../src/shared/daily';
import { createDailySession } from '../../../src/ui/dailySession';
import { tabRects } from '../../../src/ui/scoresPages';
import { createRecordCtx } from '../../helpers/recordCtx';
import type { BoardClient, BoardName, BoardRow, SubmitResult } from '../../../src/net/types';
import type { RunBody } from '../../../src/shared/validate';
import type { Actions } from '../../../src/types';
import type { ScreenDeps } from '../../../src/ui/deps';

const drawn: string[] = [];
vi.mock('../../../src/ui/text', async (orig) => {
  const real = await orig<typeof import('../../../src/ui/text')>();
  return { ...real, drawText: (_c: unknown, t: string) => void drawn.push(t), drawTextOutlined: (_c: unknown, t: string) => void drawn.push(t) };
});
const { createNameEntryScreen, runBody, NAME_ENTRY_TIMEOUT_S } = await import('../../../src/ui/screens/nameEntry');
const { createScoresScreen, rankLine } = await import('../../../src/ui/screens/scores');

afterEach(() => {
  drawn.length = 0;
});

const act = (a: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...a });
const NOW = Date.parse('2026-10-24T12:00:00Z');

function fakeBoard(rows: Partial<Record<BoardName, BoardRow[]>> = {}) {
  const sent: { body: RunBody; board: BoardName }[] = [];
  let result: { status: 'pending' | 'done' | 'failed'; result?: SubmitResult } | null = null;
  const board: BoardClient = {
    top: (_m, b) => rows[b] ?? null,
    wouldQualify: () => null,
    submit: (body, b) => void sent.push({ body, board: b }),
    submitted: () => result,
    daily: () => null,
  };
  return { board, sent, arrive: (r: SubmitResult) => (result = { status: 'done', result: r }) };
}

function deps(over: Partial<ScreenDeps> = {}): ScreenDeps & { taps: { x: number; y: number }[] } {
  const taps: { x: number; y: number }[] = [];
  return {
    taps,
    assets: createEmptyAssets(),
    audio: createNullAudio(),
    scores: createScoresStore(),
    raceFactory: () => {
      throw new Error('unused');
    },
    renderWorld: () => {},
    firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    now: () => NOW,
    initials: createInitialsMemory(),
    signals: { takeTap: () => taps.shift() ?? null, takeFocusLost: () => false } as unknown as ScreenDeps['signals'],
    ...over,
  };
}

/** Conferma le tre lettere come sono (tre "avanti"). */
function confirmLetters(screen: ReturnType<typeof createNameEntryScreen>) {
  screen.update(1 / 60, act());
  let t = null;
  for (let i = 0; i < 3; i++) {
    t = screen.update(1 / 60, act({ right: true }));
    if (t === null) screen.update(1 / 60, act());
  }
  return t;
}

const finish = { score: 200_000, stageId: '4-2', route: ['R', 'L', 'R', 'L'] as ('L' | 'R')[], song: 1, time: 385.25, ending: 2 };

describe('name entry for the world board', () => {
  test('starts from the last initials', () => {
    const d = deps();
    d.initials!.set('TEB');
    const screen = createNameEntryScreen(d);
    screen.enter(finish);
    screen.render(createRecordCtx().ctx);
    expect(drawn.slice(1, 4)).toEqual(['T', 'E', 'B']);
  });

  test('blocked initials: TRY OTHER LETTERS, back to the first letter, nothing sent', () => {
    const b = fakeBoard();
    const d = deps({ board: b.board });
    d.initials!.set('FUK');
    const screen = createNameEntryScreen(d);
    screen.enter(finish);
    expect(confirmLetters(screen)).toBeNull();
    screen.render(createRecordCtx().ctx);
    expect(drawn).toContain('TRY OTHER LETTERS');
    expect(b.sent).toEqual([]);
  });

  test('blocked initials when the time runs out: AAA', () => {
    const b = fakeBoard();
    const d = deps({ board: b.board });
    d.initials!.set('FUK');
    const screen = createNameEntryScreen(d);
    screen.enter(finish);
    screen.update(1 / 60, act());
    const t = screen.update(NAME_ENTRY_TIMEOUT_S, act());
    expect(t?.to).toBe('scores');
    expect(b.sent[0].body.initials).toBe('AAA');
  });

  test('a normal run: the local TOP 10 and the world board of today, with the right body', () => {
    const b = fakeBoard();
    const d = deps({ board: b.board });
    d.initials!.set('TEB');
    const screen = createNameEntryScreen(d);
    screen.enter(finish);
    const t = confirmLetters(screen);
    expect(t).toEqual({ to: 'scores', payload: { highlight: 0, retry: { song: 1 }, page: 'local' } });
    expect(d.scores.load()[0].name).toBe('TEB');
    expect(b.sent).toEqual([
      { board: 'today', body: { initials: 'TEB', score: 200_000, mode: 'normal', car: 'new', stageId: '4-2', route: 'RLRL', ending: 3, durationMs: 385_250 } },
    ]);
  });

  test('a run that only makes the world board: not in the local TOP 10, the TODAY page', () => {
    const scores = createScoresStore();
    for (let i = 0; i < 10; i++) scores.insert({ name: 'AAA', score: 9e6 - i, stageId: '0-0', route: '', date: '' });
    const b = fakeBoard();
    const d = deps({ board: b.board, scores });
    const screen = createNameEntryScreen(d);
    screen.enter(finish);
    expect(confirmLetters(screen)).toEqual({ to: 'scores', payload: { highlight: undefined, retry: { song: 1 }, page: 'today' } });
    expect(scores.load().map((e) => e.score)).not.toContain(finish.score);
    expect(scores.load()).toHaveLength(10);
  });

  test('a DAILY run: never the local TOP 10; the DAILY board with the challenge of the day', () => {
    const b = fakeBoard();
    const session = createDailySession();
    const c = dailyChallenge('2026-10-24');
    session.start(c);
    const d = deps({ board: b.board, daily: session, car: { get: () => c.car, set() {}, toggle: () => c.car }, mode: { get: () => c.mode, set() {}, toggle: () => c.mode } });
    const screen = createNameEntryScreen(d);
    screen.enter(finish);
    expect(confirmLetters(screen)).toEqual({ to: 'scores', payload: { highlight: undefined, retry: { song: 1 }, page: 'daily' } });
    expect(d.scores.load()).toEqual([]);
    expect(b.sent[0]).toEqual({ board: 'daily', body: expect.objectContaining({ car: c.car, mode: c.mode, daily: '2026-10-24' }) });
  });

  test('offline builds (no board): nothing sent; without the race time nothing sent either', () => {
    const screen = createNameEntryScreen(deps());
    screen.enter(finish);
    expect(confirmLetters(screen)?.to).toBe('scores');
    expect(runBody({ score: 1, stageId: '0-0', route: [] }, 'TEB', 'new', 'normal', null)).toBeNull();
  });
});

describe('world pages of the TOP 10', () => {
  const rows = (n: number): BoardRow[] => Array.from({ length: n }, (_, i) => ({ initials: 'ABC', score: 9000 - i, car: 'sport', stageId: '3-1', ending: null }));

  test('offline: only LOCAL, no tabs, no message', () => {
    const screen = createScoresScreen(deps({ board: fakeBoard().board }));
    screen.enter(undefined);
    screen.render(createRecordCtx().ctx);
    expect(drawn).toContain('TOP 10');
    expect(drawn).not.toContain('TODAY');
    expect(drawn.some((t) => /OFFLINE|ERROR/.test(t))).toBe(false);
  });

  test('the world pages show once their data has arrived; a tap on a tab, or down, turns the page', () => {
    const d = deps({ board: fakeBoard({ today: rows(3), alltime: rows(10) }).board });
    const screen = createScoresScreen(d);
    screen.enter({ retry: { song: 0 } });
    screen.render(createRecordCtx().ctx);
    expect(drawn).toEqual(expect.arrayContaining(['LOCAL', 'TODAY', 'ALL TIME']));
    expect(drawn).not.toContain('DAILY');
    const today = tabRects(['local', 'today', 'alltime'])[1].rect;
    d.taps.push({ x: today.x + 10, y: today.y + 10 });
    expect(screen.update(1 / 60, act())).toBeNull();
    drawn.length = 0;
    screen.render(createRecordCtx().ctx);
    expect(drawn).toContain('WORLD TODAY');
    screen.update(1 / 60, act());
    screen.update(1 / 60, act({ brake: true }));
    drawn.length = 0;
    screen.render(createRecordCtx().ctx);
    expect(drawn).toContain('WORLD ALL TIME');
    expect(drawn).toContain('SPORT');
  });

  test('the rank of the run just sent, on its page, as soon as it arrives', () => {
    const b = fakeBoard({ today: rows(10) });
    const screen = createScoresScreen(deps({ board: b.board }));
    screen.enter({ retry: { song: 0 }, page: 'today' });
    screen.render(createRecordCtx().ctx);
    expect(drawn.some((t) => t.startsWith('#'))).toBe(false);
    b.arrive({ board: 'today', rank: 12, total: 40 });
    screen.render(createRecordCtx().ctx);
    expect(drawn).toContain('#12 TODAY OF 40');
    expect(rankLine({ board: 'daily', rank: 3, total: 9 })).toBe('#3 DAILY OF 9');
  });

  test('attract mode: a tap off the tabs goes back to the title', () => {
    const d = deps();
    const screen = createScoresScreen(d);
    screen.enter(undefined);
    d.taps.push({ x: 640, y: 400 });
    expect(screen.update(1 / 60, act())?.to).toBe('title');
  });
});
