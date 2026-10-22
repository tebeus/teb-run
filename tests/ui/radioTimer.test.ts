// Timer della radio: solo nella build crazygames. Dieci secondi a vista, un
// input non lo azzera, allo zero si parte col brano scelto; fermo mentre iOS
// chiede il permesso dei sensori. Nelle altre build la radio aspetta come
// sempre e non disegna niente di nuovo.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createScoresStore } from '../../src/persist/scores';
import { createRecordCtx, type RecOp } from '../helpers/recordCtx';
import type { ScreenDeps } from '../../src/ui/deps';
import type { InputDevice } from '../../src/core/device';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function radioFor(target: 'portal' | 'crazygames', opts: { asking?: () => boolean; device?: InputDevice } = {}) {
  vi.stubEnv('VITE_TARGET', target);
  vi.resetModules();
  const radio = await import('../../src/ui/screens/radio');
  const fsm = await import('../../src/ui/fsm');
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
    audio: {
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
    },
    scores: createScoresStore(),
    raceFactory: () => {
      throw new Error('unused');
    },
    renderWorld: () => {},
    firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    tiltAsking: opts.asking,
    device: () => opts.device ?? 'keyboard',
  };
  const screen = radio.createRadioScreen(deps);
  screen.enter();
  return { radio, screen, go: fsm.go };
}

/** Le operazioni nell'angolo in alto a destra, oltre la riga KEYS che finisce a x 1144 (computer) o fra BACK e il titolo (tocco). */
const inCorner = (ops: RecOp[], touch: boolean): RecOp[] =>
  ops.filter((op) => op.type === 'fillRect' && op.args[1] < 100 && (touch ? op.args[0] > 216 && op.args[0] < 360 : op.args[0] > 1150) && op.args[2] < 100);

describe('radio timer', () => {
  test('the numbers: 10 at the start, 1 in the last second, 0 at the end', async () => {
    const { radio } = await radioFor('crazygames');
    expect(radio.RADIO_TIMER_SECONDS).toBe(10);
    expect(radio.radioTimerShown(0)).toBe(10);
    expect(radio.radioTimerShown(0.5)).toBe(10);
    expect(radio.radioTimerShown(9.5)).toBe(1);
    expect(radio.radioTimerShown(10)).toBe(0);
    expect(radio.radioTimerExpired(9.99)).toBe(false);
    expect(radio.radioTimerExpired(10)).toBe(true);
  });

  test('crazygames: at zero the race starts with the song chosen; an input does not reset it', async () => {
    const { screen, go } = await radioFor('crazygames');
    for (let i = 0; i < 5; i++) expect(screen.update(1, emptyActions())).toBeNull();
    expect(screen.update(1 / 60, { ...emptyActions(), right: true })).toBeNull();
    let t = null;
    for (let i = 0; i < 6 && t === null; i++) t = screen.update(1, emptyActions());
    expect(t).toEqual(go('race', { song: 1 }));
  });

  test('crazygames: the timer waits while iOS asks for the motion sensors', async () => {
    let asking = true;
    const { screen } = await radioFor('crazygames', { asking: () => asking });
    for (let i = 0; i < 30; i++) expect(screen.update(1, emptyActions())).toBeNull();
    asking = false;
    expect(screen.update(9, emptyActions())).toBeNull();
    expect(screen.update(1, emptyActions())).not.toBeNull();
  });

  test('crazygames: the timer is drawn, on a computer and by finger', async () => {
    for (const device of ['keyboard', 'touch'] as const) {
      const { screen } = await radioFor('crazygames', { device });
      const rec = createRecordCtx();
      screen.render(rec.ctx);
      expect(inCorner(rec.ops, device === 'touch').length, device).toBeGreaterThan(0);
    }
  });

  test('portal: no timer, drawn or running', async () => {
    const { screen } = await radioFor('portal');
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    expect(inCorner(rec.ops, false)).toEqual([]);
    for (let i = 0; i < 60; i++) expect(screen.update(1, emptyActions())).toBeNull();
  });
});
