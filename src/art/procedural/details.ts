import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, ell, lw, poly } from './palette';

/**
 * Dettagli del fuori strada (spec §4.4a): solo procedurali, nessun PNG.
 * **Deroga dichiarata:** la spec li dice «colorati per tema» ma ne elenca tre
 * nomi soli; sono disegnati in tinte terra e verde che leggono su tutti i
 * cinque temi. Varianti per tema vorrebbero nomi nuovi nel catalogo.
 */

/** Ciuffo d'erba: cinque lame che partono dalla base. */
function tuft(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.96;
  const blades: readonly (readonly [number, number, number])[] = [
    [0.18, 0.34, -0.1],
    [0.34, 0.12, 0.05],
    [0.5, 0.04, 0],
    [0.66, 0.14, -0.06],
    [0.82, 0.38, 0.1],
  ];
  for (let i = 0; i < blades.length; i++) {
    const [x, top, bend] = blades[i];
    poly(
      ctx,
      [
        [w * (x - 0.06), base],
        [w * (x + bend), h * top],
        [w * (x + 0.06), base],
      ],
      i % 2 === 0 ? P.green : P.greenDark,
      P.outline,
      k * 0.5,
    );
  }
}

/** Sasso: due ellissi, quella sotto in ombra. */
function stone(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  ell(ctx, w * 0.52, h * 0.78, w * 0.4, h * 0.2, P.greyDark, P.outline, k * 0.6);
  ell(ctx, w * 0.46, h * 0.56, w * 0.34, h * 0.3, P.grey, P.outline, k * 0.7);
}

/** Crepa: una linea spezzata scura con un bordo chiaro sotto. */
function crack(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const pts: readonly (readonly [number, number])[] = [
    [w * 0.04, h * 0.7],
    [w * 0.3, h * 0.52],
    [w * 0.52, h * 0.74],
    [w * 0.78, h * 0.5],
    [w * 0.96, h * 0.66],
  ];
  poly(ctx, [...pts, [w * 0.96, h * 0.82], [w * 0.04, h * 0.86]], P.woodDark, P.outline, k * 0.5);
  poly(
    ctx,
    [
      [w * 0.06, h * 0.84],
      [w * 0.94, h * 0.8],
      [w * 0.94, h * 0.9],
      [w * 0.06, h * 0.92],
    ],
    P.sandDark,
  );
}

/** I tre dettagli di terreno (spec §4.4a). */
export const DETAILS: Record<SpriteName, Drawer> = {
  ground_tuft: (c, w, h) => tuft(c, w, h),
  ground_stone: (c, w, h) => stone(c, w, h),
  ground_crack: (c, w, h) => crack(c, w, h),
};
