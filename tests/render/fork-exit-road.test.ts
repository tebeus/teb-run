import { describe, expect, test } from 'vitest';
import { FORK_EXIT_HALF_HOLD, forkExitOffset } from '../../src/game/track';
import { drawForkExitRoad, drawSegment } from '../../src/render/road';
import { PALETTES, segmentColors } from '../../src/render/palette';
import { makeSegment } from '../helpers/segments';
import { createRecordCtx, type Recorder } from '../helpers/recordCtx';
import type { Segment } from '../../src/types';

/** Segmento con coordinate a schermo plausibili, come negli altri test di road.ts. */
const segAt = (over: Partial<Segment> = {}): Segment => {
  const s = makeSegment(3, over);
  s.p1.screen.x = 640;
  s.p1.screen.y = 600;
  s.p1.screen.w = 300;
  s.p2.screen.x = 640;
  s.p2.screen.y = 500;
  s.p2.screen.w = 280;
  return s;
};

/**
 * Primo e secondo punto (`moveTo`, poi il `lineTo` immediatamente dopo) del
 * quadrilatero riempito con `colour`, come `startsOf` di `fork-road.test.ts`
 * ma con anche il secondo punto: serve a misurare la larghezza del lato in
 * alto (`y1`) del trapezio, la stessa per ogni suo bordo superiore.
 */
function firstEdgeOf(rec: Recorder, colour: string): { x1: number; x2: number } | null {
  for (let i = 0; i < rec.ops.length; i++) {
    if (rec.ops[i].type !== 'fill' || rec.ops[i].fill !== colour) continue;
    for (let k = i; k >= 0; k--) {
      if (rec.ops[k].type === 'moveTo' && rec.ops[k + 1]?.type === 'lineTo') {
        return { x1: rec.ops[k].args[0], x2: rec.ops[k + 1].args[0] };
      }
    }
  }
  return null;
}

describe('drawForkExitRoad (spec §4.4, «Uscita dal bivio»)', () => {
  test('without forkExit it draws nothing', () => {
    const rec = createRecordCtx();
    drawForkExitRoad(rec.ctx, segAt(), PALETTES.beach);
    expect(rec.ops).toHaveLength(0);
  });

  test('at t = 1 the road has vanished: nothing is drawn', () => {
    const rec = createRecordCtx();
    drawForkExitRoad(rec.ctx, segAt({ forkExit: { side: 1, t: 1 } }), PALETTES.beach);
    expect(rec.ops).toHaveLength(0);
  });

  test('it draws asphalt, shoulder and rumble with the same quad polygon used for the main road', () => {
    const rec = createRecordCtx();
    const seg = segAt({ forkExit: { side: 1, t: 0.2 } });
    drawForkExitRoad(rec.ctx, seg, PALETTES.beach);
    const fills = rec.ops.filter((op) => op.type === 'fill');
    // 2 banchine + 2 cordoli + 1 asfalto (spec: cordoli e banchina propri).
    expect(fills).toHaveLength(5);
    const colours = segmentColors(PALETTES.beach, seg.dark);
    expect(fills.some((f) => f.fill === colours.road)).toBe(true);
    expect(fills.filter((f) => f.fill === colours.shoulder)).toHaveLength(2);
    expect(fills.filter((f) => f.fill === colours.rumble)).toHaveLength(2);
  });

  test('it draws lane markers, like the real road (terzo addendum del collaudo)', () => {
    const rec = createRecordCtx();
    // Deserto, dark: false: lì `pal.lane` è distinto sia dal cordolo (bianco)
    // sia dall'asfalto e dalla banchina, quindi un controllo per colore
    // significa davvero "una linea di corsia si è disegnata", non una
    // coincidenza di tinte come accade sulla spiaggia (rumble e lane sono lo
    // stesso bianco). Prima del terzo addendum la strada scartata non aveva
    // corsie: si leggeva come una fascia di terreno, non come una strada.
    const seg = segAt({ dark: false, forkExit: { side: 1, t: 0.2 } });
    drawForkExitRoad(rec.ctx, seg, PALETTES.desert);
    const colours = segmentColors(PALETTES.desert, seg.dark);
    expect(colours.lane).not.toBeNull();
    expect(colours.lane).not.toBe(colours.rumble);
    expect(colours.lane).not.toBe(colours.road);
    expect(colours.lane).not.toBe(colours.shoulder);
    expect(rec.ops.some((op) => op.type === 'fill' && op.fill === colours.lane)).toBe(true);
    // 4 corsie (LANES): 3 linee per carreggiata, come sulla strada vera.
    expect(rec.ops.filter((op) => op.type === 'fill' && op.fill === colours.lane)).toHaveLength(3);
  });

  test('it sits off to the side the discarded carriageway moved to', () => {
    const rec = createRecordCtx();
    const seg = segAt({ forkExit: { side: 1, t: 0.3 } });
    drawForkExitRoad(rec.ctx, seg, PALETTES.beach);
    const road = segmentColors(PALETTES.beach, seg.dark).road;
    const edge = firstEdgeOf(rec, road);
    expect(edge).not.toBeNull();
    const midpoint = ((edge as { x1: number; x2: number }).x1 + (edge as { x1: number; x2: number }).x2) / 2;
    const expectedCentre = seg.p1.screen.x + forkExitOffset(1, 0.3) * seg.p1.screen.w;
    expect(midpoint).toBeCloseTo(expectedCentre, 6);
  });

  test('the road holds full width until FORK_EXIT_HALF_HOLD, then shrinks (terzo addendum del collaudo)', () => {
    const early = createRecordCtx();
    const hold = createRecordCtx();
    const late = createRecordCtx();
    const dark = segAt().dark;
    const road = segmentColors(PALETTES.beach, dark).road;
    drawForkExitRoad(early.ctx, segAt({ forkExit: { side: 1, t: 0 } }), PALETTES.beach);
    drawForkExitRoad(hold.ctx, segAt({ forkExit: { side: 1, t: FORK_EXIT_HALF_HOLD } }), PALETTES.beach);
    // A metà strada fra FORK_EXIT_HALF_HOLD e 1: forkExitHalf ci dà 0.5.
    drawForkExitRoad(late.ctx, segAt({ forkExit: { side: 1, t: (FORK_EXIT_HALF_HOLD + 1) / 2 } }), PALETTES.beach);
    const widthOf = (rec: Recorder): number => {
      const edge = firstEdgeOf(rec, road) as { x1: number; x2: number };
      return Math.abs(edge.x2 - edge.x1);
    };
    // Piena larghezza per tutta la fase di tenuta: nessun assottigliamento.
    expect(widthOf(hold)).toBeCloseTo(widthOf(early), 6);
    expect(widthOf(late)).toBeLessThan(widthOf(hold));
    expect(widthOf(late)).toBeCloseTo(widthOf(early) * 0.5, 6);
  });

  test('side -1 mirrors side 1', () => {
    const right = createRecordCtx();
    const left = createRecordCtx();
    const dark = segAt().dark;
    const road = segmentColors(PALETTES.beach, dark).road;
    drawForkExitRoad(right.ctx, segAt({ forkExit: { side: 1, t: 0.4 } }), PALETTES.beach);
    drawForkExitRoad(left.ctx, segAt({ forkExit: { side: -1, t: 0.4 } }), PALETTES.beach);
    const centreOf = (rec: Recorder): number => {
      const edge = firstEdgeOf(rec, road) as { x1: number; x2: number };
      return (edge.x1 + edge.x2) / 2;
    };
    const cx = segAt().p1.screen.x;
    expect(centreOf(right) - cx).toBeCloseTo(-(centreOf(left) - cx), 6);
  });
});

describe('drawSegment calls drawForkExitRoad only when the segment carries forkExit', () => {
  const pal = PALETTES.beach;

  test('a plain segment never draws the fork exit road', () => {
    const rec = createRecordCtx();
    const seg = segAt();
    drawSegment(rec.ctx, 1280, seg, pal, 0, 0.1, null);
    const road = segmentColors(pal, seg.dark).road;
    // L'unico asfalto disegnato è quello principale, un solo trapezio.
    expect(rec.ops.filter((op) => op.type === 'fill' && op.fill === road)).toHaveLength(1);
  });

  test('a marked segment draws both the main road and the fork exit road', () => {
    const rec = createRecordCtx();
    const seg = segAt({ forkExit: { side: 1, t: 0.4 } });
    drawSegment(rec.ctx, 1280, seg, pal, 0, 0.1, null);
    const road = segmentColors(pal, seg.dark).road;
    expect(rec.ops.filter((op) => op.type === 'fill' && op.fill === road)).toHaveLength(2);
  });

  test('the alpha is left at one afterwards', () => {
    const rec = createRecordCtx();
    const seg = segAt({ forkExit: { side: 1, t: 0.4 } });
    drawSegment(rec.ctx, 1280, seg, pal, 0, 0.1, null);
    expect(rec.ctx.globalAlpha).toBe(1);
  });
});
