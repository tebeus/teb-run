// Il Worker della classifica mondiale e della sfida giornaliera di TEB RUN
// (spec docs/superpowers/specs/2026-10-25-classifica-e-sfida.md, §2 e §4).
//
//   POST /score             una partita → { rank, total }        (CORS: il gioco)
//   GET  /top?mode=&board=  la top 10, in cache 60 s              (CORS: il gioco)
//   GET  /daily, /daily.txt la pagina pubblica, in cache 5 min    (CORS: *)
//   GET  /admin, /admin/rows, POST /admin/hide                    (Cloudflare Access)
//
// Nessun IP salvato: il limite di richieste lo tiene Cloudflare in memoria.
// Gli errori sono codici senza corpo.

import { addDays, dailyKey } from '../../src/shared/daily';
import { validateRun } from '../../src/shared/validate';
import { fetchCerts, verifyAccessJwt, type Jwks } from './access';
import { adminHtml } from './admin';
import { dailyPage, dailyText } from './daily';
import { countRejection, insertRun, latestRows, rejectionsSince, setHidden, topRows, type PublicBoard } from './db';
import type { Env } from './env';
import { allowedOrigin, empty, gameCors, json, OPEN_CORS } from './http';

/** Dimensione massima del corpo di POST /score. */
export const MAX_BODY = 1024;
const BOARDS: readonly PublicBoard[] = ['today', 'alltime', 'daily'];
const TOP_TTL_S = 60;
const DAILY_TTL_S = 300;

/** Per i test: l'ora e le chiavi di Access si possono sostituire. */
export interface Deps {
  now: () => Date;
  certs: (team: string) => Promise<Jwks>;
}

const defaults: Deps = { now: () => new Date(), certs: fetchCerts };

/** La chiave del limite: l'IP, solo in memoria di Cloudflare. */
const limitKey = (request: Request): string => request.headers.get('CF-Connecting-IP') ?? 'unknown';

async function limited(limiter: RateLimit, request: Request): Promise<boolean> {
  try {
    const { success } = await limiter.limit({ key: limitKey(request) });
    return !success;
  } catch {
    // Un limitatore che non risponde non ferma il gioco.
    return false;
  }
}

/** L'URL di cache di `/top` (solo i parametri che contano). */
const topCacheKey = (origin: string, mode: string, board: string): string => `${origin}/top?mode=${mode}&board=${board}`;

async function cached(key: string, ttl: number, make: () => Promise<Response>): Promise<Response> {
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  const fresh = await make();
  const stored = new Response(fresh.body, fresh);
  stored.headers.set('Cache-Control', `public, max-age=${ttl}`);
  await cache.put(key, stored.clone());
  return stored;
}

async function postScore(request: Request, env: Env, deps: Deps, cors: Record<string, string>): Promise<Response> {
  if (await limited(env.POST_LIMIT, request)) return empty(429, cors);
  const now = deps.now();
  const text = await request.text();
  if (text.length > MAX_BODY) return empty(400, cors);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    await countRejection(env.DB, dailyKey(now), 'shape');
    return empty(400, cors);
  }
  const verdict = validateRun(body, now);
  if (!verdict.ok) {
    await countRejection(env.DB, dailyKey(now), verdict.reason);
    return empty(400, cors);
  }
  const { rank, total } = await insertRun(env.DB, verdict.row, Math.floor(now.getTime() / 1000));
  // La top di quella classifica cambia: la copia in cache si butta.
  const board = verdict.row.board === 'daily' ? 'daily' : 'today';
  const origin = new URL(request.url).origin;
  await caches.default.delete(topCacheKey(origin, verdict.row.mode, board));
  if (board === 'today') await caches.default.delete(topCacheKey(origin, verdict.row.mode, 'alltime'));
  // Anche la pagina pubblica, che mostra i primi tre di oggi.
  if (board === 'daily') for (const path of ['/daily', '/daily.txt']) await caches.default.delete(`${origin}${path}`);
  return json({ rank, total }, cors);
}

async function getTop(request: Request, env: Env, deps: Deps, cors: Record<string, string>): Promise<Response> {
  if (await limited(env.GET_LIMIT, request)) return empty(429, cors);
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');
  const board = url.searchParams.get('board');
  if ((mode !== 'normal' && mode !== 'hard') || !BOARDS.includes(board as PublicBoard)) return empty(400, cors);
  const res = await cached(topCacheKey(url.origin, mode, board!), TOP_TTL_S, async () =>
    json({ rows: await topRows(env.DB, board as PublicBoard, mode, dailyKey(deps.now())) }),
  );
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

async function getDaily(request: Request, env: Env, deps: Deps, asText: boolean): Promise<Response> {
  if (await limited(env.GET_LIMIT, request)) return empty(429, OPEN_CORS);
  const url = new URL(request.url);
  const res = await cached(`${url.origin}${url.pathname}`, DAILY_TTL_S, async () => {
    const page = await dailyPage(env.DB, deps.now());
    return asText ? new Response(dailyText(page), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }) : json(page);
  });
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', '*');
  return out;
}

async function admin(request: Request, env: Env, deps: Deps, path: string): Promise<Response> {
  const ok = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), {
    team: env.ACCESS_TEAM,
    aud: env.ACCESS_AUD ?? '',
    nowS: Math.floor(deps.now().getTime() / 1000),
    certs: () => deps.certs(env.ACCESS_TEAM),
  });
  if (!ok) return empty(403);
  const noStore = { 'Cache-Control': 'no-store' };
  if (path === '/admin' && request.method === 'GET') {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    return new Response(adminHtml(nonce), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
        ...noStore,
      },
    });
  }
  if (path === '/admin/rows' && request.method === 'GET') {
    const since = addDays(dailyKey(deps.now()), -13);
    const [rows, rejections] = await Promise.all([latestRows(env.DB), rejectionsSince(env.DB, since)]);
    return json({ rows, rejections }, noStore);
  }
  if (path === '/admin/hide' && request.method === 'POST') {
    let body: { id?: unknown; hidden?: unknown };
    try {
      body = JSON.parse(await request.text());
    } catch {
      return empty(400);
    }
    if (typeof body.id !== 'number' || !Number.isInteger(body.id) || typeof body.hidden !== 'boolean') return empty(400);
    return (await setHidden(env.DB, body.id, body.hidden)) ? json({ ok: true }, noStore) : empty(404);
  }
  return empty(404);
}

export async function handle(request: Request, env: Env, deps: Deps = defaults): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/admin' || path.startsWith('/admin/')) return admin(request, env, deps, path);
  if (path === '/daily' || path === '/daily.txt') {
    if (request.method === 'OPTIONS') return empty(204, { ...OPEN_CORS, 'Access-Control-Allow-Methods': 'GET' });
    if (request.method !== 'GET') return empty(405, OPEN_CORS);
    return getDaily(request, env, deps, path === '/daily.txt');
  }
  if (path === '/score' || path === '/top') {
    const cors = gameCors(allowedOrigin(request, env.ALLOWED_ORIGINS));
    if (request.method === 'OPTIONS') return empty(204, cors);
    if (path === '/score') return request.method === 'POST' ? postScore(request, env, deps, cors) : empty(405, cors);
    return request.method === 'GET' ? getTop(request, env, deps, cors) : empty(405, cors);
  }
  return empty(404);
}

