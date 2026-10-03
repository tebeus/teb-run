import { setupCanvas } from '../core/canvas';
import { createInput } from '../core/input';
import { createLoop } from '../core/loop';
import { createDefaultScoresStore } from '../persist/scores';
import { createApp } from '../ui/app';
import type { StageDef } from '../types';
import { createEmptyAssets } from './empty-assets';
import { createFakeRace } from './fake-race';
import { renderFakeWorld } from './fake-world';
import { createNullAudio } from './null-audio';

/**
 * Tappa di prova per il binario D, in attesa di game/stages.ts (binario F).
 * timeLimit è volutamente più lungo di FAKE_CHECKPOINT_EVERY_S * 3, così il
 * finale (dopo 3 checkpoint finti) arriva prima del game over per tempo
 * scaduto durante un giro di prova normale.
 */
const firstStage: StageDef = {
  id: '0-0',
  name: 'Palm Bay',
  theme: 'beach',
  lengthSegments: 2260,
  timeLimit: 75,
  seed: 1,
  difficulty: 0.15,
};

/**
 * Il "boot" non è una schermata: si attende `assets.ready` prima di
 * costruire l'app, esattamente come farà `main.ts` nel binario E. Con
 * `createEmptyAssets()` la promessa è già risolta, ma la forma resta
 * quella che useranno gli asset veri del binario C.
 */
async function main(): Promise<void> {
  const assets = createEmptyAssets();
  await assets.ready;

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = setupCanvas(canvas);
  const input = createInput(window);
  const audio = createNullAudio();

  // unlock() va chiamato dentro un handler di keydown/pointerdown (Safari
  // richiede un gesto utente per l'AudioContext), non da poll(). Una sola
  // volta basta: rimuove subito i propri listener.
  const unlockOnce = (): void => {
    audio.unlock();
    window.removeEventListener('keydown', unlockOnce);
    window.removeEventListener('pointerdown', unlockOnce);
  };
  window.addEventListener('keydown', unlockOnce);
  window.addEventListener('pointerdown', unlockOnce);

  const app = createApp({
    assets,
    audio,
    scores: createDefaultScoresStore(),
    raceFactory: (stage, a) => createFakeRace(stage, a),
    renderWorld: renderFakeWorld,
    firstStage,
  });

  createLoop({
    update: (dt) => app.update(dt, input.poll()),
    render: () => app.render(ctx),
  }).start();
}

void main();
