import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, box, ell, lw, poly } from './palette';
import { blob, building, coneTree, fenceRails, rockPile } from './scenery';

/** Palo con cartello triangolare: freccia di curva. */
function chevronSign(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.44, h * 0.3, w * 0.12, h * 0.68, P.metalDark, P.outline, k);
  poly(
    ctx,
    [
      [w * 0.08, h * 0.3],
      [w * 0.92, h * 0.3],
      [w * 0.92, h * 0.04],
      [w * 0.08, h * 0.04],
    ],
    P.yellow,
    P.outline,
    k,
  );
  poly(
    ctx,
    [
      [w * 0.24, h * 0.08],
      [w * 0.72, h * 0.17],
      [w * 0.24, h * 0.26],
    ],
    P.outline,
  );
}

/** Palo con disco: limite di velocità, cerchio rosso su fondo bianco. */
function discSign(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.44, h * 0.34, w * 0.12, h * 0.64, P.metalDark, P.outline, k);
  ell(ctx, w * 0.5, h * 0.24, w * 0.42, h * 0.22, P.white, P.outline, k);
  ell(ctx, w * 0.5, h * 0.24, w * 0.34, h * 0.18, P.red, P.outline, k * 0.8);
  ell(ctx, w * 0.5, h * 0.24, w * 0.24, h * 0.13, P.white);
}

/** Lampione d'autostrada: palo alto e braccio curvo con la lanterna. */
function highwayLamp(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.42, h * 0.1, w * 0.16, h * 0.88, P.grey, P.outline, k);
  poly(
    ctx,
    [
      [w * 0.5, h * 0.12],
      [w * 0.86, h * 0.04],
      [w * 0.86, h * 0.1],
      [w * 0.5, h * 0.18],
    ],
    P.grey,
    P.outline,
    k * 0.8,
  );
  box(ctx, w * 0.74, h * 0.08, w * 0.24, h * 0.05, P.cream, P.outline, k * 0.8);
  box(ctx, w * 0.3, h * 0.94, w * 0.4, h * 0.06, P.greyDark, P.outline, k * 0.8);
}

/** Pilone di ponte: fusto in cemento con due fasce e base larga. */
function pylon(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.26, h * 0.06, w * 0.48, h * 0.9, P.stone, P.outline, k);
  box(ctx, w * 0.26, h * 0.06, w * 0.16, h * 0.9, P.stoneDark);
  box(ctx, w * 0.18, h * 0.3, w * 0.64, h * 0.05, P.stoneDark, P.outline, k * 0.7);
  box(ctx, w * 0.18, h * 0.62, w * 0.64, h * 0.05, P.stoneDark, P.outline, k * 0.7);
  box(ctx, w * 0.1, h * 0.92, w * 0.8, h * 0.08, P.greyDark, P.outline, k);
}

/** Torretta del bagnino: capanna su quattro gambe con scaletta. */
function stiltHut(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  for (const x of [0.22, 0.38, 0.6, 0.76]) {
    box(ctx, w * x, h * 0.52, w * 0.06, h * 0.46, P.woodDark, P.outline, k * 0.7);
  }
  box(ctx, w * 0.14, h * 0.26, w * 0.72, h * 0.28, P.cream, P.outline, k);
  box(ctx, w * 0.2, h * 0.32, w * 0.3, h * 0.14, P.glass, P.outline, k * 0.7);
  poly(
    ctx,
    [
      [w * 0.06, h * 0.26],
      [w * 0.5, h * 0.06],
      [w * 0.94, h * 0.26],
    ],
    P.red,
    P.outline,
    k,
  );
  for (let i = 0; i < 3; i += 1) {
    box(ctx, w * 0.62, h * (0.62 + i * 0.12), w * 0.24, h * 0.04, P.wood, P.outline, k * 0.6);
  }
}

/** Barca in secca: scafo, fascia e albero. */
function boat(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.48, h * 0.1, w * 0.05, h * 0.55, P.wood, P.outline, k * 0.8);
  poly(
    ctx,
    [
      [w * 0.52, h * 0.14],
      [w * 0.82, h * 0.6],
      [w * 0.52, h * 0.6],
    ],
    P.white,
    P.outline,
    k * 0.8,
  );
  poly(
    ctx,
    [
      [w * 0.06, h * 0.62],
      [w * 0.94, h * 0.62],
      [w * 0.8, h * 0.94],
      [w * 0.2, h * 0.94],
    ],
    P.blue,
    P.outline,
    k,
  );
  box(ctx, w * 0.08, h * 0.7, w * 0.84, h * 0.07, P.white);
}

/** Arco di roccia: due piedi e un ponte naturale. */
function rockArch(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  poly(
    ctx,
    [
      [w * 0.02, h * 0.98],
      [w * 0.1, h * 0.3],
      [w * 0.3, h * 0.28],
      [w * 0.3, h * 0.98],
    ],
    P.rock,
    P.outline,
    k,
  );
  poly(
    ctx,
    [
      [w * 0.7, h * 0.98],
      [w * 0.7, h * 0.28],
      [w * 0.9, h * 0.3],
      [w * 0.98, h * 0.98],
    ],
    P.rock,
    P.outline,
    k,
  );
  poly(
    ctx,
    [
      [w * 0.08, h * 0.3],
      [w * 0.5, h * 0.06],
      [w * 0.92, h * 0.3],
      [w * 0.7, h * 0.34],
      [w * 0.5, h * 0.22],
      [w * 0.3, h * 0.34],
    ],
    P.rockDark,
    P.outline,
    k,
  );
}

/** Palina di montagna: due frecce di legno su un palo. */
function armSign(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.44, h * 0.1, w * 0.12, h * 0.88, P.woodDark, P.outline, k);
  poly(
    ctx,
    [
      [w * 0.1, h * 0.18],
      [w * 0.78, h * 0.18],
      [w * 0.92, h * 0.26],
      [w * 0.78, h * 0.34],
      [w * 0.1, h * 0.34],
    ],
    P.cream,
    P.outline,
    k * 0.8,
  );
  poly(
    ctx,
    [
      [w * 0.9, h * 0.44],
      [w * 0.22, h * 0.44],
      [w * 0.08, h * 0.52],
      [w * 0.22, h * 0.6],
      [w * 0.9, h * 0.6],
    ],
    P.wood,
    P.outline,
    k * 0.8,
  );
}

/** Trattore visto di tre quarti: ruota grande dietro, cabina e cofano. */
function tractor(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  ell(ctx, w * 0.26, h * 0.74, w * 0.22, h * 0.22, P.tyre, P.outline, k);
  ell(ctx, w * 0.26, h * 0.74, w * 0.1, h * 0.1, P.metal);
  ell(ctx, w * 0.74, h * 0.82, w * 0.13, h * 0.13, P.tyre, P.outline, k);
  box(ctx, w * 0.56, h * 0.5, w * 0.34, h * 0.3, P.green, P.outline, k);
  box(ctx, w * 0.16, h * 0.26, w * 0.34, h * 0.32, P.green, P.outline, k);
  box(ctx, w * 0.22, h * 0.3, w * 0.22, h * 0.16, P.glass, P.outline, k * 0.7);
  box(ctx, w * 0.62, h * 0.36, w * 0.08, h * 0.16, P.greyDark, P.outline, k * 0.7);
}

/** Silo: cilindro con cupola e scaletta. */
function silo(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.2, h * 0.18, w * 0.6, h * 0.8, P.metal, P.outline, k);
  box(ctx, w * 0.2, h * 0.18, w * 0.18, h * 0.8, P.metalDark);
  for (let i = 1; i < 5; i += 1) {
    box(ctx, w * 0.2, h * (0.18 + 0.16 * i), w * 0.6, h * 0.01, P.metalDark);
  }
  ell(ctx, w * 0.5, h * 0.18, w * 0.3, h * 0.14, P.grey, P.outline, k);
  box(ctx, w * 0.82, h * 0.24, w * 0.05, h * 0.7, P.greyDark, P.outline, k * 0.6);
}

/** Caffè: edificio con tenda a righe e tavolini. */
function cafe(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  building(ctx, w, h, {
    wall: P.cream,
    wallDark: P.sandDark,
    roof: P.brick,
    roofKind: 'tile',
    floors: 1,
    windows: 2,
    door: true,
    glass: '#2f6f5e',
  });
  const y = h * 0.6;
  for (let i = 0; i < 6; i += 1) {
    box(ctx, w * (0.12 + 0.13 * i), y, w * 0.13, h * 0.08, i % 2 === 0 ? P.red : P.white, P.outline, k * 0.5);
  }
  box(ctx, w * 0.12, y + h * 0.08, w * 0.78, h * 0.02, P.outline);
  ell(ctx, w * 0.3, h * 0.88, w * 0.1, h * 0.03, P.greyDark, P.outline, k * 0.5);
  ell(ctx, w * 0.66, h * 0.9, w * 0.1, h * 0.03, P.greyDark, P.outline, k * 0.5);
}

/** Fermata dell'autobus: pensilina, panca e palina. */
function busStop(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.1, h * 0.3, w * 0.06, h * 0.68, P.metalDark, P.outline, k * 0.8);
  box(ctx, w * 0.62, h * 0.3, w * 0.06, h * 0.68, P.metalDark, P.outline, k * 0.8);
  box(ctx, w * 0.16, h * 0.34, w * 0.46, h * 0.48, P.glass, P.outline, k * 0.7);
  box(ctx, w * 0.04, h * 0.2, w * 0.7, h * 0.12, P.blue, P.outline, k);
  box(ctx, w * 0.18, h * 0.76, w * 0.42, h * 0.08, P.wood, P.outline, k * 0.7);
  box(ctx, w * 0.82, h * 0.26, w * 0.05, h * 0.72, P.grey, P.outline, k * 0.7);
  ell(ctx, w * 0.845, h * 0.22, w * 0.11, h * 0.07, P.yellow, P.outline, k * 0.7);
}

/** Una figura in piedi: testa, corpo, due gambe. Due toni più contorno. */
function person(
  ctx: Ctx2D,
  x: number,
  base: number,
  h: number,
  shirt: string,
  skin: string,
  k: number,
): void {
  const w = h * 0.34;
  ell(ctx, x, base - h * 0.88, w * 0.36, h * 0.12, skin, P.outline, k * 0.6);
  poly(
    ctx,
    [
      [x - w * 0.42, base - h * 0.28],
      [x - w * 0.36, base - h * 0.76],
      [x + w * 0.36, base - h * 0.76],
      [x + w * 0.42, base - h * 0.28],
    ],
    shirt,
    P.outline,
    k * 0.7,
  );
  box(ctx, x - w * 0.3, base - h * 0.3, w * 0.22, h * 0.3, P.blueDark, P.outline, k * 0.5);
  box(ctx, x + w * 0.08, base - h * 0.3, w * 0.22, h * 0.3, P.blueDark, P.outline, k * 0.5);
}

/** Fila di spettatori che esultano dietro una transenna. */
function crowd(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const shirts = [P.red, P.yellow, P.teal, P.white, P.orange, P.pink, P.blue, P.greenLight];
  const skins = ['#e8b98f', '#c98d63', '#f2c9a0', '#a9704a'];
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const x = w * (0.06 + (0.88 * i) / (n - 1));
    const tall = h * (0.78 + (0.16 * ((i * 7) % 3)) / 2);
    person(ctx, x, h * 0.92, tall, shirts[i % shirts.length], skins[i % skins.length], k);
  }
  // Transenna davanti: due correnti orizzontali.
  box(ctx, 0, h * 0.7, w, h * 0.06, P.metal, P.outline, k * 0.7);
  box(ctx, 0, h * 0.86, w, h * 0.05, P.metalDark, P.outline, k * 0.7);
}

/** Bagnanti: tre figure in costume e un ombrellone. */
function bathers(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.74, h * 0.3, w * 0.04, h * 0.66, P.wood, P.outline, k * 0.6);
  poly(
    ctx,
    [
      [w * 0.52, h * 0.34],
      [w * 0.76, h * 0.1],
      [w * 0.98, h * 0.34],
    ],
    P.red,
    P.outline,
    k,
  );
  person(ctx, w * 0.2, h * 0.96, h * 0.8, P.yellow, '#e8b98f', k);
  person(ctx, w * 0.4, h * 0.96, h * 0.72, P.teal, '#c98d63', k);
  person(ctx, w * 0.58, h * 0.96, h * 0.66, P.pink, '#f2c9a0', k);
}

/** Uomo con la bandiera a scacchi: figura più bandiera a scacchiera. */
function flagman(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  person(ctx, w * 0.36, h * 0.98, h * 0.82, P.white, '#e8b98f', k);
  box(ctx, w * 0.5, h * 0.1, w * 0.04, h * 0.6, P.woodDark, P.outline, k * 0.6);
  const cols = 4;
  const rows = 3;
  const fw = w * 0.42;
  const fh = h * 0.26;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const dark = (r + c) % 2 === 0;
      box(ctx, w * 0.54 + (fw * c) / cols, h * 0.12 + (fh * r) / rows, fw / cols, fh / rows, dark ? P.outline : P.white);
    }
  }
  box(ctx, w * 0.54, h * 0.12, fw, fh, 'rgba(0,0,0,0)', P.outline, k * 0.6);
}

/** I 18 oggetti di scenografia del Set 2 (spec §13). */
export const SCENERY2: Record<SpriteName, Drawer> = {
  common_sign_chevron: (c, w, h) => chevronSign(c, w, h),
  common_sign_speed: (c, w, h) => discSign(c, w, h),
  common_lamp_highway: (c, w, h) => highwayLamp(c, w, h),
  common_bridge_pylon: (c, w, h) => pylon(c, w, h),
  common_boulder_large: (c, w, h) =>
    rockPile(c, w, h, { color: P.grey, dark: P.greyDark, peak: 0.3, snow: false }),
  beach_lifeguard_tower: (c, w, h) => stiltHut(c, w, h),
  beach_boat: (c, w, h) => boat(c, w, h),
  beach_rock_arch: (c, w, h) => rockArch(c, w, h),
  desert_pillar: (c, w, h) =>
    rockPile(c, w, h, { color: P.rock, dark: P.rockDark, peak: 0.95, snow: false }),
  desert_bush_dry: (c, w, h) =>
    blob(c, w, h, { color: P.ochre, dark: P.ochreDark, tall: 0.5 }),
  alpine_snow_pine: (c, w, h) =>
    coneTree(c, w, h, { tiers: 5, green: '#2f6b40', dark: '#1d4a2b', snow: true }),
  alpine_signpost: (c, w, h) => armSign(c, w, h),
  farm_tractor: (c, w, h) => tractor(c, w, h),
  farm_fence_wood: (c, w, h) => fenceRails(c, w, h, { posts: 4, rails: 3 }),
  farm_silo: (c, w, h) => silo(c, w, h),
  town_cafe: (c, w, h) => cafe(c, w, h),
  town_bus_stop: (c, w, h) => busStop(c, w, h),
  town_tower: (c, w, h) =>
    building(c, w, h, {
      wall: P.brick,
      wallDark: P.brickDark,
      roof: P.greyDark,
      roofKind: 'flat',
      floors: 4,
      windows: 2,
      door: true,
      glass: P.cream,
    }),
  beach_bathers: (c, w, h) => bathers(c, w, h),
  common_crowd: (c, w, h) => crowd(c, w, h),
  common_flagman: (c, w, h) => flagman(c, w, h),
};
