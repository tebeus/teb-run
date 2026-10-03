import { describe, expect, test } from 'vitest';
import { STAGE_LIST, stageById } from '../../src/game/stages';
import {
  backdropForStageId,
  needsTransition,
  NO_BACKDROP,
  PALETTES,
  paletteFor,
  paletteForStage,
  paletteForStageId,
  STAGE_BACKDROPS,
  STAGE_PALETTES,
  TRANSITION_KEYS,
} from '../../src/render/palette';
import type { ThemeId } from '../../src/types';

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const rgb = (hex: string): [number, number, number] => {
  const c = Number.parseInt(hex.slice(1), 16);
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
};
/** Distanza fra due colori: somma degli scarti per canale. */
const dist = (a: string, b: string): number => {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
};
/** Distanza fra due palette: la massima fra i tre stop di cielo e la tinta d'asfalto. */
const paletteDistance = (a: ReturnType<typeof paletteFor>, b: ReturnType<typeof paletteFor>): number =>
  Math.max(
    dist(a.sky[0], b.sky[0]),
    dist(a.sky[1], b.sky[1]),
    dist(a.sky[2], b.sky[2]),
    dist(a.asphaltTint, b.asphaltTint),
  );

describe('scostamenti di palette per tappa (spec §4.4f)', () => {
  test('the five theme palettes are not touched: no override is written into PALETTES', () => {
    // I valori del binario H, copiati qui a mano: se qualcuno modifica
    // `PALETTES` invece di `STAGE_PALETTES`, questo test cade.
    expect(PALETTES.beach.sky).toEqual(['#1f6fd0', '#5fb6e8', '#bfe9f7']);
    expect(PALETTES.beach.asphaltTint).toBe('#7a7a7a');
    expect(PALETTES.desert.asphaltTint).toBe('#a08a6a');
    expect(PALETTES.alpine.asphaltTint).toBe('#3f5a80');
    expect(PALETTES.farm.asphaltTint).toBe('#53603f');
    expect(PALETTES.town.asphaltTint).toBe('#2e2438');
  });

  test('every one of the fifteen stages has an override', () => {
    for (const stage of STAGE_LIST) {
      expect(Object.keys(STAGE_PALETTES), `stage ${stage.id}`).toContain(stage.id);
    }
    expect(Object.keys(STAGE_PALETTES)).toHaveLength(STAGE_LIST.length);
  });

  test('every override colour is a six digit hex, and skies have three stops', () => {
    for (const [id, over] of Object.entries(STAGE_PALETTES)) {
      if (over.sky !== undefined) {
        expect(over.sky, `sky of ${id}`).toHaveLength(3);
        for (const stop of over.sky) expect(stop, `sky stop of ${id}`).toMatch(HEX6);
      }
      for (const key of ['fog', 'asphaltTint', 'lane'] as const) {
        const value = over[key];
        if (value !== undefined) expect(value, `${key} of ${id}`).toMatch(HEX6);
      }
    }
  });

  test('an override only replaces the keys it names: the rest comes from the theme', () => {
    const stage = stageById('0-0');
    const pal = paletteForStage(stage);
    const theme = paletteFor('beach');
    // I nomi delle tessere e degli strati non sono mai sovrascritti.
    expect(pal.ground).toBe(theme.ground);
    expect(pal.asphalt).toBe(theme.asphalt);
    expect(pal.bgFar).toBe(theme.bgFar);
    expect(pal.bgNear).toBe(theme.bgNear);
    expect(pal.clouds).toBe(theme.clouds);
    expect(pal.lanes).toBe(theme.lanes);
    expect(pal.waterLight).toBe(theme.waterLight);
  });

  test('no override ever replaces a sprite name or the lanes flag', () => {
    for (const [id, over] of Object.entries(STAGE_PALETTES)) {
      for (const key of ['ground', 'asphalt', 'bgFar', 'bgNear', 'clouds', 'lanes'] as const) {
        expect(over[key], `${key} of ${id}`).toBeUndefined();
      }
    }
  });

  test('a stage with no override, like the demo stage, gets the theme palette untouched', () => {
    expect(paletteForStageId('demo', 'beach')).toEqual(paletteFor('beach'));
    expect(paletteForStage({ ...stageById('0-0'), id: 'demo' })).toEqual(paletteFor('beach'));
  });

  test('two stages of the same theme differ by at least twelve points', () => {
    const byTheme = new Map<ThemeId, typeof STAGE_LIST>();
    for (const stage of STAGE_LIST) {
      const list = byTheme.get(stage.theme) ?? [];
      byTheme.set(stage.theme, [...list, stage]);
    }
    for (const [theme, stages] of byTheme) {
      for (let i = 0; i < stages.length; i++) {
        for (let j = i + 1; j < stages.length; j++) {
          const d = paletteDistance(paletteForStage(stages[i]), paletteForStage(stages[j]));
          expect(d, `${theme}: ${stages[i].id} vs ${stages[j].id}`).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });
});

describe('varianti di sfondo per tappa (STAGE_BACKDROPS)', () => {
  test('every one of the fifteen stages has a variant', () => {
    for (const stage of STAGE_LIST) {
      expect(Object.keys(STAGE_BACKDROPS), `stage ${stage.id}`).toContain(stage.id);
    }
    expect(Object.keys(STAGE_BACKDROPS)).toHaveLength(STAGE_LIST.length);
  });

  test('an id with no entry falls back to NO_BACKDROP, unchanged drawing', () => {
    expect(backdropForStageId('demo')).toEqual(NO_BACKDROP);
    expect(NO_BACKDROP.farFilter).toBe('');
    expect(NO_BACKDROP.veilAlpha).toBe(0);
    expect(NO_BACKDROP.mirrorNear).toBe(false);
    expect(NO_BACKDROP.cloudsAlpha).toBe(1);
  });

  test('two stages of the same theme have different variants', () => {
    const byTheme = new Map<ThemeId, typeof STAGE_LIST>();
    for (const stage of STAGE_LIST) {
      const list = byTheme.get(stage.theme) ?? [];
      byTheme.set(stage.theme, [...list, stage]);
    }
    for (const [theme, stages] of byTheme) {
      for (let i = 0; i < stages.length; i++) {
        for (let j = i + 1; j < stages.length; j++) {
          const a = backdropForStageId(stages[i].id);
          const b = backdropForStageId(stages[j].id);
          const differs =
            a.farFilter !== b.farFilter ||
            a.nearFilter !== b.nearFilter ||
            a.cloudsFilter !== b.cloudsFilter ||
            a.veil !== b.veil ||
            a.veilAlpha !== b.veilAlpha ||
            a.farOffset !== b.farOffset ||
            a.nearOffset !== b.nearOffset ||
            a.cloudsOffset !== b.cloudsOffset ||
            a.mirrorNear !== b.mirrorNear ||
            a.cloudsAlpha !== b.cloudsAlpha;
          expect(differs, `${theme}: ${stages[i].id} vs ${stages[j].id}`).toBe(true);
        }
      }
    }
  });

  test('filters, when present, are valid ctx.filter strings and veil colours are six digit hex', () => {
    const HEX6 = /^#[0-9a-fA-F]{6}$/;
    for (const [id, b] of Object.entries(STAGE_BACKDROPS)) {
      expect(b.veil, id).toMatch(HEX6);
      expect(b.veilAlpha, id).toBeGreaterThanOrEqual(0);
      expect(b.veilAlpha, id).toBeLessThanOrEqual(1);
      expect(b.cloudsAlpha, id).toBeGreaterThan(0);
      for (const f of [b.farFilter, b.nearFilter, b.cloudsFilter]) {
        expect(f === '' || /^[a-z-]+\([^)]*\)( [a-z-]+\([^)]*\))*$/.test(f), `${id}: "${f}"`).toBe(true);
      }
    }
  });
});

describe('needsTransition (deroga 13 del binario K)', () => {
  test('the keys it compares are the ones the transition interpolates', () => {
    expect([...TRANSITION_KEYS].sort()).toEqual(['asphaltTint', 'fog', 'sky']);
  });

  test('two different themes always open a transition', () => {
    expect(needsTransition('0-0', 'beach', '1-0', 'desert')).toBe(true);
  });

  test('two stages of the same theme with different skies open a transition too', () => {
    // 2-0 Red Canyon e 3-3 Salt Flats sono entrambe deserto e hanno
    // cieli molto diversi: senza transizione il cielo salterebbe.
    expect(needsTransition('2-0', 'desert', '3-3', 'desert')).toBe(true);
  });

  test('two ids with no override and the same theme open nothing', () => {
    expect(needsTransition('demo-a', 'beach', 'demo-b', 'beach')).toBe(false);
  });

  test('the same stage twice opens nothing', () => {
    for (const stage of STAGE_LIST) {
      expect(needsTransition(stage.id, stage.theme, stage.id, stage.theme), stage.id).toBe(false);
    }
  });
});
