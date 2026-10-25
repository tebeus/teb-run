import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { DEFAULT_CAR, endingSpriteFor } from '../../game/car';
import { endingDef, endingSprite } from '../../game/endings';
import { drawRouteMapPanel, visitedStages } from '../../render/routeMap';
import type { Actions, StageDef } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type ScreenPayloads, type Transition } from '../fsm';
import { shareResultFrom } from '../share';
import { drawText, drawTextOutlined } from '../text';
import { GAMEPLAY } from '../../core/gameplayEvents';
import { SDK_BUILD } from '../../core/target';
import { drawContinueButton, drawRetryMenu, initialRetryMenu, RETRY_ROW_TOP, type RetryMenuState } from '../retryMenu';
import { enterEndOfGame, retryTarget } from '../endOfGame';
import { gameOverLines, nameEntryPayload, stepEndOfGame } from './gameOver';

export const ENDING_DURATION_S = 8;
/**
 * Intestazione fissa di ogni finale, sopra il testo che scorre. Il collaudo
 * dell'utente ha letto «ROADSIDE STEAM» (il motore che fuma) come un guasto:
 * senza una parola che dica «sei arrivato», un finale comico sembra una
 * sconfitta. Glifi da 8 px: GOAL! a scala 6 occupa 36..84, CONGRATULATIONS a
 * scala 3 occupa 96..120.
 */
export const ENDING_GOAL_Y = 36;
export const ENDING_CONGRATS_Y = 96;
/** Quota minima del titolo che scorre: la sua banda (-30) parte sotto l'intestazione. */
export const ENDING_SCROLL_MIN_Y = 150;

type EndingPayload = ScreenPayloads['ending'];

export interface EndingState {
  t: number;
  payload: EndingPayload;
  qualifies: boolean;
  /** RETRY e MENU, quando il punteggio non entra in classifica. Assente vale appena aperto. */
  menu?: RetryMenuState;
}

/** Valida il payload di ending; con dati mancanti o malformati usa `fallbackStage` e punteggio/percorso vuoti. Pura. */
export function parseEndingPayload(payload: unknown, fallbackStage: StageDef): EndingPayload {
  const p = payload as Partial<EndingPayload> | undefined;
  return {
    score: typeof p?.score === 'number' ? p.score : 0,
    ending: typeof p?.ending === 'number' ? p.ending : 0,
    stage: p?.stage ?? fallbackStage,
    route: Array.isArray(p?.route) ? p.route : [],
    ...(typeof p?.time === 'number' ? { time: p.time } : {}),
    ...(typeof p?.song === 'number' ? { song: p.song } : {}),
  };
}

/** Il finale: come il game over (`stepEndOfGame`), con il suo tempo. Pura. */
export function stepEnding(
  state: EndingState,
  dt: number,
  actions: Actions,
  hold = false,
  tap: { x: number; y: number } | null = null,
  retryTo: (song: number) => Transition = (song) => go('race', { song }),
): { state: EndingState; transition: Transition | null } {
  const p = state.payload;
  return stepEndOfGame(state, dt, actions, hold, tap, ENDING_DURATION_S, () => go('nameEntry', nameEntryPayload(p)), () => retryTo(p.song ?? 0));
}

/**
 * Misura a cui disegnare un'immagine `iw`x`ih` perché copra un riquadro
 * `bw`x`bh` senza deformarsi: la scala è il massimo dei due rapporti, così
 * nessun lato resta corto e l'eccesso esce simmetricamente dal riquadro.
 * Un'immagine senza misura torna il riquadro, che è il ripiego innocuo.
 * Pura.
 */
export function coverRect(
  iw: number,
  ih: number,
  bw: number,
  bh: number,
): { w: number; h: number } {
  if (!(iw > 0) || !(ih > 0)) return { w: bw, h: bh };
  const k = Math.max(bw / iw, bh / ih);
  return { w: iw * k, h: ih * k };
}

/**
 * Scarto relativo di proporzioni entro cui un'immagine conta come 16:9: i
 * finali della consegna v2 sono 1280x720 esatti, ma un PNG rifatto con un
 * pixel in meno non deve ricadere nel «cover» e perdere due colonne.
 */
export const WIDE_ASPECT_TOLERANCE = 0.02;

/**
 * Rettangolo in cui disegnare l'illustrazione `iw`x`ih` nel frame
 * `bw`x`bh`. Se ha già le proporzioni del frame (i finali 16:9 della
 * consegna v2) lo riempie intero, senza tagli; altrimenti (i finali 8:3
 * dell'auto classica) resta il «cover» di `coverRect`, centrato e tagliato
 * ai lati. Pura.
 */
export function endingImageRect(
  iw: number,
  ih: number,
  bw: number,
  bh: number,
): { x: number; y: number; w: number; h: number } {
  if (iw > 0 && ih > 0 && Math.abs(iw / ih / (bw / bh) - 1) <= WIDE_ASPECT_TOLERANCE) {
    return { x: 0, y: 0, w: bw, h: bh };
  }
  const { w, h } = coverRect(iw, ih, bw, bh);
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

export function createEndingScreen(deps: ScreenDeps): Screen {
  let state: EndingState = {
    t: 0,
    payload: { score: 0, ending: 0, stage: deps.firstStage, route: [] },
    qualifies: false,
  };
  /** Calcolato una volta in `enter`: il percorso non cambia dentro la schermata. */
  let visited: string[] = visitedStages(state.payload.route);
  /** Sopra RETRY: la tappa raggiunta e il record personale (di prima di questa partita). */
  let stageText = '';
  let bestText = '';
  /** In DAILY, sopra la tappa: `NEW CHALLENGE IN 5H 12M`. */
  let nextLine: string | null = null;
  const retryTo = retryTarget(deps);

  return {
    enter(payload) {
      const parsed = parseEndingPayload(payload, deps.firstStage);
      // La festa del portale: un finale, record o no (una volta sola), quindi
      // `enterEndOfGame` non ne fa un'altra.
      const end = enterEndOfGame(deps, parsed, true);
      state = { t: 0, payload: parsed, qualifies: end.qualifies, menu: initialRetryMenu() };
      // Un tocco arrivato in gara non sceglie niente qui.
      deps.signals?.takeTap();
      visited = visitedStages(parsed.route);
      stageText = gameOverLines(parsed).stage;
      bestText = end.bestText;
      nextLine = end.nextLine;
      if (SDK_BUILD) GAMEPLAY.celebrate();
      // Spec §10: "finale = fanfara 8 note". Nessun altro la suona.
      deps.audio.sfx('fanfare');
      deps.share?.offer(shareResultFrom('ending', parsed, deps.car?.get()));
    },
    exit() {
      deps.share?.offer(null);
    },
    update(dt, actions) {
      const r = stepEnding(state, dt, actions, deps.share?.held() ?? false, deps.signals?.takeTap() ?? null, retryTo);
      state = r.state;
      return r.transition;
    },
    render(ctx) {
      // Un finale proprio dell'auto scelta (la classica ha i suoi), se c'è,
      // altrimenti quello della nuova.
      const key = endingSpriteFor(deps.car?.get() ?? DEFAULT_CAR, endingSprite(state.payload.ending), (n) =>
        deps.assets.has(n),
      );
      if (deps.assets.has(key)) {
        const asset = deps.assets.get(key);
        // Nessun numero di risoluzione grezzo: se l'immagine è più piccola
        // del frame, si riempie prima lo sfondo così la schermata precedente
        // non resta visibile ai margini.
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
        // L'illustrazione riempie il frame conservando le proporzioni
        // («cover»): disegnata alla misura nativa, un'immagine 1100x480
        // lasciava due bande nere, a destra e sopra, larghe un settimo e
        // alte un terzo dello schermo. Un finale 16:9 riempie il frame intero.
        const r = endingImageRect(asset.w, asset.h, LOGICAL_W, LOGICAL_H);
        ctx.drawImage(asset.image, r.x, r.y, r.w, r.h);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
        grad.addColorStop(0, '#2a1a4a');
        grad.addColorStop(1, '#ff9955');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      }

      const scroll = Math.max(ENDING_SCROLL_MIN_Y, LOGICAL_H - state.t * 60);
      const def = endingDef(state.payload.ending);

      // Prima del testo che scorre: si è arrivati, qualunque sia il finale.
      drawTextOutlined(ctx, 'GOAL!', LOGICAL_W / 2, ENDING_GOAL_Y, 6, '#ffee55', 'center');
      drawTextOutlined(ctx, 'CONGRATULATIONS', LOGICAL_W / 2, ENDING_CONGRATS_Y, 3, '#ffffff', 'center');

      // Banda scura translucida dietro il testo che scorre: senza, il bianco
      // pieno perde leggibilità sul cielo chiaro del finale 4 e sul tramonto
      // arancione del finale 5. Alta quanto il blocco di testo (titolo +
      // righe + punteggio), non l'intero frame, così l'illustrazione resta
      // visibile sopra e sotto.
      // Dalla cima della banda (30 sopra il titolo) al fondo della riga del
      // punteggio (glifi da 8 px a scala 3) più 10 di margine: prima la
      // banda finiva 10 px sopra il punteggio, che restava scoperto
      // sull'illustrazione (visto sui finali 16:9 della consegna v2).
      const textBlockH = 30 + 50 + def.lines.length * 26 + 14 + 24 + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, scroll - 30, LOGICAL_W, textBlockH);

      drawText(ctx, def.title, LOGICAL_W / 2, scroll, 4, '#ffffff', 'center');
      def.lines.forEach((line, i) => {
        drawText(ctx, line, LOGICAL_W / 2, scroll + 50 + i * 26, 2, '#ffffff', 'center');
      });
      drawText(
        ctx,
        `SCORE ${state.payload.score}`,
        LOGICAL_W / 2,
        scroll + 50 + def.lines.length * 26 + 14,
        3,
        '#ffee55',
        'center',
      );

      // Mappa del percorso sopra l'illustrazione, in basso a destra (spec §11).
      drawRouteMapPanel(
        ctx,
        deps.assets,
        LOGICAL_W - 260,
        LOGICAL_H - 175,
        240,
        150,
        visited,
        state.payload.stage.id,
      );

      // Cornice arcade sopra tutto: il centro del PNG è trasparente,
      // quindi la scena resta visibile (spec §11).
      const border = deps.assets.get('ending_border');
      if (border.w > 0 && border.h > 0) {
        ctx.drawImage(border.image, 0, 0, LOGICAL_W, LOGICAL_H);
      }
      // Sopra la cornice: la tappa e il record, poi RETRY e MENU, o CONTINUE prima delle iniziali.
      if (nextLine !== null) drawTextOutlined(ctx, nextLine, LOGICAL_W / 2, RETRY_ROW_TOP - 84, 2, '#cccccc', 'center');
      drawTextOutlined(ctx, stageText, LOGICAL_W / 2, RETRY_ROW_TOP - 60, 2, '#ffffff', 'center');
      drawTextOutlined(ctx, bestText, LOGICAL_W / 2, RETRY_ROW_TOP - 36, 3, '#ffee55', 'center');
      if (state.qualifies) drawContinueButton(ctx);
      else drawRetryMenu(ctx, state.menu ?? initialRetryMenu(), deps.device?.() ?? 'keyboard');
    },
  };
}
