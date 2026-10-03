import type { AssetStore } from '../types';

/**
 * Tendina fra schermate (spec §11): dura `WIPE_S` secondi. Al primo
 * fotogramma della schermata nuova copre **tutto** il quadro con una
 * cartolina di tramonto (fondo scuro, `transition_sunset` all'orizzonte e
 * la striscia di palme `transition_wipe` in basso che scorre verso
 * sinistra), poi svanisce e scopre la schermata nuova. Le due immagini
 * restano nel loro aspetto (niente stiramenti) e i loro bordi sfumano nel
 * fondo: prima la striscia era tirata al 42% dell'altezza e scorreva come
 * un rettangolo pieno, e il tramonto era una banda a spigoli vivi, così
 * a metà passaggio si vedevano due schermate tagliate una sull'altra.
 * Non tocca `ui/fsm.ts`, che è il contratto fra i binari: la guida
 * `ui/app.ts`, che sa quando il nome della schermata è cambiato.
 */

/** Durata della tendina, in secondi (spec §11). */
export const WIPE_S = 0.4;
/** Colore del fondo della cartolina, lo stesso delle sfumature dei bordi. */
export const WIPE_BG = '#1b1026';
/** Quota del centro del tramonto, in frazione dell'altezza del frame. */
export const WIPE_SUNSET_Y = 0.42;
/** Altezza delle sfumature sui bordi delle immagini, in pixel logici. */
export const WIPE_FEATHER = 80;
/** Di quanto scorre la striscia di palme in tutta la tendina, in frazione della larghezza. */
export const WIPE_STRIP_TRAVEL = 0.25;

export interface Wipe {
  /** Da chiamare quando la schermata è appena cambiata. */
  start(): void;
  update(dt: number): void;
  /** Da chiamare per ultima, sopra la schermata nuova già disegnata. */
  draw(ctx: CanvasRenderingContext2D, assets: AssetStore, width: number, height: number): void;
  readonly active: boolean;
  /** 0 all'inizio, 1 alla fine. */
  readonly progress: number;
}

/**
 * Opacità della cartolina a un dato progresso: piena all'inizio, zero alla
 * fine, con i due estremi piatti (smoothstep rovesciato). Pura.
 */
export function wipeAlpha(p: number): number {
  const q = p < 0 ? 0 : p > 1 ? 1 : p;
  return 1 - q * q * (3 - 2 * q);
}

/** Sfuma un bordo orizzontale da `WIPE_BG` pieno a trasparente. */
function feather(ctx: CanvasRenderingContext2D, width: number, yOpaque: number, yClear: number): void {
  const grad = ctx.createLinearGradient(0, yOpaque, 0, yClear);
  grad.addColorStop(0, WIPE_BG);
  grad.addColorStop(1, 'rgba(27,16,38,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, Math.min(yOpaque, yClear), width, Math.abs(yClear - yOpaque));
}

/**
 * La cartolina piena, opaca, a un dato progresso `p` (per lo scorrere
 * delle palme). Nessun livello copre un altro a metà: il fondo, il
 * tramonto e la striscia si toccano solo nelle sfumature.
 */
function paintCard(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  assets: AssetStore,
  width: number,
  height: number,
  p: number,
): void {
  const c = ctx as CanvasRenderingContext2D;
  c.fillStyle = WIPE_BG;
  c.fillRect(0, 0, width, height);

  // Il tramonto, largo quanto il frame e nel suo aspetto, con i bordi alto
  // e basso sfumati nel fondo.
  const sunset = assets.get('transition_sunset');
  if (sunset.w > 0 && sunset.h > 0) {
    const h = (width * sunset.h) / sunset.w;
    const y = height * WIPE_SUNSET_Y - h / 2;
    c.drawImage(sunset.image, 0, y, width, h);
    feather(c, width, y - 1, y + WIPE_FEATHER);
    feather(c, width, y + h + 1, y + h - WIPE_FEATHER);
  }

  // Le palme in basso, nel loro aspetto: due copie affiancate che scorrono
  // verso sinistra, così la striscia copre sempre tutta la larghezza e non
  // ha mai un bordo verticale a vista.
  const strip = assets.get('transition_wipe');
  if (strip.w > 0 && strip.h > 0) {
    const h = (width * strip.h) / strip.w;
    const y = height - h;
    const x = -width * WIPE_STRIP_TRAVEL * p;
    c.drawImage(strip.image, x, y, width, h);
    // La seconda copia è specchiata: al punto di giunzione i pixel dei due
    // lati sono gli stessi, quindi la cucitura non si vede.
    c.save();
    c.translate(x + 2 * width, y);
    c.scale(-1, 1);
    c.drawImage(strip.image, 0, 0, width, h);
    c.restore();
    feather(c, width, y - 1, y + WIPE_FEATHER);
  }
}

export function createWipe(): Wipe {
  let left = 0;
  /**
   * La cartolina si compone opaca qui e si posa sul frame con un solo
   * `drawImage` all'alfa della dissolvenza: disegnata a livelli
   * direttamente, ogni livello prenderebbe l'alfa per conto suo e a metà
   * dissolvenza le bande del tramonto e delle palme si vedrebbero come
   * rettangoli sopra la schermata nuova. Senza `OffscreenCanvas` (i test in
   * Node) si disegna a livelli.
   */
  let card: OffscreenCanvas | null = null;

  const progress = (): number => {
    if (WIPE_S <= 0) return 1;
    const p = 1 - left / WIPE_S;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  };

  return {
    start(): void {
      left = WIPE_S;
    },
    update(dt: number): void {
      if (left <= 0) return;
      left = Math.max(0, left - dt);
    },
    draw(ctx: CanvasRenderingContext2D, assets: AssetStore, width: number, height: number): void {
      if (left <= 0) return;
      const p = progress();
      const alpha = wipeAlpha(p);
      if (alpha <= 0) return;
      ctx.save();
      if (typeof OffscreenCanvas !== 'undefined') {
        if (card === null || card.width !== width || card.height !== height) {
          card = new OffscreenCanvas(width, height);
        }
        const cctx = card.getContext('2d');
        if (cctx !== null) {
          paintCard(cctx, assets, width, height, p);
          ctx.globalAlpha = alpha;
          ctx.drawImage(card, 0, 0, width, height);
          ctx.restore();
          return;
        }
      }
      ctx.globalAlpha = alpha;
      paintCard(ctx, assets, width, height, p);
      ctx.restore();
    },
    get active(): boolean {
      return left > 0;
    },
    get progress(): number {
      return progress();
    },
  };
}
