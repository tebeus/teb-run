import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { initialPlayer } from '../../src/game/player';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { updateVisible } from '../../src/game/race';
import { STAGE_LIST, stageById } from '../../src/game/stages';
import { buildTrack } from '../../src/game/track';
import { CAMERA_HEIGHT, ROAD_WIDTH, SEGMENT_LENGTH } from '../../src/render/project';
import type { ParticleField } from '../../src/render/effects';
import {
  PLAYER_CAR_BOTTOM,
  PLAYER_SCALE,
  bounceAmplitude,
  drawPlayerCar,
  playerCarSize,
  playerFrameName,
  renderWorld,
} from '../../src/render/world';
import { DEMO_STAGE } from '../../src/game/demo-stage';
import type { AssetStore, RaceSnapshot, SpriteAsset } from '../../src/types';
import { makeAsset } from '../helpers/segments';
import { createRecordCtx } from '../helpers/recordCtx';

const snapshot = (over: Partial<RaceSnapshot> = {}): RaceSnapshot => ({
  segments: [],
  player: initialPlayer(),
  crash: { active: false, t: 0, frame: 0 },
  timeLeft: 99,
  score: 0,
  stage: DEMO_STAGE,
  level: 0,
  route: [],
  parallax: { far: 0, near: 0, y: 0 },
  theme: 'beach',
  banner: 'none',
  kmh: 0,
  ...over,
});

describe('playerFrameName (spec 4.4)', () => {
  test('no steering shows the straight frame', () => {
    expect(playerFrameName(snapshot())).toBe('player_straight');
  });

  test('a light steer shows the frame of its own side', () => {
    expect(playerFrameName(snapshot({ player: { ...initialPlayer(), steer: -1 } }))).toBe('player_left1');
    expect(playerFrameName(snapshot({ player: { ...initialPlayer(), steer: 1 } }))).toBe('player_right1');
  });

  test('a hard steer shows frame two of its own side', () => {
    expect(playerFrameName(snapshot({ player: { ...initialPlayer(), steer: -2 } }))).toBe('player_left2');
    expect(playerFrameName(snapshot({ player: { ...initialPlayer(), steer: 2 } }))).toBe('player_right2');
  });

  test('the right frames are their own sprites, not a mirror (spec §13, Set 3)', () => {
    expect(CATALOG.player_right1.kind).toBe('player');
    expect(CATALOG.player_right2.kind).toBe('player');
    expect(CATALOG.player_right1.scale).toBe(CATALOG.player_left1.scale);
    expect(CATALOG.player_right2.scale).toBe(CATALOG.player_left2.scale);
  });

  test('braking shows the brake frame', () => {
    expect(playerFrameName(snapshot({ player: { ...initialPlayer(), braking: true } }))).toBe('player_brake');
  });

  test('a crash shows the spin frames and never a name outside the catalog', () => {
    for (const frame of [0, 1, 2, 3]) {
      expect(playerFrameName(snapshot({ crash: { active: true, t: 0.2, frame } }))).toBe(`player_spin_${frame}`);
    }
    expect(playerFrameName(snapshot({ crash: { active: true, t: 0.2, frame: 9 } }))).toBe('player_spin_3');
    expect(playerFrameName(snapshot({ crash: { active: true, t: 0.2, frame: -1 } }))).toBe('player_spin_0');
  });

  test('the crash frame wins over braking and steering', () => {
    const snap = snapshot({
      crash: { active: true, t: 0.1, frame: 2 },
      player: { ...initialPlayer(), braking: true, steer: -2 },
    });
    expect(playerFrameName(snap)).toBe('player_spin_2');
  });
});

describe('playerCarSize (spec §4.4 punto 5: tutti i frame alla stessa altezza)', () => {
  test('the player scale is the projection scale at the player position', () => {
    expect(PLAYER_SCALE).toBeCloseTo(1 / CAMERA_HEIGHT, 12);
  });

  test('for the straight frame itself it uses the same formula as the other sprites', () => {
    const straight = makeAsset('player_straight', 320, 200, { kind: 'player', scale: 0.33 });
    const size = playerCarSize(straight, straight, 1280);
    expect(size.w).toBeCloseTo(PLAYER_SCALE * 0.33 * ROAD_WIDTH * 640, 8);
    expect(size.w).toBeCloseTo(549.12, 4);
    expect(size.h / size.w).toBeCloseTo(200 / 320, 10);
  });

  test('a wider screen gives a wider car', () => {
    const straight = makeAsset('player_straight', 320, 200, { kind: 'player', scale: 0.33 });
    expect(playerCarSize(straight, straight, 2560).w).toBeCloseTo(playerCarSize(straight, straight, 1280).w * 2, 8);
  });

  test('with the catalog scale the straight frame is 18 per cent of the screen wide (spec §13)', () => {
    const straight = makeAsset('player_straight', 320, 200, {
      kind: 'player',
      scale: CATALOG.player_straight.scale,
    });
    const w = playerCarSize(straight, straight, 1280).w;
    // 0.14 · 2600 · 0.64 = 233 px: i 205 px del riferimento misurato in widescreen,
    // portati su 1280.
    expect(w).toBeGreaterThan(215);
    expect(w).toBeLessThan(245);
  });

  test('a frame with a different aspect ratio keeps the straight height, not its own (addendum del collaudo)', () => {
    // Sagoma reale del problema: dritta 313x200, sterzo 320x171 (piu' bassa
    // nel riquadro sorgente perche' la carrozzeria e' ruotata).
    const straight = makeAsset('player_straight', 313, 200, { kind: 'player', scale: 0.14 });
    const turn = makeAsset('player_left2', 320, 171, { kind: 'player', scale: 0.14 });
    const straightSize = playerCarSize(straight, straight, 1280);
    const turnSize = playerCarSize(straight, turn, 1280);
    expect(turnSize.h).toBeCloseTo(straightSize.h, 9);
    expect(turnSize.w).toBeCloseTo(turnSize.h * (320 / 171), 9);
    // Con la vecchia formula (stessa larghezza) sarebbe stata piu' bassa:
    // qui invece e' piu' larga, perche' il suo riquadro sorgente e' piu'
    // "sdraiato" della dritta.
    expect(turnSize.w).toBeGreaterThan(straightSize.w);
  });
});

describe('drawPlayerCar (spec §4.4 punto 5, addendum del collaudo)', () => {
  /** Frame dritto e frame di sterzo con la sagoma reale del problema. */
  const store = (): AssetStore => {
    const table: Record<string, SpriteAsset> = {
      player_straight: makeAsset('player_straight', 313, 200, { kind: 'player', scale: 0.14 }),
      player_left2: makeAsset('player_left2', 320, 171, { kind: 'player', scale: 0.14 }),
      player_right2: makeAsset('player_right2', 320, 171, { kind: 'player', scale: 0.14 }),
    };
    return {
      ready: Promise.resolve(),
      get: (name) => table[name] ?? table.player_straight,
      has: () => true,
      stats: { png: 0, procedural: 0, missing: 0 },
    };
  };

  const draw = (steer: -2 | -1 | 0 | 1 | 2): { dw: number; dh: number; shadowRx: number } => {
    const rec = createRecordCtx();
    const snap = snapshot({ player: { ...initialPlayer(), steer } });
    drawPlayerCar(rec.ctx, snap, store(), LOGICAL_W, LOGICAL_H);
    const image = rec.ops.find((op) => op.type === 'drawImage')!;
    const ellipse = rec.ops.find((op) => op.type === 'ellipse')!;
    // drawImage(image, dx, dy, dw, dh): l'immagine e' rimossa da `args`.
    return { dw: image.args[2], dh: image.args[3], shadowRx: ellipse.args[2] };
  };

  test('the turning frame is drawn at the straight frame height, not its own', () => {
    const straight = draw(0);
    const turning = draw(-2);
    expect(turning.dh).toBeCloseTo(straight.dh, 9);
    expect(turning.dw).not.toBeCloseTo(straight.dw, 3);
  });

  test('the shadow uses the straight frame width, so it does not pulse when steering', () => {
    const straight = draw(0);
    const left = draw(-2);
    const right = draw(2);
    expect(left.shadowRx).toBeCloseTo(straight.shadowRx, 9);
    expect(right.shadowRx).toBeCloseTo(straight.shadowRx, 9);
  });

  test('the car stays centred in x and resting on PLAYER_CAR_BOTTOM regardless of the frame', () => {
    const rec = createRecordCtx();
    drawPlayerCar(rec.ctx, snapshot({ player: { ...initialPlayer(), steer: -2 } }), store(), LOGICAL_W, LOGICAL_H);
    const image = rec.ops.find((op) => op.type === 'drawImage')!;
    const [dx, dy, dw, dh] = image.args;
    expect(dx + dw / 2).toBeCloseTo(LOGICAL_W / 2, 6);
    expect(dy + dh).toBeLessThanOrEqual(LOGICAL_H - PLAYER_CAR_BOTTOM + 6); // + il massimo dell'oscillazione
  });
});

describe('bounceAmplitude (spec §4.4 punto 5)', () => {
  test('the asphalt is the calmest, the grass the roughest', () => {
    expect(bounceAmplitude('road')).toBe(2);
    expect(bounceAmplitude('shoulder')).toBe(3);
    expect(bounceAmplitude('grass')).toBe(6);
  });
});

describe('renderWorld draw order (spec §4.4b)', () => {
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 64,
      h: 64,
      entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  /** Finto: disegna un'unica ellisse riconoscibile, in un punto che il mondo non tocca altrove. */
  const fakeParticles = (): ParticleField => ({
    update: () => undefined,
    burst: () => undefined,
    draw: (ctx) => {
      ctx.beginPath();
      ctx.ellipse(999, 999, 5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    },
    count: 0,
    snowCount: 0,
    weatherCount: 0,
    clear: () => undefined,
  });

  test('the player car is drawn before the smoke and dust particles', () => {
    const rec = createRecordCtx();
    renderWorld(rec.ctx, snapshot(), store(), fakeParticles());
    const carIndex = rec.ops.findIndex((op) => op.type === 'drawImage' && op.image === 'player_straight');
    const particleIndex = rec.ops.findIndex((op) => op.type === 'ellipse' && op.args[0] === 999);
    expect(carIndex).toBeGreaterThan(-1);
    expect(particleIndex).toBeGreaterThan(-1);
    expect(carIndex).toBeLessThan(particleIndex);
  });

  test('without a particle field the car still draws, nothing else expected after it', () => {
    const rec = createRecordCtx();
    renderWorld(rec.ctx, snapshot(), store());
    const carIndex = rec.ops.findIndex((op) => op.type === 'drawImage' && op.image === 'player_straight');
    expect(carIndex).toBeGreaterThan(-1);
  });
});

describe('renderWorld usa la palette della tappa (spec §4.4f)', () => {
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name) => makeAsset(name, 64, 64),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  /**
   * Gli stop del cielo: `createRecordCtx` non registra i gradienti come
   * operazioni, li rende la stringa `gradient(x0,y0,x1,y1:c0|c1|c2)` che
   * diventa il `fill` del riempimento che li usa. Il cielo è il primo
   * `fillRect` del fotogramma.
   */
  const skyStops = (rec: ReturnType<typeof createRecordCtx>): string =>
    rec.fills().find((op) => (op.fill ?? '').startsWith('gradient('))?.fill ?? '';

  test('the world uses the palette of the stage, not only of the theme', () => {
    const rec = createRecordCtx();
    // 4-4 Sunset Lagoon: cielo magenta-arancio, molto diverso dal
    // cielo di tema `beach`.
    const snap = { ...snapshot(), stage: stageById('4-4'), theme: 'beach' as const };
    renderWorld(rec.ctx, snap, store());
    expect(skyStops(rec)).toContain('#6a2a7a');
    expect(skyStops(rec)).not.toContain('#1f6fd0');
  });

  test('a stage id with no override falls back to the theme palette', () => {
    const rec = createRecordCtx();
    const snap = {
      ...snapshot(),
      stage: { ...stageById('4-4'), id: 'demo' },
      theme: 'beach' as const,
    };
    renderWorld(rec.ctx, snap, store());
    expect(skyStops(rec)).toContain('#1f6fd0');
  });
});

describe('renderWorld in transizione fra tappe (spec §4.4d)', () => {
  const store = (): AssetStore => ({
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: 512,
      h: 512,
      entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  });

  /** Uno snapshot con segmenti veri e proiettati: senza, niente texture. */
  const real = (over: Partial<RaceSnapshot> = {}): RaceSnapshot => {
    const stage = STAGE_LIST[0];
    const segments = buildTrack(stage);
    const player = { ...initialPlayer(), z: 600 * SEGMENT_LENGTH, speed: 12000 };
    return {
      ...snapshot(),
      segments: updateVisible(segments, player, LOGICAL_W, LOGICAL_H),
      player,
      stage,
      theme: stage.theme,
      ...over,
    };
  };

  test('cielo, strada e sfondo cambiano nelle tre finestre, in quell ordine', () => {
    const at = (t: number): Set<string> => {
      const rec = createRecordCtx();
      renderWorld(rec.ctx, real({ transition: { from: 'beach' as const, to: 'desert' as const, t } }), store());
      return new Set(rec.ops.filter((op) => op.type === 'drawImage').map((op) => String(op.image)));
    };
    // A 1 s solo il cielo e' a meta: gli strati e le tessere sono ancora
    // quelli della spiaggia (SKY_WINDOW 0-2.5, ROAD_WINDOW 1.5-4, FAR 3-6).
    const early = at(1);
    expect(early.has('bg_beach_far')).toBe(true);
    expect(early.has('bg_desert_far')).toBe(false);
    expect(early.has('ground_desert')).toBe(false);
    // A 2,5 s la strada sta cambiando: due tessere di terreno.
    const mid = at(2.5);
    expect(mid.has('ground_beach')).toBe(true);
    expect(mid.has('ground_desert')).toBe(true);
    expect(mid.has('bg_desert_far')).toBe(false);
    // A 4,5 s anche lo sfondo: due strati di parallasse.
    const late = at(4.5);
    expect(late.has('bg_beach_far')).toBe(true);
    expect(late.has('bg_desert_far')).toBe(true);
  });

  test('fuori dalla transizione si disegna un solo tema', () => {
    const rec = createRecordCtx();
    renderWorld(rec.ctx, real(), store());
    const names = new Set(rec.ops.filter((op) => op.type === 'drawImage').map((op) => String(op.image)));
    expect(names.has('bg_desert_far')).toBe(false);
    expect(names.has('ground_desert')).toBe(false);
  });
});
