// Il tempo di gara che va alla classifica mondiale (`durationMs`) è quello
// del motore: non conta il semaforo, la pausa, l'attesa della pubblicità né
// le schermate. Chi mette in pausa per dieci minuti manda la stessa durata di
// chi non la mette, e il server non lo rifiuta (risposta di Teb, spec §9).

import { afterEach, describe, expect, test, vi } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createFullRace } from '../../../src/game/race';
import { REAL_GRAPH } from '../../../src/game/stages';
import { createNullAudio } from '../../../src/dev/null-audio';
import { createScoresStore } from '../../../src/persist/scores';
import { validateRun } from '../../../src/shared/validate';
import { stubAssets } from '../../helpers/prudent-driver';
import type { Actions } from '../../../src/types';
import type { ScreenDeps } from '../../../src/ui/deps';
import type { ScreenPayloads } from '../../../src/ui/fsm';

const act = (a: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...a });
const STEP = 1 / 60;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function play(pauseS: number, target?: 'crazygames') {
  if (target) vi.stubEnv('VITE_TARGET', target);
  vi.resetModules();
  const { createRaceScreen } = await import('../../../src/ui/screens/race');
  const first = REAL_GRAPH.first();
  const deps: ScreenDeps = {
    assets: stubAssets(),
    audio: createNullAudio(),
    scores: createScoresStore(),
    // Tre secondi di tempo: il game over arriva presto, senza guidare.
    raceFactory: (_s, a) => createFullRace({ graph: REAL_GRAPH, assets: a, startStage: { ...first, timeLimit: 3 } }),
    renderWorld: () => {},
    firstStage: first,
  };
  const screen = createRaceScreen(deps);
  screen.enter({ song: 0 });
  let paused = false;
  for (let i = 0; i < 60 * 30; i++) {
    // Dopo il semaforo, una pausa lunga `pauseS` secondi di orologio vero.
    if (!paused && i === 60 * 4 && pauseS > 0) {
      paused = true;
      screen.update(STEP, act({ pause: true }));
      for (let k = 0; k < pauseS * 60; k++) screen.update(STEP, act());
      screen.update(STEP, act({ pause: true }));
      continue;
    }
    const t = screen.update(STEP, act());
    if (t !== null) return t.payload as ScreenPayloads['gameOver'];
  }
  throw new Error('no game over');
}

describe('race time for the leaderboard', () => {
  test('a ten-minute pause does not count; the run still passes the server checks', async () => {
    const plain = await play(0);
    const paused = await play(600);
    expect(paused.time).toBeCloseTo(plain.time!, 1);
    // Tre secondi di tempo più i due di decelerazione: niente semaforo, niente pausa.
    expect(paused.time!).toBeLessThan(6);
    const body = { initials: 'TEB', score: paused.score, mode: 'normal', car: 'new', stageId: '0-0', route: '', ending: null, durationMs: Math.round(paused.time! * 1000) };
    expect(validateRun(body, new Date('2026-10-25T12:00:00Z'))).toMatchObject({ ok: true });
  });
});
