// Cloudflare Access davanti a /admin (spec §2.6). Access lascia passare solo
// le email della sua policy (configurate nel pannello, non qui) e aggiunge
// `Cf-Access-Jwt-Assertion`; il Worker verifica comunque il token, così chi
// arrivasse al Worker senza passare da Access trova la porta chiusa:
// firma RS256 con le chiavi del team, `aud`, `iss`, scadenza.

export interface Jwks {
  keys: (JsonWebKey & { kid?: string })[];
}

export interface AccessCheck {
  team: string;
  aud: string;
  nowS: number;
  /** Le chiavi pubbliche del team (`/cdn-cgi/access/certs`). */
  certs: () => Promise<Jwks>;
}

const b64urlToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const decodeJson = (part: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** L'URL delle chiavi pubbliche di un team. Pura. */
export const certsUrl = (team: string): string => `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;

/** Vero solo per un token di Access valido per questa applicazione. */
export async function verifyAccessJwt(token: string | null, check: AccessCheck): Promise<boolean> {
  if (!token || check.aud === '') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header === null || payload === null || header.alg !== 'RS256') return false;
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.includes(check.aud) : aud === check.aud;
  if (!audOk) return false;
  if (payload.iss !== `https://${check.team}.cloudflareaccess.com`) return false;
  if (typeof payload.exp !== 'number' || payload.exp <= check.nowS) return false;
  if (typeof payload.nbf === 'number' && payload.nbf > check.nowS + 60) return false;
  let jwks: Jwks;
  try {
    jwks = await check.certs();
  } catch {
    return false;
  }
  const candidates = jwks.keys.filter((k) => k.kty === 'RSA' && (header.kid === undefined || k.kid === header.kid));
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = b64urlToBytes(parts[2]);
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)) return true;
    } catch {
      // chiave illeggibile: si prova la prossima
    }
  }
  return false;
}

/** Le chiavi del team, in cache un'ora nella Cache API del Worker. */
export async function fetchCerts(team: string): Promise<Jwks> {
  const url = certsUrl(team);
  const cache = caches.default;
  const hit = await cache.match(url);
  if (hit) return (await hit.json()) as Jwks;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const body = await res.text();
  await cache.put(url, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } }));
  return JSON.parse(body) as Jwks;
}
