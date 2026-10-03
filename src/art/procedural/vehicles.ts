import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, box, ell, lw, poly } from './palette';

interface CarOpts {
  body: string;
  dark: string;
  cabin: 'open' | 'sedan' | 'van' | 'truck';
  /** 0 dritta, 1 sterzo leggero, 2 sterzo forte (verso sinistra). */
  turn?: number;
  lights?: boolean;
  people?: boolean;
  bodyW?: number;
  cargo?: string;
}

/** Due teste: guidatore capelli scuri a sinistra, passeggera bionda a destra. */
function occupants(ctx: Ctx2D, w: number, h: number, cx: number, top: number): void {
  const r = Math.max(3, w * 0.055);
  const k = lw(w, h);
  ell(ctx, cx - w * 0.1, top, r, r * 1.05, '#e8b98f', P.outline, k * 0.7);
  ell(ctx, cx - w * 0.1, top - r * 0.5, r * 1.05, r * 0.8, '#3b2a1e', P.outline, k * 0.7);
  ell(ctx, cx + w * 0.1, top, r, r * 1.05, '#f2c9a0', P.outline, k * 0.7);
  poly(
    ctx,
    [
      [cx + w * 0.1 - r * 1.2, top - r * 0.4],
      [cx + w * 0.1 + r * 1.3, top - r * 0.9],
      [cx + w * 0.1 + r * 2.1, top + r * 0.9],
      [cx + w * 0.1 - r * 0.6, top + r * 0.7],
    ],
    P.yellow,
    P.outline,
    k * 0.7,
  );
}

/** Auto vista da dietro: ruote, corpo trapezoidale, cabina, fari, targa. */
export function carRear(ctx: Ctx2D, w: number, h: number, o: CarOpts): void {
  const k = lw(w, h);
  const turn = o.turn ?? 0;
  const bw = w * (o.bodyW ?? 0.84);
  const shift = turn * w * 0.03;
  const x0 = (w - bw) / 2 + shift;
  const x1 = x0 + bw;
  const ground = h * 0.95;
  const hood = h * (o.cabin === 'truck' ? 0.5 : o.cabin === 'van' ? 0.42 : 0.55);
  const roof = h * (o.cabin === 'truck' ? 0.08 : o.cabin === 'van' ? 0.12 : 0.3);

  // ruote
  ell(ctx, x0 + bw * 0.15, ground - h * 0.05, bw * 0.12, h * 0.09, P.tyre, P.outline, k);
  ell(ctx, x1 - bw * 0.15, ground - h * 0.05, bw * 0.12, h * 0.09, P.tyre, P.outline, k);

  // cassone o cabina
  if (o.cabin === 'truck') {
    box(ctx, x0 + bw * 0.03, roof, bw * 0.94, hood - roof, o.cargo ?? P.greenDark, P.outline, k);
    for (let i = 1; i < 4; i += 1) {
      box(ctx, x0 + bw * 0.03, roof + ((hood - roof) * i) / 4, bw * 0.94, k, P.outline);
    }
  } else if (o.cabin === 'van') {
    poly(
      ctx,
      [
        [x0 + bw * 0.04, hood],
        [x0 + bw * 0.08, roof],
        [x1 - bw * 0.08, roof],
        [x1 - bw * 0.04, hood],
      ],
      o.body,
      P.outline,
      k,
    );
    box(ctx, x0 + bw * 0.16, roof + h * 0.04, bw * 0.3, (hood - roof) * 0.5, P.glass, P.outline, k * 0.7);
    box(ctx, x1 - bw * 0.46, roof + h * 0.04, bw * 0.3, (hood - roof) * 0.5, P.glass, P.outline, k * 0.7);
  } else if (o.cabin === 'sedan') {
    poly(
      ctx,
      [
        [x0 + bw * 0.1, hood],
        [x0 + bw * 0.18, roof],
        [x1 - bw * 0.18, roof],
        [x1 - bw * 0.1, hood],
      ],
      o.body,
      P.outline,
      k,
    );
    box(ctx, x0 + bw * 0.21, roof + h * 0.03, bw * 0.58, (hood - roof) * 0.62, P.glass, P.outline, k * 0.7);
  } else {
    // cabrio: parabrezza basso e sedili
    poly(
      ctx,
      [
        [x0 + bw * 0.18, hood],
        [x0 + bw * 0.26, roof + h * 0.06],
        [x1 - bw * 0.26, roof + h * 0.06],
        [x1 - bw * 0.18, hood],
      ],
      o.dark,
      P.outline,
      k * 0.8,
    );
    if (o.people) occupants(ctx, w, h, w / 2 + shift, roof + h * 0.02);
  }

  // corpo
  poly(
    ctx,
    [
      [x0, ground - h * 0.08],
      [x0 + bw * 0.02, hood + h * 0.03],
      [x0 + bw * 0.12 + turn * bw * 0.02, hood],
      [x1 - bw * 0.12 + turn * bw * 0.02, hood],
      [x1 - bw * 0.02, hood + h * 0.03],
      [x1, ground - h * 0.08],
    ],
    o.body,
    P.outline,
    k,
  );

  // fianco visibile quando sterza
  if (turn > 0) {
    poly(
      ctx,
      [
        [x0, ground - h * 0.08],
        [x0 - turn * bw * 0.07, ground - h * 0.12],
        [x0 - turn * bw * 0.05, hood + h * 0.02],
        [x0 + bw * 0.02, hood + h * 0.03],
      ],
      o.dark,
      P.outline,
      k,
    );
  }

  // fascia scura, fanali, targa
  box(ctx, x0 + bw * 0.04, ground - h * 0.2, bw * 0.92, h * 0.07, o.dark);
  const lampColor = o.lights ? P.redLight : P.redDark;
  box(ctx, x0 + bw * 0.08, hood + h * 0.1, bw * 0.2, h * 0.08, lampColor, P.outline, k * 0.7);
  box(ctx, x1 - bw * 0.28, hood + h * 0.1, bw * 0.2, h * 0.08, lampColor, P.outline, k * 0.7);
  box(ctx, w / 2 + shift - bw * 0.1, ground - h * 0.19, bw * 0.2, h * 0.05, P.cream, P.outline, k * 0.7);
}

/** Auto di profilo, per i frame di testacoda. `dir` -1 guarda a sinistra. */
function carSide(ctx: Ctx2D, w: number, h: number, dir: -1 | 1): void {
  const k = lw(w, h);
  const ground = h * 0.95;
  const bw = w * 0.96;
  const x0 = (w - bw) / 2;
  const x1 = x0 + bw;
  const nose = dir < 0 ? x0 : x1;
  const tail = dir < 0 ? x1 : x0;
  const mid = (nose + tail) / 2;
  ell(ctx, nose + (tail - nose) * 0.22, ground - h * 0.06, bw * 0.1, h * 0.1, P.tyre, P.outline, k);
  ell(ctx, nose + (tail - nose) * 0.78, ground - h * 0.06, bw * 0.1, h * 0.1, P.tyre, P.outline, k);
  poly(
    ctx,
    [
      [nose, ground - h * 0.2],
      [nose + (tail - nose) * 0.1, ground - h * 0.32],
      [mid - (tail - nose) * 0.06, ground - h * 0.52],
      [mid + (tail - nose) * 0.1, ground - h * 0.5],
      [tail - (tail - nose) * 0.06, ground - h * 0.3],
      [tail, ground - h * 0.16],
      [tail, ground - h * 0.1],
      [nose, ground - h * 0.12],
    ],
    P.red,
    P.outline,
    k,
  );
  poly(
    ctx,
    [
      [mid - (tail - nose) * 0.04, ground - h * 0.5],
      [mid + (tail - nose) * 0.08, ground - h * 0.48],
      [mid + (tail - nose) * 0.12, ground - h * 0.34],
      [mid - (tail - nose) * 0.02, ground - h * 0.34],
    ],
    P.glassLight,
    P.outline,
    k * 0.7,
  );
  ell(ctx, mid + (tail - nose) * 0.04, ground - h * 0.54, bw * 0.045, h * 0.05, '#3b2a1e', P.outline, k * 0.6);
  ell(ctx, mid + (tail - nose) * 0.16, ground - h * 0.53, bw * 0.05, h * 0.055, P.yellow, P.outline, k * 0.6);
  box(ctx, Math.min(nose, tail), ground - h * 0.14, bw, h * 0.05, P.redDark);
}

/** Auto vista di fronte, terzo frame del testacoda. */
function carFront(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const bw = w * 0.82;
  const x0 = (w - bw) / 2;
  const x1 = x0 + bw;
  const ground = h * 0.95;
  const hood = h * 0.56;
  ell(ctx, x0 + bw * 0.15, ground - h * 0.05, bw * 0.12, h * 0.09, P.tyre, P.outline, k);
  ell(ctx, x1 - bw * 0.15, ground - h * 0.05, bw * 0.12, h * 0.09, P.tyre, P.outline, k);
  poly(
    ctx,
    [
      [x0 + bw * 0.18, hood],
      [x0 + bw * 0.26, h * 0.3],
      [x1 - bw * 0.26, h * 0.3],
      [x1 - bw * 0.18, hood],
    ],
    P.glassLight,
    P.outline,
    k * 0.8,
  );
  occupants(ctx, w, h, w / 2, h * 0.34);
  poly(
    ctx,
    [
      [x0, ground - h * 0.08],
      [x0 + bw * 0.03, hood + h * 0.04],
      [x0 + bw * 0.14, hood],
      [x1 - bw * 0.14, hood],
      [x1 - bw * 0.03, hood + h * 0.04],
      [x1, ground - h * 0.08],
    ],
    P.red,
    P.outline,
    k,
  );
  box(ctx, x0 + bw * 0.08, hood + h * 0.08, bw * 0.18, h * 0.07, P.cream, P.outline, k * 0.7);
  box(ctx, x1 - bw * 0.26, hood + h * 0.08, bw * 0.18, h * 0.07, P.cream, P.outline, k * 0.7);
  box(ctx, x0 + bw * 0.3, ground - h * 0.2, bw * 0.4, h * 0.08, P.tyre, P.outline, k * 0.7);
}

/** Moto vista da dietro con pilota. */
function bike(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const cx = w / 2;
  const ground = h * 0.95;
  box(ctx, cx - w * 0.13, ground - h * 0.3, w * 0.26, h * 0.28, P.tyre, P.outline, k);
  ell(ctx, cx, ground - h * 0.06, w * 0.1, h * 0.07, P.tyre, P.outline, k);
  box(ctx, cx - w * 0.1, ground - h * 0.34, w * 0.2, h * 0.06, P.redDark, P.outline, k * 0.7);
  poly(
    ctx,
    [
      [cx - w * 0.18, ground - h * 0.36],
      [cx - w * 0.12, ground - h * 0.62],
      [cx + w * 0.12, ground - h * 0.62],
      [cx + w * 0.18, ground - h * 0.36],
    ],
    '#2b2b33',
    P.outline,
    k,
  );
  ell(ctx, cx, ground - h * 0.72, w * 0.13, h * 0.11, P.white, P.outline, k);
  box(ctx, cx - w * 0.1, ground - h * 0.76, w * 0.2, h * 0.05, P.glass, P.outline, k * 0.6);
  box(ctx, cx - w * 0.24, ground - h * 0.52, w * 0.1, h * 0.05, '#2b2b33', P.outline, k * 0.6);
  box(ctx, cx + w * 0.14, ground - h * 0.52, w * 0.1, h * 0.05, '#2b2b33', P.outline, k * 0.6);
}

/**
 * Disegna specchiato in orizzontale. È il ripiego dei frame destri
 * (spec §4.4 punto 5): il PNG vero ha i passeggeri al posto giusto, il
 * disegno da codice si accontenta dello specchio del frame sinistro.
 */
function mirrored(ctx: Ctx2D, w: number, h: number, draw: (c: Ctx2D, w: number, h: number) => void): void {
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  draw(ctx, w, h);
  ctx.restore();
}

export const VEHICLES: Record<SpriteName, Drawer> = {
  player_straight: (c, w, h) => carRear(c, w, h, { body: P.red, dark: P.redDark, cabin: 'open', people: true }),
  player_left1: (c, w, h) => carRear(c, w, h, { body: P.red, dark: P.redDark, cabin: 'open', people: true, turn: 1 }),
  player_left2: (c, w, h) => carRear(c, w, h, { body: P.red, dark: P.redDark, cabin: 'open', people: true, turn: 2 }),
  player_right1: (c, w, h) =>
    mirrored(c, w, h, (cc, ww, hh) =>
      carRear(cc, ww, hh, { body: P.red, dark: P.redDark, cabin: 'open', people: true, turn: 1 }),
    ),
  player_right2: (c, w, h) =>
    mirrored(c, w, h, (cc, ww, hh) =>
      carRear(cc, ww, hh, { body: P.red, dark: P.redDark, cabin: 'open', people: true, turn: 2 }),
    ),
  player_brake: (c, w, h) =>
    carRear(c, w, h, { body: P.red, dark: P.redDark, cabin: 'open', people: true, lights: true }),
  player_spin_0: (c, w, h) => carRear(c, w, h, { body: P.red, dark: P.redDark, cabin: 'open', people: true }),
  player_spin_1: (c, w, h) => carSide(c, w, h, -1),
  player_spin_2: (c, w, h) => carFront(c, w, h),
  player_spin_3: (c, w, h) => carSide(c, w, h, 1),
  traffic_sedan: (c, w, h) => carRear(c, w, h, { body: P.white, dark: P.greyDark, cabin: 'sedan' }),
  traffic_hatchback: (c, w, h) => carRear(c, w, h, { body: P.yellow, dark: P.yellowDark, cabin: 'sedan', bodyW: 0.8 }),
  traffic_van: (c, w, h) => carRear(c, w, h, { body: '#7cc4e8', dark: '#3b7fa3', cabin: 'van', bodyW: 0.88 }),
  traffic_truck: (c, w, h) =>
    carRear(c, w, h, { body: P.greenDark, dark: '#0c3315', cabin: 'truck', bodyW: 0.94, cargo: '#2d5c34' }),
  traffic_bike: (c, w, h) => bike(c, w, h),
  traffic_coupe: (c, w, h) => carRear(c, w, h, { body: P.red, dark: P.redDark, cabin: 'sedan', bodyW: 0.82 }),
  traffic_offroad: (c, w, h) =>
    carRear(c, w, h, { body: P.cream, dark: '#6b6252', cabin: 'van', bodyW: 0.84 }),
  traffic_sportscar: (c, w, h) =>
    carRear(c, w, h, { body: '#20c4d8', dark: '#0d6b7a', cabin: 'sedan', bodyW: 0.8 }),
  traffic_bus: (c, w, h) =>
    carRear(c, w, h, { body: P.orange, dark: P.orangeDark, cabin: 'van', bodyW: 0.96 }),
  traffic_pickup: (c, w, h) =>
    carRear(c, w, h, { body: '#3f8f4f', dark: '#1d5a2b', cabin: 'truck', bodyW: 0.86, cargo: '#2c6b3a' }),
  // Sportive extra del Set 6 (anticipate dal binario I).
  traffic_supercar: (c, w, h) =>
    carRear(c, w, h, { body: P.white, dark: P.greyDark, cabin: 'sedan', bodyW: 0.78 }),
  traffic_roadster: (c, w, h) =>
    carRear(c, w, h, { body: P.blue, dark: P.blueDark, cabin: 'open', bodyW: 0.76 }),
  traffic_muscle: (c, w, h) =>
    carRear(c, w, h, { body: '#23222a', dark: '#0d0d10', cabin: 'sedan', bodyW: 0.9 }),
  traffic_rally: (c, w, h) =>
    carRear(c, w, h, { body: P.red, dark: P.redDark, cabin: 'sedan', bodyW: 0.82, lights: true }),
};
