// La politica di sicurezza del contenuto vive in index.html, che nessun
// test unitario toccherebbe: questo la legge dal disco. Revisione di
// sicurezza del binario G, vedi docs/security-review.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { STATS_ORIGIN } from '../../src/core/config';
import { cspForTarget, indexHtmlForTarget } from '../../vite.config';

const INDEX = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const HEADERS = readFileSync(fileURLToPath(new URL('../../public/_headers', import.meta.url)), 'utf8');

// Stretta rispetto alla prima consegna del binario G: né il loader di asset
// né il resto del gioco caricano mai un'immagine da data: o blob: (canvas a
// canvas, non un <img src>). object-src 'none' e base-uri 'self' non sono
// richieste da niente nel gioco: le si aggiunge per chiudere due direttive
// che altrimenti ricadrebbero implicitamente su default-src. media-src
// 'self' è tornata dal binario J: la radio personale riproduce i file di
// public/music/custom/ con un <audio>, e resta 'self' perché quei file sono
// sempre locali (vedi docs/security-review.md).
const EXPECTED_CSP =
  "default-src 'self'; img-src 'self'; script-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'";

const cspContent = (): string => {
  const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(INDEX);
  expect(match, 'no Content-Security-Policy meta tag in index.html').not.toBeNull();
  return match?.[1] ?? '';
};

describe('index.html', () => {
  test('carries exactly the expected Content-Security-Policy', () => {
    expect(cspContent()).toBe(EXPECTED_CSP);
  });

  test('img-src no longer needs data: or blob:: the asset loader draws canvas to canvas, never an <img src>', () => {
    expect(cspContent()).not.toContain('data:');
    expect(cspContent()).not.toContain('blob:');
  });

  test("media-src is exactly 'self': the personal radio plays local files, never remote URLs", () => {
    // Binario J: <audio> dentro un MediaElementAudioSourceNode per i file di
    // public/music/custom/. `parseCustomManifest` rifiuta qualsiasi voce con
    // uno schema o un separatore, quindi nessun URL remoto può arrivare
    // all'elemento; la direttiva è la seconda rete.
    expect(cspContent()).toContain("media-src 'self'");
    expect(cspContent()).not.toMatch(/media-src[^;]*https?:/);
    expect(cspContent()).not.toMatch(/media-src[^;]*\*/);
  });

  test('the personal radio never builds a URL that leaves the folder', async () => {
    // Il test vero sta in tests/audio/custom.test.ts: questo lega la
    // direttiva al codice che la rende sufficiente, così se qualcuno
    // allargasse la direttiva il legame resta scritto qui.
    const { customTrackUrl, CUSTOM_BASE } = await import('../../src/audio/custom');
    for (const bad of ['../x.mp3', 'https://example.com/x.mp3', '//e.com/x.mp3']) {
      expect(customTrackUrl(CUSTOM_BASE, bad), bad).toBeNull();
    }
  });

  test("the policy never grants 'unsafe-inline' or 'unsafe-eval'", () => {
    expect(INDEX).not.toContain('unsafe-inline');
    expect(INDEX).not.toContain('unsafe-eval');
  });

  test('there is no inline style or inline script: the policy would block them', () => {
    // Uno <style> o uno <script> senza src verrebbero rifiutati dal
    // browser, e il gioco resterebbe senza CSS o senza codice.
    expect(/<style[\s>]/i.test(INDEX)).toBe(false);
    for (const tag of INDEX.match(/<script\b[^>]*>/gi) ?? []) {
      expect(tag, `script senza src: ${tag}`).toMatch(/\ssrc=/);
    }
  });

  test('the stylesheet is a same-origin file, so img-src and default-src stay tight', () => {
    expect(INDEX).toContain('<link rel="stylesheet" href="/style.css" />');
  });

  test('nothing is loaded from another origin', () => {
    expect(INDEX).not.toMatch(/https?:\/\//);
    expect(INDEX).not.toContain('//cdn');
  });
});

describe('public/_headers (build site, Cloudflare Pages)', () => {
  const headerCsp = (): string => {
    const match = /^\s+Content-Security-Policy:\s*(.+)$/m.exec(HEADERS);
    expect(match, 'no Content-Security-Policy in public/_headers').not.toBeNull();
    return match?.[1].trim() ?? '';
  };

  test('applies to every path', () => {
    expect(HEADERS).toMatch(/^\/\*$/m);
  });

  test("the game can sit in an iframe on https://tebrun.io and nowhere else", () => {
    expect(headerCsp()).toMatch(/frame-ancestors 'self' https:\/\/tebrun\.io$/);
  });

  test('the rest of the policy is exactly the one of the site build meta', () => {
    expect(headerCsp().replace(/; frame-ancestors [^;]+$/, '')).toBe(cspForTarget(cspContent(), 'site'));
  });

  test('no X-Frame-Options, which would block tebrun.io too', () => {
    expect(HEADERS.split('\n').filter((l) => !l.startsWith('#')).join('\n')).not.toMatch(/X-Frame-Options/i);
  });

  test("frame-ancestors stays out of the <meta>, where browsers ignore it with a console error", () => {
    expect(cspContent()).not.toContain('frame-ancestors');
  });
});

describe('CSP per build target (statistics only in the site build)', () => {
  const directive = (csp: string, name: string): string[] =>
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .find((d) => d[0] === name)
      ?.slice(1) ?? [];

  test('the stats origin is the GoatCounter site of the game, nothing wider', () => {
    expect(STATS_ORIGIN).toBe('https://tebrun.goatcounter.com');
  });

  test('index.html itself never names the stats origin; portal uses it as is, private adds only wrangler dev', () => {
    expect(INDEX).not.toContain('goatcounter');
    expect(INDEX).not.toContain('api.tebrun.io');
    expect(cspForTarget(cspContent(), 'portal')).toBe(cspContent());
    const priv = cspForTarget(cspContent(), 'private');
    expect(directive(priv, 'connect-src')).toEqual(["'self'", 'http://localhost:8787']);
    expect(priv).not.toContain('goatcounter');
    expect(priv).not.toContain('api.tebrun.io');
  });

  test("site adds the stats origin to connect-src and img-src, and the leaderboard API to connect-src only, keeping 'self'", () => {
    const site = cspForTarget(cspContent(), 'site');
    expect(directive(site, 'connect-src')).toEqual(["'self'", STATS_ORIGIN, 'https://api.tebrun.io']);
    expect(directive(site, 'img-src')).not.toContain('https://api.tebrun.io');
    expect(directive(site, 'img-src')).toEqual(["'self'", STATS_ORIGIN]);
    const others = site
      .split(';')
      .map((d) => d.trim())
      .filter((d) => !/^(connect-src|img-src) /.test(d));
    for (const d of others) expect(d, d).not.toContain('goatcounter');
    expect(site.split(STATS_ORIGIN).length - 1).toBe(2);
  });

  test('crazygames: no origin limits, so the SDK can load the portal ads; object-src and base-uri stay closed', async () => {
    const { CRAZYGAMES_CSP } = await import('../../vite.config');
    expect(cspForTarget(cspContent(), 'crazygames')).toBe("object-src 'none'; base-uri 'self'");
    expect(indexHtmlForTarget(INDEX, 'crazygames')).toContain(`content="${CRAZYGAMES_CSP}"`);
    expect(indexHtmlForTarget(INDEX, 'crazygames')).not.toContain("script-src 'self'");
  });

  test('applying it twice changes nothing', () => {
    const once = cspForTarget(cspContent(), 'site');
    expect(cspForTarget(once, 'site')).toBe(once);
  });

  test('the build rewrites only the meta, and stops on a page without one', () => {
    const site = indexHtmlForTarget(INDEX, 'site');
    expect(site).toContain(`content="${cspForTarget(cspContent(), 'site')}"`);
    expect(indexHtmlForTarget(INDEX, 'portal')).toBe(INDEX);
    expect(indexHtmlForTarget(INDEX, 'private')).toContain('http://localhost:8787');
    expect(() => indexHtmlForTarget('<html></html>', 'site')).toThrow(/no Content-Security-Policy/);
    // Le pagine di sviluppo (dev/*.html) non hanno CSP: in dev (private) passano intatte.
    expect(indexHtmlForTarget('<html></html>', 'private')).toBe('<html></html>');
  });

  test('_headers carries the stats origin and the leaderboard API only where the site meta does', () => {
    const header = /^\s+Content-Security-Policy:\s*(.+)$/m.exec(HEADERS)?.[1] ?? '';
    expect(directive(header, 'connect-src')).toEqual(["'self'", STATS_ORIGIN, 'https://api.tebrun.io']);
    expect(directive(header, 'img-src')).toEqual(["'self'", STATS_ORIGIN]);
  });
});
