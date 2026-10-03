import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, box, ell, lw, poly, vgrad } from './palette';

/**
 * Scala di catalogo dei portali, in frazioni della **larghezza strada**
 * (spec §4.4e). Non passano per `WIDE_ROAD_FACTOR`: `1` è esattamente la
 * strada, `1.35` la strada più le due banchine, `1.7` il checkpoint in
 * fondo alla zona di bivio, uno per ramo della Y (bivio v3): gambe oltre il
 * cordolo della strada del giocatore (`CHECKPOINT_LEGS` in `catalog.ts`).
 */
export const PORTAL_SCALE_ROAD = 1.35;
export const PORTAL_SCALE_FORK = 1.7;

/** Fascia a scacchi orizzontale: `cells` celle alternate. */
function checkerBand(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cells: number,
  a: string,
  b: string,
): void {
  const step = w / cells;
  for (let i = 0; i < cells; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.fillRect(x + i * step, y, step + 1, h);
  }
}

/** Traliccio a X fra due quote: la struttura reticolare dei portali. */
function lattice(ctx: Ctx2D, x: number, y: number, w: number, h: number, bays: number, k: number): void {
  const step = w / bays;
  ctx.strokeStyle = P.metalDark;
  ctx.lineWidth = Math.max(1, k * 0.5);
  for (let i = 0; i < bays; i++) {
    const x0 = x + i * step;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + step, y + h);
    ctx.moveTo(x0 + step, y);
    ctx.lineTo(x0, y + h);
    ctx.stroke();
  }
}

/**
 * Corpo comune dei tre portali: due piloni ai lati, una trave orizzontale
 * reticolare, pannelli rosso-bianchi alla base dei piloni. `crown`
 * disegna ciò che sta sopra la trave e cambia da portale a portale.
 */
function gantry(ctx: Ctx2D, w: number, h: number, crown: (top: number, beamH: number) => void): void {
  const k = lw(w, h);
  const legW = w * 0.055;
  const beamY = h * 0.2;
  const beamH = h * 0.2;
  // piloni
  for (const x of [w * 0.06, w * 0.94 - legW]) {
    box(ctx, x, beamY, legW, h - beamY, P.metal, P.outline, k);
    box(ctx, x + legW * 0.55, beamY, legW * 0.45, h - beamY, P.metalDark);
    // pannelli di sicurezza rosso-bianchi, in basso
    checkerBand(ctx, x - legW * 0.25, h * 0.72, legW * 1.5, h * 0.2, 4, P.red, P.white);
    box(ctx, x - legW * 0.25, h * 0.72, legW * 1.5, h * 0.2, 'rgba(0,0,0,0)', P.outline, k * 0.7);
    box(ctx, x - legW * 0.5, h - k * 2, legW * 2, k * 2, P.greyDark);
  }
  // trave
  box(ctx, w * 0.06, beamY, w * 0.88, beamH, P.metal, P.outline, k);
  lattice(ctx, w * 0.08, beamY + k, w * 0.84, beamH - 2 * k, 14, k);
  crown(beamY, beamH);
}

/** Portale di partenza: lampade spente sotto la trave e due bandierine. */
function startGantry(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  gantry(ctx, w, h, (beamY, beamH) => {
    // cinque lampade spente appese sotto la trave
    for (let i = 0; i < 5; i++) {
      const cx = w * (0.32 + i * 0.09);
      ell(ctx, cx, beamY + beamH + h * 0.05, w * 0.016, h * 0.035, P.greyDark, P.outline, k * 0.6);
    }
    // bandierine sopra la trave
    for (const x of [w * 0.14, w * 0.86]) {
      box(ctx, x - k * 0.5, beamY - h * 0.14, k, h * 0.14, P.metalDark);
      poly(
        ctx,
        [
          [x, beamY - h * 0.14],
          [x + w * 0.05, beamY - h * 0.11],
          [x, beamY - h * 0.08],
        ],
        P.yellow,
        P.outline,
        k * 0.5,
      );
    }
  });
}

/** Portale di checkpoint: pannello centrale vuoto, il gioco ci scrive sopra. */
function checkpointGantry(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  gantry(ctx, w, h, (beamY, beamH) => {
    const panelW = w * 0.3;
    const panelH = beamH * 1.5;
    box(ctx, w * 0.5 - panelW / 2, beamY - panelH * 0.35, panelW, panelH, P.blueDark, P.outline, k);
    box(ctx, w * 0.5 - panelW / 2 + k * 2, beamY - panelH * 0.35 + k * 2, panelW - k * 4, panelH - k * 4, P.glass);
  });
}

/** Portale del traguardo: fascia a scacchi bianca e nera sopra la trave. */
function goalGantry(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  gantry(ctx, w, h, (beamY) => {
    const bandH = h * 0.12;
    checkerBand(ctx, w * 0.06, beamY - bandH, w * 0.88, bandH, 22, '#141414', P.white);
    box(ctx, w * 0.06, beamY - bandH, w * 0.88, bandH, 'rgba(0,0,0,0)', P.outline, k * 0.8);
  });
}

/** Semaforo di partenza: scatola nera con cinque lampade spente. */
function startLights(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, 0, 0, w, h, '#1a1a20', P.outline, k);
  box(ctx, k, k, w - 2 * k, h * 0.16, '#2c2c34');
  const r = h * 0.28;
  for (let i = 0; i < 5; i++) {
    const cx = w * (0.14 + i * 0.18);
    ell(ctx, cx, h * 0.55, r * 0.9, r, '#3a2020', P.outline, k * 0.8);
    ell(ctx, cx - r * 0.25, h * 0.42, r * 0.3, r * 0.28, 'rgba(255,255,255,0.18)');
  }
}

/** Bandiera a scacchi su asta corta: `tone` è il colore che alterna al bianco. */
function flag(ctx: Ctx2D, w: number, h: number, tone: string, dir: -1 | 1): void {
  const k = lw(w, h);
  const poleX = dir === 1 ? w * 0.12 : w * 0.88;
  box(ctx, poleX - k, h * 0.1, k * 2, h * 0.9, P.metalDark, P.outline, k * 0.5);
  const cloth = w * 0.7;
  const x0 = dir === 1 ? poleX : poleX - cloth;
  const cells = 4;
  const cw = cloth / cells;
  const ch = (h * 0.42) / cells;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      // bordo inferiore mosso dal vento: ogni colonna scende un po' di più
      const sag = Math.sin(((c + 1) / cells) * Math.PI) * h * 0.06 * dir;
      ctx.fillStyle = (r + c) % 2 === 0 ? tone : P.white;
      ctx.fillRect(x0 + c * cw, h * 0.14 + r * ch + sag, cw + 1, ch + 1);
    }
  }
  box(ctx, x0, h * 0.14, cloth, h * 0.42, 'rgba(0,0,0,0)', P.outline, k * 0.6);
}

/** Due bandiere a scacchi incrociate: il traguardo. */
function crossedFlags(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  for (const dir of [-1, 1] as const) {
    ctx.save();
    ctx.translate(w / 2, h);
    ctx.rotate(dir * 0.42);
    box(ctx, -k, -h * 0.98, k * 2, h * 0.98, P.metalDark, P.outline, k * 0.5);
    const cw = w * 0.16;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#141414' : P.white;
        ctx.fillRect(dir === 1 ? c * cw : -(c + 1) * cw, -h * 0.94 + r * cw, cw + 1, cw + 1);
      }
    }
    ctx.restore();
  }
}

/** Striscione del traguardo: telaio a scacchi, centro trasparente. */
function finishBanner(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  const band = h * 0.2;
  checkerBand(ctx, 0, 0, w, band, 26, '#141414', P.white);
  checkerBand(ctx, 0, h - band, w, band, 26, P.white, '#141414');
  box(ctx, 0, band, k * 2, h - 2 * band, P.red, P.outline, k * 0.6);
  box(ctx, w - k * 2, band, k * 2, h - 2 * band, P.red, P.outline, k * 0.6);
  box(ctx, 0, 0, w, h, 'rgba(0,0,0,0)', P.outline, k * 0.8);
}

/** Tabellone su due pali con una freccia grossa. */
function forkBoard(ctx: Ctx2D, w: number, h: number, dir: -1 | 1): void {
  const k = lw(w, h);
  for (const x of [w * 0.22, w * 0.72]) box(ctx, x, h * 0.62, w * 0.06, h * 0.38, P.greyDark, P.outline, k * 0.7);
  const boardH = h * 0.62;
  box(ctx, w * 0.04, h * 0.04, w * 0.92, boardH, '#1f7a45', P.outline, k);
  box(ctx, w * 0.07, h * 0.07, w * 0.86, boardH - h * 0.06, 'rgba(0,0,0,0)', P.white, k * 0.6);
  const cy = h * 0.35;
  const tip = dir === -1 ? w * 0.16 : w * 0.84;
  const tail = dir === -1 ? w * 0.8 : w * 0.2;
  poly(
    ctx,
    [
      [tip, cy],
      [tip + dir * -1 * w * 0.2, cy - h * 0.16],
      [tip + dir * -1 * w * 0.2, cy - h * 0.06],
      [tail, cy - h * 0.06],
      [tail, cy + h * 0.06],
      [tip + dir * -1 * w * 0.2, cy + h * 0.06],
      [tip + dir * -1 * w * 0.2, cy + h * 0.16],
    ],
    P.white,
    P.outline,
    k * 0.6,
  );
}

/** Pannello rettangolare con tre chevron: rosso a sinistra, blu a destra. */
function directionPanel(ctx: Ctx2D, w: number, h: number, dir: -1 | 1, tint: string): void {
  const k = lw(w, h);
  box(ctx, w * 0.46, h * 0.58, w * 0.08, h * 0.42, P.greyDark, P.outline, k * 0.7);
  box(ctx, w * 0.04, h * 0.06, w * 0.92, h * 0.52, tint, P.outline, k);
  for (let i = 0; i < 3; i++) {
    const x = w * (0.2 + i * 0.24);
    poly(
      ctx,
      [
        [x + dir * w * 0.09, h * 0.14],
        [x + dir * w * 0.09 + dir * -1 * w * 0.09, h * 0.32],
        [x + dir * w * 0.09, h * 0.5],
        [x + dir * w * 0.14, h * 0.5],
        [x + dir * w * 0.14 + dir * -1 * w * 0.09, h * 0.32],
        [x + dir * w * 0.14, h * 0.14],
      ],
      P.white,
      P.outline,
      k * 0.5,
    );
  }
}

/** Disco bianco a bordo rosso con un cuneo nero: il segnale di velocità. */
function speedSign(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.44, h * 0.4, w * 0.12, h * 0.6, P.metalDark, P.outline, k);
  ell(ctx, w * 0.5, h * 0.26, w * 0.44, h * 0.24, P.red, P.outline, k);
  ell(ctx, w * 0.5, h * 0.26, w * 0.32, h * 0.17, P.white, P.outline, k * 0.6);
  poly(
    ctx,
    [
      [w * 0.38, h * 0.18],
      [w * 0.64, h * 0.26],
      [w * 0.38, h * 0.34],
    ],
    '#141414',
  );
}

/** Triangolo a bordo rosso con una strada a S: il segnale di pericolo. */
function cautionSign(ctx: Ctx2D, w: number, h: number): void {
  const k = lw(w, h);
  box(ctx, w * 0.44, h * 0.44, w * 0.12, h * 0.56, P.metalDark, P.outline, k);
  const tri: readonly (readonly [number, number])[] = [
    [w * 0.5, h * 0.03],
    [w * 0.94, h * 0.44],
    [w * 0.06, h * 0.44],
  ];
  poly(ctx, tri, P.red, P.outline, k);
  poly(
    ctx,
    [
      [w * 0.5, h * 0.12],
      [w * 0.84, h * 0.4],
      [w * 0.16, h * 0.4],
    ],
    P.white,
    P.outline,
    k * 0.5,
  );
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = Math.max(2, k);
  ctx.beginPath();
  ctx.moveTo(w * 0.38, h * 0.38);
  ctx.quadraticCurveTo(w * 0.62, h * 0.3, w * 0.42, h * 0.24);
  ctx.quadraticCurveTo(w * 0.28, h * 0.2, w * 0.52, h * 0.16);
  ctx.stroke();
}

/** I quattordici ripieghi dei momenti di gara (spec §4.4e, §13). */
export const RACE_ART: Record<SpriteName, Drawer> = {
  race_start_gantry: (c, w, h) => startGantry(c, w, h),
  race_checkpoint: (c, w, h) => checkpointGantry(c, w, h),
  race_goal: (c, w, h) => goalGantry(c, w, h),
  race_start_lights: (c, w, h) => startLights(c, w, h),
  race_flag_left: (c, w, h) => flag(c, w, h, P.red, 1),
  race_flag_right: (c, w, h) => flag(c, w, h, P.blue, -1),
  race_finish_flags: (c, w, h) => crossedFlags(c, w, h),
  race_finish_banner: (c, w, h) => finishBanner(c, w, h),
  race_fork_left: (c, w, h) => forkBoard(c, w, h, -1),
  race_fork_right: (c, w, h) => forkBoard(c, w, h, 1),
  race_direction_left: (c, w, h) => directionPanel(c, w, h, -1, P.red),
  race_direction_right: (c, w, h) => directionPanel(c, w, h, 1, P.blue),
  race_speed_sign: (c, w, h) => speedSign(c, w, h),
  race_caution_sign: (c, w, h) => cautionSign(c, w, h),
};

// `vgrad` non serve a questi disegnatori: tutti a tinte piatte, come il
// resto dello stile. L'import resta fuori di proposito.
void vgrad;
