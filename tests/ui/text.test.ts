import { describe, expect, test } from 'vitest';
import { GLYPHS, drawText, measureText } from '../../src/ui/text';

const SUPPORTED = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(''),
  ' ', '.', ',', ':', '!', '?', '-', "'", '"', '/', '<', '>', '^', '+',
];

interface RectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fakeCtx(): CanvasRenderingContext2D & { calls: RectCall[] } {
  const calls: RectCall[] = [];
  return {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ x, y, w, h });
    },
    calls,
  } as unknown as CanvasRenderingContext2D & { calls: RectCall[] };
}

function countOnPixels(glyph: readonly string[]): number {
  return glyph.reduce((n, row) => n + [...row].filter((c) => c === '#').length, 0);
}

describe('bitmap font glyphs', () => {
  test('every supported character has an 8x8 glyph made only of # and .', () => {
    for (const ch of SUPPORTED) {
      const g = GLYPHS[ch];
      expect(g, `missing glyph for ${JSON.stringify(ch)}`).toBeDefined();
      expect(g).toHaveLength(8);
      for (const row of g) {
        expect(row).toHaveLength(8);
        expect(row).toMatch(/^[#.]{8}$/);
      }
    }
  });

  test('there is a fallback glyph for unknown characters', () => {
    expect(GLYPHS['?']).toBeDefined();
  });

  test('there are exactly the 50 supported characters plus the fallback (already counted)', () => {
    expect(new Set(SUPPORTED).size).toBe(50);
    // La riga sopra conta solo il proprio elenco locale: qui si confronta con
    // le chiavi vere di GLYPHS, così un glifo aggiunto o tolto in text.ts
    // (senza toccare SUPPORTED) fa fallire il test invece di passare a vuoto.
    // '?' è già dentro SUPPORTED (è anche un carattere legittimo, non solo il
    // ripiego), quindi GLYPHS non ha una chiave in più oltre ai 50.
    const keys = Object.keys(GLYPHS);
    expect(keys).toHaveLength(50);
    expect(new Set(keys)).toEqual(new Set(SUPPORTED));
  });

  test("'^' is a real up-arrow glyph, not the '?' fallback: the radio's scroll-up indicator", () => {
    // Trovato dalla revisione del binario J: radio.ts disegna '^' per la
    // freccia di scorrimento in alto, ma senza un vero glifo `glyphFor`
    // ricadeva silenziosamente su '?'.
    const caret = GLYPHS['^'];
    expect(caret).toBeDefined();
    expect(caret).not.toBe(GLYPHS['?']);
    expect(caret).not.toEqual(GLYPHS['?']);
    // Punta verso l'alto: almeno un pixel acceso nella metà alta del glifo
    // (righe 0-3 su 8), come una freccia che sale ci si aspetta abbia.
    const topHalfLit = (caret ?? []).slice(0, 4).some((row) => row.includes('#'));
    expect(topHalfLit).toBe(true);
  });
});

describe('measureText', () => {
  test('width is 8 pixels per character times scale', () => {
    expect(measureText('TEB', 1)).toBe(24);
    expect(measureText('TEB', 3)).toBe(72);
    expect(measureText('', 4)).toBe(0);
  });
});

describe('drawText', () => {
  test('draws one filled rect per lit pixel, left-aligned at (x, y)', () => {
    const ctx = fakeCtx();
    drawText(ctx, 'I', 10, 20, 2, '#fff');
    const expected = countOnPixels(GLYPHS['I']);
    expect(ctx.calls).toHaveLength(expected);
    for (const c of ctx.calls) {
      expect(c.x).toBeGreaterThanOrEqual(10);
      expect(c.y).toBeGreaterThanOrEqual(20);
      expect(c.w).toBe(2);
      expect(c.h).toBe(2);
    }
  });

  test('unknown characters fall back to the ? glyph without throwing', () => {
    const ctx = fakeCtx();
    expect(() => drawText(ctx, '@', 0, 0, 1, '#fff')).not.toThrow();
    expect(ctx.calls).toHaveLength(countOnPixels(GLYPHS['?']));
  });

  test('lowercase letters map to the same glyph as uppercase', () => {
    const ctxLower = fakeCtx();
    const ctxUpper = fakeCtx();
    drawText(ctxLower, 'a', 0, 0, 1, '#fff');
    drawText(ctxUpper, 'A', 0, 0, 1, '#fff');
    expect(ctxLower.calls).toEqual(ctxUpper.calls);
  });

  test('center alignment centers the text box horizontally on x', () => {
    const ctx = fakeCtx();
    drawText(ctx, 'AA', 100, 0, 1, '#fff', 'center');
    const boxStart = 100 - measureText('AA', 1) / 2; // 92: the left edge of the text box, not necessarily where ink starts
    const minX = Math.min(...ctx.calls.map((c) => c.x));
    const maxX = Math.max(...ctx.calls.map((c) => c.x));
    expect(minX).toBeGreaterThanOrEqual(boxStart);
    expect(maxX).toBeLessThan(boxStart + measureText('AA', 1));
  });

  test('right alignment ends the text at x', () => {
    const ctx = fakeCtx();
    const scale = 2;
    drawText(ctx, 'AB', 50, 0, scale, '#fff', 'right');
    const minX = Math.min(...ctx.calls.map((c) => c.x));
    const maxX = Math.max(...ctx.calls.map((c) => c.x));
    expect(minX).toBeGreaterThanOrEqual(50 - measureText('AB', scale));
    // Il bordo sinistro da solo non basta: un bug che spostasse tutto il
    // testo a sinistra di x lo passerebbe comunque. Il bordo destro va
    // calcolato dal vero glifo di 'B' (ultimo carattere), non da una
    // supposizione sulla larghezza della cella: l'ultima colonna accesa di
    // 'B' è la 5 (indice da 0, `.#####..`).
    const startX = 50 - measureText('AB', scale);
    const glyphB = GLYPHS['B']!;
    const lastLitCol = Math.max(
      ...glyphB.flatMap((row) => [...row].map((c, col) => (c === '#' ? col : -1))),
    );
    const expectedMaxX = startX + 8 * scale + lastLitCol * scale;
    expect(maxX).toBe(expectedMaxX);
    expect(maxX).toBeLessThan(50);
  });

  test('empty string draws nothing and does not throw', () => {
    const ctx = fakeCtx();
    expect(() => drawText(ctx, '', 0, 0, 1, '#fff')).not.toThrow();
    expect(ctx.calls).toHaveLength(0);
  });
});
