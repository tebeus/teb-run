import { describe, expect, test, vi } from 'vitest';
import { GAME_NAME } from '../../src/core/config';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { withMode } from '../../src/game/mode';
import { stepEnding } from '../../src/ui/screens/ending';
import { createGameOverScreen, stepGameOver } from '../../src/ui/screens/gameOver';
import {
  SHARE_BUTTON,
  SHARE_SCREENS,
  chooseShareAction,
  copyText,
  createShareSlot,
  isShareKey,
  shareResult,
  shareResultFrom,
  shareStatusText,
  type ShareEnv,
  type ShareNavigator,
} from '../../src/ui/share';
import { shareText, type ShareResult } from '../../src/ui/shareCard';
import type { ScreenDeps } from '../../src/ui/deps';
import type { ScoresStore } from '../../src/persist/scores';
import type { StageDef } from '../../src/types';

const stage: StageDef = { id: '2-1', name: 'Pine Pass', theme: 'alpine', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0.45 };
const result: ShareResult = {
  kind: 'gameOver',
  score: 900,
  time: 80,
  mode: 'normal',
  car: 'new',
  route: ['L', 'R'],
  stageId: '2-1',
  stageName: 'Pine Pass',
};
const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

const key = (code: string, extra: Partial<KeyboardEvent> = {}) => ({
  code,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe('the S key', () => {
  test('shares on game over and endings with a result offered', () => {
    expect(isShareKey(key('KeyS'), 'gameOver', true)).toBe(true);
    expect(isShareKey(key('KeyS'), 'ending', true)).toBe(true);
    expect(SHARE_SCREENS).toEqual(['gameOver', 'ending']);
  });

  test('does not steal S from the name entry, nor any other screen', () => {
    for (const screen of ['nameEntry', 'scores', 'title', 'radio', 'race'] as const) {
      expect(isShareKey(key('KeyS'), screen, true)).toBe(false);
    }
  });

  test('no result, other keys, repeats and modifiers do nothing', () => {
    expect(isShareKey(key('KeyS'), 'gameOver', false)).toBe(false);
    expect(isShareKey(key('KeyD'), 'gameOver', true)).toBe(false);
    expect(isShareKey(key('KeyS', { repeat: true }), 'gameOver', true)).toBe(false);
    expect(isShareKey(key('KeyS', { ctrlKey: true }), 'gameOver', true)).toBe(false);
    expect(isShareKey(key('KeyS', { metaKey: true }), 'gameOver', true)).toBe(false);
  });

  test('the button is at least 44x44 logical pixels', () => {
    expect(SHARE_BUTTON.w).toBeGreaterThanOrEqual(44);
    expect(SHARE_BUTTON.h).toBeGreaterThanOrEqual(44);
  });
});

describe('chooseShareAction', () => {
  const file = new File([png], 'a.png', { type: 'image/png' });
  test('the share sheet only if it accepts files', () => {
    const share = async () => undefined;
    expect(chooseShareAction({ share, canShare: () => true }, file)).toBe('share');
    expect(chooseShareAction({ share, canShare: () => false }, file)).toBe('download');
    expect(chooseShareAction({ share }, file)).toBe('download');
    expect(chooseShareAction({ canShare: () => true }, file)).toBe('download');
    expect(chooseShareAction({ share, canShare: () => true }, null)).toBe('download');
    expect(
      chooseShareAction(
        {
          share,
          canShare: () => {
            throw new Error('nope');
          },
        },
        file,
      ),
    ).toBe('download');
  });
});

function fakeEnv(nav: ShareNavigator) {
  const clicks: { href: string; download: string }[] = [];
  const env: ShareEnv = {
    nav,
    doc: {
      createElement: (() => {
        const a = {
          href: '',
          download: '',
          rel: '',
          style: {} as CSSStyleDeclaration,
          click: () => clicks.push({ href: a.href, download: a.download }),
          remove: () => undefined,
        };
        return a;
      }) as unknown as Document['createElement'],
      body: { appendChild: (n: Node) => n } as unknown as HTMLElement,
    },
    urls: { createObjectURL: () => 'blob:card', revokeObjectURL: vi.fn() },
    later: (fn) => fn(),
  };
  return { env, clicks };
}

describe('shareResult', () => {
  test('with a share sheet that takes files: file and text go to navigator.share, no download', async () => {
    const share = vi.fn(async (_d: ShareData) => undefined);
    const { env, clicks } = fakeEnv({ share, canShare: () => true });
    expect(await shareResult(env, png, result)).toBe('shared');
    const data = share.mock.calls[0][0];
    expect(data.text).toBe(shareText(result));
    expect(data.title).toBe(GAME_NAME);
    expect(data.files?.[0].type).toBe('image/png');
    expect(data.files?.[0].name).toMatch(/-900\.png$/);
    expect(clicks).toEqual([]);
  });

  test('without it: downloads the PNG and copies the short text', async () => {
    const writeText = vi.fn(async () => undefined);
    const { env, clicks } = fakeEnv({ clipboard: { writeText } });
    expect(await shareResult(env, png, result)).toBe('saved-copied');
    expect(clicks).toEqual([{ href: 'blob:card', download: expect.stringMatching(/-900\.png$/) }]);
    expect(writeText).toHaveBeenCalledWith(shareText(result));
    expect(env.urls.revokeObjectURL).toHaveBeenCalledWith('blob:card');
  });

  test('a refused clipboard is not an error: the PNG is saved all the same', async () => {
    const { env, clicks } = fakeEnv({ clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    expect(await shareResult(env, png, result)).toBe('saved');
    expect(clicks.length).toBe(1);
    expect(await copyText({}, 'x')).toBe(false);
  });

  test('cancelling the sheet does nothing else; another sheet error falls back to download', async () => {
    const abort = Object.assign(new Error('abort'), { name: 'AbortError' });
    const a = fakeEnv({ share: () => Promise.reject(abort), canShare: () => true });
    expect(await shareResult(a.env, png, result)).toBe('cancelled');
    expect(a.clicks).toEqual([]);
    const b = fakeEnv({ share: () => Promise.reject(new Error('NotAllowed')), canShare: () => true });
    expect(await shareResult(b.env, png, result)).toBe('saved');
    expect(b.clicks.length).toBe(1);
  });

  test('without a PNG only the text is copied', async () => {
    const { env } = fakeEnv({ clipboard: { writeText: async () => undefined } });
    expect(await shareResult(env, null, result)).toBe('copied');
    expect(await shareResult(fakeEnv({}).env, null, result)).toBe('failed');
  });

  test('every outcome has a line in the bitmap font', () => {
    for (const o of ['shared', 'saved-copied', 'saved', 'copied', 'failed'] as const) {
      expect(shareStatusText(o)).toMatch(/^[A-Z ,!]+$/);
    }
    expect(shareStatusText('cancelled')).toBe('');
  });
});

describe('the result of a screen', () => {
  test('comes from the payload, the mode from the stage, the car from the setting', () => {
    const hard = withMode(stage, 'hard');
    expect(shareResultFrom('ending', { score: 5, stage: hard, route: ['R'], time: 12.5, ending: 3 }, 'retro')).toEqual({
      kind: 'ending',
      score: 5,
      time: 12.5,
      mode: 'hard',
      car: 'retro',
      route: ['R'],
      stageId: '2-1',
      stageName: 'Pine Pass',
      ending: 3,
    });
    const r = shareResultFrom('gameOver', { score: 5, stage, route: [] }, undefined);
    expect(r.time).toBe(0);
    expect(r.mode).toBe('normal');
    expect(r.car).toBe('new');
    expect('ending' in r).toBe(false);
  });

  test('game over offers it on enter and withdraws it on exit', () => {
    const slot = createShareSlot();
    const deps = {
      assets: createEmptyAssets(),
      scores: { qualifies: () => false, load: () => [] } as unknown as ScoresStore,
      firstStage: stage,
      share: slot,
    } as unknown as ScreenDeps;
    const screen = createGameOverScreen(deps);
    screen.enter({ score: 42, stage, route: ['L'], time: 30 });
    expect(slot.current()?.score).toBe(42);
    expect(slot.current()?.time).toBe(30);
    screen.exit?.();
    expect(slot.current()).toBeNull();
  });

  test('after SHARE the screen waits for ENTER instead of timing out (the time runs only before the initials)', () => {
    const base = { t: 0, payload: { score: 1, stage, route: [] as ('L' | 'R')[] }, qualifies: true };
    expect(stepGameOver(base, 10, emptyActions(), true).transition).toBeNull();
    expect(stepGameOver(base, 10, emptyActions(), false).transition).not.toBeNull();
    expect(stepGameOver(base, 0.1, { ...emptyActions(), confirm: true }, true).transition).not.toBeNull();
    const end = { ...base, payload: { ...base.payload, ending: 0 } };
    expect(stepEnding(end, 60, emptyActions(), true).transition).toBeNull();
    expect(stepEnding(end, 60, emptyActions()).transition).not.toBeNull();
  });

  test('the slot holds only with a result, and a new offer releases it', () => {
    const slot = createShareSlot();
    const seen: (ShareResult | null)[] = [];
    slot.subscribe((r) => seen.push(r));
    slot.hold();
    expect(slot.held()).toBe(false);
    slot.offer(result);
    slot.hold();
    expect(slot.held()).toBe(true);
    slot.offer(null);
    expect(slot.held()).toBe(false);
    expect(seen).toEqual([result, null]);
  });
});
