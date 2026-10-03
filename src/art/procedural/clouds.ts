import type { SpriteName, ThemeId } from '../../types';
import { type Ctx2D, type Drawer } from './palette';
import { hash01 } from './textures';

/** Misura della striscia di nuvole (spec §13, Set 2). */
export const CLOUDS_W = 2048;
export const CLOUDS_H = 256;

export interface CloudTones {
  /** Corpo della nuvola. */
  body: string;
  /** Sottopancia in ombra. */
  shade: string;
  /** Quante nuvole sulla striscia. */
  count: number;
  /** Seme: due temi non devono avere lo stesso cielo. */
  seed: number;
}

/** Nuvole per tema: bianche al mare, rosate nel deserto, grigie in città. */
export const CLOUD_TONES: Record<ThemeId, CloudTones> = {
  beach: { body: '#ffffff', shade: '#d6e8f2', count: 14, seed: 101 },
  desert: { body: '#ffe6cf', shade: '#e8b98f', count: 9, seed: 202 },
  alpine: { body: '#f4f8fb', shade: '#c9d8e4', count: 16, seed: 303 },
  farm: { body: '#ffffff', shade: '#dfe7d2', count: 12, seed: 404 },
  town: { body: '#eae4da', shade: '#c0b8ab', count: 11, seed: 505 },
};

/**
 * Una nuvola: quattro ellissi sovrapposte più l'ombra sotto. Tutto dentro il
 * riquadro, con un margine pari al raggio massimo: la striscia si affianca a
 * se stessa e la cucitura cade su cielo vuoto.
 */
function puff(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number, tones: CloudTones): void {
  ctx.fillStyle = tones.shade;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.45, rx, ry * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tones.body;
  const lobes: readonly (readonly [number, number, number, number])[] = [
    [-0.45, 0.1, 0.42, 0.62],
    [0, -0.18, 0.56, 0.92],
    [0.45, 0.06, 0.46, 0.66],
    [0.16, 0.22, 0.4, 0.5],
  ];
  for (const [dx, dy, sx, sy] of lobes) {
    ctx.beginPath();
    ctx.ellipse(cx + rx * dx, cy + ry * dy, rx * sx, ry * sy, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Striscia di nuvole trasparente: nessun fondo, solo nuvole. */
export function cloudStrip(ctx: Ctx2D, w: number, h: number, seed: number, tones: CloudTones): void {
  if (!(w > 0) || !(h > 0)) return;
  const maxRx = w * 0.05;
  const maxRy = h * 0.3;
  for (let i = 0; i < tones.count; i++) {
    const rx = maxRx * (0.45 + 0.55 * hash01(seed, i, 1));
    const ry = maxRy * (0.5 + 0.5 * hash01(seed, i, 2));
    // Margine 1.6 · raggio: i lobi laterali arrivano a 0,68 · rx dal centro,
    // quindi il margine è più largo del necessario e nessun lobo tocca il bordo.
    const cx = rx * 1.6 + Math.max(0, w - rx * 3.2) * hash01(seed, i, 3);
    const cy = ry * 1.6 + Math.max(0, h - ry * 3.2) * hash01(seed, i, 4);
    puff(ctx, cx, cy, rx, ry, tones);
  }
}

const strip = (theme: ThemeId): Drawer => (ctx, w, h) =>
  cloudStrip(ctx, w, h, CLOUD_TONES[theme].seed, CLOUD_TONES[theme]);

/** Le cinque strisce di nuvole del Set 2 (spec §13). */
export const CLOUDS: Record<SpriteName, Drawer> = {
  bg_beach_clouds: strip('beach'),
  bg_desert_clouds: strip('desert'),
  bg_alpine_clouds: strip('alpine'),
  bg_farm_clouds: strip('farm'),
  bg_town_clouds: strip('town'),
};
