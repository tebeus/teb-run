// La riga dell'obiettivo: solo nella build crazygames, solo alla prima gara
// della sessione, dal semaforo per qualche secondo o fino al primo
// checkpoint. Non copre l'HUD, il semaforo né il suggerimento dei comandi,
// e si legge su un telefono.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createFakeRace } from '../../src/dev/fake-race';
import { createNullAudio } from '../../src/dev/null-audio';
import { createScoresStore } from '../../src/persist/scores';
import {
  GOAL_LINE,
  GOAL_LINE_SCALE,
  GOAL_LINE_SECONDS,
  GOAL_LINE_Y,
  goalLineAlpha,
  RACE_HINT_Y,
} from '../../src/ui/controlsHelp';
import { BANNER_Y, FORK_BANNER_Y } from '../../src/render/hud';
import { LOGICAL_W } from '../../src/core/canvas';
import { measureText } from '../../src/ui/text';
import { createRecordCtx } from '../helpers/recordCtx';
import type { RaceEngine, StageDef } from '../../src/types';
import type { ScreenDeps } from '../../src/ui/deps';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const stage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 2260, timeLimit: 200, seed: 1, difficulty: 0.15 };

async function raceFor(target: 'portal' | 'crazygames', checkpointAt?: number, lightsFor = 0) {
  vi.stubEnv('VITE_TARGET', target);
  vi.resetModules();
  const { createRaceScreen } = await import('../../src/ui/screens/race');
  let t = 0;
  const factory = (s: StageDef, a: ScreenDeps['assets']): RaceEngine => {
    const inner = createFakeRace(s, a);
    return {
      // Il semaforo (countdown) per i primi `lightsFor` secondi, poi niente.
      snapshot: () => ({ ...inner.snapshot(), countdown: t < lightsFor ? lightsFor - t : undefined }),
      update(dt, actions) {
        t += dt;
        const events = inner.update(dt, actions);
        if (checkpointAt !== undefined && t >= checkpointAt && t - dt < checkpointAt) {
          return [...events, { type: 'checkpoint', bonus: 0, nextStage: s }];
        }
        return events;
      },
    };
  };
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
    audio: createNullAudio(),
    scores: createScoresStore(),
    raceFactory: factory,
    renderWorld: () => {},
    firstStage: stage,
  };
  return createRaceScreen(deps);
}

/** Le operazioni gialle della riga, alla sua quota. */
function goalOps(screen: Awaited<ReturnType<typeof raceFor>>): number {
  const rec = createRecordCtx();
  screen.render(rec.ctx);
  return rec.fills().filter((op) => op.fill === '#ffee55' && op.args[1] >= GOAL_LINE_Y && op.args[1] < GOAL_LINE_Y + 8 * GOAL_LINE_SCALE).length;
}

describe('the goal line', () => {
  test('crazygames: not under the start lights and READY/GO; then shown, gone after a few seconds, and not in the next race', async () => {
    const lit = await raceFor('crazygames', undefined, 4);
    lit.enter({ song: 0 });
    lit.update(1, emptyActions());
    expect(goalOps(lit)).toBe(0);
    lit.update(1, emptyActions());
    lit.update(1, emptyActions());
    expect(goalOps(lit)).toBe(0);
    lit.update(1.5, emptyActions());
    lit.update(1, emptyActions());
    expect(goalOps(lit)).toBeGreaterThan(0);
  });

  test('crazygames: shown in the first race, gone after a few seconds, and not in the next race', async () => {
    const screen = await raceFor('crazygames');
    screen.enter({ song: 0 });
    screen.update(1, emptyActions());
    expect(goalOps(screen)).toBeGreaterThan(0);
    for (let i = 0; i < GOAL_LINE_SECONDS; i++) screen.update(1, emptyActions());
    expect(goalOps(screen)).toBe(0);
    screen.exit?.();
    screen.enter({ song: 0 });
    screen.update(1, emptyActions());
    expect(goalOps(screen)).toBe(0);
  });

  test('crazygames: the first checkpoint takes it away early', async () => {
    const screen = await raceFor('crazygames', 4);
    screen.enter({ song: 0 });
    screen.update(3, emptyActions());
    expect(goalOps(screen)).toBeGreaterThan(0);
    screen.update(1, emptyActions());
    screen.update(1 / 60, emptyActions());
    expect(goalOps(screen)).toBe(0);
  });

  test('portal: never', async () => {
    const screen = await raceFor('portal');
    screen.enter({ song: 0 });
    screen.update(1, emptyActions());
    expect(goalOps(screen)).toBe(0);
  });

  test('it fades in and out', () => {
    expect(goalLineAlpha(0)).toBe(0);
    expect(goalLineAlpha(2)).toBe(1);
    expect(goalLineAlpha(GOAL_LINE_SECONDS - 0.5)).toBeCloseTo(0.5);
    expect(goalLineAlpha(GOAL_LINE_SECONDS)).toBe(0);
  });

  test('it covers neither the HUD, nor the centre banners, nor the controls hint; it fits and reads on a phone', () => {
    const top = GOAL_LINE_Y - 8;
    const bottom = GOAL_LINE_Y + 8 * GOAL_LINE_SCALE + 8;
    // La riga in alto dell'HUD (TIME, SCORE, LAP, modalità) finisce a y 82.
    expect(top).toBeGreaterThan(82);
    expect(bottom).toBeLessThan(BANNER_Y);
    expect(bottom).toBeLessThan(RACE_HINT_Y - 12);
    // Il banner del bivio sta qui, ma arriva a fine tappa: la riga dura pochi secondi.
    expect(FORK_BANNER_Y).toBeLessThan(bottom);
    expect(GOAL_LINE_SECONDS).toBeLessThanOrEqual(10);
    expect(measureText(GOAL_LINE, GOAL_LINE_SCALE) + 32).toBeLessThanOrEqual(LOGICAL_W - 40);
    // Sull'iframe più piccolo dei telefoni (800x450) i glifi restano alti almeno 12 px.
    expect(8 * GOAL_LINE_SCALE * (800 / LOGICAL_W)).toBeGreaterThanOrEqual(12);
  });
});
