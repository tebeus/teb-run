import { describe, expect, test } from 'vitest';
import { currentBanner, forkSide } from '../../src/game/race';

describe('forkSide (spec §9)', () => {
  test('the sign of x picks the side, and x exactly zero goes right', () => {
    expect(forkSide(-0.001)).toBe('L');
    expect(forkSide(-1)).toBe('L');
    expect(forkSide(0)).toBe('R');
    expect(forkSide(0.001)).toBe('R');
  });
});

describe('currentBanner (spec §8, §11)', () => {
  test('game over wins over a checkpoint banner and over the fork zone', () => {
    expect(currentBanner({ expired: true, checkpointLeft: 2, inForkZone: true })).toBe('gameover');
  });

  test('a checkpoint banner wins over the fork zone', () => {
    expect(currentBanner({ expired: false, checkpointLeft: 0.5, inForkZone: true })).toBe('checkpoint');
  });

  test('inside the fork zone the fork banner shows, outside it nothing does', () => {
    expect(currentBanner({ expired: false, checkpointLeft: 0, inForkZone: true })).toBe('fork');
    expect(currentBanner({ expired: false, checkpointLeft: 0, inForkZone: false })).toBe('none');
  });
});
