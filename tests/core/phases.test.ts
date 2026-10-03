import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  FIRST_STAGE,
  PHASE_CARS,
  PHASE_THEMES,
  backgroundRank,
  groupOf,
  isInitial,
  neededFor,
  successorIds,
} from '../../src/core/phases';
import { ALL_CARS } from '../../src/game/car';
import { REAL_GRAPH, STAGES, THEME_ROAD } from '../../src/game/stages';
import { NO_ART } from '../helpers/art';

const MANIFEST_KEYS = Object.keys(JSON.parse(readFileSync('public/sprites/manifest.json', 'utf8')) as Record<string, unknown>);

describe('groupOf', () => {
  test('each kind of file lands in its group', () => {
    expect(groupOf('alpine_pine_1')).toEqual({ kind: 'theme', theme: 'alpine' });
    expect(groupOf('bg_beach_far')).toEqual({ kind: 'theme', theme: 'beach' });
    expect(groupOf('ground_town')).toEqual({ kind: 'theme', theme: 'town' });
    expect(groupOf('bg_3-1_far')).toEqual({ kind: 'stage', stage: '3-1' });
    expect(groupOf('player_straight')).toEqual({ kind: 'car', car: 'new', preview: true });
    expect(groupOf('player_spin_2')).toEqual({ kind: 'car', car: 'new', preview: false });
    expect(groupOf('player_retro_left1')).toEqual({ kind: 'car', car: 'retro', preview: false });
    expect(groupOf('player_super_straight')).toEqual({ kind: 'car', car: 'super', preview: true });
    expect(groupOf('ending_4')).toEqual({ kind: 'late' });
    expect(groupOf('ending_border')).toEqual({ kind: 'late' });
    for (const key of ['asphalt', 'ground_dirt_road', 'ground_snow_road', 'wall_seawall', 'traffic_bus', 'title_logo', 'radio_panel', 'map_full', 'screen_attract', 'transition_wipe']) {
      expect(groupOf(key), key).toEqual({ kind: 'shared' });
    }
  });

  test('the themes and cars of the module are those of the game', () => {
    expect([...PHASE_THEMES].sort()).toEqual(Object.keys(THEME_ROAD).sort());
    expect([...PHASE_CARS]).toEqual([...ALL_CARS]);
  });

  test('every theme-prefixed file of the manifest belongs to its theme', () => {
    for (const key of MANIFEST_KEYS) {
      const theme = PHASE_THEMES.find((t) => key.startsWith(`${t}_`));
      if (theme) expect(groupOf(key), key).toEqual({ kind: 'theme', theme });
    }
  });
});

describe('initial phase', () => {
  test('FIRST_STAGE is the first stage of the real graph', () => {
    const first = REAL_GRAPH.first();
    expect(FIRST_STAGE).toEqual({ id: first.id, theme: first.theme });
  });

  test.skipIf(NO_ART)('the first stage with the chosen car, every car preview, nothing of other themes or endings', () => {
    const initial = MANIFEST_KEYS.filter((key) => isInitial(key, FIRST_STAGE, 'sport'));
    expect(initial).toContain('title_logo');
    expect(initial).toContain('screen_attract');
    expect(initial).toContain('radio_panel');
    expect(initial).toContain('beach_palm_1');
    expect(initial).toContain('bg_beach_far');
    expect(initial).toContain('player_sport_spin_3');
    expect(initial).toContain('player_retro_straight');
    expect(initial).toContain('player_straight');
    expect(initial).not.toContain('player_spin_3');
    expect(initial).not.toContain('alpine_pine_1');
    expect(initial).not.toContain('bg_town_near');
    expect(initial).not.toContain('bg_3-1_far');
    expect(initial.some((key) => key.startsWith('ending_'))).toBe(false);
    expect(initial.length).toBeLessThan(MANIFEST_KEYS.length * 0.7);
  });

  test('neededFor a stage: shared, its theme, its own background and the car', () => {
    const stage = { id: '3-1', theme: 'alpine' };
    expect(neededFor('alpine_cow', stage, 'new')).toBe(true);
    expect(neededFor('bg_3-1_far', stage, 'new')).toBe(true);
    expect(neededFor('bg_4-1_far', stage, 'new')).toBe(false);
    expect(neededFor('beach_hut', stage, 'new')).toBe(false);
    expect(neededFor('traffic_van', stage, 'new')).toBe(true);
    expect(neededFor('player_brake', stage, 'new')).toBe(true);
    expect(neededFor('player_retro_brake', stage, 'new')).toBe(false);
    expect(neededFor('ending_1', stage, 'new')).toBe(false);
  });
});

describe('successors and background order', () => {
  test('the two stages after a fork are those of the graph', () => {
    for (const stage of STAGES.values()) {
      const left = REAL_GRAPH.next(stage, 'L');
      const right = REAL_GRAPH.next(stage, 'R');
      expect(successorIds(stage.id), stage.id).toEqual(left && right ? [left.id, right.id] : []);
    }
    expect(successorIds('nonsense')).toEqual([]);
  });

  test('cars first, then themes by level, endings last', () => {
    const level = { beach: 0, desert: 1, alpine: 2, farm: 2, town: 3 };
    expect(backgroundRank('player_retro_spin_0', level)).toBeLessThan(backgroundRank('desert_cactus_1', level));
    expect(backgroundRank('desert_cactus_1', level)).toBeLessThan(backgroundRank('town_tower', level));
    expect(backgroundRank('bg_2-0_far', level)).toBeLessThan(backgroundRank('bg_4-4_far', level));
    expect(backgroundRank('town_tower', level)).toBeLessThan(backgroundRank('ending_1', level));
  });
});
