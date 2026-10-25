// Risposte e CORS. Gli errori hanno sempre il corpo vuoto: chi bara non sa
// quale controllo ha fallito (spec §2.3).

export const empty = (status: number, headers: HeadersInit = {}): Response => new Response(null, { status, headers });

export function json(value: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** L'origine della richiesta, se è fra quelle ammesse (`ALLOWED_ORIGINS`). */
export function allowedOrigin(request: Request, allowed: string): string | null {
  const origin = request.headers.get('Origin');
  if (origin === null) return null;
  return allowed
    .split(',')
    .map((o) => o.trim())
    .includes(origin)
    ? origin
    : null;
}

/** CORS per il gioco: solo le origini ammesse, niente credenziali. */
export function gameCors(origin: string | null): Record<string, string> {
  if (origin === null) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** CORS aperto, solo per `/daily` e `/daily.txt` (sola lettura, pubblici). */
export const OPEN_CORS = { 'Access-Control-Allow-Origin': '*' } as const;

/** Intestazioni di sicurezza su ogni risposta. */
export function secure(response: Response): Response {
  const r = new Response(response.body, response);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('Referrer-Policy', 'no-referrer');
  if (!r.headers.has('Content-Security-Policy')) r.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return r;
}
