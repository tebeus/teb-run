import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  FIRST_STAGE,
  PHASE_CARS,
  PHASE_THEMES,
  backgroundRank,
  groupOf,
  isInitial,
  phaseOf,
  TITLE_SPRITES,
  neededFor,
  successorIds,
} from '../../src/core/phases';
import { FIRST_STAGE_SPRITES } from '../../src/core/firstStageSprites';
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

  test.skipIf(NO_ART)('phase 0 is only the title and the radio: their sprites and every car preview', () => {
    const initial = MANIFEST_KEYS.filter((key) => isInitial(key, FIRST_STAGE, 'sport'));
    for (const key of ['title_logo', 'screen_attract', 'radio_panel', 'radio_track_icons', 'menu_cursor', 'player_retro_straight', 'player_straight', 'player_sport_straight']) {
      expect(initial, key).toContain(key);
    }
    for (const key of ['beach_palm_1', 'bg_beach_far', 'player_sport_spin_3', 'traffic_bus', 'map_full', 'asphalt']) {
      expect(initial, key).not.toContain(key);
    }
    expect(initial.every((key) => TITLE_SPRITES.includes(key) || key.endsWith('_straight'))).toBe(true);
  });

  test.skipIf(NO_ART)('phase 1 is the first stage with the chosen car: its theme, what it draws, the effects', () => {
    const phase = (key: string) => phaseOf(key, FIRST_STAGE, 'sport');
    for (const key of ['beach_palm_1', 'bg_beach_far', 'player_sport_spin_3', 'traffic_bus', 'asphalt', 'race_start_lights', 'race_checkpoint', 'fx_sparks', 'fx_grass_spray']) {
      expect(phase(key), key).toBe(1);
    }
    for (const key of ['map_full', 'ground_snow_road', 'race_goal', 'player_spin_3', 'alpine_pine_1', 'bg_town_near', 'bg_3-1_far', 'ending_1', 'transition_sunset']) {
      expect(phase(key), key).toBe(2);
    }
    for (const key of FIRST_STAGE_SPRITES) expect(MANIFEST_KEYS, key).toContain(key);
  });

  test('neededFor a stage: shared, its theme, its own background and the car', () => {
    const stage = { id: '3-1', theme: 'alpine' };
    expect(neededFor('alpine_cow', stage, 'new')).toBe(true);
    expect(neededFor('bg_3-1_far', stage, 'new')).toBe(true);
    expect(neededFor('bg_4-1_far', stage, 'new')).toBe(false);
    expect(neededFor('beach_hut', stage, 'new')).toBe(false);
    expect(neededFor('traffic_van', stage, 'new')).toBe(true);
    // Per le altre tappe ogni file condiviso; per la prima solo i suoi.
    expect(neededFor('ground_snow_road', stage, 'new')).toBe(true);
    expect(neededFor('ground_snow_road', FIRST_STAGE, 'new')).toBe(false);
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
