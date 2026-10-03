/** Operazione registrata: coordinate, colore e alfa al momento della chiamata. */
export interface RecOp {
  type: string;
  args: number[];
  fill?: string;
  alpha?: number;
  /** Nome dell'immagine passata a drawImage, se l'immagine ne porta uno. */
  image?: string;
}

export interface Recorder {
  /** Da passare ai renderer, che chiedono un CanvasRenderingContext2D. */
  ctx: CanvasRenderingContext2D;
  ops: RecOp[];
  /** Solo i `drawImage`. */
  images(): RecOp[];
  /** Solo i riempimenti (`fillRect` e `fill`). */
  fills(): RecOp[];
}

/**
 * Contesto 2D finto che registra le operazioni di disegno. Non disegna
 * niente: serve a controllare **cosa** il renderer ha chiesto, con quali
 * coordinate, in quale ordine.
 */
export function createRecordCtx(): Recorder {
  const ops: RecOp[] = [];
  const state = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1 };
  // `save`/`restore` devono rimettere a posto lo stato come il canvas vero:
  // senza pila, un alfa alzato dentro un save resterebbe alzato per sempre e
  // ogni asserzione sull'alfa diventerebbe vuota.
  const stack: (typeof state)[] = [];
  const push = (type: string, args: number[], image?: string): void => {
    ops.push({ type, args, fill: state.fillStyle, alpha: state.globalAlpha, ...(image === undefined ? {} : { image }) });
  };
  const raw = {
    get fillStyle(): string {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = String(v);
    },
    get strokeStyle(): string {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = String(v);
    },
    get globalAlpha(): number {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
    },
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    save: () => {
      stack.push({ ...state });
      push('save', []);
    },
    restore: () => {
      const prev = stack.pop();
      if (prev !== undefined) Object.assign(state, prev);
      push('restore', []);
    },
    translate: (x: number, y: number) => push('translate', [x, y]),
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) =>
      push('transform', [a, b, c, d, e, f]),
    scale: (x: number, y: number) => push('scale', [x, y]),
    rotate: (a: number) => push('rotate', [a]),
    beginPath: () => push('beginPath', []),
    closePath: () => push('closePath', []),
    moveTo: (x: number, y: number) => push('moveTo', [x, y]),
    lineTo: (x: number, y: number) => push('lineTo', [x, y]),
    quadraticCurveTo: (a: number, b: number, c: number, d: number) => push('quadraticCurveTo', [a, b, c, d]),
    rect: (x: number, y: number, w: number, h: number) => push('rect', [x, y, w, h]),
    arc: (x: number, y: number, r: number) => push('arc', [x, y, r]),
    ellipse: (x: number, y: number, rx: number, ry: number) => push('ellipse', [x, y, rx, ry]),
    clip: () => push('clip', []),
    fill: () => push('fill', []),
    // Come `fakeCtx`: un `stroke` registra il colore della linea, non quello
    // del riempimento, altrimenti nessun test puo' distinguere due tratti.
    stroke: () => ops.push({ type: 'stroke', args: [], fill: state.strokeStyle, alpha: state.globalAlpha }),
    fillRect: (x: number, y: number, w: number, h: number) => push('fillRect', [x, y, w, h]),
    fillText: (_t: string, x: number, y: number) => push('fillText', [x, y]),
    // Il gradiente non e' un'operazione di disegno, quindi non entra in `ops`:
    // diventa il `fillStyle` del riempimento che lo usa, in forma leggibile
    // `gradient(colore0|colore1)`, cosi' un test puo' asserire i suoi stop.
    createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => {
      const stops: string[] = [];
      return {
        addColorStop: (_o: number, c: string) => {
          stops.push(c);
        },
        toString: () => `gradient(${x0},${y0},${x1},${y1}:${stops.join('|')})`,
      };
    },
    drawImage: (...a: unknown[]) => {
      const image = a[0] as { name?: string } | null;
      push('drawImage', a.slice(1).map(Number), image?.name);
    },
  };
  return {
    ctx: raw as unknown as CanvasRenderingContext2D,
    ops,
    images: () => ops.filter((op) => op.type === 'drawImage'),
    fills: () => ops.filter((op) => op.type === 'fillRect' || op.type === 'fill'),
  };
}
