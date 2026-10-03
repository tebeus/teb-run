import { describe, expect, test } from 'vitest';
import { createEmptyAssets } from '../../src/dev/empty-assets';

describe('createEmptyAssets', () => {
  test('has() is always false', () => {
    const assets = createEmptyAssets();
    expect(assets.has('anything')).toBe(false);
    expect(assets.has('traffic_sedan')).toBe(false);
  });

  test('get() never throws and returns a 1x1 placeholder', () => {
    const assets = createEmptyAssets();
    const asset = assets.get('anything');
    expect(asset.name).toBe('anything');
    expect(asset.w).toBe(1);
    expect(asset.h).toBe(1);
    expect(asset.image).toBeDefined();
  });

  test('ready resolves', async () => {
    await expect(createEmptyAssets().ready).resolves.toBeUndefined();
  });

  test('stats are all zero', () => {
    expect(createEmptyAssets().stats).toEqual({ png: 0, procedural: 0, missing: 0 });
  });
});
