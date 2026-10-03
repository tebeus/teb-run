import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, box, ell, lw, poly } from './palette';

export type ProfileKind = 'wave' | 'mesa' | 'peaks' | 'skyline';

/**
 * Profilo del terreno in [-1, 1] per t in [0, 1]. È periodico su t quando
 * `period` è intero: così il bordo destro della striscia combacia col sinistro
 * e lo sfondo si ripete senza cucitura (spec §13, sfondi ciclici).
 */
export function profileAt(kind: ProfileKind, t: number, period: number, phase: number): number {
  const u = t * period + phase;
  if (kind === 'wave') {
    return 0.6 * Math.sin(u * Math.PI * 2) + 0.4 * Math.sin(u * Math.PI * 4 + 1.7);
  }
  if (kind === 'peaks') {
    const f = u - Math.floor(u);
    return 1 - Math.abs(f * 2 - 1) * 2;
  }
  if (kind === 'mesa') {
    const v = 0.55 * Math.sin(u * Math.PI * 2) + 0.35 * Math.sin(u * Math.PI * 6 + 0.9);
    return Math.round(v * 3) / 3;
  }
  const steps = [0.2, 0.9, 0.45, 0.7, 0.3, 1, 0.5, 0.25];
  const f = u - Math.floor(u);
  return steps[Math.min(steps.length - 1, Math.floor(f * steps.length))] * 2 - 1;
}

interface Layer {
  color: string;
  kind: ProfileKind;
  /** Quota media del profilo come frazione dell'altezza (0 in alto). */
  base: number;
  amp: number;
  period: number;
  phase: number;
}

type StudKind = 'palm' | 'cactus' | 'pine' | 'barn' | 'tower';

interface Studs {
  kind: StudKind;
  color: string;
  count: number;
  /** Altezza della sagoma come frazione dell'altezza della striscia. */
  size: number;
}

export interface StripOpts {
  layers: Layer[];
  /** Banda piatta in basso: mare, sabbia, grano. */
  floor?: { color: string; at: number };
  studs?: Studs;
}

const STEPS = 96;

function layerY(h: number, l: Layer, t: number): number {
  return h * (l.base - l.amp * profileAt(l.kind, t, l.period, l.phase));
}

function drawLayer(ctx: Ctx2D, w: number, h: number, l: Layer): void {
  const pts: [number, number][] = [];
  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;
    pts.push([t * w, layerY(h, l, t)]);
  }
  poly(ctx, [...pts, [w, h], [0, h]], l.color);
}

/** Sagomine sopra il terreno: palme, cactus, pini, fienili, torri. */
function stud(ctx: Ctx2D, kind: StudKind, x: number, ground: number, size: number, color: string): void {
  if (kind === 'palm') {
    box(ctx, x - size * 0.05, ground - size, size * 0.1, size, color);
    for (let i = 0; i < 5; i += 1) {
      const a = Math.PI + (Math.PI * (i + 0.5)) / 5;
      poly(
        ctx,
        [
          [x, ground - size],
          [x + Math.cos(a) * size * 0.45, ground - size + Math.sin(a) * size * 0.35],
          [x + Math.cos(a) * size * 0.3, ground - size + Math.sin(a) * size * 0.1],
        ],
        color,
      );
    }
    return;
  }
  if (kind === 'cactus') {
    box(ctx, x - size * 0.09, ground - size, size * 0.18, size, color);
    box(ctx, x - size * 0.34, ground - size * 0.7, size * 0.25, size * 0.12, color);
    box(ctx, x - size * 0.34, ground - size * 0.7, size * 0.12, size * 0.4, color);
    box(ctx, x + size * 0.09, ground - size * 0.55, size * 0.25, size * 0.12, color);
    box(ctx, x + size * 0.22, ground - size * 0.85, size * 0.12, size * 0.42, color);
    return;
  }
  if (kind === 'pine') {
    poly(
      ctx,
      [
        [x, ground - size],
        [x + size * 0.28, ground],
        [x - size * 0.28, ground],
      ],
      color,
    );
    return;
  }
  if (kind === 'barn') {
    box(ctx, x - size * 0.4, ground - size * 0.6, size * 0.8, size * 0.6, color);
    poly(
      ctx,
      [
        [x - size * 0.46, ground - size * 0.6],
        [x, ground - size],
        [x + size * 0.46, ground - size * 0.6],
      ],
      color,
    );
    return;
  }
  box(ctx, x - size * 0.16, ground - size * 0.8, size * 0.32, size * 0.8, color);
  ell(ctx, x, ground - size * 0.8, size * 0.22, size * 0.22, color);
  box(ctx, x - size * 0.03, ground - size, size * 0.06, size * 0.2, color);
}

export function hillStrip(ctx: Ctx2D, w: number, h: number, o: StripOpts): void {
  if (o.floor) box(ctx, 0, h * o.floor.at, w, h * (1 - o.floor.at) + 1, o.floor.color);
  for (const layer of o.layers) drawLayer(ctx, w, h, layer);
  if (o.studs) {
    const last = o.layers[o.layers.length - 1];
    for (let i = 0; i < o.studs.count; i += 1) {
      const t = (i + 0.5) / o.studs.count;
      const groundY = layerY(h, last, t) + h * 0.02;
      // La sagoma non sale mai nella fascia di cielo: il 10% in alto resta
      // vuoto. Il fattore 1.4 tiene conto delle fronde che sporgono sopra il
      // tronco nella sagoma della palma.
      const size = Math.min(h * o.studs.size, (groundY - h * 0.1) / 1.4);
      if (size <= 0) continue;
      stud(ctx, o.studs.kind, t * w, groundY, size, o.studs.color);
    }
  }
  // riga di contatto col terreno, per staccare la striscia dal cielo
  const k = lw(w, h);
  box(ctx, 0, h - k, w, k, o.layers[o.layers.length - 1].color);
}

export const BACKGROUNDS: Record<SpriteName, Drawer> = {
  bg_beach_far: (c, w, h) =>
    hillStrip(c, w, h, {
      floor: { color: '#2aa6c8', at: 0.62 },
      layers: [
        { color: '#4f7fa8', kind: 'wave', base: 0.55, amp: 0.16, period: 3, phase: 0.1 },
        { color: '#2f5f80', kind: 'wave', base: 0.66, amp: 0.08, period: 5, phase: 0.6 },
      ],
    }),
  bg_beach_near: (c, w, h) =>
    hillStrip(c, w, h, {
      layers: [
        { color: P.sand, kind: 'wave', base: 0.52, amp: 0.18, period: 4, phase: 0.2 },
        { color: P.sandDark, kind: 'wave', base: 0.72, amp: 0.1, period: 6, phase: 0.9 },
      ],
      studs: { kind: 'palm', color: '#1f3d2e', count: 9, size: 0.42 },
    }),
  bg_desert_far: (c, w, h) =>
    hillStrip(c, w, h, {
      layers: [
        { color: P.rockDark, kind: 'mesa', base: 0.5, amp: 0.3, period: 3, phase: 0.15 },
        { color: P.rock, kind: 'mesa', base: 0.68, amp: 0.18, period: 5, phase: 0.75 },
      ],
    }),
  bg_desert_near: (c, w, h) =>
    hillStrip(c, w, h, {
      layers: [
        { color: P.orange, kind: 'wave', base: 0.5, amp: 0.2, period: 4, phase: 0.4 },
        { color: P.orangeDark, kind: 'wave', base: 0.72, amp: 0.1, period: 7, phase: 0.1 },
      ],
      studs: { kind: 'cactus', color: '#1e4023', count: 11, size: 0.34 },
    }),
  bg_alpine_far: (c, w, h) =>
    hillStrip(c, w, h, {
      layers: [
        { color: '#8ea3c8', kind: 'peaks', base: 0.52, amp: 0.36, period: 4, phase: 0.1 },
        { color: '#5f7099', kind: 'peaks', base: 0.72, amp: 0.2, period: 7, phase: 0.55 },
      ],
    }),
  bg_alpine_near: (c, w, h) =>
    hillStrip(c, w, h, {
      layers: [
        { color: P.green, kind: 'wave', base: 0.52, amp: 0.2, period: 3, phase: 0.3 },
        { color: P.greenDark, kind: 'wave', base: 0.74, amp: 0.1, period: 6, phase: 0.8 },
      ],
      studs: { kind: 'pine', color: '#0c3d19', count: 13, size: 0.36 },
    }),
  bg_farm_far: (c, w, h) =>
    hillStrip(c, w, h, {
      layers: [
        { color: '#8fbf6a', kind: 'wave', base: 0.58, amp: 0.16, period: 2, phase: 0.2 },
        { color: P.green, kind: 'wave', base: 0.72, amp: 0.1, period: 4, phase: 0.7 },
      ],
    }),
  bg_farm_near: (c, w, h) =>
    hillStrip(c, w, h, {
      floor: { color: P.yellow, at: 0.74 },
      layers: [
        { color: '#d8b24a', kind: 'wave', base: 0.56, amp: 0.16, period: 3, phase: 0.5 },
        { color: P.yellowDark, kind: 'wave', base: 0.76, amp: 0.08, period: 5, phase: 0.2 },
      ],
      studs: { kind: 'barn', color: '#7a2b20', count: 5, size: 0.3 },
    }),
  bg_town_far: (c, w, h) =>
    hillStrip(c, w, h, {
      layers: [
        { color: '#b79a86', kind: 'skyline', base: 0.56, amp: 0.3, period: 5, phase: 0.1 },
        { color: '#8a6f5e', kind: 'skyline', base: 0.74, amp: 0.16, period: 8, phase: 0.42 },
      ],
    }),
  bg_town_near: (c, w, h) =>
    hillStrip(c, w, h, {
      layers: [
        { color: P.brick, kind: 'skyline', base: 0.6, amp: 0.22, period: 9, phase: 0.2 },
        { color: P.brickDark, kind: 'skyline', base: 0.78, amp: 0.12, period: 13, phase: 0.6 },
      ],
      studs: { kind: 'tower', color: '#1f4d3a', count: 8, size: 0.34 },
    }),
};
