import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  CLOUDS_TILE_W,
  CLOUD_DIP,
  CLOUD_DRIFT_PX_S,
  CLOUD_LIFT,
  CLOUD_Y_AMPLITUDE,
  cloudsBottomY,
  FAR_Y_AMPLITUDE,
  HORIZON_RATIO,
  NEAR_Y_AMPLITUDE,
  CLOUD_FADE_PX,
  fadeToSky,
  filteredImage,
  LAYER_FADE_PX,
  nearScaleForFar,
  renderBackground,
  tileStartX,
  topFadedImage,
} from '../../src/render/background';
import { PALETTES, rgbaOf, skyColourAt } from '../../src/render/palette';
import type { AssetStore, SpriteAsset, SpriteName } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';

describe('tileStartX', () => {
  test('offset zero starts at the left edge', () => {
    expect(tileStartX(0, 2048)).toBe(0);
  });

  test('a quarter of an offset shifts the tiles a quarter of the image', () => {
    expect(tileStartX(0.25, 100)).toBeCloseTo(-25, 10);
    expect(tileStartX(0.75, 100)).toBeCloseTo(-75, 10);
  });

  test('the result is always inside (-imgW, 0]', () => {
    for (const off of [-3.7, -0.25, 0, 0.5, 1, 1.25, 9.9]) {
      const x = tileStartX(off, 100);
      expect(x, `${off}`).toBeGreaterThan(-100);
      expect(x, `${off}`).toBeLessThanOrEqual(0);
    }
  });

  test('offsets one apart give the same start, so scrolling is seamless', () => {
    expect(tileStartX(1.25, 100)).toBeCloseTo(tileStartX(0.25, 100), 10);
    expect(tileStartX(-0.75, 100)).toBeCloseTo(tileStartX(0.25, 100), 10);
  });
});

describe('background layout constants', () => {
  test('the horizon sits where the projection vanishes, at half the height', () => {
    expect(HORIZON_RATIO).toBe(0.5);
  });

  test('the near layer moves more than the far one with hills', () => {
    expect(NEAR_Y_AMPLITUDE).toBeGreaterThan(FAR_Y_AMPLITUDE);
  });
});

describe('nearScaleForFar: quanto ridurre `near` perché il `far` dedicato resti visibile', () => {
  test('senza far dedicato non si tocca nulla', () => {
    expect(nearScaleForFar(260, 220, false)).toBe(1);
  });

  test('near già basso abbastanza (≤ metà del far): nessuna riduzione', () => {
    expect(nearScaleForFar(100, 220, true)).toBe(1);
    expect(nearScaleForFar(110, 220, true)).toBe(1); // esattamente la metà
  });

  test('near più alto della metà del far dedicato: si riduce fino a farla stare', () => {
    // '4-4' Sunset Lagoon: near 260, far dedicato 220 → 220/2/260.
    const scale = nearScaleForFar(260, 220, true);
    expect(scale).toBeCloseTo(220 / 2 / 260, 10);
    expect(scale * 260).toBeCloseTo(110, 10); // metà del far, non meno
  });

  test('input non validi (0, negativi, non finiti) non riducono', () => {
    expect(nearScaleForFar(0, 220, true)).toBe(1);
    expect(nearScaleForFar(260, 0, true)).toBe(1);
    expect(nearScaleForFar(-10, 220, true)).toBe(1);
    expect(nearScaleForFar(Number.NaN, 220, true)).toBe(1);
  });

  // Le dieci tappe con un far dedicato (consegna v2): altezza nativa del
  // `near` del tema e del `far_<id>` reale (public/sprites/manifest.json).
  // In ognuna, ridotto o non, la metà del far resta sopra di lui.
  test.each([
    ['1-1 Blue Lagoon (beach)', 260, 220],
    ['4-4 Sunset Lagoon (beach)', 260, 220],
    ['2-0 Red Canyon (desert)', 210, 220],
    ['3-3 Salt Flats (desert)', 210, 220],
    ['4-3 (desert)', 210, 220],
    ['3-1 Cloud Ridge (alpine)', 244, 260],
    ['4-1 (alpine)', 244, 260],
    ['3-2 (farm)', 260, 220],
    ['4-2 (farm)', 260, 220],
    ['4-0 (town)', 216, 240],
  ])('%s: near scalato non supera metà del far', (_label, nearH, farH) => {
    const scale = nearScaleForFar(nearH, farH, true);
    expect(scale).toBeLessThanOrEqual(1);
    expect(nearH * scale).toBeLessThanOrEqual(farH / 2 + 1e-9);
  });
});

describe('strato di nuvole (spec §4.4c)', () => {
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: name.endsWith('_clouds') ? CLOUDS_TILE_W : 2048,
      h: name.endsWith('_clouds') ? 256 : 220,
      entry: { kind: 'background', scale: 1, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  test('the cloud strip of the theme is drawn', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720);
    expect(rec.ops.some((op) => op.type === 'drawImage' && op.image === 'bg_beach_clouds')).toBe(true);
  });

  test('the clouds sit above the horizon, behind the far layer', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720);
    const drawn = rec.ops.filter((op) => op.type === 'drawImage');
    const clouds = drawn.find((op) => op.image === 'bg_beach_clouds');
    const far = drawn.find((op) => op.image === 'bg_beach_far');
    expect(drawn.indexOf(clouds!)).toBeLessThan(drawn.indexOf(far!));
    // args di drawImage a 4 argomenti: x, y, w, h
    expect(clouds!.args[1] + clouds!.args[3]).toBeLessThanOrEqual(720 * HORIZON_RATIO - CLOUD_LIFT + 0.001);
  });

  test('a snapshot without the cloud offset still draws them, at zero', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.town, { far: 0, near: 0, y: 0 }, store(), 1280, 720);
    expect(rec.ops.some((op) => op.type === 'drawImage' && op.image === 'bg_town_clouds')).toBe(true);
  });

  test('the drift is six pixels a second (spec §4.4c)', () => {
    expect(CLOUD_DRIFT_PX_S).toBe(6);
  });

  test('il fondo della striscia sta dietro la cima dello strato far, non sull orizzonte', () => {
    // far alto 142 px: la cima e a 360 - 142 = 218, le nuvole finiscono 20 px
    // sotto quella cima, cioe a 238, non a 360 - 24 = 336.
    expect(cloudsBottomY(360, 142, 0)).toBeCloseTo(238, 10);
    expect(cloudsBottomY(360, 142, 0)).toBeLessThan(360 - CLOUD_LIFT);
  });

  test('uno strato far basso non tira le nuvole giu sull orizzonte', () => {
    expect(cloudsBottomY(360, 10, 0)).toBeCloseTo(360 - CLOUD_LIFT, 10);
    expect(cloudsBottomY(360, 0, 0)).toBeCloseTo(360 - CLOUD_LIFT, 10);
    expect(cloudsBottomY(360, Number.NaN, 0)).toBeCloseTo(360 - CLOUD_LIFT, 10);
  });

  test('le nuvole seguono le colline come prima', () => {
    expect(cloudsBottomY(360, 142, 1) - cloudsBottomY(360, 142, 0)).toBeCloseTo(CLOUD_Y_AMPLITUDE, 10);
  });

  test('con lo strato far vero la striscia disegnata non tocca la cima di far', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.desert, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720);
    const drawn = rec.ops.filter((op) => op.type === 'drawImage');
    const clouds = drawn.find((op) => op.image === 'bg_desert_clouds')!;
    const far = drawn.find((op) => op.image === 'bg_desert_far')!;
    const cloudsBottom = clouds.args[1] + clouds.args[3];
    const farTop = far.args[1];
    expect(cloudsBottom).toBeLessThan(farTop + CLOUD_DIP + 0.001);
  });
});

describe('bordo superiore degli strati sfumato nel cielo (spec §4.4)', () => {
  const store = (nearH: number): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 2048,
      h: name.endsWith('_clouds') ? 128 : name.endsWith('_near') ? nearH : 140,
      entry: { kind: 'background', scale: 1, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  test('skyColourAt riproduce i tre stop del gradiente di drawSky', () => {
    const pal = PALETTES.beach;
    expect(skyColourAt(pal, 0, 720)).toBe(pal.sky[0]);
    expect(skyColourAt(pal, 720 * 0.6 * 0.55, 720)).toBe(pal.sky[1]);
    expect(skyColourAt(pal, 720 * 0.6, 720)).toBe(pal.sky[2]);
    // Oltre la fine del gradiente il cielo resta l'ultimo colore, come il canvas.
    expect(skyColourAt(pal, 700, 720)).toBe(pal.sky[2]);
  });

  test('rgbaOf tiene il colore e cambia solo l alfa', () => {
    expect(rgbaOf('#1f6fd0', 1)).toBe('rgba(31,111,208,1)');
    expect(rgbaOf('#1f6fd0', 0)).toBe('rgba(31,111,208,0)');
    // Un colore non esadecimale (per esempio un rgba di palette) passa intatto.
    expect(rgbaOf('rgba(0,0,0,0.1)', 0)).toBe('rgba(0,0,0,0.1)');
  });

  test('fadeToSky dipinge la fascia con un gradiente da cielo opaco a trasparente', () => {
    const rec = createRecordCtx();
    fadeToSky(rec.ctx, PALETTES.beach, 100, 140, 1280, 720);
    const rect = rec.ops.filter((op) => op.type === 'fillRect');
    expect(rect).toHaveLength(1);
    expect(rect[0].args).toEqual([0, 100, 1280, 40]);
    expect(rect[0].fill).toContain(`${rgbaOf(skyColourAt(PALETTES.beach, 100, 720), 1)}|`);
    expect(rect[0].fill).toContain(rgbaOf(skyColourAt(PALETTES.beach, 140, 720), 0));
  });

  test('una fascia di altezza zero non disegna niente', () => {
    const rec = createRecordCtx();
    fadeToSky(rec.ctx, PALETTES.beach, 100, 100, 1280, 720);
    expect(rec.ops.filter((op) => op.type === 'fillRect')).toHaveLength(0);
  });

  test('ogni strato ha la sua fascia sfumata subito dopo il proprio disegno', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(217), 1280, 720);
    const horizon = 720 * HORIZON_RATIO;
    // Il cielo stesso e' un gradiente a tutto schermo: le fasce sono quelle
    // alte esattamente quanto una sfumatura di bordo.
    const fades = rec.ops.filter(
      (op) =>
        op.type === 'fillRect' &&
        String(op.fill).startsWith('gradient(') &&
        (op.args[3] === LAYER_FADE_PX || op.args[3] === CLOUD_FADE_PX),
    );
    const tops = fades.map((op) => op.args[1]);
    // nuvole (cima e fondo), far, near: quattro fasce.
    expect(fades).toHaveLength(4);
    expect(tops).toContain(horizon - 140);
    expect(tops).toContain(horizon - 217);
    for (const op of fades) expect(op.args[2]).toBe(1280);
  });

  test('la fascia di uno strato sta fra il suo disegno e quello dello strato dopo', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(217), 1280, 720);
    const iFar = rec.ops.findIndex((op) => op.image === 'bg_beach_far');
    const iNear = rec.ops.findIndex((op) => op.image === 'bg_beach_near');
    const iFarFade = rec.ops.findIndex(
      (op) => op.type === 'fillRect' && op.args[1] === 720 * HORIZON_RATIO - 140,
    );
    expect(iFarFade).toBeGreaterThan(iFar);
    expect(iFarFade).toBeLessThan(iNear);
  });

  test('uno strato senza immagine non chiede nessuna fascia', () => {
    const rec = createRecordCtx();
    const empty: AssetStore = {
      ready: Promise.resolve(),
      get: (name): SpriteAsset => ({
        name,
        image: { name } as unknown as CanvasImageSource,
        w: 0,
        h: 0,
        entry: { kind: 'background', scale: 1, solid: false, collideW: 0, anchorY: 1 },
      }),
      has: () => true,
      stats: { png: 0, procedural: 0, missing: 0 },
    };
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0 }, empty, 1280, 720);
    const fades = rec.ops.filter(
      (op) => op.type === 'fillRect' && (op.args[3] === LAYER_FADE_PX || op.args[3] === CLOUD_FADE_PX),
    );
    expect(fades).toHaveLength(0);
  });
});

describe('la cima di `near` sfuma in alfa sopra le nuvole (Set 7)', () => {
  /** OffscreenCanvas finto: registra le operazioni del proprio contesto. */
  const made: { w: number; h: number; ops: string[] }[] = [];
  class FakeOffscreen {
    readonly name: string;
    readonly log: { w: number; h: number; ops: string[] };
    constructor(w: number, h: number) {
      this.log = { w, h, ops: [] };
      this.name = `faded_${made.length}`;
      made.push(this.log);
    }
    getContext(): unknown {
      const ops = this.log.ops;
      return {
        set globalCompositeOperation(v: string) {
          ops.push(`gco:${v}`);
        },
        set fillStyle(_v: unknown) {},
        drawImage: () => ops.push('drawImage'),
        createLinearGradient: (_x0: number, y0: number, _x1: number, y1: number) => {
          ops.push(`gradient:${y0}-${y1}`);
          return { addColorStop: () => undefined };
        },
        fillRect: (_x: number, y: number, _w: number, h: number) => ops.push(`fillRect:${y}+${h}`),
      };
    }
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    made.length = 0;
  });

  const asset = (name: string, h: number): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w: 2048,
    h,
    entry: { kind: 'background', scale: 1, solid: false, collideW: 0, anchorY: 1 },
  });

  test('without OffscreenCanvas there is no faded copy', () => {
    expect(topFadedImage(asset('bg_beach_near', 217), LAYER_FADE_PX)).toBeNull();
  });

  test('the copy fades the top rows with a destination-in ramp over the whole height, once per image', () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
    const a = asset('bg_beach_near', 217);
    const first = topFadedImage(a, LAYER_FADE_PX);
    expect(first).not.toBeNull();
    expect(topFadedImage(a, LAYER_FADE_PX)).toBe(first);
    expect(made).toHaveLength(1);
    expect(made[0]).toEqual({
      w: 2048,
      h: 217,
      // Il gradiente copre tutta l'altezza: `destination-in` cancellerebbe
      // tutto ciò che resta fuori dal rettangolo.
      ops: ['drawImage', 'gco:destination-in', 'gradient:0-217', 'fillRect:0+217'],
    });
  });

  test('with the copy, near draws no opaque sky band over the clouds', () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
    const store: AssetStore = {
      ready: Promise.resolve(),
      get: (name) => asset(name, name.endsWith('_clouds') ? 256 : name.endsWith('_near') ? 217 : 140),
      has: () => true,
      stats: { png: 0, procedural: 0, missing: 0 },
    };
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store, 1280, 720);
    const horizon = 720 * HORIZON_RATIO;
    const bands = rec.ops.filter((op) => op.type === 'fillRect' && String(op.fill).startsWith('gradient('));
    const tops = bands.map((op) => op.args[1]);
    expect(tops).toContain(horizon - 140);
    expect(tops).not.toContain(horizon - 217);
    // `near` si disegna dalla copia sfumata, non dall'immagine originale.
    expect(rec.ops.some((op) => op.image === 'bg_beach_near')).toBe(false);
    expect(rec.ops.some((op) => op.image?.startsWith('faded_'))).toBe(true);
  });
});

describe('varianti di sfondo per tappa (spec §4.4f facoltativa, binario L)', () => {
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 2048,
      h: name.endsWith('_clouds') ? 256 : name.endsWith('_near') ? 260 : 220,
      entry: { kind: 'background', scale: 1, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  test('without a stageId nothing changes: same drawImage x and no extra fillRect', () => {
    const withId = createRecordCtx();
    renderBackground(withId.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720);
    const without = createRecordCtx();
    renderBackground(without.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720, undefined, undefined);
    expect(withId.images()).toEqual(without.images());
  });

  test('an unknown stageId falls back to the theme drawing, unchanged', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720, undefined, 'demo-stage');
    const plain = createRecordCtx();
    renderBackground(plain.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720);
    expect(rec.images()).toEqual(plain.images());
  });

  test("1-1's far offset shifts where the tile starts (tileStartX of parallax + STAGE_BACKDROPS offset)", () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720, undefined, '1-1');
    const far = rec.images().find((op) => op.image === 'bg_beach_far')!;
    expect(far.args[0]).toBeCloseTo(-0.3 * 2048, 6); // farOffset di '1-1'
  });

  test('1-1 mirrors the near layer but not far or clouds: scale(-1,1)+translate around near only', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720, undefined, '1-1');
    const iNear = rec.ops.findIndex((op) => op.image === 'bg_beach_near');
    const iFar = rec.ops.findIndex((op) => op.image === 'bg_beach_far');
    const iClouds = rec.ops.findIndex((op) => op.image === 'bg_beach_clouds');
    // Il blocco di 'save' immediatamente prima del disegno del near contiene
    // uno scale(-1,1): quello di far/clouds no.
    const scaleBefore = (drawIndex: number): boolean => {
      for (let i = drawIndex - 1; i >= 0; i--) {
        if (rec.ops[i].type === 'scale') return rec.ops[i].args[0] === -1 && rec.ops[i].args[1] === 1;
        if (rec.ops[i].type === 'drawImage') return false;
      }
      return false;
    };
    expect(scaleBefore(iNear)).toBe(true);
    expect(scaleBefore(iFar)).toBe(false);
    expect(scaleBefore(iClouds)).toBe(false);
  });

  test('without ctx.filter (the test context has none) the fallback veil is drawn over the layer, sized to it, with veilAlpha', () => {
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720, undefined, '4-4');
    const horizon = 720 * HORIZON_RATIO;
    // '4-4' (Sunset Lagoon): veil '#7a3a5e', veilAlpha 0.22, far alto 220.
    const veil = rec.ops.find(
      (op) => op.type === 'fillRect' && op.fill === '#7a3a5e' && op.args[3] === 220 && op.args[1] === horizon - 220,
    );
    expect(veil).toBeDefined();
    expect(veil!.alpha).toBeCloseTo(0.22, 6);
    expect(veil!.args).toEqual([0, horizon - 220, 1280, 220]);
  });

  test('clouds density multiplies globalAlpha at the moment of the draw (no extra drawImage)', () => {
    const rec = createRecordCtx();
    // '3-1' Cloud Ridge: cloudsAlpha 1.4.
    renderBackground(rec.ctx, PALETTES.alpine, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720, undefined, '3-1');
    const clouds = rec.images().filter((op) => op.image === 'bg_alpine_clouds');
    expect(clouds.length).toBeGreaterThan(0);
    for (const op of clouds) expect(op.alpha).toBeCloseTo(1.4, 6);
  });

  test('a transition draws the base layer with the departing stage variant and the overlay with the arriving one', () => {
    const rec = createRecordCtx();
    renderBackground(
      rec.ctx,
      PALETTES.beach,
      { far: 0, near: 0, y: 0, clouds: 0 },
      store(),
      1280,
      720,
      { pal: PALETTES.beach, alpha: 0.5, id: '1-1' },
      '0-0',
    );
    const farOps = rec.images().filter((op) => op.image === 'bg_beach_far');
    // '0-0' Palm Bay non ha farOffset (0); '1-1' Blue Lagoon ne ha 0.3: le
    // due x di partenza restano diverse anche a parallasse ferma.
    const xs = farOps.map((op) => op.args[0]);
    expect(xs).toContain(0); // 0-0, offset 0
    expect(xs).toContain(-0.3 * 2048); // 1-1, offset 0.3
  });

  test("Part B: assets.hasStageBg true makes the stage-specific PNG name win over the theme's", () => {
    type StoreWithStageBg = AssetStore & { hasStageBg(name: SpriteName): boolean };
    const withOverride: StoreWithStageBg = {
      ...store(),
      hasStageBg: (name: SpriteName) => name === 'bg_3-3_far',
    };
    const rec = createRecordCtx();
    renderBackground(rec.ctx, PALETTES.desert, { far: 0, near: 0, y: 0, clouds: 0 }, withOverride, 1280, 720, undefined, '3-3');
    expect(rec.images().some((op) => op.image === 'bg_3-3_far')).toBe(true);
    // near non ha un override secondo hasStageBg: resta quello del tema.
    expect(rec.images().some((op) => op.image === 'bg_desert_near')).toBe(true);
    expect(rec.images().some((op) => op.image === 'bg_3-3_near')).toBe(false);
  });

  describe('a dedicated bg_<id>_far drops the far colour variant (consegna v2)', () => {
    type StoreWithStageBg = AssetStore & { hasStageBg(name: SpriteName): boolean };
    const dedicated = (name: SpriteName): StoreWithStageBg => ({ ...store(), hasStageBg: (n) => n === name });
    const horizon = 720 * HORIZON_RATIO;
    const veilOps = (rec: ReturnType<typeof createRecordCtx>) =>
      rec.ops.filter((op) => op.type === 'fillRect' && op.fill === '#7a3a5e');

    test('fallback veil: none over the dedicated far, still over near (ridotto) and clouds', () => {
      const rec = createRecordCtx();
      renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, dedicated('bg_4-4_far'), 1280, 720, undefined, '4-4');
      expect(rec.images().some((op) => op.image === 'bg_4-4_far')).toBe(true);
      const veils = veilOps(rec);
      expect(veils.some((op) => op.args[1] === horizon - 220 && op.args[3] === 220)).toBe(false);
      // near (260 nativo) è ridotto a metà del far dedicato (220/2 = 110):
      // altrimenti, più alto del far, lo coprirebbe quasi del tutto.
      expect(veils.some((op) => op.args[3] === 260)).toBe(false);
      expect(veils.some((op) => op.args[1] === horizon - 110 && op.args[3] === 110)).toBe(true); // near
      expect(veils.some((op) => op.args[3] === 256)).toBe(true); // nuvole
    });

    test('ctx.filter: none on the dedicated far, the stage filter on near and clouds; far offset kept', () => {
      const rec = createRecordCtx();
      const ctx = rec.ctx as unknown as { filter: string; drawImage: (...a: unknown[]) => void };
      ctx.filter = 'none';
      const seen: Array<[string, string]> = [];
      const draw = ctx.drawImage.bind(ctx);
      ctx.drawImage = (...a: unknown[]) => {
        seen.push([(a[0] as { name: string }).name, ctx.filter]);
        draw(...a);
      };
      renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, dedicated('bg_4-4_far'), 1280, 720, undefined, '4-4');
      const filterOf = (name: string) => seen.find(([n]) => n === name)?.[1];
      expect(filterOf('bg_4-4_far')).toBe('none');
      expect(filterOf('bg_beach_near')).not.toBe('none');
      expect(filterOf('bg_beach_clouds')).not.toBe('none');
      // Nessun velo di ripiego quando il filtro c'è.
      expect(veilOps(rec)).toHaveLength(0);
    });

    test('without the dedicated PNG the shared far keeps its filter', () => {
      const rec = createRecordCtx();
      const ctx = rec.ctx as unknown as { filter: string; drawImage: (...a: unknown[]) => void };
      ctx.filter = 'none';
      const seen: Array<[string, string]> = [];
      const draw = ctx.drawImage.bind(ctx);
      ctx.drawImage = (...a: unknown[]) => {
        seen.push([(a[0] as { name: string }).name, ctx.filter]);
        draw(...a);
      };
      renderBackground(rec.ctx, PALETTES.beach, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720, undefined, '4-4');
      expect(seen.find(([n]) => n === 'bg_beach_far')?.[1]).not.toBe('none');
    });
  });

  describe('the stage filter is baked once off screen, not set per frame (consegna v2)', () => {
    const made: { filter: string; draws: number }[] = [];
    class FakeOffscreen {
      readonly name: string;
      private readonly log = { filter: 'none', draws: 0 };
      constructor() {
        this.name = `baked_${made.length}`;
        made.push(this.log);
      }
      getContext(): unknown {
        const log = this.log;
        return {
          get filter() {
            return log.filter;
          },
          set filter(v: string) {
            log.filter = v;
          },
          set globalCompositeOperation(_v: string) {},
          set fillStyle(_v: unknown) {},
          createLinearGradient: () => ({ addColorStop: () => undefined }),
          fillRect: () => undefined,
          drawImage: () => {
            log.draws++;
          },
        };
      }
    }
    afterEach(() => {
      vi.unstubAllGlobals();
      made.length = 0;
    });

    test('filteredImage makes one copy per image and filter, then reuses it', () => {
      vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
      const a = store().get('bg_beach_far');
      const first = filteredImage(a, 'saturate(1.2)');
      expect(first).not.toBeNull();
      expect(filteredImage(a, 'saturate(1.2)')).toBe(first);
      expect(filteredImage(a, 'saturate(0.9)')).not.toBe(first);
      expect(made).toEqual([
        { filter: 'saturate(1.2)', draws: 1 },
        { filter: 'saturate(0.9)', draws: 1 },
      ]);
      expect(filteredImage(a, '')).toBeNull();
    });

    test('renderBackground never sets ctx.filter when the copy is available, over many frames', () => {
      vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
      const rec = createRecordCtx();
      const sets: string[] = [];
      let current = 'none';
      Object.defineProperty(rec.ctx, 'filter', {
        get: () => current,
        set: (v: string) => {
          current = v;
          sets.push(v);
        },
      });
      // Come il vero `AssetStore`: lo stesso asset (e la stessa immagine) a ogni `get`.
      const base = store();
      const memo = new Map<SpriteName, SpriteAsset>();
      const assets: AssetStore = {
        ...base,
        get: (name) => memo.get(name) ?? (memo.set(name, base.get(name)), memo.get(name)!),
      };
      for (let frame = 0; frame < 5; frame++) {
        renderBackground(rec.ctx, PALETTES.beach, { far: frame / 10, near: 0, y: 0, clouds: 0 }, assets, 1280, 720, undefined, '4-4');
      }
      expect(sets).toEqual([]);
      // Fatte tutte al primo fotogramma: la copia sfumata di near e le tre
      // filtrate (far, near dalla copia sfumata, nuvole).
      expect(made).toHaveLength(4);
      expect(made.filter((m) => m.filter !== 'none')).toHaveLength(3);
      expect(rec.images().every((op) => op.image?.startsWith('baked_'))).toBe(true);
    });
  });

  test('Part B: without hasStageBg (a plain AssetStore) the theme name is always used, and get() never throws', () => {
    const rec = createRecordCtx();
    expect(() =>
      renderBackground(rec.ctx, PALETTES.desert, { far: 0, near: 0, y: 0, clouds: 0 }, store(), 1280, 720, undefined, '3-3'),
    ).not.toThrow();
    expect(rec.images().some((op) => op.image === 'bg_desert_far')).toBe(true);
    expect(rec.images().some((op) => op.image === 'bg_3-3_far')).toBe(false);
  });
});
