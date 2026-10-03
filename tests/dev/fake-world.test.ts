import { describe, expect, test } from 'vitest';
import { renderFakeWorld } from '../../src/dev/fake-world';
import { snapshotFromFakeState, initialFakeRaceState } from '../../src/dev/fake-race';
import type { StageDef } from '../../src/types';

const stage: StageDef = {
  id: '0-0',
  name: 'Palm Bay',
  theme: 'beach',
  lengthSegments: 2260,
  timeLimit: 75,
  seed: 1,
  difficulty: 0.15,
};

function fakeCtx() {
  const calls: string[] = [];
  return {
    fillStyle: '',
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillRect() {
      calls.push('rect');
    },
    beginPath() {
      calls.push('begin');
    },
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      calls.push('fill');
    },
    calls,
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
}

describe('renderFakeWorld', () => {
  test('draws sky and road without throwing, for x centered, left and right', () => {
    for (const x of [0, 1, -1]) {
      const ctx = fakeCtx();
      const snap = snapshotFromFakeState({ ...initialFakeRaceState(stage), x });
      expect(() => renderFakeWorld(ctx, snap, {} as never)).not.toThrow();
      expect(ctx.calls).toContain('rect');
      expect(ctx.calls).toContain('fill');
    }
  });
});
