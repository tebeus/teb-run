import { describe, expect, test } from 'vitest';
import { PLAYER_Z, SEGMENT_LENGTH } from '../../src/render/project';
import { mulberry32 } from '../../src/core/rng';
import { STAGE_LIST } from '../../src/game/stages';
import {
  CHEVRON_INNER_COUNT,
  CHEVRON_INNER_GAP,
  CHEVRON_MIN_CURVE,
  CHEVRON_NAME,
  CHEVRON_OFFSET,
  CHEVRON_ROW_MAX,
  CHEVRON_ROW_MIN,
  CHEVRON_ROW_STEP_MAX,
  CHEVRON_ROW_STEP_MIN,
  CROWD_NAME,
  CROWD_OFFSET,
  CROWD_SEGMENTS,
  CROWD_START,
  FLAGMAN_FROM_END,
  FLAGMAN_NAME,
  FORK_ZONE_SEGMENTS,
  HARD_CURVE,
  SECTION_KINDS,
  SIGN_ZONE_FIRST,
  addKind,
  buildTrack,
  curveEntries,
  curveSpanEnd,
  peakCurve,
  sectionWeights,
} from '../../src/game/track';
import type { PlacedSprite, Segment } from '../../src/types';
import { makeSegment } from '../helpers/segments';

/** Tutti gli sprite piazzati, con il loro segmento. */
function placed(segs: readonly Segment[]): { index: number; sprite: PlacedSprite }[] {
  const out: { index: number; sprite: PlacedSprite }[] = [];
  segs.forEach((seg, index) => seg.sprites.forEach((sprite) => out.push({ index, sprite })));
  return out;
}

describe('chicane (spec §9)', () => {
  test('it is a section kind with a weight that grows with the difficulty', () => {
    expect(SECTION_KINDS).toContain('chicane');
    // Deroga a spec §9: 1 + 14·d → 3 + 18·d (frena troppo in curva, spec §5/§9).
    expect(sectionWeights(0).chicane).toBeCloseTo(3, 10);
    expect(sectionWeights(1).chicane).toBeCloseTo(21, 10);
    expect(sectionWeights(0.5).chicane).toBeCloseTo(12, 10);
  });

  test('the curve flips sign between two consecutive segments, with no straight in between', () => {
    const segs: Segment[] = [];
    addKind(segs, 'beach', 'chicane', mulberry32(7), 400);
    expect(segs.length).toBeGreaterThan(20);
    let flips = 0;
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1].curve;
      const b = segs[i].curve;
      if (a * b >= 0) continue;
      flips++;
      // Il salto è netto: entrambi i lati sono già a curvatura piena.
      expect(Math.abs(a)).toBeGreaterThanOrEqual(CHEVRON_MIN_CURVE);
      expect(Math.abs(b)).toBeGreaterThanOrEqual(CHEVRON_MIN_CURVE);
    }
    expect(flips).toBe(1);
  });

  test('an sCurve instead passes through zero: the two are different sections', () => {
    const segs: Segment[] = [];
    addKind(segs, 'beach', 'sCurve', mulberry32(7), 400);
    const zeros = segs.filter((seg) => Math.abs(seg.curve) < 0.001).length;
    expect(zeros).toBeGreaterThan(0);
  });

  test('it starts and ends at zero curvature, so the stage still closes', () => {
    // La coda della chicane esce dalla curva con lo stesso `easeInOut` di
    // `addRoad` usato da ogni altra sezione: il ciclo campiona t = n/leave
    // per n fino a leave-1, quindi non tocca mai t = 1 esattamente. Il residuo
    // (qui sotto 0.04 con enter/leave sui 20-40 segmenti tipici di questo
    // budget) è lo stesso di curveEasy, curveHard e sCurve; nella tappa vera
    // `addFlatten` lo azzera comunque prima della fine. `toBeCloseTo(0, 1)`
    // resta comunque stretto: coglierebbe un residuo grande come mezza unità
    // di curvatura, non solo l'arrotondamento in virgola mobile.
    for (const seed of [1, 2, 3, 42]) {
      const segs: Segment[] = [];
      addKind(segs, 'desert', 'chicane', mulberry32(seed), 400);
      expect(segs[0].curve, `seed ${seed}`).toBeCloseTo(0, 10);
      expect(segs[segs.length - 1].curve, `seed ${seed}`).toBeCloseTo(0, 1);
    }
  });

  test('it stays inside its budget and never climbs', () => {
    const segs: Segment[] = [];
    addKind(segs, 'alpine', 'chicane', mulberry32(9), 200);
    expect(segs.length).toBeLessThanOrEqual(200);
    for (const seg of segs) expect(seg.p2.world.y).toBe(seg.p1.world.y);
  });

  test('every real stage still closes flat with chicanes in the mix', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const last = segs[segs.length - 1];
      expect(last.curve, stage.id).toBe(0);
      expect(last.p2.world.y, stage.id).toBe(0);
    }
  });

  test('the hardest stages contain at least one chicane', () => {
    // Peso 1 + 14 · 0.85 = 12,9 su un totale di circa 100: su venti sezioni
    // è praticamente certa, e il seme è fisso. Il task 23 (spec §9) aggiunge
    // la sezione `dualRoad` ai pesi: cambia il totale e quindi la sequenza
    // pseudocasuale di sezioni per ogni tappa. Con il seme fisso una delle
    // quattro tappe più difficili (4-2) non pesca più una chicane: la
    // certezza resta statistica, non assoluta, quindi la soglia tollera
    // una tappa su quattro.
    const hard = STAGE_LIST.filter((st) => st.difficulty >= 0.75);
    let found = 0;
    for (const stage of hard) {
      const segs = buildTrack(stage);
      for (let i = 1; i < segs.length; i++) {
        const a = segs[i - 1].curve;
        const b = segs[i].curve;
        if (a * b < 0 && Math.abs(a) >= CHEVRON_MIN_CURVE && Math.abs(b) >= CHEVRON_MIN_CURVE) {
          found++;
          break;
        }
      }
    }
    expect(found).toBeGreaterThanOrEqual(hard.length - 1);
  });
});

describe('curveEntries e placeChevrons (spec §13)', () => {
  test('an entry is the first segment of each strong curve run', () => {
    const segs = [0, 0, 4, 4, 4, 0, 0, -6, -6, 0].map((curve, i) => makeSegment(i, { curve }));
    expect(curveEntries(segs)).toEqual([2, 7]);
  });

  test('a gentle curve gets no entry', () => {
    const segs = [0, 2, 2, 2, 0].map((curve, i) => makeSegment(i, { curve }));
    expect(curveEntries(segs)).toEqual([]);
  });

  test('a chicane counts as one entry: the curvature never drops', () => {
    const segs = [0, 4, 4, -4, -4, 0].map((curve, i) => makeSegment(i, { curve }));
    expect(curveEntries(segs)).toEqual([1]);
  });

  // L'esterno di una curva locale in `index` è il lato opposto al suo segno:
  // `curve > 0` gira a destra, quindi l'esterno è a sinistra (offset < 0).
  const outerSign = (segs: readonly Segment[], index: number): number => (segs[index].curve > 0 ? -1 : 1);

  // Finestra di una curva: dal suo ingresso alla prossima entrata (o alla
  // fine del tracciato). Più larga di `curveSpanEnd` perché il passo della
  // fila è casuale (6-8) e l'ultimo cartello può cadere qualche segmento
  // dopo la fine della curva forte senza sconfinare nella prossima.
  const curveWindow = (entries: readonly number[], k: number, segsLength: number): number =>
    k + 1 < entries.length ? entries[k + 1] : segsLength;

  test('every medium-or-worse curve gets a row of 3 to 8 chevrons on the outside, one every 6 to 8 segments', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const entries = curveEntries(segs);
      let curvesWithRow = 0;
      for (let k = 0; k < entries.length; k++) {
        const entry = entries[k];
        const end = curveSpanEnd(segs, entry);
        const windowEnd = curveWindow(entries, k, segs.length);
        const outer = placed(segs)
          .filter(
            (p) =>
              p.sprite.name === CHEVRON_NAME &&
              p.index >= entry &&
              p.index < windowEnd &&
              Math.sign(p.sprite.offset) === outerSign(segs, p.index),
          )
          .sort((a, b) => a.index - b.index);
        // Una fila che tocca il bordo escluso può avere meno segni: qui si
        // controlla solo quando la curva sta tutta in zona ammessa.
        if (entry < SIGN_ZONE_FIRST || end >= segs.length - FORK_ZONE_SEGMENTS) continue;
        curvesWithRow++;
        expect(outer.length, `${stage.id} curve at ${entry}`).toBeGreaterThanOrEqual(CHEVRON_ROW_MIN);
        expect(outer.length, `${stage.id} curve at ${entry}`).toBeLessThanOrEqual(CHEVRON_ROW_MAX);
        expect(outer[0].index, `${stage.id} curve at ${entry}`).toBe(entry);
        for (let n = 1; n < outer.length; n++) {
          const step = outer[n].index - outer[n - 1].index;
          expect(step, `${stage.id} curve at ${entry}, sign ${n}`).toBeGreaterThanOrEqual(CHEVRON_ROW_STEP_MIN);
          expect(step, `${stage.id} curve at ${entry}, sign ${n}`).toBeLessThanOrEqual(CHEVRON_ROW_STEP_MAX);
        }
      }
      expect(curvesWithRow, stage.id).toBeGreaterThan(0);
    }
  });

  test('the row stands off the road, on the outside, with the tip pointing into the local curve', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const entries = curveEntries(segs);
      for (let k = 0; k < entries.length; k++) {
        const entry = entries[k];
        const windowEnd = curveWindow(entries, k, segs.length);
        for (const sign of placed(segs).filter(
          (p) =>
            p.sprite.name === CHEVRON_NAME &&
            p.index >= entry &&
            p.index < windowEnd &&
            Math.sign(p.sprite.offset) === outerSign(segs, p.index),
        )) {
          expect(Math.abs(sign.sprite.offset)).toBeCloseTo(CHEVRON_OFFSET, 10);
          const local = segs[sign.index].curve > 0;
          expect(sign.sprite.flip ?? false, `${stage.id} at ${sign.index}`).toBe(local);
        }
      }
    }
  });

  test('a hard curve also gets two chevrons on the inside, close together, at the entry', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      for (const entry of curveEntries(segs)) {
        if (entry < SIGN_ZONE_FIRST || Math.abs(peakCurve(segs, entry)) < HARD_CURVE) continue;
        const right = segs[entry].curve > 0;
        const innerSign = right ? 1 : -1;
        const inner = placed(segs).filter(
          (p) =>
            p.sprite.name === CHEVRON_NAME &&
            p.index >= entry &&
            p.index < entry + CHEVRON_INNER_COUNT * CHEVRON_INNER_GAP &&
            Math.sign(p.sprite.offset) === innerSign,
        );
        expect(inner.length, `${stage.id} hard curve at ${entry}`).toBeGreaterThan(0);
      }
    }
  });

  test('no chevron in the intro straight, in the fork exit or in the fork zone', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (const sign of placed(segs).filter((p) => p.sprite.name === CHEVRON_NAME)) {
        expect(sign.index, stage.id).toBeGreaterThanOrEqual(SIGN_ZONE_FIRST);
        expect(sign.index, stage.id).toBeLessThan(zoneStart);
      }
    }
  });
});

describe('placeSpectators (spec §13, Set 4)', () => {
  test('the crowd lines 40 segments after the start and the last 40 before the fork', () => {
    const segs = buildTrack(STAGE_LIST[0]);
    const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
    const rows = placed(segs).filter((p) => p.sprite.name === CROWD_NAME);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const atStart = row.index >= CROWD_START && row.index < CROWD_START + CROWD_SEGMENTS;
      const atFinish = row.index >= zoneStart - CROWD_SEGMENTS && row.index < zoneStart;
      expect(atStart || atFinish, `segment ${row.index}`).toBe(true);
      expect(Math.abs(row.sprite.offset)).toBeCloseTo(CROWD_OFFSET, 10);
    }
  });

  test('la prima fila non sta sui segmenti che il giro della telecamera avvicina', () => {
    const segs = buildTrack(STAGE_LIST[0]);
    const rows = placed(segs).filter((p) => p.sprite.name === CROWD_NAME);
    const first = Math.min(...rows.map((r) => r.index));
    // Appena entrati in una tappa la telecamera sta PLAYER_Z prima dello
    // zero: una fila piu vicina di cosi le finirebbe davanti a un pixel.
    expect(first).toBeGreaterThan(PLAYER_Z / SEGMENT_LENGTH + 1);
  });

  test('the crowd alternates sides', () => {
    const segs = buildTrack(STAGE_LIST[0]);
    const sides = placed(segs)
      .filter((p) => p.sprite.name === CROWD_NAME)
      .map((p) => Math.sign(p.sprite.offset));
    expect(new Set(sides).size).toBe(2);
    for (let i = 1; i < sides.length; i++) {
      if (sides[i] === sides[i - 1]) {
        // Un cambio di tratto può ripetere un lato: basta che non sia sempre lo stesso.
        expect(sides.filter((v) => v === 1).length).toBeGreaterThan(1);
      }
    }
  });

  test('never inside the fork zone', () => {
    for (const stage of STAGE_LIST) {
      const segs = buildTrack(stage);
      const zoneStart = segs.length - FORK_ZONE_SEGMENTS;
      for (let i = zoneStart; i < segs.length; i++) {
        for (const sprite of segs[i].sprites) {
          expect(sprite.name, `${stage.id} at ${i}`).not.toBe(CROWD_NAME);
        }
      }
    }
  });

  test('the flagman waits just before the end of a level 4 stage, and only there', () => {
    const last = STAGE_LIST.filter((st) => st.id.startsWith('4-'));
    for (const stage of last) {
      const segs = buildTrack(stage);
      const flags = placed(segs).filter((p) => p.sprite.name === FLAGMAN_NAME);
      expect(flags, stage.id).toHaveLength(1);
      expect(flags[0].index, stage.id).toBe(segs.length - 1 - FLAGMAN_FROM_END);
      expect(Math.abs(flags[0].sprite.offset), stage.id).toBeGreaterThan(1);
      // Non sull'ultimo segmento: all'inizio della tappa la telecamera sta
      // PLAYER_Z prima della fine del tracciato, e quel segmento le
      // finirebbe davanti a un pixel di distanza.
      const cameraBehindEnd = PLAYER_Z / SEGMENT_LENGTH;
      expect(FLAGMAN_FROM_END, 'oltre la telecamera all ingresso').toBeGreaterThan(cameraBehindEnd + 1);
    }
    for (const stage of STAGE_LIST.filter((st) => !st.id.startsWith('4-'))) {
      const segs = buildTrack(stage);
      expect(placed(segs).filter((p) => p.sprite.name === FLAGMAN_NAME), stage.id).toHaveLength(0);
    }
  });

  test('the bathers are beach scenery, not spectators of every theme', () => {
    const beach = placed(buildTrack(STAGE_LIST[0])).filter((p) => p.sprite.name === 'beach_bathers');
    expect(beach.length).toBeGreaterThan(0);
    const desert = STAGE_LIST.find((st) => st.theme === 'desert') as (typeof STAGE_LIST)[number];
    expect(placed(buildTrack(desert)).filter((p) => p.sprite.name === 'beach_bathers')).toHaveLength(0);
  });
});

describe('determinismo con le aggiunte', () => {
  test('the same seed gives the same signs, crowd and chicanes', () => {
    for (const stage of STAGE_LIST) {
      const shape = (segs: Segment[]): string =>
        segs.map((seg) => `${seg.curve}|${seg.sprites.map((p) => `${p.name}@${p.offset}${p.flip ? 'F' : ''}`).join(',')}`).join(';');
      expect(shape(buildTrack(stage)), stage.id).toBe(shape(buildTrack(stage)));
    }
  });
});
