import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { RADIO_TIMER_BUILD } from '../../core/target';
import { drawMapBackdrop } from '../../render/routeMap';
import { dailyChallenge, dailyKey, type DailyChallenge } from '../../shared/daily';
import type { Actions } from '../../types';
import type { ScreenDeps } from '../deps';
import { challengeLabel, nextChallengeLine } from '../dailySession';
import { go, type Screen, type Transition } from '../fsm';
import { inside, type Rect } from '../rect';
import { DAILY_START_RECT } from '../titleLayout';
import { drawMenuButton } from '../retryMenu';
import { drawTextOutlined } from '../text';
import { RADIO_BACK_RECT } from '../radioTouch';
import { drawRadioTimer, RADIO_MODE_COLORS, radioTimerExpired } from './radio';
import { GAME_OVER_BG, GAME_OVER_VEIL } from './gameOver';

// La schermata della sfida del giorno (spec classifica e sfida, §3.3): fra il
// titolo e la radio, dice cosa si gioca oggi (auto e modalità, uguali per
// tutti, e il traffico del giorno), il campione di ieri se c'è la rete, il
// proprio record di oggi e quanto manca alla sfida nuova. Apre la sessione
// DAILY (`deps.daily`): da qui fino al titolo auto e modalità sono quelle
// della sfida. ENTER, un clic o un tocco (fuori da BACK) vanno alla radio,
// Esc o BACK al titolo. Nella build crazygames ha il timer della radio:
// nessun clic in più verso la gara.

export { DAILY_START_RECT };
/** BACK, dove la radio ha il suo. */
export const DAILY_BACK_RECT: Rect = RADIO_BACK_RECT;

export interface DailyScreenState {
  t: number;
  /** Tempo del timer (solo crazygames), fermo come quello della radio. */
  timerT: number;
}

/**
 * Riduttore: ENTER, o un tocco o un clic fuori da BACK, vanno alla radio;
 * Esc, o BACK, al titolo; nella build crazygames il timer, allo zero, alla
 * radio. `tap` è il tocco o il clic del tick. Pura.
 */
export function stepDaily(
  state: DailyScreenState,
  dt: number,
  actions: Actions,
  tap: { x: number; y: number } | null,
  timer: boolean,
): { state: DailyScreenState; transition: Transition | null } {
  const next = { t: state.t + dt, timerT: timer ? state.timerT + dt : state.timerT };
  if (tap !== null) return { state: next, transition: inside(DAILY_BACK_RECT, tap.x, tap.y) ? go('title', undefined) : go('radio', undefined) };
  if (actions.back) return { state: next, transition: go('title', undefined) };
  if (actions.confirm || (timer && radioTimerExpired(next.timerT))) return { state: next, transition: go('radio', undefined) };
  return { state: next, transition: null };
}

/** Le righe della schermata, dall'alto. Pura. */
export function dailyLines(
  challenge: DailyChallenge,
  now: Date,
  extra: { champion?: { initials: string; score: number } | null; best?: number | null },
): string[] {
  const lines = [`TODAY: ${challengeLabel(challenge)}`];
  lines.push(challenge.mode === 'hard' ? 'HARD WEEKEND' : '');
  lines.push('SAME TRAFFIC FOR EVERYONE TODAY');
  lines.push(extra.champion ? `YESTERDAY'S CHAMPION: ${extra.champion.initials} ${extra.champion.score}` : '');
  lines.push(extra.best != null ? `YOUR BEST TODAY: ${extra.best}` : '');
  lines.push(nextChallengeLine(now));
  return lines;
}

export function createDailyScreen(deps: ScreenDeps): Screen {
  let state: DailyScreenState = { t: 0, timerT: 0 };
  let challenge: DailyChallenge = dailyChallenge(dailyKey(new Date(deps.now?.() ?? Date.now())));
  const now = (): Date => new Date(deps.now?.() ?? Date.now());

  return {
    enter() {
      state = { t: 0, timerT: 0 };
      challenge = dailyChallenge(dailyKey(now()));
      deps.daily?.start(challenge);
      // Un tocco arrivato sul titolo non sceglie niente qui.
      deps.signals?.takeTap();
      // Il campione di ieri: se `/daily` non è ancora arrivato, lo chiede.
      deps.board?.daily();
    },
    update(dt, actions) {
      const timer = RADIO_TIMER_BUILD && deps.tiltAsking?.() !== true;
      const r = stepDaily(state, dt, actions, deps.signals?.takeTap() ?? null, timer);
      state = r.state;
      return r.transition;
    },
    render(ctx) {
      drawMapBackdrop(ctx, deps.assets, { x: 0, y: 0, w: LOGICAL_W, h: LOGICAL_H }, GAME_OVER_BG, GAME_OVER_VEIL);
      const info = deps.board?.daily() ?? null;
      const yesterday = info?.yesterday.champion ?? null;
      const lines = dailyLines(challenge, now(), { champion: yesterday, best: deps.dailyStore?.best(challenge.key)?.score ?? null });
      drawTextOutlined(ctx, 'DAILY CHALLENGE', LOGICAL_W / 2, 64, 6, '#ffee55', 'center');
      drawTextOutlined(ctx, challenge.key, LOGICAL_W / 2, 128, 3, '#ffffff', 'center');
      drawTextOutlined(ctx, lines[0], LOGICAL_W / 2, 196, 5, RADIO_MODE_COLORS[challenge.mode], 'center');
      if (lines[1] !== '') drawTextOutlined(ctx, lines[1], LOGICAL_W / 2, 250, 2, RADIO_MODE_COLORS.hard, 'center');
      drawTextOutlined(ctx, lines[2], LOGICAL_W / 2, 290, 2, '#cccccc', 'center');
      if (lines[3] !== '') drawTextOutlined(ctx, lines[3], LOGICAL_W / 2, 360, 3, '#ffffff', 'center');
      if (lines[4] !== '') drawTextOutlined(ctx, lines[4], LOGICAL_W / 2, 412, 3, '#66ff66', 'center');
      drawTextOutlined(ctx, lines[5], LOGICAL_W / 2, 480, 2, '#cccccc', 'center');
      const device = deps.device?.() ?? 'keyboard';
      if (device === 'keyboard') drawTextOutlined(ctx, 'ENTER OR CLICK TO START, ESC TO GO BACK', LOGICAL_W / 2, 560, 2, '#ffffff', 'center');
      if (device === 'pad') drawTextOutlined(ctx, 'A TO START, SELECT TO GO BACK', LOGICAL_W / 2, 560, 2, '#ffffff', 'center');
      drawMenuButton(ctx, DAILY_START_RECT, 'START', 4, true);
      drawMenuButton(ctx, DAILY_BACK_RECT, 'BACK', 3, false);
      if (RADIO_TIMER_BUILD) drawRadioTimer(ctx, state.timerT, device === 'touch');
    },
  };
}
