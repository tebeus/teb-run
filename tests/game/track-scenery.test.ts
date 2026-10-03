import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { mulberry32 } from '../../src/core/rng';
import {
  BILLBOARD_EVERY,
  BILLBOARD_OFFSET,
  buildTrack,
  CHEVRON_NAME,
  CROWD_NAME,
  DETAIL_NAMES,
  FLAGMAN_NAME,
  FORK_ZONE_SEGMENTS,
  INTRO_SEGMENTS,
  OFFSET_MAX,
  OFFSET_MIN,
  placeScenery,
  SAILBOAT_NAME,
  sceneryOffset,
  THEME_LIFE,
  THEME_SCENERY,
} from '../../src/game/track';
import { STAGE_LIST } from '../../src/game/stages';
import type { Segment, StageDef, ThemeId } from '../../src/types';

const THEMES: ThemeId[] = ['beach', 'desert', 'alpine', 'farm', 'town'];

const stage = (over: Partial<StageDef> = {}): StageDef => ({
  id: '1-0',
  name: 'Test Stage',
  theme: 'beach',
  lengthSegments: 2320,
  timeLimit: 75,
  seed: 1234,
  difficulty: 0.3,
  ...over,
});

const allSprites = (segs: readonly Segment[]): { name: string; offset: number; index: number; fixed?: boolean }[] =>
  segs.flatMap((s) => s.sprites.map((p) => ({ name: p.name, offset: p.offset, index: s.index, fixed: p.fixed })));

describe('THEME_SCENERY', () => {
  test('every theme has a non empty list of catalog names', () => {
    expect(Object.keys(THEME_SCENERY).sort()).toEqual([...THEMES].sort());
    for (const theme of THEMES) {
      const list = THEME_SCENERY[theme].names;
      expect(list.length, theme).toBeGreaterThan(0);
      for (const n of list) expect(CATALOG[n], `${theme}: ${n}`).toBeDefined();
    }
  });

  test('densities are fractions and palms are denser than cactuses (spec 9)', () => {
    for (const theme of THEMES) {
      expect(THEME_SCENERY[theme].density, theme).toBeGreaterThan(0);
      expect(THEME_SCENERY[theme].density, theme).toBeLessThan(1);
    }
    expect(THEME_SCENERY.beach.density).toBeGreaterThan(THEME_SCENERY.desert.density);
  });
});

describe('sceneryOffset', () => {
  test('u = 0 gives the closest allowed offset, u = 1 the farthest', () => {
    const entry = CATALOG.beach_palm_1;
    expect(sceneryOffset(entry, 0, 1)).toBeCloseTo(OFFSET_MIN + entry.scale, 10);
    expect(sceneryOffset(entry, 1, 1)).toBeCloseTo(OFFSET_MAX, 10);
  });

  test('the side flips the sign', () => {
    const entry = CATALOG.beach_palm_1;
    expect(sceneryOffset(entry, 0.5, -1)).toBeCloseTo(-sceneryOffset(entry, 0.5, 1), 10);
  });

  test('every catalog entry stays inside the spec range and off the asphalt', () => {
    for (const [name, entry] of Object.entries(CATALOG)) {
      for (const u of [0, 0.33, 0.66, 1]) {
        const off = sceneryOffset(entry, u, 1);
        expect(off, `${name} u=${u}`).toBeGreaterThanOrEqual(OFFSET_MIN - 1e-9);
        expect(off, `${name} u=${u}`).toBeLessThanOrEqual(OFFSET_MAX + 1e-9);
      }
      if (entry.scale + OFFSET_MIN <= OFFSET_MAX) {
        const inner = sceneryOffset(entry, 0, 1) - entry.scale;
        expect(inner, `${name} inner edge`).toBeGreaterThanOrEqual(OFFSET_MIN - 1e-9);
      }
    }
  });
});

/**
 * Sprite dei momenti di gara del binario I: portali, bandiere, cartelli
 * di bivio e segnali di curva hanno tutti il prefisso `race_` (spec
 * §4.4e). Si riconoscono dal prefisso e non da un elenco, così i task
 * che ne aggiungono altri non devono tornare qui.
 */
const isRaceSprite = (name: string): boolean => name.startsWith('race_');
/** I tre portali: ancorati al centro strada, come `common_gantry`. */
const PORTAL_NAMES = new Set<string>(['race_start_gantry', 'race_checkpoint', 'race_goal']);

describe('placeScenery through buildTrack', () => {
  test('every placed name is in the catalog', () => {
    const segs = buildTrack(stage({ theme: 'farm' }));
    for (const s of allSprites(segs)) expect(CATALOG[s.name], s.name).toBeDefined();
  });

  test('roadside offsets stay inside the spec range', () => {
    const segs = buildTrack(stage({ theme: 'town', seed: 7 }));
    for (const s of allSprites(segs)) {
      // Bivio v3: portale e bandiere di fine tappa stanno sui due rami della
      // Y, a offset `fixed` dal centro della zona.
      if (s.fixed === true) {
        expect(Math.abs(s.offset), s.name).toBeGreaterThan(1);
        continue;
      }
      if (s.name === 'common_gantry' || PORTAL_NAMES.has(s.name)) {
        expect(s.offset, s.name).toBe(0);
        continue;
      }
      expect(Math.abs(s.offset), s.name).toBeGreaterThanOrEqual(OFFSET_MIN - 1e-9);
      expect(Math.abs(s.offset), s.name).toBeLessThanOrEqual(OFFSET_MAX + 1e-9);
    }
  });

  test('every placed roadside sprite has its inner edge off the asphalt', () => {
    const segs = buildTrack(stage({ theme: 'town', seed: 7 }));
    for (const s of allSprites(segs)) {
      if (s.name === 'common_gantry' || PORTAL_NAMES.has(s.name)) continue;
      const inner = Math.abs(s.offset) - CATALOG[s.name].scale;
      expect(inner, `${s.name} inner edge`).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  test('both sides of the road are used', () => {
    const segs = buildTrack(stage());
    const offsets = allSprites(segs).map((s) => s.offset);
    expect(offsets.some((o) => o > 0)).toBe(true);
    expect(offsets.some((o) => o < 0)).toBe(true);
  });

  test('the intro straight carries only the crowd and the start gantry', () => {
    const segs = buildTrack(stage());
    for (let i = 0; i < INTRO_SEGMENTS; i++) {
      for (const sprite of segs[i].sprites) {
        expect(sprite.name === CROWD_NAME || isRaceSprite(sprite.name), `segment ${i}: ${sprite.name}`).toBe(true);
      }
    }
  });

  test('a stage only places sprites from its own theme plus the common ones', () => {
    const segs = buildTrack(stage({ theme: 'desert' }));
    const allowed = new Set<string>([
      ...THEME_SCENERY.desert.names,
      'common_billboard',
      'common_gantry',
      // I dettagli di terreno del binario H sono neutri per nome: stanno
      // bene su tutti i temi (deroga 3 di questo piano).
      ...DETAIL_NAMES,
      // Cartelli di curva e spettatori: comuni a tutti i temi (spec §13).
      CHEVRON_NAME,
      CROWD_NAME,
      FLAGMAN_NAME,
      // Vita a bordo strada del binario I: le liste sono per tema, e
      // quella del deserto è la sola che questa tappa può piazzare
      // (spec §13). Le barche stanno solo in spiaggia.
      ...THEME_LIFE.desert.names,
    ]);
    for (const s of allSprites(segs)) {
      // Portali, bandiere e cartelli sono comuni a tutti i temi (spec §4.4e).
      if (isRaceSprite(s.name)) continue;
      expect(allowed.has(s.name), s.name).toBe(true);
    }
  });

  test('beach places more roadside objects than desert', () => {
    const beach = allSprites(buildTrack(stage({ theme: 'beach', seed: 21 }))).length;
    const desert = allSprites(buildTrack(stage({ theme: 'desert', seed: 21 }))).length;
    expect(beach).toBeGreaterThan(desert);
  });

  test('billboards appear every 120 segments at BILLBOARD_OFFSET, inner edge off the road, on both sides', () => {
    const segs = buildTrack(stage());
    const boards = allSprites(segs).filter((s) => s.name === 'common_billboard');
    expect(boards.length).toBeGreaterThan(5);
    for (const b of boards) {
      expect(b.index % BILLBOARD_EVERY).toBe(0);
      expect(Math.abs(b.offset)).toBeCloseTo(BILLBOARD_OFFSET, 10);
      const inner = Math.abs(b.offset) - CATALOG.common_billboard.scale;
      expect(inner, 'billboard inner edge').toBeGreaterThanOrEqual(OFFSET_MIN - 1e-9);
    }
    expect(boards.some((b) => b.offset > 0)).toBe(true);
    expect(boards.some((b) => b.offset < 0)).toBe(true);
  });

  test('the fork zone gets a gantry and no centre barriers (deroga, addendum del collaudo)', () => {
    // Nei racer arcade dell'epoca al bivio non c'è nessun ostacolo in mezzo: la
    // strada si apre e basta, e chi tiene il centro finisce su un lato da
    // solo (isola = banchina + `ISLAND_NUDGE`, non un muro). Con la fila di
    // barriere, chi guidava dritto ci sbatteva proprio sulla punta
    // dell'isola: testacoda, velocità a zero.
    for (const id of ['0-0', '1-0', '2-1', '3-0']) {
      const segs = buildTrack(stage({ id }));
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      expect(segs[zoneStart].sprites.map((s) => s.name), id).toContain('common_gantry');
      expect(allSprites(segs).map((s) => s.name), id).not.toContain('common_barrier');
    }
  });

  test('nella zona di bivio di ogni tappa reale nessun segmento con median 0 ha uno sprite solido vicino al centro (addendum E)', () => {
    for (const s of STAGE_LIST) {
      const segs = buildTrack(s);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      if (segs[zoneStart].fork !== 'zone') continue;
      for (let i = zoneStart; i < segs.length; i++) {
        if (segs[i].median !== 0) continue;
        for (const p of segs[i].sprites) {
          const entry = CATALOG[p.name];
          if (!entry?.solid) continue;
          expect(Math.abs(p.offset), `${s.id} seg ${i} ${p.name}`).toBeGreaterThanOrEqual(0.2);
        }
      }
    }
  });

  test('the fork zone carries only the gantry and the race signs', () => {
    const segs = buildTrack(stage({ id: '2-1' }));
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    for (let i = zoneStart; i < segs.length; i++) {
      for (const p of segs[i].sprites) {
        expect(
          p.name === 'common_gantry' || isRaceSprite(p.name),
          `segment ${i}: ${p.name}`,
        ).toBe(true);
      }
    }
  });

  test('a level 4 stage has neither gantry nor barriers', () => {
    const segs = buildTrack(stage({ id: '4-0' }));
    const names = allSprites(segs).map((s) => s.name);
    expect(names).not.toContain('common_gantry');
    expect(names).not.toContain('common_barrier');
  });

  test('placement is deterministic from the seed', () => {
    const a = allSprites(buildTrack(stage({ seed: 900 })));
    const b = allSprites(buildTrack(stage({ seed: 900 })));
    expect(a).toEqual(b);
    const c = allSprites(buildTrack(stage({ seed: 901 })));
    expect(a).not.toEqual(c);
  });

  test('placeScenery can be called on its own and adds objects', () => {
    const def = stage({ id: '4-1' });
    const segs = buildTrack(def);
    const before = allSprites(segs).length;
    placeScenery(segs, def, mulberry32(3));
    expect(allSprites(segs).length).toBeGreaterThan(before);
    expect(allSprites(segs).map((s) => s.name)).not.toContain('common_barrier');
  });
});

describe('ogni sprite di scenografia del catalogo finisce su un tracciato (task 15)', () => {
  /** Tutti i nomi piazzati dalle 15 tappe vere, una volta. */
  const placedNames = (): Set<string> => {
    const out = new Set<string>();
    for (const stage of STAGE_LIST) {
      for (const seg of buildTrack(stage)) {
        for (const sp of seg.sprites) out.add(sp.name);
      }
    }
    return out;
  };

  test('nessun nome di scenografia resta senza un posto sul tracciato', () => {
    const placed = placedNames();
    const missing = Object.entries(CATALOG)
      .filter(([, e]) => e.kind === 'scenery')
      .map(([name]) => name)
      // Deroga, addendum del collaudo: `placeScenery` non pianta più
      // `common_barrier` nella zona di bivio (era l'unico posto che lo
      // usava), quindi resta in catalogo senza un posto sul tracciato reale.
      // Gli altri test (render, collisioni, asset) continuano a usarlo come
      // sprite solido generico.
      .filter((name) => name !== 'common_barrier')
      .filter((name) => !placed.has(name));
    // I 18 sprite del Set 2 (spec §13) erano in catalogo e in `public/sprites`
    // ma nessuna sezione li piazzava: 17 su 18 non si sono mai visti in gioco.
    expect(missing).toEqual([]);
  });

  test('ogni tema pesca dai propri sprite e dai comuni, non da quelli di un altro tema', () => {
    for (const stage of STAGE_LIST) {
      const pool = new Set(THEME_SCENERY[stage.theme].names);
      for (const seg of buildTrack(stage)) {
        for (const sp of seg.sprites) {
          if (CATALOG[sp.name].kind !== 'scenery') continue;
          if (pool.has(sp.name)) continue;
          // Fuori dalla lista del tema ci sono solo i nomi che sezioni
          // dedicate piazzano da sé: cartelli, cartelloni, spettatori,
          // dettagli di terreno e i momenti di gara
          // del binario I (portali, bandiere, cartelli, vita a bordo
          // strada e barche). Vita a bordo strada e barche pescano dalla
          // propria lista per tema, `THEME_LIFE`, non da `THEME_SCENERY`:
          // il riferimento esplicito a `THEME_LIFE[stage.theme].names`
          // (invece di un generico prefisso `npc_`) mantiene qui la
          // garanzia per tema anche per queste figure, non solo per gli
          // sprite di `THEME_SCENERY` (spec §4.4e/§13).
          expect(
            sp.name.startsWith('common_sign_') ||
              sp.name.startsWith('ground_') ||
              sp.name.startsWith('race_') ||
              THEME_LIFE[stage.theme].names.includes(sp.name) ||
              sp.name === SAILBOAT_NAME ||
              ['common_billboard', 'common_crowd', 'common_flagman', 'common_gantry'].includes(
                sp.name,
              ),
            `${stage.id}: ${sp.name}`,
          ).toBe(true);
        }
      }
    }
  });
});
