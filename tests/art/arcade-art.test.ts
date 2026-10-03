import { describe, expect, test } from 'vitest';
import { CATALOG, SPRITE_NAMES } from '../../src/art/catalog';
import { ARCADE_ART } from '../../src/art/procedural/arcade';
import { PROCEDURAL } from '../../src/art/procedural/index';
import { targetSize } from '../../src/core/assets';
import targetsJson from '../../tools/sprite-targets.json';
import { TRAFFIC_NAMES, TRAFFIC_SPEEDS, TRAFFIC_WEIGHTS } from '../../src/game/traffic';
import { createFakeCtx } from '../helpers/fakeCtx';

type Target = { w: number; h: number; frames?: number };
const targets = targetsJson as Record<string, Target>;

const ARCADE = [
  'map_full',
  'radio_track_icons',
  'transition_arrow',
  'transition_sunset',
  'transition_wipe',
  'ending_border',
  'menu_cursor',
] as const;

/** Sportive extra del Set 6: entrate con l'ondata di fix del binario H. */
const SET6 = ['traffic_supercar', 'traffic_roadster', 'traffic_muscle', 'traffic_rally'] as const;

describe('arte della cornice arcade (spec §11, §13)', () => {
  test('ARCADE_ART has exactly the seven frame names', () => {
    expect(Object.keys(ARCADE_ART).sort()).toEqual([...ARCADE].sort());
  });

  test.each(ARCADE)('%s draws at its target size without throwing', (name) => {
    const { w, h } = targetSize(name);
    const ctx = createFakeCtx();
    ARCADE_ART[name](ctx, w, h);
    // Soglia a 2 come nel test degli effetti: la freccia è un `poly`
    // (fill + stroke) più un `fillRect`, il cursore tre `poly` di solo
    // riempimento. Tre `paint` ciascuno, e vanno bene: sono forme semplici.
    expect(ctx.paints, name).toBeGreaterThan(2);
  });

  test('the map is a full-screen illustration, the rest overlays', () => {
    expect(CATALOG.map_full.kind).toBe('illustration');
    expect(targets.map_full).toEqual({ w: 1280, h: 720 });
    for (const name of ARCADE.filter((n) => n !== 'map_full')) {
      expect(CATALOG[name].kind, name).toBe('ui');
      expect(CATALOG[name].anchorY, name).toBe(0.5);
      expect(CATALOG[name].solid, name).toBe(false);
    }
  });

  test('the six names that stay out of the catalog stay out', () => {
    // spec §13: già dentro radio_panel, o con un logo proprio, o senza
    // griglia dichiarata, o rimpiazzate dalla scala a dieci tacche.
    for (const name of ['hud_speed', 'hud_rev_lights', 'map_node', 'radio_knob', 'radio_button', 'screen_title']) {
      expect(CATALOG[name], name).toBeUndefined();
      expect(targets[name], name).toBeUndefined();
    }
  });

  test('none of the sixteen text-only names is in the catalog', () => {
    for (const name of [
      'hud_time',
      'hud_score',
      'hud_lap',
      'hud_stage',
      'hud_gear',
      'hud_digits',
      'hud_colon',
      'hud_banner_extend',
      'hud_ready',
      'hud_go',
      'screen_press_start',
      'screen_game_over',
      'screen_highscore',
      'screen_continue',
      'screen_countdown',
      'screen_course_select',
    ]) {
      expect(CATALOG[name], name).toBeUndefined();
    }
  });
});

describe('le quattro sportive del Set 6: controllo, non lavoro (già in H)', () => {
  // L'ondata di fix del binario H le ha anticipate per intero. Qui si
  // controlla solo che ci siano e che i conteggi tornino: le velocità, i
  // pesi per tema e l'ordine di `TRAFFIC_NAMES` li pinna già
  // `tests/game/traffic-set2.test.ts`, che **non va toccato**.
  test.each(SET6)('%s is a solid car with a target, a drawer and a speed', (name) => {
    expect(CATALOG[name].kind, name).toBe('car');
    expect(CATALOG[name].solid, name).toBe(true);
    expect(CATALOG[name].collideW, name).toBeCloseTo(CATALOG[name].scale * 0.9, 10);
    expect(targets[name], name).toBeDefined();
    expect(PROCEDURAL[name], name).toBeDefined();
    expect(TRAFFIC_SPEEDS[name], name).toBeGreaterThan(0);
  });

  test('the traffic has thirteen types: the truck is out, the four sports cars are in', () => {
    // `traffic_truck` resta nel catalogo (i ripieghi e la copertura lo
    // vogliono) ma è fuori dallo spawn: lo sprite consegnato è deformato.
    expect(TRAFFIC_NAMES).toHaveLength(13);
    expect(TRAFFIC_NAMES).not.toContain('traffic_truck');
    expect(TRAFFIC_SPEEDS.traffic_truck).toBeUndefined();
    expect(CATALOG.traffic_truck, 'il camion resta in catalogo').toBeDefined();
    for (const theme of ['beach', 'desert', 'alpine', 'farm', 'town'] as const) {
      for (const name of TRAFFIC_NAMES) {
        expect(TRAFFIC_WEIGHTS[theme][name], `${theme}/${name}`).toBeGreaterThan(0);
      }
      expect(TRAFFIC_WEIGHTS[theme].traffic_truck, theme).toBeUndefined();
    }
  });

  test('the seven arcade names raise the catalog to 161 and the targets to 148; Set 7 brings them to 177 and 173, v2 the targets to 183, ending_classic_1 to 178 and 184, retro and sport to 198 and 204, super to 208 and 214', () => {
    // Set 7: le due tessere di superficie (+2 nomi, +2 target) e i dieci
    // frame del giocatore come file singoli (+9 target: `player_brake`
    // c'era già), più l'auto classica selezionabile: dieci frame
    // `player_classic_*` e quattro `ending_classic_*` (+14 e +14).
    // Consegna v2: dieci sfondi lontani di tappa, solo target (+10), fuori
    // dal catalogo.
    // Fix: anche il finale 1 ha una versione per l'auto classica (+1 e +1).
    // Auto retrò e sportiva: dieci frame ciascuna (+20 e +20).
    // Supercar: altri dieci frame (+10 e +10).
    expect(SPRITE_NAMES).toHaveLength(208);
    expect(Object.keys(targets)).toHaveLength(214);
  });
});
