import type { StageDef, ThemeId } from '../types';
import { createStageGraph, levelOf, type StageGraph } from './stage-graph';
import { lengthFor } from './stages';
import { timeLimitFor } from './timer';

/**
 * Lunghezza di una tappa: `BASE_LENGTH_SEGMENTS + LENGTH_PER_DIFFICULTY ·
 * difficoltà` segmenti (spec §9), la stessa formula delle 15 tappe vere
 * (`lengthFor` di `stages.ts`). Pura.
 */
export function stageLengthFor(difficulty: number): number {
  return lengthFor(difficulty);
}

/** Tappa costruita con le formule della spec §9 per lunghezza e tempo. Pura. */
export function makeStage(
  id: string,
  name: string,
  theme: ThemeId,
  difficulty: number,
  seed: number,
): StageDef {
  return {
    id,
    name,
    theme,
    difficulty,
    seed,
    lengthSegments: stageLengthFor(difficulty),
    timeLimit: timeLimitFor(levelOf(id), difficulty),
  };
}

/**
 * Gara di prova del binario E: due livelli, un bivio, due finali. Il binario F
 * la sostituisce con le 15 tappe della spec §9 senza toccare il motore.
 */
export const DEMO_STAGES: readonly StageDef[] = [
  makeStage('0-0', 'Palm Bay', 'beach', 0.15, 20260926),
  makeStage('1-0', 'Sandstone Gate', 'desert', 0.3, 20260927),
  makeStage('1-1', 'Blue Lagoon', 'beach', 0.3, 20260928),
];

export const DEMO_GRAPH: StageGraph = createStageGraph(DEMO_STAGES);
