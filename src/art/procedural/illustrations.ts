import { GAME_NAME } from '../../core/config';
import type { SpriteName } from '../../types';
import { type Ctx2D, type Drawer, P, box, ell, lw, poly, vgrad } from './palette';

/** Cielo a gradiente: le illustrazioni sono a pieno riquadro, non hanno alfa. */
function sky(ctx: Ctx2D, w: number, h: number, top: string, bottom: string): void {
  box(ctx, 0, 0, w, h, vgrad(ctx, 0, 0, 0, h, [
    [0, top],
    [1, bottom],
  ]));
}

function sunDisc(ctx: Ctx2D, w: number, h: number, cx: number, cy: number, r: number, color: string): void {
  ell(ctx, cx, cy, r, r, color);
  for (let i = 0; i < 5; i += 1) {
    box(ctx, cx - r, cy + r * (0.1 + 0.18 * i), r * 2, r * 0.07, '#ffffff');
  }
}

function ground(ctx: Ctx2D, w: number, h: number, at: number, color: string, dark: string): void {
  box(ctx, 0, h * at, w, h * (1 - at), color);
  box(ctx, 0, h * at, w, h * 0.02, dark);
}

/** Auto rossa vista da dietro, semplificata: serve come riferimento di scena. */
function carSil(ctx: Ctx2D, w: number, h: number, cx: number, baseY: number, size: number): void {
  const k = lw(w, h);
  const bw = size;
  ell(ctx, cx - bw * 0.34, baseY, bw * 0.1, bw * 0.07, P.tyre, P.outline, k * 0.6);
  ell(ctx, cx + bw * 0.34, baseY, bw * 0.1, bw * 0.07, P.tyre, P.outline, k * 0.6);
  poly(
    ctx,
    [
      [cx - bw * 0.5, baseY - bw * 0.04],
      [cx - bw * 0.42, baseY - bw * 0.3],
      [cx + bw * 0.42, baseY - bw * 0.3],
      [cx + bw * 0.5, baseY - bw * 0.04],
    ],
    P.red,
    P.outline,
    k * 0.8,
  );
  box(ctx, cx - bw * 0.3, baseY - bw * 0.28, bw * 0.6, bw * 0.1, P.redDark);
  box(ctx, cx - bw * 0.44, baseY - bw * 0.22, bw * 0.16, bw * 0.07, P.redLight, P.outline, k * 0.5);
  box(ctx, cx + bw * 0.28, baseY - bw * 0.22, bw * 0.16, bw * 0.07, P.redLight, P.outline, k * 0.5);
}

/** Coppia: lui capelli scuri, lei bionda. */
function coupleSil(ctx: Ctx2D, w: number, h: number, cx: number, baseY: number, size: number): void {
  const k = lw(w, h);
  const people: [number, string, string][] = [
    [cx - size * 0.3, '#3b2a1e', P.white],
    [cx + size * 0.3, P.yellow, P.cream],
  ];
  for (const [x, hair, dress] of people) {
    poly(
      ctx,
      [
        [x - size * 0.16, baseY],
        [x - size * 0.13, baseY - size * 0.58],
        [x + size * 0.13, baseY - size * 0.58],
        [x + size * 0.16, baseY],
      ],
      dress,
      P.outline,
      k * 0.6,
    );
    ell(ctx, x, baseY - size * 0.68, size * 0.12, size * 0.14, '#e8b98f', P.outline, k * 0.6);
    ell(ctx, x, baseY - size * 0.74, size * 0.13, size * 0.1, hair, P.outline, k * 0.6);
  }
}

function crowd(ctx: Ctx2D, w: number, h: number, baseY: number, color: string): void {
  for (let i = 0; i < 26; i += 1) {
    const x = w * ((i % 13) / 12.5) + (i > 12 ? w * 0.03 : 0);
    const y = baseY - (i > 12 ? h * 0.05 : 0);
    ell(ctx, x, y - h * 0.05, w * 0.016, h * 0.05, color);
    ell(ctx, x, y - h * 0.11, w * 0.013, h * 0.022, '#e8b98f');
  }
}

function palmSil(ctx: Ctx2D, w: number, h: number, x: number, baseY: number, size: number, color: string): void {
  box(ctx, x - size * 0.03, baseY - size, size * 0.06, size, color);
  for (let i = 0; i < 6; i += 1) {
    const a = Math.PI + (Math.PI * (i + 0.5)) / 6;
    poly(
      ctx,
      [
        [x, baseY - size],
        [x + Math.cos(a) * size * 0.4, baseY - size + Math.sin(a) * size * 0.3],
        [x + Math.cos(a) * size * 0.26, baseY - size + Math.sin(a) * size * 0.06],
      ],
      color,
    );
  }
}

function burst(ctx: Ctx2D, x: number, y: number, r: number, color: string): void {
  for (let i = 0; i < 12; i += 1) {
    const a = (Math.PI * 2 * i) / 12;
    box(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, Math.max(2, r * 0.1), Math.max(2, r * 0.1), color);
    box(ctx, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, Math.max(2, r * 0.08), Math.max(2, r * 0.08), color);
  }
  ell(ctx, x, y, r * 0.1, r * 0.1, '#ffffff');
}

function confetti(ctx: Ctx2D, w: number, h: number): void {
  const colors = [P.yellow, P.pink, P.teal, P.white, P.orange];
  for (let i = 0; i < 60; i += 1) {
    const x = ((i * 137) % 100) / 100;
    const y = ((i * 61) % 100) / 100;
    box(ctx, w * x, h * y * 0.7, w * 0.008, h * 0.02, colors[i % colors.length]);
  }
}

export const ILLUSTRATIONS: Record<SpriteName, Drawer> = {
  // 1. Premiazione con trofeo davanti alla folla
  ending_1: (c, w, h) => {
    sky(c, w, h, '#ffb35c', '#ff7a6d');
    ground(c, w, h, 0.72, '#6b5a8a', '#3d3154');
    crowd(c, w, h, h * 0.74, '#2b2440');
    box(c, w * 0.34, h * 0.62, w * 0.32, h * 0.12, P.stone, P.outline, lw(w, h));
    coupleSil(c, w, h, w * 0.5, h * 0.62, h * 0.42);
    const k = lw(w, h);
    box(c, w * 0.485, h * 0.14, w * 0.03, h * 0.1, P.yellow, P.outline, k);
    ell(c, w * 0.5, h * 0.12, w * 0.05, h * 0.06, P.yellow, P.outline, k);
    confetti(c, w, h);
  },

  // 2. Picnic sul cofano in riva al lago al tramonto
  ending_2: (c, w, h) => {
    sky(c, w, h, '#ff9a3c', '#ffd7a0');
    sunDisc(c, w, h, w * 0.7, h * 0.4, h * 0.14, '#ff5f6d');
    box(c, 0, h * 0.5, w, h * 0.22, '#3f7fa8');
    ground(c, w, h, 0.72, P.sandDark, '#7a5a2e');
    for (const x of [0.08, 0.2, 0.92]) palmSil(c, w, h, w * x, h * 0.74, h * 0.34, '#1f3d2e');
    carSil(c, w, h, w * 0.42, h * 0.9, h * 0.6);
    coupleSil(c, w, h, w * 0.66, h * 0.88, h * 0.3);
    box(c, w * 0.78, h * 0.84, w * 0.07, h * 0.06, P.wood, P.outline, lw(w, h));
  },

  // 3. Fuochi d'artificio sul porto, i due ballano accanto all'auto
  ending_3: (c, w, h) => {
    sky(c, w, h, '#1b1a4a', '#5c2a6b');
    burst(c, w * 0.2, h * 0.22, h * 0.14, P.yellow);
    burst(c, w * 0.52, h * 0.14, h * 0.1, P.teal);
    burst(c, w * 0.8, h * 0.26, h * 0.12, P.pink);
    box(c, 0, h * 0.54, w, h * 0.18, '#16324f');
    for (let i = 0; i < 14; i += 1) {
      box(c, w * (0.02 + 0.07 * i), h * 0.44, w * 0.04, h * 0.1, '#2a2a4a');
    }
    ground(c, w, h, 0.72, '#2b2440', '#151226');
    carSil(c, w, h, w * 0.7, h * 0.92, h * 0.58);
    coupleSil(c, w, h, w * 0.34, h * 0.9, h * 0.36);
  },

  // 4. Gag: l'auto fuma, il meccanico urla, i due ridono
  ending_4: (c, w, h) => {
    sky(c, w, h, '#8fd0ff', '#dff1ff');
    ground(c, w, h, 0.74, '#9aa0a6', '#5c636a');
    carSil(c, w, h, w * 0.62, h * 0.92, h * 0.62);
    for (let i = 0; i < 7; i += 1) {
      ell(c, w * (0.55 + 0.02 * i), h * (0.5 - 0.05 * i), h * 0.06, h * 0.05, '#e9ecef');
    }
    coupleSil(c, w, h, w * 0.26, h * 0.9, h * 0.38);
    const k = lw(w, h);
    poly(
      c,
      [
        [w * 0.86, h * 0.9],
        [w * 0.84, h * 0.52],
        [w * 0.94, h * 0.52],
        [w * 0.92, h * 0.9],
      ],
      '#2f6f9f',
      P.outline,
      k,
    );
    ell(c, w * 0.89, h * 0.46, h * 0.06, h * 0.07, '#e8b98f', P.outline, k);
    box(c, w * 0.83, h * 0.4, h * 0.14, h * 0.03, P.brick, P.outline, k * 0.7);
  },

  // 5. I due guardano il tramonto sulla spiaggia
  ending_5: (c, w, h) => {
    sky(c, w, h, '#ff7a3c', '#ffd27a');
    sunDisc(c, w, h, w * 0.5, h * 0.46, h * 0.18, '#ffe066');
    box(c, 0, h * 0.56, w, h * 0.18, '#e06a4a');
    ground(c, w, h, 0.74, P.sand, P.sandDark);
    for (const x of [0.06, 0.16, 0.86, 0.96]) palmSil(c, w, h, w * x, h * 0.76, h * 0.4, '#3d2a1e');
    carSil(c, w, h, w * 0.5, h * 0.94, h * 0.66);
    coupleSil(c, w, h, w * 0.5, h * 0.72, h * 0.26);
  },

  // Schermata radio (spec §11): strada al tramonto, sfondo a tutto schermo
  // dietro il pannello. Semplice apposta: è il ripiego procedurale, non
  // l'illustrazione finale.
  screen_attract: (c, w, h) => {
    sky(c, w, h, '#ff7a3c', '#ffd27a');
    sunDisc(c, w, h, w * 0.5, h * 0.42, h * 0.16, '#ffe066');
    ground(c, w, h, 0.62, P.sand, P.sandDark);
    for (const x of [0.05, 0.15, 0.85, 0.95]) palmSil(c, w, h, w * x, h * 0.64, h * 0.32, '#3d2a1e');
    // Strada che converge verso il sole, come l'ingresso di una tappa.
    const k = lw(w, h);
    poly(
      c,
      [
        [w * 0.5 - w * 0.02, h * 0.62],
        [w * 0.5 + w * 0.02, h * 0.62],
        [w * 0.5 + w * 0.32, h],
        [w * 0.5 - w * 0.32, h],
      ],
      '#5f5f66',
      P.outline,
      k * 0.6,
    );
    box(c, w * 0.492, h * 0.74, w * 0.016, h * 0.05, '#ffe066');
    box(c, w * 0.492, h * 0.86, w * 0.016, h * 0.05, '#ffe066');
    carSil(c, w, h, w * 0.5, h * 0.98, h * 0.34);
  },

  // Schermata radio: pannello dell'autoradio con la mano sulla manopola.
  // Il display (dove il gioco scrive il titolo scelto) resta un rettangolo
  // scuro, così il testo giallo sopra si legge bene.
  radio_panel: (c, w, h) => {
    const k = lw(w, h);
    box(c, 0, 0, w, h, P.metalDark, P.outline, k);
    box(c, w * 0.04, h * 0.08, w * 0.92, h * 0.84, P.metal, P.outline, k * 0.7);
    // Display: x 300..700, y 130..210 su un riquadro 1000x400 (spec §11).
    box(c, w * 0.3, h * 0.325, w * 0.4, h * 0.2, P.blueDark, P.outline, k * 0.6);
    for (let i = 0; i < 3; i += 1) {
      box(c, w * (0.32 + i * 0.12), h * 0.58, w * 0.08, h * 0.05, P.greyDark, P.outline, k * 0.4);
    }
    // Manopola, a destra del display.
    const knobX = w * 0.82;
    const knobY = h * 0.42;
    ell(c, knobX, knobY, w * 0.07, w * 0.07, P.metal, P.outline, k * 0.6);
    ell(c, knobX, knobY, w * 0.02, w * 0.02, P.metalDark);
    // Mano stilizzata sulla manopola: palmo più quattro dita.
    const skin = '#e8b98f';
    ell(c, knobX - w * 0.01, knobY + h * 0.02, w * 0.055, h * 0.09, skin, P.outline, k * 0.5);
    for (let i = 0; i < 4; i += 1) {
      box(
        c,
        knobX - w * 0.05 + i * w * 0.028,
        knobY - h * 0.16,
        w * 0.02,
        h * 0.14,
        skin,
        P.outline,
        k * 0.4,
      );
    }
  },

  // Logo: il nome del gioco in lettere chrome con sole a strisce dietro
  title_logo: (c, w, h) => {
    const k = lw(w, h);
    ell(c, w / 2, h * 0.52, w * 0.3, h * 0.42, vgrad(c, 0, h * 0.1, 0, h * 0.9, [
      [0, P.yellow],
      [0.5, P.orange],
      [1, P.pink],
    ]));
    for (let i = 0; i < 6; i += 1) {
      box(c, w * 0.18, h * (0.56 + 0.06 * i), w * 0.64, h * 0.025, '#ffffff');
    }
    c.font = `italic bold ${Math.round(h * 0.4)}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = Math.max(2, k * 1.6);
    c.strokeStyle = P.blue;
    c.strokeText(GAME_NAME, w / 2, h * 0.5);
    c.fillStyle = vgrad(c, 0, h * 0.24, 0, h * 0.76, [
      [0, P.cream],
      [0.45, P.pink],
      [0.55, P.white],
      [1, P.blue],
    ]);
    c.fillText(GAME_NAME, w / 2, h * 0.5);
  },
};
