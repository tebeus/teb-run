import { describe, expect, test } from 'vitest';
import { CATALOG, SPRITE_NAMES, STRIPS } from '../../src/art/catalog';
import { FX_SPRITES } from '../../src/art/procedural/fxsprites';
import { NPC_ART } from '../../src/art/procedural/npc';
import { targetSize } from '../../src/core/assets';
import targetsJson from '../../tools/sprite-targets.json';
import { createFakeCtx } from '../helpers/fakeCtx';

type Target = { w: number; h: number; frames?: number };
const targets = targetsJson as Record<string, Target>;

const FX = [
  'fx_dust_small',
  'fx_dust_large',
  'fx_smoke',
  'fx_debris_small',
  'fx_debris_large',
  'fx_sparks',
  'fx_speed_lines',
  'fx_impact',
  'fx_water_splash',
  'fx_grass_spray',
] as const;

const NPC = [
  'npc_photographer',
  'npc_cyclist',
  'npc_surfer',
  'npc_couple',
  'npc_dog',
  'npc_sheep',
  'npc_sailboat',
  'npc_seagull_0',
  'npc_seagull_1',
  'npc_seagull_2',
] as const;

describe('arte degli effetti (spec §4.4b, §13)', () => {
  test('FX_SPRITES has exactly the ten effect names', () => {
    expect(Object.keys(FX_SPRITES).sort()).toEqual([...FX].sort());
  });

  test.each(FX)('%s draws at its target size without throwing', (name) => {
    const { w, h } = targetSize(name);
    const ctx = createFakeCtx();
    FX_SPRITES[name](ctx, w, h);
    expect(ctx.paints, name).toBeGreaterThan(2);
  });

  test.each(FX)('%s is an overlay, centred, never solid', (name) => {
    expect(CATALOG[name].kind, name).toBe('ui');
    expect(CATALOG[name].solid, name).toBe(false);
    expect(CATALOG[name].collideW, name).toBe(0);
    expect(CATALOG[name].anchorY, name).toBe(0.5);
    expect(targets[name], name).toBeDefined();
  });

  test('the two names that stay out of the catalog stay out', () => {
    // spec §13: i cuori sono per i finali (non ridisegnati) e le strisce
    // di gomma sono poligoni nel mondo, non un PNG piatto.
    expect(CATALOG.fx_heart).toBeUndefined();
    expect(CATALOG.fx_skid_marks).toBeUndefined();
    expect(targets.fx_heart).toBeUndefined();
    expect(targets.fx_skid_marks).toBeUndefined();
  });
});

describe('arte della vita a bordo strada (spec §13)', () => {
  test('NPC_ART has exactly the ten roadside names', () => {
    expect(Object.keys(NPC_ART).sort()).toEqual([...NPC].sort());
  });

  test.each(NPC)('%s draws at its target size without throwing', (name) => {
    const { w, h } = targetSize(name);
    const ctx = createFakeCtx();
    NPC_ART[name](ctx, w, h);
    expect(ctx.paints, name).toBeGreaterThan(2);
  });

  test('nobody on the roadside is solid: hitting a dog is not a game mechanic', () => {
    for (const name of NPC) {
      expect(CATALOG[name].solid, name).toBe(false);
      expect(CATALOG[name].collideW, name).toBe(0);
    }
  });

  test('the seven figures are scenery about 0.6 as wide as the player car', () => {
    const car = CATALOG.player_straight.scale;
    for (const name of ['npc_photographer', 'npc_cyclist', 'npc_surfer', 'npc_dog'] as const) {
      expect(CATALOG[name].kind, name).toBe('scenery');
      expect(CATALOG[name].anchorY, name).toBe(1);
      expect(CATALOG[name].scale, name).toBeGreaterThan(car * 0.4);
      expect(CATALOG[name].scale, name).toBeLessThan(car * 1.1);
    }
    // La coppia sono due persone affiancate, le pecore un gruppo, la barca
    // sta lontana sull'acqua: piu' larghe di una figura sola.
    expect(CATALOG.npc_couple.scale).toBeGreaterThan(CATALOG.npc_photographer.scale);
    expect(CATALOG.npc_sheep.scale).toBeGreaterThan(CATALOG.npc_dog.scale);
    expect(CATALOG.npc_sailboat.scale).toBeGreaterThan(CATALOG.npc_couple.scale);
  });

  test('the seagull is a three-frame strip drawn as a screen overlay', () => {
    expect(STRIPS.npc_seagull).toEqual(['npc_seagull_0', 'npc_seagull_1', 'npc_seagull_2']);
    // 90x60 per frame: la misura del PNG consegnato dopo il ritaglio della
    // trasparenza (85x58). Con il target a 140x200 il tool ingrandiva di
    // 3,4 volte e i gabbiani uscivano sfocati e schiacciati.
    // `trim: false`: tre celle da 90x60 alla stessa scala, tenute intere.
    expect(targets.npc_seagull).toEqual({ w: 90, h: 60, frames: 3, trim: false });
    expect(CATALOG.npc_seagull).toBeUndefined();
    for (const name of ['npc_seagull_0', 'npc_seagull_1', 'npc_seagull_2'] as const) {
      expect(CATALOG[name].kind, name).toBe('ui');
      expect(CATALOG[name].anchorY, name).toBe(0.5);
      expect(targetSize(name)).toEqual({ w: 90, h: 60 });
    }
  });

  test('the three targets that the delivered PNG contradicts are aligned to it', () => {
    // `spriteDestRect` ricava l'altezza dalla proporzione del **PNG**, non
    // da quella del target: un target in proporzioni diverse fa uscire il
    // ripiego procedurale e il PNG di forma diversa. Misurato col tool:
    // npc_couple 220x298 (il PNG consegnato, `public/sprites/npc_couple.png`
    // e il suo `manifest.json` sono già a questa misura: il target era
    // rimasto al valore di una consegna precedente, 320 invece di 298),
    // npc_seagull 85x58 per frame, fx_debris_small 304x68 dopo il ritaglio
    // della trasparenza.
    expect(targets.npc_couple).toEqual({ w: 220, h: 298 });
    expect(targets.fx_debris_small).toEqual({ w: 300, h: 70 });
    // Con la coppia a 0.26 il gruppo usciva alto 0,38 larghezze strada,
    // due volte e mezzo il fotografo: a 0.13 sta a 0,15.
    expect(CATALOG.npc_couple.scale).toBeCloseTo(0.13 * (2000 / 2600), 10);
  });

  test('the twenty names are all distinct and all in the catalog', () => {
    // Come nel task 2: il conteggio esatto vive nei due file condivisi.
    expect(new Set([...FX, ...NPC]).size).toBe(20);
    for (const name of [...FX, ...NPC]) expect(SPRITE_NAMES, name).toContain(name);
  });
});
