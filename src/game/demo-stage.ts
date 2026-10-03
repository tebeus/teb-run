import type { StageDef } from '../types';
import { lengthFor } from './stages';

/**
 * Tappa di prova del binario A: una sola tappa che si ripete.
 * Lunghezza con la formula della spec §9, `lengthFor` di `stages.ts`.
 */
export const DEMO_STAGE: StageDef = {
  id: '0-0',
  name: 'Demo Bay',
  theme: 'beach',
  lengthSegments: lengthFor(0.3),
  timeLimit: 99,
  seed: 20260926,
  difficulty: 0.3,
};
