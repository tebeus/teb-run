import { describe, expect, test } from 'vitest';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { initialPlayer } from '../../src/game/player';
import { updateVisible } from '../../src/game/race';
import { STAGE_LIST } from '../../src/game/stages';
import { buildTrack, FLAGMAN_NAME, START_GANTRY_NAME } from '../../src/game/track';
import { CATALOG } from '../../src/art/catalog';
import { CAMERA_DEPTH, ROAD_HALF, ROAD_WIDTH, SEGMENT_LENGTH } from '../../src/render/project';
import { MAX_SPRITE_WIDTHS, NO_CLIP, renderSprites, spriteDestRect } from '../../src/render/sprites';
import type { AssetStore, Segment, SpriteAsset } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { makeAsset, makeSegment } from '../helpers/segments';

const W = 1280;
const asset = makeAsset('beach_palm_1', 300, 520, { scale: 0.5, anchorY: 1 });
const scale = 0.0002;

describe('spriteDestRect: size (spec 4.4 and 13)', () => {
  test('the width is scale * catalog.scale * roadWidth * W/2', () => {
    const r = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W);
    expect(r).not.toBeNull();
    expect(r!.dw).toBeCloseTo(scale * 0.5 * ROAD_WIDTH * (W / 2), 8);
  });

  test('the height keeps the image aspect ratio', () => {
    const r = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!;
    expect(r.dh / r.dw).toBeCloseTo(520 / 300, 8);
  });

  test('an object as wide as the road covers the projected road width', () => {
    const roadWide = makeAsset('wide', 100, 100, { scale: 1 });
    const r = spriteDestRect(roadWide, scale, 640, 500, 0, NO_CLIP, W)!;
    const projectedHalfRoad = scale * ROAD_HALF * (W / 2);
    expect(r.dw).toBeCloseTo(projectedHalfRoad * 2, 8);
  });

  test('twice the projection scale means twice the size', () => {
    const a = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!;
    const b = spriteDestRect(asset, scale * 2, 640, 500, 0, NO_CLIP, W)!;
    expect(b.dw).toBeCloseTo(a.dw * 2, 8);
    expect(b.dh).toBeCloseTo(a.dh * 2, 8);
  });
});

describe('spriteDestRect: position', () => {
  test('offset zero centres the sprite on the segment point', () => {
    const r = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!;
    expect(r.dx + r.dw / 2).toBeCloseTo(640, 8);
  });

  test('offset 1 puts the centre on the road edge', () => {
    const r = spriteDestRect(asset, scale, 640, 500, 1, NO_CLIP, W)!;
    expect(r.dx + r.dw / 2).toBeCloseTo(640 + scale * ROAD_HALF * (W / 2), 8);
  });

  test('a negative offset goes to the left of the road', () => {
    const r = spriteDestRect(asset, scale, 640, 500, -2, NO_CLIP, W)!;
    expect(r.dx + r.dw / 2).toBeLessThan(640);
  });

  test('anchorY 1 puts the bottom of the sprite on the segment point', () => {
    const r = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!;
    expect(r.dy + r.dh).toBeCloseTo(500, 8);
  });

  test('anchorY 0.5 centres the sprite on the segment point', () => {
    const centred = makeAsset('ending_1', 1280, 480, { scale: 1, anchorY: 0.5 });
    const r = spriteDestRect(centred, scale, 640, 500, 0, NO_CLIP, W)!;
    expect(r.dy + r.dh / 2).toBeCloseTo(500, 8);
  });
});

describe('spriteDestRect: hill clipping (Review Focus 3)', () => {
  test('NO_CLIP leaves the source rectangle whole', () => {
    const r = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!;
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    expect(r.sw).toBe(asset.w);
    expect(r.sh).toBe(asset.h);
  });

  test('a clip line at zero or below hides the sprite, it does not disable clipping', () => {
    // Il sentinella è NO_CLIP: ogni numero finito ritaglia, e più è piccolo più copre.
    expect(spriteDestRect(asset, scale, 640, 500, 0, 0, W)).toBeNull();
    expect(spriteDestRect(asset, scale, 640, 500, 0, -500, W)).toBeNull();
  });

  test('a clip line below the sprite leaves it whole', () => {
    const r = spriteDestRect(asset, scale, 640, 500, 0, 700, W)!;
    expect(r.sh).toBe(asset.h);
    expect(r.dh).toBeCloseTo(spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!.dh, 10);
  });

  test('a clip line across the sprite cuts source and destination in proportion', () => {
    const whole = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!;
    const clipY = whole.dy + whole.dh / 2;
    const r = spriteDestRect(asset, scale, 640, 500, 0, clipY, W)!;
    expect(r.dh).toBeCloseTo(whole.dh / 2, 6);
    expect(r.sh).toBeCloseTo(asset.h / 2, 6);
    expect(r.dy).toBeCloseTo(whole.dy, 10);
  });

  test('a sprite entirely above the clip line is skipped', () => {
    const whole = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!;
    expect(spriteDestRect(asset, scale, 640, 500, 0, whole.dy, W)).toBeNull();
    expect(spriteDestRect(asset, scale, 640, 500, 0, whole.dy - 50, W)).toBeNull();
  });

  test('the visible source height is always positive when a rect is returned', () => {
    const whole = spriteDestRect(asset, scale, 640, 500, 0, NO_CLIP, W)!;
    for (let i = 1; i < 40; i++) {
      const r = spriteDestRect(asset, scale, 640, 500, 0, whole.dy + (whole.dh * i) / 40, W);
      if (r === null) continue;
      expect(r.sh, `step ${i}`).toBeGreaterThan(0);
      expect(r.dh, `step ${i}`).toBeGreaterThan(0);
    }
  });
});

describe('spriteDestRect: degenerate input', () => {
  test('a scale of zero or less is skipped', () => {
    expect(spriteDestRect(asset, 0, 640, 500, 0, NO_CLIP, W)).toBeNull();
    expect(spriteDestRect(asset, -0.001, 640, 500, 0, NO_CLIP, W)).toBeNull();
  });

  test('a sprite smaller than half a pixel is skipped', () => {
    expect(spriteDestRect(asset, 1e-9, 640, 500, 0, NO_CLIP, W)).toBeNull();
  });

  test('an image with no size is skipped', () => {
    expect(spriteDestRect(makeAsset('broken', 0, 0), scale, 640, 500, 0, NO_CLIP, W)).toBeNull();
  });
});

describe('renderSprites e flip (spec §13)', () => {
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 200,
      h: 260,
      entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  const seg = (flip: boolean) => {
    const s = makeSegment(10, { sprites: [{ name: 'common_sign_chevron', offset: 1.6, flip }] });
    s.p1.camera.z = 2000;
    s.p2.camera.z = 2200;
    s.p1.screen = { x: 640, y: 600, w: 100, scale: 0.0003 };
    s.p2.screen = { x: 640, y: 560, w: 96, scale: 0.00028 };
    s.clip = 720;
    return s;
  };

  test('a flipped sprite is drawn mirrored, a plain one is not', () => {
    const plain = createRecordCtx();
    renderSprites(plain.ctx, [seg(false)], store(), 1280, 720);
    expect(plain.ops.some((op) => op.type === 'scale' && op.args[0] === -1)).toBe(false);

    const flipped = createRecordCtx();
    renderSprites(flipped.ctx, [seg(true)], store(), 1280, 720);
    expect(flipped.ops.some((op) => op.type === 'scale' && op.args[0] === -1)).toBe(true);
    // Lo specchio non sposta lo sprite: stessa larghezza disegnata.
    const a = plain.ops.find((op) => op.type === 'drawImage');
    const b = flipped.ops.find((op) => op.type === 'drawImage');
    expect(b?.args[6]).toBeCloseTo(a?.args[6] as number, 6);
  });
});

describe('tetto alla larghezza di uno sprite (task 15, punto 23)', () => {
  const asset = makeAsset('common_flagman', 174, 340, { kind: 'scenery', scale: 0.169 });

  /** Larghezza che la formula vorrebbe, senza tetto. */
  const wanted = (projScale: number, width: number): number =>
    projScale * asset.entry.scale * ROAD_WIDTH * (width / 2);

  test('uno sprite normale vicino alla telecamera non viene toccato', () => {
    // La scala del segmento piu vicino e circa 0.0015: nessuno sprite del
    // catalogo arriva al tetto da li.
    const r = spriteDestRect(asset, 0.0015, 640, 700, 1.5, NO_CLIP, LOGICAL_W);
    expect(r).not.toBeNull();
    expect(r!.dw).toBeCloseTo(wanted(0.0015, LOGICAL_W), 6);
    expect(r!.dw).toBeLessThan(MAX_SPRITE_WIDTHS * LOGICAL_W);
  });

  test('sopra il tetto la larghezza si ferma e le proporzioni restano', () => {
    // Scala 0.05: la telecamera e a un pixel dal segmento. Senza tetto la
    // larghezza sarebbe 14 061 px, undici volte il frame.
    const big = 0.05;
    expect(wanted(big, LOGICAL_W)).toBeCloseTo(14060.8, 1);
    expect(wanted(big, LOGICAL_W)).toBeGreaterThan(10 * LOGICAL_W);
    const r = spriteDestRect(asset, big, 640, 700, 1.5, NO_CLIP, LOGICAL_W);
    expect(r).not.toBeNull();
    expect(r!.dw).toBeCloseTo(MAX_SPRITE_WIDTHS * LOGICAL_W, 6);
    expect(r!.dh / r!.dw).toBeCloseTo(340 / 174, 9);
  });

  test('il tetto e in larghezze di frame, non in pixel fissi', () => {
    const a = spriteDestRect(asset, 0.05, 320, 700, 0, NO_CLIP, 640)!;
    const b = spriteDestRect(asset, 0.05, 640, 700, 0, NO_CLIP, 1280)!;
    expect(a.dw).toBeCloseTo(MAX_SPRITE_WIDTHS * 640, 6);
    expect(b.dw).toBeCloseTo(MAX_SPRITE_WIDTHS * 1280, 6);
  });

  test('con il tetto la base resta appoggiata alla strada', () => {
    const r = spriteDestRect(asset, 0.05, 640, 700, 1.5, NO_CLIP, LOGICAL_W)!;
    // anchorY 1: il fondo dello sprite cade sulla y del segmento.
    expect(r.dy + r.dh).toBeCloseTo(700, 6);
  });
});

describe('ingresso in una tappa: nessuno sprite copre lo schermo (task 15, punto 23)', () => {
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 300,
      h: 400,
      entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  /** Larghezza del piu grande sprite disegnato con il giocatore a quella z. */
  const widest = (stage: (typeof STAGE_LIST)[number], z: number): { name: string; dw: number } => {
    const segments = buildTrack(stage);
    const player = { ...initialPlayer(), z };
    const visible = updateVisible(segments, player, LOGICAL_W, LOGICAL_H);
    let best = { name: '', dw: 0 };
    for (const seg of visible) {
      if (seg.p1.camera.z <= CAMERA_DEPTH) continue;
      for (const sp of seg.sprites) {
        const r = spriteDestRect(
          store().get(sp.name),
          seg.p1.screen.scale,
          seg.p1.screen.x,
          seg.p1.screen.y,
          sp.offset,
          seg.clip,
          LOGICAL_W,
        );
        if (r && r.dw > best.dw) best = { name: sp.name, dw: r.dw };
      }
    }
    return best;
  };

  /** Larghezza che la formula vorrebbe, senza il tetto di `spriteDestRect`. */
  const widestWanted = (stage: (typeof STAGE_LIST)[number], z: number): { name: string; dw: number } => {
    const segments = buildTrack(stage);
    const player = { ...initialPlayer(), z };
    const visible = updateVisible(segments, player, LOGICAL_W, LOGICAL_H);
    let best = { name: '', dw: 0 };
    for (const seg of visible) {
      if (seg.p1.camera.z <= CAMERA_DEPTH) continue;
      for (const sp of seg.sprites) {
        const entry = CATALOG[sp.name];
        if (!entry || !(seg.p1.screen.scale > 0)) continue;
        const dw = seg.p1.screen.scale * entry.scale * ROAD_WIDTH * (LOGICAL_W / 2);
        if (dw > best.dw) best = { name: sp.name, dw };
      }
    }
    return best;
  };

  test('nei primi cinque segmenti di ogni tappa niente supera il tetto', () => {
    // La telecamera e' PLAYER_Z prima della fine del tracciato: e' qui che il
    // problema si manifestava, in tutte e quindici le tappe.
    for (const stage of STAGE_LIST) {
      for (let s = 0; s <= 5; s += 0.25) {
        const w = widest(stage, s * SEGMENT_LENGTH);
        expect(w.dw, `${stage.id} a ${s} segmenti: ${w.name}`).toBeLessThanOrEqual(MAX_SPRITE_WIDTHS * LOGICAL_W);
      }
    }
  });

  test('e nemmeno la larghezza che la formula vorrebbe, senza il tetto', () => {
    // Il tetto e la seconda difesa: la prima e non piazzare sprite dove la
    // telecamera li trova a un pixel. Questo test misura la geometria e
    // fallirebbe con l'uomo con la bandiera sull'ultimo segmento.
    for (const stage of STAGE_LIST) {
      for (let s = 0; s <= 5; s += 0.25) {
        const w = widestWanted(stage, s * SEGMENT_LENGTH);
        expect(w.dw, `${stage.id} a ${s} segmenti: ${w.name}`).toBeLessThan(MAX_SPRITE_WIDTHS * LOGICAL_W);
      }
    }
  });

  test('l uomo con la bandiera non e davanti alla telecamera all ingresso', () => {
    for (const stage of STAGE_LIST.filter((st) => st.id.startsWith('4-'))) {
      const segments = buildTrack(stage);
      const player = { ...initialPlayer(), z: 0 };
      const visible = updateVisible(segments, player, LOGICAL_W, LOGICAL_H);
      for (const seg of visible) {
        if (seg.p1.camera.z <= CAMERA_DEPTH) continue;
        for (const sp of seg.sprites) {
          expect(sp.name, `${stage.id} segmento ${seg.index}`).not.toBe(FLAGMAN_NAME);
        }
      }
    }
  });

  test('arrivando al traguardo l uomo con la bandiera si vede, a misura di persona', () => {
    const stage = STAGE_LIST.find((st) => st.id === '4-0') as (typeof STAGE_LIST)[number];
    const segments = buildTrack(stage);
    // Giocatore a trenta segmenti dalla fine: il traguardo e in vista.
    const player = { ...initialPlayer(), z: (segments.length - 30) * SEGMENT_LENGTH };
    const visible = updateVisible(segments, player, LOGICAL_W, LOGICAL_H);
    let found: { dw: number; dh: number } | null = null;
    for (const seg of visible) {
      for (const sp of seg.sprites) {
        if (sp.name !== FLAGMAN_NAME) continue;
        const r = spriteDestRect(
          store().get(sp.name),
          seg.p1.screen.scale,
          seg.p1.screen.x,
          seg.p1.screen.y,
          sp.offset,
          seg.clip,
          LOGICAL_W,
        );
        if (r) found = { dw: r.dw, dh: r.dh };
      }
    }
    expect(found).not.toBeNull();
    expect(found!.dw).toBeGreaterThan(20);
    expect(found!.dw).toBeLessThan(400);
  });
});

describe('portali vicini alla telecamera (spec §4.4e)', () => {
  const portal = (scale: number): SpriteAsset => ({
    name: 'race_start_gantry',
    image: {} as CanvasImageSource,
    w: 1280,
    h: 480,
    entry: { kind: 'scenery', scale, solid: false, collideW: 0, anchorY: 1 },
  });

  test('a portal at the junction is drawn, capped at two frame widths', () => {
    // Alla giunzione fra tappe la scala di proiezione di un segmento a un
    // pixel dalla telecamera arriva a valori altissimi: senza la
    // compressione di `MAX_SPRITE_WIDTHS` il portale chiederebbe un
    // `drawImage` largo centomila pixel. Con essa viene disegnato, grande
    // ma finito.
    const r = spriteDestRect(portal(2.8), 20, 640, 720, 0, NO_CLIP, 1280);
    expect(r, 'il portale non deve essere scartato').not.toBeNull();
    expect(r!.dw).toBeLessThanOrEqual(MAX_SPRITE_WIDTHS * 1280);
    // L'altezza scende con la larghezza: la forma non si deforma.
    expect(r!.dh / r!.dw).toBeCloseTo(480 / 1280, 6);
  });

  test('a portal far away keeps its real size', () => {
    // A scala di proiezione normale la compressione non tocca niente.
    // Nota: a 0.002 (valore originale del brief) `wanted` supera già il
    // tetto anche per il portale di partenza (scala di catalogo 1.35), il
    // che contraddirebbe il commento; 0.001 resta sotto la soglia
    // (2560 px di tetto contro 2246 px voluti) e verifica davvero il caso
    // "non tocca niente".
    const r = spriteDestRect(portal(1.35), 0.001, 640, 500, 0, NO_CLIP, 1280);
    expect(r).not.toBeNull();
    expect(r!.dw).toBeCloseTo(0.001 * 1.35 * 2600 * 640, 6);
    expect(r!.dw).toBeLessThan(MAX_SPRITE_WIDTHS * 1280);
  });

  test('the cap does not touch an ordinary roadside sprite', () => {
    // A questa scala di proiezione (0.002) un portale sarebbe già compresso
    // (soglia di compressione a scala di catalogo 1.35 o 2.8: circa 0.0011 e
    // 0.00055), ma uno sprite normale con scala di catalogo 0.42 resta ben
    // sotto il tetto: la compressione dipende dalla scala di catalogo, non
    // solo dalla distanza.
    const palm = spriteDestRect(portal(0.42), 0.002, 640, 500, 1.5, NO_CLIP, 1280);
    expect(palm).not.toBeNull();
    expect(palm!.dw).toBeLessThan(MAX_SPRITE_WIDTHS * 1280);
  });
});

describe('un portale troppo vicino alla telecamera non si disegna (revisione finale, finding 9)', () => {
  // Passando sotto un portale il suo segmento finisce a poche unità dalla
  // telecamera: anche col tetto di MAX_SPRITE_WIDTHS il pannello resta
  // largo fino a due frame e riempirebbe mezzo schermo per un fotogramma.
  // renderSprites non lo disegna più sotto PORTAL_NEAR_CLIP_SEGMENTS, e la
  // correzione è generica sul nome, non sull'istanza (regge anche con più
  // copie dello stesso portale, una per ramo del bivio).
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 1280,
      h: 480,
      entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  /**
   * Tracciato di `len` segmenti tutti visibili, con uno sprite `name` sul
   * solo ultimo: nel ciclo di `renderSprites` (`n` da `length - 1` a `0`)
   * quel segmento viene visitato a `n = len - 1`, cioè a `len - 1` segmenti
   * dalla telecamera.
   */
  const trackWithSpriteAt = (len: number, name: string): Segment[] =>
    Array.from({ length: len }, (_, i) => {
      const s = makeSegment(i, { sprites: i === len - 1 ? [{ name, offset: 0 }] : [] });
      s.p1.camera.z = 2000;
      s.p2.camera.z = 2200;
      s.p1.screen = { x: 640, y: 600, w: 100, scale: 0.02 };
      s.p2.screen = { x: 640, y: 560, w: 96, scale: 0.019 };
      s.clip = 720;
      return s;
    });

  test('a un segmento dalla telecamera, nessun drawImage del portale', () => {
    const rec = createRecordCtx();
    renderSprites(rec.ctx, trackWithSpriteAt(2, START_GANTRY_NAME), store(), 1280, 720);
    expect(rec.images().some((op) => op.image === START_GANTRY_NAME)).toBe(false);
  });

  test('a dieci segmenti dalla telecamera, il portale si disegna', () => {
    const rec = createRecordCtx();
    renderSprites(rec.ctx, trackWithSpriteAt(11, START_GANTRY_NAME), store(), 1280, 720);
    expect(rec.images().some((op) => op.image === START_GANTRY_NAME)).toBe(true);
  });

  test('uno sprite qualsiasi, non un portale, si disegna anche a un segmento dalla telecamera', () => {
    const rec = createRecordCtx();
    renderSprites(rec.ctx, trackWithSpriteAt(2, 'beach_palm_1'), store(), 1280, 720);
    expect(rec.images().some((op) => op.image === 'beach_palm_1')).toBe(true);
  });
});
