import targetsJson from '../../tools/sprite-targets.json';
import { CATALOG, STRIPS } from '../art/catalog';
import type { AssetStore, SpriteAsset, SpriteCatalogEntry, SpriteKind, SpriteName } from '../types';

interface Target {
  w: number;
  h: number;
  frames?: number;
}

const TARGETS = targetsJson as Record<string, Target>;

/** Misure per i nomi che esistono solo in forma procedurale. */
const FALLBACK: Record<string, { w: number; h: number }> = {
  common_barrier: { w: 200, h: 140 },
  common_gantry: { w: 1800, h: 420 },
  ground_tuft: { w: 96, h: 64 },
  ground_stone: { w: 80, h: 56 },
  ground_crack: { w: 120, h: 40 },
};

/** Voce usata per i nomi fuori catalogo: segnaposto innocuo. */
export const PLACEHOLDER_ENTRY: SpriteCatalogEntry = {
  kind: 'scenery',
  scale: 0.3,
  solid: false,
  collideW: 0,
  anchorY: 1,
};

/** Misura finale del frame di un nome logico, da tools/sprite-targets.json. */
export function stubSize(name: SpriteName): { w: number; h: number } {
  const direct = TARGETS[name];
  if (direct) return { w: direct.w, h: direct.h };
  for (const [file, frames] of Object.entries(STRIPS)) {
    if (frames.includes(name) && TARGETS[file]) return { w: TARGETS[file].w, h: TARGETS[file].h };
  }
  return FALLBACK[name] ?? { w: 256, h: 256 };
}

/** Colore pieno e colore di contorno per tipo di sprite. */
const COLORS: Record<SpriteKind, [string, string]> = {
  player: ['#e0402f', '#7a1c14'],
  car: ['#3a6fe0', '#1b3a7a'],
  scenery: ['#2f8a42', '#1b4f27'],
  background: ['#6f86ad', '#42536e'],
  illustration: ['#8a6ab0', '#42305a'],
  ui: ['#ffcc55', '#7a5f1c'],
  texture: ['#8a7f6a', '#5d5548'],
  wall: ['#8f6a5a', '#54382e'],
};

/** Rettangolo magenta col nome, per i nomi fuori catalogo (spec §13). */
function drawPlaceholder(
  ctx: OffscreenCanvasRenderingContext2D,
  name: SpriteName,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  ctx.font = '16px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(name, 4, 4);
}

/** Sagoma piatta a due toni, riconoscibile per tipo. */
function drawStub(
  ctx: OffscreenCanvasRenderingContext2D,
  entry: SpriteCatalogEntry,
  w: number,
  h: number,
): void {
  const [fill, line] = COLORS[entry.kind];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = fill;
  ctx.strokeStyle = line;
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.04);

  if (entry.kind === 'player' || entry.kind === 'car') {
    const bodyH = h * 0.6;
    ctx.fillRect(w * 0.05, h - bodyH, w * 0.9, bodyH);
    ctx.strokeRect(w * 0.05, h - bodyH, w * 0.9, bodyH);
    ctx.fillStyle = line;
    ctx.fillRect(w * 0.22, h - bodyH - h * 0.22, w * 0.56, h * 0.24);
    ctx.fillRect(w * 0.03, h - h * 0.16, w * 0.16, h * 0.16);
    ctx.fillRect(w * 0.81, h - h * 0.16, w * 0.16, h * 0.16);
    return;
  }

  if (entry.kind === 'background') {
    // Fila di colline che si ripete senza stacchi ai bordi.
    const hills = 8;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= hills; i++) {
      const x = (w * i) / hills;
      ctx.lineTo(x, h - (i % 2 === 0 ? h * 0.45 : h * 0.85));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (entry.kind === 'scenery' && h > w * 1.4) {
    // Oggetto alto e stretto: tronco più chioma.
    ctx.fillStyle = line;
    ctx.fillRect(w * 0.42, h * 0.4, w * 0.16, h * 0.6);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.28, w * 0.48, h * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  ctx.fillRect(w * 0.06, h * 0.12, w * 0.88, h * 0.86);
  ctx.strokeRect(w * 0.06, h * 0.12, w * 0.88, h * 0.86);
}

/**
 * AssetStore di sviluppo: ogni sprite è una sagoma piatta disegnata su
 * OffscreenCanvas alla misura di tools/sprite-targets.json. Serve per far
 * girare il binario A senza il binario C. Solo per la pagina di prova.
 * `get` non lancia mai: un nome fuori catalogo dà un segnaposto magenta.
 */
export function createStubAssets(): AssetStore {
  const cache = new Map<SpriteName, SpriteAsset>();
  const stats = { png: 0, procedural: 0, missing: 0 };

  const build = (name: SpriteName): SpriteAsset => {
    const entry = CATALOG[name];
    const { w, h } = entry ? stubSize(name) : { w: 256, h: 256 };
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    if (entry) {
      drawStub(ctx, entry, w, h);
      stats.procedural++;
      return { name, image: canvas, w, h, entry };
    }
    drawPlaceholder(ctx, name, w, h);
    stats.missing++;
    return { name, image: canvas, w, h, entry: PLACEHOLDER_ENTRY };
  };

  return {
    ready: Promise.resolve(),
    has: (name) => CATALOG[name] !== undefined,
    get(name) {
      let asset = cache.get(name);
      if (!asset) {
        asset = build(name);
        cache.set(name, asset);
      }
      return asset;
    },
    stats,
  };
}
