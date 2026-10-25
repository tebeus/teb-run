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
import { enterEndOfGame, retryTarget } from '../endOfGame';
import {
  bestLine,
  continueChosen,
  drawContinueButton,
  drawRetryMenu,
  initialRetryMenu,
  RETRY_ROW_TOP,
  stepRetryMenu,
  type RetryMenuState,
} from '../retryMenu';

export const GAME_OVER_DURATION_S = 3;

type GameOverPayload = ScreenPayloads['gameOver'];

export interface GameOverState {
  t: number;
  payload: GameOverPayload;
  qualifies: boolean;
  /** RETRY e MENU, quando il punteggio non entra in classifica. Assente vale appena aperto. */
  menu?: RetryMenuState;
}

/** Valida il payload di game over; con dati mancanti o malformati usa `fallbackStage` e punteggio/percorso vuoti. Pura. */
export function parseGameOverPayload(payload: unknown, fallbackStage: StageDef): GameOverPayload {
  const p = payload as Partial<GameOverPayload> | undefined;
  return {
    score: typeof p?.score === 'number' ? p.score : 0,
    stage: p?.stage ?? fallbackStage,
    route: Array.isArray(p?.route) ? p.route : [],
    ...(typeof p?.time === 'number' ? { time: p.time } : {}),
    ...(typeof p?.song === 'number' ? { song: p.song } : {}),
  };
}

/**
 * Fine partita, comune a game over e finali. Se il punteggio entra in
 * classifica: CONTINUE (ENTER, o tocco o clic sul pulsante) o il tempo
 * scaduto portano alle iniziali; con `hold` (dopo SHARE) il tempo non scade.
 * Altrimenti RETRY e MENU, senza tempo: RETRY riparte subito con lo stesso
 * brano (auto e modalità sono quelle salvate, o quelle della sfida del
 * giorno), MENU torna al titolo. `retryTo` dice dove porta RETRY (la gara, o
 * la schermata della sfida nuova se nel frattempo è passata la mezzanotte).
 * `tap` è il tocco o il clic del tick. Pura.
 */
export function stepEndOfGame<S extends { t: number; qualifies: boolean; menu?: RetryMenuState }>(
  state: S,
  dt: number,
  actions: Actions,
  hold: boolean,
  tap: { x: number; y: number } | null,
  duration: number,
  toNameEntry: () => Transition,
  retryTo: () => Transition,
): { state: S; transition: Transition | null } {
  const t = state.t + dt;
  if (state.qualifies) {
    // +1e-9: la stessa tolleranza di core/loop.ts, per non perdere la soglia
    // per un residuo di virgola mobile dopo molte somme di dt piccoli.
    const timeUp = !hold && t + 1e-9 >= duration;
    return { state: { ...state, t }, transition: continueChosen(actions, tap) || timeUp ? toNameEntry() : null };
  }
  const r = stepRetryMenu(state.menu ?? { ...initialRetryMenu(), t: state.t }, dt, actions, tap);
  const next = { ...state, t, menu: r.state };
  if (r.chosen === 'retry') return { state: next, transition: retryTo() };
  if (r.chosen === 'menu') return { state: next, transition: go('title', undefined) };
  return { state: next, transition: null };
}

/** Il game over: vedi `stepEndOfGame`. Pura. */
export function stepGameOver(
  state: GameOverState,
  dt: number,
  actions: Actions,
  hold = false,
  tap: { x: number; y: number } | null = null,
  retryTo: (song: number) => Transition = (song) => go('race', { song }),
): { state: GameOverState; transition: Transition | null } {
  const p = state.payload;
  return stepEndOfGame(state, dt, actions, hold, tap, GAME_OVER_DURATION_S, () => go('nameEntry', nameEntryPayload(p)), () => retryTo(p.song ?? 0));
}

/**
 * Il payload delle iniziali da un risultato di fine partita: il brano, il
 * tempo di gara e il finale viaggiano con lui (la classifica mondiale li
 * chiede). Pura.
 */
export function nameEntryPayload(p: {
  score: number;
  stage: StageDef;
  route: ('L' | 'R')[];
  song?: number;
  time?: number;
  ending?: number;
}): ScreenPayloads['nameEntry'] {
  return {
    score: p.score,
    stageId: p.stage.id,
    route: p.route,
    ...(p.song === undefined ? {} : { song: p.song }),
    ...(p.time === undefined ? {} : { time: p.time }),
    ...(p.ending === undefined ? {} : { ending: p.ending }),
  };
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

/**
 * Le righe di testo in alto: il titolo, il punteggio col record personale
 * (`best`, prima di questa partita; assente, niente record), la tappa
 * raggiunta. Pura.
 */
export function gameOverLines(payload: GameOverPayload, best?: number | string): { title: string; score: string; stage: string } {
  const level = Number(/^(\d)-/.exec(payload.stage.id)?.[1] ?? 0);
  // `best` è il record di prima (un numero) o la scritta già fatta (DAILY).
  const bestText = typeof best === 'string' ? best : best === undefined ? null : bestLine(payload.score, best);
  return {
    title: 'GAME OVER',
    score: bestText === null ? `SCORE ${payload.score}` : `SCORE ${payload.score}   ${bestText}`,
    stage: `STAGE ${level + 1}  ${payload.stage.name}`.toUpperCase(),
  };
}

/**
 * Composizione a tutto schermo 1280x720: in alto «GAME OVER», sotto il
 * punteggio e la tappa raggiunta, e il resto dello schermo al grafo delle
 * tappe, largo 1000 px (78% della larghezza), senza che nessuna riga di
 * testo entri nel suo riquadro. Pura.
 */
export function gameOverLayout(payload: GameOverPayload, best?: number | string, nextLine?: string | null): GameOverLayout {
  const lines = gameOverLines(payload, best);
  const title = centredTextRect(lines.title, 22, TITLE_SCALE);
  const score = centredTextRect(lines.score, 104, SCORE_SCALE);
  const stage = centredTextRect(lines.stage, 148, STAGE_SCALE);
  // In DAILY una riga in più sotto la tappa (`NEW CHALLENGE IN ...`): la mappa scende.
  const top = stage.y + stage.h + 20 + (nextLine ? NEXT_LINE_H : 0);
  // In basso la fila di RETRY e MENU (o CONTINUE): la mappa si ferma sopra.
  const map = { x: 140, y: top, w: 1000, h: RETRY_ROW_TOP - 12 - top };
  return { title, score, stage, map };
}

/** Altezza della riga `NEW CHALLENGE IN ...` sotto la tappa, in DAILY. */
export const NEXT_LINE_H = 26;
export const NEXT_LINE_Y = 182;

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
  let nextLine: string | null = null;
  const retryTo = retryTarget(deps);

  return {
    enter(payload) {
      const parsed = parseGameOverPayload(payload, deps.firstStage);
      // Il record di prima (la partita entra in classifica solo dopo le
      // iniziali), le iniziali sì o no, la festa del portale: `endOfGame.ts`.
      const end = enterEndOfGame(deps, parsed, false);
      state = { t: 0, payload: parsed, qualifies: end.qualifies, menu: initialRetryMenu() };
      // Un tocco arrivato in gara non sceglie niente qui.
      deps.signals?.takeTap();
      visited = visitedStages(parsed.route);
      nextLine = end.nextLine;
      layout = gameOverLayout(parsed, end.bestText, nextLine);
      lines = gameOverLines(parsed, end.bestText);
      labels = stageLabels(visited, layout.map, parsed.stage);
      deps.share?.offer(shareResultFrom('gameOver', parsed, deps.car?.get()));
    },
    exit() {
      deps.share?.offer(null);
    },
    update(dt, actions) {
      const r = stepGameOver(state, dt, actions, deps.share?.held() ?? false, deps.signals?.takeTap() ?? null, retryTo);
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
      if (nextLine !== null) drawTextOutlined(ctx, nextLine, LOGICAL_W / 2, NEXT_LINE_Y, 2, '#cccccc', 'center');
      if (state.qualifies) drawContinueButton(ctx);
      else drawRetryMenu(ctx, state.menu ?? initialRetryMenu(), deps.device?.() ?? 'keyboard');
      ctx.restore();
    },
  };
}
