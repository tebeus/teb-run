import { describe, expect, test } from 'vitest';
import {
  checkpointBonus,
  CHECKPOINT_BONUS_PER_SECOND,
  finishBonus,
  FINISH_BONUS_PER_SECOND,
  overtakeScore,
  OVERTAKE_POINTS,
  tickScore,
} from '../../src/game/score';

const DT = 1 / 60;

describe('tickScore (spec §8)', () => {
  test('at full speed on level 0 it is 100 points a second', () => {
    expect(tickScore(1, 1, 0)).toBe(100);
    expect(tickScore(1, DT, 0)).toBeCloseTo(100 / 60, 10);
  });

  test('every level adds a quarter', () => {
    expect(tickScore(1, 1, 1)).toBeCloseTo(125, 10);
    expect(tickScore(1, 1, 4)).toBeCloseTo(200, 10);
  });

  test('standing still scores nothing', () => {
    expect(tickScore(0, 1, 4)).toBe(0);
  });

  test('half speed scores half', () => {
    expect(tickScore(0.5, 1, 0)).toBeCloseTo(50, 10);
  });

  test('a negative level does not shrink the score', () => {
    expect(tickScore(1, 1, -3)).toBe(100);
  });
});

describe('bonuses (spec §8)', () => {
  test('a checkpoint pays 1000 a second', () => {
    expect(CHECKPOINT_BONUS_PER_SECOND).toBe(1000);
    expect(checkpointBonus(12.5)).toBe(12500);
  });

  test('the finish pays 5000 a second', () => {
    expect(FINISH_BONUS_PER_SECOND).toBe(5000);
    expect(finishBonus(12.5)).toBe(62500);
  });

  test('no time left, no bonus, and a negative time never subtracts', () => {
    expect(checkpointBonus(0)).toBe(0);
    expect(finishBonus(0)).toBe(0);
    expect(checkpointBonus(-4)).toBe(0);
    expect(finishBonus(-4)).toBe(0);
  });

  test('bonuses are whole numbers', () => {
    expect(Number.isInteger(checkpointBonus(12.3456))).toBe(true);
    expect(Number.isInteger(finishBonus(12.3456))).toBe(true);
  });
});

describe('overtakeScore (spec §8)', () => {
  test('each overtake is 50 points', () => {
    expect(OVERTAKE_POINTS).toBe(50);
    expect(overtakeScore(0)).toBe(0);
    expect(overtakeScore(1)).toBe(50);
    expect(overtakeScore(3)).toBe(150);
  });
});
