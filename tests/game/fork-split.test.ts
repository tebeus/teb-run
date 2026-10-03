import { describe, expect, test } from 'vitest';
import { STAGE_LIST } from '../../src/game/stages';
import {
  FORK_SPLIT_MAX,
  FORK_TIP,
  FORK_TIP_HALF,
  FORK_ZONE_SEGMENTS,
  buildTrack,
  forkMedian,
  forkOffset,
  forkRoadHalf,
  forkZoneShape,
  smoothstep,
} from '../../src/game/track';
import { CATALOG } from '../../src/art/catalog';
import { spawnTraffic, stepTraffic } from '../../src/game/traffic';
import type { Segment, StageDef } from '../../src/types';

const byId = (id: string): StageDef => {
  const stage = STAGE_LIST.find((s) => s.id === id);
  if (!stage) throw new Error(`no stage ${id}`);
  return stage;
};

describe('smoothstep', () => {
  test('it is 0 at 0, 0.5 at 0.5 and 1 at 1', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 12);
    expect(smoothstep(1)).toBe(1);
  });

  test('it clamps outside [0, 1] and is monotone inside', () => {
    expect(smoothstep(-3)).toBe(0);
    expect(smoothstep(9)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = smoothstep(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test('it leaves both ends flat: the split has no corner', () => {
    expect(smoothstep(0.02)).toBeLessThan(0.02);
    expect(smoothstep(0.98)).toBeGreaterThan(0.98);
  });
});

describe('forkRoadHalf e forkMedian (spec §4.4)', () => {
  test('the zone starts at the normal width and ends fully split', () => {
    expect(FORK_SPLIT_MAX).toBe(0.8);
    expect(forkRoadHalf(0)).toBe(1);
    expect(forkRoadHalf(1)).toBeCloseTo(2.8, 12);
    expect(forkMedian(forkRoadHalf(0))).toBe(0);
    expect(forkMedian(forkRoadHalf(1))).toBeCloseTo(0.8, 12);
  });

  test('halfway through the zone the road is wide but still one road', () => {
    const half = forkRoadHalf(0.5);
    expect(half).toBeCloseTo(1.9, 12);
    expect(forkMedian(half)).toBe(0);
  });

  test('the island appears only past roadHalf 2', () => {
    expect(forkMedian(2)).toBe(0);
    expect(forkMedian(2.4)).toBeCloseTo(0.4, 12);
  });

  test('the width never shrinks along the zone', () => {
    let prev = 0;
    for (let i = 0; i <= 50; i++) {
      const v = forkRoadHalf(i / 50);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('forkOffset (spec §4.4)', () => {
  test('inside the road nothing moves', () => {
    for (const o of [0, 0.5, -0.66, 0.99, -0.99]) {
      expect(forkOffset(o, 2.8), `offset ${o}`).toBe(o);
    }
  });

  test('from the road edge outward everything follows the outer edge', () => {
    expect(forkOffset(1, 2.8)).toBeCloseTo(2.8, 12);
    expect(forkOffset(-1, 2.8)).toBeCloseTo(-2.8, 12);
    expect(forkOffset(2.5, 2.8)).toBeCloseTo(4.3, 12);
    expect(forkOffset(-2.5, 2.8)).toBeCloseTo(-4.3, 12);
  });

  test('outside the zone it is the identity, whatever the offset', () => {
    for (const o of [0, 1, 2.5, -1, -2.5]) {
      expect(forkOffset(o, 1), `offset ${o}`).toBe(o);
    }
  });
});

describe('buildTrack: la zona di bivio si divide (spec §4.4)', () => {
  test('outside the zone every segment is one normal road', () => {
    const segs = buildTrack(byId('0-0'));
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    for (let i = 0; i < zoneStart; i++) {
      expect(segs[i].roadHalf, `segment ${i}`).toBe(1);
      expect(segs[i].median, `segment ${i}`).toBe(0);
    }
  });

  test('the zone starts normal, widens a little up to the tip, and ends as two roads far apart', () => {
    // Bivio v3: i valori sono quelli di `forkZoneShape`, la Y statica.
    const segs = buildTrack(byId('0-0'));
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    const first = segs[zoneStart];
    const tip = segs[zoneStart + FORK_TIP];
    const last = segs[segs.length - 1];
    expect(first.roadHalf).toBe(1);
    expect(first.median).toBe(0);
    expect(tip.roadHalf).toBeCloseTo(FORK_TIP_HALF, 6);
    expect(tip.median).toBeCloseTo(0, 9);
    // In fondo due strade di base 1, lontane: l'isola è la gran parte.
    expect(last.roadHalf - last.median).toBeCloseTo(2, 6);
    expect(last.median).toBeGreaterThan(8);
    expect(last.roadHalf).toBeCloseTo(forkZoneShape(FORK_ZONE_SEGMENTS - 1).roadHalf, 6);
  });

  test('the width grows monotonically along the zone', () => {
    const segs = buildTrack(byId('1-1'));
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    for (let i = zoneStart + 1; i < segs.length; i++) {
      expect(segs[i].roadHalf, `segment ${i}`).toBeGreaterThanOrEqual(segs[i - 1].roadHalf);
      expect(segs[i].median, `segment ${i}`).toBeGreaterThanOrEqual(segs[i - 1].median);
    }
  });

  test('a level 4 stage has no fork zone', () => {
    // Il task 23 (spec §9) introduce la sezione `dualRoad`, che può comparire
    // in qualunque tappa, livello 4 compreso: la larghezza non è più sempre
    // 1 nel corpo. Quello che resta vero al livello 4 è l'assenza della zona
    // di bivio vera e propria.
    const segs = buildTrack(byId('4-0'));
    for (const seg of segs) {
      expect(seg.fork).toBeUndefined();
    }
  });

  test('no traffic ever reaches the fork zone, so nobody drives on the island', () => {
    // Lo spawn esclude la zona e il riciclo riporta i veicoli dopo l'intro:
    // è la premessa che rende `forkOffset` gratis anche per i veicoli.
    const stage = byId('0-0');
    const segs = buildTrack(stage);
    const cars = spawnTraffic(segs, stage);
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    for (let tick = 0; tick < 2000; tick++) {
      stepTraffic(segs, cars, 1 / 60, tick * 100, (tick - 1) * 100);
    }
    for (let i = zoneStart; i < segs.length; i++) {
      expect(segs[i].cars, `segment ${i}`).toHaveLength(0);
    }
  });

  test('nothing with an offset of 1 or more is placed inside the zone', () => {
    // È l'invariante che rende `forkOffset` gratis per le collisioni. Non
    // riguarda le tappe di livello 4, che non hanno zona di bivio (`fork`
    // resta undefined e `roadHalf` resta 1): lì `forkOffset` è comunque
    // l'identità, quindi l'omino con la bandiera al traguardo (spec §13,
    // offset 1.5) non viola nulla che questo invariante debba proteggere.
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      if (segs[zoneStart].fork !== 'zone') continue;
      for (let i = zoneStart; i < segs.length; i++) {
        for (const placed of segs[i].sprites) {
          // I portali e i cartelli del binario I stanno **fuori** dalle
          // due carreggiate di proposito: `forkOffset` li porta sul terreno
          // oltre il bordo esterno (spec §4.4e); i portali della Y (bivio
          // v3) sono `fixed`, sul centro di ciascun ramo.
          if (placed.name.startsWith('race_')) continue;
          expect(Math.abs(placed.offset), `${stage.id} ${placed.name} at ${i}`).toBeLessThan(1);
        }
      }
    }
  });

  test('no solid sprite sits near the centre of the fork zone, on any stage; the gantry stays', () => {
    // Deroga, addendum del collaudo: niente più fila di barriere centrali.
    // Nei racer arcade dell'epoca al bivio non c'è nessun ostacolo in mezzo, la
    // strada si apre e basta; con le barriere, chi teneva il centro ci
    // sbatteva proprio sulla punta dell'isola. L'isola resta banchina con la
    // spinta di `ISLAND_NUDGE`, non un muro.
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      if (segs[zoneStart].fork !== 'zone') continue; // livello 4: nessuna zona di bivio
      for (let i = zoneStart; i < segs.length; i++) {
        for (const placed of segs[i].sprites) {
          if (placed.name === 'common_gantry') continue;
          const entry = CATALOG[placed.name];
          if (!entry.solid) continue;
          expect(Math.abs(placed.offset), `${stage.id} ${placed.name} at segment ${i}`).toBeGreaterThanOrEqual(0.2);
        }
      }
      expect(segs[zoneStart].sprites.some((p) => p.name === 'common_gantry'), stage.id).toBe(true);
      expect(segs[zoneStart].sprites.some((p) => p.name === 'common_barrier'), stage.id).toBe(false);
    }
  });

  test('it is still deterministic from the seed', () => {
    for (const stage of STAGE_LIST) {
      const a = buildTrack(stage).map((s) => `${s.roadHalf}|${s.median}`).join(';');
      const b = buildTrack(stage).map((s) => `${s.roadHalf}|${s.median}`).join(';');
      expect(b, stage.id).toBe(a);
    }
  });
});
