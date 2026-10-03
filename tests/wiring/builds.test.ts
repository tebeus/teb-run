// Le build pubbliche davvero costruite: site e portal in una cartella
// temporanea, con lo stesso controllo di `npm run check:builds`. Nessuna
// build a mano prima: il test la fa da sé (qualche secondo).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { manifestForTarget, manifestToWebp, publicFileAllowed, shipsAsWebp } from '../../vite.config';
import {
  buildWeights,
  checkBuild,
  cspProblems,
  MAX_INITIAL_BYTES,
  MAX_TOTAL_BYTES,
  nameProblems,
  weightProblems,
  // @ts-expect-error strumento in JavaScript senza tipi
} from '../../tools/check-builds.mjs';
import { NO_ART } from '../helpers/art';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(path, 'utf8');

describe('publicFileAllowed', () => {
  test('private carries everything, site and portal drop the classic car and the personal tracks', () => {
    for (const f of ['sprites/player_classic_straight.png', 'sprites/ending_classic_3.png', 'music/custom/song.mp3']) {
      expect(publicFileAllowed(f, 'private'), f).toBe(true);
      expect(publicFileAllowed(f, 'site'), f).toBe(false);
      expect(publicFileAllowed(f, 'portal'), f).toBe(false);
    }
    for (const f of ['sprites/player_straight.png', 'audio/engine_low.ogg', 'style.css']) {
      expect(publicFileAllowed(f, 'site'), f).toBe(true);
    }
  });

  test('_headers goes only to the site (and the private build, which carries everything)', () => {
    expect(publicFileAllowed('_headers', 'site')).toBe(true);
    expect(publicFileAllowed('_headers', 'portal')).toBe(false);
    expect(publicFileAllowed('_headers', 'private')).toBe(true);
  });

  test.skipIf(NO_ART)('the public manifest names no classic sprite', () => {
    const manifest = JSON.parse(read(join(ROOT, 'public/sprites/manifest.json'))) as Record<string, { file?: string }>;
    const site = manifestForTarget(manifest, 'site');
    expect(Object.keys(site).some((k) => k.includes('classic'))).toBe(false);
    expect(Object.keys(site).length).toBe(Object.keys(manifest).length - 15);
    expect(manifestForTarget(manifest, 'private')).toEqual(manifest);
  });
});

describe('WebP in site and portal (launch, point 12)', () => {
  test('the sprite PNGs of public/sprites ship as WebP, nothing else does', () => {
    expect(shipsAsWebp('sprites/beach_palm_1.png')).toBe(true);
    expect(shipsAsWebp('sprites/manifest.json')).toBe(false);
    expect(shipsAsWebp('sprites/sub/x.png')).toBe(false);
    expect(shipsAsWebp('audio/engine_low.ogg')).toBe(false);
  });

  test('the shipped manifest points to the .webp files and keeps the rest of each entry', () => {
    expect(manifestToWebp({ a: { file: 'a.png', w: 2, h: 3, frames: 2 }, b: { w: 1, h: 1 } })).toEqual({
      a: { file: 'a.webp', w: 2, h: 3, frames: 2 },
      b: { file: 'b.webp', w: 1, h: 1 },
    });
  });

  test('weightProblems: over 20 MB in all or 8 MB before the title', () => {
    expect(weightProblems({ total: 19_000_000, initial: 7_000_000 })).toEqual([]);
    expect(weightProblems({ total: 21_000_000, initial: 9_000_000 })).toEqual([
      'total 21.00 MB over 20.00 MB',
      'initial phase 9.00 MB over 8.00 MB',
    ]);
  });
});

describe('checkBuild catches what must not ship', () => {
  test('a classic file, a source map, a local path, a personal track', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-build-'));
    try {
      mkdirSync(join(dir, 'sprites'));
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html>');
      writeFileSync(join(dir, 'sprites', 'player_classic_straight.png'), 'x');
      writeFileSync(join(dir, 'sprites', 'manifest.json'), '{"ending_classic_1":{"file":"ending_classic_1.png"}}');
      writeFileSync(join(dir, 'assets', 'index.js'), 'a();\n//# sourceMappingURL=index.js.map\nconst p="/Users/someone/x";');
      writeFileSync(join(dir, 'assets', 'index.js.map'), '{}');
      const problems = checkBuild(dir, ['/Users/']) as string[];
      expect(problems).toContain('classic file: sprites/player_classic_straight.png');
      expect(problems).toContain('source map: assets/index.js.map');
      expect(problems).toContain('sourceMappingURL in assets/index.js');
      expect(problems).toContain('assets/index.js contains /Users/');
      expect(problems).toContain('classic in sprites/manifest.json: ending_classic_1');
      expect(checkBuild(dir, [], 'site')).toContain('no _headers (Cloudflare Pages)');
      writeFileSync(join(dir, '_headers'), '/*');
      expect(checkBuild(dir, [], 'portal')).toContain('_headers in the portal build');
      expect(nameProblems(['music/custom/mine.mp3', 'music/custom/manifest.json'])).toEqual([
        'personal track: music/custom/mine.mp3',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cspProblems: the stats origin only in the site build, only in connect-src and img-src', () => {
  const meta = (csp: string): string => `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  const GC = 'https://tebrun.goatcounter.com';
  const base = "default-src 'self'; img-src 'self'";

  test('the right site policy passes, and so does the bare one in the portal', () => {
    expect(cspProblems(meta(`${base} ${GC}; connect-src 'self' ${GC}`), 'site')).toEqual([]);
    expect(cspProblems(meta(base), 'portal')).toEqual([]);
  });

  test('a site policy without the origin fails, and so does one that grants it elsewhere', () => {
    expect(cspProblems(meta(base), 'site')).toEqual([`CSP connect-src lacks ${GC}`, `CSP img-src lacks ${GC}`]);
    expect(cspProblems(meta(`${base} ${GC}; connect-src 'self' ${GC}; script-src 'self' ${GC}`), 'site')).toEqual([
      'CSP script-src names tebrun.goatcounter.com',
    ]);
  });

  test('the portal policy must not name it at all', () => {
    expect(cspProblems(meta(`${base}; connect-src 'self' ${GC}`), 'portal')).toContain(
      'CSP connect-src names tebrun.goatcounter.com',
    );
    expect(cspProblems('<html>', 'portal')).toEqual(['no Content-Security-Policy meta in index.html']);
  });
});

describe('site and portal, built for real', () => {
  let dir = '';
  let output = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'teb-builds-test-'));
    const env = { ...process.env };
    delete env.NODE_ENV;
    output = execFileSync(process.execPath, ['tools/check-builds.mjs', '--keep', dir], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }, 120_000);
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('check:builds passes: no classic file, no source map, no local path or email', () => {
    expect(output).toContain('site: ok');
    expect(output).toContain('portal: ok');
  });

  test('the site ships public/_headers as is, the portal does not', () => {
    expect(read(join(dir, 'site', '_headers'))).toBe(read(join(ROOT, 'public', '_headers')));
    expect(() => read(join(dir, 'portal', '_headers'))).toThrow();
  });

  test.skipIf(NO_ART)('the sprites ship as WebP only, and the manifest names files that are there', () => {
    for (const target of ['site', 'portal']) {
      const sprites = readdirSync(join(dir, target, 'sprites'));
      expect(sprites.filter((name) => name.endsWith('.png')), target).toEqual([]);
      const manifest = JSON.parse(read(join(dir, target, 'sprites/manifest.json'))) as Record<string, { file: string }>;
      for (const [name, entry] of Object.entries(manifest)) {
        expect(entry.file, name).toMatch(/\.webp$/);
        expect(sprites, name).toContain(entry.file);
      }
      // Con l'alfa: l'intestazione RIFF/WEBP di un file con trasparenza.
      const palm = readFileSync(join(dir, target, 'sprites/beach_palm_1.webp'));
      expect(palm.toString('ascii', 0, 4)).toBe('RIFF');
      expect(palm.toString('ascii', 8, 12)).toBe('WEBP');
    }
  });

  test.skipIf(NO_ART)('within the weight limits: 20 MB in all, 8 MB before the title', () => {
    for (const target of ['site', 'portal']) {
      const weights = buildWeights(join(dir, target)) as { total: number; initial: number };
      expect(weights.total, target).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
      expect(weights.initial, target).toBeLessThanOrEqual(MAX_INITIAL_BYTES);
      expect(weights.initial, target).toBeLessThan(weights.total);
    }
  });

  test('only the site build talks to GoatCounter: its meta grants it, the portal names it nowhere', () => {
    const csp = (target: string): string =>
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(read(join(dir, target, 'index.html')))?.[1] ?? '';
    expect(csp('site')).toContain("connect-src 'self' https://tebrun.goatcounter.com");
    expect(csp('site')).toContain("img-src 'self' https://tebrun.goatcounter.com");
    expect(csp('portal')).not.toContain('goatcounter');
  });

  test('the personal radio manifest ships empty', () => {
    for (const target of ['site', 'portal']) {
      expect(read(join(dir, target, 'music/custom/manifest.json')).trim()).toBe('[]');
    }
  });
});
