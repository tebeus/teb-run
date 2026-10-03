import { describe, expect, test } from 'vitest';
import { LOGICAL_W } from '../../src/core/canvas';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createScoresStore } from '../../src/persist/scores';
import {
  DRIVE_LINES,
  RACE_HINT_SECONDS,
  raceHintAlpha,
  raceHintLines,
  radioChangeLine,
  radioControlLines,
  radioMenuLine,
} from '../../src/ui/controlsHelp';
import { pauseHintLine } from '../../src/ui/pause';
import { createRaceScreen } from '../../src/ui/screens/race';
import { GLYPHS, measureText } from '../../src/ui/text';
import type { ScreenDeps } from '../../src/ui/deps';
import type { InputDevice } from '../../src/core/device';
import type { AudioBus, RaceEngine, RaceSnapshot, StageDef } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';

const DEVICES: InputDevice[] = ['keyboard', 'pad', 'touch'];

describe('righe dei comandi', () => {
  test('ogni testo sta nello schermo e usa solo glifi del font bitmap', () => {
    const all = DEVICES.flatMap((d) => [
      ...radioControlLines(d),
      radioMenuLine(d),
      radioChangeLine(d, 'C'),
      radioChangeLine(d, 'D'),
      ...raceHintLines(d),
      ...raceHintLines(d, true),
      pauseHintLine(d),
    ]);
    for (const line of all) {
      expect(measureText(line, 2)).toBeLessThanOrEqual(LOGICAL_W - 40);
      for (const ch of line) expect(GLYPHS[ch], `${ch} in ${line}`).toBeDefined();
    }
  });

  test('la radio mette prima la riga del dispositivo in uso', () => {
    expect(radioControlLines('keyboard')).toEqual([DRIVE_LINES.keyboard, DRIVE_LINES.pad]);
    expect(radioControlLines('pad')).toEqual([DRIVE_LINES.pad, DRIVE_LINES.keyboard]);
    expect(radioControlLines('touch')).toEqual([DRIVE_LINES.touch]);
  });

  test('i comandi giusti per il dispositivo', () => {
    expect(raceHintLines('keyboard').join(' ')).toContain('SHIFT GEAR');
    expect(raceHintLines('pad').join(' ')).toContain('STICK');
    expect(raceHintLines('touch').join(' ')).toContain('HOLD GAS');
    // Con TILT acceso le frecce non ci sono: il suggerimento dice di inclinare il telefono.
    expect(raceHintLines('touch', true).join(' ')).toContain('TILT THE PHONE TO STEER');
    expect(raceHintLines('touch', true).join(' ')).not.toContain('<');
    expect(raceHintLines('keyboard', true)).toEqual(raceHintLines('keyboard'));
    expect(radioMenuLine('keyboard')).toBe('LEFT RIGHT TO CHOOSE, ENTER TO START');
    expect(radioChangeLine('keyboard', 'C')).toBe('C TO CHANGE');
    expect(pauseHintLine()).toBe('UP/DOWN + ENTER   ESC/P TO RESUME');
  });

  test('il suggerimento entra, resta e se ne va', () => {
    expect(raceHintAlpha(-1)).toBe(0);
    expect(raceHintAlpha(0)).toBe(0);
    expect(raceHintAlpha(2)).toBe(1);
    expect(raceHintAlpha(RACE_HINT_SECONDS - 0.5)).toBeCloseTo(0.5);
    expect(raceHintAlpha(RACE_HINT_SECONDS)).toBe(0);
    expect(raceHintAlpha(Number.NaN)).toBe(0);
  });
});

describe('suggerimento in gara', () => {
  const stage: StageDef = {
    id: '0-0',
    name: 'Palm Bay',
    theme: 'beach',
    lengthSegments: 100,
    timeLimit: 75,
    seed: 1,
    difficulty: 0.1,
  };
  const snap = {
    segments: [],
    player: { x: 0, z: 0, speed: 0, gear: 'lo', steer: 0, offRoad: false, braking: false, accelerating: false, surface: 'road', skidding: false, steerHeld: 0 },
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 75,
    score: 0,
    stage,
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme: 'beach',
    banner: 'none',
    kmh: 0,
  } as unknown as RaceSnapshot;
  const engine: RaceEngine = { update: () => [], snapshot: () => snap };
  const audio = {
    unlock() {},
    playSong() {},
    stopSong() {},
    sfx() {},
    setEngine() {},
    setSkid() {},
    setRumble() {},
    toggleMute: () => false,
    muted: false,
    available: true,
  } as AudioBus;
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
    audio,
    scores: createScoresStore(),
    raceFactory: () => engine,
    renderWorld: () => {},
    firstStage: stage,
    device: () => 'touch',
  };

  /** Quanti pixel gialli del suggerimento disegna la gara dopo `seconds` secondi. */
  function hintPixels(screen: ReturnType<typeof createRaceScreen>, seconds: number): number {
    for (let t = 0; t < seconds; t += 0.5) screen.update(0.5, emptyActions());
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    return rec.ops.filter((op) => op.fill === '#ffee55').length;
  }

  test('solo nella prima gara, e sparisce dopo qualche secondo', () => {
    const screen = createRaceScreen(deps);
    screen.enter({ song: 0 });
    expect(hintPixels(screen, 1)).toBeGreaterThan(0);
    expect(hintPixels(screen, RACE_HINT_SECONDS)).toBe(0);
    screen.exit?.();
    screen.enter({ song: 0 });
    expect(hintPixels(screen, 1)).toBe(0);
  });
});
