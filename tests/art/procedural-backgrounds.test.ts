import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { BACKGROUNDS, profileAt } from '../../src/art/procedural/backgrounds';
import { drawnBounds } from '../helpers/fakeCtx';

const NAMES = [
  'bg_beach_far',
  'bg_beach_near',
  'bg_desert_far',
  'bg_desert_near',
  'bg_alpine_far',
  'bg_alpine_near',
  'bg_farm_far',
  'bg_farm_near',
  'bg_town_far',
  'bg_town_near',
];

describe('strisce di parallasse', () => {
  test('ci sono tutte e dieci e sono nel catalogo', () => {
    expect(Object.keys(BACKGROUNDS).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) expect(CATALOG[name], name).toBeDefined();
  });

  test('il profilo è periodico su t: il bordo destro combacia col sinistro', () => {
    for (const kind of ['wave', 'mesa', 'peaks', 'skyline'] as const) {
      expect(profileAt(kind, 0, 3, 0.2)).toBeCloseTo(profileAt(kind, 1, 3, 0.2), 6);
    }
  });

  test('il profilo resta in [-1, 1]', () => {
    for (const kind of ['wave', 'mesa', 'peaks', 'skyline'] as const) {
      for (let i = 0; i <= 200; i += 1) {
        const v = profileAt(kind, i / 200, 4, 0.37);
        expect(v, `${kind} @ ${i}`).toBeGreaterThanOrEqual(-1.0001);
        expect(v, `${kind} @ ${i}`).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  test.each(NAMES)('%s lascia trasparente la fascia di cielo', (name) => {
    const b = drawnBounds(BACKGROUNDS[name], 2048, 260);
    expect(b.transformed, name).toBe(false);
    expect(b.minY, `${name} tocca il cielo`).toBeGreaterThanOrEqual(260 * 0.08);
    const fullHeight = b.ctx.ops.filter(
      (o) => o.type === 'fillRect' && o.args[1] <= 0 && o.args[1] + o.args[3] >= 260,
    );
    expect(fullHeight, `${name} riempie tutta l'altezza`).toEqual([]);
  });

  test.each(NAMES)('%s copre tutta la larghezza e arriva in fondo', (name) => {
    const b = drawnBounds(BACKGROUNDS[name], 2048, 260);
    expect(b.minX, name).toBeLessThanOrEqual(0);
    expect(b.maxX, name).toBeGreaterThanOrEqual(2048);
    expect(b.maxY, name).toBeGreaterThanOrEqual(260);
  });
});
