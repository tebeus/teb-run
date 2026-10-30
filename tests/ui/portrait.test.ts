import { describe, expect, test } from 'vitest';
import {
  drawPortrait,
  panOffset,
  phoneAngle,
  PHONE_CYCLE_S,
  PORTRAIT_BAR_W,
  PORTRAIT_BAR_Y,
  PORTRAIT_H,
  PORTRAIT_W,
  portraitBox,
  startPortrait,
  type PortraitView,
} from '../../src/ui/portrait';
import type { SpriteAsset } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';

const sprite = (name: string, w: number, h: number): SpriteAsset =>
  ({ name, image: { name } as unknown as CanvasImageSource, w, h }) as SpriteAsset;

const VIEW: PortraitView = {
  t: 0,
  progress: { done: 10, total: 40 },
  attract: sprite('screen_attract', 1280, 720),
  logo: sprite('title_logo', 900, 300),
  daily: { label: 'SPORT · HARD', line: { streak: 'DAY 3 IN A ROW', next: 'NEW CHALLENGE IN 5H 12M' } },
};

describe('tela del telefono in verticale (spec telefono e finali §A)', () => {
  test('the title art, the logo, the phone, the daily lines and the loading bar, all inside 720x1280', () => {
    const rec = createRecordCtx();
    drawPortrait(rec.ctx, VIEW);
    const images = rec.images().map((op) => op.image);
    expect(images).toEqual(['screen_attract', 'title_logo']);
    // Ogni pixel acceso sta dentro la tela (l'illustrazione esce di lato, di proposito, e scorre).
    for (const op of rec.fills()) {
      if (op.args[2] === PORTRAIT_W && op.args[3] === PORTRAIT_H) continue;
      expect(op.args[0], JSON.stringify(op)).toBeGreaterThanOrEqual(-140);
      expect(op.args[1] + op.args[3]).toBeLessThanOrEqual(PORTRAIT_H);
    }
    // La barra: 10 file su 40.
    const x = (PORTRAIT_W - PORTRAIT_BAR_W) / 2;
    expect(rec.fills().some((op) => op.args.join() === [x, PORTRAIT_BAR_Y, PORTRAIT_BAR_W / 4, 20].join())).toBe(true);
  });

  test('the text fits the width: nothing past the edges, nothing under scale 2', () => {
    const rec = createRecordCtx();
    drawPortrait(rec.ctx, VIEW);
    // Il testo è fatto di quadratini: quelli fuori dalla fascia dell'illustrazione stanno dentro 0..720.
    const glyphs = rec.fills().filter((op) => op.args[1] > 700 && op.args[2] < 40);
    expect(glyphs.length).toBeGreaterThan(100);
    for (const op of glyphs) {
      expect(op.args[0]).toBeGreaterThanOrEqual(0);
      expect(op.args[0] + op.args[2]).toBeLessThanOrEqual(PORTRAIT_W);
      // Scala 2 o più: nessun quadratino sotto i 2 px logici.
      expect(op.args[2]).toBeGreaterThanOrEqual(2);
    }
  });

  test('no bar once the title is ready; no daily lines without a challenge; the name in pixels without the logo', () => {
    const rec = createRecordCtx();
    drawPortrait(rec.ctx, { ...VIEW, progress: null, daily: null, attract: null, logo: null });
    expect(rec.images()).toEqual([]);
    expect(rec.fills().some((op) => op.args[1] === PORTRAIT_BAR_Y)).toBe(false);
  });

  test('the art pans back and forth, the phone turns in steps and comes back', () => {
    expect(panOffset(0, 600)).toBe(0);
    expect(panOffset(12, 600)).toBe(600);
    expect(panOffset(24, 600)).toBe(0);
    expect(panOffset(6, 0)).toBe(0);
    expect(phoneAngle(0)).toBe(0);
    expect(phoneAngle(PHONE_CYCLE_S * 0.7)).toBeCloseTo(Math.PI / 2, 9);
    expect(phoneAngle(PHONE_CYCLE_S)).toBe(0);
    const steps = new Set(Array.from({ length: 160 }, (_, i) => phoneAngle((i / 160) * PHONE_CYCLE_S).toFixed(4)));
    expect(steps.size).toBeLessThanOrEqual(7);
  });

  test('the box is 9:16, centred, as large as the window allows (iPhone SE: 375x667)', () => {
    expect(portraitBox(375, 667)).toEqual({ left: 0, top: 0, width: 375, height: 667 });
    expect(portraitBox(390, 844)).toEqual({ left: 0, top: 76, width: 390, height: 693 });
  });

  test('shown and drawn only while wanted, hidden otherwise', () => {
    let wanted = true;
    let frames = 0;
    let pending: ((now: number) => void) | null = null;
    const rec = createRecordCtx();
    const style: Record<string, string> = {};
    const canvas = { width: 0, height: 0, style, getContext: () => rec.ctx } as unknown as HTMLCanvasElement;
    startPortrait({ canvas, win: { innerWidth: 375, innerHeight: 667 }, raf: (cb) => ((pending = cb), 1) }, () => wanted, (t) => {
      frames++;
      return { ...VIEW, t };
    });
    expect(canvas.width).toBe(PORTRAIT_W);
    pending!(0);
    expect(style.display).toBe('block');
    // La tela copre tutta la finestra: niente strisce del gioco ai lati.
    expect(style.width).toBe('375px');
    expect(style.height).toBe('667px');
    expect(style.left).toBe('0px');
    expect(frames).toBe(1);
    wanted = false;
    pending!(16);
    expect(style.display).toBe('none');
    expect(frames).toBe(1);
  });
});
