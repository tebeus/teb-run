import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, box, ell, lw, poly } from './palette';

/**
 * Vita a bordo strada (spec §13): figure piccole, due toni e contorno,
 * larghe circa 0.6 volte l'auto del giocatore. A schermo sono alte 30-60
 * px, quindi contano la sagoma e il colore, non il dettaglio.
 */

/**
 * Figura umana in piedi: testa, busto, due gambe. `pose` alza un braccio
 * (`wave`), abbassa la figura sulle ginocchia (`kneel`) o lascia stare.
 */
function person(
  ctx: Ctx2D,
  w: number,
  h: number,
  o: { shirt: string; trousers: string; skin: string; pose: 'stand' | 'wave' | 'kneel'; cx?: number },
): void {
  const k = lw(w, h);
  const cx = (o.cx ?? 0.5) * w;
  const top = o.pose === 'kneel' ? h * 0.22 : h * 0.04;
  const headR = w * 0.11;
  const shoulder = top + headR * 2.2;
  const hip = o.pose === 'kneel' ? h * 0.74 : h * 0.62;
  ell(ctx, cx, top + headR, headR, headR * 1.05, o.skin, P.outline, k * 0.6);
  box(ctx, cx - w * 0.13, shoulder, w * 0.26, hip - shoulder, o.shirt, P.outline, k * 0.6);
  // gambe
  for (const side of [-1, 1] as const) {
    box(ctx, cx + side * w * 0.11 - w * 0.06, hip, w * 0.12, h * 0.96 - hip, o.trousers, P.outline, k * 0.6);
  }
  // braccia
  if (o.pose === 'wave') {
    poly(
      ctx,
      [
        [cx + w * 0.12, shoulder + h * 0.02],
        [cx + w * 0.3, top - h * 0.02],
        [cx + w * 0.36, top + h * 0.04],
        [cx + w * 0.18, shoulder + h * 0.08],
      ],
      o.skin,
      P.outline,
      k * 0.5,
    );
    box(ctx, cx - w * 0.2, shoulder + h * 0.02, w * 0.08, (hip - shoulder) * 0.7, o.skin, P.outline, k * 0.5);
  } else {
    for (const side of [-1, 1] as const) {
      box(
        ctx,
        cx + side * w * 0.17 - w * 0.04,
        shoulder + h * 0.02,
        w * 0.08,
        (hip - shoulder) * 0.8,
        o.skin,
        P.outline,
        k * 0.5,
      );
    }
  }
}

/** Fotografo: in ginocchio con la macchina davanti al viso. */
function photographer(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  person(ctx, w, h, { shirt: P.teal, trousers: P.blueDark, skin: P.cream, pose: 'kneel' });
  box(ctx, w * 0.34, h * 0.26, w * 0.34, h * 0.14, '#2a2a30', P.outline, k * 0.6);
  ell(ctx, w * 0.57, h * 0.33, w * 0.08, h * 0.05, P.glass, P.outline, k * 0.5);
}

/** Ciclista: figura curva su un telaio con due ruote. */
function cyclist(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  for (const cx of [0.24, 0.78]) {
    ell(ctx, w * cx, h * 0.84, w * 0.2, h * 0.14, 'rgba(0,0,0,0)', P.tyre, k * 1.2);
  }
  ctx.strokeStyle = P.magenta === undefined ? P.red : P.pink;
  ctx.lineWidth = k;
  ctx.beginPath();
  ctx.moveTo(w * 0.24, h * 0.84);
  ctx.lineTo(w * 0.5, h * 0.58);
  ctx.lineTo(w * 0.78, h * 0.84);
  ctx.moveTo(w * 0.5, h * 0.58);
  ctx.lineTo(w * 0.62, h * 0.5);
  ctx.stroke();
  person(ctx, w, h * 0.82, { shirt: P.yellow, trousers: P.purple, skin: P.cream, pose: 'stand', cx: 0.48 });
  ell(ctx, w * 0.48, h * 0.1, w * 0.13, h * 0.07, P.red, P.outline, k * 0.6);
}

/** Surfista: figura che saluta con la tavola accanto. */
function surfer(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  ell(ctx, w * 0.78, h * 0.55, w * 0.12, h * 0.45, P.orange, P.outline, k * 0.7);
  ctx.fillStyle = P.cream;
  ctx.fillRect(w * 0.75, h * 0.16, w * 0.06, h * 0.78);
  person(ctx, w, h, { shirt: P.pink, trousers: P.teal, skin: P.cream, pose: 'wave', cx: 0.38 });
}

/** Coppia: due figure affiancate che salutano. */
function couple(ctx: Ctx2D, w: number, h: number): void {
  person(ctx, w * 0.56, h, { shirt: P.pink, trousers: P.white, skin: P.cream, pose: 'wave', cx: 0.5 });
  ctx.save();
  ctx.translate(w * 0.44, 0);
  person(ctx, w * 0.56, h, { shirt: P.blue, trousers: P.sand, skin: P.cream, pose: 'stand', cx: 0.5 });
  ctx.restore();
}

/** Cane di taglia media, di profilo, che guarda la strada. */
function dog(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  ell(ctx, w * 0.48, h * 0.52, w * 0.28, h * 0.22, P.ochre, P.outline, k * 0.7);
  ell(ctx, w * 0.78, h * 0.34, w * 0.14, h * 0.15, P.ochre, P.outline, k * 0.7);
  poly(
    ctx,
    [
      [w * 0.72, h * 0.22],
      [w * 0.68, h * 0.06],
      [w * 0.8, h * 0.2],
    ],
    P.ochreDark,
    P.outline,
    k * 0.5,
  );
  ell(ctx, w * 0.9, h * 0.38, w * 0.05, h * 0.05, '#2a2a30');
  for (const x of [0.3, 0.42, 0.6, 0.7]) {
    box(ctx, w * x, h * 0.68, w * 0.07, h * 0.3, P.ochreDark, P.outline, k * 0.5);
  }
  poly(
    ctx,
    [
      [w * 0.22, h * 0.46],
      [w * 0.06, h * 0.26],
      [w * 0.14, h * 0.5],
    ],
    P.ochreDark,
    P.outline,
    k * 0.5,
  );
}

/** Due pecore di profilo, una dietro l'altra. */
function sheep(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  for (const [cx, scale] of [
    [0.32, 1],
    [0.7, 0.86],
  ] as const) {
    const bw = w * 0.26 * scale;
    const bh = h * 0.28 * scale;
    ell(ctx, w * cx, h * 0.54, bw, bh, P.white, P.outline, k * 0.7);
    ell(ctx, w * (cx + 0.14 * scale), h * 0.44, bw * 0.4, bh * 0.5, '#3a3a42', P.outline, k * 0.6);
    for (const dx of [-0.08, 0.06]) {
      box(ctx, w * (cx + dx * scale), h * 0.74, w * 0.04, h * 0.24, '#3a3a42');
    }
  }
}

/** Barca a vela di profilo con la vela a righe. */
function sailboat(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  poly(
    ctx,
    [
      [w * 0.12, h * 0.76],
      [w * 0.88, h * 0.76],
      [w * 0.74, h * 0.92],
      [w * 0.24, h * 0.92],
    ],
    P.red,
    P.outline,
    k,
  );
  box(ctx, w * 0.48, h * 0.12, k, h * 0.64, P.metalDark);
  const sail: readonly (readonly [number, number])[] = [
    [w * 0.5, h * 0.12],
    [w * 0.5, h * 0.74],
    [w * 0.86, h * 0.74],
  ];
  poly(ctx, sail, P.white, P.outline, k * 0.8);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 === 0 ? P.teal : P.yellow;
    ctx.fillRect(w * 0.51, h * (0.22 + i * 0.16), w * (0.1 + i * 0.11), h * 0.07);
  }
  poly(
    ctx,
    [
      [w * 0.46, h * 0.16],
      [w * 0.46, h * 0.5],
      [w * 0.2, h * 0.5],
    ],
    P.cream,
    P.outline,
    k * 0.6,
  );
}

/** Gabbiano: `lift` da -1 (ali in basso) a 1 (ali in alto). */
function seagull(ctx: Ctx2D, w: number, h: number, lift: number): void {
  const k = lw(w, h);
  const cy = h * 0.5;
  ell(ctx, w * 0.5, cy, w * 0.17, h * 0.07, P.white, P.outline, k * 0.6);
  ell(ctx, w * 0.66, cy - h * 0.03, w * 0.08, h * 0.05, P.white, P.outline, k * 0.5);
  poly(
    ctx,
    [
      [w * 0.73, cy - h * 0.03],
      [w * 0.86, cy - h * 0.01],
      [w * 0.73, cy + h * 0.01],
    ],
    P.orange,
  );
  for (const side of [-1, 1] as const) {
    poly(
      ctx,
      [
        [w * 0.5, cy - h * 0.03],
        [w * (0.5 + side * 0.46), cy - lift * h * 0.3],
        [w * (0.5 + side * 0.3), cy + h * 0.05],
      ],
      P.white,
      P.outline,
      k * 0.6,
    );
    poly(
      ctx,
      [
        [w * (0.5 + side * 0.3), cy - lift * h * 0.17],
        [w * (0.5 + side * 0.46), cy - lift * h * 0.3],
        [w * (0.5 + side * 0.34), cy + h * 0.01],
      ],
      P.grey,
    );
  }
}

/** I dieci ripieghi della vita a bordo strada (spec §13). */
export const NPC_ART: Record<SpriteName, Drawer> = {
  npc_photographer: (c, w, h) => photographer(c, w, h),
  npc_cyclist: (c, w, h) => cyclist(c, w, h),
  npc_surfer: (c, w, h) => surfer(c, w, h),
  npc_couple: (c, w, h) => couple(c, w, h),
  npc_dog: (c, w, h) => dog(c, w, h),
  npc_sheep: (c, w, h) => sheep(c, w, h),
  npc_sailboat: (c, w, h) => sailboat(c, w, h),
  npc_seagull_0: (c, w, h) => seagull(c, w, h, 1),
  npc_seagull_1: (c, w, h) => seagull(c, w, h, 0),
  npc_seagull_2: (c, w, h) => seagull(c, w, h, -1),
};
