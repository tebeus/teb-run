import { describe, expect, test } from 'vitest';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { ABOUT_URL, PRIVACY_URL } from '../../src/core/config';
import { featuresOf } from '../../src/core/target';
import {
  LINK_MIN_LOGICAL,
  MIN_TOUCH_CSS,
  TITLE_LINKS,
  drawTitleLinks,
  fullscreenButtonRect,
  linkTarget,
  openLink,
  titleLinkRects,
  touchRect,
} from '../../src/ui/launchUi';
import { createRecordCtx } from '../helpers/recordCtx';

describe('title links', () => {
  test('privacy and about, from the config constants', () => {
    expect(TITLE_LINKS.map((l) => l.url)).toEqual([PRIVACY_URL, ABOUT_URL]);
    expect(TITLE_LINKS.map((l) => l.label)).toEqual(['PRIVACY', 'ABOUT']);
  });

  test('small, bottom left, in a row, clear of the fullscreen button', () => {
    const rects = titleLinkRects();
    const fs = fullscreenButtonRect();
    for (const r of rects) {
      expect(r.h).toBe(16);
      expect(r.y + r.h).toBeLessThanOrEqual(LOGICAL_H);
      expect(r.x + r.w).toBeLessThan(LOGICAL_W / 2);
      expect(r.x + r.w).toBeLessThan(fs.x);
    }
    expect(rects[1].x).toBeGreaterThan(rects[0].x + rects[0].w);
    // Area di clic alta almeno 44 px logici, e 44 px CSS quando si rimpicciolisce.
    const t = touchRect(rects[0], 1, LINK_MIN_LOGICAL);
    expect(t.h).toBeGreaterThanOrEqual(LINK_MIN_LOGICAL);
    expect(touchRect(rects[0], 0.5, LINK_MIN_LOGICAL).h * 0.5).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
  });

  test('portal opens a new tab; site inside an iframe opens in the page around it; else same tab', () => {
    expect(linkTarget(featuresOf('portal'), false)).toBe('_blank');
    expect(linkTarget(featuresOf('portal'), true)).toBe('_blank');
    expect(linkTarget(featuresOf('site'), true)).toBe('_top');
    expect(linkTarget(featuresOf('site'), false)).toBe('_self');
    expect(linkTarget(featuresOf('private'), false)).toBe('_self');
  });

  test('a new tab gets noopener, the same tab is a plain navigation', () => {
    const calls: unknown[][] = [];
    const win = {
      open: (...args: unknown[]) => {
        calls.push(['open', ...args]);
        return null;
      },
      location: { assign: (url: string) => calls.push(['assign', url]) },
    } as unknown as Pick<Window, 'open' | 'location'>;
    openLink(win, PRIVACY_URL, '_blank');
    openLink(win, ABOUT_URL, '_top');
    openLink(win, ABOUT_URL, '_self');
    expect(calls).toEqual([
      ['open', PRIVACY_URL, '_blank', 'noopener,noreferrer'],
      ['open', ABOUT_URL, '_top'],
      ['assign', ABOUT_URL],
    ]);
  });

  test('drawn with an underline under each label', () => {
    const r = createRecordCtx();
    const rects = titleLinkRects();
    drawTitleLinks(r.ctx, rects);
    for (const rect of rects) {
      const underline = r.fills().find((op) => op.fill === '#cccccc' && op.args[0] === rect.x && op.args[1] === rect.y + rect.h + 2);
      expect(underline?.args[2]).toBe(rect.w);
    }
  });
});
