import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { LOGICAL_H, LOGICAL_W } from '../../../src/core/canvas';
import {
  createRadioScreen,
  fitScale,
  initialRadioState,
  PANEL_H,
  PANEL_W,
  parseRadioPayload,
  RADIO_CAR_LABEL_Y,
  RADIO_CAR_X,
  RADIO_LIST_Y,
  RADIO_MODE_COLORS,
  RADIO_MODE_X,
  RADIO_ROW_STEP,
  RADIO_VISIBLE_ROWS,
  SONGS,
  stepRadio,
  visibleWindow,
  wantsCarToggle,
  wantsModeToggle,
} from '../../../src/ui/screens/radio';
import { createCarSetting } from '../../../src/persist/car';
import { createModeSetting } from '../../../src/persist/mode';
import { go } from '../../../src/ui/fsm';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createScoresStore } from '../../../src/persist/scores';
import { createRecordCtx } from '../../helpers/recordCtx';
import { touchLayout } from '../../../src/ui/touch';
import {
  RADIO_CAR_RECT,
  RADIO_MODE_RECT,
  RADIO_TILT_RECT,
  RADIO_TOUCH_CONTROLS_Y,
  RADIO_TOUCH_LIST_BAND,
  TILT_HINT_LINES,
  TILT_HINT_RIGHT,
  TILT_HINT_Y,
} from '../../../src/ui/radioTouch';
import { DRIVE_LINE_TOUCH_TILT, DRIVE_LINES } from '../../../src/ui/controlsHelp';
import { measureText } from '../../../src/ui/text';
import type { InputDevice } from '../../../src/core/device';
import type { ScreenDeps } from '../../../src/ui/deps';
import type { Actions, AssetStore, AudioBus, SpriteAsset } from '../../../src/types';

function baseAudio(): AudioBus {
  return {
    unlock() {},
    playSong() {},
    stopSong() {},
    sfx() {},
    setEngine() {},
    setSkid() {},
    setRumble() {},
    toggleMute: () => false,
    muted: false,
    available: true,
  };
}

describe('stepRadio', () => {
  test('right wraps 0 -> 1 -> 2 -> 0, once per press', () => {
    let state = initialRadioState();
    let r = stepRadio(state, { ...emptyActions(), right: true }, 3);
    state = r.state;
    expect(state.selected).toBe(1);

    // held down: no further change while right stays true
    r = stepRadio(state, { ...emptyActions(), right: true }, 3);
    state = r.state;
    expect(state.selected).toBe(1);

    // release, then press again: advances once more
    r = stepRadio(state, emptyActions(), 3);
    state = r.state;
    r = stepRadio(state, { ...emptyActions(), right: true }, 3);
    state = r.state;
    expect(state.selected).toBe(2);
  });

  test('left wraps 0 -> 2', () => {
    const r = stepRadio(initialRadioState(), { ...emptyActions(), left: true }, 3);
    expect(r.state.selected).toBe(2);
  });

  test('confirm transitions to race with the selected song, from the initial selection', () => {
    const r = stepRadio(initialRadioState(), { ...emptyActions(), confirm: true }, 3);
    expect(r.transition).toEqual(go('race', { song: 0 }));
  });

  test('confirm after moving selects the current song', () => {
    let state = initialRadioState();
    state = stepRadio(state, { ...emptyActions(), right: true }, 3).state;
    state = stepRadio(state, emptyActions(), 3).state;
    const r = stepRadio(state, { ...emptyActions(), confirm: true }, 3);
    expect(r.transition).toEqual(go('race', { song: 1 }));
  });

  test('reports songChanged only on an actual selection change', () => {
    const state = initialRadioState();
    expect(stepRadio(state, emptyActions(), 3).songChanged).toBe(false);
    expect(stepRadio(state, { ...emptyActions(), right: true }, 3).songChanged).toBe(true);
  });

  test('SONGS has exactly 3 titles', () => {
    expect(SONGS).toHaveLength(3);
  });
});

describe('visibleWindow', () => {
  test('a short list is shown whole', () => {
    expect(visibleWindow(0, 3)).toEqual({ from: 0, to: 3 });
    expect(visibleWindow(2, 5)).toEqual({ from: 0, to: 5 });
  });

  test('a long list keeps the selection visible', () => {
    const count = 20;
    for (let selected = 0; selected < count; selected++) {
      const { from, to } = visibleWindow(selected, count);
      expect(to - from).toBe(RADIO_VISIBLE_ROWS);
      expect(selected).toBeGreaterThanOrEqual(from);
      expect(selected).toBeLessThan(to);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeLessThanOrEqual(count);
    }
  });

  test('the window centres the selection in the middle of a long list', () => {
    expect(visibleWindow(10, 20)).toEqual({ from: 8, to: 13 });
  });

  test('the window sticks to the ends instead of running past them', () => {
    expect(visibleWindow(0, 20)).toEqual({ from: 0, to: 5 });
    expect(visibleWindow(19, 20)).toEqual({ from: 15, to: 20 });
  });

  test('an empty list is an empty window, not a negative one', () => {
    expect(visibleWindow(0, 0)).toEqual({ from: 0, to: 0 });
  });
});

// Questo gruppo usa `Actions`: la riga di import è
//   import type { Actions } from '../../../src/types';
describe('stepRadio with a variable number of songs', () => {
  const idle = (): Actions => ({
    accelerate: false, brake: false, left: false, right: false,
    gearToggle: false, modeToggle: false, confirm: false, back: false, mute: false,
  });

  test('right wraps around the whole list, custom tracks included', () => {
    let state = initialRadioState();
    for (let i = 0; i < 6; i++) {
      state = stepRadio(state, { ...idle(), right: true }, 6).state;
      state = stepRadio(state, idle(), 6).state;
    }
    expect(state.selected).toBe(0);
  });

  test('left from the first song lands on the last custom track', () => {
    const result = stepRadio(initialRadioState(), { ...idle(), left: true }, 7);
    expect(result.state.selected).toBe(6);
  });

  test('a selection past the end of a shrunken list is clamped, not left dangling', () => {
    // Il manifest si carica dopo che la radio è già in scena: la lista può
    // crescere sotto i piedi, e in teoria accorciarsi.
    const state = { selected: 9, prevLeft: false, prevRight: false };
    const result = stepRadio(state, idle(), 3);
    expect(result.state.selected).toBeLessThan(3);
  });

  test('with three songs it behaves exactly like before', () => {
    let state = initialRadioState();
    state = stepRadio(state, { ...idle(), right: true }, 3).state;
    expect(state.selected).toBe(1);
    state = stepRadio(state, idle(), 3).state;
    state = stepRadio(state, { ...idle(), left: true }, 3).state;
    expect(state.selected).toBe(0);
  });

  test('confirm carries the selected index in the payload', () => {
    const result = stepRadio({ selected: 4, prevLeft: false, prevRight: false }, { ...idle(), confirm: true }, 7);
    expect(result.transition).toEqual({ to: 'race', payload: { song: 4 } });
  });
});

describe('parseRadioPayload', () => {
  test('always returns undefined, regardless of input', () => {
    expect(parseRadioPayload(undefined)).toBeUndefined();
    expect(parseRadioPayload({ garbage: 1 })).toBeUndefined();
  });
});

function makeRadioDeps(audio: AudioBus, assets: AssetStore = createEmptyAssets()): ScreenDeps {
  return {
    assets,
    audio,
    scores: createScoresStore(),
    raceFactory: () => {
      throw new Error('unused');
    },
    renderWorld: () => {},
    firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
  };
}

/** AssetStore finto con le due immagini della radio "presenti" (spec §11). */
function assetsWithRadioArt(): AssetStore {
  return {
    ready: Promise.resolve(),
    get: (name): SpriteAsset => ({
      name,
      image: { name } as unknown as CanvasImageSource,
      w: name === 'screen_attract' ? LOGICAL_W : PANEL_W,
      h: name === 'screen_attract' ? LOGICAL_H : PANEL_H,
      entry: { kind: name === 'radio_panel' ? 'ui' : 'illustration', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
    }),
    has: () => true,
    stats: { png: 2, procedural: 0, missing: 0 },
  };
}

/**
 * Come `assetsWithRadioArt`, ma `menu_cursor` a misura 0x0: simula il caso
 * (in pratica mai vero, `assets.get` dà comunque il procedurale) in cui il
 * PNG del cursore manca del tutto, e il codice deve ripiegare sul glifo `>`.
 */
function assetsWithRadioArtNoCursor(): AssetStore {
  const base = assetsWithRadioArt();
  return {
    ...base,
    get: (name): SpriteAsset => (name === 'menu_cursor' ? { ...base.get(name), w: 0, h: 0 } : base.get(name)),
  };
}

describe('createRadioScreen', () => {
  test('plays a preview on enter and when the selection changes', () => {
    const played: number[] = [];
    const audio: AudioBus = {
      ...baseAudio(),
      playSong(i) {
        played.push(i);
      },
    };
    const screen = createRadioScreen(makeRadioDeps(audio));
    screen.enter();
    expect(played).toEqual([0]);
    screen.update(1 / 60, { ...emptyActions(), right: true });
    expect(played).toEqual([0, 1]);
    screen.update(1 / 60, { ...emptyActions(), right: true }); // held: no repeat
    expect(played).toEqual([0, 1]);
  });

  test('exit stops the song preview', () => {
    const stops: number[] = [];
    const audio: AudioBus = {
      ...baseAudio(),
      stopSong() {
        stops.push(1);
      },
    };
    const screen = createRadioScreen(makeRadioDeps(audio));
    screen.enter();
    screen.exit?.();
    expect(stops).toEqual([1]);
  });

  test('renders without throwing, and draws a full-frame backdrop first so a previous screen cannot bleed through', () => {
    const screen = createRadioScreen(makeRadioDeps(baseAudio()));
    screen.enter();
    const calls: { x: number; y: number; w: number; h: number }[] = [];
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        calls.push({ x, y, w, h });
      },
      // Il segnaposto 1x1 di `createEmptyAssets` ha misura > 0, quindi la
      // radio disegna anche copertine e cursore (spec §11).
      drawImage() {},
    } as unknown as CanvasRenderingContext2D;
    expect(() => screen.render(ctx)).not.toThrow();
    expect(calls[0]).toEqual({ x: 0, y: 0, w: LOGICAL_W, h: LOGICAL_H });
  });

  test('with the placeholder store it still draws, without throwing', () => {
    // `createEmptyAssets` ritorna un segnaposto 1x1 per ogni nome: non è
    // «niente arte», è arte minuscola. La radio non chiama `has` per
    // decidere (decisione di contratto del README dei piani) e disegna
    // quello che riceve.
    const screen = createRadioScreen(makeRadioDeps(baseAudio()));
    screen.enter();
    const rec = createRecordCtx();
    expect(() => screen.render(rec.ctx)).not.toThrow();
    expect(rec.images().length).toBeGreaterThan(0);
  });

  test('with the art present, draws the full screen background and the panel (spec §11)', () => {
    const screen = createRadioScreen(makeRadioDeps(baseAudio(), assetsWithRadioArt()));
    screen.enter();
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    const images = rec.images();
    expect(images.some((op) => op.image === 'screen_attract')).toBe(true);
    expect(images.some((op) => op.image === 'radio_panel')).toBe(true);

    const bg = images.find((op) => op.image === 'screen_attract')!;
    // drawImage(image, dx, dy, dw, dh): scalato a LOGICAL_W/H (spec §11).
    expect(bg.args).toEqual([0, 0, LOGICAL_W, LOGICAL_H]);

    const panel = images.find((op) => op.image === 'radio_panel')!;
    expect(panel.args[2]).toBe(PANEL_W);
    expect(panel.args[3]).toBe(PANEL_H);
    // Largo 1000 px centrato, e in basso: il fondo del pannello è il fondo schermo.
    expect(panel.args[0]).toBeCloseTo((LOGICAL_W - PANEL_W) / 2, 9);
    expect(panel.args[1] + PANEL_H).toBeCloseTo(LOGICAL_H, 9);

    // Il fondale si disegna prima del pannello: il pannello resta sopra.
    expect(images.indexOf(bg)).toBeLessThan(images.indexOf(panel));
  });

  test('the chosen title is written inside the panel display, in yellow', () => {
    const screen = createRadioScreen(makeRadioDeps(baseAudio(), assetsWithRadioArt()));
    screen.enter();
    screen.update(1 / 60, { ...emptyActions(), right: true });
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    // Giallo, sia il titolo evidenziato nella lista sopra sia nel display:
    // qui interessa che almeno un pixel giallo cada dentro il display.
    const yellowFills = rec.ops.filter((op) => op.type === 'fillRect' && op.fill === '#ffee55');
    expect(yellowFills.length).toBeGreaterThan(0);
    const panelX = (LOGICAL_W - PANEL_W) / 2;
    const panelY = LOGICAL_H - PANEL_H;
    // Il display è dentro x 300..700, y 130..210 dell'immagine 1000x400.
    const inDisplay = yellowFills.some(
      (op) =>
        op.args[0] >= panelX + 300 - 20 &&
        op.args[0] <= panelX + 700 + 20 &&
        op.args[1] >= panelY + 130 - 20 &&
        op.args[1] <= panelY + 210 + 20,
    );
    expect(inDisplay).toBe(true);
  });

  test('le copertine stanno solo sui brani sintetici, il cursore sulla riga scelta', () => {
    const screen = createRadioScreen(makeRadioDeps(baseAudio(), assetsWithRadioArt()));
    screen.enter();
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    const covers = rec.images().filter((op) => op.image === 'radio_track_icons');
    // Tre brani sintetici visibili nella finestra di J: tre copertine.
    expect(covers).toHaveLength(SONGS.length);
    expect(rec.images().filter((op) => op.image === 'menu_cursor')).toHaveLength(1);
  });

  test('i brani personali non hanno copertina, e il cursore segue la selezione', () => {
    const audio: AudioBus = {
      ...baseAudio(),
      customTracks: [
        { title: 'Mine One', file: 'a.mp3' },
        { title: 'Mine Two', file: 'b.mp3' },
      ],
    };
    const screen = createRadioScreen(makeRadioDeps(audio, assetsWithRadioArt()));
    screen.enter();
    for (let i = 0; i < 4; i++) {
      screen.update(1 / 60, { ...emptyActions(), right: true });
      screen.update(1 / 60, emptyActions());
    }
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    // Cinque righe visibili, tre sintetiche: sempre tre copertine.
    expect(rec.images().filter((op) => op.image === 'radio_track_icons')).toHaveLength(SONGS.length);
    const cursor = rec.images().filter((op) => op.image === 'menu_cursor');
    expect(cursor).toHaveLength(1);
    // Selezione 4, finestra 0..5: la quinta riga.
    expect(cursor[0].args[1]).toBe(RADIO_LIST_Y + 4 * RADIO_ROW_STEP);
  });

  test('un solo cursore: col PNG presente il glifo `>` non si disegna in più (spec §11)', () => {
    // Revisione finale, finding 5: prima si vedevano sia `menu_cursor` sia
    // il glifo `>`, due cursori insieme. Confronto differenziale: con la
    // stessa selezione, la sola differenza fra le due art store è la misura
    // di `menu_cursor` (0x0 contro reale), quindi ogni pixel di testo in più
    // nel caso «senza PNG» viene dal ripiego `>` al posto dello spazio.
    const withImage = createRadioScreen(makeRadioDeps(baseAudio(), assetsWithRadioArt()));
    withImage.enter();
    const recWith = createRecordCtx();
    withImage.render(recWith.ctx);

    const withoutImage = createRadioScreen(makeRadioDeps(baseAudio(), assetsWithRadioArtNoCursor()));
    withoutImage.enter();
    const recWithout = createRecordCtx();
    withoutImage.render(recWithout.ctx);

    // Col PNG: il cursore si vede, il testo non disegna il glifo `>` in più.
    expect(recWith.images().filter((op) => op.image === 'menu_cursor')).toHaveLength(1);
    // Senza il PNG (misura 0x0, come se mancasse): niente drawImage del
    // cursore, ma il ripiego testuale `>` prende il suo posto: più pixel.
    expect(recWithout.images().filter((op) => op.image === 'menu_cursor')).toHaveLength(0);
    const fillsWith = recWith.ops.filter((op) => op.type === 'fillRect').length;
    const fillsWithout = recWithout.ops.filter((op) => op.type === 'fillRect').length;
    expect(fillsWithout).toBeGreaterThan(fillsWith);
  });
});

describe('leggibilita sul tramonto (task 15)', () => {
  test('ogni scritta della radio ha il contorno scuro', () => {
    const rec = createRecordCtx();
    const screen = createRadioScreen(makeRadioDeps(baseAudio()));
    screen.enter(undefined);
    screen.render(rec.ctx);
    const outline = rec.ops.filter((op) => op.type === 'fillRect' && op.fill === '#101018');
    // Cinque scritte (titolo, tre brani, suggerimento) piu il display: il
    // contorno e una passata di fillRect per pixel di glifo, quindi tanti.
    expect(outline.length).toBeGreaterThan(200);
    // Nessun testo resta grigio spento: il non selezionato e chiaro.
    const greys = rec.ops.filter((op) => op.fill === '#cccccc');
    expect(greys).toHaveLength(0);
  });
});

describe('la radio sceglie anche l\'auto (Set 7)', () => {
  const withCar = (car = createCarSetting()): ScreenDeps => ({ ...makeRadioDeps(baseAudio(), assetsWithRadioArt()), car });

  test('C (gearToggle) cycles new, classic, retro, sport, super, once per press, and leaves the song alone', () => {
    const car = createCarSetting();
    const played: number[] = [];
    const deps = { ...withCar(car), audio: { ...baseAudio(), playSong: (i: number) => played.push(i) } };
    const screen = createRadioScreen(deps);
    screen.enter();
    expect(car.get()).toBe('new');
    expect(wantsCarToggle({ ...emptyActions(), gearToggle: true })).toBe(true);
    screen.update(1 / 60, { ...emptyActions(), gearToggle: true });
    expect(car.get()).toBe('classic');
    screen.update(1 / 60, emptyActions());
    expect(car.get()).toBe('classic');
    screen.update(1 / 60, { ...emptyActions(), gearToggle: true });
    expect(car.get()).toBe('retro');
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), gearToggle: true });
    expect(car.get()).toBe('sport');
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), gearToggle: true });
    expect(car.get()).toBe('super');
    screen.update(1 / 60, emptyActions());
    screen.update(1 / 60, { ...emptyActions(), gearToggle: true });
    expect(car.get()).toBe('new');
    expect(played).toEqual([0]);
  });

  test('it draws the straight frame of the chosen car and its label', () => {
    const car = createCarSetting();
    const screen = createRadioScreen(withCar(car));
    screen.enter();
    const draw = (): string[] => {
      const rec = createRecordCtx();
      screen.render(rec.ctx);
      return rec.images().map((op) => op.image ?? '');
    };
    expect(draw()).toContain('player_straight');
    car.toggle();
    const classic = draw();
    expect(classic).toContain('player_classic_straight');
    expect(classic).not.toContain('player_straight');
    car.toggle();
    const retro = draw();
    expect(retro).toContain('player_retro_straight');
    expect(retro).not.toContain('player_straight');
    car.toggle();
    expect(draw()).toContain('player_sport_straight');
    car.toggle();
    expect(draw()).toContain('player_super_straight');
  });

  test('without a car setting the radio draws no car, as before', () => {
    const screen = createRadioScreen(makeRadioDeps(baseAudio(), assetsWithRadioArt()));
    screen.enter();
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    expect(rec.images().some((op) => (op.image ?? '').startsWith('player_'))).toBe(false);
  });
});

describe('la radio sceglie anche la modalità (collaudo utente: due livelli)', () => {
  const withMode = (mode = createModeSetting()): ScreenDeps => ({
    ...makeRadioDeps(baseAudio(), assetsWithRadioArt()),
    car: createCarSetting(),
    mode,
  });
  /** Pixel accesi della scritta, per colore, nella fascia della scritta `CAR:`. */
  const labelPixels = (screen: ReturnType<typeof createRadioScreen>) => {
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    return rec
      .fills()
      .filter((op) => op.args[1] >= RADIO_CAR_LABEL_Y - 2 && op.args[1] < RADIO_CAR_LABEL_Y + 18);
  };

  test('D (modeToggle) goes NORMAL, HARD, NORMAL, once per press, and leaves car and song alone', () => {
    const mode = createModeSetting();
    const played: number[] = [];
    const deps = { ...withMode(mode), audio: { ...baseAudio(), playSong: (i: number) => played.push(i) } };
    const screen = createRadioScreen(deps);
    screen.enter();
    expect(mode.get()).toBe('normal');
    expect(wantsModeToggle({ ...emptyActions(), modeToggle: true })).toBe(true);
    screen.update(1 / 60, { ...emptyActions(), modeToggle: true });
    expect(mode.get()).toBe('hard');
    screen.update(1 / 60, emptyActions());
    expect(mode.get()).toBe('hard');
    screen.update(1 / 60, { ...emptyActions(), modeToggle: true });
    expect(mode.get()).toBe('normal');
    expect(deps.car?.get()).toBe('new');
    expect(played).toEqual([0]);
  });

  test('the label sits on the other side of the list, mirrored from CAR:, and turns red in HARD', () => {
    const mode = createModeSetting();
    const screen = createRadioScreen(withMode(mode));
    screen.enter();
    const right = (ops: ReturnType<typeof labelPixels>, colour: string) =>
      ops.filter((op) => op.fill === colour && op.args[0] > LOGICAL_W / 2 + 300);
    expect(RADIO_MODE_X).toBe(LOGICAL_W - RADIO_CAR_X);
    expect(right(labelPixels(screen), RADIO_MODE_COLORS.normal).length).toBeGreaterThan(0);
    mode.toggle();
    const hard = labelPixels(screen);
    expect(right(hard, RADIO_MODE_COLORS.hard).length).toBeGreaterThan(0);
    // Tutta la scritta sta dentro lo schermo e lontana dall'elenco.
    for (const op of right(hard, RADIO_MODE_COLORS.hard)) {
      expect(op.args[0]).toBeGreaterThan(LOGICAL_W / 2 + 300);
      expect(op.args[0] + op.args[2]).toBeLessThanOrEqual(LOGICAL_W);
    }
  });

  test('without a mode setting the radio draws no mode, as before', () => {
    const screen = createRadioScreen({ ...makeRadioDeps(baseAudio(), assetsWithRadioArt()), car: createCarSetting() });
    screen.enter();
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    expect(rec.fills().some((op) => op.fill === RADIO_MODE_COLORS.hard || (op.fill === RADIO_MODE_COLORS.normal && op.args[0] > LOGICAL_W / 2 + 300 && op.args[1] >= RADIO_CAR_LABEL_Y - 2 && op.args[1] < RADIO_CAR_LABEL_Y + 18))).toBe(false);
  });
});

describe('la radio col tocco, a misura di telefono', () => {
  type R = { x: number; y: number; w: number; h: number };
  const overlap = (a: R, b: R): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const opsFor = (device: InputDevice | undefined) => {
    const deps = { ...makeRadioDeps(baseAudio(), assetsWithRadioArt()), car: createCarSetting(), mode: createModeSetting() };
    const screen = createRadioScreen(device === undefined ? deps : { ...deps, device: () => device });
    screen.enter();
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    return rec.ops;
  };

  test('su desktop la radio resta com\'era: con la tastiera disegna come senza dispositivo, col tocco no', () => {
    expect(opsFor('keyboard')).toEqual(opsFor(undefined));
    expect(opsFor('pad')).not.toEqual(opsFor('touch'));
    expect(opsFor('touch')).not.toEqual(opsFor(undefined));
  });

  test('pulsanti grandi (44 px CSS su un iPhone SE in orizzontale) e niente sovrapposizioni', () => {
    const k = 375 / 720;
    const buttons = touchLayout('radio', { tiltAvailable: true, tiltOn: false, cssPerLogical: k });
    for (const b of buttons) expect(Math.min(b.rect.w, b.rect.h) * k, b.id).toBeGreaterThanOrEqual(44);
    for (const a of buttons) for (const b of buttons) if (a !== b) expect(overlap(a.rect, b.rect), `${a.id}/${b.id}`).toBe(false);
    // Auto e modalità sono le cornici che la radio disegna.
    expect(buttons.find((b) => b.id === 'car')!.rect).toEqual(RADIO_CAR_RECT);
    expect(buttons.find((b) => b.id === 'mode')!.rect).toEqual(RADIO_MODE_RECT);
  });

  test('i testi non si sovrappongono: spiegazione di TILT, elenco, auto, modalità e riga dei comandi', () => {
    const hintW = Math.max(...TILT_HINT_LINES.map((l) => measureText(l, 3)));
    const hint = { x: TILT_HINT_RIGHT - hintW, y: TILT_HINT_Y, w: hintW, h: TILT_HINT_LINES.length * 30 };
    const longest = Math.max(measureText(DRIVE_LINES.touch, 3), measureText(DRIVE_LINE_TOUCH_TILT, 3));
    expect(longest).toBeLessThanOrEqual(LOGICAL_W - 40);
    const controls = { x: LOGICAL_W / 2 - longest / 2, y: RADIO_TOUCH_CONTROLS_Y, w: longest, h: 21 };
    // Le righe dell'elenco a scala 3 sono larghe al più come la fascia.
    const rows = { x: LOGICAL_W / 2 - 192, y: 176, w: 384, h: 2 * 38 + 21 };
    const boxes: [string, R][] = [
      ['hint', hint],
      ['tilt', RADIO_TILT_RECT],
      ['rows', rows],
      ['car', RADIO_CAR_RECT],
      ['mode', RADIO_MODE_RECT],
      ['controls', controls],
    ];
    for (const [na, a] of boxes) for (const [nb, b] of boxes) if (na !== nb) expect(overlap(a, b), `${na}/${nb}`).toBe(false);
    expect(rows.x).toBeGreaterThanOrEqual(RADIO_TOUCH_LIST_BAND.x);
    // Sopra il pannello, che comincia a LOGICAL_H - PANEL_H.
    expect(controls.y + controls.h).toBeLessThanOrEqual(LOGICAL_H - PANEL_H + 2);
  });

  test('scala 3 quando ci sta, 2 per i titoli lunghi', () => {
    expect(fitScale('MIRRORBALL MILE', 400)).toBe(3);
    expect(fitScale('A VERY LONG CUSTOM TRACK TITLE', 400)).toBe(2);
  });
});
