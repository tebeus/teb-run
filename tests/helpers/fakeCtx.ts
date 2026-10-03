import type { Ctx2D } from '../../src/art/procedural/palette';

export interface Op {
  type: string;
  args: number[];
  fill?: string;
  /** Argomento di fillText/strokeText: serve a controllare cosa c'è scritto. */
  text?: string;
}

export interface FakeCtx extends Ctx2D {
  ops: Op[];
  paints: number;
}

/** Contesto 2D finto: registra le operazioni, non disegna niente. */
export function createFakeCtx(): FakeCtx {
  const ops: Op[] = [];
  const gradient = { addColorStop: () => undefined } as unknown as CanvasGradient;
  const ctx: FakeCtx = {
    ops,
    paints: 0,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: () => void ops.push({ type: 'save', args: [] }),
    restore: () => void ops.push({ type: 'restore', args: [] }),
    translate: (x, y) => void ops.push({ type: 'translate', args: [x, y] }),
    scale: (x, y) => void ops.push({ type: 'scale', args: [x, y] }),
    rotate: (a) => void ops.push({ type: 'rotate', args: [a] }),
    beginPath: () => void ops.push({ type: 'beginPath', args: [] }),
    closePath: () => void ops.push({ type: 'closePath', args: [] }),
    moveTo: (x, y) => void ops.push({ type: 'moveTo', args: [x, y] }),
    lineTo: (x, y) => void ops.push({ type: 'lineTo', args: [x, y] }),
    quadraticCurveTo: (cx, cy, x, y) => void ops.push({ type: 'quadraticCurveTo', args: [cx, cy, x, y] }),
    arc: (x, y, r, a0, a1) => void ops.push({ type: 'arc', args: [x, y, r, a0, a1] }),
    ellipse: (x, y, rx, ry, rot, a0, a1) =>
      void ops.push({ type: 'ellipse', args: [x, y, rx, ry, rot, a0, a1] }),
    rect: (x, y, w, h) => void ops.push({ type: 'rect', args: [x, y, w, h] }),
    fill: () => {
      ctx.paints += 1;
      ops.push({ type: 'fill', args: [], fill: String(ctx.fillStyle) });
    },
    stroke: () => {
      ctx.paints += 1;
      ops.push({ type: 'stroke', args: [], fill: String(ctx.strokeStyle) });
    },
    fillRect: (x, y, w, h) => {
      ctx.paints += 1;
      ops.push({ type: 'fillRect', args: [x, y, w, h], fill: String(ctx.fillStyle) });
    },
    fillText: (text, x, y) => {
      ctx.paints += 1;
      ops.push({ type: 'fillText', args: [x, y], fill: String(ctx.fillStyle), text });
    },
    strokeText: (text, x, y) => {
      ctx.paints += 1;
      ops.push({ type: 'strokeText', args: [x, y], fill: String(ctx.strokeStyle), text });
    },
    createLinearGradient: () => gradient,
  };
  return ctx;
}

export interface Bounds {
  ctx: FakeCtx;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** true se il disegnatore ha usato translate/rotate/scale: i limiti non valgono. */
  transformed: boolean;
}

/** Esegue un disegnatore sul fake e ricava i limiti delle coordinate usate. */
export function drawnBounds(draw: (ctx: Ctx2D, w: number, h: number) => void, w: number, h: number): Bounds {
  const ctx = createFakeCtx();
  draw(ctx, w, h);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let transformed = false;
  const seeX = (v: number) => {
    if (v < minX) minX = v;
    if (v > maxX) maxX = v;
  };
  const seeY = (v: number) => {
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  };
  for (const op of ctx.ops) {
    switch (op.type) {
      case 'translate':
      case 'rotate':
      case 'scale':
        transformed = true;
        break;
      case 'fillRect':
      case 'rect':
        seeX(op.args[0]);
        seeX(op.args[0] + op.args[2]);
        seeY(op.args[1]);
        seeY(op.args[1] + op.args[3]);
        break;
      case 'ellipse':
        seeX(op.args[0] - op.args[2]);
        seeX(op.args[0] + op.args[2]);
        seeY(op.args[1] - op.args[3]);
        seeY(op.args[1] + op.args[3]);
        break;
      case 'arc':
        seeX(op.args[0] - op.args[2]);
        seeX(op.args[0] + op.args[2]);
        seeY(op.args[1] - op.args[2]);
        seeY(op.args[1] + op.args[2]);
        break;
      case 'moveTo':
      case 'lineTo':
        seeX(op.args[0]);
        seeY(op.args[1]);
        break;
      case 'quadraticCurveTo':
        seeX(op.args[0]);
        seeX(op.args[2]);
        seeY(op.args[1]);
        seeY(op.args[3]);
        break;
      default:
        break;
    }
  }
  return { ctx, minX, minY, maxX, maxY, transformed };
}
