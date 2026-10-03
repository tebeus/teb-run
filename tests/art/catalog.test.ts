import { describe, expect, test } from 'vitest';
import { CATALOG, PROCEDURAL_ONLY, SPRITE_NAMES, STRIPS, WIDE_ROAD_FACTOR } from '../../src/art/catalog';
import { STAGE_BG_NAMES } from '../../src/core/assets';
import targetsJson from '../../tools/sprite-targets.json';

type Target = { w: number; h: number; frames?: number };
const targets = targetsJson as Record<string, Target>;

/** Nomi logici coperti da un file: i frame della strip, o il file stesso. */
const namesOf = (file: string): string[] => STRIPS[file] ?? [file];

/**
 * Sfondi facoltativi di tappa (`bg_<id>_far`, consegna v2): hanno un target
 * perché `process-sprites.py` li lavori, ma stanno fuori dal catalogo di
 * proposito (`STAGE_BG_NAMES` in `core/assets.ts`), che non li richiede.
 */
const isStageBg = (file: string): boolean => STAGE_BG_NAMES.includes(file);

describe('sprite catalog vs sprite-targets.json', () => {
  test('there are exactly 214 target files after the v2 delivery, ending_classic_1 and the retro, sport and super cars', () => {
    // 148 dopo il Set 5, più i dieci frame singoli del giocatore (Set 7,
    // `player_brake` c'era già), le due tessere di superficie e i
    // quattordici dell'auto classica (dieci frame, quattro finali): 173.
    // La consegna v2 aggiunge dieci sfondi lontani di tappa: 183. Il fix
    // dell'auto classica sul finale 1 aggiunge `ending_classic_1`: 184.
    // Retrò e sportiva, dieci frame ciascuna: 204. Supercar, altri dieci: 214.
    expect(Object.keys(targets)).toHaveLength(214);
    expect(Object.keys(targets).filter(isStageBg)).toHaveLength(10);
  });

  test('stage backgrounds have a target but no catalog entry, and ship exact (no trim)', () => {
    for (const [file, t] of Object.entries(targets)) {
      if (!isStageBg(file)) continue;
      expect(CATALOG[file], file).toBeUndefined();
      expect(t.w, file).toBe(2048);
      expect((t as { trim?: boolean }).trim, file).toBe(false);
    }
  });

  test('every target file maps to catalog names', () => {
    for (const [file, t] of Object.entries(targets)) {
      if (isStageBg(file)) continue;
      const names = namesOf(file);
      if (t.frames) expect(STRIPS[file]).toHaveLength(t.frames);
      for (const n of names) expect(CATALOG[n], `missing catalog entry for ${n}`).toBeDefined();
    }
  });

  test('every catalog name has a target file or is procedural-only', () => {
    const covered = new Set(Object.keys(targets).flatMap(namesOf));
    for (const n of SPRITE_NAMES) {
      expect(covered.has(n) || PROCEDURAL_ONLY.has(n), `${n} has no PNG target and is not procedural-only`).toBe(true);
    }
  });

  test('procedural-only names are in the catalog and have no target', () => {
    for (const n of PROCEDURAL_ONLY) {
      expect(CATALOG[n]).toBeDefined();
      expect(targets[n]).toBeUndefined();
    }
  });

  test('SPRITE_NAMES matches CATALOG keys', () => {
    expect([...SPRITE_NAMES].sort()).toEqual(Object.keys(CATALOG).sort());
  });

  test('scales and collision widths are sane', () => {
    for (const [n, e] of Object.entries(CATALOG)) {
      expect(e.scale, n).toBeGreaterThan(0);
      expect(e.scale, n).toBeLessThanOrEqual(3);
      expect(e.collideW, n).toBeGreaterThanOrEqual(0);
      expect(e.collideW, n).toBeLessThanOrEqual(e.scale);
      if (!e.solid) expect(e.collideW, n).toBe(0);
      expect(e.anchorY, n).toBeGreaterThanOrEqual(0);
      expect(e.anchorY, n).toBeLessThanOrEqual(1);
    }
  });

  test('player has 3 left frames, 2 right frames, 4 spin frames and a brake frame', () => {
    expect(STRIPS['player_strip_turn']).toEqual(['player_straight', 'player_left1', 'player_left2']);
    expect(STRIPS['player_strip_turn_right']).toEqual(['player_right1', 'player_right2']);
    expect(STRIPS['player_strip_spin']).toEqual(['player_spin_0', 'player_spin_1', 'player_spin_2', 'player_spin_3']);
    expect(CATALOG['player_brake'].kind).toBe('player');
    expect(targets['player_strip_turn_right']).toEqual({ w: 320, h: 200, frames: 2 });
  });

  test('the two extra traffic cars are cars with a rear-view target', () => {
    for (const n of ['traffic_coupe', 'traffic_offroad']) {
      expect(CATALOG[n].kind).toBe('car');
      expect(CATALOG[n].solid).toBe(true);
      expect(targets[n]).toBeDefined();
    }
  });

  test('the six tiles of spec §13 are textures with a 512x512 target', () => {
    for (const n of ['ground_beach', 'ground_desert', 'ground_alpine', 'ground_farm', 'ground_town', 'asphalt']) {
      expect(CATALOG[n], n).toBeDefined();
      expect(CATALOG[n].kind, n).toBe('texture');
      expect(CATALOG[n].solid, n).toBe(false);
      expect(targets[n], n).toEqual({ w: 512, h: 512 });
    }
  });

  test('the seven walls of spec §13 are 256x256 wall tiles', () => {
    for (const k of ['rock_red', 'rock_grey', 'guardrail', 'seawall', 'hedge', 'bridge_rail', 'town_facades']) {
      const n = `wall_${k}`;
      expect(CATALOG[n], n).toBeDefined();
      expect(CATALOG[n].kind, n).toBe('wall');
      // Il guard-rail del Set 7 è consegnato 256x130, fra i centri di due
      // paletti; la roccia grigia è una tessera piena, da tenere intera.
      const { w, h } = targets[n];
      expect({ w, h }, n).toEqual(k === 'guardrail' ? { w: 256, h: 130 } : { w: 256, h: 256 });
    }
  });

  test('the five cloud strips are 2048x256 backgrounds', () => {
    for (const theme of ['beach', 'desert', 'alpine', 'farm', 'town']) {
      const n = `bg_${theme}_clouds`;
      expect(CATALOG[n].kind, n).toBe('background');
      // `trim: false`: consegnate alla misura esatta, i bordi vuoti tengono
      // la cucitura e la quota nel cielo.
      expect(targets[n], n).toEqual({ w: 2048, h: 256, trim: false });
    }
  });

  test('the three ground details are procedural only and never solid', () => {
    for (const n of ['ground_tuft', 'ground_stone', 'ground_crack']) {
      expect(PROCEDURAL_ONLY.has(n), n).toBe(true);
      expect(CATALOG[n].solid, n).toBe(false);
      expect(targets[n], n).toBeUndefined();
    }
  });

  test('the scenery keeps the screen size it had on the narrow road (spec §4.4)', () => {
    expect(WIDE_ROAD_FACTOR).toBeCloseTo(2000 / 2600, 12);
    // Le due misure che la spec §4.4 cita per nome.
    expect(CATALOG.beach_palm_1.scale).toBeCloseTo(0.55 * WIDE_ROAD_FACTOR, 10);
    expect(CATALOG.beach_palm_1.scale).toBeCloseTo(0.42, 2);
    expect(CATALOG.common_billboard.scale).toBeCloseTo(0.65 * WIDE_ROAD_FACTOR, 10);
    expect(CATALOG.common_billboard.scale).toBeCloseTo(0.5, 2);
  });

  test('every solid scenery keeps hit box and size in proportion', () => {
    for (const [name, entry] of Object.entries(CATALOG)) {
      if (entry.kind !== 'scenery' || !entry.solid) continue;
      expect(entry.collideW, name).toBeLessThanOrEqual(entry.scale);
      expect(entry.collideW, name).toBeGreaterThan(0);
    }
  });

  test('the three spectators of Set 4 are scenery with a target (spec §13)', () => {
    for (const n of ['beach_bathers', 'common_crowd', 'common_flagman']) {
      expect(CATALOG[n], n).toBeDefined();
      expect(CATALOG[n].kind, n).toBe('scenery');
      expect(targets[n], n).toBeDefined();
    }
    // Solo l'uomo con la bandiera è solido, e stretto.
    expect(CATALOG.common_crowd.solid).toBe(false);
    expect(CATALOG.beach_bathers.solid).toBe(false);
    expect(CATALOG.common_flagman.solid).toBe(true);
    expect(CATALOG.common_flagman.collideW).toBeLessThan(CATALOG.common_flagman.scale);
  });

  test('gli spettatori sono alti come persone, non come capanne (task 15)', () => {
    // Altezza a schermo rapportata all'auto del giocatore. Il riferimento
    // resta il frame di prima, 320x200: 233 px per 146, circa 1,16 m. La
    // cabrio del Set 7 (frame 274x200) è alta 170 px con le teste dei
    // passeggeri, ma le soglie misurano una persona contro un'auto vera,
    // non contro il PNG.
    // Le misure dei PNG veri sono quelle di `public/sprites`.
    const carH = CATALOG.player_straight.scale * (200 / 320);
    const ratio = (name: string, pngW: number, pngH: number): number =>
      (CATALOG[name].scale * (pngH / pngW)) / carH;
    expect(ratio('beach_bathers', 287, 300)).toBeGreaterThan(1.3);
    expect(ratio('beach_bathers', 287, 300)).toBeLessThan(1.8);
    expect(ratio('common_crowd', 640, 157)).toBeGreaterThan(1.2);
    expect(ratio('common_crowd', 640, 157)).toBeLessThan(1.8);
    expect(ratio('common_flagman', 174, 340)).toBeGreaterThan(1.5);
    expect(ratio('common_flagman', 174, 340)).toBeLessThan(2.2);
    // E comunque piu bassi di una capanna e di una palma.
    expect(CATALOG.beach_bathers.scale).toBeLessThan(CATALOG.beach_hut.scale);
    expect(CATALOG.common_flagman.scale).toBeLessThan(CATALOG.beach_palm_1.scale);
  });

  test('the radio screen has a full screen illustration and a 1000x400 panel (spec §11)', () => {
    expect(CATALOG.screen_attract.kind).toBe('illustration');
    expect(CATALOG.radio_panel.kind).toBe('ui');
    expect(targets.screen_attract).toEqual({ w: 1280, h: 720 });
    expect(targets.radio_panel).toEqual({ w: 1000, h: 400 });
    expect(PROCEDURAL_ONLY.has('screen_attract')).toBe(false);
    expect(PROCEDURAL_ONLY.has('radio_panel')).toBe(false);
  });
});
