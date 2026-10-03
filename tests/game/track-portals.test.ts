import { describe, expect, test } from 'vitest';
import { CATALOG, CHECKPOINT_LEGS } from '../../src/art/catalog';
import { FIRST_STAGE_ID, REAL_GRAPH, STAGE_LIST, stageById } from '../../src/game/stages';
import {
  buildTrack,
  CAMERA_WRAP_GUARD,
  CROWD_START,
  FLAG_OFFSET,
  FLAGMAN_FROM_END,
  commitFork,
  FORK_ZONE_SEGMENTS,
  forkBranchCentre,
  portalIndex,
  spriteOffsetOf,
} from '../../src/game/track';
import { rumbleWidth } from '../../src/render/road';
import { LANES } from '../../src/render/project';
import type { Segment } from '../../src/types';

const namesOn = (seg: Segment): string[] => seg.sprites.map((s) => s.name);

describe('portali di partenza, checkpoint e traguardo (spec §4.4e)', () => {
  test('the start portal shares the crowd segment, only on the first stage', () => {
    // Non il segmento 0: a `z = 0` la telecamera sta `PLAYER_Z` prima
    // dello zero e `updateVisible` gli mette davanti i primi segmenti a
    // distanza di un pixel. `CROWD_START = 6` è la costante che il codice
    // usa già per tenerne fuori la prima fila di spettatori. Il portale di
    // partenza c'è solo su `FIRST_STAGE_ID`: dopo un checkpoint non si
    // ricomincia una gara (spec §4.4e, ruling del controllore).
    const stage = stageById(FIRST_STAGE_ID);
    const segs = buildTrack(stage);
    expect(namesOn(segs[CROWD_START]), stage.id).toContain('race_start_gantry');
    expect(namesOn(segs[0]), stage.id).not.toContain('race_start_gantry');
    const gantry = segs[CROWD_START].sprites.find((s) => s.name === 'race_start_gantry');
    expect(gantry?.offset, stage.id).toBe(0);
  });

  test('stages of level 1 and above do not carry the start gantry', () => {
    for (const stage of STAGE_LIST.filter((s) => s.id !== FIRST_STAGE_ID)) {
      const segs = buildTrack(stage);
      for (const seg of segs) {
        expect(namesOn(seg), stage.id).not.toContain('race_start_gantry');
      }
    }
  });

  test('the start portal is flanked by one flag on each side', () => {
    const segs = buildTrack(stageById('0-0'));
    const left = segs[CROWD_START].sprites.find((s) => s.name === 'race_flag_left');
    const right = segs[CROWD_START].sprites.find((s) => s.name === 'race_flag_right');
    expect(left?.offset).toBe(-FLAG_OFFSET);
    expect(right?.offset).toBe(FLAG_OFFSET);
  });

  test('stages of levels 0 to 3 carry the checkpoint gantry, not the goal', () => {
    for (const stage of STAGE_LIST.filter((s) => !s.id.startsWith('4-'))) {
      const segs = buildTrack(stage);
      const at = portalIndex(segs.length);
      expect(namesOn(segs[at]), stage.id).toContain('race_checkpoint');
      expect(namesOn(segs[at]), stage.id).not.toContain('race_goal');
    }
  });

  test('stages of level 4 carry the goal gantry with crossed flags, not the checkpoint', () => {
    for (const stage of STAGE_LIST.filter((s) => s.id.startsWith('4-'))) {
      const segs = buildTrack(stage);
      const at = portalIndex(segs.length);
      expect(namesOn(segs[at]), stage.id).toContain('race_goal');
      expect(namesOn(segs[at]), stage.id).not.toContain('race_checkpoint');
      expect(namesOn(segs[at]).filter((n) => n === 'race_finish_flags'), stage.id).toHaveLength(2);
    }
  });

  test('the checkpoint gantry sits inside the fork zone, one per branch of the Y', () => {
    const stage = stageById('0-0');
    const segs = buildTrack(stage);
    const at = portalIndex(segs.length);
    expect(segs[at].fork).toBe('zone');
    const portals = segs[at].sprites.filter((p) => p.name === 'race_checkpoint');
    expect(portals).toHaveLength(2);
    for (const p of portals) {
      expect(p.fixed).toBe(true);
      expect(Math.abs(p.offset)).toBeCloseTo(forkBranchCentre(at - (segs.length - FORK_ZONE_SEGMENTS)), 9);
    }
  });

  test.each(STAGE_LIST.filter((s) => !s.id.startsWith('4-')).flatMap((s) => [[s.id, 'L'] as const, [s.id, 'R'] as const]))(
    'stage %s, branch %s: the checkpoint spans the road the player is on, legs past the kerbs, never over the discarded road',
    (id, branch) => {
      // Revisione finale del binario I, finding 1, rifatto sulla Y del bivio
      // v3: dopo il commit, sul segmento del portale la strada del giocatore
      // è una sola, e il portale scelto le sta centrato sopra.
      const stage = stageById(id);
      const next = REAL_GRAPH.next(stage, branch);
      const segs = buildTrack(stage);
      const side = branch === 'L' ? -1 : 1;
      commitFork(segs, side, stage.roadHalf ?? 1, next?.roadHalf ?? stage.roadHalf ?? 1);
      const at = portalIndex(segs.length);
      const seg = segs[at];
      const lanes = stage.lanes ?? LANES;
      const entry = CATALOG.race_checkpoint;
      const chosen = seg.sprites.filter((p) => p.name === 'race_checkpoint' && Math.abs(spriteOffsetOf(p, seg)) < 1);
      expect(chosen, 'one portal on the chosen road').toHaveLength(1);
      const centre = spriteOffsetOf(chosen[0], seg);
      expect(centre).toBeCloseTo(0, 9);
      // Le gambe, in unità x: la metà larghezza dello sprite è `scale`.
      const legInner = entry.scale * CHECKPOINT_LEGS.inner;
      const legOuter = entry.scale * CHECKPOINT_LEGS.outer;
      const kerb = Math.max(seg.roadHalf, seg.roadHalfFar ?? seg.roadHalf) + rumbleWidth(1, lanes);
      expect(legInner, 'legs outside the kerbs').toBeGreaterThan(kerb);
      // Vicino alla strada, non in mezzo al terreno fra le due strade...
      expect(legOuter).toBeLessThan(seg.roadHalf + 1);
      // ...e mai sopra la strada scartata.
      const d = seg.discarded!;
      expect(legOuter).toBeLessThan(Math.abs(d.near) - d.halfNear);
      // Le bandiere stanno fuori dalle gambe.
      for (const flag of seg.sprites.filter((p) => p.name.startsWith('race_flag'))) {
        const o = Math.abs(spriteOffsetOf(flag, seg) - centre);
        if (o > 5) continue; // le bandiere del portale sulla strada scartata
        expect(o - CATALOG[flag.name].scale, flag.name).toBeGreaterThan(legOuter);
      }
    },
  );

  test('no portal sits in the camera wrap window', () => {
    // La telecamera sta PLAYER_Z dietro al giocatore: a z = 0
    // `updateVisible` comincia a disegnare dai penultimi segmenti della
    // stessa tappa, con una scala di proiezione minuscola. Uno sprite
    // largo come un portale su quei segmenti coprirebbe tutto lo schermo
    // al primo fotogramma della tappa (spec §4.4e).
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (let i = segs.length - CAMERA_WRAP_GUARD; i < segs.length; i++) {
        for (const placed of segs[i].sprites) {
          expect(CATALOG[placed.name].scale, `${stage.id} seg ${i} ${placed.name}`).toBeLessThan(0.3);
        }
      }
    }
    // `FLAGMAN_FROM_END = 12` è la costante che il codice usa già per
    // tenere l'uomo con la bandiera fuori da quella finestra: i portali la
    // riusano, non ne aggiungono una seconda.
    expect(FLAGMAN_FROM_END).toBeGreaterThan(CAMERA_WRAP_GUARD);
  });

  test('the goal portal shares the flagman segment', () => {
    const segs = buildTrack(stageById('4-0'));
    const at = portalIndex(segs.length);
    expect(at).toBe(segs.length - 1 - FLAGMAN_FROM_END);
    // Il flagman lo mette già `placeSpectators`: questo task non lo sposta.
    expect(namesOn(segs[at])).toContain('common_flagman');
    expect(namesOn(segs[at])).toContain('race_goal');
  });

  test('placing the portals does not move any other sprite: the rng is untouched', () => {
    // `placePortals` non usa numeri casuali, quindi due costruzioni della
    // stessa tappa restano identiche e il tracciato resta deterministico
    // dal seme (spec §9).
    const a = buildTrack(stageById('2-1'));
    const b = buildTrack(stageById('2-1'));
    expect(a.map((s) => s.sprites.map((p) => `${p.name}@${p.offset.toFixed(4)}`).join(','))).toEqual(
      b.map((s) => s.sprites.map((p) => `${p.name}@${p.offset.toFixed(4)}`).join(',')),
    );
  });

  test('the fork zone is still 200 segments and the tail still closes flat', () => {
    const segs = buildTrack(stageById('3-2'));
    expect(segs[segs.length - FORK_ZONE_SEGMENTS].fork).toBe('zone');
    expect(segs[segs.length - 1].p2.world.y).toBe(0);
    expect(segs[segs.length - 1].curve).toBe(0);
  });
});
