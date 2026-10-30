import { describe, expect, test } from 'vitest';
import { emptyActions, mapGamepad, mapKeys } from '../../src/core/input';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createScoresStore } from '../../src/persist/scores';
import { createFsm, type Screen } from '../../src/ui/fsm';
import {
  closedPause,
  drawPause,
  openPause,
  PAUSE_ITEMS,
  pauseButtons,
  pauseHit,
  stepPause,
  wantsPause,
} from '../../src/ui/pause';
import { stepRadio, initialRadioState } from '../../src/ui/screens/radio';
import { createRaceScreen } from '../../src/ui/screens/race';
import type { ScreenDeps } from '../../src/ui/deps';
import type { LogicalPoint, SystemSignals } from '../../src/core/signals';
import type { Actions, AudioBus, RaceEngine, RaceSnapshot, StageDef } from '../../src/types';
import { createFakeCtx } from '../helpers/fakeCtx';

const a = (over: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...over });

const stage: StageDef = {
  id: '0-0',
  name: 'Palm Bay',
  theme: 'beach',
  lengthSegments: 2260,
  timeLimit: 80,
  seed: 1,
  difficulty: 0.15,
};

describe('input: P, Esc e Start', () => {
  test('P è la pausa, Esc resta back, entrambe momentanee', () => {
    const press = mapKeys(new Set(['KeyP', 'Escape']), new Set(['KeyP', 'Escape']));
    expect(press.pause).toBe(true);
    expect(press.back).toBe(true);
    const held = mapKeys(new Set(['KeyP']), new Set());
    expect(held.pause).toBe(false);
  });

  test('un colpetto di freccia rilasciato prima del tick conta per quel tick', () => {
    expect(mapKeys(new Set(), new Set(['ArrowDown'])).brake).toBe(true);
    expect(mapKeys(new Set(), new Set()).brake).toBe(false);
  });

  test('Start del gamepad conferma nei menu e mette in pausa in gara, sul fronte', () => {
    const pad = { buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 9 })), axes: [0, 0] };
    const first = mapGamepad(pad, []);
    expect(first.actions.pause).toBe(true);
    expect(first.actions.confirm).toBe(true);
    const again = mapGamepad(pad, first.buttons);
    expect(again.actions.pause).toBe(false);
  });

  test('wantsPause: Esc (back) o pause', () => {
    expect(wantsPause(a({ back: true }))).toBe(true);
    expect(wantsPause(a({ pause: true }))).toBe(true);
    expect(wantsPause(a({ confirm: true }))).toBe(false);
    expect(wantsPause(a())).toBe(false);
  });
});

describe('menu di pausa, riduttore puro', () => {
  test('si apre su CONTINUE e il gas tenuto non muove il cursore', () => {
    let s = openPause(a({ accelerate: true }));
    expect(s.open).toBe(true);
    expect(s.selected).toBe(0);
    s = stepPause(s, a({ accelerate: true })).state;
    expect(s.selected).toBe(0);
  });

  test('Su e Giù muovono il cursore sul fronte, con giro', () => {
    let s = openPause(a());
    s = stepPause(s, a({ brake: true })).state;
    expect(PAUSE_ITEMS[s.selected]).toBe('restart');
    s = stepPause(s, a({ brake: true })).state; // tenuto: fermo
    expect(PAUSE_ITEMS[s.selected]).toBe('restart');
    s = stepPause(s, a()).state;
    s = stepPause(s, a({ brake: true })).state;
    expect(PAUSE_ITEMS[s.selected]).toBe('title');
    s = stepPause(s, a()).state;
    s = stepPause(s, a({ brake: true })).state;
    expect(PAUSE_ITEMS[s.selected]).toBe('continue');
    s = stepPause(s, a()).state;
    s = stepPause(s, a({ accelerate: true })).state;
    expect(PAUSE_ITEMS[s.selected]).toBe('title');
  });

  test('Invio sceglie la voce selezionata', () => {
    let s = openPause(a());
    expect(stepPause(s, a({ confirm: true })).choice).toBe('continue');
    s = stepPause(s, a({ brake: true })).state;
    expect(stepPause(s, a({ confirm: true })).choice).toBe('restart');
  });

  test('Esc, P e Start richiudono (CONTINUE), anche con una voce diversa selezionata', () => {
    let s = openPause(a());
    s = stepPause(s, a({ brake: true })).state;
    expect(stepPause(s, a({ back: true })).choice).toBe('continue');
    expect(stepPause(s, a({ pause: true })).choice).toBe('continue');
    // Start porta sia confirm sia pause: vince la ripresa.
    expect(stepPause(s, a({ pause: true, confirm: true })).choice).toBe('continue');
  });

  test('un tocco su un pulsante lo sceglie; fuori dai pulsanti niente', () => {
    const s = openPause(a());
    for (const b of pauseButtons()) {
      const centre: LogicalPoint = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      expect(stepPause(s, a(), centre).choice).toBe(b.choice);
    }
    expect(stepPause(s, a(), { x: 10, y: 10 }).choice).toBeNull();
    expect(pauseHit({ x: 10, y: 10 })).toBeNull();
  });

  test('i pulsanti sono almeno 44x44 px logici, non si sovrappongono e stanno nello schermo', () => {
    const bs = pauseButtons();
    expect(bs.map((b) => b.choice)).toEqual(['continue', 'restart', 'title']);
    for (const b of bs) {
      expect(b.w).toBeGreaterThanOrEqual(44);
      expect(b.h).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(720);
    }
    for (let i = 1; i < bs.length; i++) expect(bs[i].y).toBeGreaterThan(bs[i - 1].y + bs[i - 1].h);
  });

  test('drawPause disegna senza lanciare', () => {
    expect(() => drawPause(createFakeCtx() as unknown as CanvasRenderingContext2D, openPause(a()))).not.toThrow();
  });
});

describe('radio: Esc torna al titolo', () => {
  test('back porta al titolo, confirm resta la partenza', () => {
    expect(stepRadio(initialRadioState(), a({ back: true }), 3).transition?.to).toBe('title');
    expect(stepRadio(initialRadioState(), a({ confirm: true }), 3).transition?.to).toBe('race');
  });
});

/** Motore finto con un cronometro vero: il tempo scende solo con i dt che riceve. */
function timedEngine(): RaceEngine & { dts: number[] } {
  const dts: number[] = [];
  let timeLeft = 80;
  const snap = (): RaceSnapshot =>
    ({
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
      timeLeft,
      score: 0,
      stage: { ...stage, weather: 'rain' },
      level: 0,
      route: [],
      parallax: { far: 0, near: 0, y: 0 },
      theme: 'beach',
      banner: 'none',
      kmh: 100,
    }) as RaceSnapshot;
  return {
    dts,
    update(dt) {
      dts.push(dt);
      timeLeft -= dt;
      return [];
    },
    snapshot: snap,
  };
}

interface AudioLog {
  calls: string[];
  bus: AudioBus;
}

function audioLog(): AudioLog {
  const calls: string[] = [];
  const bus: AudioBus = {
    unlock() {},
    playSong(i, options) {
      calls.push(options?.resume === true ? `playSong:${i}:resume` : `playSong:${i}`);
    },
    stopSong() {
      calls.push('stopSong');
    },
    stopAll() {
      calls.push('stopAll');
    },
    sfx() {},
    setEngine(_s, _g, running) {
      calls.push(`setEngine:${running}`);
    },
    setSkid() {},
    setRumble() {},
    setRain(level) {
      calls.push(`setRain:${level}`);
    },
    toggleMute: () => false,
    muted: false,
    available: true,
  };
  return { calls, bus };
}

function fakeSignals(): SystemSignals & { tap: LogicalPoint | null; lost: boolean } {
  const s = {
    tap: null as LogicalPoint | null,
    lost: false,
    takeTap() {
      const t = s.tap;
      s.tap = null;
      return t;
    },
    takeFocusLost() {
      const l = s.lost;
      s.lost = false;
      return l;
    },
  };
  return s;
}

function setup() {
  const engines: ReturnType<typeof timedEngine>[] = [];
  const audio = audioLog();
  const signals = fakeSignals();
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
    audio: audio.bus,
    scores: createScoresStore(),
    raceFactory: () => {
      const e = timedEngine();
      engines.push(e);
      return e;
    },
    renderWorld: () => {},
    firstStage: stage,
    signals,
  };
  const screen = createRaceScreen(deps);
  return { screen, engines, audio, signals, deps };
}

const STEP = 1 / 60;

describe('pausa nella schermata di gara', () => {
  test('Esc mette in pausa: il motore non riceve tick e il tempo resta fermo', () => {
    const { screen, engines } = setup();
    screen.enter({ song: 2 });
    screen.update(STEP, a());
    const engine = engines[0];
    const before = engine.snapshot().timeLeft;
    expect(screen.update(STEP, a({ back: true }))).toBeNull();
    for (let i = 0; i < 600; i++) expect(screen.update(STEP, a({ accelerate: true }))).toBeNull();
    // Anche un tick enorme (scheda tornata visibile) non passa.
    screen.update(0.25, a());
    expect(engine.dts.length).toBe(1);
    expect(engine.snapshot().timeLeft).toBe(before);
  });

  test('P mette in pausa come Esc', () => {
    const { screen, engines } = setup();
    screen.enter({ song: 0 });
    screen.update(STEP, a({ pause: true }));
    screen.update(STEP, a());
    expect(engines[0].dts.length).toBe(0);
  });

  test('alla pausa motore, pioggia e musica si fermano; alla ripresa torna il brano', () => {
    const { screen, audio } = setup();
    screen.enter({ song: 2 });
    screen.update(STEP, a());
    audio.calls.length = 0;
    screen.update(STEP, a({ back: true }));
    expect(audio.calls).toEqual(
      expect.arrayContaining(['setEngine:false', 'setRain:0', 'stopAll', 'stopSong']),
    );
    expect(audio.calls).not.toContain('setEngine:true');
    audio.calls.length = 0;
    for (let i = 0; i < 10; i++) screen.update(STEP, a());
    expect(audio.calls).toEqual([]); // in pausa nessuno riaccende niente
    screen.update(STEP, a({ confirm: true })); // CONTINUE
    // CONTINUE riprende il brano da dove era, non dall'inizio.
    expect(audio.calls).toEqual(['playSong:2:resume']);
  });

  test('CONTINUE riprende senza salto di tempo: il dt dei tick in pausa si scarta', () => {
    const { screen, engines } = setup();
    screen.enter({ song: 0 });
    screen.update(STEP, a());
    screen.update(STEP, a({ back: true }));
    for (let i = 0; i < 300; i++) screen.update(STEP, a());
    screen.update(STEP, a({ confirm: true })); // anche questo tick si scarta
    const engine = engines[0];
    expect(engine.dts).toEqual([STEP]);
    screen.update(STEP, a());
    expect(engine.dts).toEqual([STEP, STEP]);
    expect(engine.snapshot().timeLeft).toBeCloseTo(80 - 2 * STEP, 9);
  });

  test('Esc di nuovo richiude la pausa', () => {
    const { screen, engines } = setup();
    screen.enter({ song: 0 });
    screen.update(STEP, a({ back: true }));
    screen.update(STEP, a({ back: true }));
    screen.update(STEP, a());
    expect(engines[0].dts).toEqual([STEP]);
  });

  test('RESTART e TITLE: transizioni giuste, e RESTART riparte dalla prima tappa col suo brano', () => {
    const { screen, engines, audio } = setup();
    screen.enter({ song: 1 });
    // Si lavora direttamente sulla schermata: RESTART ritorna go('race').
    screen.update(STEP, a());
    screen.update(STEP, a({ back: true }));
    screen.update(STEP, a({ brake: true }));
    const restart = screen.update(STEP, a({ confirm: true }));
    expect(restart).toEqual({ to: 'race', payload: { song: 1 } });
    // La macchina a stati fa exit() + enter(): un motore nuovo dalla prima tappa.
    audio.calls.length = 0;
    screen.exit?.();
    screen.enter(restart!.payload);
    expect(engines.length).toBe(2);
    expect(audio.calls).toContain('stopSong');
    expect(audio.calls).toContain('stopAll');
    expect(audio.calls[audio.calls.length - 1]).toBe('playSong:1');
    // La gara nuova parte senza pausa.
    screen.update(STEP, a());
    expect(engines[1].dts).toEqual([STEP]);

    screen.update(STEP, a({ pause: true }));
    screen.update(STEP, a({ accelerate: true })); // su: da CONTINUE a TITLE
    const title = screen.update(STEP, a({ confirm: true }));
    expect(title?.to).toBe('title');
  });

  test('RESTART passa per la macchina a stati: exit ed enter della stessa schermata', () => {
    const { screen, engines } = setup();
    const stub: Screen = { enter() {}, update: () => null, render() {} };
    const fsm = createFsm(
      { title: stub, daily: stub, radio: stub, race: screen, ending: stub, gameOver: stub, nameEntry: stub, scores: stub, endings: stub },
      'race',
    );
    // createFsm chiama enter() senza payload: brano 0.
    fsm.update(STEP, a());
    fsm.update(STEP, a({ back: true }));
    fsm.update(STEP, a({ brake: true }));
    fsm.update(STEP, a({ confirm: true }));
    expect(fsm.name).toBe('race');
    expect(engines.length).toBe(2);
    fsm.update(STEP, a());
    expect(engines[1].dts).toEqual([STEP]);
  });

  test('pausa automatica sulla perdita del fuoco, solo dentro la gara', () => {
    const { screen, engines, signals } = setup();
    // Fuoco perso prima della gara (titolo, radio): non apre la pausa.
    signals.lost = true;
    screen.enter({ song: 0 });
    screen.update(STEP, a());
    expect(engines[0].dts).toEqual([STEP]);
    // In gara sì, prima di far avanzare il motore di quel tick.
    signals.lost = true;
    screen.update(0.25, a());
    for (let i = 0; i < 30; i++) screen.update(STEP, a());
    expect(engines[0].dts).toEqual([STEP]);
    // Ancora un blur a menu aperto non lo chiude.
    signals.lost = true;
    screen.update(STEP, a());
    expect(engines[0].dts).toEqual([STEP]);
    screen.update(STEP, a({ confirm: true }));
    screen.update(STEP, a());
    expect(engines[0].dts).toEqual([STEP, STEP]);
  });

  test('pausa al primo tick: la render ha comunque la gara sotto il menu', () => {
    const { screen, signals } = setup();
    screen.enter({ song: 0 });
    signals.lost = true;
    screen.update(STEP, a());
    expect(() => screen.render(createFakeCtx() as unknown as CanvasRenderingContext2D)).not.toThrow();
  });

  test('un tocco sul pulsante TITLE lo sceglie; un tocco in gara non apre niente', () => {
    const { screen, engines, signals } = setup();
    screen.enter({ song: 0 });
    const title = pauseButtons().find((b) => b.choice === 'title')!;
    signals.tap = { x: title.x + 5, y: title.y + 5 };
    screen.update(STEP, a());
    expect(engines[0].dts).toEqual([STEP]); // in gara il tocco non conta
    screen.update(STEP, a({ back: true }));
    signals.tap = { x: title.x + title.w / 2, y: title.y + title.h / 2 };
    expect(screen.update(STEP, a())?.to).toBe('title');
  });

  test('closedPause è chiusa', () => {
    expect(closedPause().open).toBe(false);
  });
});
