// La tabella dei limiti (`src/shared/limits.ts`) è ricavata dal gioco vero:
// lunghezze, limiti di tempo NORMAL e HARD, veicoli per tappa e costanti del
// punteggio. Il Worker la importa al posto del motore. Se il gioco cambia e
// la tabella no, questo test fallisce: `npm run gen:limits` la rigenera.

import { writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { withMode } from '../../src/game/mode';
import { MAX_SPEED } from '../../src/game/player';
import {
  CHECKPOINT_BONUS_PER_SECOND,
  FINISH_BONUS_PER_SECOND,
  LEVEL_SCORE_STEP,
  OVERTAKE_POINTS,
  SCORE_RATE,
} from '../../src/game/score';
import { ENDING_COUNT } from '../../src/game/stage-graph';
import { indexOf, LAST_LEVEL, levelOf, REAL_GRAPH, STAGE_LIST, STAGES } from '../../src/game/stages';
import { GAMEOVER_DECEL_S } from '../../src/game/timer';
import { trafficCountFor } from '../../src/game/traffic';
import { SEGMENT_LENGTH } from '../../src/render/project';
import { LIMITS, nextStageId, endingOfStage } from '../../src/shared/limits';

const FILE = new URL('../../src/shared/limits.ts', import.meta.url);

function fromGame() {
  return {
    maxSpeedSegmentsPerSecond: MAX_SPEED / SEGMENT_LENGTH,
    scoreRate: SCORE_RATE,
    levelScoreStep: LEVEL_SCORE_STEP,
    overtakePoints: OVERTAKE_POINTS,
    checkpointBonusPerSecond: CHECKPOINT_BONUS_PER_SECOND,
    finishBonusPerSecond: FINISH_BONUS_PER_SECOND,
    gameoverDecelS: GAMEOVER_DECEL_S,
    lastLevel: LAST_LEVEL,
    endingCount: ENDING_COUNT,
    stages: Object.fromEntries(
      STAGE_LIST.map((s) => {
        const hard = withMode(s, 'hard');
        return [
          s.id,
          {
            level: levelOf(s.id),
            index: indexOf(s.id),
            length: s.lengthSegments,
            limit: { normal: s.timeLimit, hard: hard.timeLimit },
            cars: { normal: trafficCountFor(s), hard: trafficCountFor(hard) },
          },
        ];
      }),
    ),
  };
}

function source(table: ReturnType<typeof fromGame>): string {
  return `${HEADER}export const LIMITS = ${JSON.stringify(table, null, 2)} as const;\n${FOOTER}`;
}

describe('limits table', () => {
  test('matches the game (run `npm run gen:limits` if not)', () => {
    const table = fromGame();
    if (process.env.GEN_LIMITS === '1') writeFileSync(FILE, source(table));
    expect(JSON.parse(JSON.stringify(LIMITS))).toEqual(table);
  });

  test('the grid arithmetic is the one of the real graph', () => {
    for (const s of STAGE_LIST) {
      for (const side of ['L', 'R'] as const) expect(nextStageId(s.id, side)).toBe(REAL_GRAPH.next(s, side)?.id ?? null);
      if (levelOf(s.id) === LAST_LEVEL) expect(endingOfStage(s.id)).toBe(REAL_GRAPH.endingOf(s) + 1);
      else expect(endingOfStage(s.id)).toBeNull();
    }
    expect(nextStageId('9-9', 'L')).toBeNull();
    expect(STAGES.size).toBe(Object.keys(LIMITS.stages).length);
  });
});

const HEADER = `// GENERATO da \`npm run gen:limits\` (tests/shared/limits-table.test.ts): non
// modificare a mano. I numeri del gioco che servono al server per i controlli
// di plausibilità (spec classifica e sfida, §2.4), senza importare motore,
// sprite e catalogo. Un test fallisce se il gioco cambia e questa tabella no.

`;

const FOOTER = `
export type StageLimits = (typeof LIMITS.stages)[keyof typeof LIMITS.stages];

/** I limiti della tappa \`id\`, o null se non è una delle 15. Pura. */
export function stageLimits(id: string): StageLimits | null {
  return Object.prototype.hasOwnProperty.call(LIMITS.stages, id) ? LIMITS.stages[id as keyof typeof LIMITS.stages] : null;
}

/** La tappa dopo \`id\` dal lato \`side\` (griglia triangolare), o null. Pura. */
export function nextStageId(id: string, side: 'L' | 'R'): string | null {
  const s = stageLimits(id);
  if (s === null) return null;
  const next = \`\${s.level + 1}-\${side === 'L' ? s.index : s.index + 1}\`;
  return stageLimits(next) === null ? null : next;
}

/** Il finale 1..5 dell'ultima tappa \`id\`, o null fuori dall'ultimo livello. Pura. */
export function endingOfStage(id: string): number | null {
  const s = stageLimits(id);
  if (s === null || s.level !== LIMITS.lastLevel) return null;
  return Math.min(s.index, LIMITS.endingCount - 1) + 1;
}
`;
