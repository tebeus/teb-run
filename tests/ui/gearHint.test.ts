// L'aiuto marcia (spec prima tappa e ritorno §3.2, risposta 4 di Teb): in
// NORMAL, in `lo` al massimo della bassa per circa 2 s; sparisce col cambio
// e dopo il primo cambio della sessione non torna; testo secondo il
// dispositivo; in HARD mai. Non copre l'HUD in alto, i banner del bivio,
// il suggerimento dei comandi né la strada.

import { describe, expect, test } from 'vitest';
import { LOGICAL_W } from '../../src/core/canvas';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createFakeRace } from '../../src/dev/fake-race';
import { createNullAudio } from '../../src/dev/null-audio';
import { withMode } from '../../src/game/mode';
import { MAX_SPEED_LO } from '../../src/game/player';
import { createScoresStore } from '../../src/persist/scores';
import { FORK_BANNER_Y, HUD_MODE_Y } from '../../src/render/hud';
import { RACE_HINT_Y } from '../../src/ui/controlsHelp';
import {
  drawGearHint,
  GEAR_HINT_HOLD_S,
  GEAR_HINT_SCALE,
  GEAR_HINT_Y,
  gearHintText,
  gearHintVisible,
  initialGearHint,
  stepGearHint,
  type GearHintState,
} from '../../src/ui/gearHint';
import { createRaceScreen } from '../../src/ui/screens/race';
import { measureText } from '../../src/ui/text';
import type { Banner, Gear, RaceEngine, RaceSnapshot, StageDef } from '../../src/types';
import type { ScreenDeps } from '../../src/ui/deps';
import { createRecordCtx } from '../helpers/recordCtx';

const stage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 2260, timeLimit: 110, seed: 1, difficulty: 0.15 };
const snap = (gear: Gear, speed: number, over: { stage?: StageDef; banner?: Banner } = {}): RaceSnapshot =>
  ({ player: { gear, speed }, stage: over.stage ?? stage, banner: over.banner ?? 'none' }) as RaceSnapshot;
const TOP = MAX_SPEED_LO;

function run(state: GearHintState, s: RaceSnapshot, seconds: number, dt = 0.1): GearHintState {
  for (let t = 0; t < seconds - 1e-9; t += dt) state = stepGearHint(state, s, dt);
  return state;
}

describe('gear hint: when', () => {
  test('in low gear at the top of low for about 2 s', () => {
    let st = run(initialGearHint(), snap('lo', TOP), GEAR_HINT_HOLD_S - 0.2);
    expect(gearHintVisible(st, snap('lo', TOP))).toBe(false);
    st = run(st, snap('lo', TOP), 0.3);
    expect(gearHintVisible(st, snap('lo', TOP))).toBe(true);
    expect(GEAR_HINT_HOLD_S).toBe(2);
  });

  test('not below 95 % of the top of low; the count restarts after slowing down', () => {
    let st = run(initialGearHint(), snap('lo', TOP * 0.9), 5);
    expect(gearHintVisible(st, snap('lo', TOP * 0.9))).toBe(false);
    st = run(initialGearHint(), snap('lo', TOP), 1.5);
    st = run(st, snap('lo', TOP * 0.5), 0.1);
    st = run(st, snap('lo', TOP), 1.5);
    expect(gearHintVisible(st, snap('lo', TOP))).toBe(false);
  });

  test('gone with the shift, and never again in the session, even after a crash puts low gear back', () => {
    let st = run(initialGearHint(), snap('lo', TOP), 3);
    expect(gearHintVisible(st, snap('lo', TOP))).toBe(true);
    st = stepGearHint(st, snap('hi', TOP), 0.1);
    expect(gearHintVisible(st, snap('hi', TOP))).toBe(false);
    st = run(st, snap('lo', TOP), 10);
    expect(gearHintVisible(st, snap('lo', TOP))).toBe(false);
  });

  test('never in HARD; in every stage of NORMAL', () => {
    const hard = withMode(stage, 'hard');
    const st = run(initialGearHint(), snap('lo', TOP, { stage: hard }), 5);
    expect(gearHintVisible(st, snap('lo', TOP, { stage: hard }))).toBe(false);
    const later = { ...stage, id: '3-2', name: 'Cloud Ridge' };
    expect(gearHintVisible(run(initialGearHint(), snap('lo', TOP, { stage: later }), 3), snap('lo', TOP, { stage: later }))).toBe(true);
  });

  test('not over EXTEND TIME or GAME OVER', () => {
    const st = run(initialGearHint(), snap('lo', TOP), 3);
    expect(gearHintVisible(st, snap('lo', TOP, { banner: 'checkpoint' }))).toBe(false);
    expect(gearHintVisible(st, snap('lo', TOP, { banner: 'gameover' }))).toBe(false);
    expect(gearHintVisible(st, snap('lo', TOP, { banner: 'fork' }))).toBe(true);
  });
});

describe('gear hint: what and where', () => {
  test('the text names the control of the device', () => {
    expect(gearHintText('keyboard')).toBe('SHIFT FOR HIGH GEAR');
    expect(gearHintText('pad')).toBe('Y FOR HIGH GEAR');
    expect(gearHintText('touch')).toBe('TAP GEAR FOR HIGH GEAR');
  });

  test('a band in the sky: under the HUD and the fork banner, above the controls hint, inside the screen', () => {
    for (const device of ['keyboard', 'pad', 'touch'] as const) {
      const rec = createRecordCtx();
      drawGearHint(rec.ctx, device);
      const fills = rec.fills();
      const top = Math.min(...fills.map((op) => op.args[1]));
      const bottom = Math.max(...fills.map((op) => op.args[1] + op.args[3]));
      const left = Math.min(...fills.map((op) => op.args[0]));
      const right = Math.max(...fills.map((op) => op.args[0] + op.args[2]));
      expect(top).toBeGreaterThan(HUD_MODE_Y + 16);
      expect(top).toBeGreaterThanOrEqual(FORK_BANNER_Y + 40 + 8 * 4);
      expect(bottom).toBeLessThan(RACE_HINT_Y - 12);
      expect(bottom).toBeLessThan(300);
      expect(left).toBeGreaterThan(0);
      expect(right).toBeLessThan(LOGICAL_W);
      expect(measureText(gearHintText(device), GEAR_HINT_SCALE)).toBeLessThan(LOGICAL_W - 160);
    }
  });
});

describe('gear hint in the race screen', () => {
  /** Una gara finta con marcia e velocità date da fuori. */
  function screenWith(control: { gear: Gear; speed: number }, mode: 'normal' | 'hard' = 'normal', device: 'keyboard' | 'touch' = 'keyboard') {
    const first = mode === 'hard' ? withMode(stage, 'hard') : stage;
    const factory = (s: StageDef, a: ScreenDeps['assets']): RaceEngine => {
      const inner = createFakeRace(s, a);
      return {
        snapshot: () => {
          const base = inner.snapshot();
          return { ...base, player: { ...base.player, gear: control.gear, speed: control.speed } };
        },
        update: (dt, actions) => inner.update(dt, actions),
      };
    };
    const deps: ScreenDeps = {
      assets: createEmptyAssets(),
      audio: createNullAudio(),
      scores: createScoresStore(),
      raceFactory: factory,
      renderWorld: () => {},
      firstStage: first,
      device: () => device,
    };
    return createRaceScreen(deps);
  }
  const bandShown = (screen: ReturnType<typeof createRaceScreen>): boolean => {
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    return rec.fills().some((op) => op.fill === '#101018' && op.args[1] === GEAR_HINT_Y - 8);
  };

  test('shown after 2 s at the top of low, gone with the high gear, not back in the next race', () => {
    const control = { gear: 'lo' as Gear, speed: TOP };
    const screen = screenWith(control);
    screen.enter({ song: 0 });
    for (let i = 0; i < 10; i++) screen.update(0.1, emptyActions());
    expect(bandShown(screen)).toBe(false);
    for (let i = 0; i < 15; i++) screen.update(0.1, emptyActions());
    expect(bandShown(screen)).toBe(true);
    control.gear = 'hi';
    screen.update(0.1, emptyActions());
    expect(bandShown(screen)).toBe(false);
    screen.exit?.();
    control.gear = 'lo';
    screen.enter({ song: 0 });
    for (let i = 0; i < 40; i++) screen.update(0.1, emptyActions());
    expect(bandShown(screen)).toBe(false);
  });

  test('never in HARD', () => {
    const screen = screenWith({ gear: 'lo', speed: TOP }, 'hard');
    screen.enter({ song: 0 });
    for (let i = 0; i < 40; i++) screen.update(0.1, emptyActions());
    expect(bandShown(screen)).toBe(false);
  });
});
