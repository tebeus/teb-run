import { describe, expect, test } from 'vitest';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { canFullscreen, isFullscreen, toggleFullscreen, type FullscreenDoc } from '../../src/core/fullscreen';
import {
  FS_BUTTON_SIZE,
  MIN_TOUCH_CSS,
  drawFullscreenButton,
  fullscreenButtonRect,
  inside,
  showsFullscreenButton,
  toLogical,
  touchRect,
} from '../../src/ui/launchUi';
import { createRecordCtx } from '../helpers/recordCtx';

describe('fullscreen helpers', () => {
  test('standard API: enter, then exit', () => {
    const calls: string[] = [];
    const doc: FullscreenDoc = {
      fullscreenEnabled: true,
      fullscreenElement: null,
      exitFullscreen: async () => {
        calls.push('exit');
      },
    };
    const el = {
      requestFullscreen: async () => {
        calls.push('request');
      },
    };
    expect(canFullscreen(doc, el)).toBe(true);
    expect(isFullscreen(doc)).toBe(false);
    toggleFullscreen(doc, el);
    doc.fullscreenElement = {} as Element;
    expect(isFullscreen(doc)).toBe(true);
    toggleFullscreen(doc, el);
    expect(calls).toEqual(['request', 'exit']);
  });

  test('Safari: the webkit variants', () => {
    const calls: string[] = [];
    const doc: FullscreenDoc = {
      webkitFullscreenEnabled: true,
      webkitFullscreenElement: null,
      webkitExitFullscreen: () => calls.push('webkit-exit') && undefined,
    };
    const el = { webkitRequestFullscreen: () => calls.push('webkit-request') && undefined };
    expect(canFullscreen(doc, el)).toBe(true);
    toggleFullscreen(doc, el);
    doc.webkitFullscreenElement = {} as Element;
    expect(isFullscreen(doc)).toBe(true);
    toggleFullscreen(doc, el);
    expect(calls).toEqual(['webkit-request', 'webkit-exit']);
  });

  test('no API (iPhone Safari): not available, and toggling does nothing', () => {
    expect(canFullscreen({}, {})).toBe(false);
    expect(() => toggleFullscreen({}, {})).not.toThrow();
  });

  test('a refusing or throwing browser never throws out of toggle', async () => {
    const doc: FullscreenDoc = { fullscreenEnabled: true, fullscreenElement: null };
    expect(() => toggleFullscreen(doc, { requestFullscreen: () => Promise.reject(new Error('denied')) })).not.toThrow();
    expect(() =>
      toggleFullscreen(doc, {
        requestFullscreen: () => {
          throw new Error('boom');
        },
      }),
    ).not.toThrow();
    await Promise.resolve();
  });
});

describe('fullscreen button', () => {
  test('bottom right, inside the screen, only on title and radio', () => {
    const r = fullscreenButtonRect();
    expect(r.x + r.w).toBeLessThanOrEqual(LOGICAL_W);
    expect(r.y + r.h).toBeLessThanOrEqual(LOGICAL_H);
    expect(r.x).toBeGreaterThan(LOGICAL_W / 2);
    expect(showsFullscreenButton('title', true)).toBe(true);
    expect(showsFullscreenButton('radio', true)).toBe(true);
    expect(showsFullscreenButton('race', true)).toBe(false);
    expect(showsFullscreenButton('nameEntry', true)).toBe(false);
    expect(showsFullscreenButton('title', false)).toBe(false);
  });

  test('touch area is at least 44 CSS px at any scale', () => {
    const r = fullscreenButtonRect();
    for (const k of [0.3, 0.5, 1, 1.5, 2]) {
      const t = touchRect(r, k);
      expect(t.w * k).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
      expect(t.h * k).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
      // Mai più piccola del pulsante disegnato, e centrata su di lui.
      expect(t.w).toBeGreaterThanOrEqual(FS_BUTTON_SIZE);
      expect(t.x + t.w / 2).toBeCloseTo(r.x + r.w / 2);
      expect(inside(t, r.x + r.w / 2, r.y + r.h / 2)).toBe(true);
    }
    expect(inside(touchRect(r, 1), 10, 10)).toBe(false);
  });

  test('client coordinates map back to logical pixels through the letterbox', () => {
    const box = { left: 100, top: 50, width: 640, height: 360 };
    expect(toLogical(100, 50, box)).toEqual({ x: 0, y: 0 });
    expect(toLogical(740, 410, box)).toEqual({ x: LOGICAL_W, y: LOGICAL_H });
  });

  test('the icon changes between enter and exit', () => {
    const a = createRecordCtx();
    const b = createRecordCtx();
    drawFullscreenButton(a.ctx, fullscreenButtonRect(), false);
    drawFullscreenButton(b.ctx, fullscreenButtonRect(), true);
    expect(a.fills().length).toBe(b.fills().length);
    expect(a.fills().map((op) => op.args)).not.toEqual(b.fills().map((op) => op.args));
  });
});
