// Il Worker nel runtime vero (workerd) con un D1 locale: invio, classifiche,
// pagina pubblica, limiti, CORS, rifiuti contati e admin dietro Access.

import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays, dailyChallenge, dailyKey } from '../../src/shared/daily';
import { handle, MAX_BODY, type Deps } from '../src/app';
import type { Jwks } from '../src/access';
import key from './fixtures/access-test-key.json';

const NOW = new Date('2026-10-25T12:00:00Z');
const at = (iso: string | Date): Deps => ({ now: () => new Date(iso), certs: async () => ({ keys: [key.public] }) as Jwks });
const deps = at(NOW);
const GAME = 'https://play.tebrun.io';
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter % 250}`;

// Il D1 locale e la Cache API restano fra un test e l'altro: si svuotano qui.
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM scores'), env.DB.prepare('DELETE FROM rejections')]);
  const keys = ['/daily', '/daily.txt'];
  for (const mode of ['normal', 'hard']) for (const board of ['today', 'alltime', 'daily']) keys.push(`/top?mode=${mode}&board=${board}`);
  for (const k of keys) await caches.default.delete(`https://api.tebrun.io${k}`);
});

const run = (over: Record<string, unknown> = {}) => ({
  initials: 'TEB',
  score: 200_000,
  mode: 'normal',
  car: 'retro',
  stageId: '4-2',
  route: 'RLRL',
  ending: 3,
  durationMs: 385_000,
  ...over,
});

function post(body: unknown, opts: { ip?: string; d?: Deps; raw?: string } = {}) {
  const req = new Request('https://api.tebrun.io/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: GAME, 'CF-Connecting-IP': opts.ip ?? freshIp() },
    body: opts.raw ?? JSON.stringify(body),
  });
  return handle(req, env, opts.d ?? deps);
}

const get = (path: string, d: Deps = deps, headers: Record<string, string> = {}) =>
  handle(new Request(`https://api.tebrun.io${path}`, { headers: { Origin: GAME, 'CF-Connecting-IP': freshIp(), ...headers } }), env, d);

async function rejections(): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare('SELECT reason, SUM(count) AS count FROM rejections GROUP BY reason').all<{ reason: string; count: number }>();
  return Object.fromEntries(results.map((r) => [r.reason, r.count]));
}

async function insertRaw(row: { board: string; day: string; mode: string; initials: string; score: number; car?: string; hidden?: number }) {
  await env.DB.prepare(
    'INSERT INTO scores (board, day, mode, initials, score, car, stage_id, route, ending, duration_ms, created_at, hidden) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)',
  )
    .bind(row.board, row.day, row.mode, row.initials, row.score, row.car ?? 'new', '4-2', 'RLRL', 3, 385000, 1, row.hidden ?? 0)
    .run();
}

describe('POST /score', () => {
  test('a valid run: saved, with its rank and the size of the board', async () => {
    let res = await post(run());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rank: 1, total: 1 });
    res = await post(run({ initials: 'ABC', score: 210_000 }));
    expect(await res.json()).toEqual({ rank: 1, total: 2 });
    res = await post(run({ initials: 'XYZ', score: 1_000 }));
    expect(await res.json()).toEqual({ rank: 3, total: 3 });
  });

  test('rejected runs: 400 with an empty body, counted by reason with no data of the run', async () => {
    for (const body of [run({ score: 7_300_000 }), run({ initials: 'FUK' }), run({ car: 'classic' }), run({ durationMs: 10 }), run({ route: 'RL' })]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('');
    }
    expect((await post(null, { raw: '{not json' })).status).toBe(400);
    expect((await post(null, { raw: 'x'.repeat(MAX_BODY + 1) })).status).toBe(400);
    expect(await rejections()).toEqual({ score: 1, initials: 1, shape: 2, duration: 1, route: 1 });
    const { results } = await env.DB.prepare('SELECT * FROM rejections').all();
    expect(Object.keys(results[0]!).sort()).toEqual(['count', 'day', 'reason']);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM scores').first<{ n: number }>())?.n).toBe(0);
  });

  test('rate limit: the seventh run in a minute from the same address gets 429; another address does not', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < 6; i++) expect((await post(run(), { ip })).status).toBe(200);
    const res = await post(run(), { ip });
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('');
    expect((await post(run(), { ip: '198.51.100.8' })).status).toBe(200);
  });

  test('no IP stored anywhere', async () => {
    await post(run(), { ip: '192.0.2.55' });
    for (const table of ['scores', 'rejections']) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(results)).not.toContain('192.0.2.55');
    }
  });

  test("the daily challenge: today's car and mode only; yesterday's within 15 minutes after midnight", async () => {
    const c = dailyChallenge('2026-10-25');
    const daily = run({ car: c.car, mode: c.mode, daily: '2026-10-25', initials: 'DAY' });
    expect((await post(daily)).status).toBe(200);
    expect((await post(daily, { d: at('2026-10-26T00:10:00Z') })).status).toBe(200);
    expect((await post(daily, { d: at('2026-10-26T00:20:00Z') })).status).toBe(400);
    expect((await post({ ...daily, car: c.car === 'new' ? 'super' : 'new' })).status).toBe(400);
    const rows = await env.DB.prepare("SELECT day FROM scores WHERE board = 'daily'").all<{ day: string }>();
    expect(rows.results.map((r) => r.day)).toEqual(['2026-10-25', '2026-10-25']);
    expect(await rejections()).toEqual({ daily: 2 });
  });
});

describe('GET /top', () => {
  test('top 10 of today, best first, without hidden rows, blocked initials, ids or times', async () => {
    for (let i = 0; i < 12; i++) await insertRaw({ board: 'run', day: '2026-10-25', mode: 'normal', initials: `A${String.fromCharCode(65 + i)}A`, score: 1000 + i });
    await insertRaw({ board: 'run', day: '2026-10-25', mode: 'normal', initials: 'HID', score: 99_999, hidden: 1 });
    await insertRaw({ board: 'run', day: '2026-10-25', mode: 'normal', initials: 'FUK', score: 88_888 });
    await insertRaw({ board: 'run', day: '2026-10-24', mode: 'normal', initials: 'OLD', score: 77_777 });
    await insertRaw({ board: 'daily', day: '2026-10-25', mode: 'normal', initials: 'DLY', score: 66_666 });
    const res = await get('/top?mode=normal&board=today');
    expect(res.status).toBe(200);
    const { rows } = (await res.json()) as { rows: Record<string, unknown>[] };
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ initials: 'ALA', score: 1011, car: 'new', stageId: '4-2', ending: 3 });
    expect(rows.map((r) => r.initials)).not.toContain('HID');
    expect(rows.map((r) => r.initials)).not.toContain('FUK');
    const all = (await (await get('/top?mode=normal&board=alltime', at('2026-10-25T12:00:01Z'))).json()) as { rows: { initials: string }[] };
    expect(all.rows[0].initials).toBe('OLD');
    expect(all.rows.map((r) => r.initials)).not.toContain('DLY');
  });

  test('a new run shows up at once: the cached copy is dropped', async () => {
    expect(((await (await get('/top?mode=hard&board=today')).json()) as { rows: unknown[] }).rows).toEqual([]);
    const c = { car: 'new', mode: 'hard' };
    expect((await post(run({ ...c, durationMs: 380_000, score: 90_000 }))).status).toBe(200);
    const rows = ((await (await get('/top?mode=hard&board=today')).json()) as { rows: { score: number }[] }).rows;
    expect(rows.map((r) => r.score)).toEqual([90_000]);
  });

  test('bad parameters: 400', async () => {
    for (const q of ['', '?mode=easy&board=today', '?mode=normal&board=week', '?mode=normal']) expect((await get(`/top${q}`)).status).toBe(400);
  });

  test('cached for 60 s', async () => {
    const res = await get('/top?mode=normal&board=daily');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
});

describe('CORS', () => {
  test('the game origin only for /score and /top; * only for /daily', async () => {
    expect((await get('/top?mode=normal&board=today')).headers.get('Access-Control-Allow-Origin')).toBe(GAME);
    const other = await get('/top?mode=normal&board=today', deps, { Origin: 'https://evil.example' });
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const pre = await handle(new Request('https://api.tebrun.io/score', { method: 'OPTIONS', headers: { Origin: GAME } }), env, deps);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(pre.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect((await get('/daily')).headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await get('/daily.txt')).headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('GET /daily', () => {
  test("today's challenge, yesterday's champion and top 3, today's top 3: no hidden rows, no blocked initials, no ids or times", async () => {
    const y = dailyChallenge('2026-10-24');
    const t = dailyChallenge('2026-10-25');
    await insertRaw({ board: 'daily', day: '2026-10-24', mode: y.mode, initials: 'ABC', score: 812_345, car: y.car });
    await insertRaw({ board: 'daily', day: '2026-10-24', mode: y.mode, initials: 'HID', score: 999_999, car: y.car, hidden: 1 });
    await insertRaw({ board: 'daily', day: '2026-10-24', mode: y.mode, initials: 'KKK', score: 900_000, car: y.car });
    await insertRaw({ board: 'daily', day: '2026-10-24', mode: y.mode, initials: 'XYZ', score: 640_120, car: y.car });
    await insertRaw({ board: 'daily', day: '2026-10-24', mode: y.mode, initials: 'TEB', score: 598_004, car: y.car });
    await insertRaw({ board: 'daily', day: '2026-10-24', mode: y.mode, initials: 'LOW', score: 1, car: y.car });
    await insertRaw({ board: 'run', day: '2026-10-24', mode: y.mode, initials: 'RUN', score: 2_000_000 });
    await insertRaw({ board: 'daily', day: '2026-10-25', mode: t.mode, initials: 'QQQ', score: 120_400, car: t.car });
    const res = await get('/daily', at('2026-10-25T18:48:00Z'));
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    const page = await res.json();
    expect(page).toEqual({
      date: '2026-10-25',
      challenge: { car: t.car, mode: t.mode },
      nextChallengeInMinutes: 312,
      yesterday: {
        date: '2026-10-24',
        challenge: { car: y.car, mode: y.mode },
        champion: { initials: 'ABC', score: 812_345, car: y.car },
        top3: [
          { initials: 'ABC', score: 812_345, car: y.car },
          { initials: 'XYZ', score: 640_120, car: y.car },
          { initials: 'TEB', score: 598_004, car: y.car },
        ],
      },
      today: { top3: [{ initials: 'QQQ', score: 120_400, car: t.car }] },
    });
    expect(JSON.stringify(page)).not.toMatch(/"id"|created|duration/);
  });

  test('nobody played yesterday: champion null, empty lists', async () => {
    const page = (await (await get('/daily')).json()) as { yesterday: { champion: unknown; top3: unknown[] } };
    expect(page.yesterday.champion).toBeNull();
    expect(page.yesterday.top3).toEqual([]);
  });

  test("a new daily run shows up at once in today's top 3", async () => {
    expect(((await (await get('/daily')).json()) as { today: { top3: unknown[] } }).today.top3).toEqual([]);
    const c = dailyChallenge('2026-10-25');
    expect((await post(run({ car: c.car, mode: c.mode, daily: '2026-10-25', durationMs: 380_000, score: 90_000 }))).status).toBe(200);
    const top3 = ((await (await get('/daily')).json()) as { today: { top3: { score: number }[] } }).today.top3;
    expect(top3.map((r) => r.score)).toEqual([90_000]);
  });

  test('/daily.txt: the same in three lines of English', async () => {
    const y = dailyChallenge(addDays(dailyKey(NOW), -1));
    await insertRaw({ board: 'daily', day: '2026-10-24', mode: y.mode, initials: 'ABC', score: 812_345, car: y.car });
    const res = await get('/daily.txt');
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const lines = (await res.text()).trimEnd().split('\n');
    const t = dailyChallenge('2026-10-25');
    expect(lines).toEqual([
      `TEB RUN daily challenge 2026-10-25: ${t.car.toUpperCase()}, ${t.mode.toUpperCase()} mode. Same traffic for everyone.`,
      `Yesterday's champion: ABC with 812,345 (${y.car.toUpperCase()}).`,
      'Today so far: 1. — · 2. — · 3. —',
    ]);
  });
});

/** Un token di Access firmato con la chiave di prova. */
async function accessToken(claims: Record<string, unknown>): Promise<string> {
  const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const head = enc({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const body = enc({ iss: 'https://holy-sun-a1da.cloudflareaccess.com', aud: ['test-aud'], exp: NOW.getTime() / 1000 + 600, ...claims });
  const k = await crypto.subtle.importKey('jwk', key.private, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(`${head}.${body}`)));
  const b64 = btoa(String.fromCharCode(...sig)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${head}.${body}.${b64}`;
}

const adminReq = (path: string, token: string | null, init: RequestInit = {}) =>
  handle(new Request(`https://api.tebrun.io${path}`, { ...init, headers: { ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}), ...(init.headers ?? {}) } }), env, deps);

describe('admin behind Cloudflare Access', () => {
  test('no token, a wrong audience, an expired token, a wrong signature: 403', async () => {
    expect((await SELF.fetch('https://api.tebrun.io/admin')).status).toBe(403);
    expect((await adminReq('/admin', null)).status).toBe(403);
    expect((await adminReq('/admin', await accessToken({ aud: ['other'] }))).status).toBe(403);
    expect((await adminReq('/admin', await accessToken({ exp: NOW.getTime() / 1000 - 1 }))).status).toBe(403);
    expect((await adminReq('/admin', await accessToken({ iss: 'https://evil.cloudflareaccess.com' }))).status).toBe(403);
    const good = await accessToken({});
    const forged = `${good.slice(0, good.lastIndexOf('.'))}.${'A'.repeat(342)}`;
    expect((await adminReq('/admin', forged)).status).toBe(403);
  });

  test('a valid token: the page (strict CSP), the last rows, the rejections, and hide/show', async () => {
    const token = await accessToken({});
    const page = await adminReq('/admin', token);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Security-Policy')).toMatch(/script-src 'nonce-[0-9a-f]+'/);
    expect(await page.text()).toContain('Latest 100 runs');

    await post(run({ initials: 'BAD', score: 150_000 }));
    await post(run({ score: 7_300_000 }));
    const data = (await (await adminReq('/admin/rows', token)).json()) as { rows: { id: number; initials: string }[]; rejections: unknown[] };
    expect(data.rows.map((r) => r.initials)).toEqual(['BAD']);
    expect(data.rejections).toEqual([{ day: '2026-10-25', reason: 'score', count: 1 }]);

    const hide = await adminReq('/admin/hide', token, { method: 'POST', body: JSON.stringify({ id: data.rows[0].id, hidden: true }) });
    expect(hide.status).toBe(200);
    const top = (await (await get('/top?mode=normal&board=alltime', at('2026-10-25T12:30:00Z'))).json()) as { rows: unknown[] };
    expect(top.rows).toEqual([]);
    expect((await adminReq('/admin/hide', token, { method: 'POST', body: JSON.stringify({ id: 9999, hidden: true }) })).status).toBe(404);
    expect((await adminReq('/admin/hide', token, { method: 'POST', body: '{"id":"1"}' })).status).toBe(400);
  });
});

describe('everything else', () => {
  test('404 and 405, with empty bodies and safe headers', async () => {
    const nf = await SELF.fetch('https://api.tebrun.io/nope');
    expect(nf.status).toBe(404);
    expect(nf.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await SELF.fetch('https://api.tebrun.io/score')).status).toBe(405);
    expect((await SELF.fetch('https://api.tebrun.io/daily', { method: 'POST' })).status).toBe(405);
  });
});
