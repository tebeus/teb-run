// Il client della classifica mondiale: legge solo quello che è arrivato,
// chiede in background, 3 s di tempo, niente cookie, ogni guasto vale
// "niente" (offline: resta la TOP 10 locale, nessun errore).

import { afterEach, describe, expect, test, vi } from 'vitest';
import { BOARD_TIMEOUT_MS, createBoardClient, parseBoardRow, parseDailyInfo, TOP_FRESH_MS, type BoardEnv } from '../../src/net/board';
import type { RunBody } from '../../src/shared/validate';

afterEach(() => {
  vi.useRealTimers();
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const row = (initials: string, score: number) => ({ initials, score, car: 'retro', stageId: '4-2', ending: 3 });
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

function rig(answer: (url: string, init: RequestInit) => Promise<Response>) {
  let now = 1_000_000;
  const calls: { url: string; init: RequestInit }[] = [];
  const env: BoardEnv = {
    origin: 'https://api.tebrun.io',
    fetch: (url, init) => {
      calls.push({ url, init });
      return answer(url, init);
    },
    now: () => now,
  };
  return { client: createBoardClient(env), calls, advance: (ms: number) => (now += ms) };
}

const run: RunBody = { initials: 'TEB', score: 1, mode: 'normal', car: 'new', stageId: '0-0', route: '', ending: null, durationMs: 9000 };

describe('board client', () => {
  test('top: null until it arrives, then the rows; asked once a minute at most; no cookies', async () => {
    const r = rig(() => ok({ rows: [row('ABC', 900), row('XYZ', 800)] }));
    expect(r.client.top('normal', 'today')).toBeNull();
    expect(r.client.top('normal', 'today')).toBeNull();
    await flush();
    expect(r.client.top('normal', 'today')?.map((x) => x.initials)).toEqual(['ABC', 'XYZ']);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe('https://api.tebrun.io/top?mode=normal&board=today');
    expect(r.calls[0].init.credentials).toBe('omit');
    r.advance(TOP_FRESH_MS);
    r.client.top('normal', 'today');
    expect(r.calls).toHaveLength(2);
  });

  test('would the score enter the top 10? unknown before the answer, then by the tenth row', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => row('AAA', 1000 - i * 10));
    const r = rig(() => ok({ rows: ten }));
    expect(r.client.wouldQualify('normal', 'daily', 5000)).toBeNull();
    r.client.top('normal', 'daily');
    await flush();
    expect(r.client.wouldQualify('normal', 'daily', 5000)).toBe(true);
    expect(r.client.wouldQualify('normal', 'daily', 910)).toBe(false);
    expect(r.client.wouldQualify('normal', 'daily', 0)).toBe(false);
    const few = rig(() => ok({ rows: [row('AAA', 1000)] }));
    few.client.top('hard', 'today');
    await flush();
    expect(few.client.wouldQualify('hard', 'today', 1)).toBe(true);
  });

  test('offline, an HTTP error, a broken answer: still null, no throw', async () => {
    for (const answer of [() => Promise.reject(new TypeError('offline')), () => Promise.resolve(new Response('', { status: 500 })), () => ok({ nope: 1 }), () => Promise.resolve(new Response('{x', { status: 200 }))]) {
      const r = rig(answer);
      expect(() => r.client.top('normal', 'today')).not.toThrow();
      await flush();
      expect(r.client.top('normal', 'today')).toBeNull();
      expect(r.client.wouldQualify('normal', 'today', 99)).toBeNull();
    }
  });

  test('3 s and the request is aborted: nothing arrives', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const r = rig((_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => ((aborted = true), rej(new Error('abort'))))));
    r.client.top('normal', 'today');
    vi.advanceTimersByTime(BOARD_TIMEOUT_MS - 1);
    expect(aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(aborted).toBe(true);
    await flush();
    expect(r.client.top('normal', 'today')).toBeNull();
  });

  test('submit: pending, then the rank; the board is asked again so the new row shows', async () => {
    let tops = 0;
    const r = rig((url) => (url.endsWith('/score') ? ok({ rank: 12, total: 40 }) : (tops++, ok({ rows: [] }))));
    expect(r.client.submitted()).toBeNull();
    r.client.submit(run, 'today');
    expect(r.client.submitted()).toEqual({ status: 'pending' });
    await flush();
    expect(r.client.submitted()).toEqual({ status: 'done', result: { board: 'today', rank: 12, total: 40 } });
    const post = r.calls.find((c) => c.url.endsWith('/score'))!;
    expect(post.init.method).toBe('POST');
    expect(JSON.parse(post.init.body as string)).toEqual(run);
    expect(post.init.credentials).toBe('omit');
    expect(tops).toBe(1);
  });

  test('submit refused (400, 429) or offline: failed, quietly', async () => {
    for (const answer of [() => Promise.resolve(new Response(null, { status: 400 })), () => Promise.resolve(new Response(null, { status: 429 })), () => Promise.reject(new Error('x'))]) {
      const r = rig(answer);
      r.client.submit(run, 'daily');
      await flush();
      expect(r.client.submitted()).toEqual({ status: 'failed' });
    }
  });

  test('daily: null until /daily arrives', async () => {
    const page = {
      date: '2026-10-25',
      challenge: { car: 'sport', mode: 'hard' },
      nextChallengeInMinutes: 411,
      yesterday: { date: '2026-10-24', challenge: { car: 'super', mode: 'hard' }, champion: row('ABC', 812345), top3: [row('ABC', 812345)] },
      today: { top3: [] },
    };
    const r = rig(() => ok(page));
    expect(r.client.daily()).toBeNull();
    await flush();
    expect(r.client.daily()?.yesterday.champion).toEqual({ initials: 'ABC', score: 812345, car: 'retro' });
  });

  test('rows from the server are checked: odd initials, scores or cars are dropped', () => {
    expect(parseBoardRow(row('ABC', 10))).toEqual({ initials: 'ABC', score: 10, car: 'retro', stageId: '4-2', ending: 3 });
    for (const bad of [row('abc', 1), row('A<B', 1), row('ABC', -1), row('ABC', 1.5), { ...row('ABC', 1), car: 'classic' }, { ...row('ABC', 1), stageId: '<x>' }, null, 'x']) {
      expect(parseBoardRow(bad)).toBeNull();
    }
    expect(parseDailyInfo({ date: 'x' })).toBeNull();
  });
});
