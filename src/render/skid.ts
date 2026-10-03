import type { RaceSnapshot, Segment } from '../types';
import { quad } from './ground';
import { SEGMENT_LENGTH } from './project';
import { shouldDrawSegment } from './road';

/**
 * Strisce di gomma sull'asfalto (spec §4.4b). Non sono particelle: stanno
 * **nel mondo**, ferme sulla strada, e devono seguirne la prospettiva e
 * la curva. Perciò sono due quadrilateri per segmento, disegnati con la
 * stessa `quad` della strada e con la stessa prova di visibilità.
 *
 * La memoria è una mappa da indice di segmento alla posizione laterale
 * dell'auto quando ci è passata, più un anello di chiavi che dice quale
 * segmento buttare quando la mappa è piena: nessuna allocazione nel ciclo
 * di gioco dopo la costruzione.
 */

/** Quanti segmenti di striscia si tengono in memoria. */
export const MAX_SKID_SEGMENTS = 320;
/** Larghezza di una striscia, in semilarghezze strada. */
export const TYRE_W = 0.035;
/** Distanza di una ruota dal centro dell'auto, in semilarghezze strada. */
export const TYRE_GAP = 0.05;
/** Gomma sull'asfalto: scura e translucida, non nera piena. */
export const SKID_COLOR = 'rgba(20,18,22,0.45)';

/** Slot dell'anello non ancora usato. */
const EMPTY = -1;

/**
 * Indice del segmento che contiene `z`. `player.z` arriva già riportato
 * in `[0, trackLength)` dal motore, quindi non serve il modulo; una `z`
 * negativa (nessun chiamante la produce, ma la firma la permette) cade sul
 * segmento 0. Pura.
 */
export function segmentIndexAt(z: number): number {
  const i = Math.floor(z / SEGMENT_LENGTH);
  return i < 0 ? 0 : i;
}

export interface SkidTrail {
  /**
   * Un tick di gara: se il giocatore sta derapando, marca i segmenti che
   * ha attraversato in questo passo. Un tick grosso ne attraversa più di
   * uno e li marca tutti, altrimenti la striscia risulta tratteggiata.
   */
  update(dt: number, snapshot: RaceSnapshot): void;
  /**
   * Disegna le strisce sui segmenti visibili. Va chiamata **dopo** la
   * strada e **prima** degli sprite: la gomma sta sull'asfalto, sotto le
   * ruote di chiunque passi.
   */
  draw(ctx: CanvasRenderingContext2D, segments: readonly Segment[]): void;
  readonly count: number;
  clear(): void;
}

export function createSkidTrail(): SkidTrail {
  /** indice di segmento → posizione laterale dell'auto su quel segmento. */
  const xByIndex = new Map<number, number>();
  /** Chiavi in ordine di inserimento: il prossimo slot è il più vecchio. */
  const ring = new Int32Array(MAX_SKID_SEGMENTS).fill(EMPTY);
  let next = 0;
  /** Ultimo segmento marcato, o EMPTY se la derapata non è in corso. */
  let lastMarked = EMPTY;
  /** Tappa a cui appartengono gli indici in memoria. */
  let stageId = '';

  const mark = (index: number, x: number): void => {
    if (!xByIndex.has(index)) {
      const evicted = ring[next];
      if (evicted !== EMPTY) xByIndex.delete(evicted);
      ring[next] = index;
      next = (next + 1) % MAX_SKID_SEGMENTS;
    }
    xByIndex.set(index, x);
  };

  const wipe = (): void => {
    xByIndex.clear();
    ring.fill(EMPTY);
    next = 0;
    lastMarked = EMPTY;
  };

  return {
    update(_dt: number, snapshot: RaceSnapshot): void {
      // Cambio tappa: gli indici in memoria puntano a un'altra strada, e
      // `player.z` è tornato a zero. Si butta tutto.
      if (snapshot.stage.id !== stageId) {
        stageId = snapshot.stage.id;
        wipe();
      }
      const p = snapshot.player;
      // Solo sull'asfalto: fuori strada c'è la polvere, non la gomma.
      if (!p.skidding || p.surface !== 'road' || snapshot.crash.active) {
        lastMarked = EMPTY;
        return;
      }
      const index = segmentIndexAt(p.z);
      if (lastMarked === EMPTY) {
        mark(index, p.x);
        lastMarked = index;
        return;
      }
      if (index === lastMarked) {
        // Stesso segmento: si aggiorna la posizione, la striscia segue
        // l'auto che continua a scivolare.
        mark(index, p.x);
        return;
      }
      const steps = index - lastMarked;
      if (steps > 0 && steps <= MAX_SKID_SEGMENTS) {
        for (let k = 1; k <= steps; k++) mark(lastMarked + k, p.x);
      } else {
        // Salto enorme o indietro (avvolgimento del tracciato): si ricomincia.
        mark(index, p.x);
      }
      lastMarked = index;
    },

    draw(ctx: CanvasRenderingContext2D, segments: readonly Segment[]): void {
      if (xByIndex.size === 0) return;
      for (let n = 0; n < segments.length; n++) {
        const seg = segments[n];
        const x = xByIndex.get(seg.index);
        if (x === undefined) continue;
        if (!shouldDrawSegment(seg)) continue;
        const { x: x1, y: y1, w: w1 } = seg.p1.screen;
        const { x: x2, y: y2, w: w2 } = seg.p2.screen;
        const t1 = (TYRE_W * w1) / 2;
        const t2 = (TYRE_W * w2) / 2;
        for (let side = -1; side <= 1; side += 2) {
          const o = x + side * TYRE_GAP;
          const cx1 = x1 + o * w1;
          const cx2 = x2 + o * w2;
          quad(ctx, cx1 - t1, y1, cx1 + t1, y1, cx2 + t2, y2, cx2 - t2, y2, SKID_COLOR);
        }
      }
    },

    get count(): number {
      return xByIndex.size;
    },

    clear(): void {
      wipe();
    },
  };
}
