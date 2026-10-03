import type { Actions, StageDef } from '../types';

export type ScreenName = 'title' | 'radio' | 'race' | 'ending' | 'gameOver' | 'nameEntry' | 'scores';

export interface Transition {
  to: ScreenName;
  /** Vedi `ScreenPayloads[to]`; usare `go()`. */
  payload?: unknown;
}

/** Ogni schermata del gioco implementa questa interfaccia. */
export interface Screen {
  enter(payload?: unknown): void;
  /** Ritorna una transizione per cambiare schermata, altrimenti null. */
  update(dt: number, actions: Actions): Transition | null;
  render(ctx: CanvasRenderingContext2D): void;
  /**
   * Chiamato prima di entrare nella schermata successiva: fermare anteprime audio,
   * autopilota, motore di gara.
   */
  exit?(): void;
}

/** Forma del payload che ogni schermata riceve in `enter`. Contratto tra i binari D, E, F. */
export interface ScreenPayloads {
  title: undefined;
  radio: undefined;
  race: { song: number };
  /** `time`: secondi di gara della partita, per la scheda da condividere. */
  ending: { ending: number; score: number; stage: StageDef; route: ('L' | 'R')[]; time?: number };
  gameOver: { score: number; stage: StageDef; route: ('L' | 'R')[]; time?: number };
  nameEntry: { score: number; stageId: string; route: ('L' | 'R')[] };
  scores: { highlight?: number } | undefined;
}

/** Costruisce una transizione con payload tipizzato. Preferirlo a un letterale `{ to, payload }`. */
export function go<K extends ScreenName>(to: K, payload: ScreenPayloads[K]): Transition {
  return { to, payload };
}

export interface Fsm {
  readonly name: ScreenName;
  update(dt: number, actions: Actions): void;
  render(ctx: CanvasRenderingContext2D): void;
}

export function createFsm(screens: Record<ScreenName, Screen>, initial: ScreenName): Fsm {
  let current: ScreenName = initial;
  screens[current].enter();
  return {
    get name() {
      return current;
    },
    update(dt, actions) {
      const t = screens[current].update(dt, actions);
      if (t) {
        screens[current].exit?.();
        current = t.to;
        screens[current].enter(t.payload);
      }
    },
    render(ctx) {
      screens[current].render(ctx);
    },
  };
}
