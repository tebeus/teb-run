// Le build pubbliche davvero costruite: site, portal e crazygames in una cartella
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
  crazyGamesProblems,
  cspProblems,
  MAX_FILES,
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
      expect(publicFileAllowed(f, 'crazygames'), f).toBe(false);
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
      expect(checkBuild(dir, [], 'crazygames')).toContain('_headers in the crazygames build');
      expect(nameProblems(['music/custom/mine.mp3', 'music/custom/manifest.json'])).toEqual([
        'personal track: music/custom/mine.mp3',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('crazyGamesProblems: no cross-promotion, no fullscreen code (CrazyGames requirements)', () => {
  test('the privacy address passes, whole or as the bare domain the bundle builds it from', () => {
    expect(crazyGamesProblems('open(`https://tebrun.io/privacy/`)')).toEqual([]);
    expect(crazyGamesProblems('s=`tebrun.io`,c=`https://${s}`;var l=`${c}/privacy/`')).toEqual([]);
  });

  test('any other site address, other portals, GitHub, stats, fullscreen and SHARE fail', () => {
    expect(crazyGamesProblems('"https://tebrun.io/about/"')).toEqual([
      'names /about/',
      'names tebrun.io outside the privacy address',
    ]);
    expect(crazyGamesProblems('visit https://tebrun.io now')).toEqual(['names tebrun.io outside the privacy address']);
    expect(crazyGamesProblems('https://play.tebrun.io')).toContain('names play.tebrun.io');
    expect(crazyGamesProblems('https://tebrun.itch.io/teb-run')).toEqual(['names itch.io']);
    expect(crazyGamesProblems('https://GitHub.com/tebeus')).toEqual(['names github']);
    expect(crazyGamesProblems('https://tebrun.goatcounter.com/count')).toEqual(['names goatcounter']);
    expect(crazyGamesProblems('el.requestFullscreen()')).toEqual(['names requestFullscreen']);
    expect(crazyGamesProblems('`SHARE NOT AVAILABLE`')).toEqual(['names SHARE NOT AVAILABLE']);
  });

  test('more than 1500 files fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-files-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html>');
      for (let i = 0; i < MAX_FILES; i++) writeFileSync(join(dir, `f${i}.txt`), '');
      expect(checkBuild(dir, [])).toContain(`${MAX_FILES + 1} files, over ${MAX_FILES}`);
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

describe('site, portal and crazygames, built for real', () => {
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
    expect(output).toContain('crazygames: ok');
  });

  test('the site ships public/_headers as is, the portal and crazygames do not', () => {
    expect(read(join(dir, 'site', '_headers'))).toBe(read(join(ROOT, 'public', '_headers')));
    expect(() => read(join(dir, 'portal', '_headers'))).toThrow();
    // Niente frame-ancestors che fermi l'iframe di CrazyGames: la sola CSP è quella del <meta>, che non la può dire.
    expect(() => read(join(dir, 'crazygames', '_headers'))).toThrow();
    expect(read(join(dir, 'crazygames', 'index.html'))).not.toContain('frame-ancestors');
  });

  test.skipIf(NO_ART)('crazygames keeps the body unselectable, and its zip is ready', () => {
    expect(read(join(dir, 'crazygames', 'style.css'))).toMatch(/html, body, canvas \{[^}]*\buser-select: none;/);
    expect(read(join(dir, 'crazygames', 'style.css'))).toMatch(/-webkit-user-select: none;/);
    expect(readFileSync(join(dir, 'crazygames.zip')).length).toBeGreaterThan(1_000_000);
  });

  test('crazygames: the privacy address is there, ABOUT, SHARE and the fullscreen code are not', () => {
    const js = readdirSync(join(dir, 'crazygames', 'assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => read(join(dir, 'crazygames', 'assets', name)))
      .join('\n');
    expect(js).toMatch(/\/privacy\//);
    expect(crazyGamesProblems(js)).toEqual([]);
    // Il controllo morde: lo stesso giro sul portal trova pulsante, ABOUT e SHARE.
    const portal = readdirSync(join(dir, 'portal', 'assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => read(join(dir, 'portal', 'assets', name)))
      .join('\n');
    expect(crazyGamesProblems(portal)).toEqual(['names requestFullscreen', 'names /about/', 'names SHARE NOT AVAILABLE']);
  });

  test.skipIf(NO_ART)('the sprites ship as WebP only, and the manifest names files that are there', () => {
    for (const target of ['site', 'portal', 'crazygames']) {
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
    for (const target of ['site', 'portal', 'crazygames']) {
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
    expect(csp('crazygames')).toBe(csp('portal'));
  });

  test('the personal radio manifest ships empty', () => {
    for (const target of ['site', 'portal', 'crazygames']) {
      expect(read(join(dir, target, 'music/custom/manifest.json')).trim()).toBe('[]');
    }
  });
});
