import { describe, expect, test } from 'vitest';
import config from '../../vite.config';
import { SPRITE_BASE, SPRITE_MANIFEST_URL, pickSource } from '../../src/core/assets';
import { SAMPLE_BASE, SAMPLE_MANIFEST_URL, sampleUrl } from '../../src/audio/samples';
import { CUSTOM_BASE, CUSTOM_MANIFEST_URL, customTrackUrl } from '../../src/audio/custom';

// Percorsi relativi: la build gira anche da una sottocartella (itch.io, i
// portali). La prova vera è e2e/subfolder.spec.ts; qui il legame con la base.

describe('relative paths', () => {
  test('every build uses base ./', () => {
    const resolve = config as unknown as (env: { mode: string; command: string }) => { base?: string };
    for (const mode of ['private', 'site', 'portal', 'production']) {
      expect(resolve({ mode, command: 'build' }).base, mode).toBe('./');
    }
  });

  test('sprites, samples and personal tracks hang off import.meta.env.BASE_URL', () => {
    const base = import.meta.env.BASE_URL;
    expect(SPRITE_BASE).toBe(`${base}sprites/`);
    expect(SPRITE_MANIFEST_URL).toBe(`${base}sprites/manifest.json`);
    expect(SAMPLE_BASE).toBe(`${base}audio/`);
    expect(SAMPLE_MANIFEST_URL).toBe(`${base}audio/manifest.json`);
    expect(CUSTOM_BASE).toBe(`${base}music/custom/`);
    expect(CUSTOM_MANIFEST_URL).toBe(`${base}music/custom/manifest.json`);
  });

  test('a PNG source takes the sprite base', () => {
    const source = pickSource('player_straight', { player_straight: { file: 'player_straight.png', w: 1, h: 1 } }, new Set());
    expect(source).toMatchObject({ kind: 'png', url: `${SPRITE_BASE}player_straight.png` });
  });

  test('with a relative base, sampleUrl and customTrackUrl still refuse to leave the folder', () => {
    for (const bad of ['../x.ogg', '/x.ogg', 'https://e.com/x.ogg', '..\\x.ogg']) {
      expect(sampleUrl('./audio/', bad), bad).toBeNull();
      expect(customTrackUrl('./music/custom/', bad), bad).toBeNull();
    }
    expect(sampleUrl('./audio/', 'drums/kick.ogg')).toBe('./audio/drums/kick.ogg');
  });
});
