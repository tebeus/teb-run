// Sterzo con inclinazione (lancio, punto 14): un'opzione, spenta di
// default. Il telefono in orizzontale si gira come un volante. Su iOS
// l'accesso ai sensori va chiesto con `DeviceOrientationEvent.requestPermission`,
// dentro il gesto dell'utente: per questo `toggle` si chiama solo dal
// rilascio del dito sul pulsante TILT, e `gesture` dal rilascio di un dito
// qualsiasi in gara o sulla radio.

/** Gradi di inclinazione sotto cui l'auto va dritta. */
export const TILT_DEADZONE_DEG = 8;

/**
 * Da inclinazione a sterzo: -1 sinistra, 0 dritto, 1 destra. `angle` è
 * `screen.orientation.angle` (90: il lato alto del telefono a sinistra;
 * 270 o -90: a destra). In orizzontale conta `beta`, la rotazione attorno
 * all'asse corto; in verticale `gamma`. Pura.
 */
export function tiltSteer(beta: number | null, gamma: number | null, angle: number): -1 | 0 | 1 {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  let v: number | null;
  if (a === 90) v = beta;
  else if (a === 270) v = beta === null ? null : -beta;
  else v = gamma;
  if (v === null || !Number.isFinite(v)) return 0;
  if (v > TILT_DEADZONE_DEG) return 1;
  if (v < -TILT_DEADZONE_DEG) return -1;
  return 0;
}

export interface TiltControl {
  /** Il browser dà i sensori di orientamento? Se no, il pulsante non c'è. */
  readonly available: boolean;
  /** L'opzione è accesa (e il permesso concesso)? */
  readonly on: boolean;
  /**
   * Ricordata accesa ma ancora senza permesso (iOS dopo il ricaricamento):
   * il pulsante dice già TILT ON, e il permesso si chiede al primo gesto.
   */
  readonly pending: boolean;
  /** La finestra del permesso di iOS è aperta adesso? (Il timer della radio aspetta.) */
  readonly asking?: boolean;
  /**
   * Quante volte il permesso dei sensori è stato negato o è fallito: chi
   * mostra i comandi lo dice a schermo invece di spegnersi in silenzio.
   */
  readonly refusals: number;
  /** Sterzo di adesso, 0 se spento. */
  steer(): -1 | 0 | 1;
  /** Accende o spegne. Da chiamare nel gestore di un gesto (iOS). */
  toggle(): void;
  /**
   * Un gesto qualsiasi (tocco in gara o sulla radio): se l'opzione aspetta
   * il permesso, lo chiede adesso. Altrimenti non fa niente.
   */
  gesture(): void;
}

interface OrientationCtor {
  requestPermission?: () => Promise<'granted' | 'denied' | string>;
}

/** Dove l'opzione si ricorda fra un caricamento e l'altro (`persist/tilt.ts`). */
export interface TiltMemory {
  get(): boolean;
  set(on: boolean): void;
}

/**
 * L'opzione, collegata a `deviceorientation`. Parte spenta, o accesa se
 * `memory` la ricorda accesa: senza permesso da chiedere si riaccende
 * subito; su iOS aspetta il primo gesto, e se il permesso viene negato
 * torna spenta e se lo ricorda.
 */
export function createTilt(win: Window, memory?: TiltMemory): TiltControl {
  const ctor = (win as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
  const available = ctor !== undefined;
  const requestPermission = ctor?.requestPermission;
  let on = false;
  let pending = false;
  /** Una richiesta di permesso è in volo: un secondo gesto non ne apre un'altra. */
  let asking = false;
  /** La persona vuole ancora l'opzione accesa quando arriva la risposta? */
  let wanted = false;
  let refusals = 0;
  let beta: number | null = null;
  let gamma: number | null = null;
  const onOrientation = (ev: Event): void => {
    const e = ev as DeviceOrientationEvent;
    beta = e.beta;
    gamma = e.gamma;
  };
  const angle = (): number => {
    const so = win.screen?.orientation;
    if (so !== undefined && typeof so.angle === 'number') return so.angle;
    const legacy = (win as unknown as { orientation?: number }).orientation;
    return typeof legacy === 'number' ? legacy : 0;
  };
  const remember = (value: boolean): void => {
    memory?.set(value);
  };
  const start = (): void => {
    if (on) return;
    on = true;
    win.addEventListener('deviceorientation', onOrientation);
  };
  const stop = (): void => {
    on = false;
    pending = false;
    wanted = false;
    beta = null;
    gamma = null;
    win.removeEventListener('deviceorientation', onOrientation);
  };
  const refused = (): void => {
    refusals++;
    pending = false;
    wanted = false;
    remember(false);
  };
  /** iOS: il permesso lo dà la persona; negato o in errore, l'opzione resta spenta. */
  const ask = (): void => {
    wanted = true;
    if (asking || typeof requestPermission !== 'function') return;
    asking = true;
    let answer: Promise<string>;
    try {
      answer = requestPermission.call(ctor);
    } catch {
      asking = false;
      refused();
      return;
    }
    void Promise.resolve(answer)
      .then((value) => {
        asking = false;
        if (value !== 'granted') {
          refused();
          return;
        }
        // Spenta col pulsante mentre la domanda era aperta: resta spenta.
        if (!wanted) return;
        pending = false;
        start();
        remember(true);
      })
      .catch(() => {
        asking = false;
        refused();
      });
  };

  if (available && memory?.get() === true) {
    if (typeof requestPermission === 'function') pending = true;
    else start();
  }

  return {
    available,
    get on() {
      return on;
    },
    get pending() {
      return pending;
    },
    get asking() {
      return asking;
    },
    get refusals() {
      return refusals;
    },
    steer: () => (on ? tiltSteer(beta, gamma, angle()) : 0),
    toggle() {
      if (!available) return;
      if (on || pending || wanted) {
        stop();
        remember(false);
        return;
      }
      if (typeof requestPermission === 'function') {
        ask();
        return;
      }
      start();
      remember(true);
    },
    gesture() {
      if (pending) ask();
    },
  };
}
