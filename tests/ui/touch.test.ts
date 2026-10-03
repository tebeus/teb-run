import { describe, expect, test } from 'vitest';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { createTilt, tiltSteer, TILT_DEADZONE_DEG, type TiltControl } from '../../src/core/tilt';
import { MOTION_BLOCKED_SECONDS } from '../../src/ui/radioTouch';
import { fullscreenButtonRect, titleLinkRects, touchRect, type Rect } from '../../src/ui/launchUi';
import { pauseButtons } from '../../src/ui/pause';
import { SHARE_BUTTON } from '../../src/ui/share';
import {
  buttonAt,
  createTouchControls,
  drawTouchButtons,
  deadZones,
  fingerHold,
  heldActions,
  RESIZE_RELEASE,
  showTiltHint,
  STEER_MAX_X,
  steerGeometry,
  touchLayout,
  type TouchButton,
} from '../../src/ui/touch';
import { inside } from '../../src/ui/rect';
import type { ScreenName } from '../../src/ui/fsm';
import type { InputDevice } from '../../src/core/device';

const SCREENS: ScreenName[] = ['title', 'radio', 'race', 'ending', 'gameOver', 'nameEntry', 'scores'];
const OPTS = { tiltAvailable: true, tiltOn: false };
const centre = (b: { rect: Rect } | Rect): { x: number; y: number } => {
  const r = 'rect' in b ? b.rect : b;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const byId = (screen: ScreenName, id: string): TouchButton => touchLayout(screen, OPTS).find((b) => b.id === id)!;

describe('touchLayout', () => {
  test('ogni schermata è usabile col tocco, con pulsanti dentro lo schermo e non sovrapposti', () => {
    for (const screen of SCREENS) {
      const buttons = touchLayout(screen, OPTS);
      expect(buttons.length, screen).toBeGreaterThan(0);
      const drawn = buttons.filter((b) => !b.hidden);
      for (const b of buttons) {
        expect(b.rect.x).toBeGreaterThanOrEqual(0);
        expect(b.rect.y).toBeGreaterThanOrEqual(0);
        expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(LOGICAL_W);
        expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(LOGICAL_H);
        // 44 px CSS su un telefono largo 700 px CSS: 80 px logici.
        expect(Math.min(b.rect.w, b.rect.h), `${screen}/${b.id}`).toBeGreaterThanOrEqual(64);
      }
      for (const a of drawn) for (const b of drawn) if (a !== b) expect(overlap(a.rect, b.rect), `${a.id}/${b.id}`).toBe(false);
    }
  });

  test('la gara ha sterzo, gas, freno, marcia e pausa', () => {
    const actions = touchLayout('race', OPTS).map((b) => b.action).sort();
    expect(actions).toEqual(['accelerate', 'brake', 'gearToggle', 'left', 'pause', 'right']);
  });

  test('in gara solo cerchi, dentro la loro zona, lontani dall\'auto e dalle cifre dell\'HUD', () => {
    // Velocità e KM/H in basso a sinistra, nome, STAGE, scala e LO/HI in basso a destra, l'auto al centro.
    const keepClear: Rect[] = [
      { x: 24, y: 650, w: 260, h: 70 },
      { x: 960, y: 600, w: 320, h: 120 },
      { x: 500, y: 560, w: 280, h: 160 },
    ];
    for (const b of touchLayout('race', OPTS)) {
      const m = b.mark!;
      expect(m, b.id).toBeDefined();
      expect(m.size, b.id).toBeLessThanOrEqual(90);
      expect(m.size, b.id).toBeGreaterThanOrEqual(b.id === 'pause' ? 60 : 75);
      const box = { x: m.x - m.size / 2, y: m.y - m.size / 2, w: m.size, h: m.size };
      // Dove lo si vede, lo si tocca: il cerchio sta tutto dentro la sua zona.
      expect(inside(b.rect, box.x, box.y) && inside(b.rect, box.x + box.w - 1, box.y + box.h - 1), b.id).toBe(true);
      for (const k of keepClear) expect(overlap(box, k), b.id).toBe(false);
    }
  });

  test('con TILT acceso niente frecce: né cerchi né zone; restano GAS, BRAKE, GEAR e pausa', () => {
    const on = touchLayout('race', { ...OPTS, tiltOn: true });
    expect(on.map((b) => b.id).sort()).toEqual(['brake', 'gas', 'gear', 'pause']);
    const off = touchLayout('race', OPTS);
    const where = centre(off.find((b) => b.id === 'left')!);
    expect(buttonAt(on, where, 1)).toBeNull();
    expect(heldAt(on, [where, centre(off.find((b) => b.id === 'right')!)]).left).toBe(false);
    // Il resto non si muove.
    expect(on).toEqual(off.filter((b) => b.id !== 'left' && b.id !== 'right'));
  });

  test('a destra GAS sopra BRAKE in colonna, senza buchi, e GEAR accanto verso il centro a metà', () => {
    const gas = byId('race', 'gas');
    const brake = byId('race', 'brake');
    const gear = byId('race', 'gear');
    expect(gas.rect.x).toBe(brake.rect.x);
    expect(gas.rect.w).toBe(brake.rect.w);
    expect(gas.rect.y + gas.rect.h).toBe(brake.rect.y);
    expect(gas.mark!.x).toBe(brake.mark!.x);
    expect(gas.mark!.size).toBe(brake.mark!.size);
    // GEAR tocca la colonna dal lato del centro, alla quota del confine fra i due.
    expect(gear.rect.x + gear.rect.w).toBe(gas.rect.x);
    expect(gear.mark!.y).toBe(brake.rect.y);
    expect(gear.rect.y).toBeLessThan(brake.rect.y);
    expect(gear.rect.y + gear.rect.h).toBeGreaterThan(brake.rect.y);
    expect(buttonAt(touchLayout('race', OPTS), { x: gas.mark!.x, y: brake.rect.y }, 1)?.id).toBe('brake');
    expect(buttonAt(touchLayout('race', OPTS), { x: gas.mark!.x, y: brake.rect.y - 1 }, 1)?.id).toBe('gas');
  });

  test('nessun pulsante copre il menu di pausa, lo schermo intero o i link del titolo', () => {
    for (const b of touchLayout('race', OPTS)) for (const p of pauseButtons()) expect(overlap(b.rect, p)).toBe(false);
    for (const b of touchLayout('radio', OPTS)) expect(overlap(b.rect, fullscreenButtonRect())).toBe(false);
    for (const b of touchLayout('title', OPTS)) {
      expect(overlap(b.rect, fullscreenButtonRect())).toBe(false);
      for (const link of titleLinkRects()) expect(overlap(b.rect, link)).toBe(false);
    }
  });

  test('TILT grande, con l\'icona del telefono, acceso pieno quando è ON', () => {
    const off = byId('radio', 'tilt');
    const on = touchLayout('radio', { tiltAvailable: true, tiltOn: true }).find((b) => b.id === 'tilt')!;
    expect(off.icon).toBe('tilt');
    expect(off.lit).toBe(false);
    expect(on.lit).toBe(true);
    // 44 px CSS anche su un iPhone SE in orizzontale (375 px CSS di altezza).
    expect(Math.min(off.rect.w, off.rect.h) * (375 / 720)).toBeGreaterThanOrEqual(44);
    expect(off.rect.x + off.rect.w).toBeLessThanOrEqual(LOGICAL_W);
  });

  test('TILT c\'è solo se ci sono i sensori, e dice se è acceso', () => {
    expect(touchLayout('radio', { tiltAvailable: false, tiltOn: false }).some((b) => b.id === 'tilt')).toBe(false);
    expect(byId('radio', 'tilt').label).toBe('TILT OFF');
    expect(touchLayout('radio', { tiltAvailable: true, tiltOn: true }).find((b) => b.id === 'tilt')!.label).toBe('TILT ON');
  });
});

/** Le azioni di dita appena appoggiate (nessun tick prima). */
const heldAt = (buttons: TouchButton[], points: { x: number; y: number }[]) =>
  heldActions(
    buttons,
    points.map((p) => fingerHold(buttons, [], null, p, 1)),
  );

describe('buttonAt e heldActions', () => {
  test('gas e sterzo insieme, con due dita', () => {
    const race = touchLayout('race', OPTS);
    const a = heldAt(race, [centre(byId('race', 'gas')), centre(byId('race', 'left'))]);
    expect(a.accelerate).toBe(true);
    expect(a.left).toBe(true);
    expect(a.right).toBe(false);
    expect(a.brake).toBe(false);
  });

  test('le tap non restano tenute; fuori da tutto non succede niente', () => {
    const race = touchLayout('race', OPTS);
    expect(heldAt(race, [centre(byId('race', 'pause'))]).pause).toBe(false);
    expect(buttonAt(race, { x: 640, y: 300 }, 1)).toBeNull();
  });

  test('un pulsante piccolo si allarga a 44 px CSS su uno schermo piccolo', () => {
    const race = touchLayout('race', OPTS);
    const pause = byId('race', 'pause');
    // A 0.3 px CSS per px logico servono ~147 px logici: poco fuori dal bordo conta.
    const p = { x: pause.rect.x + pause.rect.w / 2, y: pause.rect.y + pause.rect.h + 20 };
    expect(buttonAt(race, p, 1)).toBeNull();
    expect(buttonAt(race, p, 0.3)?.id).toBe('pause');
  });

  // px CSS per px logico col letterbox: iPhone SE 667x375, iPhone 14 844x390, iPad 1024x768 e 1180x820, desktop.
  const SCREENS_K: Record<string, number> = {
    'iPhone SE': 375 / 720,
    'iPhone 14': 390 / 720,
    'iPad': 1024 / 1280,
    'iPad Air': 1180 / 1280,
    'desktop': 1,
  };

  test('le frecce a un pollice l\'una dall\'altra, in px CSS, su ogni schermo; zone grandi e fascia morta stretta', () => {
    for (const [name, k] of Object.entries(SCREENS_K)) {
      const race = touchLayout('race', { ...OPTS, cssPerLogical: k });
      const left = race.find((b) => b.id === 'left')!;
      const right = race.find((b) => b.id === 'right')!;
      const gap = steerGeometry(k).gap;
      const space = (right.mark!.x - left.mark!.x - right.mark!.size) * k;
      expect(space, name).toBeGreaterThanOrEqual(60);
      expect(space, name).toBeLessThanOrEqual(75);
      expect(left.rect.x, name).toBe(0);
      expect(right.rect.x + right.rect.w, name).toBeLessThanOrEqual(STEER_MAX_X);
      // Contigue alla fascia morta, che è stretta ma c'è.
      expect(left.rect.x + left.rect.w, name).toBeCloseTo(gap.x);
      expect(gap.x + gap.w, name).toBeCloseTo(right.rect.x);
      expect(gap.w * k, name).toBeGreaterThanOrEqual(20);
      expect(gap.w * k, name).toBeLessThanOrEqual(30);
      for (const b of [left, right]) {
        expect(Math.min(b.rect.w, b.rect.h) * k, `${name}/${b.id}`).toBeGreaterThanOrEqual(44);
        expect(b.mark!.x - b.mark!.size / 2, `${name}/${b.id}`).toBeGreaterThanOrEqual(b.rect.x);
        expect(b.mark!.x + b.mark!.size / 2, `${name}/${b.id}`).toBeLessThanOrEqual(b.rect.x + b.rect.w);
      }
      // Nella fascia morta un tocco non fa niente, anche col riquadro allargato.
      const mid = centre(gap);
      expect(buttonAt(race, mid, k), name).toBeNull();
      expect(fingerHold(race, deadZones('race', k), null, mid, k), name).toBeNull();
      expect(deadZones('race', k), name).toEqual([gap]);
    }
    expect(deadZones('radio')).toEqual([]);
  });

  test('un dito che scivola nella fascia morta continua a sterzare; nell\'altra zona cambia verso', () => {
    for (const k of Object.values(SCREENS_K)) {
      const race = touchLayout('race', { ...OPTS, cssPerLogical: k });
      const dead = deadZones('race', k);
      const mid = centre(dead[0]);
      const l = centre(race.find((b) => b.id === 'left')!);
      const r = centre(race.find((b) => b.id === 'right')!);
      const hold = (prev: string | null, p: { x: number; y: number }) => fingerHold(race, dead, prev, p, k);
      expect(hold(null, l)).toBe('left');
      expect(hold('left', mid)).toBe('left');
      expect(hold('right', mid)).toBe('right');
      expect(hold('left', r)).toBe('right');
      expect(hold('right', l)).toBe('left');
      // Fuori da tutto (sopra le zone) il dito non tiene più niente.
      expect(hold('left', { x: mid.x, y: 300 })).toBeNull();
    }
  });

  test('sul titolo si tocca ovunque sopra la fascia bassa', () => {
    const title = touchLayout('title', OPTS);
    expect(buttonAt(title, { x: 300, y: 300 }, 1)?.action).toBe('confirm');
    expect(buttonAt(title, { x: 30, y: 700 }, 1)).toBeNull();
  });
});

describe('cerchi della gara', () => {
  test('niente riquadri né cornici: il rettangolo più grande è una stanghetta di freccia o di lettera', () => {
    const rects: number[][] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) => (k === 'globalAlpha' ? 1 : k === 'fillRect' ? (...a: number[]) => rects.push(a) : () => undefined),
        set: () => true,
      },
    );
    drawTouchButtons(ctx as CanvasRenderingContext2D, touchLayout('race', OPTS), new Set());
    expect(rects.length).toBeGreaterThan(0);
    for (const [, , w, h] of rects) expect(Math.max(w, h)).toBeLessThanOrEqual(60);
  });
});

describe('tiltSteer', () => {
  test('orizzontale: beta, col verso che dipende dal lato', () => {
    expect(tiltSteer(TILT_DEADZONE_DEG + 1, 0, 90)).toBe(1);
    expect(tiltSteer(-(TILT_DEADZONE_DEG + 1), 0, 90)).toBe(-1);
    expect(tiltSteer(TILT_DEADZONE_DEG + 1, 0, 270)).toBe(-1);
    expect(tiltSteer(TILT_DEADZONE_DEG + 1, 0, -90)).toBe(-1);
    expect(tiltSteer(2, 0, 90)).toBe(0);
  });
  test('verticale: gamma; niente dati: dritto', () => {
    expect(tiltSteer(0, 20, 0)).toBe(1);
    expect(tiltSteer(null, null, 90)).toBe(0);
    expect(tiltSteer(Number.NaN, 0, 90)).toBe(0);
  });
});

describe('createTouchControls', () => {
  function setup(screen: ScreenName = 'race', tilt?: TiltControl, blocked = false) {
    const win = new EventTarget();
    const canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    });
    let device: InputDevice = 'keyboard';
    const touch = createTouchControls({
      win,
      canvas,
      screen: () => screen,
      device: () => device,
      tilt,
      blocked: () => blocked,
    });
    const ev = (type: string, id: number, p: { x: number; y: number }, pointerType = 'touch'): void => {
      canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: id, clientX: p.x, clientY: p.y, pointerType }));
    };
    return { win, touch, ev, setDevice: (d: InputDevice) => (device = d) };
  }

  test('due dita: gas e destra insieme, finché restano giù', () => {
    const { touch, ev } = setup();
    ev('pointerdown', 1, centre(byId('race', 'gas')));
    ev('pointerdown', 2, centre(byId('race', 'right')));
    let a = touch.poll();
    expect(a.accelerate && a.right).toBe(true);
    a = touch.poll();
    expect(a.accelerate && a.right).toBe(true);
    ev('pointerup', 2, centre(byId('race', 'right')));
    a = touch.poll();
    expect(a.accelerate).toBe(true);
    expect(a.right).toBe(false);
  });

  test('resize: un salto piccolo tiene le dita (e segue il letterbox), piegare o aprire il telefono le lascia', () => {
    const win = new EventTarget();
    let rect = { left: 0, top: 0, width: 1280, height: 720 };
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => rect });
    const touch = createTouchControls({ win, canvas, screen: () => 'race', device: () => 'touch' });
    const ev = (type: string, id: number, x: number, y: number): void => {
      canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: id, clientX: x, clientY: y, pointerType: 'touch' }));
    };
    const gas = centre(byId('race', 'gas'));
    ev('pointerdown', 1, gas.x, gas.y);
    expect(touch.poll().accelerate).toBe(true);
    // La barra di Safari: il canvas scende di qualche px, larghezza quasi uguale. Il dito resta sul gas.
    rect = { left: 0, top: 6, width: 1280 * 0.97, height: 720 * 0.97 };
    expect(0.03).toBeLessThan(RESIZE_RELEASE);
    win.dispatchEvent(new Event('resize'));
    expect(touch.poll().accelerate).toBe(true);
    // Il telefono si apre: il canvas raddoppia. Il dito non vale più.
    rect = { left: 0, top: 200, width: 2000, height: 1125 };
    win.dispatchEvent(new Event('resize'));
    expect(touch.poll().accelerate).toBe(false);
    const drawn: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'globalAlpha' ? 1 : () => drawn.push(String(k))), set: () => true });
    expect(() => touch.draw(ctx as CanvasRenderingContext2D)).not.toThrow();
    // Un dito nuovo funziona con le misure nuove.
    const k = rect.width / LOGICAL_W;
    ev('pointerdown', 2, rect.left + gas.x * k, rect.top + gas.y * k);
    expect(touch.poll().accelerate).toBe(true);
    // Il dito vecchio che si alza dopo non rompe niente.
    ev('pointerup', 1, gas.x, gas.y);
    expect(touch.poll().accelerate).toBe(true);
  });

  test('fascia morta: appoggiato lì non sterza, scivolato da una zona sì', () => {
    const { touch, ev } = setup();
    const mid = centre(steerGeometry(1).gap);
    ev('pointerdown', 1, mid);
    let a = touch.poll();
    expect(a.left || a.right).toBe(false);
    ev('pointerdown', 2, centre(byId('race', 'right')));
    expect(touch.poll().right).toBe(true);
    ev('pointermove', 2, mid);
    a = touch.poll();
    expect(a.right).toBe(true);
    expect(a.left).toBe(false);
    ev('pointermove', 2, centre(byId('race', 'left')));
    a = touch.poll();
    expect(a.left).toBe(true);
    expect(a.right).toBe(false);
    ev('pointermove', 2, mid);
    expect(touch.poll().left).toBe(true);
    ev('pointerup', 2, mid);
    a = touch.poll();
    expect(a.left || a.right).toBe(false);
  });

  test('il dito che scivola da sinistra a destra cambia lo sterzo', () => {
    const { touch, ev } = setup();
    ev('pointerdown', 1, centre(byId('race', 'left')));
    expect(touch.poll().left).toBe(true);
    ev('pointermove', 1, centre(byId('race', 'right')));
    const a = touch.poll();
    expect(a.left).toBe(false);
    expect(a.right).toBe(true);
  });

  test('la pausa vale un tick, come il tasto P; un colpetto veloce conta', () => {
    const { touch, ev } = setup();
    ev('pointerdown', 1, centre(byId('race', 'pause')));
    ev('pointerup', 1, centre(byId('race', 'pause')));
    expect(touch.poll().pause).toBe(true);
    expect(touch.poll().pause).toBe(false);
    ev('pointerdown', 2, centre(byId('race', 'brake')));
    ev('pointerup', 2, centre(byId('race', 'brake')));
    expect(touch.poll().brake).toBe(true);
    expect(touch.poll().brake).toBe(false);
  });

  test('il mouse non passa di qui: su desktop non cambia niente', () => {
    const { touch, ev } = setup();
    ev('pointerdown', 1, centre(byId('race', 'gas')), 'mouse');
    const a = touch.poll();
    expect(Object.values(a).some((v) => v === true)).toBe(false);
    const drawn: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'globalAlpha' ? 1 : () => drawn.push(String(k))), set: () => true });
    touch.draw(ctx as CanvasRenderingContext2D);
    expect(drawn).toEqual([]);
  });

  test('bloccato (telefono in verticale): nessuna azione', () => {
    const { touch, ev } = setup('race', undefined, true);
    ev('pointerdown', 1, centre(byId('race', 'gas')));
    expect(touch.poll().accelerate).toBe(false);
  });

  test('blur lascia andare tutte le dita', () => {
    const { win, touch, ev } = setup();
    ev('pointerdown', 1, centre(byId('race', 'gas')));
    touch.poll();
    win.dispatchEvent(new Event('blur'));
    expect(touch.poll().accelerate).toBe(false);
  });

  test('la spiegazione di TILT: sulla radio, col tocco, finché TILT non è mai stato toccato', () => {
    expect(showTiltHint('radio', 'touch', true, false, false)).toBe(true);
    expect(showTiltHint('radio', 'keyboard', true, false, false)).toBe(false);
    expect(showTiltHint('radio', 'touch', false, false, false)).toBe(false);
    expect(showTiltHint('radio', 'touch', true, true, false)).toBe(false);
    expect(showTiltHint('radio', 'touch', true, false, true)).toBe(false);
    expect(showTiltHint('race', 'touch', true, false, false)).toBe(false);
  });

  test('toccato TILT, la spiegazione sparisce e lo si ricorda', () => {
    let on = false;
    let seen = false;
    const tilt: TiltControl = {
      available: true,
      get on() {
        return on;
      },
      pending: false,
      refusals: 0,
      steer: () => 0,
      toggle: () => {
        on = !on;
      },
      gesture: () => {},
    };
    const canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    });
    const touch = createTouchControls({
      win: new EventTarget(),
      canvas,
      screen: () => 'radio',
      device: () => 'touch',
      tilt,
      tiltSeen: { get: () => seen, set: (v) => (seen = v) },
    });
    expect(touch.notices().tiltHint).toBe(true);
    const t = centre(byId('radio', 'tilt'));
    for (const type of ['pointerdown', 'pointerup']) {
      canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX: t.x, clientY: t.y, pointerType: 'touch' }));
    }
    expect(seen).toBe(true);
    // Spento di nuovo, la spiegazione non torna: TILT ormai si conosce.
    on = false;
    expect(touch.notices().tiltHint).toBe(false);
  });

  test('permesso dei sensori negato: MOTION BLOCKED a schermo per qualche secondo, poi via', async () => {
    const target = new EventTarget();
    const win = Object.assign(target, {
      DeviceOrientationEvent: { requestPermission: () => Promise.reject(new Error('denied')) },
      screen: { orientation: { angle: 90 } },
    }) as unknown as Window;
    const tilt = createTilt(win);
    let clock = 0;
    const canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    });
    const touch = createTouchControls({
      win: new EventTarget(),
      canvas,
      screen: () => 'radio',
      device: () => 'touch',
      tilt,
      now: () => clock,
    });
    expect(touch.notices().motionBlocked).toBe(false);
    const t = centre(byId('radio', 'tilt'));
    for (const type of ['pointerdown', 'pointerup']) {
      canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX: t.x, clientY: t.y, pointerType: 'touch' }));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tilt.on).toBe(false);
    expect(touch.notices().motionBlocked).toBe(true);
    clock += (MOTION_BLOCKED_SECONDS - 1) * 1000;
    expect(touch.notices().motionBlocked).toBe(true);
    clock += 2000;
    expect(touch.notices().motionBlocked).toBe(false);
  });

  test('TILT si accende al rilascio sul pulsante, e in gara sterza', () => {
    let on = false;
    const tilt: TiltControl = {
      available: true,
      get on() {
        return on;
      },
      pending: false,
      refusals: 0,
      steer: () => (on ? 1 : 0),
      toggle: () => {
        on = !on;
      },
      gesture: () => {},
    };
    const radio = setup('radio', tilt);
    const t = centre(byId('radio', 'tilt'));
    radio.ev('pointerdown', 1, t);
    expect(on).toBe(false);
    radio.ev('pointerup', 1, t);
    expect(on).toBe(true);
    const race = setup('race', tilt);
    expect(race.touch.poll().right).toBe(true);
    // Il dito dove con TILT spento c'era la freccia sinistra non sterza più.
    race.ev('pointerdown', 2, centre(byId('race', 'left')));
    const a = race.touch.poll();
    expect(a.left).toBe(false);
    expect(a.right).toBe(true);
  });

  test('TILT in attesa del permesso: il pulsante dice ON, e il primo dito in gara o sulla radio lo chiede', () => {
    const gestures: string[] = [];
    let toggles = 0;
    let where: ScreenName = 'title';
    const tilt: TiltControl = {
      available: true,
      on: false,
      pending: true,
      refusals: 0,
      steer: () => 0,
      toggle: () => {
        toggles += 1;
      },
      gesture: () => {
        gestures.push(where);
      },
    };
    for (const screen of ['title', 'radio', 'race'] as ScreenName[]) {
      where = screen;
      const s = setup(screen, tilt);
      const p = screen === 'race' ? centre(byId('race', 'gas')) : { x: 640, y: 360 };
      s.ev('pointerdown', 1, p);
      s.ev('pointerup', 1, p);
    }
    expect(gestures).toEqual(['radio', 'race']);
    // Sul pulsante TILT il dito spegne (toggle), non chiede il permesso.
    const radio = setup('radio', tilt);
    const t = centre(byId('radio', 'tilt'));
    radio.ev('pointerdown', 2, t);
    radio.ev('pointerup', 2, t);
    expect(toggles).toBe(1);
    expect(gestures).toEqual(['radio', 'race']);
  });
});
