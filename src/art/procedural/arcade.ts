import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, box, ell, lw, poly, vgrad } from './palette';

/**
 * Cornice arcade (spec §11, §13): mappa illustrata, icone della radio,
 * tendine, telaio dei finali, cursore. Deterministici: nessun numero
 * casuale, così il disegno di ripiego è lo stesso a ogni avvio.
 */

/** Silhouette di palma: tronco curvo e cinque foglie, tutta di un colore. */
function palmSilhouette(ctx: Ctx2D, x: number, base: number, hgt: number, lean: number, fill: string): void {
  const top = base - hgt;
  poly(
    ctx,
    [
      [x - hgt * 0.04, base],
      [x + lean * hgt * 0.18 - hgt * 0.02, top],
      [x + lean * hgt * 0.18 + hgt * 0.02, top],
      [x + hgt * 0.04, base],
    ],
    fill,
  );
  const cx = x + lean * hgt * 0.18;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.85 + (i / 4) * Math.PI * 0.7;
    poly(
      ctx,
      [
        [cx, top],
        [cx + Math.cos(a) * hgt * 0.34, top + Math.sin(a) * hgt * 0.22],
        [cx + Math.cos(a) * hgt * 0.3, top + hgt * 0.06],
      ],
      fill,
    );
  }
}

/** Sole a righe: il disco con tre tagli orizzontali, marchio di fabbrica del genere. */
function stripedSun(ctx: Ctx2D, cx: number, cy: number, r: number, bg: string): void {
  ell(ctx, cx, cy, r, r, P.yellow);
  ell(ctx, cx, cy, r * 0.72, r * 0.72, P.orange);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = bg;
    ctx.fillRect(cx - r, cy + r * (0.18 + i * 0.26), r * 2, r * 0.1);
  }
}

/**
 * Mappa illustrata: cinque fasce di terreno dal basso verso l'alto e un
 * grafo di strade che si ramifica. Non è la mappa del percorso, che
 * `render/routeMap.ts` disegna sopra: è solo l'illustrazione di fondo.
 */
function mapFull(ctx: Ctx2D, w: number, h: number): void {
  const bands: readonly (readonly [number, string])[] = [
    [0.0, '#1b3a5c'],
    [0.18, '#3e6b3a'],
    [0.38, '#6b7a44'],
    [0.58, '#b08a4a'],
    [0.78, '#d9b878'],
  ];
  for (let i = 0; i < bands.length; i++) {
    const [top, color] = bands[i];
    const bottom = i + 1 < bands.length ? bands[i + 1][0] : 1;
    ctx.fillStyle = color;
    ctx.fillRect(0, h * top, w, h * (bottom - top) + 1);
  }
  // mare in alto a sinistra e onde
  ctx.fillStyle = '#16527d';
  ctx.fillRect(0, 0, w * 0.34, h * 0.28);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = '#5fb6e8';
    ctx.fillRect(w * (0.02 + (i % 3) * 0.1), h * (0.06 + Math.floor(i / 3) * 0.1), w * 0.06, h * 0.008);
  }
  // rilievi
  for (let i = 0; i < 7; i++) {
    const x = w * (0.1 + i * 0.12);
    poly(
      ctx,
      [
        [x - w * 0.05, h * 0.34],
        [x, h * 0.22],
        [x + w * 0.05, h * 0.34],
      ],
      i % 2 === 0 ? '#7d8496' : '#5c636a',
    );
  }
  // grafo delle strade: cinque righe, una diramazione per nodo
  ctx.strokeStyle = P.cream;
  ctx.lineWidth = Math.max(2, lw(w, h) * 0.5);
  const nodeAt = (level: number, index: number): [number, number] => [
    w * (0.5 + (index - level / 2) * 0.13),
    h * (0.9 - level * 0.17),
  ];
  for (let level = 0; level < 4; level++) {
    for (let index = 0; index <= level; index++) {
      const [x0, y0] = nodeAt(level, index);
      for (const next of [index, index + 1]) {
        const [x1, y1] = nodeAt(level + 1, next);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
  }
  for (let level = 0; level < 5; level++) {
    for (let index = 0; index <= level; index++) {
      const [x, y] = nodeAt(level, index);
      ell(ctx, x, y, w * 0.012, w * 0.012, level === 4 ? P.red : P.white, P.outline, 2);
    }
  }
  // palme sul bordo basso, per firmare lo stile
  for (const x of [0.06, 0.15, 0.86, 0.95]) palmSilhouette(ctx, w * x, h * 0.99, h * 0.14, 0.4, '#2c3a22');
}

/** Tre copertine quadrate in fila: spiaggia, deserto, montagna. */
function trackIcons(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const cell = w / 3;
  const pad = cell * 0.06;
  const skies: readonly (readonly [string, string, string])[] = [
    ['#f06595', '#ff8c42', '#2ec4b6'],
    ['#e8842a', '#f3c46b', '#a97822'],
    ['#0d3a7a', '#3f78c0', '#f1f3f5'],
  ];
  for (let i = 0; i < 3; i++) {
    const x = i * cell + pad;
    const y = pad;
    const cw = cell - pad * 2;
    const ch = h - pad * 2;
    const [top, mid, ground] = skies[i];
    ctx.fillStyle = vgrad(ctx, x, y, x, y + ch * 0.7, [
      [0, top],
      [1, mid],
    ]);
    ctx.fillRect(x, y, cw, ch * 0.7);
    ctx.fillStyle = ground;
    ctx.fillRect(x, y + ch * 0.7, cw, ch * 0.3);
    stripedSun(ctx, x + cw * 0.5, y + ch * 0.42, cw * 0.18, mid);
    if (i === 0) {
      palmSilhouette(ctx, x + cw * 0.18, y + ch, ch * 0.5, 0.4, '#1b1026');
      palmSilhouette(ctx, x + cw * 0.84, y + ch, ch * 0.4, -0.4, '#1b1026');
    } else if (i === 1) {
      poly(
        ctx,
        [
          [x + cw * 0.1, y + ch * 0.7],
          [x + cw * 0.3, y + ch * 0.44],
          [x + cw * 0.5, y + ch * 0.7],
        ],
        '#7f3d18',
      );
    } else {
      poly(
        ctx,
        [
          [x + cw * 0.18, y + ch * 0.72],
          [x + cw * 0.5, y + ch * 0.3],
          [x + cw * 0.82, y + ch * 0.72],
        ],
        '#f1f3f5',
      );
    }
    box(ctx, x, y, cw, ch, 'rgba(0,0,0,0)', P.outline, k);
  }
}

/** Freccia grossa verso destra, con contorno e riflesso. */
function arrow(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const pts: readonly (readonly [number, number])[] = [
    [w * 0.04, h * 0.32],
    [w * 0.58, h * 0.32],
    [w * 0.58, h * 0.1],
    [w * 0.96, h * 0.5],
    [w * 0.58, h * 0.9],
    [w * 0.58, h * 0.68],
    [w * 0.04, h * 0.68],
  ];
  poly(ctx, pts, P.orange, P.outline, k);
  ctx.fillStyle = P.glassLight;
  ctx.fillRect(w * 0.08, h * 0.36, w * 0.44, h * 0.06);
}

/** Striscia di tramonto: cielo, sole a righe, palme in controluce. */
function sunsetStrip(ctx: Ctx2D, w: number, h: number): void {
  ctx.fillStyle = vgrad(ctx, 0, 0, 0, h, [
    [0, '#2a1a4a'],
    [0.55, '#f06595'],
    [1, '#ff8c42'],
  ]);
  ctx.fillRect(0, 0, w, h);
  stripedSun(ctx, w * 0.5, h * 0.66, h * 0.42, '#f06595');
  ctx.fillStyle = '#1b1026';
  ctx.fillRect(0, h * 0.9, w, h * 0.1);
  for (const x of [0.08, 0.2, 0.33, 0.68, 0.82, 0.94]) {
    palmSilhouette(ctx, w * x, h * 0.92, h * 0.62, x < 0.5 ? 0.35 : -0.35, '#1b1026');
  }
}

/** Tendina: sagome di palme su fondo pieno, pensata per scorrere. */
function wipeStrip(ctx: Ctx2D, w: number, h: number): void {
  ctx.fillStyle = '#1b1026';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f06595';
  ctx.fillRect(0, 0, w, Math.max(2, h * 0.06));
  ctx.fillStyle = '#2ec4b6';
  ctx.fillRect(0, h - Math.max(2, h * 0.06), w, Math.max(2, h * 0.06));
  for (let i = 0; i < 9; i++) {
    palmSilhouette(ctx, w * (0.05 + i * 0.11), h * 0.98, h * 0.8, i % 2 === 0 ? 0.3 : -0.3, '#2a1a4a');
  }
}

/** Telaio dei finali: tre righe sottili annidate, centro trasparente. */
function endingBorder(ctx: Ctx2D, w: number, h: number): void {
  const k = Math.max(2, lw(w, h) * 0.5);
  const rings: readonly (readonly [number, string])[] = [
    [0, '#f06595'],
    [2.5, '#2ec4b6'],
    [5, '#ff8c42'],
  ];
  for (const [inset, color] of rings) {
    const d = k * inset;
    ctx.strokeStyle = color;
    ctx.lineWidth = k;
    ctx.beginPath();
    ctx.rect(d + k / 2, d + k / 2, w - 2 * d - k, h - 2 * d - k);
    ctx.stroke();
  }
  // angoli pieni, così il telaio legge anche su fondo chiaro
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    ctx.fillStyle = '#f06595';
    ctx.fillRect(x * (w - k * 10), y * (h - k * 3), k * 10, k * 3);
  }
}

/** Cursore triangolare bianco con doppio contorno rosso e ciano. */
function cursor(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const tri = (inset: number, fill: string): void => {
    poly(
      ctx,
      [
        [w * (0.14 + inset), h * (0.1 + inset * 1.4)],
        [w * (0.92 - inset * 0.6), h * 0.5],
        [w * (0.14 + inset), h * (0.9 - inset * 1.4)],
      ],
      fill,
    );
  };
  tri(0, P.red);
  tri(0.06, '#2ec4b6');
  tri(0.13, P.white);
  void k;
}

/** I sette ripieghi della cornice arcade (spec §11, §13). */
export const ARCADE_ART: Record<SpriteName, Drawer> = {
  map_full: (c, w, h) => mapFull(c, w, h),
  radio_track_icons: (c, w, h) => trackIcons(c, w, h),
  transition_arrow: (c, w, h) => arrow(c, w, h),
  transition_sunset: (c, w, h) => sunsetStrip(c, w, h),
  transition_wipe: (c, w, h) => wipeStrip(c, w, h),
  ending_border: (c, w, h) => endingBorder(c, w, h),
  menu_cursor: (c, w, h) => cursor(c, w, h),
};
