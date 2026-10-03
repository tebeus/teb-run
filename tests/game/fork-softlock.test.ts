// Riproduzione del soft-lock del bivio (addendum E, fork-bug-report-2.md):
// un giocatore che guida dritto o tiene il centro della strada, senza
// scegliere un lato al bivio, non deve restare incastrato al bivio. Prima
// della correzione, lo stesso pilota produceva 251 episodi di velocità
// quasi zero dentro la zona.
import { describe, expect, test } from 'vitest';
import { acts } from '../helpers/race-script';
import { createFullRace } from '../../src/game/race';
import { REAL_GRAPH } from '../../src/game/stages';
import type { Actions, AssetStore, RaceSnapshot, SpriteAsset, StageDef } from '../../src/types';

const STEP = 1 / 60;

const stubAssets = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: {} as CanvasImageSource,
    w: 64,
    h: 64,
    entry: { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

/**
 * Pilota "che tiene il centro": non sceglie mai un lato al bivio, sterza
 * solo per riportare x a 0 (deadzone 0,03), gas sempre a tavoletta. È il
 * caso reale di chi non ha ancora deciso quale corsia prendere.
 */
function centerActions(snap: RaceSnapshot): Actions {
  const dx = 0 - snap.player.x;
  return acts({ accelerate: true, left: dx < -0.03, right: dx > 0.03 });
}

describe('il bivio non blocca più chi guida al centro (addendum E, poi addendum del collaudo)', () => {
  test('zero episodi sotto i 5 km/h dentro la zona di bivio della tappa 0-0 (erano 251, poi 5, poi 24 con la zona a 320 segmenti)', () => {
    // Deroga del secondo addendum del collaudo: la fila di barriere centrali
    // `common_barrier` è sparita da `placeScenery` (i racer arcade dell'epoca non
    // ne aveva). Con la geometria a 320 segmenti e le barriere ancora al loro
    // posto, questo stesso pilota centrato produceva 24 episodi (misurato nel
    // rapporto del brief precedente): non erano un vero soft-lock (nessun
    // evento `bump`/`crash`, il pilota arrivava sempre alla giunzione), ma la
    // punta dell'isola urtava comunque contro il collider della barriera con
    // un urto "stop" sotto soglia (velocità quasi zero, nessun evento). Senza
    // barriere quell'urto non esiste più: la banchina dell'isola con
    // `ISLAND_NUDGE` basta a portare il pilota su una carreggiata senza mai
    // fermarlo. Soglia a zero, non un margine.
    // timeLimit gonfiato: questo test misura il soft-lock, non la taratura
    // (quella la copre tests/game/balance.test.ts). Senza gonfiarlo il
    // pilota "centrato" andrebbe in game over per tempo scaduto prima di
    // arrivare alla giunzione, proprio a causa del bug che si vuole
    // riprodurre.
    const start: StageDef = { ...REAL_GRAPH.first(), timeLimit: 600 };
    const engine = createFullRace({ graph: REAL_GRAPH, assets: stubAssets(), startStage: start });

    let episodes = 0;
    let wasSlow = false;
    let junctioned = false;
    let gameOver = false;
    const maxTicks = 60 * 60 * 10; // 10 minuti di margine, con timeLimit gonfiato
    for (let tick = 0; tick < maxTicks; tick++) {
      const events = engine.update(STEP, centerActions(engine.snapshot()));
      const after = engine.snapshot();
      const inForkZone = after.banner === 'fork';
      const slow = inForkZone && after.kmh < 5;
      if (slow && !wasSlow) episodes++;
      wasSlow = slow;
      if (events.some((e) => e.type === 'checkpoint')) {
        junctioned = true;
        break;
      }
      if (events.some((e) => e.type === 'gameover')) {
        gameOver = true;
        break;
      }
    }

    expect(gameOver, 'il pilota centrato non deve finire in game over per tempo scaduto').toBe(false);
    expect(junctioned, 'il pilota centrato deve arrivare alla giunzione').toBe(true);
    expect(episodes).toBe(0);
  });
});
