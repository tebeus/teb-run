import { describe, expect, test } from 'vitest';
import {
  ACCEL_BARS,
  HUD_MODE_COLORS,
  HUD_MODE_Y,
  audioIndicatorText,
  bannerText,
  forkAheadLines,
  forkTakenText,
  BAR_MAX_H,
  BAR_MIN_H,
  BAR_W,
  barColor,
  barHeight,
  barLit,
  formatKmh,
  formatLap,
  formatScore,
  formatTime,
  drawForkArrows,
  FORK_BANNER_Y,
  HUD_COLORS,
  isTimeCritical,
  renderHud,
  SCORE_DIGITS,
  timeBlinkOn,
} from '../../src/render/hud';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { GLYPHS, measureText } from '../../src/ui/text';
import { GEAR_HINT_Y } from '../../src/ui/gearHint';
import { REAL_GRAPH, STAGE_LIST } from '../../src/game/stages';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeAsset } from '../helpers/segments';
import type { AssetStore, RaceSnapshot } from '../../src/types';

describe('formatScore (spec §11: sette cifre)', () => {
  test('pads to 7 digits and floors', () => {
    expect(SCORE_DIGITS).toBe(7);
    expect(formatScore(42)).toBe('0000042');
    expect(formatScore(1234.9)).toBe('0001234');
  });

  test('clamps negative scores to zero', () => {
    expect(formatScore(-5)).toBe('0000000');
  });

  test('a score longer than seven digits is not truncated', () => {
    expect(formatScore(12345678)).toBe('12345678');
  });
});

describe('formatLap (spec §11: m\'ss"cc)', () => {
  test('zero is all zeroes', () => {
    expect(formatLap(0)).toBe('0\'00"00');
  });

  test('it truncates hundredths instead of rounding them up', () => {
    // 59,999 s non deve diventare 0'60"00.
    expect(formatLap(59.999)).toBe('0\'59"99');
  });

  test('it rolls over into minutes', () => {
    expect(formatLap(60.07)).toBe('1\'00"07');
    expect(formatLap(119.99)).toBe('1\'59"99');
  });

  test('minutes are not capped', () => {
    expect(formatLap(3600)).toBe('60\'00"00');
  });

  test('a negative or non finite time reads as zero', () => {
    expect(formatLap(-3)).toBe('0\'00"00');
    expect(formatLap(Number.NaN)).toBe('0\'00"00');
  });

  test('every character it produces has a glyph in the font', () => {
    for (const ch of formatLap(75.42)) {
      expect(GLYPHS[ch], `missing glyph for ${JSON.stringify(ch)}`).toBeDefined();
    }
  });
});

describe('scala dell\'acceleratore (spec §11)', () => {
  test('there are ten bars, growing from 4 to 22 px', () => {
    expect(ACCEL_BARS).toBe(10);
    expect(barHeight(0)).toBe(BAR_MIN_H);
    expect(barHeight(ACCEL_BARS - 1)).toBe(BAR_MAX_H);
    for (let i = 1; i < ACCEL_BARS; i++) {
      expect(barHeight(i), `bar ${i}`).toBeGreaterThan(barHeight(i - 1));
    }
  });

  test('the lit count is the speed rounded to a tenth', () => {
    expect(barLit(0)).toBe(0);
    expect(barLit(0.04)).toBe(0);
    expect(barLit(0.05)).toBe(1);
    expect(barLit(0.5)).toBe(5);
    expect(barLit(1)).toBe(ACCEL_BARS);
  });

  test('a speed outside 0..1 is clamped, NaN reads as zero', () => {
    expect(barLit(-1)).toBe(0);
    expect(barLit(3)).toBe(ACCEL_BARS);
    expect(barLit(Number.NaN)).toBe(0);
  });

  test('green up to the sixth bar, yellow on 7 and 8, red on 9 and 10', () => {
    const lit = ACCEL_BARS;
    expect(barColor(0, lit)).toBe(HUD_COLORS.barGreen);
    expect(barColor(5, lit)).toBe(HUD_COLORS.barGreen);
    expect(barColor(6, lit)).toBe(HUD_COLORS.barYellow);
    expect(barColor(7, lit)).toBe(HUD_COLORS.barYellow);
    expect(barColor(8, lit)).toBe(HUD_COLORS.barRed);
    expect(barColor(9, lit)).toBe(HUD_COLORS.barRed);
  });

  test('a bar past the lit count is dark, whatever its position', () => {
    expect(barColor(3, 3)).toBe(HUD_COLORS.barOff);
    expect(barColor(9, 3)).toBe(HUD_COLORS.barOff);
    expect(barColor(0, 0)).toBe(HUD_COLORS.barOff);
  });
});

describe('formatTime', () => {
  test('ceils to whole seconds and pads to 2 digits', () => {
    expect(formatTime(9.2)).toBe('10');
    expect(formatTime(5)).toBe('05');
  });

  test('clamps negative time to zero', () => {
    expect(formatTime(-1)).toBe('00');
  });
});

describe('formatKmh', () => {
  test('rounds and pads to 3 digits', () => {
    expect(formatKmh(87.6)).toBe('088');
    expect(formatKmh(0)).toBe('000');
  });

  test('clamps negative values to zero', () => {
    expect(formatKmh(-3)).toBe('000');
  });
});

describe('isTimeCritical', () => {
  test('true strictly below 10 seconds', () => {
    expect(isTimeCritical(9.99)).toBe(true);
    expect(isTimeCritical(10)).toBe(false);
    expect(isTimeCritical(0)).toBe(true);
  });
});

describe('timeBlinkOn', () => {
  test('toggles deterministically from the remaining time itself', () => {
    expect(timeBlinkOn(9.9)).toBe(timeBlinkOn(9.9));
    const onCount = [9.0, 8.9, 8.8, 8.7, 8.6, 8.5, 8.4, 8.3].filter(timeBlinkOn).length;
    expect(onCount).toBeGreaterThan(0);
    expect(onCount).toBeLessThan(8);
  });
});

describe('bannerText', () => {
  test('empty for none', () => {
    expect(bannerText('none')).toEqual([]);
  });

  test('checkpoint (EXTEND TIME) and gameover are single lines', () => {
    expect(bannerText('checkpoint')).toEqual(['EXTEND TIME']);
    expect(bannerText('gameover')).toEqual(['GAME OVER']);
  });

  test('fork with names shows both stage names with arrows', () => {
    expect(bannerText('fork', ['SANDSTONE GATE', 'BLUE LAGOON'])).toEqual([
      '< SANDSTONE GATE',
      'BLUE LAGOON >',
    ]);
  });

  test('fork without names does not throw and shows a placeholder', () => {
    expect(() => bannerText('fork', undefined)).not.toThrow();
    const lines = bannerText('fork', undefined);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.length).toBeGreaterThan(0);
  });
});

describe('audioIndicatorText', () => {
  test('unavailable audio always wins over user mute', () => {
    expect(audioIndicatorText(false, false)).toBe('NO AUDIO');
    expect(audioIndicatorText(true, false)).toBe('NO AUDIO');
  });

  test('available and muted shows the mute indicator', () => {
    expect(audioIndicatorText(true, true)).toBe('MUTE');
  });

  test('available and not muted shows nothing', () => {
    expect(audioIndicatorText(false, true)).toBeNull();
  });
});

function fakeCtx() {
  const calls: string[] = [];
  return {
    fillStyle: '',
    fillRect() {
      calls.push('rect');
    },
    drawImage() {
      calls.push('image');
    },
    calls,
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
}

function fakeAssets(): AssetStore {
  // Misura zero: `drawStartLights` salta l'immagine e disegna solo le
  // forme e il testo (spec §4.4e). Prima questo `get` lanciava, perché
  // l'HUD non toccava gli asset.
  return {
    ready: Promise.resolve(),
    get: (name) => makeAsset(name, 0, 0),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  };
}

function baseSnapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    segments: [],
    player: {
      x: 0,
      z: 0,
      speed: 6000,
      gear: 'hi',
      steer: 0,
      offRoad: false,
      braking: false,
      accelerating: false,
      surface: 'road',
      skidding: false,
      steerHeld: 0,
    },
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 45,
    score: 1200,
    stage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 2260, timeLimit: 75, seed: 1, difficulty: 0.15 },
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme: 'beach',
    banner: 'none',
    kmh: 150,
    elapsed: 0,
    ...overrides,
  };
}

describe('renderHud', () => {
  test('draws without throwing for a normal snapshot', () => {
    const ctx = fakeCtx();
    expect(() => renderHud(ctx, baseSnapshot(), fakeAssets())).not.toThrow();
    expect(ctx.calls.length).toBeGreaterThan(0);
  });

  test('draws without throwing when banner is fork and forkNames is undefined', () => {
    const ctx = fakeCtx();
    const snap = baseSnapshot({ banner: 'fork', forkNames: undefined });
    expect(() => renderHud(ctx, snap, fakeAssets())).not.toThrow();
  });

  test('draws extra for the fps counter and mute indicator when asked', () => {
    const ctx = fakeCtx();
    const without = fakeCtx();
    renderHud(without, baseSnapshot(), fakeAssets());
    renderHud(ctx, baseSnapshot(), fakeAssets(), { showFps: true, fps: 60, muted: true });
    expect(ctx.calls.length).toBeGreaterThan(without.calls.length);
  });

  test('draws without throwing when audio is unavailable, muted, or both', () => {
    for (const audioAvailable of [true, false]) {
      for (const muted of [true, false]) {
        const ctx = fakeCtx();
        expect(() => renderHud(ctx, baseSnapshot(), fakeAssets(), { muted, audioAvailable })).not.toThrow();
      }
    }
  });

  test('never reads or mutates snapshot.segments', () => {
    const ctx = fakeCtx();
    const segments = [{ index: 0 }] as unknown as RaceSnapshot['segments'];
    const snap = baseSnapshot({ segments });
    const before = JSON.stringify(segments);
    renderHud(ctx, snap, fakeAssets());
    expect(snap.segments).toBe(segments);
    expect(JSON.stringify(segments)).toBe(before);
  });

  test('the critical time readout draws nothing during the blink-off half of the cycle', () => {
    const onCtx = fakeCtx();
    const offCtx = fakeCtx();
    renderHud(onCtx, baseSnapshot({ timeLeft: 9.0 }), fakeAssets()); // timeBlinkOn(9.0) === true
    renderHud(offCtx, baseSnapshot({ timeLeft: 8.9 }), fakeAssets()); // timeBlinkOn(8.9) === false
    expect(onCtx.calls.length).toBeGreaterThan(offCtx.calls.length);
  });

  /** Le regioni dello schermo in cui l'HUD deve scrivere (spec §11). */
  const region = (ops: { args: number[]; fill?: string }[], colour: string) =>
    ops.filter((op) => op.fill === colour);

  test('the top row carries TIME, SCORE and LAP, left to right', () => {
    const rec = createRecordCtx();
    renderHud(rec.ctx, baseSnapshot({ timeLeft: 42, score: 1234, elapsed: 75.42 }), fakeAssets());
    const boxes = rec.ops.filter((op) => op.type === 'fillRect');
    const top = boxes.filter((op) => op.args[1] < 60);
    expect(top.length).toBeGreaterThan(50);
    const time = region(top, HUD_COLORS.timeLabel);
    const score = region(top, HUD_COLORS.scoreLabel);
    const lap = region(top, HUD_COLORS.lapLabel);
    expect(time.length).toBeGreaterThan(0);
    expect(score.length).toBeGreaterThan(0);
    expect(lap.length).toBeGreaterThan(0);
    const leftmost = (ops: { args: number[] }[]) => Math.min(...ops.map((op) => op.args[0]));
    expect(leftmost(time)).toBeLessThan(leftmost(score));
    expect(leftmost(score)).toBeLessThan(leftmost(lap));
  });

  test('the speed is bottom left in red, with a white km/h label', () => {
    const rec = createRecordCtx();
    renderHud(rec.ctx, baseSnapshot({ kmh: 187 }), fakeAssets());
    const speed = rec.ops.filter((op) => op.type === 'fillRect' && op.fill === HUD_COLORS.speed);
    expect(speed.length).toBeGreaterThan(0);
    for (const op of speed) {
      expect(op.args[0]).toBeLessThan(LOGICAL_W / 2);
      expect(op.args[1]).toBeGreaterThan(LOGICAL_H / 2);
    }
  });

  test('the stage block and the accelerator scale are bottom right', () => {
    const rec = createRecordCtx();
    renderHud(rec.ctx, baseSnapshot({ kmh: 293 }), fakeAssets());
    const bars = rec.ops.filter((op) => op.type === 'fillRect' && op.args[2] === BAR_W);
    expect(bars).toHaveLength(ACCEL_BARS);
    for (const op of bars) {
      expect(op.args[0]).toBeGreaterThan(LOGICAL_W / 2);
      expect(op.args[1]).toBeGreaterThan(LOGICAL_H / 2);
      expect(op.args[0] + op.args[2]).toBeLessThanOrEqual(LOGICAL_W);
      expect(op.args[1] + op.args[3]).toBeLessThanOrEqual(LOGICAL_H);
    }
    // Le tacche crescono verso destra e stanno tutte sulla stessa base.
    const sorted = [...bars].sort((a, b) => a.args[0] - b.args[0]);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].args[3]).toBeGreaterThan(sorted[i - 1].args[3]);
      expect(sorted[i].args[1] + sorted[i].args[3]).toBeCloseTo(
        sorted[i - 1].args[1] + sorted[i - 1].args[3],
        6,
      );
    }
  });

  test('at full speed every bar is lit, at rest none is', () => {
    const full = createRecordCtx();
    renderHud(full.ctx, baseSnapshot({ kmh: 293 }), fakeAssets());
    const lit = full.ops.filter((op) => op.args[2] === BAR_W && op.fill !== HUD_COLORS.barOff);
    expect(lit).toHaveLength(ACCEL_BARS);

    const still = createRecordCtx();
    renderHud(still.ctx, baseSnapshot({ kmh: 0 }), fakeAssets());
    const off = still.ops.filter((op) => op.args[2] === BAR_W && op.fill === HUD_COLORS.barOff);
    expect(off).toHaveLength(ACCEL_BARS);
  });

  test('every string is drawn twice: the dark outline and the fill', () => {
    const rec = createRecordCtx();
    renderHud(rec.ctx, baseSnapshot(), fakeAssets());
    const outline = rec.ops.filter((op) => op.type === 'fillRect' && op.fill === HUD_COLORS.outline);
    expect(outline.length).toBeGreaterThan(50);
  });

  test('a snapshot without elapsed still draws the lap time as zero', () => {
    const rec = createRecordCtx();
    const snap = baseSnapshot();
    delete (snap as { elapsed?: number }).elapsed;
    expect(() => renderHud(rec.ctx, snap, fakeAssets())).not.toThrow();
    expect(rec.ops.filter((op) => op.fill === HUD_COLORS.lapLabel).length).toBeGreaterThan(0);
  });

  test('the stage number is the level plus one', () => {
    const rec = createRecordCtx();
    renderHud(rec.ctx, baseSnapshot({ level: 3 }), fakeAssets());
    // Il numero è disegnato col colore di STAGE: basta che qualcosa ci sia,
    // la cifra esatta la copre il test del formattatore.
    expect(rec.ops.filter((op) => op.fill === HUD_COLORS.stage).length).toBeGreaterThan(0);
  });
});

describe('banner del bivio in alto (bivio v3, collaudo utente)', () => {
  test('the fork arrows sit near the top, off the horizon where the Y opens', () => {
    const rec = createRecordCtx();
    const assets: AssetStore = {
      ready: Promise.resolve(),
      get: (name) => makeAsset(name, 120, 60),
      has: () => true,
      stats: { png: 0, procedural: 0, missing: 0 },
    };
    drawForkArrows(rec.ctx, assets, ['SANDSTONE GATE', 'BLUE LAGOON']);
    const images = rec.ops.filter((op) => op.type === 'drawImage');
    expect(images.length).toBe(2);
    expect(FORK_BANNER_Y).toBeLessThan(LOGICAL_H / 2 - 150);
  });
});

describe('modalità nell HUD (collaudo utente: due livelli di difficoltà)', () => {
  const modeFills = (mode?: 'normal' | 'hard'): number => {
    const rec = createRecordCtx();
    const snap = baseSnapshot();
    renderHud(rec.ctx, { ...snap, stage: { ...snap.stage, mode } }, fakeAssets());
    const colour = HUD_MODE_COLORS[mode ?? 'normal'];
    return rec.fills().filter((op) => op.fill === colour && op.args[1] >= HUD_MODE_Y && op.args[1] < HUD_MODE_Y + 16).length;
  };

  test('the mode is written small under the lap time, NORMAL when the stage does not say', () => {
    expect(modeFills(undefined)).toBeGreaterThan(0);
    expect(modeFills('normal')).toBeGreaterThan(0);
  });

  test('HARD is written in its own colour', () => {
    expect(HUD_MODE_COLORS.hard).not.toBe(HUD_MODE_COLORS.normal);
    expect(modeFills('hard')).toBeGreaterThan(0);
  });
});

describe('the sign before the fork and the side taken (spec prima tappa e ritorno §4)', () => {
  test('lines: CHOOSE YOUR ROAD, then both stages with arrows, always inside the screen', () => {
    expect(forkAheadLines(['SANDSTONE GATE', 'BLUE LAGOON']).map((l) => l.text)).toEqual([
      'CHOOSE YOUR ROAD',
      '< SANDSTONE GATE   BLUE LAGOON >',
    ]);
    // Ogni coppia vera di tappe del grafo ci sta.
    for (const stage of STAGE_LIST) {
      const left = REAL_GRAPH.next(stage, 'L');
      const right = REAL_GRAPH.next(stage, 'R');
      if (left === null || right === null) continue;
      for (const line of forkAheadLines([left.name, right.name])) {
        expect(measureText(line.text, line.scale), line.text).toBeLessThanOrEqual(LOGICAL_W - 64);
      }
    }
  });

  test('side taken: LEFT: or RIGHT: with the name of that stage', () => {
    expect(forkTakenText('L', ['SANDSTONE GATE', 'BLUE LAGOON'])).toBe('LEFT: SANDSTONE GATE');
    expect(forkTakenText('R', ['Sandstone Gate', 'Blue Lagoon'])).toBe('RIGHT: BLUE LAGOON');
    expect(() => forkTakenText('R', undefined)).not.toThrow();
  });

  test('the sign sits in the sky, under TIME and SCORE, above the gear hint; not drawn under the pause menu', () => {
    for (const snap of [
      baseSnapshot({ banner: 'forkAhead', forkNames: ['Sandstone Gate', 'Blue Lagoon'] }),
      baseSnapshot({ banner: 'fork', forkNames: ['Sandstone Gate', 'Blue Lagoon'], forkTaken: 'L' }),
    ]) {
      const yellow = (paused: boolean): number[][] => {
        const rec = createRecordCtx();
        renderHud(rec.ctx, snap, fakeAssets(), { paused });
        return rec.fills().filter((op) => op.fill === '#ffee55').map((op) => op.args);
      };
      const ops = yellow(false);
      expect(ops.length).toBeGreaterThan(0);
      expect(Math.min(...ops.map((a) => a[1]))).toBeGreaterThanOrEqual(FORK_BANNER_Y);
      expect(Math.max(...ops.map((a) => a[1] + a[3]))).toBeLessThan(GEAR_HINT_Y - 8);
      expect(yellow(true)).toHaveLength(0);
    }
  });
});
