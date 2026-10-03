import { loadAssets } from '../core/assets';
import { setupCanvas } from '../core/canvas';
import { createInput } from '../core/input';
import { createLoop } from '../core/loop';
import { DEMO_STAGE } from '../game/demo-stage';
import { createRace } from '../game/race';
import { STAGES } from '../game/stages';
import { gripFor, surfaceKindOf } from '../game/surface';
import { findSegment } from '../game/track';
import { createParticles } from '../render/effects';
import { renderWorld } from '../render/world';
import { createStubAssets } from './stub-assets';
import { SEGMENT_LENGTH } from '../render/project';
import type { Actions, RaceEngine, RaceSnapshot } from '../types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = setupCanvas(canvas);
const input = createInput(window);
/**
 * `?stage=<id>` sceglie una delle quindici tappe (per esempio `2-1`);
 * `?assets=real` carica i PNG di `public/sprites` invece degli sprite
 * finti; `?at=<segmento>` parte da lì (vedi `fastForward`). I due default restano quelli di prima, così questa pagina
 * continua a servire a ciò per cui è nata: guidare senza dipendere da
 * niente. Serve alla verifica visiva per tema del binario I.
 */
const params = new URLSearchParams(window.location.search);
const wantedStage = params.get('stage');
const stage = wantedStage === null ? DEMO_STAGE : (STAGES.get(wantedStage) ?? DEMO_STAGE);
const assets = params.get('assets') === 'real' ? loadAssets() : createStubAssets();
const race = createRace(stage, assets);
/**
 * `?at=<segmento>` porta l'auto a quel segmento prima di cominciare: la
 * guida un pilota automatico che tiene il centro, a passi fissi e senza
 * disegnare. Serve alla verifica visiva dei tratti di sterrato e di neve
 * (Set 7), che stanno a metà tappa.
 */
const wantedAt = Number(params.get('at'));
if (Number.isFinite(wantedAt) && wantedAt > 0) fastForward(race, wantedAt * SEGMENT_LENGTH);

function fastForward(engine: RaceEngine, z: number): void {
  const idle: Actions = {
    accelerate: true,
    brake: false,
    left: false,
    right: false,
    gearToggle: false,
    modeToggle: false,
    confirm: false,
    back: false,
    mute: false,
  };
  // Al più dieci minuti di gara simulata: con la tappa più lunga bastano.
  for (let tick = 0; tick < 60 * 600; tick++) {
    const { player } = engine.snapshot();
    if (player.z >= z) return;
    engine.update(1 / 60, {
      ...idle,
      gearToggle: player.gear === 'lo',
      left: player.x > 0.1,
      right: player.x < -0.1,
    });
  }
}
// Piscina delle meteore: allocata una volta, come in `ui/screens/race.ts`.
// Senza questa il meteo non si vede mai qui dentro: pioggia, neve e sabbia
// sono tutte disegnate da questo campo, non dalla strada.
const particles = createParticles();

let frames = 0;
let fps = 0;
let elapsed = 0;
// Uno snapshot per tick fisso, come in `ui/screens/race.ts`: chiamare
// `race.snapshot()` una seconda volta in `render` raddoppierebbe la
// proiezione dei segmenti e li muterebbe due volte per frame.
let snapshotForFrame: RaceSnapshot | null = null;

const loop = createLoop({
  update: (dt) => {
    race.update(dt, input.poll());
    elapsed += dt;
    if (elapsed >= 1) {
      fps = frames;
      frames = 0;
      elapsed -= 1;
    }
    snapshotForFrame = race.snapshot();
    particles.update(dt, snapshotForFrame);
  },
  render: () => {
    frames++;
    if (snapshotForFrame === null) return;
    const snap = snapshotForFrame;
    renderWorld(ctx, snap, assets, particles);
    // Riquadro di diagnostica: l'HUD vero arriva col binario D.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(8, 8, 420, 132);
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`fps ${fps}   ${Math.round(snap.kmh)} km/h   gear ${snap.player.gear}`, 16, 16);
    ctx.fillText(`x ${snap.player.x.toFixed(2)}   z ${Math.round(snap.player.z)}`, 16, 44);
    ctx.fillText(`${snap.stage.name}: arrows or Z X, Shift for gear`, 16, 72);
    // Diagnostica del binario K: meteo, superficie sotto le ruote e
    // aderenza, per la verifica visiva del task 13.
    const weather = snap.stage.weather ?? 'clear';
    const here = findSegment(snap.segments, 0);
    ctx.fillText(
      `weather ${weather}  surface ${surfaceKindOf(here, weather)}  grip ${gripFor(here, weather).toFixed(2)}`,
      16,
      100,
    );
  },
});

// Come main.ts del binario E: si aspetta che gli asset siano pronti.
void assets.ready.then(() => loop.start());
