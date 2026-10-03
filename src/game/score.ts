/** Punti al secondo a velocità massima, prima del moltiplicatore di livello (spec §8). */
export const SCORE_RATE = 100;
/** Quanto ogni livello aumenta il punteggio per tick (spec §8). */
export const LEVEL_SCORE_STEP = 0.25;
/** Punti per veicolo sorpassato (spec §8). */
export const OVERTAKE_POINTS = 50;
/** Punti per secondo avanzato a un checkpoint (spec §8). */
export const CHECKPOINT_BONUS_PER_SECOND = 1000;
/** Punti per secondo avanzato all'arrivo (spec §8). */
export const FINISH_BONUS_PER_SECOND = 5000;

/** Punti di un tick: speedPercent · 100 · dt · (1 + level · 0.25) (spec §8). Pura. */
export function tickScore(speedPercent: number, dt: number, level: number): number {
  return speedPercent * SCORE_RATE * dt * (1 + Math.max(0, level) * LEVEL_SCORE_STEP);
}

/** Bonus di checkpoint: secondi rimasti × 1000, arrotondato (spec §8). Pura. */
export function checkpointBonus(timeLeft: number): number {
  return Math.round(Math.max(0, timeLeft) * CHECKPOINT_BONUS_PER_SECOND);
}

/** Bonus di arrivo: secondi rimasti × 5000, arrotondato (spec §8). Pura. */
export function finishBonus(timeLeft: number): number {
  return Math.round(Math.max(0, timeLeft) * FINISH_BONUS_PER_SECOND);
}

/** Punti per `n` sorpassi (spec §8). Pura. */
export function overtakeScore(n: number): number {
  return Math.max(0, n) * OVERTAKE_POINTS;
}
