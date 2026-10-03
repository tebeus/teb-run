import type { SpriteName, WallKind } from '../../types';
import { type Ctx2D, type Drawer, P } from './palette';

/** Lato della tessera di parete (spec §13, Set 2). */
export const WALL_TILE = 256;

/**
 * Passo del motivo ripetuto, in pixel della tessera. `WALL_TILE` significa
 * «un solo motivo per tessera»: la roccia non deve sembrare stampata.
 */
export const WALL_PERIOD: Record<WallKind, number> = {
  rock_red: 256,
  rock_grey: 256,
  guardrail: 64,
  seawall: 64,
  hedge: 128,
  bridge_rail: 32,
  town_facades: 128,
};

/**
 * Una forma della tessera. Per `kind: 'ell'`, `x`/`y` sono il centro e
 * `w`/`h` i diametri: così i limiti si calcolano allo stesso modo per tutte.
 */
export interface WallShape {
  kind: 'box' | 'ell';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  alpha?: number;
}

const bx = (x: number, y: number, w: number, h: number, fill: string, alpha?: number): WallShape => ({
  kind: 'box',
  x,
  y,
  w,
  h,
  fill,
  ...(alpha === undefined ? {} : { alpha }),
});

const el = (x: number, y: number, w: number, h: number, fill: string): WallShape => ({
  kind: 'ell',
  x,
  y,
  w,
  h,
  fill,
});

/** Strati di roccia: fasce orizzontali piene più crepe verticali interne. */
function rockShapes(t: number, light: string, mid: string, dark: string): WallShape[] {
  const out: WallShape[] = [bx(0, 0, t, t, mid)];
  const strata = [0.1, 0.28, 0.44, 0.62, 0.8];
  for (let i = 0; i < strata.length; i++) {
    out.push(bx(0, t * strata[i], t, t * 0.06, i % 2 === 0 ? dark : light));
  }
  const cracks = [0.14, 0.33, 0.52, 0.71, 0.9];
  for (let i = 0; i < cracks.length; i++) {
    const h = t * (0.3 + 0.12 * (i % 3));
    out.push(bx(t * cracks[i], t * (0.08 + 0.1 * (i % 2)), t * 0.02, h, dark));
  }
  out.push(bx(0, t * 0.92, t, t * 0.08, dark));
  return out;
}

/** Facciate di città: cornicione, pilastri e due file di finestre per cella. */
function facadeShapes(t: number, period: number): WallShape[] {
  const out: WallShape[] = [bx(0, 0, t, t, P.ochre), bx(0, 0, t, t * 0.09, P.ochreDark)];
  for (let x = 0; x < t; x += period) {
    out.push(bx(x + period * 0.02, 0, period * 0.06, t, P.ochreDark));
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        out.push(
          bx(
            x + period * (0.18 + 0.26 * col),
            t * (0.24 + 0.36 * row),
            period * 0.16,
            t * 0.2,
            P.glass,
          ),
        );
      }
    }
  }
  out.push(bx(0, t * 0.94, t, t * 0.06, P.ochreDark));
  return out;
}

/** Muro a mare: corsi di blocchi, i dispari sfalsati di mezzo blocco. */
function seawallShapes(t: number, period: number): WallShape[] {
  const out: WallShape[] = [bx(0, 0, t, t, P.stoneDark)];
  const rows = 4;
  const rh = t / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * rh + rh * 0.08;
    const bh = rh * 0.84;
    if (row % 2 === 0) {
      for (let x = 0; x < t; x += period) {
        out.push(bx(x + period * 0.04, y, period * 0.92, bh, P.stone));
      }
    } else {
      // Il mezzo blocco a destra e quello a sinistra si ricompongono quando
      // la tessera si affianca a se stessa: nessuna forma esce dal riquadro.
      out.push(bx(0, y, period * 0.46, bh, P.stone));
      for (let x = period / 2; x + period <= t; x += period) {
        out.push(bx(x + period * 0.04, y, period * 0.92, bh, P.stone));
      }
      out.push(bx(t - period * 0.46, y, period * 0.46, bh, P.stone));
    }
  }
  return out;
}

/** Guard-rail: nastro metallico continuo, pali sotto, resto trasparente. */
function guardrailShapes(t: number, period: number): WallShape[] {
  const out: WallShape[] = [
    bx(0, t * 0.06, t, t * 0.34, P.metal),
    bx(0, t * 0.34, t, t * 0.1, P.metalDark),
  ];
  for (let x = 0; x < t; x += period) {
    out.push(bx(x + period * 0.4, t * 0.44, period * 0.18, t * 0.5, P.metalDark));
  }
  return out;
}

/** Ringhiera del ponte: due correnti continui e i piantoni in mezzo. */
function railShapes(t: number, period: number): WallShape[] {
  const out: WallShape[] = [
    bx(0, t * 0.04, t, t * 0.2, P.white),
    bx(0, t * 0.78, t, t * 0.16, P.grey),
  ];
  for (let x = 0; x < t; x += period) {
    out.push(bx(x + period * 0.34, t * 0.24, period * 0.3, t * 0.54, P.white));
  }
  return out;
}

/** Siepe: zoccolo continuo e cespugli tondi sopra, cielo libero in alto. */
function hedgeShapes(t: number, period: number): WallShape[] {
  const out: WallShape[] = [bx(0, t * 0.3, t, t * 0.7, P.greenDark)];
  for (let x = 0; x < t; x += period) {
    out.push(el(x + period * 0.25, t * 0.32, period * 0.44, t * 0.3, P.green));
    out.push(el(x + period * 0.75, t * 0.34, period * 0.44, t * 0.28, P.greenDark));
  }
  return out;
}

/** Forme di una tessera di parete: pura, deterministica, dentro il riquadro. */
export function wallShapes(kind: WallKind, tile: number = WALL_TILE): WallShape[] {
  const t = tile;
  const period = (WALL_PERIOD[kind] * t) / WALL_TILE;
  switch (kind) {
    case 'rock_red':
      return rockShapes(t, '#e08a4a', P.rock, P.rockDark);
    case 'rock_grey':
      return rockShapes(t, '#d5dade', P.grey, P.greyDark);
    case 'guardrail':
      return guardrailShapes(t, period);
    case 'seawall':
      return seawallShapes(t, period);
    case 'hedge':
      return hedgeShapes(t, period);
    case 'bridge_rail':
      return railShapes(t, period);
    case 'town_facades':
      return facadeShapes(t, period);
  }
}

/** Disegna una lista di forme. Nessuna trasformazione: i limiti restano veri. */
export function drawShapes(ctx: Ctx2D, shapes: readonly WallShape[]): void {
  for (const s of shapes) {
    if (s.alpha !== undefined) ctx.globalAlpha = s.alpha;
    ctx.fillStyle = s.fill;
    if (s.kind === 'box') {
      ctx.fillRect(s.x, s.y, s.w, s.h);
    } else {
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (s.alpha !== undefined) ctx.globalAlpha = 1;
  }
}

const wall = (kind: WallKind): Drawer => (ctx, w, h) => {
  // Le tessere sono quadrate: si usa il lato minore, così un target diverso
  // non deforma il motivo e i limiti restano dentro il riquadro.
  drawShapes(ctx, wallShapes(kind, Math.min(w, h)));
};

/** Le sette tessere di parete del Set 2 (spec §13). */
export const WALLS: Record<SpriteName, Drawer> = {
  wall_rock_red: wall('rock_red'),
  wall_rock_grey: wall('rock_grey'),
  wall_guardrail: wall('guardrail'),
  wall_seawall: wall('seawall'),
  wall_hedge: wall('hedge'),
  wall_bridge_rail: wall('bridge_rail'),
  wall_town_facades: wall('town_facades'),
};
