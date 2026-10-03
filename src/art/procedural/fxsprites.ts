import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, ell, lw, poly } from './palette';

/**
 * Sprite di particella (spec §4.4b): li disegna `render/effects.ts` con
 * `drawImage` alla misura della particella. Sono tinte piatte con un
 * contorno leggero, perché a schermo sono alti 20-50 px.
 *
 * Nessuno di questi disegnatori usa numeri casuali: gli sprite si
 * preparano una volta al caricamento e devono essere identici a ogni
 * avvio, altrimenti `tests/art/procedural-coverage.test.ts` misurerebbe
 * un disegno diverso da quello del gioco. Le forme "a caso" vengono da
 * tabelle scritte a mano.
 */

/** Nuvola a sbuffi: tre o quattro ellissi sovrapposte. */
function puff(ctx: Ctx2D, w: number, h: number, fill: string, dark: string): void {
  const lobes: readonly (readonly [number, number, number, number])[] = [
    [0.3, 0.62, 0.3, 0.34],
    [0.56, 0.5, 0.36, 0.42],
    [0.78, 0.66, 0.24, 0.28],
    [0.46, 0.76, 0.28, 0.24],
  ];
  for (let i = 0; i < lobes.length; i++) {
    const [cx, cy, rx, ry] = lobes[i];
    ell(ctx, w * cx, h * cy, w * rx, h * ry, i % 2 === 0 ? fill : dark);
  }
}

/** Sassolini: sei quadrilateri irregolari sparsi. */
function pebbles(ctx: Ctx2D, w: number, h: number, count: number, fill: string, dark: string): void {
  const spots: readonly (readonly [number, number, number])[] = [
    [0.18, 0.72, 0.1],
    [0.36, 0.44, 0.14],
    [0.52, 0.66, 0.09],
    [0.66, 0.36, 0.12],
    [0.8, 0.6, 0.08],
    [0.44, 0.84, 0.07],
    [0.28, 0.24, 0.08],
    [0.72, 0.8, 0.1],
  ];
  for (let i = 0; i < Math.min(count, spots.length); i++) {
    const [cx, cy, r] = spots[i];
    poly(
      ctx,
      [
        [w * (cx - r), h * cy],
        [w * cx, h * (cy - r * 1.4)],
        [w * (cx + r), h * cy],
        [w * cx, h * (cy + r * 1.2)],
      ],
      i % 2 === 0 ? fill : dark,
    );
  }
}

/** Raggiera di schegge di luce: le scintille. */
function sparks(ctx: Ctx2D, w: number, h: number): void {
  const k = Math.max(1, lw(w, h) * 0.4);
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const a = -0.5 + i * 0.28;
    const len = 0.22 + (i % 3) * 0.1;
    ctx.strokeStyle = i % 2 === 0 ? P.yellow : P.orange;
    ctx.lineWidth = k * (i % 2 === 0 ? 1.4 : 1);
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.5);
    ctx.lineTo(w * (0.5 + Math.cos(a) * len), h * (0.5 + Math.sin(a) * len * 1.6));
    ctx.stroke();
  }
  ell(ctx, w * 0.5, h * 0.5, w * 0.06, h * 0.08, P.cream);
}

/** Strisce orizzontali sottili che sfumano: le righe di velocità. */
function speedLines(ctx: Ctx2D, w: number, h: number): void {
  const rows: readonly (readonly [number, number, number])[] = [
    [0.22, 0.06, 0.9],
    [0.42, 0.1, 1],
    [0.58, 0.05, 0.8],
    [0.76, 0.09, 0.95],
  ];
  for (const [cy, th, len] of rows) {
    ctx.fillStyle = P.glassLight;
    ctx.fillRect(w * (1 - len) * 0.5, h * cy, w * len, Math.max(1, h * th));
    ctx.fillStyle = P.white;
    ctx.fillRect(w * (1 - len * 0.5) * 0.5, h * (cy + th * 0.25), w * len * 0.5, Math.max(1, h * th * 0.5));
  }
}

/** Stella d'urto: punte arancioni e cuore chiaro. */
function impact(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const pts: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.48 : 0.24;
    pts.push([w * (0.5 + Math.cos(a) * r), h * (0.5 + Math.sin(a) * r)]);
  }
  poly(ctx, pts, P.orange, P.outline, k * 0.6);
  const inner: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.3 : 0.14;
    inner.push([w * (0.5 + Math.cos(a) * r), h * (0.5 + Math.sin(a) * r)]);
  }
  poly(ctx, inner, P.yellow);
  ell(ctx, w * 0.5, h * 0.5, w * 0.12, h * 0.12, P.cream);
}

/** Corona d'acqua: sbuffo blu con tre gocce sopra. */
function splash(ctx: Ctx2D, w: number, h: number): void {
  puff(ctx, w, h, '#57b8e0', '#2d7fae');
  for (const [cx, cy, r] of [
    [0.3, 0.26, 0.06],
    [0.52, 0.16, 0.08],
    [0.74, 0.3, 0.05],
  ] as const) {
    ell(ctx, w * cx, h * cy, w * r, h * r * 1.6, P.glassLight);
  }
}

/** Ciuffi d'erba e paglia lanciati in aria. */
function grassSpray(ctx: Ctx2D, w: number, h: number): void {
  const k = Math.max(1, lw(w, h) * 0.5);
  ctx.lineCap = 'round';
  const blades: readonly (readonly [number, number, number, number])[] = [
    [0.2, 0.9, 0.3, 0.42],
    [0.34, 0.92, 0.38, 0.22],
    [0.5, 0.94, 0.52, 0.12],
    [0.64, 0.9, 0.7, 0.26],
    [0.8, 0.88, 0.88, 0.46],
    [0.44, 0.86, 0.3, 0.6],
  ];
  for (let i = 0; i < blades.length; i++) {
    const [x0, y0, x1, y1] = blades[i];
    ctx.strokeStyle = i % 3 === 2 ? P.ochre : i % 2 === 0 ? P.green : P.greenDark;
    ctx.lineWidth = k * 1.4;
    ctx.beginPath();
    ctx.moveTo(w * x0, h * y0);
    ctx.lineTo(w * x1, h * y1);
    ctx.stroke();
  }
  pebbles(ctx, w, h, 3, P.woodDark, P.sandDark);
}

/** I dieci sprite di particella (spec §4.4b, §13). */
export const FX_SPRITES: Record<SpriteName, Drawer> = {
  fx_dust_small: (c, w, h) => puff(c, w, h, P.sand, P.sandDark),
  fx_dust_large: (c, w, h) => {
    puff(c, w, h, P.sand, P.sandDark);
    puff(c, w * 0.7, h * 0.7, P.cream, P.sand);
  },
  fx_smoke: (c, w, h) => puff(c, w, h, '#f0f0f0', '#cfcfcf'),
  fx_debris_small: (c, w, h) => pebbles(c, w, h, 4, P.grey, P.greyDark),
  fx_debris_large: (c, w, h) => pebbles(c, w, h, 8, P.grey, P.woodDark),
  fx_sparks: (c, w, h) => sparks(c, w, h),
  fx_speed_lines: (c, w, h) => speedLines(c, w, h),
  fx_impact: (c, w, h) => impact(c, w, h),
  fx_water_splash: (c, w, h) => splash(c, w, h),
  fx_grass_spray: (c, w, h) => grassSpray(c, w, h),
};
