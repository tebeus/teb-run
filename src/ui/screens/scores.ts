import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { STAGES } from '../../game/stages';
import type { ScoreEntry } from '../../persist/scores';
import type { Actions } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type ScreenPayloads, type Transition } from '../fsm';
import { stageNumber } from '../shareCard';
import { drawText } from '../text';
import { drawMenuButton, drawRetryMenu, initialRetryMenu, stepRetryMenu, type RetryMenuState } from '../retryMenu';
import { inside, type Rect } from '../rect';
import type { InputDevice } from '../../core/device';
import { cyclePage, drawTabs, PAGE_LABELS, SCORES_PAGES, tabAt, type ScoresPage } from '../scoresPages';
import { retryTarget } from '../endOfGame';
import { challengeLabel } from '../dailySession';
import { dailyChallenge, dailyKey } from '../../shared/daily';
import type { SubmitResult } from '../../net/types';
import type { Difficulty } from '../../types';

export const SCORES_DURATION_S = 8;

/**
 * La voce ENDINGS della TOP 10 (spec telefono e finali §C): in basso a
 * destra, dopo MENU quando c'è RETRY, prima dello schermo intero.
 */
export const SCORES_ENDINGS_RECT: Rect = { x: 960, y: 612, w: 230, h: 84 };

/** Il tasto della voce ENDINGS, sopra il pulsante: C (o Shift) e Y del pad, come l'auto sulla radio. Pura. */
export function scoresEndingsKey(device: InputDevice): string | null {
  if (device === 'touch') return null;
  return device === 'pad' ? 'Y' : 'C OR CLICK';
}

/** Si va alla pagina ENDINGS? Il tasto dell'auto (C, Shift, Y), o un tocco o un clic sul pulsante. Pura. */
export function wantsEndings(actions: Actions, tap: { x: number; y: number } | null): boolean {
  return actions.gearToggle || (tap !== null && inside(SCORES_ENDINGS_RECT, tap.x, tap.y));
}

/**
 * Colonne della riga, in x logiche. Stanno in 1280 con il caso peggiore:
 * un nome di `MAX_NAME_LEN` lettere, sette cifre di punteggio, il nome di
 * tappa più lungo (14 lettere) e il percorso `L L L L`, tutti a scala 2.
 */
export const SCORE_COLUMNS = { marker: 90, rank: 120, name: 200, score: 500, stage: 650, route: 910 } as const;

/**
 * Come si chiama per il giocatore la tappa di un record: il nome in
 * maiuscolo (`SUNSET LAGOON`), non l'id `4-4`. Un id che il grafo non
 * conosce (un record di una versione vecchia) diventa `STAGE n`. Pura.
 */
export function stageLabel(stageId: string): string {
  const stage = STAGES.get(stageId);
  return stage !== undefined ? stage.name.toUpperCase() : `STAGE ${stageNumber(stageId)}`;
}

export interface ScoresState {
  t: number;
  highlight?: number;
  /** Dopo le iniziali: RETRY con questo brano, e MENU. Assente, la TOP 10 del ciclo attrattivo. */
  retry?: { song: number; menu: RetryMenuState };
  /** La pagina a schermo; assente vale LOCAL. */
  page?: ScoresPage;
  prevUp?: boolean;
  prevDown?: boolean;
}

/** Valida il payload opzionale: `highlight` numerico, `retry` con il brano, `page`, o niente. Pura. */
export function parseScoresPayload(payload: unknown): ScreenPayloads['scores'] {
  const p = payload as { highlight?: unknown; retry?: { song?: unknown }; page?: unknown } | undefined;
  const highlight = p && typeof p.highlight === 'number' && Number.isFinite(p.highlight) ? { highlight: p.highlight } : {};
  const song = p?.retry?.song;
  const retry = typeof song === 'number' && Number.isInteger(song) && song >= 0 ? { retry: { song } } : {};
  const page = SCORES_PAGES.includes(p?.page as ScoresPage) ? { page: p!.page as ScoresPage } : {};
  const out = { ...highlight, ...retry, ...page };
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Nel ciclo attrattivo ENTER, un clic, un tocco o 8 secondi portano al
 * titolo, indipendentemente da quali altri tasti siano tenuti giù. Dopo le
 * iniziali, invece, RETRY e MENU senza tempo. In tutti e due i casi su e giù,
 * o un clic o un tocco su una linguetta, cambiano pagina fra `pages` (e nel
 * ciclo attrattivo il tempo riparte). `tap` è il tocco o il clic del tick;
 * `retryTo` dice dove porta RETRY. Pura.
 */
export function stepScores(
  state: ScoresState,
  dt: number,
  actions: Actions,
  tap: { x: number; y: number } | null = null,
  pages: readonly ScoresPage[] = ['local'],
  retryTo: (song: number) => Transition = (song) => go('race', { song }),
): { state: ScoresState; transition: Transition | null } {
  const page = state.page ?? 'local';
  const up = actions.accelerate && state.prevUp === false;
  const down = actions.brake && state.prevDown === false;
  const edges = { prevUp: actions.accelerate, prevDown: actions.brake };
  const point = tap ?? actions.click ?? null;
  const tab = point === null ? null : tabAt(pages, point);
  const turned = tab ?? (up || down ? cyclePage(pages, page, up ? -1 : 1) : null);
  // Una linguetta, o su e giù: un'altra pagina (con una pagina sola non c'è niente da girare).
  if (turned !== null && pages.length > 1) {
    const next: ScoresState = { ...state, ...edges, page: turned, t: state.retry === undefined ? 0 : state.t + dt };
    if (state.retry !== undefined) next.retry = { song: state.retry.song, menu: stepRetryMenu(state.retry.menu, dt, { ...actions, confirm: false }, null).state };
    return { state: next, transition: null };
  }
  const t = state.t + dt;
  if (state.retry !== undefined) {
    const r = stepRetryMenu(state.retry.menu, dt, actions, tap);
    const next: ScoresState = { ...state, ...edges, t, retry: { song: state.retry.song, menu: r.state } };
    if (r.chosen === 'retry') return { state: next, transition: retryTo(state.retry.song) };
    if (r.chosen === 'menu') return { state: next, transition: go('title', undefined) };
    return { state: next, transition: null };
  }
  const next: ScoresState = { ...state, ...edges, t };
  // +1e-9: la stessa tolleranza di core/loop.ts, per non perdere la soglia
  // per un residuo di virgola mobile dopo molte somme di dt piccoli.
  if (actions.confirm || point !== null || t + 1e-9 >= SCORES_DURATION_S) {
    return { state: next, transition: go('title', undefined) };
  }
  return { state: next, transition: null };
}

/** La sigla di un'auto nella riga della classifica mondiale. Pura. */
export function carShort(car: string): string {
  return car.toUpperCase();
}

/** `#12 TODAY OF 40`: dove è entrata la partita appena mandata. Pura. */
export function rankLine(result: SubmitResult): string {
  return `#${result.rank} ${PAGE_LABELS[result.board]} OF ${result.total}`;
}

export function createScoresScreen(deps: ScreenDeps): Screen {
  let state: ScoresState = { t: 0 };
  // Letta una volta in enter(), non a ogni fotogramma in render(): la
  // classifica non cambia sotto i piedi di questa schermata mentre è a
  // schermo, quindi non serve un getItem+parse a 60 Hz.
  let entries: ScoreEntry[] = [];
  const retryTo = retryTarget(deps);
  const now = (): Date => new Date(deps.now?.() ?? Date.now());

  /** La modalità di una pagina: quella scelta, o quella della sfida di oggi per DAILY. */
  const modeOf = (page: ScoresPage): Difficulty =>
    page === 'daily' ? (deps.daily?.current()?.mode ?? dailyChallenge(dailyKey(now())).mode) : (deps.mode?.get() ?? 'normal');

  /** Le pagine da mostrare: LOCAL sempre, le mondiali solo con i dati già arrivati. */
  const pages = (): ScoresPage[] => {
    const board = deps.board;
    if (board === undefined) return ['local'];
    return SCORES_PAGES.filter((p) => p === 'local' || board.top(modeOf(p), p) !== null);
  };

  return {
    enter(payload) {
      const parsed = parseScoresPayload(payload);
      state = {
        t: 0,
        highlight: parsed?.highlight,
        page: parsed?.page ?? 'local',
        prevUp: true,
        prevDown: true,
        ...(parsed?.retry === undefined ? {} : { retry: { song: parsed.retry.song, menu: initialRetryMenu() } }),
      };
      entries = deps.scores.load();
      deps.signals?.takeTap();
      // Le classifiche mondiali: chieste adesso, compaiono quando arrivano.
      pages();
    },
    update(dt, actions) {
      // Il clic del mouse arriva anche come tocco (`takeTap`, ogni puntatore): una volta sola.
      const tap = deps.signals?.takeTap() ?? null;
      if (wantsEndings(actions, tap ?? actions.click ?? null)) return go('endings', undefined);
      const r = stepScores(state, dt, { ...actions, click: null }, tap, pages(), retryTo);
      state = r.state;
      return r.transition;
    },
    render(ctx) {
      // Sfondo proprio: `createApp.render` già pulisce il frame ad ogni
      // schermata (vedi ui/app.ts), ma questo dà alla schermata il suo
      // colore invece del nero neutro, e protegge anche chi chiamasse
      // `screen.render` direttamente senza passare per `createApp`.
      ctx.fillStyle = '#101028';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      const shown = pages();
      const page = shown.includes(state.page ?? 'local') ? (state.page ?? 'local') : 'local';
      const tabs = shown.length > 1;
      drawTabs(ctx, shown, page);
      // Con le linguette in alto, titolo e righe scendono.
      const top = tabs ? 24 : 0;
      const mode = modeOf(page);
      const submitted = deps.board?.submitted();
      const result = submitted?.status === 'done' && submitted.result?.board === page ? submitted.result : null;
      const col = SCORE_COLUMNS;
      if (page === 'local') {
        drawText(ctx, 'TOP 10', LOGICAL_W / 2, 60 + top, 4, '#ffffff', 'center');
        // Una classifica per modalità: si dice quale.
        if (deps.mode !== undefined) drawText(ctx, deps.mode.get().toUpperCase(), LOGICAL_W / 2, 100 + top, 2, '#cccccc', 'center');
        entries.forEach((entry, i) => {
          const y = 140 + top + i * 40;
          const on = i === state.highlight;
          const color = on ? '#66ff66' : '#ffee55';
          drawText(ctx, on ? '>' : ' ', col.marker, y, 2, color, 'left');
          drawText(ctx, `${i + 1}`, col.rank, y, 2, '#cccccc', 'left');
          drawText(ctx, entry.name, col.name, y, 2, color, 'left');
          drawText(ctx, entry.score.toString().padStart(6, '0'), col.score, y, 2, '#ffffff', 'left');
          drawText(ctx, stageLabel(entry.stageId), col.stage, y, 2, '#cccccc', 'left');
          drawText(ctx, entry.route, col.route, y, 2, '#888888', 'left');
        });
      } else {
        const rows = deps.board?.top(mode, page) ?? [];
        const daily = page === 'daily' ? (deps.daily?.current() ?? dailyChallenge(dailyKey(now()))) : null;
        drawText(ctx, `WORLD ${PAGE_LABELS[page]}`, LOGICAL_W / 2, 60 + top, 4, '#ffffff', 'center');
        const sub = daily !== null ? `${daily.key} · ${challengeLabel(daily)}` : mode.toUpperCase();
        drawText(ctx, sub, LOGICAL_W / 2, 100 + top, 2, '#cccccc', 'center');
        rows.forEach((row, i) => {
          const y = 140 + top + i * 40;
          const on = result !== null && result.rank === i + 1;
          const color = on ? '#66ff66' : '#ffee55';
          drawText(ctx, on ? '>' : ' ', col.marker, y, 2, color, 'left');
          drawText(ctx, `${i + 1}`, col.rank, y, 2, '#cccccc', 'left');
          drawText(ctx, row.initials, col.name, y, 2, color, 'left');
          drawText(ctx, row.score.toString().padStart(6, '0'), col.score, y, 2, '#ffffff', 'left');
          drawText(ctx, stageLabel(row.stageId), col.stage, y, 2, '#cccccc', 'left');
          drawText(ctx, carShort(row.car), col.route, y, 2, '#888888', 'left');
        });
      }
      if (result !== null) drawText(ctx, rankLine(result), LOGICAL_W / 2, 580, 3, '#66ff66', 'center');
      if (tabs && (deps.device?.() ?? 'keyboard') !== 'touch') drawText(ctx, 'UP DOWN: PAGE', LOGICAL_W - 20, 84, 1, '#888888', 'right');
      if (state.retry !== undefined) drawRetryMenu(ctx, state.retry.menu, deps.device?.() ?? 'keyboard');
      drawMenuButton(ctx, SCORES_ENDINGS_RECT, 'ENDINGS', 3, false);
      const key = scoresEndingsKey(deps.device?.() ?? 'keyboard');
      if (key !== null) drawText(ctx, key, SCORES_ENDINGS_RECT.x + SCORES_ENDINGS_RECT.w / 2, SCORES_ENDINGS_RECT.y - 20, 1, '#888888', 'center');
    },
  };
}
