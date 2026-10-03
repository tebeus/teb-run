import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_W } from '../../src/core/canvas';
import {
  bannerText,
  CHECKPOINT_BANNER_W,
  drawCheckpointBanner,
  drawForkArrows,
  drawStartLights,
  extendTimeText,
  forkArrowX,
  FORK_ARROW_W,
  litLamps,
  renderHud,
  START_LAMPS,
  START_LIGHTS_W,
  START_LIGHTS_Y,
  startLightPhase,
} from '../../src/render/hud';
import { STAGE_SPECS } from '../../src/game/stages';
import { GLYPHS, measureText } from '../../src/ui/text';
import type { AssetStore, RaceSnapshot, SpriteAsset, StageDef } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';

const STAGE: StageDef = {
  id: '0-0',
  name: 'Palm Bay',
  theme: 'beach',
  lengthSegments: 2260,
  timeLimit: 88,
  seed: 1,
  difficulty: 0.15,
};

function snapshot(countdown?: number): RaceSnapshot {
  return {
    segments: [],
    player: {
      x: 0,
      z: 0,
      speed: 0,
      gear: 'lo',
      steer: 0,
      offRoad: false,
      braking: false,
      accelerating: false,
      surface: 'road',
      skidding: false,
      steerHeld: 0,
    },
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 88,
    score: 0,
    stage: STAGE,
    level: 0,
    route: [],
    parallax: { far: 0, near: 0, y: 0 },
    theme: 'beach',
    banner: 'none',
    kmh: 0,
    ...(countdown === undefined ? {} : { countdown }),
  };
}

const store = (w = 520, h = 180): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w,
    h,
    entry: CATALOG[name] ?? { kind: 'ui', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

describe('semaforo di partenza (spec §4.4e)', () => {
  test('the phase follows the countdown, and no countdown means no lights', () => {
    expect(startLightPhase(undefined)).toBe('none');
    expect(startLightPhase(3)).toBe('red1');
    expect(startLightPhase(2.4)).toBe('red1');
    expect(startLightPhase(2)).toBe('red2');
    expect(startLightPhase(1.2)).toBe('red2');
    expect(startLightPhase(1)).toBe('green');
    expect(startLightPhase(0.3)).toBe('green');
    expect(startLightPhase(0)).toBe('go');
    expect(startLightPhase(-0.5)).toBe('go');
  });

  test('one lamp, then two, then the two green ones', () => {
    expect(START_LAMPS).toBe(5);
    expect(litLamps('red1')).toEqual([0]);
    expect(litLamps('red2')).toEqual([0, 1]);
    expect(litLamps('green')).toEqual([3, 4]);
    expect(litLamps('go')).toEqual([3, 4]);
    expect(litLamps('none')).toEqual([]);
  });

  test('a snapshot without countdown draws no start lights', () => {
    const rec = createRecordCtx();
    renderHud(rec.ctx, snapshot(), store());
    expect(rec.images().some((op) => op.image === 'race_start_lights')).toBe(false);
  });

  test('with the pause menu open the lights and READY are hidden, and come back on resume', () => {
    const open = createRecordCtx();
    renderHud(open.ctx, snapshot(2.4), store(), { paused: true });
    expect(open.images().some((op) => op.image === 'race_start_lights')).toBe(false);
    // Senza semaforo né READY restano solo le righe dell'HUD: meno riempimenti.
    const closed = createRecordCtx();
    renderHud(closed.ctx, snapshot(2.4), store());
    expect(closed.images().some((op) => op.image === 'race_start_lights')).toBe(true);
    expect(open.fills().length).toBeLessThan(closed.fills().length);
    const bare = createRecordCtx();
    renderHud(bare.ctx, snapshot(), store());
    expect(open.fills().length).toBe(bare.fills().length);
  });

  test('during the countdown the housing is drawn centred, with the lit lamps over it', () => {
    const rec = createRecordCtx();
    drawStartLights(rec.ctx, store(), 'red2');
    const housing = rec.images().find((op) => op.image === 'race_start_lights');
    expect(housing).toBeDefined();
    expect(housing!.args[0]).toBeCloseTo(LOGICAL_W / 2 - START_LIGHTS_W / 2, 6);
    expect(housing!.args[1]).toBe(START_LIGHTS_Y);
    expect(housing!.args[2]).toBe(START_LIGHTS_W);
    // Due lampade rosse accese e tre spente: il PNG le ha tutte accese,
    // quindi le non accese si coprono (deroga 9 di questo piano).
    const reds = rec.ops.filter((op) => op.type === 'fill' && op.fill === '#ff3333');
    expect(reds).toHaveLength(2);
    const off = rec.ops.filter((op) => op.type === 'fill' && op.fill === '#3a2020');
    expect(off).toHaveLength(3);
  });

  test('READY while the clock runs, GO when it is done', () => {
    const ready = createRecordCtx();
    drawStartLights(ready.ctx, store(), 'green');
    const go = createRecordCtx();
    drawStartLights(go.ctx, store(), 'go');
    // Il font a pixel disegna un fillRect per pixel acceso: READY (5
    // lettere) e GO! (3) hanno un numero di riempimenti diverso.
    expect(ready.fills().length).not.toBe(go.fills().length);
    expect(ready.fills().length).toBeGreaterThan(0);
    expect(go.fills().length).toBeGreaterThan(0);
  });

  test('an asset with no size draws the lamps anyway and never divides by zero', () => {
    const rec = createRecordCtx();
    drawStartLights(rec.ctx, store(0, 0), 'green');
    expect(rec.images()).toHaveLength(0);
    const greens = rec.ops.filter((op) => op.type === 'fill' && op.fill === '#33cc44');
    expect(greens).toHaveLength(2);
    expect(rec.ops.filter((op) => op.type === 'fill' && op.fill === '#3a2020')).toHaveLength(3);
    for (const op of rec.ops) for (const n of op.args) expect(Number.isFinite(n)).toBe(true);
  });
});

describe('striscione del checkpoint (spec §4.4e, §8)', () => {
  test('the banner says EXTEND TIME, not CHECKPOINT', () => {
    expect(bannerText('checkpoint')).toEqual(['EXTEND TIME']);
  });

  test('the plus sign has a glyph: without one the banner would read ?87', () => {
    // `src/ui/text.ts` ha 51 glifi (0-9 A-Z .,:!?-'"/<>) e non aveva il
    // `+`: `glyphFor` ripiega su '?', e a schermo il banner del checkpoint
    // diceva `?87` invece di `+87`. Verificato a schermo.
    expect(Object.prototype.hasOwnProperty.call(GLYPHS, '+')).toBe(true);
  });

  test('the added seconds are rounded and signed', () => {
    expect(extendTimeText(88)).toBe('+88');
    expect(extendTimeText(86.4)).toBe('+86');
    expect(extendTimeText(0)).toBeNull();
    expect(extendTimeText(undefined)).toBeNull();
    expect(extendTimeText(Number.NaN)).toBeNull();
  });

  test('the banner plate is drawn centred with the two lines over it', () => {
    const rec = createRecordCtx();
    drawCheckpointBanner(rec.ctx, store(900, 220), 86);
    const plate = rec.images().find((op) => op.image === 'race_finish_banner');
    expect(plate).toBeDefined();
    expect(plate!.args[0]).toBeCloseTo(LOGICAL_W / 2 - CHECKPOINT_BANNER_W / 2, 6);
    expect(plate!.args[2]).toBe(CHECKPOINT_BANNER_W);
    expect(rec.fills().length).toBeGreaterThan(40);
  });

  test('a checkpoint banner without extendTime draws only the words', () => {
    const withNumber = createRecordCtx();
    drawCheckpointBanner(withNumber.ctx, store(900, 220), 86);
    const without = createRecordCtx();
    drawCheckpointBanner(without.ctx, store(900, 220), undefined);
    expect(without.fills().length).toBeGreaterThan(0);
    expect(without.fills().length).toBeLessThan(withNumber.fills().length);
  });

  test('the fork arrows are drawn on both sides, the left one mirrored', () => {
    const rec = createRecordCtx();
    drawForkArrows(rec.ctx, store(420, 200));
    expect(rec.images()).toHaveLength(2);
    // Lo specchio è una scala -1 in x dentro un save/restore.
    expect(rec.ops.some((op) => op.type === 'scale' && op.args[0] === -1)).toBe(true);
    const saves = rec.ops.filter((op) => op.type === 'save').length;
    const restores = rec.ops.filter((op) => op.type === 'restore').length;
    expect(saves).toBe(restores);
  });

  test('a zero-sized arrow asset draws nothing', () => {
    const rec = createRecordCtx();
    drawForkArrows(rec.ctx, store(0, 0));
    expect(rec.images()).toHaveLength(0);
  });
});

describe('posizione delle frecce del bivio (revisione Task 7, finding Important)', () => {
  // Revisione: `FORK_ARROW_X = 240` fisso si sovrapponeva al testo del bivio
  // con i nomi reali più lunghi (es. `< SANDSTONE GATE`, primo bivio del
  // gioco). `forkArrowX` sostituisce la costante con una funzione pura che
  // misura il testo effettivo, come `bannerText` lo disegna in `renderHud`
  // (scala 4), e lascia un margine di 24 px.
  const SCALE = 4;
  const MARGIN = 24;
  const SCREEN_MARGIN = 16;

  test('never overlaps the two longest real stage names, at any pairing', () => {
    const longest = [...STAGE_SPECS].map((s) => s.name).sort((a, b) => b.length - a.length).slice(0, 2) as [
      string,
      string,
    ];
    const [left, right] = longest;
    const x = forkArrowX(longest, SCALE);
    const leftTextHalf = measureText(`< ${left.toUpperCase()}`, SCALE) / 2;
    const rightTextHalf = measureText(`${right.toUpperCase()} >`, SCALE) / 2;
    // Il bordo della freccia più vicino al centro resta oltre il margine dal testo.
    expect(LOGICAL_W / 2 - x).toBeLessThanOrEqual(LOGICAL_W / 2 - leftTextHalf - MARGIN + 1e-6);
    expect(LOGICAL_W / 2 + x).toBeGreaterThanOrEqual(LOGICAL_W / 2 + rightTextHalf + MARGIN - 1e-6);
  });

  test('stays within the screen even for names longer than any real stage', () => {
    const huge: [string, string] = ['A VERY VERY LONG STAGE NAME INDEED', 'ANOTHER EQUALLY LONG STAGE NAME'];
    const x = forkArrowX(huge, SCALE);
    expect(LOGICAL_W / 2 - x).toBeGreaterThanOrEqual(SCREEN_MARGIN);
    expect(LOGICAL_W / 2 + x + FORK_ARROW_W).toBeLessThanOrEqual(LOGICAL_W - SCREEN_MARGIN);
  });

  test('falls back to a placeholder pair without throwing when names are missing', () => {
    expect(() => forkArrowX(undefined, SCALE)).not.toThrow();
    expect(forkArrowX(undefined, SCALE)).toBeGreaterThan(0);
  });

  test('drawForkArrows widens the gap for a long real name pair versus a short one', () => {
    const short = createRecordCtx();
    drawForkArrows(short.ctx, store(420, 200), ['Palm Bay', 'Old Harbor']);
    const long = createRecordCtx();
    drawForkArrows(long.ctx, store(420, 200), ['Sandstone Gate', 'Windmill Coast']);
    const rightArrowX = (rec: ReturnType<typeof createRecordCtx>): number =>
      rec.images().filter((op) => op.args[0] > LOGICAL_W / 2)[0]!.args[0];
    expect(rightArrowX(long)).toBeGreaterThan(rightArrowX(short));
  });
});
