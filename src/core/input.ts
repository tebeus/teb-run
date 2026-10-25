import type { Actions } from '../types';

// Il clic del mouse (`click`) porta un punto, non un sì o un no: resta fuori.
type ActionName = Exclude<keyof Actions, 'click'>;

const HELD: readonly ActionName[] = ['accelerate', 'brake', 'left', 'right'];
// Le altre (gearToggle, modeToggle, confirm, back, mute, pause) sono momentanee:
// vere solo nel tick in cui il tasto è stato premuto.

const KEYS: Readonly<Record<string, ActionName>> = {
  ArrowUp: 'accelerate',
  KeyZ: 'accelerate',
  ArrowDown: 'brake',
  KeyX: 'brake',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ShiftLeft: 'gearToggle',
  ShiftRight: 'gearToggle',
  KeyC: 'gearToggle',
  KeyD: 'modeToggle',
  Enter: 'confirm',
  Escape: 'back',
  KeyM: 'mute',
  // Pausa (lancio, punto 5): P, oltre a Esc, che in gara vale come pausa.
  KeyP: 'pause',
};

/** Bottone gamepad standard → azioni. Un bottone può alimentare più azioni (A = gas + conferma). */
const PAD_BUTTONS: Readonly<Record<number, readonly ActionName[]>> = {
  0: ['accelerate', 'confirm'], // A
  1: ['brake'], // B
  3: ['gearToggle'], // Y
  6: ['brake'], // LT
  7: ['accelerate'], // RT
  8: ['back'], // Select
  9: ['confirm', 'pause'], // Start: conferma nei menu, pausa in gara
  12: ['accelerate'], // d-pad su
  13: ['brake'], // d-pad giù
  14: ['left'], // d-pad sinistra
  15: ['right'], // d-pad destra
};

const AXIS_THRESHOLD = 0.4;

export function emptyActions(): Actions {
  return {
    accelerate: false,
    brake: false,
    left: false,
    right: false,
    gearToggle: false,
    modeToggle: false,
    confirm: false,
    back: false,
    mute: false,
    pause: false,
    daily: false,
  };
}

/** Tastiera → azioni. `justPressed` contiene i codici premuti in questo tick. Pura. */
export function mapKeys(down: ReadonlySet<string>, justPressed: ReadonlySet<string>): Actions {
  const a = emptyActions();
  for (const code of down) {
    const name = KEYS[code];
    if (name && HELD.includes(name)) a[name] = true;
  }
  for (const code of justPressed) {
    const name = KEYS[code];
    // Anche un tasto tenuto conta nel tick in cui è stato premuto, se è già
    // stato rilasciato prima del tick: un colpetto di freccia fra due tick
    // muove il cursore del menu di pausa invece di perdersi.
    if (name) a[name] = true;
  }
  return a;
}

export interface PadLike {
  buttons: readonly { pressed: boolean }[];
  axes: readonly number[];
}

/** Gamepad → azioni. `prevButtons` è lo stato del tick precedente, per le azioni momentanee. Pura. */
export function mapGamepad(
  pad: PadLike,
  prevButtons: readonly boolean[],
): { actions: Actions; buttons: boolean[] } {
  const a = emptyActions();
  const buttons = pad.buttons.map((b) => b.pressed);
  for (let i = 0; i < buttons.length; i++) {
    if (!buttons[i]) continue;
    const names = PAD_BUTTONS[i];
    if (!names) continue;
    const wasDown = prevButtons[i] === true;
    for (const name of names) {
      if (HELD.includes(name)) a[name] = true;
      else if (!wasDown) a[name] = true;
    }
  }
  const x = pad.axes[0] ?? 0;
  if (x < -AXIS_THRESHOLD) a.left = true;
  if (x > AXIS_THRESHOLD) a.right = true;
  return { actions: a, buttons };
}

export function mergeActions(into: Actions, from: Actions): Actions {
  for (const k of Object.keys(into) as ActionName[]) into[k] = (into[k] ?? false) || (from[k] ?? false);
  return into;
}

export interface InputSource {
  /** Da chiamare una volta per tick di simulazione. */
  poll(): Actions;
}

/** Vero se il gamepad chiede qualcosa in questo tick (per `core/device`). Pura. */
export function padActive(actions: Actions): boolean {
  return Object.values(actions).some((v) => v === true);
}

/**
 * Collega tastiera e gamepad al DOM e produce le azioni una volta per tick.
 * `onPad` si chiama nei tick in cui il gamepad chiede qualcosa: così chi
 * scrive i comandi a schermo sa che si gioca col gamepad.
 */
export function createInput(target: EventTarget = window, onPad?: () => void): InputSource {
  const down = new Set<string>();
  const justPressed = new Set<string>();
  let prevButtons: boolean[] = [];

  target.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    if (!down.has(e.code)) justPressed.add(e.code);
    down.add(e.code);
    if (KEYS[e.code]) e.preventDefault();
  });
  target.addEventListener('keyup', (ev) => {
    down.delete((ev as KeyboardEvent).code);
  });
  target.addEventListener('blur', () => {
    down.clear();
    justPressed.clear();
  });

  const firstPad = (): PadLike | null => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    try {
      for (const p of navigator.getGamepads()) if (p) return p;
    } catch {
      return null;
    }
    return null;
  };

  return {
    poll() {
      const actions = mapKeys(down, justPressed);
      justPressed.clear();
      const pad = firstPad();
      if (pad) {
        const r = mapGamepad(pad, prevButtons);
        prevButtons = r.buttons;
        if (onPad !== undefined && padActive(r.actions)) onPad();
        mergeActions(actions, r.actions);
      } else {
        prevButtons = [];
      }
      return actions;
    },
  };
}
