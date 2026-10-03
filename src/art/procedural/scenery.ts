import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, box, ell, lw, poly } from './palette';

// ---------------------------------------------------------------------------
// Helper parametrizzati: 36 oggetti condividono queste sette forme
// ---------------------------------------------------------------------------

/**
 * Nastro rastremato lungo una spezzata: tronchi, rami, bracci di cactus, pale.
 * Lo spessore è misurato perpendicolarmente alla direzione locale, così
 * funziona anche per segmenti obliqui e orizzontali.
 */
export function taperedCurve(
  ctx: Ctx2D,
  pts: readonly (readonly [number, number])[],
  w0: number,
  w1: number,
  fill: string,
  stroke: string,
  k: number,
): void {
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const last = Math.max(1, pts.length - 1);
  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(last, i + 1)];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const t = i / last;
    const half = (w0 + (w1 - w0) * t) / 2;
    left.push([pts[i][0] + dy * half, pts[i][1] - dx * half]);
    right.push([pts[i][0] - dy * half, pts[i][1] + dx * half]);
  }
  poly(ctx, [...left, ...right.reverse()], fill, stroke, k);
}

/** Foglia di palma: quadrilatero che parte dal centro corona verso l'angolo. */
export function frond(ctx: Ctx2D, x: number, y: number, len: number, angle: number, color: string, k: number): void {
  const tx = x + Math.cos(angle) * len;
  const ty = y + Math.sin(angle) * len;
  const nx = -Math.sin(angle) * len * 0.2;
  const ny = Math.cos(angle) * len * 0.2;
  poly(
    ctx,
    [
      [x, y],
      [x + (tx - x) * 0.45 + nx, y + (ty - y) * 0.45 + ny],
      [tx, ty],
      [x + (tx - x) * 0.45 - nx, y + (ty - y) * 0.45 - ny],
    ],
    color,
    P.outline,
    k * 0.6,
  );
}

/** Palma: tronco curvo (lean < 0 verso sinistra) e corona di fronde. */
export function palm(ctx: Ctx2D, w: number, h: number, o: { lean: number; fronds: number; coconuts: boolean }): void {
  const k = lw(w, h);
  const base = h * 0.98;
  const top = h * 0.3;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 6; i += 1) {
    const t = i / 6;
    pts.push([w / 2 + o.lean * w * t * t, base - (base - top) * t]);
  }
  taperedCurve(ctx, pts, w * 0.14, w * 0.07, P.wood, P.outline, k);
  const cx = pts[6][0];
  const cy = pts[6][1];
  const len = w * 0.34;
  for (let i = 0; i < o.fronds; i += 1) {
    const angle = Math.PI + (Math.PI * (i + 0.5)) / o.fronds;
    frond(ctx, cx, cy, len, angle, i % 2 === 0 ? P.green : P.greenDark, k);
  }
  if (o.coconuts) {
    ell(ctx, cx - w * 0.06, cy + h * 0.02, w * 0.04, w * 0.04, P.woodDark, P.outline, k * 0.6);
    ell(ctx, cx + w * 0.05, cy + h * 0.03, w * 0.04, w * 0.04, P.woodDark, P.outline, k * 0.6);
  }
}

/** Conifera: piani triangolari sovrapposti, con o senza neve. */
export function coneTree(
  ctx: Ctx2D,
  w: number,
  h: number,
  o: { tiers: number; green: string; dark: string; snow: boolean },
): void {
  const k = lw(w, h);
  const base = h * 0.96;
  taperedCurve(
    ctx,
    [
      [w / 2, base],
      [w / 2, base - h * 0.12],
    ],
    w * 0.16,
    w * 0.12,
    P.woodDark,
    P.outline,
    k,
  );
  const top = h * 0.06;
  const span = base - h * 0.1 - top;
  for (let i = 0; i < o.tiers; i += 1) {
    const t = i / o.tiers;
    const y0 = top + span * t;
    const y1 = y0 + span / o.tiers + h * 0.06;
    const half = w * (0.14 + 0.32 * t);
    poly(
      ctx,
      [
        [w / 2, y0],
        [w / 2 + half, y1],
        [w / 2 - half, y1],
      ],
      i % 2 === 0 ? o.green : o.dark,
      P.outline,
      k * 0.8,
    );
    if (o.snow) {
      poly(
        ctx,
        [
          [w / 2, y0 + h * 0.01],
          [w / 2 + half * 0.6, y1 - (y1 - y0) * 0.35],
          [w / 2 - half * 0.6, y1 - (y1 - y0) * 0.35],
        ],
        P.snow,
        P.outline,
        k * 0.5,
      );
    }
  }
}

/** Albero a chioma tonda: tre ellissi sovrapposte più il tronco. */
export function roundTree(
  ctx: Ctx2D,
  w: number,
  h: number,
  o: { crown: string; dark: string; spread: number; trunk: number },
): void {
  const k = lw(w, h);
  const base = h * 0.97;
  const crownY = h * 0.38;
  taperedCurve(
    ctx,
    [
      [w / 2, base],
      [w / 2 - w * 0.02, base - h * 0.3],
      [w / 2, crownY + h * 0.12],
    ],
    w * o.trunk,
    w * o.trunk * 0.55,
    P.wood,
    P.outline,
    k,
  );
  ell(ctx, w / 2, crownY, w * o.spread * 0.5, h * 0.24, o.dark, P.outline, k);
  ell(ctx, w / 2 - w * o.spread * 0.2, crownY - h * 0.04, w * o.spread * 0.3, h * 0.18, o.crown, P.outline, k * 0.8);
  ell(ctx, w / 2 + w * o.spread * 0.22, crownY - h * 0.02, w * o.spread * 0.28, h * 0.16, o.crown, P.outline, k * 0.8);
}

/** Masso o pinnacolo: `peak` da 0 (tondo) a 1 (guglia). */
export function rockPile(
  ctx: Ctx2D,
  w: number,
  h: number,
  o: { color: string; dark: string; peak: number; snow: boolean },
): void {
  const k = lw(w, h);
  const base = h * 0.97;
  const top = h * (0.5 - 0.45 * o.peak);
  poly(
    ctx,
    [
      [w * 0.04, base],
      [w * 0.16, base - (base - top) * 0.55],
      [w * (0.5 - 0.18 * (1 - o.peak)), top],
      [w * (0.5 + 0.16 * (1 - o.peak)), top + (base - top) * 0.08],
      [w * 0.88, base - (base - top) * 0.4],
      [w * 0.98, base],
    ],
    o.color,
    P.outline,
    k,
  );
  poly(
    ctx,
    [
      [w * 0.52, base],
      [w * 0.6, base - (base - top) * 0.5],
      [w * 0.82, base - (base - top) * 0.28],
      [w * 0.98, base],
    ],
    o.dark,
    P.outline,
    k * 0.8,
  );
  if (o.snow) {
    poly(
      ctx,
      [
        [w * (0.5 - 0.18 * (1 - o.peak)), top],
        [w * 0.62, top + (base - top) * 0.22],
        [w * 0.3, top + (base - top) * 0.26],
      ],
      P.snow,
      P.outline,
      k * 0.6,
    );
  }
}

/** Cespuglio o macchia: tre ellissi e, se chiesto, puntini di fiori. */
export function blob(
  ctx: Ctx2D,
  w: number,
  h: number,
  o: { color: string; dark: string; flower?: string; tall?: number },
): void {
  const k = lw(w, h);
  const base = h * 0.96;
  const top = h * (1 - (o.tall ?? 0.62));
  const cy = (base + top) / 2;
  ell(ctx, w / 2, cy + (base - cy) * 0.25, w * 0.48, (base - top) * 0.42, o.dark, P.outline, k);
  ell(ctx, w * 0.33, cy, w * 0.28, (base - top) * 0.34, o.color, P.outline, k * 0.8);
  ell(ctx, w * 0.66, cy - (base - top) * 0.06, w * 0.3, (base - top) * 0.36, o.color, P.outline, k * 0.8);
  if (o.flower) {
    for (let i = 0; i < 7; i += 1) {
      const fx = w * (0.16 + 0.12 * i);
      const fy = cy - (base - top) * (0.1 + 0.22 * ((i % 3) / 2));
      ell(ctx, fx, fy, w * 0.045, w * 0.045, o.flower, P.outline, k * 0.5);
    }
  }
}

/** Edificio: muro, tetto (a capanna, di paglia, piano, a tegole), finestre. */
export function building(
  ctx: Ctx2D,
  w: number,
  h: number,
  o: {
    wall: string;
    wallDark: string;
    roof: string;
    roofKind: 'gable' | 'thatch' | 'flat' | 'tile';
    floors: number;
    windows: number;
    door: boolean;
    glass?: string;
  },
): void {
  const k = lw(w, h);
  const base = h * 0.97;
  const wallTop = h * (o.roofKind === 'thatch' ? 0.45 : 0.3);
  const x0 = w * 0.1;
  const bw = w * 0.8;
  box(ctx, x0, wallTop, bw, base - wallTop, o.wall, P.outline, k);
  box(ctx, x0, base - (base - wallTop) * 0.16, bw, (base - wallTop) * 0.16, o.wallDark);
  if (o.roofKind === 'gable') {
    poly(
      ctx,
      [
        [x0 - w * 0.06, wallTop],
        [w / 2, h * 0.06],
        [x0 + bw + w * 0.06, wallTop],
      ],
      o.roof,
      P.outline,
      k,
    );
  } else if (o.roofKind === 'thatch') {
    poly(
      ctx,
      [
        [x0 - w * 0.1, wallTop + h * 0.03],
        [w * 0.28, h * 0.14],
        [w * 0.72, h * 0.14],
        [x0 + bw + w * 0.1, wallTop + h * 0.03],
      ],
      o.roof,
      P.outline,
      k,
    );
    for (let i = 0; i < 6; i += 1) {
      const fx = w * (0.14 + 0.144 * i);
      poly(
        ctx,
        [
          [fx, wallTop + h * 0.02],
          [fx + w * 0.05, wallTop + h * 0.02],
          [w / 2, h * 0.16],
        ],
        o.roof,
        P.outline,
        k * 0.4,
      );
    }
  } else if (o.roofKind === 'tile') {
    box(ctx, x0 - w * 0.05, wallTop - h * 0.06, bw + w * 0.1, h * 0.06, o.roof, P.outline, k);
  } else {
    box(ctx, x0 - w * 0.03, wallTop - h * 0.03, bw + w * 0.06, h * 0.03, o.roof, P.outline, k);
  }
  const rows = Math.max(1, o.floors);
  const cols = Math.max(1, o.windows);
  const cellH = (base - wallTop) / (rows + 0.6);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const wx = x0 + (bw * (c + 0.5)) / cols - bw * 0.1;
      const wy = wallTop + cellH * (r + 0.35);
      box(ctx, wx, wy, bw * 0.2, cellH * 0.5, o.glass ?? P.glass, P.outline, k * 0.7);
    }
  }
  if (o.door) {
    box(ctx, w / 2 - bw * 0.1, base - (base - wallTop) * 0.34, bw * 0.2, (base - wallTop) * 0.34, P.woodDark, P.outline, k * 0.7);
  }
}

/** Cartello: uno o due pali e un pannello. */
export function signBoard(
  ctx: Ctx2D,
  w: number,
  h: number,
  o: { panel: string; panelDark: string; posts: 1 | 2; panelTop: number; panelH: number },
): void {
  const k = lw(w, h);
  const base = h * 0.97;
  const postW = w * 0.07;
  if (o.posts === 2) {
    box(ctx, w * 0.2, h * o.panelTop, postW, base - h * o.panelTop, P.wood, P.outline, k);
    box(ctx, w * 0.73, h * o.panelTop, postW, base - h * o.panelTop, P.wood, P.outline, k);
  } else {
    box(ctx, w / 2 - postW / 2, h * o.panelTop, postW, base - h * o.panelTop, P.wood, P.outline, k);
  }
  const py = h * o.panelTop;
  const ph = h * o.panelH;
  box(ctx, w * 0.06, py, w * 0.88, ph, o.panel, P.outline, k);
  box(ctx, w * 0.06, py + ph - ph * 0.18, w * 0.88, ph * 0.18, o.panelDark);
}

/** Staccionata: pali verticali e traverse orizzontali. */
export function fenceRails(ctx: Ctx2D, w: number, h: number, o: { posts: number; rails: number }): void {
  const k = lw(w, h);
  const base = h * 0.96;
  const top = h * 0.24;
  for (let i = 0; i < o.rails; i += 1) {
    const y = top + ((base - top) * (i + 0.4)) / o.rails;
    box(ctx, w * 0.03, y, w * 0.94, h * 0.1, P.wood, P.outline, k * 0.8);
  }
  for (let i = 0; i < o.posts; i += 1) {
    const x = w * (0.08 + (0.84 * i) / Math.max(1, o.posts - 1)) - w * 0.04;
    box(ctx, x, top, w * 0.08, base - top, P.woodDark, P.outline, k * 0.8);
  }
}

// ---------------------------------------------------------------------------
// Oggetti bespoke di spiaggia e deserto
// ---------------------------------------------------------------------------

function umbrella(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.95;
  box(ctx, w * 0.46, h * 0.28, w * 0.05, base - h * 0.28, P.metalDark, P.outline, k * 0.7);
  for (let i = 0; i < 6; i += 1) {
    const x0 = w * (0.08 + 0.14 * i);
    poly(
      ctx,
      [
        [x0, h * 0.34],
        [x0 + w * 0.14, h * 0.34],
        [w * 0.48, h * 0.1],
      ],
      i % 2 === 0 ? P.red : P.white,
      P.outline,
      k * 0.6,
    );
  }
  poly(
    ctx,
    [
      [w * 0.12, base],
      [w * 0.2, h * 0.58],
      [w * 0.46, h * 0.62],
      [w * 0.42, base],
    ],
    P.cream,
    P.outline,
    k * 0.8,
  );
  box(ctx, w * 0.12, base - h * 0.06, w * 0.34, h * 0.05, P.wood, P.outline, k * 0.7);
}

function surfSign(ctx: Ctx2D, w: number, h: number): void {
  signBoard(ctx, w, h, { panel: P.cream, panelDark: P.sandDark, posts: 1, panelTop: 0.2, panelH: 0.3 });
  const k = lw(w, h);
  poly(
    ctx,
    [
      [w * 0.72, h * 0.95],
      [w * 0.66, h * 0.6],
      [w * 0.76, h * 0.26],
      [w * 0.88, h * 0.6],
      [w * 0.82, h * 0.95],
    ],
    P.teal,
    P.outline,
    k,
  );
  box(ctx, w * 0.74, h * 0.34, w * 0.05, h * 0.52, P.pink);
}

function cactusSaguaro(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  taperedCurve(
    ctx,
    [
      [w / 2, h * 0.98],
      [w / 2, h * 0.1],
    ],
    w * 0.3,
    w * 0.24,
    P.green,
    P.outline,
    k,
  );
  taperedCurve(
    ctx,
    [
      [w * 0.42, h * 0.62],
      [w * 0.2, h * 0.6],
      [w * 0.16, h * 0.42],
    ],
    w * 0.16,
    w * 0.13,
    P.green,
    P.outline,
    k,
  );
  taperedCurve(
    ctx,
    [
      [w * 0.58, h * 0.52],
      [w * 0.82, h * 0.5],
      [w * 0.86, h * 0.3],
    ],
    w * 0.16,
    w * 0.13,
    P.green,
    P.outline,
    k,
  );
  box(ctx, w * 0.54, h * 0.12, w * 0.04, h * 0.8, P.greenDark);
}

function barrelCacti(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.94;
  const spots: [number, number, number][] = [
    [0.22, 0.48, 0.2],
    [0.52, 0.66, 0.26],
    [0.8, 0.44, 0.18],
  ];
  for (const [cx, hh, rr] of spots) {
    ell(ctx, w * cx, base - h * hh * 0.4, w * rr, h * hh * 0.42, P.green, P.outline, k);
    for (let i = -1; i <= 1; i += 1) {
      box(ctx, w * cx + w * rr * 0.5 * i, base - h * hh * 0.78, k, h * hh * 0.72, P.greenDark);
    }
    ell(ctx, w * cx, base - h * hh * 0.8, w * rr * 0.3, h * 0.05, P.orange, P.outline, k * 0.5);
  }
}

function deadTree(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  taperedCurve(
    ctx,
    [
      [w / 2, h * 0.98],
      [w * 0.52, h * 0.6],
      [w * 0.48, h * 0.3],
    ],
    w * 0.18,
    w * 0.06,
    P.woodDark,
    P.outline,
    k,
  );
  const branches: [number, number, number, number][] = [
    [0.5, 0.6, 0.16, 0.38],
    [0.5, 0.52, 0.84, 0.3],
    [0.49, 0.38, 0.24, 0.16],
    [0.49, 0.34, 0.78, 0.12],
  ];
  for (const [x0, y0, x1, y1] of branches) {
    taperedCurve(
      ctx,
      [
        [w * x0, h * y0],
        [w * (x0 + x1) * 0.5, h * (y0 + y1) * 0.5],
        [w * x1, h * y1],
      ],
      w * 0.07,
      w * 0.02,
      P.woodDark,
      P.outline,
      k * 0.7,
    );
  }
}

function skullSign(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.44, h * 0.16, w * 0.12, h * 0.82, P.wood, P.outline, k);
  box(ctx, w * 0.1, h * 0.24, w * 0.8, h * 0.08, P.wood, P.outline, k);
  ell(ctx, w / 2, h * 0.52, w * 0.24, h * 0.16, P.cream, P.outline, k);
  ell(ctx, w * 0.42, h * 0.5, w * 0.06, h * 0.05, P.outline);
  ell(ctx, w * 0.58, h * 0.5, w * 0.06, h * 0.05, P.outline);
  taperedCurve(
    ctx,
    [
      [w * 0.26, h * 0.46],
      [w * 0.14, h * 0.36],
    ],
    w * 0.08,
    w * 0.05,
    P.cream,
    P.outline,
    k * 0.7,
  );
  taperedCurve(
    ctx,
    [
      [w * 0.74, h * 0.46],
      [w * 0.86, h * 0.36],
    ],
    w * 0.08,
    w * 0.05,
    P.cream,
    P.outline,
    k * 0.7,
  );
}

function cow(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.94;
  ell(ctx, w * 0.5, base - h * 0.26, w * 0.3, h * 0.17, P.white, P.outline, k);
  ell(ctx, w * 0.6, base - h * 0.3, w * 0.16, h * 0.1, '#8b4a2b', P.outline, k * 0.6);
  for (const lx of [0.3, 0.42, 0.62, 0.72]) {
    box(ctx, w * lx, base - h * 0.16, w * 0.06, h * 0.16, P.white, P.outline, k * 0.6);
  }
  ell(ctx, w * 0.22, base - h * 0.28, w * 0.11, h * 0.1, '#8b4a2b', P.outline, k * 0.8);
  ell(ctx, w * 0.15, base - h * 0.24, w * 0.05, h * 0.04, P.pink, P.outline, k * 0.5);
  poly(
    ctx,
    [
      [w * 0.2, base - h * 0.36],
      [w * 0.14, base - h * 0.44],
      [w * 0.24, base - h * 0.38],
    ],
    P.cream,
    P.outline,
    k * 0.5,
  );
}

function hayBale(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const cy = h * 0.6;
  ell(ctx, w / 2, cy, w * 0.44, h * 0.34, P.yellow, P.outline, k);
  for (let i = 1; i < 4; i += 1) {
    ell(ctx, w / 2, cy, w * 0.44 * (1 - i * 0.22), h * 0.34 * (1 - i * 0.22), P.yellow, P.yellowDark, k * 0.6);
  }
  box(ctx, w * 0.06, h * 0.92, w * 0.88, h * 0.05, P.sandDark);
}

function windmill(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.97;
  poly(
    ctx,
    [
      [w * 0.24, base],
      [w * 0.36, h * 0.28],
      [w * 0.64, h * 0.28],
      [w * 0.76, base],
    ],
    P.brick,
    P.outline,
    k,
  );
  box(ctx, w * 0.42, base - h * 0.2, w * 0.16, h * 0.2, P.woodDark, P.outline, k * 0.7);
  poly(
    ctx,
    [
      [w * 0.32, h * 0.28],
      [w / 2, h * 0.16],
      [w * 0.68, h * 0.28],
    ],
    P.woodDark,
    P.outline,
    k,
  );
  const cx = w / 2;
  const cy = h * 0.24;
  const r = Math.min(w * 0.42, h * 0.17);
  for (let i = 0; i < 4; i += 1) {
    const a = (Math.PI / 2) * i + 0.4;
    taperedCurve(
      ctx,
      [
        [cx, cy],
        [cx + Math.cos(a) * r, cy + Math.sin(a) * r],
      ],
      w * 0.09,
      w * 0.05,
      P.cream,
      P.outline,
      k * 0.7,
    );
  }
  ell(ctx, cx, cy, w * 0.05, w * 0.05, P.woodDark, P.outline, k * 0.7);
}

function vineRow(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.94;
  box(ctx, w * 0.04, h * 0.3, w * 0.92, h * 0.07, P.wood, P.outline, k * 0.8);
  for (let i = 0; i < 4; i += 1) {
    const x = w * (0.08 + 0.26 * i);
    box(ctx, x, h * 0.3, w * 0.05, base - h * 0.3, P.woodDark, P.outline, k * 0.7);
    for (let j = 0; j < 3; j += 1) {
      ell(ctx, x + w * 0.025, h * (0.44 + 0.13 * j), w * 0.05, h * 0.07, P.purple, P.outline, k * 0.5);
    }
    ell(ctx, x + w * 0.025, h * 0.4, w * 0.09, h * 0.06, P.green, P.outline, k * 0.5);
  }
  box(ctx, 0, base, w, h * 0.05, P.greenDark);
}

function sunflowers(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.96;
  const heads: [number, number][] = [
    [0.24, 0.3],
    [0.52, 0.16],
    [0.78, 0.34],
  ];
  for (const [x, y] of heads) {
    taperedCurve(
      ctx,
      [
        [w * x, base],
        [w * x, h * (y + 0.08)],
      ],
      w * 0.06,
      w * 0.04,
      P.green,
      P.outline,
      k * 0.7,
    );
    ell(ctx, w * x - w * 0.1, h * (y + 0.24), w * 0.1, h * 0.06, P.greenDark, P.outline, k * 0.5);
    ell(ctx, w * x + w * 0.1, h * (y + 0.32), w * 0.1, h * 0.06, P.greenDark, P.outline, k * 0.5);
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8;
      ell(
        ctx,
        w * x + Math.cos(a) * w * 0.1,
        h * y + Math.sin(a) * w * 0.1,
        w * 0.06,
        w * 0.04,
        P.yellow,
        P.outline,
        k * 0.5,
      );
    }
    ell(ctx, w * x, h * y, w * 0.07, w * 0.07, P.woodDark, P.outline, k * 0.6);
  }
}

function stoneArch(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.97;
  box(ctx, w * 0.08, h * 0.12, w * 0.84, base - h * 0.12, P.stone, P.outline, k);
  ctx.fillStyle = P.stoneDark;
  ctx.beginPath();
  ctx.moveTo(w * 0.3, base);
  ctx.lineTo(w * 0.3, h * 0.46);
  ctx.quadraticCurveTo(w * 0.5, h * 0.2, w * 0.7, h * 0.46);
  ctx.lineTo(w * 0.7, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = P.outline;
  ctx.lineWidth = k;
  ctx.stroke();
  box(ctx, w * 0.04, h * 0.06, w * 0.92, h * 0.08, P.stone, P.outline, k);
  for (let i = 0; i < 5; i += 1) {
    box(ctx, w * 0.1, h * (0.2 + 0.14 * i), w * 0.18, k, P.stoneDark);
    box(ctx, w * 0.72, h * (0.2 + 0.14 * i), w * 0.18, k, P.stoneDark);
  }
}

function brokenColumn(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.12, h * 0.9, w * 0.76, h * 0.08, P.stoneDark, P.outline, k);
  taperedCurve(
    ctx,
    [
      [w / 2, h * 0.9],
      [w / 2, h * 0.16],
    ],
    w * 0.6,
    w * 0.5,
    P.stone,
    P.outline,
    k,
  );
  for (let i = -2; i <= 2; i += 1) {
    box(ctx, w / 2 + w * 0.1 * i - k / 2, h * 0.18, k, h * 0.7, P.stoneDark);
  }
  poly(
    ctx,
    [
      [w * 0.24, h * 0.18],
      [w * 0.46, h * 0.1],
      [w * 0.62, h * 0.16],
      [w * 0.76, h * 0.12],
      [w * 0.76, h * 0.2],
      [w * 0.24, h * 0.24],
    ],
    P.stoneDark,
    P.outline,
    k,
  );
}

function ironLamp(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.97;
  ell(ctx, w / 2, base, w * 0.34, h * 0.03, '#1f4d3a', P.outline, k);
  taperedCurve(
    ctx,
    [
      [w / 2, base],
      [w / 2, h * 0.2],
    ],
    w * 0.16,
    w * 0.1,
    '#1f4d3a',
    P.outline,
    k,
  );
  box(ctx, w * 0.1, h * 0.2, w * 0.8, h * 0.04, '#1f4d3a', P.outline, k * 0.7);
  for (const x of [0.16, 0.84]) {
    poly(
      ctx,
      [
        [w * x - w * 0.1, h * 0.26],
        [w * x + w * 0.1, h * 0.26],
        [w * x + w * 0.06, h * 0.4],
        [w * x - w * 0.06, h * 0.4],
      ],
      P.cream,
      P.outline,
      k * 0.7,
    );
    poly(
      ctx,
      [
        [w * x - w * 0.12, h * 0.26],
        [w * x, h * 0.18],
        [w * x + w * 0.12, h * 0.26],
      ],
      '#1f4d3a',
      P.outline,
      k * 0.7,
    );
  }
}

function fountain(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  ell(ctx, w / 2, h * 0.86, w * 0.46, h * 0.1, P.stone, P.outline, k);
  ell(ctx, w / 2, h * 0.84, w * 0.38, h * 0.07, P.glassLight, P.outline, k * 0.7);
  box(ctx, w * 0.44, h * 0.5, w * 0.12, h * 0.36, P.stone, P.outline, k);
  ell(ctx, w / 2, h * 0.5, w * 0.26, h * 0.07, P.stone, P.outline, k);
  ell(ctx, w / 2, h * 0.48, w * 0.2, h * 0.05, P.glassLight, P.outline, k * 0.6);
  box(ctx, w * 0.46, h * 0.3, w * 0.08, h * 0.2, P.stone, P.outline, k * 0.8);
  ell(ctx, w / 2, h * 0.28, w * 0.12, h * 0.05, P.stoneDark, P.outline, k * 0.7);
  for (const dx of [-1, 1]) {
    poly(
      ctx,
      [
        [w / 2 + dx * w * 0.08, h * 0.3],
        [w / 2 + dx * w * 0.3, h * 0.44],
        [w / 2 + dx * w * 0.24, h * 0.46],
        [w / 2 + dx * w * 0.06, h * 0.34],
      ],
      P.glassLight,
      undefined,
      0,
    );
  }
}

function barrier(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const base = h * 0.94;
  box(ctx, w * 0.06, h * 0.86, w * 0.88, h * 0.1, P.greyDark, P.outline, k);
  box(ctx, w * 0.08, h * 0.24, w * 0.84, h * 0.5, P.white, P.outline, k);
  for (let i = 0; i < 4; i += 1) {
    poly(
      ctx,
      [
        [w * (0.08 + 0.21 * i), h * 0.74],
        [w * (0.08 + 0.21 * i + 0.1), h * 0.24],
        [w * (0.08 + 0.21 * i + 0.21), h * 0.24],
        [w * (0.08 + 0.21 * i + 0.11), h * 0.74],
      ],
      P.red,
      undefined,
      0,
    );
  }
  box(ctx, w * 0.08, h * 0.24, w * 0.84, h * 0.5, 'rgba(0,0,0,0)', P.outline, k);
  box(ctx, w * 0.44, h * 0.74, w * 0.12, base - h * 0.74, P.greyDark, P.outline, k * 0.8);
}

function gantry(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const legW = w * 0.05;
  box(ctx, w * 0.04, h * 0.2, legW, h * 0.78, P.metalDark, P.outline, k);
  box(ctx, w * 0.91, h * 0.2, legW, h * 0.78, P.metalDark, P.outline, k);
  box(ctx, w * 0.02, h * 0.08, w * 0.96, h * 0.16, P.blueDark, P.outline, k);
  box(ctx, w * 0.02, h * 0.24, w * 0.96, h * 0.03, P.metal);
  for (const [cx, dir] of [
    [0.26, -1],
    [0.74, 1],
  ] as const) {
    poly(
      ctx,
      [
        [w * cx + dir * w * 0.09, h * 0.16],
        [w * cx - dir * w * 0.02, h * 0.1],
        [w * cx - dir * w * 0.02, h * 0.13],
        [w * cx - dir * w * 0.08, h * 0.13],
        [w * cx - dir * w * 0.08, h * 0.19],
        [w * cx - dir * w * 0.02, h * 0.19],
        [w * cx - dir * w * 0.02, h * 0.22],
      ],
      P.yellow,
      P.outline,
      k * 0.8,
    );
  }
}

export const SCENERY: Record<SpriteName, Drawer> = {
  // Spiaggia
  beach_palm_1: (c, w, h) => palm(c, w, h, { lean: -0.12, fronds: 7, coconuts: true }),
  beach_palm_2: (c, w, h) => palm(c, w, h, { lean: 0.12, fronds: 9, coconuts: true }),
  beach_umbrella: (c, w, h) => umbrella(c, w, h),
  beach_hut: (c, w, h) =>
    building(c, w, h, {
      wall: P.wood,
      wallDark: P.woodDark,
      roof: P.sand,
      roofKind: 'thatch',
      floors: 1,
      windows: 2,
      door: true,
    }),
  beach_surf_sign: (c, w, h) => surfSign(c, w, h),
  beach_bush: (c, w, h) => blob(c, w, h, { color: P.green, dark: P.greenDark, flower: P.pink, tall: 0.7 }),

  // Deserto
  desert_cactus_1: (c, w, h) => cactusSaguaro(c, w, h),
  desert_cactus_2: (c, w, h) => barrelCacti(c, w, h),
  desert_rock_1: (c, w, h) => rockPile(c, w, h, { color: P.rock, dark: P.rockDark, peak: 0, snow: false }),
  desert_rock_2: (c, w, h) => rockPile(c, w, h, { color: P.rock, dark: P.rockDark, peak: 0.9, snow: false }),
  desert_dead_tree: (c, w, h) => deadTree(c, w, h),
  desert_skull_sign: (c, w, h) => skullSign(c, w, h),

  // Montagna
  alpine_pine_1: (c, w, h) => coneTree(c, w, h, { tiers: 4, green: P.green, dark: P.greenDark, snow: false }),
  alpine_pine_2: (c, w, h) => coneTree(c, w, h, { tiers: 4, green: P.green, dark: P.greenDark, snow: true }),
  alpine_chalet: (c, w, h) =>
    building(c, w, h, {
      wall: P.wood,
      wallDark: P.woodDark,
      roof: P.brickDark,
      roofKind: 'gable',
      floors: 2,
      windows: 3,
      door: true,
      glass: P.cream,
    }),
  alpine_fence: (c, w, h) => fenceRails(c, w, h, { posts: 3, rails: 2 }),
  alpine_rock: (c, w, h) => rockPile(c, w, h, { color: P.grey, dark: P.greyDark, peak: 0.15, snow: true }),
  alpine_cow: (c, w, h) => cow(c, w, h),

  // Campagna
  farm_haybale: (c, w, h) => hayBale(c, w, h),
  farm_windmill: (c, w, h) => windmill(c, w, h),
  farm_barn: (c, w, h) =>
    building(c, w, h, {
      wall: P.brick,
      wallDark: P.brickDark,
      roof: P.greyDark,
      roofKind: 'gable',
      floors: 1,
      windows: 2,
      door: true,
      glass: P.cream,
    }),
  farm_vine_row: (c, w, h) => vineRow(c, w, h),
  farm_oak: (c, w, h) => roundTree(c, w, h, { crown: P.greenLight, dark: P.green, spread: 0.9, trunk: 0.16 }),
  farm_sunflowers: (c, w, h) => sunflowers(c, w, h),

  // Città
  town_arch: (c, w, h) => stoneArch(c, w, h),
  town_column: (c, w, h) => brokenColumn(c, w, h),
  town_lamp: (c, w, h) => ironLamp(c, w, h),
  town_facade: (c, w, h) =>
    building(c, w, h, {
      wall: P.ochre,
      wallDark: P.ochreDark,
      roof: P.brick,
      roofKind: 'tile',
      floors: 3,
      windows: 3,
      door: true,
      glass: '#2f6f5e',
    }),
  town_fountain: (c, w, h) => fountain(c, w, h),
  town_cypress: (c, w, h) => coneTree(c, w, h, { tiers: 5, green: P.greenDark, dark: '#0c3d19', snow: false }),

  // Comuni
  common_billboard: (c, w, h) =>
    signBoard(c, w, h, { panel: P.white, panelDark: P.grey, posts: 2, panelTop: 0.08, panelH: 0.52 }),
  common_bush_1: (c, w, h) => blob(c, w, h, { color: P.green, dark: P.greenDark, tall: 0.62 }),
  common_bush_2: (c, w, h) => blob(c, w, h, { color: P.green, dark: P.greenDark, flower: P.yellow, tall: 0.62 }),
  common_boulder: (c, w, h) => rockPile(c, w, h, { color: P.grey, dark: P.greyDark, peak: 0, snow: false }),
  common_barrier: (c, w, h) => barrier(c, w, h),
  common_gantry: (c, w, h) => gantry(c, w, h),
};
