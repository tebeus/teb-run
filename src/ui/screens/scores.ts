import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { STAGES } from '../../game/stages';
import type { ScoreEntry } from '../../persist/scores';
import type { Actions } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type ScreenPayloads, type Transition } from '../fsm';
import { stageNumber } from '../shareCard';
import { drawText } from '../text';
import { drawRetryMenu, initialRetryMenu, stepRetryMenu, type RetryMenuState } from '../retryMenu';

export const SCORES_DURATION_S = 8;

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
}

/** Valida il payload opzionale: un `highlight` numerico e un `retry` con il brano, o nessuno dei due. Pura. */
export function parseScoresPayload(payload: unknown): ScreenPayloads['scores'] {
  const p = payload as { highlight?: unknown; retry?: { song?: unknown } } | undefined;
  const highlight = p && typeof p.highlight === 'number' && Number.isFinite(p.highlight) ? { highlight: p.highlight } : {};
  const song = p?.retry?.song;
  const retry = typeof song === 'number' && Number.isInteger(song) && song >= 0 ? { retry: { song } } : {};
  const out = { ...highlight, ...retry };
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Nel ciclo attrattivo ENTER, un clic del mouse o 8 secondi portano al
 * titolo, indipendentemente da quali altri tasti siano tenuti giù. Dopo le
 * iniziali, invece, RETRY e MENU senza tempo (`tap`: il tocco o il clic del
 * tick). Pura.
 */
export function stepScores(
  state: ScoresState,
  dt: number,
  actions: Actions,
  tap: { x: number; y: number } | null = null,
): { state: ScoresState; transition: Transition | null } {
  const t = state.t + dt;
  if (state.retry !== undefined) {
    const r = stepRetryMenu(state.retry.menu, dt, actions, tap);
    const next: ScoresState = { t, highlight: state.highlight, retry: { song: state.retry.song, menu: r.state } };
    if (r.chosen === 'retry') return { state: next, transition: go('race', { song: state.retry.song }) };
    if (r.chosen === 'menu') return { state: next, transition: go('title', undefined) };
    return { state: next, transition: null };
  }
  const next: ScoresState = { t, highlight: state.highlight };
  // +1e-9: la stessa tolleranza di core/loop.ts, per non perdere la soglia
  // per un residuo di virgola mobile dopo molte somme di dt piccoli.
  if (actions.confirm || actions.click || t + 1e-9 >= SCORES_DURATION_S) {
    return { state: next, transition: go('title', undefined) };
  }
  return { state: next, transition: null };
}

export function createScoresScreen(deps: ScreenDeps): Screen {
  let state: ScoresState = { t: 0 };
  // Letta una volta in enter(), non a ogni fotogramma in render(): la
  // classifica non cambia sotto i piedi di questa schermata mentre è a
  // schermo, quindi non serve un getItem+parse a 60 Hz.
  let entries: ScoreEntry[] = [];

  return {
    enter(payload) {
      const parsed = parseScoresPayload(payload);
      state = {
        t: 0,
        highlight: parsed?.highlight,
        ...(parsed?.retry === undefined ? {} : { retry: { song: parsed.retry.song, menu: initialRetryMenu() } }),
      };
      entries = deps.scores.load();
      deps.signals?.takeTap();
    },
    update(dt, actions) {
      const r = stepScores(state, dt, actions, state.retry === undefined ? null : (deps.signals?.takeTap() ?? null));
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
      drawText(ctx, 'TOP 10', LOGICAL_W / 2, 60, 4, '#ffffff', 'center');
      // Una classifica per modalità: si dice quale.
      if (deps.mode !== undefined) drawText(ctx, deps.mode.get().toUpperCase(), LOGICAL_W / 2, 100, 2, '#cccccc', 'center');
      entries.forEach((entry, i) => {
        const y = 140 + i * 40;
        const on = i === state.highlight;
        const color = on ? '#66ff66' : '#ffee55';
        const col = SCORE_COLUMNS;
        drawText(ctx, on ? '>' : ' ', col.marker, y, 2, color, 'left');
        drawText(ctx, `${i + 1}`, col.rank, y, 2, '#cccccc', 'left');
        drawText(ctx, entry.name, col.name, y, 2, color, 'left');
        drawText(ctx, entry.score.toString().padStart(6, '0'), col.score, y, 2, '#ffffff', 'left');
        drawText(ctx, stageLabel(entry.stageId), col.stage, y, 2, '#cccccc', 'left');
        drawText(ctx, entry.route, col.route, y, 2, '#888888', 'left');
      });
      if (state.retry !== undefined) drawRetryMenu(ctx, state.retry.menu, deps.device?.() ?? 'keyboard');
    },
  };
}
