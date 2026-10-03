import type { AssetStore, RaceSnapshot, SpriteName } from '../types';

/**
 * Gabbiani in volo (spec §13): una sovrapposizione 2D con parallasse, non
 * scenografia in prospettiva. Sono in cielo, quindi non hanno una
 * posizione lungo il tracciato: hanno una posizione a schermo, una
 * velocità propria e una deriva che segue la parallasse dello sfondo. Si
 * disegnano subito dopo il cielo e prima della strada.
 */

/** Quanti gabbiani in volo insieme. */
export const FLOCK_SIZE = 3;
/** Frame della strip `npc_seagull` (spec §13). */
export const SEAGULL_FRAMES = 3;
/** Secondi per frame del battito d'ali. */
export const SEAGULL_FRAME_S = 0.18;
/** Larghezza a schermo di un gabbiano. */
export const SEAGULL_W = 56;
/** Proporzione di ripiego della strip: 90×60 per frame (spec §13). */
export const SEAGULL_ASPECT = 60 / 90;
/** Velocità orizzontale, pixel al secondo. */
export const SEAGULL_SPEED_MIN = 40;
export const SEAGULL_SPEED_MAX = 95;
/** Banda di quote in cui volano, in frazioni di altezza del frame. */
export const SEAGULL_BAND_TOP = 0.16;
export const SEAGULL_BAND_BOTTOM = 0.4;
/** Quanto la parallasse dello sfondo trascina i gabbiani. */
export const SEAGULL_PARALLAX = 0.35;
/** Solo il tema spiaggia ha gabbiani. */
export const SEAGULL_THEME = 'beach';

/** Frame del battito d'ali all'istante `t`, in secondi. Pura. */
export function seagullFrameName(t: number): SpriteName {
  const frame = Math.floor(Math.max(0, t) / SEAGULL_FRAME_S) % SEAGULL_FRAMES;
  return `npc_seagull_${frame}`;
}

/**
 * Avanzamento di un valore che gira in `[0, 1)`, riportato nel giro più
 * corto: `0.99 → 0.01` è `+0.02`, non `-0.98`. Serve alla deriva di
 * parallasse, che altrimenti farebbe saltare i gabbiani di mezzo schermo
 * a ogni giro dello strato di sfondo. Pura.
 */
export function wrapDelta(d: number): number {
  return d - Math.round(d);
}

interface Bird {
  /** Pixel, può uscire dal frame di `SEAGULL_W` prima di riavvolgersi. */
  x: number;
  y: number;
  vx: number;
  /** Secondi di volo: alimenta il battito d'ali. */
  t: number;
}

export interface Flock {
  /** Un tick: muove i gabbiani, o li spegne se il tema non è la spiaggia. */
  update(dt: number, snapshot: RaceSnapshot): void;
  /** Da chiamare subito dopo il cielo e prima della strada. */
  draw(ctx: CanvasRenderingContext2D, assets: AssetStore, width: number, height: number): void;
  readonly visible: number;
}

/**
 * Stormo a piscina fissa: `FLOCK_SIZE` gabbiani allocati una volta sola.
 * `rng` è iniettabile perché i test devono vedere sempre lo stesso volo.
 */
export function createFlock(rng: () => number = Math.random): Flock {
  const birds: Bird[] = Array.from({ length: FLOCK_SIZE }, () => ({ x: 0, y: 0, vx: 0, t: 0 }));
  let active = false;
  let prevFar = 0;

  const seed = (width: number, height: number): void => {
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      b.x = width * ((i + 0.5) / birds.length);
      b.y = height * (SEAGULL_BAND_TOP + rng() * (SEAGULL_BAND_BOTTOM - SEAGULL_BAND_TOP));
      b.vx = (rng() < 0.5 ? -1 : 1) * (SEAGULL_SPEED_MIN + rng() * (SEAGULL_SPEED_MAX - SEAGULL_SPEED_MIN));
      b.t = rng() * SEAGULL_FRAME_S * SEAGULL_FRAMES;
    }
  };

  return {
    update(dt: number, snapshot: RaceSnapshot): void {
      if (snapshot.theme !== SEAGULL_THEME) {
        active = false;
        return;
      }
      // La banda di volo è in frazioni del frame logico: 1280x720.
      if (!active) {
        seed(1280, 720);
        active = true;
        prevFar = snapshot.parallax.far;
      }
      if (!(dt > 0)) return;
      const far = snapshot.parallax.far;
      const drift = -wrapDelta(far - prevFar) * 1280 * SEAGULL_PARALLAX;
      prevFar = far;
      const span = 1280 + 2 * SEAGULL_W;
      for (const b of birds) {
        b.t += dt;
        b.x += b.vx * dt + drift;
        // Riavvolgimento: chi esce da un lato rientra dall'altro.
        b.x = ((((b.x + SEAGULL_W) % span) + span) % span) - SEAGULL_W;
      }
    },

    draw(ctx: CanvasRenderingContext2D, assets: AssetStore, width: number, height: number): void {
      if (!active) return;
      for (const b of birds) {
        // get() non lancia mai: senza PNG arriva il frame procedurale.
        const asset = assets.get(seagullFrameName(b.t));
        if (!(asset.w > 0) || !(asset.h > 0)) continue;
        const dw = SEAGULL_W;
        // L'altezza segue la proporzione dell'**asset**, come in
        // `spriteDestRect`: il target 90×60 e il PNG lavorato coincidono,
        // e il ripiego procedurale disegna nello stesso riquadro.
        const dh = (dw * asset.h) / asset.w;
        ctx.drawImage(asset.image, (b.x / 1280) * width, (b.y / 720) * height, dw, dh);
      }
    },

    get visible(): number {
      return active ? birds.length : 0;
    },
  };
}
