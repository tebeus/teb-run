import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { STAGE_LIST, stageById } from '../../src/game/stages';
import {
  buildTrack,
  FORK_EXIT_SEGMENTS,
  FORK_ZONE_SEGMENTS,
  INTRO_SEGMENTS,
  LIFE_MIN_GAP,
  LIFE_OFFSET_MAX,
  LIFE_OFFSET_MIN,
  SAILBOAT_OFFSET,
  THEME_LIFE,
} from '../../src/game/track';
import type { Segment, ThemeId } from '../../src/types';

const NPC_NAMES = [
  'npc_photographer',
  'npc_cyclist',
  'npc_surfer',
  'npc_couple',
  'npc_dog',
  'npc_sheep',
] as const;

const placed = (segs: readonly Segment[], names: readonly string[]): { i: number; name: string; offset: number }[] =>
  segs.flatMap((seg, i) =>
    seg.sprites.filter((p) => names.includes(p.name)).map((p) => ({ i, name: p.name, offset: p.offset })),
  );

describe('vita a bordo strada (spec §13)', () => {
  test('every theme has a list, and every name in it is a non-solid catalog entry', () => {
    for (const theme of ['beach', 'desert', 'alpine', 'farm', 'town'] as ThemeId[]) {
      const life = THEME_LIFE[theme];
      expect(life.names.length, theme).toBeGreaterThan(0);
      expect(life.density, theme).toBeGreaterThan(0);
      expect(life.density, theme).toBeLessThan(0.05);
      for (const name of life.names) {
        expect(CATALOG[name], `${theme}/${name}`).toBeDefined();
        expect(CATALOG[name].solid, `${theme}/${name}`).toBe(false);
      }
    }
  });

  test('sheep only graze in the farm and in the mountains, surfers only on the beach', () => {
    expect(THEME_LIFE.farm.names).toContain('npc_sheep');
    expect(THEME_LIFE.alpine.names).toContain('npc_sheep');
    expect(THEME_LIFE.beach.names).not.toContain('npc_sheep');
    expect(THEME_LIFE.town.names).not.toContain('npc_sheep');
    expect(THEME_LIFE.beach.names).toContain('npc_surfer');
    expect(THEME_LIFE.desert.names).not.toContain('npc_surfer');
  });

  test('the same name never comes back within LIFE_MIN_GAP segments', () => {
    expect(LIFE_MIN_GAP).toBe(60);
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const last = new Map<string, number>();
      for (const { i, name } of placed(segs, NPC_NAMES)) {
        const before = last.get(name);
        if (before !== undefined) {
          expect(i - before, `${stage.id} ${name} a ${before} e ${i}`).toBeGreaterThanOrEqual(LIFE_MIN_GAP);
        }
        last.set(name, i);
      }
    }
  });

  test('they stand just outside the asphalt, never on it, never far away', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (const { offset, name } of placed(segs, NPC_NAMES)) {
        expect(Math.abs(offset), `${stage.id} ${name}`).toBeGreaterThanOrEqual(LIFE_OFFSET_MIN);
        expect(Math.abs(offset), `${stage.id} ${name}`).toBeLessThanOrEqual(LIFE_OFFSET_MAX);
      }
    }
  });

  test('nobody stands in the intro straight or in the fork zone', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (const { i, name } of placed(segs, NPC_NAMES)) {
        expect(i, `${stage.id} ${name}`).toBeGreaterThanOrEqual(INTRO_SEGMENTS);
        expect(i, `${stage.id} ${name}`).toBeLessThan(zoneStart);
      }
    }
  });

  test('the density is low: fewer than one figure every twenty segments', () => {
    const segs = buildTrack(stageById('0-0'));
    const count = placed(segs, NPC_NAMES).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(segs.length / 20);
  });

  test('roadside life is deterministic from the seed', () => {
    const key = (segs: readonly Segment[]): string =>
      placed(segs, NPC_NAMES)
        .map((x) => `${x.i}:${x.name}:${x.offset.toFixed(4)}`)
        .join('|');
    expect(key(buildTrack(stageById('3-1')))).toBe(key(buildTrack(stageById('3-1'))));
  });

  test('every stage only places names from its own theme list (spec §13)', () => {
    // Come per le barche più sotto, ma sulla vita a bordo strada: non basta
    // che `THEME_LIFE` sia scritto bene (lo controlla il primo test di
    // questo file), serve anche che l'output vero di `buildTrack`, tappa
    // per tappa, non piazzi mai un nome fuori dalla lista del proprio tema.
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const allowed = new Set(THEME_LIFE[stage.theme].names);
      for (const { name } of placed(segs, NPC_NAMES)) {
        expect(allowed.has(name), `${stage.id} ${name}`).toBe(true);
      }
    }
  });
});

describe('barche a vela sull\'acqua (spec §13)', () => {
  test('only the beach has sailboats, and only on water segments, on the water side', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const boats = placed(segs, ['npc_sailboat']);
      if (stage.theme !== 'beach') {
        expect(boats, stage.id).toEqual([]);
        continue;
      }
      for (const { i, offset } of boats) {
        expect(segs[i].water, `${stage.id} seg ${i}`).toBeDefined();
        expect(Math.abs(offset)).toBeCloseTo(SAILBOAT_OFFSET, 10);
        expect(offset < 0 ? 'left' : 'right').toBe(segs[i].water);
      }
    }
  });

  test('at least one beach stage gets a boat: the placement is not dead code', () => {
    const beaches = STAGE_LIST.filter((s) => s.theme === 'beach');
    const total = beaches.reduce((n, s) => n + placed(buildTrack(s), ['npc_sailboat']).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  test('no boat sits in the fork-exit window or in the fork zone, on any of the 15 stages', () => {
    // In entrambe le finestre la geometria della strada può cambiare a
    // runtime (uscita dal bivio, bivio v3) e `road.ts` non disegna l'acqua
    // sul lato scartato: una barca lì finirebbe sulla sabbia (revisione
    // finale del binario I, finding 9).
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (const { i } of placed(segs, ['npc_sailboat'])) {
        expect(i, stage.id).toBeGreaterThanOrEqual(FORK_EXIT_SEGMENTS);
        expect(i, stage.id).toBeLessThan(zoneStart);
      }
    }
  });
});
