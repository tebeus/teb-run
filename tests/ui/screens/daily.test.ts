// La schermata della sfida del giorno (spec §3.3): dice la sfida di oggi
// (auto e modalità, uguali per tutti), HARD WEEKEND il sabato e la domenica,
// il campione di ieri se c'è la rete, il proprio record di oggi e quanto
// manca alla sfida nuova. Apre la sessione DAILY; ENTER, clic o tocco alla
// radio, Esc o BACK al titolo.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createNullAudio } from '../../../src/dev/null-audio';
import { createScoresStore } from '../../../src/persist/scores';
import { createDailyStore } from '../../../src/persist/daily';
import { dailyChallenge } from '../../../src/shared/daily';
import { createDailySession } from '../../../src/ui/dailySession';
import { createRecordCtx } from '../../helpers/recordCtx';
import type { Actions } from '../../../src/types';
import type { BoardClient, DailyInfo } from '../../../src/net/types';
import type { ScreenDeps } from '../../../src/ui/deps';

const drawn: string[] = [];
vi.mock('../../../src/ui/text', async (orig) => {
  const real = await orig<typeof import('../../../src/ui/text')>();
  return {
    ...real,
    drawText: (_c: unknown, text: string) => void drawn.push(text),
    drawTextOutlined: (_c: unknown, text: string) => void drawn.push(text),
  };
});

const { createDailyScreen, stepDaily, dailyLines, DAILY_BACK_RECT, DAILY_START_RECT } = await import('../../../src/ui/screens/daily');

const act = (a: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...a });
const SATURDAY = Date.parse('2026-10-24T18:48:00Z');
const MONDAY = Date.parse('2026-10-26T09:00:00Z');

function deps(now: number, board?: Partial<BoardClient>): ScreenDeps & { taps: { x: number; y: number }[] } {
  const taps: { x: number; y: number }[] = [];
  return {
    taps,
    assets: createEmptyAssets(),
    audio: createNullAudio(),
    scores: createScoresStore(),
    raceFactory: () => {
      throw new Error('no race here');
    },
    renderWorld: () => {},
    firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 100, timeLimit: 80, seed: 1, difficulty: 0.15 },
    now: () => now,
    daily: createDailySession(),
    dailyStore: createDailyStore(),
    board: board as BoardClient | undefined,
    signals: { takeTap: () => taps.shift() ?? null, takeFocusLost: () => false } as unknown as ScreenDeps['signals'],
  };
}

afterEach(() => {
  drawn.length = 0;
});

describe('daily screen', () => {
  test('ENTER, a tap or a click go to the radio; Esc or BACK to the title', () => {
    const s = { t: 0, timerT: 0 };
    expect(stepDaily(s, 0.1, act({ confirm: true }), null, false).transition?.to).toBe('radio');
    expect(stepDaily(s, 0.1, act({ back: true }), null, false).transition?.to).toBe('title');
    expect(stepDaily(s, 0.1, act(), { x: DAILY_START_RECT.x + 5, y: DAILY_START_RECT.y + 5 }, false).transition?.to).toBe('radio');
    expect(stepDaily(s, 0.1, act(), { x: 640, y: 300 }, false).transition?.to).toBe('radio');
    expect(stepDaily(s, 0.1, act(), { x: DAILY_BACK_RECT.x + 5, y: DAILY_BACK_RECT.y + 5 }, false).transition?.to).toBe('title');
    expect(stepDaily(s, 0.1, act(), null, false).transition).toBeNull();
  });

  test('the crazygames timer: to the radio at zero, never without it', () => {
    let s = { t: 0, timerT: 0 };
    for (let i = 0; i < 9; i++) {
      const r = stepDaily(s, 1, act(), null, true);
      expect(r.transition).toBeNull();
      s = r.state;
    }
    expect(stepDaily(s, 1, act(), null, true).transition?.to).toBe('radio');
    expect(stepDaily({ t: 0, timerT: 0 }, 60, act(), null, false).transition).toBeNull();
  });

  test('lines: the challenge, HARD WEEKEND on Saturday, the champion and the best only when known', () => {
    const sat = dailyChallenge('2026-10-24');
    const lines = dailyLines(sat, new Date(SATURDAY), { champion: { initials: 'ABC', score: 812345 }, best: 1200 });
    expect(lines[0]).toBe(`TODAY: ${sat.car.toUpperCase()} · HARD`);
    expect(lines).toContain('HARD WEEKEND');
    expect(lines).toContain('SAME TRAFFIC FOR EVERYONE TODAY');
    expect(lines).toContain("YESTERDAY'S CHAMPION: ABC 812345");
    expect(lines).toContain('YOUR BEST TODAY: 1200');
    expect(lines).toContain('NEW CHALLENGE IN 5H 12M');
    const mon = dailyLines(dailyChallenge('2026-10-26'), new Date(MONDAY), {});
    expect(mon[0]).toMatch(/· NORMAL$/);
    expect(mon).not.toContain('HARD WEEKEND');
    expect(mon.some((l) => l.startsWith('YESTERDAY'))).toBe(false);
    expect(mon.some((l) => l.startsWith('YOUR BEST'))).toBe(false);
  });

  test('entering opens the daily session with the challenge of today (UTC), and asks /daily', () => {
    const askDaily = vi.fn(() => null);
    const d = deps(SATURDAY, { daily: askDaily });
    const screen = createDailyScreen(d);
    expect(d.daily!.current()).toBeNull();
    screen.enter(undefined);
    expect(d.daily!.current()).toEqual(dailyChallenge('2026-10-24'));
    expect(askDaily).toHaveBeenCalled();
  });

  test('draws the champion of yesterday once /daily has arrived, and the local best of today', () => {
    const info = { yesterday: { champion: { initials: 'XYZ', score: 640120, car: 'sport' } } } as unknown as DailyInfo;
    const d = deps(SATURDAY, { daily: () => info });
    d.dailyStore!.record('2026-10-24', { score: 777, car: 'new', mode: 'hard', stageId: '1-0', route: 'L' });
    const screen = createDailyScreen(d);
    screen.enter(undefined);
    screen.render(createRecordCtx().ctx);
    expect(drawn).toContain('DAILY CHALLENGE');
    expect(drawn).toContain("YESTERDAY'S CHAMPION: XYZ 640120");
    expect(drawn).toContain('YOUR BEST TODAY: 777');
    expect(drawn).toContain('START');
  });

  test('offline: no champion line and no error', () => {
    const d = deps(MONDAY);
    const screen = createDailyScreen(d);
    screen.enter(undefined);
    screen.render(createRecordCtx().ctx);
    expect(drawn.some((t) => t.startsWith('YESTERDAY'))).toBe(false);
  });

  test('a tap left over from the title chooses nothing', () => {
    const d = deps(MONDAY);
    d.taps.push({ x: 640, y: 300 });
    const screen = createDailyScreen(d);
    screen.enter(undefined);
    expect(screen.update(1 / 60, act())).toBeNull();
  });
});
