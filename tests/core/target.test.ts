import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { GAME_NAME, PRIVACY_URL, ABOUT_URL, SITE_DOMAIN } from '../../src/core/config';
import { FEATURES, TARGET, debugHookOn, featuresOf, parseTarget } from '../../src/core/target';
import { OUT_DIRS, targetOfMode } from '../../vite.config';
// @ts-expect-error strumento in JavaScript senza tipi
import { listFiles, zipDir, zipEntries } from '../../tools/zip-build.mjs';

const root = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

describe('build target', () => {
  test('absent means private: unit tests and dev tools run without Vite', () => {
    expect(parseTarget(undefined)).toBe('private');
    expect(parseTarget('')).toBe('private');
    expect(TARGET).toBe('private');
    expect(FEATURES.classicCar).toBe(true);
  });

  test('the four known targets parse, anything else throws', () => {
    for (const t of ['private', 'site', 'portal', 'crazygames'] as const) expect(parseTarget(t)).toBe(t);
    expect(() => parseTarget('production')).toThrow(/unknown build target/);
  });

  test('classic car only in private, stats only in site, new-tab links in portal and crazygames', () => {
    const rest = { fullscreenButton: true, aboutLink: true, share: true, portalSdk: false, radioTimer: false, goalLine: false };
    expect(featuresOf('private')).toEqual({ classicCar: true, stats: false, linksInNewTab: false, debugHook: true, worldBoard: true, ...rest });
    expect(featuresOf('site')).toEqual({ classicCar: false, stats: true, linksInNewTab: false, debugHook: false, worldBoard: true, ...rest });
    expect(featuresOf('portal')).toEqual({ classicCar: false, stats: false, linksInNewTab: true, debugHook: false, worldBoard: false, ...rest });
  });

  test('crazygames starts from portal, without fullscreen button, ABOUT and SHARE, with the gameplay events point', () => {
    expect(featuresOf('crazygames')).toEqual({
      classicCar: false,
      stats: false,
      linksInNewTab: true,
      debugHook: false,
      fullscreenButton: false,
      aboutLink: false,
      share: false,
      portalSdk: true,
      radioTimer: true,
      goalLine: true,
      // Finché CrazyGames non risponde (spec §6): solo la sfida in locale.
      worldBoard: false,
    });
  });

  test('#debug turns the hook on only in private (and dev); site and portal ignore it', () => {
    expect(debugHookOn(featuresOf('private'), '#debug', '#debug')).toBe(true);
    expect(debugHookOn(featuresOf('private'), '', '#debug')).toBe(false);
    expect(debugHookOn(featuresOf('private'), '#debugx', '#debug')).toBe(false);
    expect(debugHookOn(featuresOf('site'), '#debug', '#debug')).toBe(false);
    expect(debugHookOn(featuresOf('portal'), '#debug', '#debug')).toBe(false);
  });

  test('#debug is off in crazygames too', () => {
    expect(debugHookOn(featuresOf('crazygames'), '#debug', '#debug')).toBe(false);
  });

  test('src/main.ts reads #debug only through debugHookOn', () => {
    const main = readFileSync(root('src/main.ts'), 'utf8');
    expect(main).toMatch(/debugHookOn\(FEATURES, window\.location\.hash, DEBUG_HASH\)/);
    expect(main).not.toMatch(/window\.location\.hash\s*===/);
  });
});

describe('the leaderboard API origin', () => {
  test('api. on the site domain, written out in full', async () => {
    const { API_ORIGIN, SITE_DOMAIN } = await import('../../src/core/config');
    expect(API_ORIGIN).toBe(`https://api.${SITE_DOMAIN}`);
  });
});

describe('build-time constants', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Le costanti letterali che Vite risolve (e il bundler pota) valgono per
  // ogni bersaglio quanto i flag di `featuresOf`.
  test.each(['private', 'site', 'portal', 'crazygames'] as const)('%s: the literal constants agree with featuresOf', async (target) => {
    vi.stubEnv('VITE_TARGET', target);
    vi.resetModules();
    const m = await import('../../src/core/target');
    expect(m.TARGET).toBe(target);
    expect(m.STATS_BUILD).toBe(m.FEATURES.stats);
    expect(m.FULLSCREEN_BUILD).toBe(m.FEATURES.fullscreenButton);
    expect(m.ABOUT_BUILD).toBe(m.FEATURES.aboutLink);
    expect(m.SHARE_BUILD).toBe(m.FEATURES.share);
    expect(m.SDK_BUILD).toBe(m.FEATURES.portalSdk);
    expect(m.RADIO_TIMER_BUILD).toBe(m.FEATURES.radioTimer);
    expect(m.GOAL_LINE_BUILD).toBe(m.FEATURES.goalLine);
    expect(m.WORLD_BOARD_BUILD).toBe(m.FEATURES.worldBoard);
    expect(m.API_IS_PRODUCTION).toBe(target === 'site');
  });
});

describe('vite modes', () => {
  test('dev is private, a bare build is site, unknown modes stop the build', () => {
    expect(targetOfMode('development')).toBe('private');
    expect(targetOfMode('private')).toBe('private');
    expect(targetOfMode('production')).toBe('site');
    expect(targetOfMode('site')).toBe('site');
    expect(targetOfMode('portal')).toBe('portal');
    expect(targetOfMode('crazygames')).toBe('crazygames');
    expect(() => targetOfMode('staging')).toThrow(/unknown Vite mode/);
  });

  test('each target has its own output folder', () => {
    expect(OUT_DIRS).toEqual({ private: 'dist', site: 'dist-site', portal: 'dist-portal', crazygames: 'dist-crazygames' });
  });

  test('npm run build is build:site, and the four builds have their scripts', () => {
    const scripts = JSON.parse(readFileSync(root('package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts['build']).toBe('npm run build:site');
    expect(scripts['dev']).toBe('vite');
    expect(scripts['build:private']).toContain('--mode private');
    expect(scripts['build:site']).toContain('--mode site');
    expect(scripts['build:portal']).toContain('--mode portal');
    expect(scripts['build:portal']).toContain('zip-build.mjs dist-portal dist-portal.zip');
    expect(scripts['build:crazygames']).toContain('--mode crazygames');
    expect(scripts['build:crazygames']).toContain('zip-build.mjs dist-crazygames dist-crazygames.zip');
  });

  test('build outputs stay out of git', () => {
    const ignore = readFileSync(root('.gitignore'), 'utf8').split('\n');
    for (const line of ['dist/', 'dist-site/', 'dist-portal/', 'dist-portal.zip', 'dist-crazygames/', 'dist-crazygames.zip']) {
      expect(ignore).toContain(line);
    }
  });
});

describe('config', () => {
  test('the name lives in one place: index.html takes it from GAME_NAME at build time', () => {
    expect(GAME_NAME).toBe('TEB RUN');
    expect(readFileSync(root('index.html'), 'utf8')).toContain('<title>%GAME_NAME%</title>');
  });

  test('links are https on the site domain', () => {
    expect(PRIVACY_URL).toBe(`https://${SITE_DOMAIN}/privacy/`);
    expect(ABOUT_URL).toBe(`https://${SITE_DOMAIN}/about/`);
  });
});

describe('zip-build', () => {
  test('zips a folder with paths relative to it, and the data inflates back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-build-'));
    try {
      mkdirSync(join(dir, 'sprites'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html>'.repeat(20));
      writeFileSync(join(dir, 'sprites', 'a.png'), Buffer.from([1, 2, 3]));
      expect(listFiles(dir)).toEqual(['index.html', 'sprites/a.png']);
      const zip: Buffer = zipDir(dir);
      expect(zipEntries(zip)).toEqual(['index.html', 'sprites/a.png']);
      // Primo file: intestazione locale di 30 byte, poi il nome, poi i dati.
      const method = zip.readUInt16LE(8);
      const size = zip.readUInt32LE(18);
      const nameLength = zip.readUInt16LE(26);
      const body = zip.subarray(30 + nameLength, 30 + nameLength + size);
      const data = method === 8 ? inflateRawSync(body) : body;
      expect(data.toString()).toBe('<!doctype html>'.repeat(20));
      expect(zipDir(dir).equals(zip)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
