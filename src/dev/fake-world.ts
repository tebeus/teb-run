import type { AssetStore, RaceSnapshot } from '../types';
import { LOGICAL_H, LOGICAL_W } from '../core/canvas';

/**
 * Sfondo e strada finti: un cielo a gradiente e un trapezio piatto che
 * pende verso la posizione laterale del giocatore. Serve a vedere le
 * schermate senza il binario A. Non è testato oltre a "non lancia e disegna
 * qualcosa": la resa vera arriva con render/world.ts del binario A.
 */
export function renderFakeWorld(ctx: CanvasRenderingContext2D, snapshot: RaceSnapshot, _assets: AssetStore): void {
  const horizon = LOGICAL_H * 0.45;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#2a5ca8');
  sky.addColorStop(1, '#bfe3ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, LOGICAL_W, horizon);

  ctx.fillStyle = '#2f8f4e';
  ctx.fillRect(0, horizon, LOGICAL_W, LOGICAL_H - horizon);

  const roadTopW = 120;
  const roadBottomW = 620;
  const lean = snapshot.player.x * 60;

  ctx.fillStyle = '#333333';
  ctx.beginPath();
  ctx.moveTo(LOGICAL_W / 2 - roadTopW / 2, horizon);
  ctx.lineTo(LOGICAL_W / 2 + roadTopW / 2, horizon);
  ctx.lineTo(LOGICAL_W / 2 + roadBottomW / 2 - lean, LOGICAL_H);
  ctx.lineTo(LOGICAL_W / 2 - roadBottomW / 2 - lean, LOGICAL_H);
  ctx.closePath();
  ctx.fill();
}
