import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { ASPHALT_TINT_ALPHA } from '../../src/render/ground';
import { PALETTES, paletteFor, segmentColors } from '../../src/render/palette';
import type { ThemeId } from '../../src/types';

const THEMES: ThemeId[] = ['beach', 'desert', 'alpine', 'farm', 'town'];
const HEX = /^#[0-9a-f]{6}$/;

describe('PALETTES', () => {
  test('there is one palette per theme', () => {
    expect(Object.keys(PALETTES).sort()).toEqual([...THEMES].sort());
  });

  test('every colour is a lowercase 6 digit hex', () => {
    for (const theme of THEMES) {
      const p = PALETTES[theme];
      const colours = [
        ...p.sky,
        p.grassLight,
        p.grassDark,
        p.rumbleLight,
        p.rumbleDark,
        p.roadLight,
        p.roadDark,
        p.lane,
        p.fog,
        p.shoulderLight,
        p.shoulderDark,
        p.waterLight,
        p.waterDark,
        p.asphaltTint,
      ];
      for (const c of colours) expect(c, `${theme}: ${c}`).toMatch(HEX);
    }
  });

  test('the sky gradient has three stops', () => {
    for (const theme of THEMES) expect(PALETTES[theme].sky).toHaveLength(3);
  });

  test('light and dark variants differ', () => {
    for (const theme of THEMES) {
      const p = PALETTES[theme];
      expect(p.grassLight, theme).not.toBe(p.grassDark);
      expect(p.rumbleLight, theme).not.toBe(p.rumbleDark);
      expect(p.roadLight, theme).not.toBe(p.roadDark);
    }
  });

  test('the parallax layer names follow the theme and exist in the catalog', () => {
    for (const theme of THEMES) {
      const p = PALETTES[theme];
      expect(p.bgFar).toBe(`bg_${theme}_far`);
      expect(p.bgNear).toBe(`bg_${theme}_near`);
      expect(CATALOG[p.bgFar], p.bgFar).toBeDefined();
      expect(CATALOG[p.bgNear], p.bgNear).toBeDefined();
    }
  });

  test('paletteFor returns the palette of the theme', () => {
    for (const theme of THEMES) expect(paletteFor(theme)).toBe(PALETTES[theme]);
  });

  test('shoulder and water have distinct light and dark variants', () => {
    for (const theme of THEMES) {
      const p = PALETTES[theme];
      expect(p.shoulderLight, theme).not.toBe(p.shoulderDark);
      expect(p.waterLight, theme).not.toBe(p.waterDark);
    }
  });

  test('the ground, asphalt and cloud tiles follow the theme', () => {
    for (const theme of THEMES) {
      const p = PALETTES[theme];
      expect(p.ground).toBe(`ground_${theme}`);
      expect(p.clouds).toBe(`bg_${theme}_clouds`);
      expect(p.asphalt).toBe('asphalt');
    }
  });

  test('the asphalt tint is a distinct colour per theme, as in spec §4.4a', () => {
    expect(PALETTES.beach.asphaltTint).toBe('#7a7a7a');
    expect(PALETTES.desert.asphaltTint).toBe('#a08a6a');
    expect(PALETTES.alpine.asphaltTint).toBe('#3f5a80');
    expect(PALETTES.farm.asphaltTint).toBe('#53603f');
    expect(PALETTES.town.asphaltTint).toBe('#2e2438');
    const tints = THEMES.map((t) => PALETTES[t].asphaltTint);
    expect(new Set(tints).size).toBe(THEMES.length);
  });

  test('i cinque asfalti finiti sono distinguibili a occhio (task 15)', () => {
    // Colore dell'asfalto come lo vede il giocatore: colore piatto del tema
    // piu il velo di `asphaltTint` con ASPHALT_TINT_ALPHA. La tessera
    // condivisa non entra: e la stessa per tutti e cinque.
    const finished = (theme: ThemeId): number[] => {
      const p = PALETTES[theme];
      const rgb = (hex: string): number[] => {
        const c = Number.parseInt(hex.slice(1), 16);
        return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
      };
      const road = rgb(p.roadLight);
      const tint = rgb(p.asphaltTint);
      return road.map((v, i) => v * (1 - ASPHALT_TINT_ALPHA) + tint[i] * ASPHALT_TINT_ALPHA);
    };
    for (let i = 0; i < THEMES.length; i++) {
      for (let j = i + 1; j < THEMES.length; j++) {
        const a = finished(THEMES[i]);
        const b = finished(THEMES[j]);
        const d = a.reduce((acc, v, k) => acc + Math.abs(v - b[k]), 0);
        expect(d, `${THEMES[i]} vs ${THEMES[j]}`).toBeGreaterThan(40);
      }
    }
  });
});

describe('segmentColors', () => {
  test('light segments use the light variants and draw the lane marker', () => {
    const c = segmentColors(PALETTES.beach, false);
    expect(c.grass).toBe(PALETTES.beach.grassLight);
    expect(c.rumble).toBe(PALETTES.beach.rumbleLight);
    expect(c.road).toBe(PALETTES.beach.roadLight);
    expect(c.lane).toBe(PALETTES.beach.lane);
  });

  test('dark segments use the dark variants and no lane marker', () => {
    const c = segmentColors(PALETTES.beach, true);
    expect(c.grass).toBe(PALETTES.beach.grassDark);
    expect(c.rumble).toBe(PALETTES.beach.rumbleDark);
    expect(c.road).toBe(PALETTES.beach.roadDark);
    expect(c.lane).toBeNull();
  });

  test('a theme without lane markers never returns one', () => {
    expect(PALETTES.alpine.lanes).toBe(false);
    expect(segmentColors(PALETTES.alpine, false).lane).toBeNull();
    expect(segmentColors(PALETTES.alpine, true).lane).toBeNull();
  });

  test('the shoulder alternates light and dark like the rest', () => {
    expect(segmentColors(PALETTES.beach, false).shoulder).toBe(PALETTES.beach.shoulderLight);
    expect(segmentColors(PALETTES.beach, true).shoulder).toBe(PALETTES.beach.shoulderDark);
  });

  test('the water alternates light and dark like the rest', () => {
    expect(segmentColors(PALETTES.town, false).water).toBe(PALETTES.town.waterLight);
    expect(segmentColors(PALETTES.town, true).water).toBe(PALETTES.town.waterDark);
  });
});
