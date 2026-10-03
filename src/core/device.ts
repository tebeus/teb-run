// Con che cosa sta giocando la persona adesso (lancio, punti 7 e 14):
// tastiera (e mouse), gamepad o tocco. Serve a scrivere i comandi giusti
// sulla radio e nel suggerimento di inizio gara, e ad accendere i
// controlli a schermo solo su chi tocca. Su un computer senza touch il
// dispositivo resta la tastiera, sempre.

export type InputDevice = 'keyboard' | 'pad' | 'touch';

/** Quello che serve sapere del browser per indovinare il dispositivo iniziale. */
export interface DeviceProbe {
  /** `navigator.maxTouchPoints`. */
  maxTouchPoints?: number;
  /** `matchMedia('(pointer: coarse)').matches`: il puntatore principale è un dito. */
  coarsePointer?: boolean;
}

/**
 * Il dispositivo con cui si parte: il tocco solo se lo schermo è touch **e**
 * il puntatore principale è un dito (telefono, tablet). Un portatile con lo
 * schermo touch parte dalla tastiera e passa al tocco al primo dito. Pura.
 */
export function initialDevice(probe: DeviceProbe): InputDevice {
  return (probe.maxTouchPoints ?? 0) > 0 && probe.coarsePointer === true ? 'touch' : 'keyboard';
}

/**
 * Il dispositivo dopo un evento: un tasto porta alla tastiera, un dito al
 * tocco, un clic del mouse alla tastiera, un gamepad al gamepad. Pura.
 */
export function deviceAfter(current: InputDevice, event: { type: string; pointerType?: string }): InputDevice {
  switch (event.type) {
    case 'keydown':
      return 'keyboard';
    case 'gamepadconnected':
      return 'pad';
    case 'pointerdown':
      if (event.pointerType === 'touch' || event.pointerType === 'pen') return 'touch';
      if (event.pointerType === 'mouse') return 'keyboard';
      return current;
    default:
      return current;
  }
}

export interface DeviceTracker {
  /** Il dispositivo in uso adesso. */
  current(): InputDevice;
  /** Da chiamare quando il gamepad ha premuto qualcosa (lo sa solo `createInput`). */
  notePad(): void;
}

/** Legge il dispositivo iniziale dal browser e lo aggiorna a ogni tasto, dito o gamepad. */
export function createDeviceTracker(win: Window): DeviceTracker {
  let coarse = false;
  try {
    coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  } catch {
    coarse = false;
  }
  let device = initialDevice({ maxTouchPoints: win.navigator?.maxTouchPoints ?? 0, coarsePointer: coarse });
  const on = (ev: Event): void => {
    device = deviceAfter(device, ev as Event & { pointerType?: string });
  };
  // In cattura: il dispositivo cambia prima che qualunque altro gestore
  // decida cosa disegnare o cosa fare del tocco.
  win.addEventListener('keydown', on, true);
  win.addEventListener('pointerdown', on, true);
  win.addEventListener('gamepadconnected', on);
  return {
    current: () => device,
    notePad() {
      device = 'pad';
    },
  };
}
