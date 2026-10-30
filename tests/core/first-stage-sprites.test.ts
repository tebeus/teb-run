// La fase 1 del caricamento (spec telefono e finali §B.2): gli sprite
// condivisi che la prima tappa usa davvero. Si ricavano guidando la 0-0 col
// motore vero e disegnandola con uno store che registra ogni `get`: un
// pilota pulito (l'esperto) e uno che urta ed esce di strada (il
// principiante in ritardo), con gli effetti. `src/core/firstStageSprites.ts`
// è generato da qui (`GEN_FIRST_STAGE=1 npx vitest run
// tests/core/first-stage-sprites.test.ts`): se la tappa cambia e la lista
// no, questo test fallisce.

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseManifest, pickSource } from '../../src/core/assets';
import { groupOf } from '../../src/core/phases';
import { FIRST_STAGE_SPRITES } from '../../src/core/firstStageSprites';
import { createFullRace } from '../../src/game/race';
import { REAL_GRAPH } from '../../src/game/stages';
import { renderHud } from '../../src/render/hud';
import { createParticles } from '../../src/render/effects';
import { createSkidTrail } from '../../src/render/skid';
import { createFlock } from '../../src/render/wildlife';
import { buildTrack } from '../../src/game/track';
import { spawnTraffic } from '../../src/game/traffic';
import { renderWorld } from '../../src/render/world';
import type { Actions, AssetStore, RaceSnapshot, SpriteName } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { BEGINNERS, BEGINNER_DT } from '../helpers/beginner-driver';
import { expertActionsWith, EXPERT_CONFIG } from '../helpers/expert-driver';
import { stubAssets } from '../helpers/prudent-driver';
import { acts } from '../helpers/race-script';
import { NO_ART } from '../helpers/art';

const FILE = new URL('../../src/core/firstStageSprites.ts', import.meta.url);

function recording(): { assets: AssetStore; names: Set<string> } {
  const base = stubAssets();
  const names = new Set<string>();
  return { names, assets: { ...base, get: (name: SpriteName) => (names.add(name), base.get(name)) } };
}

/** Guida la 0-0 fino al primo checkpoint (o al game over) disegnando ogni 4 tick. */
function driveAndDraw(driver: (s: RaceSnapshot) => Actions, assets: AssetStore): void {
  const engine = createFullRace({ graph: REAL_GRAPH, assets });
  const rec = createRecordCtx();
  const ctx = rec.ctx;
  const particles = createParticles();
  const trail = createSkidTrail();
  const birds = createFlock();
  const layers = { trail, birds };
  for (let tick = 0; tick < 200 * 60; tick++) {
    const s = engine.snapshot();
    const events = engine.update(BEGINNER_DT, driver(s));
    particles.update(BEGINNER_DT, engine.snapshot());
    trail.update(BEGINNER_DT, engine.snapshot());
    birds.update(BEGINNER_DT, engine.snapshot());
    if (events.some((e) => e.type === 'crash')) particles.burst('crash');
    if (tick % 4 === 0) {
      rec.ops.length = 0;
      const now = engine.snapshot();
      renderWorld(ctx, now, assets, particles, layers);
      renderHud(ctx, now, assets);
    }
    if (events.some((e) => e.type === 'checkpoint' || e.type === 'gameover')) {
      // Il banner del checkpoint e il game over si vedono ancora un po'.
      for (let k = 0; k < 120; k++) {
        engine.update(BEGINNER_DT, acts({ accelerate: true }));
        const now = engine.snapshot();
        renderWorld(ctx, now, assets, particles, layers);
        renderHud(ctx, now, assets);
      }
      return;
    }
  }
}

function usedByFirstStage(): string[] {
  const { assets, names } = recording();
  driveAndDraw((s) => expertActionsWith(EXPERT_CONFIG, s, 'R'), assets);
  // Il principiante: sterza tardi verso il centro, urta ed esce di strada.
  let lagged: number[] = [];
  const late = BEGINNERS.late;
  driveAndDraw((s) => {
    lagged.push(-s.player.x);
    const dx = lagged[Math.max(0, lagged.length - 1 - Math.round(late.lag / BEGINNER_DT))];
    if (lagged.length > 600) lagged = lagged.slice(-60);
    return acts({ accelerate: true, gearToggle: s.player.gear === 'lo' && s.kmh > 80, left: dx < -late.dead, right: dx > late.dead });
  }, assets);
  // Il traffico di tutta la tappa, anche quello che i due piloti non vedono.
  const first = REAL_GRAPH.first();
  for (const car of spawnTraffic(buildTrack(first), first)) names.add(car.name);
  // Dal nome logico al file del manifest (le strip hanno un file per più nomi).
  const manifest = parseManifest(JSON.parse(readFileSync('public/sprites/manifest.json', 'utf8')));
  const files = new Set<string>();
  for (const name of names) {
    const src = pickSource(name as SpriteName, manifest, new Set());
    if (src.kind === 'png' && groupOf(src.file).kind === 'shared') files.add(src.file);
  }
  return [...files].sort();
}

function source(list: readonly string[]): string {
  return `// GENERATO da tests/core/first-stage-sprites.test.ts (GEN_FIRST_STAGE=1): non
// modificare a mano. Gli sprite condivisi che la prima tappa disegna davvero,
// per la fase 1 del caricamento (src/core/phases.ts). Senza import, come
// phases.ts: lo legge anche tools/check-builds.mjs.

export const FIRST_STAGE_SPRITES: readonly string[] = ${JSON.stringify(list, null, 2)};
`;
}

describe('sprites of the first stage', () => {
  test.skipIf(NO_ART)('match what the 0-0 really draws (run with GEN_FIRST_STAGE=1 if not)', () => {
    const used = usedByFirstStage();
    if (process.env.GEN_FIRST_STAGE === '1') writeFileSync(FILE, source(used));
    expect([...FIRST_STAGE_SPRITES]).toEqual(used);
  }, 120000);

  test('the list holds what a race needs from the start and leaves out other stages', () => {
    for (const name of ['asphalt', 'race_start_gantry', 'race_start_lights', 'race_checkpoint', 'traffic_bus']) {
      expect(FIRST_STAGE_SPRITES, name).toContain(name);
    }
    for (const name of ['ground_snow_road', 'map_full', 'race_goal', 'screen_attract']) {
      expect(FIRST_STAGE_SPRITES, name).not.toContain(name);
    }
    expect(readFileSync(FILE, 'utf8')).not.toMatch(/^import /m);
  });
});
