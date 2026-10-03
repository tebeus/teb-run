import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { PALETTES } from '../../src/render/palette';
import { LANE_BUFFER, drawSegment, laneOffsets } from '../../src/render/road';
import { renderSprites } from '../../src/render/sprites';
import { LANES } from '../../src/render/project';
import type { AssetStore, Segment, SpriteAsset } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeSegment } from '../helpers/segments';

function projected(over: Partial<Segment> = {}): Segment {
  const seg = makeSegment(10, { clip: LOGICAL_H, dark: false, ...over });
  seg.p1.camera.z = 2000;
  seg.p2.camera.z = 2200;
  seg.p1.screen = { x: 640, y: 600, w: 100, scale: 0.0003 };
  seg.p2.screen = { x: 640, y: 560, w: 96, scale: 0.00028 };
  return seg;
}

const store = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w: 512,
    h: 512,
    entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

const opts = () => ({ assets: store(), timeLeft: 60 });
/** I `moveTo` dei quadrilateri riempiti con un colore. */
const startsOf = (rec: ReturnType<typeof createRecordCtx>, colour: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < rec.ops.length; i++) {
    if (rec.ops[i].type !== 'fill' || rec.ops[i].fill !== colour) continue;
    for (let k = i; k >= 0; k--) {
      if (rec.ops[k].type === 'moveTo') {
        out.push(rec.ops[k].args[0]);
        break;
      }
    }
  }
  return out;
};

describe('laneOffsets (spec §4.4)', () => {
  test('one carriageway keeps the three markers of a four lane road', () => {
    const out = [0, 0, 0, 0, 0, 0];
    expect(laneOffsets(1, 0, LANES, out)).toBe(3);
    expect(out[0]).toBeCloseTo(-0.5, 12);
    expect(out[1]).toBeCloseTo(0, 12);
    expect(out[2]).toBeCloseTo(0.5, 12);
  });

  test('a widened road without an island still has one carriageway', () => {
    const out = [0, 0, 0, 0, 0, 0];
    expect(laneOffsets(1.9, 0, LANES, out)).toBe(3);
    expect(out[2]).toBeCloseTo(0.95, 12);
  });

  test('two carriageways get four lanes each', () => {
    const out = [0, 0, 0, 0, 0, 0];
    expect(laneOffsets(2.8, 0.8, LANES, out)).toBe(6);
    expect(out[0]).toBeCloseTo(-1.3, 12);
    expect(out[1]).toBeCloseTo(-1.8, 12);
    expect(out[2]).toBeCloseTo(-2.3, 12);
    expect(out[3]).toBeCloseTo(1.3, 12);
    expect(out[4]).toBeCloseTo(1.8, 12);
    expect(out[5]).toBeCloseTo(2.3, 12);
  });

  test('every marker sits inside its own carriageway', () => {
    const out = [0, 0, 0, 0, 0, 0];
    const n = laneOffsets(2.8, 0.8, LANES, out);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(out[i])).toBeGreaterThan(0.8);
      expect(Math.abs(out[i])).toBeLessThan(2.8);
    }
  });

  test('the shared buffer is big enough for three lanes', () => {
    expect(LANE_BUFFER.length).toBeGreaterThanOrEqual(2 * (LANES - 1));
  });
});

describe('drawSegment sulla strada divisa (spec §4.4)', () => {
  test('a normal segment paints one asphalt quad', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, LOGICAL_W, projected(), PALETTES.beach, 0, 0.1, opts());
    expect(startsOf(rec, PALETTES.beach.roadLight)).toHaveLength(1);
  });

  test('a split segment paints two asphalt quads, left and right', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, LOGICAL_W, projected({ roadHalf: 2.8, median: 0.8 }), PALETTES.beach, 0, 0.1, opts());
    const starts = startsOf(rec, PALETTES.beach.roadLight);
    expect(starts).toHaveLength(2);
    // Il primo quadrilatero parte dal bordo interno sinistro, il secondo dal destro.
    expect(starts[0]).toBeCloseTo(640 - 100 * 0.8, 6);
    expect(starts[1]).toBeCloseTo(640 + 100 * 0.8, 6);
  });

  test('a widened segment without an island stays one road', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, LOGICAL_W, projected({ roadHalf: 1.9, median: 0 }), PALETTES.beach, 0, 0.1, opts());
    expect(startsOf(rec, PALETTES.beach.roadLight)).toHaveLength(1);
  });

  test('the island is painted with the ground colours, never on a normal segment', () => {
    const split = createRecordCtx();
    drawSegment(split.ctx, LOGICAL_W, projected({ roadHalf: 2.8, median: 0.8 }), PALETTES.beach, 0, 0.1, opts());
    // Terreno della fascia (fillRect) più isola (fill di un quadrilatero).
    expect(split.ops.some((op) => op.type === 'fill' && op.fill === PALETTES.beach.grassLight)).toBe(true);

    const plain = createRecordCtx();
    drawSegment(plain.ctx, LOGICAL_W, projected(), PALETTES.beach, 0, 0.1, opts());
    expect(plain.ops.some((op) => op.type === 'fill' && op.fill === PALETTES.beach.grassLight)).toBe(false);
  });

  // Le tre prove sotto usano `desert`, non `beach`: in beach (e in alpine,
  // farm, town) `rumbleLight` e `lane` sono entrambi '#ffffff' (vedi lo
  // stesso accorgimento in tests/render/road-texture.test.ts), quindi
  // `startsOf` non potrebbe distinguere un cordolo da una linea di corsia.

  test('the outer kerbs follow the widened edge', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, LOGICAL_W, projected({ roadHalf: 2.8, median: 0.8 }), PALETTES.desert, 0, 0.1, opts());
    const starts = startsOf(rec, PALETTES.desert.rumbleLight);
    // Due cordoli esterni più due interni, e i due esterni stanno oltre 2.8.
    expect(starts.length).toBe(4);
    expect(Math.max(...starts)).toBeGreaterThan(640 + 100 * 2.8);
    expect(Math.min(...starts)).toBeLessThan(640 - 100 * 2.8);
  });

  test('a normal segment has only the two outer kerbs', () => {
    const rec = createRecordCtx();
    drawSegment(rec.ctx, LOGICAL_W, projected(), PALETTES.desert, 0, 0.1, opts());
    expect(startsOf(rec, PALETTES.desert.rumbleLight)).toHaveLength(2);
  });

  test('a split segment draws six lane markers, a normal one three', () => {
    const split = createRecordCtx();
    drawSegment(split.ctx, LOGICAL_W, projected({ roadHalf: 2.8, median: 0.8 }), PALETTES.desert, 0, 0.1, opts());
    expect(startsOf(split, PALETTES.desert.lane)).toHaveLength(6);

    const plain = createRecordCtx();
    drawSegment(plain.ctx, LOGICAL_W, projected(), PALETTES.desert, 0, 0.1, opts());
    expect(startsOf(plain, PALETTES.desert.lane)).toHaveLength(3);
  });

  // Come sopra: `desert`, non `beach`, perché in beach `rumbleLight` e `lane`
  // sono entrambi '#ffffff' e i due cordoli esterni si confonderebbero con
  // le linee di corsia.
  test('a three lane stage draws two markers, a four lane one three', () => {
    const three = createRecordCtx();
    drawSegment(three.ctx, LOGICAL_W, projected(), PALETTES.desert, 0, 0.1, {
      assets: store(),
      timeLeft: 60,
      lanes: 3,
    });
    expect(startsOf(three, PALETTES.desert.lane)).toHaveLength(2);

    const four = createRecordCtx();
    drawSegment(four.ctx, LOGICAL_W, projected(), PALETTES.desert, 0, 0.1, {
      assets: store(),
      timeLeft: 60,
      lanes: 4,
    });
    expect(startsOf(four, PALETTES.desert.lane)).toHaveLength(3);
  });
});

describe('renderSprites sulla strada divisa (spec §4.4)', () => {
  test('a roadside sprite follows the outer edge, one on the asphalt does not', () => {
    const outer = projected({ roadHalf: 2.8, median: 0.8, sprites: [{ name: 'beach_palm_1', offset: 1.5 }] });
    const inner = projected({ roadHalf: 2.8, median: 0.8, sprites: [{ name: 'common_barrier', offset: 0 }] });
    const a = createRecordCtx();
    const b = createRecordCtx();
    renderSprites(a.ctx, [outer], store(), LOGICAL_W, LOGICAL_H);
    renderSprites(b.ctx, [inner], store(), LOGICAL_W, LOGICAL_H);
    const palm = a.ops.find((op) => op.type === 'drawImage' && op.image === 'beach_palm_1');
    const barrier = b.ops.find((op) => op.type === 'drawImage' && op.image === 'common_barrier');
    expect(palm).toBeDefined();
    expect(barrier).toBeDefined();
    // La palma è a 1.5 + (2.8 - 1) = 3.3 semilarghezze, la barriera resta al centro.
    expect(palm!.args[4]).toBeGreaterThan(640);
    expect(barrier!.args[4]).toBeLessThan(640);
    expect(palm!.args[4]).toBeGreaterThan(barrier!.args[4] + 100 * 2);
  });

  test('outside the zone the sprite is where it has always been', () => {
    const plain = projected({ sprites: [{ name: 'beach_palm_1', offset: 1.5 }] });
    const rec = createRecordCtx();
    renderSprites(rec.ctx, [plain], store(), LOGICAL_W, LOGICAL_H);
    const palm = rec.ops.find((op) => op.type === 'drawImage' && op.image === 'beach_palm_1');
    expect(palm).toBeDefined();
  });
});
