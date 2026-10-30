// La riga sotto DAILY CHALLENGE (spec telefono e finali §D): la serie di
// giorni, se si mostra, e il conto alla rovescia della sfida. La usano il
// titolo e la tela del telefono in verticale (`portrait.ts`).

import { streakLine } from '../persist/streak';
import { nextChallengeLine } from './dailySession';
import { drawTextOutlined, measureText } from './text';

/** Distanza della riga dal fondo del pulsante DAILY, nel titolo. */
export const STREAK_Y_OFFSET = 14;
export const STREAK_COLOR = '#ffaa33';
export const COUNTDOWN_COLOR = '#cccccc';

/**
 * La riga sotto DAILY CHALLENGE (spec telefono e finali §D): la serie, se si
 * mostra, e `NEW CHALLENGE IN 5H 12M`, con le parole della fine partita
 * (`withStreak`). Pura.
 */
export function titleDailyLine(now: Date, streakCount: number): { streak: string | null; next: string } {
  return { streak: streakLine(streakCount), next: nextChallengeLine(now) };
}

/** Disegna la riga centrata su `cx`: la serie in arancio, il conto alla rovescia in grigio. */
export function drawDailyLine(
  ctx: CanvasRenderingContext2D,
  line: { streak: string | null; next: string },
  cx: number,
  y: number,
  scale = 2,
): void {
  const head = line.streak === null ? '' : `${line.streak} · `;
  const left = cx - measureText(head + line.next, scale) / 2;
  if (head !== '') drawTextOutlined(ctx, head, left, y, scale, STREAK_COLOR, 'left');
  drawTextOutlined(ctx, line.next, left + measureText(head, scale), y, scale, COUNTDOWN_COLOR, 'left');
}
