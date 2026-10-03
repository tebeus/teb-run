import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { createStubAssets, PLACEHOLDER_ENTRY, stubSize } from '../../src/dev/stub-assets';
import targetsJson from '../../tools/sprite-targets.json';

const targets = targetsJson as Record<string, { w: number; h: number; frames?: number }>;

describe('stubSize', () => {
  test('a name with its own target file uses that size', () => {
    expect(stubSize('traffic_sedan')).toEqual({ w: targets.traffic_sedan.w, h: targets.traffic_sedan.h });
  });

  test('a strip frame uses the size of its strip file', () => {
    const strip = targets.npc_seagull;
    expect(stubSize('npc_seagull_1')).toEqual({ w: strip.w, h: strip.h });
  });

  test('a player frame with its own target (Set 7) uses that target', () => {
    for (const n of ['player_straight', 'player_left2', 'player_spin_3']) {
      expect(stubSize(n), n).toEqual({ w: targets[n].w, h: targets[n].h });
    }
  });

  test('procedural only names get a hand written size', () => {
    expect(stubSize('common_barrier').w).toBeGreaterThan(0);
    expect(stubSize('common_gantry').w).toBeGreaterThan(stubSize('common_barrier').w);
  });

  test('every catalog name gets a positive size', () => {
    for (const name of Object.keys(CATALOG)) {
      const size = stubSize(name);
      expect(size.w, name).toBeGreaterThan(0);
      expect(size.h, name).toBeGreaterThan(0);
    }
  });

  test('an unknown name still gets a size instead of throwing', () => {
    expect(() => stubSize('not_a_sprite')).not.toThrow();
    expect(stubSize('not_a_sprite').w).toBeGreaterThan(0);
  });
});

describe('createStubAssets', () => {
  test('it is ready immediately and starts with empty stats', () => {
    const assets = createStubAssets();
    expect(assets.ready).toBeInstanceOf(Promise);
    expect(assets.stats).toEqual({ png: 0, procedural: 0, missing: 0 });
  });

  test('has is true for catalog names and false for the rest', () => {
    const assets = createStubAssets();
    expect(assets.has('beach_palm_1')).toBe(true);
    expect(assets.has('not_a_sprite')).toBe(false);
  });

  test('the placeholder entry is harmless: not solid, no collision width', () => {
    expect(PLACEHOLDER_ENTRY.solid).toBe(false);
    expect(PLACEHOLDER_ENTRY.collideW).toBe(0);
    expect(PLACEHOLDER_ENTRY.scale).toBeGreaterThan(0);
    expect(PLACEHOLDER_ENTRY.anchorY).toBe(1);
  });
});
