// La build crazygames sulle schermate: niente pulsante dello schermo intero
// (né tasto F), niente ABOUT e niente SHARE (né tasto S), PRIVACY sì. Si
// installano i veri `installLaunchUi` e `installShareUi` con il bersaglio
// fissato come lo fissa Vite (`VITE_TARGET`), su una finestra finta, e si
// registra cosa disegnano. Lo stesso giro col bersaglio portal fa da
// controllo: lì pulsante, ABOUT e SHARE ci sono.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import type { ScreenName } from '../../src/ui/fsm';
import type { ShareResult } from '../../src/ui/shareCard';
import type { Rect } from '../../src/ui/rect';
import { createRecordCtx, type RecOp } from '../helpers/recordCtx';

type Handler = (e: Record<string, unknown>) => void;

/** Finestra, documento e canvas finti: ascoltatori, aperture e richieste di schermo intero. */
function fakePage() {
  const winHandlers = new Map<string, Handler[]>();
  const canvasHandlers = new Map<string, Handler[]>();
  const on = (map: Map<string, Handler[]>) => (name: string, fn: Handler) => map.set(name, [...(map.get(name) ?? []), fn]);
  const opened: unknown[][] = [];
  const fullscreen: string[] = [];
  const copied: string[] = [];
  const doc = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    exitFullscreen: async () => void fullscreen.push('exit'),
    documentElement: { requestFullscreen: async () => void fullscreen.push('request') },
    addEventListener: () => undefined,
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    body: { appendChild: () => undefined },
  };
  const win = {
    document: doc,
    navigator: { clipboard: { writeText: async (text: string) => void copied.push(text) } },
    performance: { now: () => 0 },
    setTimeout: () => 0,
    addEventListener: on(winHandlers),
    dispatchEvent: () => true,
    open: (...args: unknown[]) => void opened.push(args),
    location: { assign: (url: string) => void opened.push(['assign', url]) },
  } as Record<string, unknown>;
  win.top = win;
  win.self = win;
  const canvas = {
    style: { cursor: '' },
    addEventListener: on(canvasHandlers),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
  const fire = (map: Map<string, Handler[]>, name: string, e: Record<string, unknown>): void => {
    for (const fn of map.get(name) ?? []) fn({ preventDefault: () => undefined, ...e });
  };
  return {
    win: win as unknown as Window,
    canvas: canvas as unknown as HTMLCanvasElement,
    opened,
    fullscreen,
    copied,
    key: (code: string) => fire(winHandlers, 'keydown', { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false }),
    click: (x: number, y: number) => fire(canvasHandlers, 'click', { clientX: x, clientY: y }),
  };
}

const result: ShareResult = {
  kind: 'gameOver',
  score: 12345,
  time: 61.5,
  mode: 'normal',
  car: 'new',
  route: ['L'],
  stageId: '1-0',
  stageName: 'Sandstone Gate',
};

/** Le operazioni che toccano il riquadro `r`. */
const opsIn = (ops: RecOp[], r: Rect): RecOp[] =>
  ops.filter((op) => {
    if (op.type !== 'fillRect') return false;
    const [x, y, w, h] = op.args;
    return x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
  });

/** Il gioco di contorno di un bersaglio, installato su una pagina finta. */
async function installFor(target: 'portal' | 'crazygames', screen: ScreenName) {
  vi.stubEnv('VITE_TARGET', target);
  vi.resetModules();
  const launch = await import('../../src/ui/launchUi');
  const share = await import('../../src/ui/share');
  const config = await import('../../src/core/config');
  const page = fakePage();
  const launchUi = launch.installLaunchUi(page.win, page.canvas, () => screen);
  const slot = share.createShareSlot();
  const shareUi = share.installShareUi(page.win, page.canvas, () => screen, slot, createEmptyAssets());
  slot.offer(result);
  const rec = createRecordCtx();
  launchUi.draw(rec.ctx);
  shareUi.draw(rec.ctx);
  // Le posizioni dei link sono quelle della fila completa (portal), per guardare dove sarebbe ABOUT.
  const fullRow = launch.titleLinkRects([
    { label: 'PRIVACY', url: config.PRIVACY_URL },
    { label: 'ABOUT', url: config.ABOUT_URL },
  ]);
  return { launch, share, config, page, rec, fullRow, shareUi };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('crazygames build: title', () => {
  test('control: portal draws the fullscreen button and both links', async () => {
    const { launch, rec, fullRow } = await installFor('portal', 'title');
    expect(opsIn(rec.ops, launch.fullscreenButtonRect()).length).toBeGreaterThan(0);
    expect(opsIn(rec.ops, fullRow[0]).length).toBeGreaterThan(0);
    expect(opsIn(rec.ops, fullRow[1]).length).toBeGreaterThan(0);
  });

  test('no fullscreen button, no ABOUT; PRIVACY drawn where it always was', async () => {
    const { launch, rec, fullRow } = await installFor('crazygames', 'title');
    expect(launch.TITLE_LINKS.map((l) => l.label)).toEqual(['PRIVACY']);
    expect(opsIn(rec.ops, launch.fullscreenButtonRect())).toEqual([]);
    expect(opsIn(rec.ops, fullRow[1])).toEqual([]);
    expect(opsIn(rec.ops, fullRow[0]).length).toBeGreaterThan(0);
  });

  test('F and a click on the button corner ask for no fullscreen; PRIVACY opens in a new tab', async () => {
    const { launch, config, page, fullRow } = await installFor('crazygames', 'title');
    page.key('KeyF');
    const fs = launch.fullscreenButtonRect();
    page.click(fs.x + fs.w / 2, fs.y + fs.h / 2);
    expect(page.fullscreen).toEqual([]);
    page.click(fullRow[1].x + fullRow[1].w / 2, fullRow[1].y + fullRow[1].h / 2);
    expect(page.opened).toEqual([]);
    page.click(fullRow[0].x + fullRow[0].w / 2, fullRow[0].y + fullRow[0].h / 2);
    expect(page.opened).toEqual([[config.PRIVACY_URL, '_blank', 'noopener,noreferrer']]);
  });

  test('the mouse leaves the links and the fullscreen button to launchUi (hits), and nothing else', async () => {
    for (const target of ['portal', 'crazygames'] as const) {
      const { launch, fullRow } = await installFor(target, 'title');
      // The real one, not the fake page: hits() reads the canvas box.
      const ui = launch.installLaunchUi(fakePage().win, fakePage().canvas, () => 'title');
      const fs = launch.fullscreenButtonRect();
      expect(ui.hits({ x: fullRow[0].x + 4, y: fullRow[0].y + 4 })).toBe(true);
      expect(ui.hits({ x: fs.x + fs.w / 2, y: fs.y + fs.h / 2 })).toBe(target === 'portal');
      expect(ui.hits({ x: 640, y: 300 })).toBe(false);
    }
  });

  test('control: in portal F asks for fullscreen', async () => {
    const { page } = await installFor('portal', 'title');
    page.key('KeyF');
    expect(page.fullscreen).toEqual(['request']);
  });

  test('no fullscreen button on the radio either', async () => {
    const { launch, rec } = await installFor('crazygames', 'radio');
    expect(opsIn(rec.ops, launch.fullscreenButtonRect())).toEqual([]);
  });
});

describe('crazygames build: end of the game', () => {
  /** S, poi un clic sul pulsante, e il tempo per l'azione (asincrona) di finire. */
  const pressShare = async (page: ReturnType<typeof fakePage>, button: Rect): Promise<void> => {
    page.key('KeyS');
    page.click(button.x + 20, button.y + 20);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  for (const screen of ['gameOver', 'ending'] as const) {
    test(`control: portal draws SHARE on ${screen}, and S copies the text with the site address`, async () => {
      const { share, config, page, rec, shareUi } = await installFor('portal', screen);
      expect(opsIn(rec.ops, share.SHARE_BUTTON).length).toBeGreaterThan(0);
      expect(shareUi.hits({ x: share.SHARE_BUTTON.x + 9, y: share.SHARE_BUTTON.y + 9 })).toBe(true);
      expect(shareUi.hits({ x: 640, y: 300 })).toBe(false);
      await pressShare(page, share.SHARE_BUTTON);
      expect(page.copied).toHaveLength(1);
      expect(page.copied[0]).toContain(config.SITE_URL);
    });

    test(`no SHARE on ${screen}: nothing drawn, S and a click share nothing`, async () => {
      const { share, page, rec } = await installFor('crazygames', screen);
      const b = share.SHARE_BUTTON;
      expect(share.installShareUi(page.win, page.canvas, () => screen, share.createShareSlot(), createEmptyAssets()).hits({ x: b.x + 9, y: b.y + 9 })).toBe(false);
      expect(rec.ops).toEqual([]);
      await pressShare(page, share.SHARE_BUTTON);
      expect(page.copied).toEqual([]);
      expect(page.opened).toEqual([]);
    });
  }
});
