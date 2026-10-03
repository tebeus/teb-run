import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { STAGES } from '../../game/stages';
import {
  BIG_VISITED_R,
  blinkOn,
  drawMapBackdrop,
  drawRouteMapLarge,
  nodeCentreOf,
  visitedStages,
  type MapRect,
} from '../../render/routeMap';
import type { Actions, StageDef } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type ScreenPayloads, type Transition } from '../fsm';
import { shareResultFrom } from '../share';
import { drawTextOutlined, measureText } from '../text';

export const GAME_OVER_DURATION_S = 3;

type GameOverPayload = ScreenPayloads['gameOver'];

export interface GameOverState {
  t: number;
  payload: GameOverPayload;
  qualifies: boolean;
}

/** Valida il payload di game over; con dati mancanti o malformati usa `fallbackStage` e punteggio/percorso vuoti. Pura. */
export function parseGameOverPayload(payload: unknown, fallbackStage: StageDef): GameOverPayload {
  const p = payload as Partial<GameOverPayload> | undefined;
  return {
    score: typeof p?.score === 'number' ? p.score : 0,
    stage: p?.stage ?? fallbackStage,
    route: Array.isArray(p?.route) ? p.route : [],
    ...(typeof p?.time === 'number' ? { time: p.time } : {}),
  };
}

/**
 * ENTER o il tempo scaduto porta a nameEntry se il punteggio entra in
 * classifica, altrimenti a scores. Con `hold` (dopo SHARE) il tempo non
 * scade: si aspetta ENTER. Pura.
 */
export function stepGameOver(
  state: GameOverState,
  dt: number,
  actions: Actions,
  hold = false,
): { state: GameOverState; transition: Transition | null } {
  const t = state.t + dt;
  // +1e-9: la stessa tolleranza di core/loop.ts, per non perdere la soglia
  // per un residuo di virgola mobile dopo molte somme di dt piccoli.
  const timeUp = !hold && t + 1e-9 >= GAME_OVER_DURATION_S;

  if (actions.confirm || timeUp) {
    if (state.qualifies) {
      return {
        state: { ...state, t },
        transition: go('nameEntry', {
          score: state.payload.score,
          stageId: state.payload.stage.id,
          route: state.payload.route,
        }),
      };
    }
    return { state: { ...state, t }, transition: go('scores', undefined) };
  }
  return { state: { ...state, t }, transition: null };
}

/** Fondo dove l'illustrazione non arriva (letterbox): il blu del mare della mappa. */
export const GAME_OVER_BG = '#0a2a52';
/** Velo sopra l'illustrazione: abbastanza da far leggere il grafo e il testo. */
export const GAME_OVER_VEIL = 'rgba(6,8,22,0.62)';
/** Scale del font bitmap (glifi 8x8). */
export const TITLE_SCALE = 8;
export const SCORE_SCALE = 4;
export const STAGE_SCALE = 3;
export const LABEL_SCALE = 2;
const GLYPH = 8;
/** Distanza fra il centro di un nodo percorso e la cima del suo nome. */
const LABEL_GAP = BIG_VISITED_R + 6;

export interface GameOverLayout {
  title: MapRect;
  score: MapRect;
  stage: MapRect;
  /** Il riquadro del grafo delle 15 tappe. */
  map: MapRect;
}

/** Riquadro di una riga di testo centrata su x = centro schermo. Pura. */
function centredTextRect(text: string, y: number, scale: number): MapRect {
  const w = measureText(text, scale);
  // +1 per lato: il contorno di `drawTextOutlined`.
  return { x: LOGICAL_W / 2 - w / 2 - 1, y: y - 1, w: w + 2, h: GLYPH * scale + 2 };
}

/** Le righe di testo in alto: il titolo, il punteggio, la tappa raggiunta. Pura. */
export function gameOverLines(payload: GameOverPayload): { title: string; score: string; stage: string } {
  const level = Number(/^(\d)-/.exec(payload.stage.id)?.[1] ?? 0);
  return {
    title: 'GAME OVER',
    score: `SCORE ${payload.score}`,
    stage: `STAGE ${level + 1}  ${payload.stage.name}`.toUpperCase(),
  };
}

/**
 * Composizione a tutto schermo 1280x720: in alto «GAME OVER», sotto il
 * punteggio e la tappa raggiunta, e il resto dello schermo al grafo delle
 * tappe, largo 1000 px (78% della larghezza), senza che nessuna riga di
 * testo entri nel suo riquadro. Pura.
 */
export function gameOverLayout(payload: GameOverPayload): GameOverLayout {
  const lines = gameOverLines(payload);
  const title = centredTextRect(lines.title, 22, TITLE_SCALE);
  const score = centredTextRect(lines.score, 104, SCORE_SCALE);
  const stage = centredTextRect(lines.stage, 148, STAGE_SCALE);
  const top = stage.y + stage.h + 20;
  const map = { x: 140, y: top, w: 1000, h: LOGICAL_H - 16 - top };
  return { title, score, stage, map };
}

/** Nome di una tappa per id, maiuscolo; stringa vuota se l'id non è del grafo. Pura. */
function stageName(id: string, fallback: StageDef): string {
  const name = id === fallback.id ? fallback.name : (STAGES.get(id)?.name ?? '');
  return name.toUpperCase();
}

/**
 * I nomi delle tappe percorse, ognuno centrato sotto il suo nodo nel
 * riquadro della mappa. Un nome per livello, quindi due nomi non stanno
 * mai sulla stessa riga. Pura.
 */
export function stageLabels(
  visited: readonly string[],
  map: MapRect,
  current: StageDef,
): { text: string; x: number; y: number; rect: MapRect }[] {
  const out: { text: string; x: number; y: number; rect: MapRect }[] = [];
  for (const id of visited) {
    const c = nodeCentreOf(id, map);
    const text = stageName(id, current);
    if (c === null || text.length === 0) continue;
    const y = c.cy + LABEL_GAP;
    const w = measureText(text, LABEL_SCALE);
    out.push({ text, x: c.cx, y, rect: { x: c.cx - w / 2 - 1, y: y - 1, w: w + 2, h: GLYPH * LABEL_SCALE + 2 } });
  }
  return out;
}

export function createGameOverScreen(deps: ScreenDeps): Screen {
  let state: GameOverState = { t: 0, payload: { score: 0, stage: deps.firstStage, route: [] }, qualifies: false };
  /** Calcolati una volta in `enter`: il percorso non cambia dentro la schermata. */
  let visited: string[] = visitedStages(state.payload.route);
  let layout = gameOverLayout(state.payload);
  let lines = gameOverLines(state.payload);
  let labels = stageLabels(visited, layout.map, state.payload.stage);

  return {
    enter(payload) {
      const parsed = parseGameOverPayload(payload, deps.firstStage);
      state = { t: 0, payload: parsed, qualifies: deps.scores.qualifies(parsed.score) };
      visited = visitedStages(parsed.route);
      layout = gameOverLayout(parsed);
      lines = gameOverLines(parsed);
      labels = stageLabels(visited, layout.map, parsed.stage);
      deps.share?.offer(shareResultFrom('gameOver', parsed, deps.car?.get()));
    },
    exit() {
      deps.share?.offer(null);
    },
    update(dt, actions) {
      const r = stepGameOver(state, dt, actions, deps.share?.held() ?? false);
      state = r.state;
      return r.transition;
    },
    render(ctx) {
      ctx.save();
      // L'illustrazione della mappa a tutto schermo, intera e velata.
      drawMapBackdrop(ctx, deps.assets, { x: 0, y: 0, w: LOGICAL_W, h: LOGICAL_H }, GAME_OVER_BG, GAME_OVER_VEIL);

      ctx.lineCap = 'round';
      drawRouteMapLarge(ctx, layout.map, visited, state.payload.stage.id, blinkOn(state.t));
      for (const label of labels) {
        drawTextOutlined(ctx, label.text, label.x, label.y, LABEL_SCALE, '#ffffff', 'center');
      }

      drawTextOutlined(ctx, lines.title, LOGICAL_W / 2, layout.title.y + 1, TITLE_SCALE, '#ff3333', 'center');
      drawTextOutlined(ctx, lines.score, LOGICAL_W / 2, layout.score.y + 1, SCORE_SCALE, '#ffee55', 'center');
      drawTextOutlined(ctx, lines.stage, LOGICAL_W / 2, layout.stage.y + 1, STAGE_SCALE, '#ffffff', 'center');
      ctx.restore();
    },
  };
}
