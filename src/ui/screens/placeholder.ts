import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import type { Screen, ScreenName } from '../fsm';

/** Schermata provvisoria: mostra un'etichetta e passa alla successiva con ENTER. */
export function makePlaceholder(label: string, next: ScreenName): Screen {
  let t = 0;
  return {
    enter() {
      t = 0;
    },
    update(dt, actions) {
      t += dt;
      return actions.confirm ? { to: next } : null;
    },
    render(ctx) {
      ctx.fillStyle = '#1a1030';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      ctx.fillStyle = '#ffcc55';
      ctx.font = 'bold 72px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, LOGICAL_W / 2, LOGICAL_H / 2 - 40);
      if (Math.floor(t * 2) % 2 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px monospace';
        ctx.fillText('PRESS ENTER', LOGICAL_W / 2, LOGICAL_H / 2 + 60);
      }
    },
  };
}
