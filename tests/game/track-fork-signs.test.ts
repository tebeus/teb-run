import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { mulberry32 } from '../../src/core/rng';
import { STAGE_LIST, stageById } from '../../src/game/stages';
import {
  buildTrack,
  CAMERA_WRAP_GUARD,
  CAUTION_SIGN_LEAD_MAX,
  CAUTION_SIGN_LEAD_MIN,
  CURVE_SIGN_CHANCE,
  CURVE_SIGN_LEAD_MAX,
  CURVE_SIGN_LEAD_MIN,
  CURVE_SIGN_OFFSET,
  curveEntries,
  FORK_SIGN_AT,
  FORK_SIGN_OFFSET,
  FORK_TIP,
  FORK_ZONE_SEGMENTS,
  HARD_CURVE,
  peakCurve,
  placeCurveSigns,
  SIGN_ZONE_FIRST,
} from '../../src/game/track';
import type { PlacedSprite, Segment } from '../../src/types';

const all = (segs: readonly Segment[]): { i: number; p: PlacedSprite }[] =>
  segs.flatMap((seg, i) => seg.sprites.map((p) => ({ i, p })));

describe('cartelli di bivio (spec §4.4e)', () => {
  test('three pairs of boards stand in the fork zone, at the start, halfway to the tip and at the tip', () => {
    // Bivio v3: tutte prima del commit, dove la scelta è ancora aperta.
    const segs = buildTrack(stageById('0-0'));
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    expect(FORK_SIGN_AT).toEqual([0, FORK_TIP / 2, FORK_TIP]);
    const expected = FORK_SIGN_AT.map((k) => zoneStart + k);
    expect(expected).toHaveLength(3);
    const names = [
      ['race_fork_left', 'race_fork_right'],
      ['race_direction_left', 'race_direction_right'],
      ['race_direction_left', 'race_direction_right'],
    ];
    for (let k = 0; k < 3; k++) {
      const on = segs[expected[k]].sprites;
      const left = on.find((p) => p.name === names[k][0]);
      const right = on.find((p) => p.name === names[k][1]);
      expect(left, `coppia ${k}`).toBeDefined();
      expect(right, `coppia ${k}`).toBeDefined();
      expect(left!.offset).toBe(-FORK_SIGN_OFFSET);
      expect(right!.offset).toBe(FORK_SIGN_OFFSET);
    }
  });

  test('the arrow gantry of the fork is still there: the boards stand beside it, not instead', () => {
    const segs = buildTrack(stageById('1-1'));
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    expect(segs[zoneStart].sprites.map((p) => p.name)).toContain('common_gantry');
  });

  test('level 4 stages have no fork boards: they have no fork', () => {
    for (const stage of STAGE_LIST.filter((s) => s.id.startsWith('4-'))) {
      const segs = buildTrack(stage);
      const names = all(segs).map((x) => x.p.name);
      expect(names, stage.id).not.toContain('race_fork_left');
      expect(names, stage.id).not.toContain('race_direction_right');
    }
  });

  test('no fork board lands in the camera wrap window', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (let i = segs.length - CAMERA_WRAP_GUARD; i < segs.length; i++) {
        expect(segs[i].sprites.map((p) => p.name), `${stage.id} seg ${i}`).not.toContain('race_fork_left');
      }
    }
  });
});

describe('segnali di curva (spec §4.4e)', () => {
  test('a caution sign announces a hard curve, a speed sign a medium one', () => {
    const segs = buildTrack(stageById('4-1'));
    // Il triangolo sta 25-35 segmenti prima della curva, il disco 20-30: la
    // ricerca dell'entrata usa l'unione dei due intervalli.
    const leadMin = Math.min(CURVE_SIGN_LEAD_MIN, CAUTION_SIGN_LEAD_MIN);
    const leadMax = Math.max(CURVE_SIGN_LEAD_MAX, CAUTION_SIGN_LEAD_MAX);
    for (const { i, p } of all(segs)) {
      if (p.name !== 'race_caution_sign' && p.name !== 'race_speed_sign') continue;
      let entry = -1;
      for (let k = leadMin; k <= leadMax; k++) {
        if (i + k < segs.length && Math.abs(segs[i + k].curve) >= 4) entry = i + k;
      }
      expect(entry, `cartello a ${i} senza curva davanti`).toBeGreaterThan(0);
      // Il nome dipende dal **picco** della curva, non dalla sua rampa
      // d'ingresso (spec §4.4e).
      const hard = Math.abs(peakCurve(segs, entry)) >= HARD_CURVE;
      expect(p.name, `seg ${i} curva ${segs[entry].curve}`).toBe(hard ? 'race_caution_sign' : 'race_speed_sign');
    }
  });

  test('a caution sign sits 25 to 35 segments before its hard curve, always: no coin flip', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (const entry of curveEntries(segs)) {
        if (entry < SIGN_ZONE_FIRST || Math.abs(peakCurve(segs, entry)) < HARD_CURVE) continue;
        const found = all(segs).find(
          (x) =>
            x.p.name === 'race_caution_sign' &&
            entry - x.i >= CAUTION_SIGN_LEAD_MIN &&
            entry - x.i <= CAUTION_SIGN_LEAD_MAX,
        );
        if (entry - CAUTION_SIGN_LEAD_MAX < SIGN_ZONE_FIRST || entry >= zoneStart) continue;
        expect(found, `${stage.id} hard curve at ${entry}`).toBeDefined();
      }
    }
  });

  test('the signs stand outside the shoulder, on the outer side, mirrored for right curves', () => {
    const segs = buildTrack(stageById('3-1'));
    for (const { p } of all(segs)) {
      if (p.name !== 'race_caution_sign' && p.name !== 'race_speed_sign') continue;
      expect(Math.abs(p.offset)).toBeCloseTo(CURVE_SIGN_OFFSET, 10);
      // Curva a destra (`curve > 0`): l'esterno è a sinistra, e il cartello
      // è specchiato. Stessa convenzione dei chevron di spec §13.
      expect(p.flip).toBe(p.offset < 0);
    }
  });

  test('both signs really get placed: neither is dead code', () => {
    // Senza `peakCurve` il triangolo di pericolo non compariva su nessuna
    // delle 15 tappe, e il test sopra era vero a vuoto.
    const names = new Set(STAGE_LIST.flatMap((st) => all(buildTrack(st)).map((x) => x.p.name)));
    expect(names.has('race_caution_sign'), 'nessun triangolo di pericolo su 15 tappe').toBe(true);
    expect(names.has('race_speed_sign'), 'nessun disco su 15 tappe').toBe(true);
  });

  test('the peak of a curve is at least as strong as its entry', () => {
    const segs = buildTrack(stageById('4-1'));
    for (const entry of curveEntries(segs)) {
      expect(Math.abs(peakCurve(segs, entry))).toBeGreaterThanOrEqual(Math.abs(segs[entry].curve));
    }
  });

  test('speed signs stay rare on medium curves; caution signs cover every hard curve, always', () => {
    // Revisione «cartelli di curva visibili» (spec §13/§4.4e): il triangolo
    // di pericolo non tira più a sorteggio, il disco sulle curve medie sì.
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      const mediumEntries = curveEntries(segs).filter(
        (e) => Math.abs(peakCurve(segs, e)) < HARD_CURVE,
      );
      const speedSigns = all(segs).filter((x) => x.p.name === 'race_speed_sign').length;
      expect(speedSigns, stage.id).toBeLessThanOrEqual(mediumEntries.length);
      for (const entry of curveEntries(segs)) {
        if (Math.abs(peakCurve(segs, entry)) < HARD_CURVE) continue;
        if (entry - CAUTION_SIGN_LEAD_MAX < SIGN_ZONE_FIRST || entry >= zoneStart) continue;
        const found = all(segs).some(
          (x) =>
            x.p.name === 'race_caution_sign' &&
            entry - x.i >= CAUTION_SIGN_LEAD_MIN &&
            entry - x.i <= CAUTION_SIGN_LEAD_MAX,
        );
        expect(found, `${stage.id} hard curve at ${entry} has no caution sign`).toBe(true);
      }
    }
    expect(CURVE_SIGN_CHANCE).toBeCloseTo(0.3, 10);
  });

  test('no sign lands in the intro straight, the fork exit or the fork zone', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (const { i, p } of all(segs)) {
        if (p.name !== 'race_caution_sign' && p.name !== 'race_speed_sign') continue;
        expect(i, `${stage.id} seg ${i}`).toBeGreaterThanOrEqual(SIGN_ZONE_FIRST);
        expect(i, `${stage.id} seg ${i}`).toBeLessThan(zoneStart);
      }
    }
  });

  test('placeCurveSigns is deterministic from the seed', () => {
    const a = buildTrack(stageById('2-0'));
    const b = buildTrack(stageById('2-0'));
    const key = (segs: readonly Segment[]): string =>
      all(segs)
        .filter((x) => x.p.name.startsWith('race_'))
        .map((x) => `${x.i}:${x.p.name}:${x.p.offset.toFixed(4)}:${x.p.flip ?? false}`)
        .join('|');
    expect(key(a)).toBe(key(b));
  });

  test('placeCurveSigns on a track with no curves places nothing and does not throw', () => {
    const segs = buildTrack(stageById('0-0'));
    const flat = segs.map((s) => ({ ...s, curve: 0, sprites: [] as PlacedSprite[] }));
    expect(() => placeCurveSigns(flat, mulberry32(7))).not.toThrow();
    expect(flat.flatMap((s) => s.sprites)).toEqual([]);
  });

  test('every sign name is in the catalog, solid and narrow', () => {
    for (const name of ['race_caution_sign', 'race_speed_sign'] as const) {
      expect(CATALOG[name].solid, name).toBe(true);
      expect(CATALOG[name].collideW, name).toBeLessThan(0.04);
    }
  });
});
