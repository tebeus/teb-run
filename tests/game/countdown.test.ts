import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { createStubAssets } from '../../src/dev/stub-assets';
import {
  COUNTDOWN_SECONDS,
  COUNTDOWN_STEP_AT,
  createFullRace,
  createRace,
  GO_HOLD_S,
} from '../../src/game/race';
import { createStageGraph } from '../../src/game/stage-graph';
import { REAL_GRAPH, stageById } from '../../src/game/stages';
import { MIN_STAGE_SEGMENTS } from '../../src/game/track';
import type { Actions, RaceEvent, StageDef } from '../../src/types';
import { driveToward, has } from '../helpers/race-script';

const gas = (): Actions => ({ ...emptyActions(), accelerate: true });
const graph = () => REAL_GRAPH;

/**
 * `src/dev/stub-assets.ts` esporta `createStubAssets`, non `stubAssets`.
 * Costruisce gli sprite su `OffscreenCanvas`, che in Node non esiste, ma
 * **solo dentro `get`**: né `createRace` né `createFullRace` chiamano mai
 * `get` (`FullRaceOptions.assets` è dichiarato «non letto da questo
 * motore»), quindi qui è sicuro. Se un giorno il motore leggesse gli
 * asset, questo store va sostituito con `makeAsset` di
 * `../helpers/segments`.
 */
const stubAssets = createStubAssets;

/** Tappa corta ma legale, con il tempo gonfiato: serve al test della giunzione. */
const shortStage = (id: string, name: string): StageDef => ({
  id,
  name,
  theme: 'beach',
  lengthSegments: MIN_STAGE_SEGMENTS,
  timeLimit: 600,
  seed: 4242,
  difficulty: 0,
});

/** Fa girare il motore per `ticks` passi da `dt` e ritorna tutti gli eventi. */
function run(
  race: { update(dt: number, a: Actions): RaceEvent[] },
  ticks: number,
  dt = 1 / 60,
  actions: Actions = gas(),
): RaceEvent[] {
  const out: RaceEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...race.update(dt, actions));
  return out;
}

describe('conto alla rovescia di partenza (spec §4.4e)', () => {
  test('the countdown starts at three seconds and the thresholds are 3, 2, 1', () => {
    expect(COUNTDOWN_SECONDS).toBe(3);
    expect(GO_HOLD_S).toBeCloseTo(0.8, 10);
    expect(COUNTDOWN_STEP_AT).toEqual([3, 2, 1]);
  });

  test('a fresh race exposes the countdown in its snapshot', () => {
    const race = createFullRace({ graph: graph(), assets: stubAssets() });
    expect(race.snapshot().countdown).toBe(COUNTDOWN_SECONDS);
  });

  test('the car does not move, the clock does not run and the score does not grow before GO', () => {
    const race = createFullRace({ graph: graph(), assets: stubAssets() });
    const before = race.snapshot();
    run(race, 120); // due secondi di gas tenuto
    const after = race.snapshot();
    expect(after.player.z).toBe(before.player.z);
    expect(after.player.speed).toBe(0);
    expect(after.timeLeft).toBe(before.timeLeft);
    expect(after.score).toBe(0);
    expect(after.elapsed ?? 0).toBe(0);
  });

  test('after GO the car moves and the clock runs', () => {
    const race = createFullRace({ graph: graph(), assets: stubAssets() });
    run(race, 240); // quattro secondi: tre di attesa e uno di gas
    const after = race.snapshot();
    expect(after.player.speed).toBeGreaterThan(0);
    expect(after.timeLeft).toBeLessThan(race.snapshot().stage.timeLimit);
  });

  test('the countdown field disappears once GO has been on screen for GO_HOLD_S', () => {
    const race = createFullRace({ graph: graph(), assets: stubAssets() });
    run(race, Math.ceil((COUNTDOWN_SECONDS + GO_HOLD_S / 2) * 60));
    const during = race.snapshot().countdown;
    expect(during).toBeDefined();
    expect(during!).toBeLessThanOrEqual(0);
    run(race, Math.ceil((GO_HOLD_S / 2 + 0.1) * 60));
    expect(race.snapshot().countdown).toBeUndefined();
  });

  test('each of the three steps is announced exactly once, in order', () => {
    const race = createFullRace({ graph: graph(), assets: stubAssets() });
    const events = run(race, 240);
    const steps = events.filter((e) => e.type === 'countdown').map((e) => (e as { step: number }).step);
    expect(steps).toEqual([0, 1, 2]);
  });

  test('a coarse tick emits each countdown step once', () => {
    // core/loop limita l'accumulato a 0.25 s, ma un tick da 2.5 s è
    // possibile a mano (e i test lo fanno): tre fasi in un colpo devono
    // uscire tutte e tre, una volta, in ordine.
    const race = createFullRace({ graph: graph(), assets: stubAssets() });
    const first = race.update(2.5, gas());
    const steps = first.filter((e) => e.type === 'countdown').map((e) => (e as { step: number }).step);
    expect(steps).toEqual([0, 1, 2]);
    const later = run(race, 20, 0.25);
    expect(later.filter((e) => e.type === 'countdown')).toEqual([]);
  });

  test('skipCountdown starts the race at once, with no countdown and no event', () => {
    const race = createFullRace({ graph: graph(), assets: stubAssets(), skipCountdown: true });
    expect(race.snapshot().countdown).toBeUndefined();
    const events = run(race, 60);
    expect(events.filter((e) => e.type === 'countdown')).toEqual([]);
    expect(race.snapshot().player.speed).toBeGreaterThan(0);
  });

  test('the attract road of the title never waits: createRace has no countdown', () => {
    const race = createRace(stageById('0-0'), stubAssets());
    expect(race.snapshot().countdown).toBeUndefined();
    run(race, 30);
    expect(race.snapshot().player.speed).toBeGreaterThan(0);
  });

  test('only the first stage waits: a junction does not restart the countdown', () => {
    // Un grafo di tappe corte (420 segmenti, il minimo che `buildTrack`
    // accetta) con il timer gonfiato a 600 s: il checkpoint arriva in una
    // dozzina di secondi di gioco. Con il grafo vero e il solo gas tenuto
    // l'auto esce di strada a ogni curva, il tempo scade e **nessun**
    // checkpoint esce mai: il motore emette `gameover` intorno ai 90 s.
    const short = createStageGraph([
      shortStage('0-0', 'Alpha'),
      shortStage('1-0', 'Bravo'),
      shortStage('1-1', 'Charlie'),
    ]);
    // Senza `skipCountdown`: il conto alla rovescia della prima tappa ci
    // deve essere, ed è proprio quello che non deve tornare alla giunzione.
    const race = createFullRace({ graph: short, assets: stubAssets(), startStage: short.first() });
    // `driveToward` accelera e sterza verso il bersaglio leggendo lo
    // snapshot a ogni tick: è il modo in cui gli altri test del motore
    // arrivano in fondo a una tappa.
    const run = driveToward(race, 0.85, (e) => has(e, 'checkpoint'));
    expect(has(run.events, 'checkpoint'), 'nessun checkpoint raggiunto').toBe(true);
    expect(race.snapshot().stage.id).toBe('1-1');
    expect(race.snapshot().countdown).toBeUndefined();
    // Tre fasi in tutta la partita: quelle della partenza, non una di più.
    expect(run.events.filter((e) => e.type === 'countdown')).toHaveLength(3);
  });
});
