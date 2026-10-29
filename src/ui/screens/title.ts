import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { GAME_NAME } from '../../core/config';
import { emptyActions } from '../../core/input';
import { modeLabel } from '../../game/mode';
import { FIRST_STAGE_ID } from '../../game/stages';
import type { ScoreEntry } from '../../persist/scores';
import { streakLine } from '../../persist/streak';
import { drawRouteMapPanel, visitedStages } from '../../render/routeMap';
import type { Actions, RaceEngine, RaceSnapshot } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type ScreenPayloads, type Transition } from '../fsm';
import { drawText, drawTextOutlined } from '../text';
import { engineParams } from './race';
import { titleStartLine } from '../controlsHelp';
import { inside, type Rect } from '../rect';
import { DAILY_RECT } from '../titleLayout';
import { drawMenuButton } from '../retryMenu';
import { challengeLabel } from '../dailySession';
import { dailyChallenge, dailyKey } from '../../shared/daily';

/**
 * Ciclo attrattivo (spec §11): tre fasi da `ATTRACT_PHASE_S` secondi che
 * si succedono in dissolvenza, e alla fine del ciclo la classifica.
 * **Deroga a spec §11** (era `ATTRACT_IDLE_S = 30`, una sola attesa e poi
 * la classifica): il ciclo classico degli arcade è titolo → gara → mappa →
 * classifica → titolo, e le tre fasi sono quelle prima della classifica.
 */
export const ATTRACT_PHASE_S = 12;
export const ATTRACT_PHASES = 3;
export const ATTRACT_CYCLE_S = ATTRACT_PHASE_S * ATTRACT_PHASES;
/** Durata della dissolvenza fra due fasi, in secondi. */
export const ATTRACT_FADE_S = 0.8;
/** Quanti punteggi si mostrano in alto a destra nella fase del titolo. */
export const TOP_SCORES_SHOWN = 3;

export type AttractPhase = 'title' | 'demo' | 'map';
export const ATTRACT_ORDER: readonly AttractPhase[] = ['title', 'demo', 'map'];

/**
 * Fase corrente dal tempo di inattività. Oltre il ciclo resta l'ultima:
 * a quel punto `stepTitle` ha già chiesto la classifica, ma la funzione
 * non deve leggere fuori dall'array. Pura.
 */
export function attractPhase(t: number): AttractPhase {
  if (!(t > 0)) return ATTRACT_ORDER[0];
  const i = Math.floor(t / ATTRACT_PHASE_S);
  return ATTRACT_ORDER[Math.min(i, ATTRACT_PHASES - 1)];
}

/**
 * Alfa della schermata durante la dissolvenza: 0 all'istante del cambio
 * di fase (schermo nero), 1 dopo `ATTRACT_FADE_S`. La dissolvenza passa
 * per il nero e non sovrappone due fasi, perché `renderWorld` rimette
 * `globalAlpha` a 1 più volte dentro un fotogramma (nebbia, particelle,
 * ombra dell'auto): un alfa impostato prima di chiamarlo non
 * sopravvivrebbe. Pura.
 */
export function attractFade(t: number): number {
  if (!(t > 0)) return 1;
  const within = t % ATTRACT_PHASE_S;
  if (!(ATTRACT_FADE_S > 0) || within >= ATTRACT_FADE_S) return 1;
  return within / ATTRACT_FADE_S;
}
/** Velocità di crociera dell'autopilota, frazione di maxSpeed (spec §11). */
export const ATTRACT_SPEED_PERCENT = 0.6;
/** Oltre questo scarto dal centro l'autopilota sterza; sotto, lascia stare. */
export const ATTRACT_CENTRE_DEADZONE = 0.05;
/** Sotto questa velocità l'autopilota resta in marcia bassa, che accelera più forte. */
export const ATTRACT_SHIFT_PERCENT = 0.5;

export interface TitleState {
  idleT: number;
  blinkT: number;
  /** La voce accesa per ENTER: START (come sempre) o DAILY, scelta con su e giù. */
  choice: 'start' | 'daily';
  prevUp: boolean;
  prevDown: boolean;
}

export function initialTitleState(): TitleState {
  return { idleT: 0, blinkT: 0, choice: 'start', prevUp: true, prevDown: true };
}

export { DAILY_RECT };

/**
 * Il pulsante DAILY CHALLENGE (`titleLayout.ts`) si vede in questa fase?
 * Nella fase mappa del ciclo attrattivo no (coprirebbe il triangolo delle
 * tappe): lì ogni tocco o clic vale START, come prima, e riporta il ciclo
 * alla fase del titolo, dove il pulsante c'è. Pura.
 */
export function dailyShown(phase: AttractPhase): boolean {
  return phase !== 'map';
}

/** Il titolo non riceve mai un payload utile: lo ignora, non lancia mai. Pura. */
export function parseTitlePayload(_payload: unknown): ScreenPayloads['title'] {
  return undefined;
}

function anyActionHeld(a: Actions): boolean {
  return a.accelerate || a.brake || a.left || a.right || a.gearToggle || a.confirm || a.back || a.mute;
}

/**
 * Riduttore puro del titolo: ENTER, o un clic del mouse (i clic sui link non
 * arrivano qui: `ui/mouse.ts`), porta subito alla radio; senza input per
 * ATTRACT_CYCLE_S secondi (le tre fasi del ciclo attrattivo), passa alla
 * classifica.
 */
export function stepTitle(
  state: TitleState,
  dt: number,
  actions: Actions,
  /** C'è la sfida giornaliera? Senza, il titolo è quello di sempre. */
  daily = false,
): { state: TitleState; transition: Transition | null } {
  const up = actions.accelerate;
  const down = actions.brake;
  const edges = { prevUp: up, prevDown: down };
  if (daily) {
    // Il dito sul pulsante, o il clic del mouse sopra: la sfida, subito.
    const shown = dailyShown(attractPhase(state.idleT));
    if (shown && (actions.daily || (actions.click && inside(DAILY_RECT, actions.click.x, actions.click.y)))) {
      return { state: { ...state, ...edges }, transition: go('daily', undefined) };
    }
  }
  if (actions.confirm || actions.click || actions.daily) {
    const to = daily && state.choice === 'daily' && !actions.click ? go('daily', undefined) : go('radio', undefined);
    return { state: { ...state, ...edges }, transition: to };
  }

  // Su e giù (tastiera, croce del gamepad) cambiano voce; il fronte, perché
  // sono azioni tenute. Con ENTER nello stesso tick (A = gas e conferma) vince ENTER, sopra.
  let choice = state.choice;
  if (daily && ((up && !state.prevUp) || (down && !state.prevDown))) choice = choice === 'start' ? 'daily' : 'start';

  const idleT = anyActionHeld(actions) ? 0 : state.idleT + dt;
  const blinkT = state.blinkT + dt;

  // +1e-9: la stessa tolleranza di core/loop.ts, per non perdere la soglia
  // per un residuo di virgola mobile dopo molte somme di dt piccoli.
  if (idleT + 1e-9 >= ATTRACT_CYCLE_S) {
    return { state: { ...state, idleT: 0, blinkT, choice, ...edges }, transition: go('scores', undefined) };
  }
  return { state: { ...state, idleT, blinkT, choice, ...edges }, transition: null };
}

/** Periodo del lampeggio di "PRESS ENTER", in secondi. */
export const BLINK_PERIOD_S = 1;
/**
 * Quota del periodo in cui la scritta è visibile. Con un ciclo 50/50 la
 * verifica manuale misurava "PRESS ENTER" leggibile solo il 42% del tempo:
 * troppo poco per essere letto comodamente. Acceso più a lungo dello spento.
 */
export const BLINK_ON_FRACTION = 0.75;

/** Lampeggio di "PRESS ENTER": un ciclo al secondo, acceso il 75% del tempo. */
export function titleBlinkOn(blinkT: number): boolean {
  const phase = blinkT % BLINK_PERIOD_S;
  return phase < BLINK_PERIOD_S * BLINK_ON_FRACTION;
}

/** Y di "PRESS ENTER" nelle fasi titolo e demo (spec §11). */
export const PRESS_ENTER_Y = 420;
/**
 * Y di "PRESS ENTER" nella fase mappa: sotto il triangolo dei quindici nodi
 * (revisione finale, minore parcheggiato). A `PRESS_ENTER_Y` la scritta
 * cadeva dentro il grafo del percorso, che `drawRouteMapPanel` disegna a
 * schermo intero: il nodo più basso (livello 0) sta a `cy ≈ 648` su
 * `LOGICAL_H = 720`, con la scritta a 420 in mezzo al triangolo.
 */
export const PRESS_ENTER_MAP_Y = 680;

/**
 * Comandi dell'autopilota per il fotogramma successivo (spec §11): gas fino
 * al 60% di maxSpeed, sterzo verso il centro strada, e una sola cambiata in
 * marcia alta quando la marcia bassa ha finito il suo lavoro. `gearToggle` è
 * momentanea e `stepPlayer` la applica a ogni tick in cui è vera: la
 * condizione la rende vera solo finché la marcia è ancora bassa, quindi la
 * cambiata avviene una volta e non oscilla. Pura.
 */
export function attractActions(snapshot: RaceSnapshot): Actions {
  const { speedPercent, gear } = engineParams(snapshot);
  const x = snapshot.player.x;
  return {
    ...emptyActions(),
    accelerate: speedPercent < ATTRACT_SPEED_PERCENT,
    left: x > ATTRACT_CENTRE_DEADZONE,
    right: x < -ATTRACT_CENTRE_DEADZONE,
    gearToggle: gear === 'lo' && speedPercent >= ATTRACT_SHIFT_PERCENT,
  };
}

/**
 * Il titolo guida davvero: costruisce un motore di gara, lo pilota con
 * `attractActions` e lo disegna nella fase `demo` del ciclo attrattivo
 * (fase 0 illustrazione e logo, fase 2 mappa). Il motore arriva da
 * `deps.attractFactory`, che su `main` è `createRace` — senza traffico, né
 * tempo, né incidenti — così la strada in autopilota non può finire contro
 * un furgone mentre nessuno guarda. Uno snapshot per tick, come in
 * `createRaceScreen`: `snapshot()` proietta 300 segmenti e scrive il loro
 * `clip`, quindi chiamarlo due volte per frame raddoppierebbe il lavoro.
 */
export function createTitleScreen(deps: ScreenDeps): Screen {
  const factory = deps.attractFactory ?? deps.raceFactory;
  let state = initialTitleState();
  let engine: RaceEngine | null = null;
  let snapshot: RaceSnapshot | null = null;
  let topScores: ScoreEntry[] = [];

  /** L'illustrazione dell'attract mode, il logo e i primi punteggi. */
  const drawTitlePhase = (ctx: CanvasRenderingContext2D): void => {
    // get() non lancia mai: senza PNG arriva il ripiego procedurale.
    const bg = deps.assets.get('screen_attract');
    if (bg.w > 0 && bg.h > 0) ctx.drawImage(bg.image, 0, 0, LOGICAL_W, LOGICAL_H);
    const logo = deps.assets.get('title_logo');
    if (logo.w > 0 && logo.h > 0) {
      ctx.drawImage(logo.image, LOGICAL_W / 2 - logo.w / 2, 80, logo.w, logo.h);
    } else {
      drawTextOutlined(ctx, GAME_NAME, LOGICAL_W / 2, 100, 6, '#ffee55', 'center');
    }
    topScores.forEach((entry, i) => {
      drawText(ctx, `${i + 1} ${entry.name} ${entry.score}`, LOGICAL_W - 20, 20 + i * 22, 2, '#cccccc', 'right');
    });
    // La classifica è quella della modalità scelta: si dice quale.
    if (deps.mode !== undefined) {
      drawText(ctx, modeLabel(deps.mode.get()), LOGICAL_W - 20, 20 + TOP_SCORES_SHOWN * 22, 2, '#cccccc', 'right');
    }
  };

  /** La strada in autopilota, a tutto schermo e senza logo. */
  const drawDemoPhase = (ctx: CanvasRenderingContext2D): void => {
    if (snapshot !== null) deps.renderWorld(ctx, snapshot, deps.assets);
  };

  /** La mappa dei quindici nodi sopra l'illustrazione `map_full`. */
  const drawMapPhase = (ctx: CanvasRenderingContext2D): void => {
    drawRouteMapPanel(ctx, deps.assets, 0, 0, LOGICAL_W, LOGICAL_H, visitedStages([]), FIRST_STAGE_ID);
    drawText(ctx, 'ROUTE MAP', LOGICAL_W / 2, 40, 4, '#ffffff', 'center');
  };

  const drawPhase = (ctx: CanvasRenderingContext2D, phase: AttractPhase): void => {
    if (phase === 'title') drawTitlePhase(ctx);
    else if (phase === 'demo') drawDemoPhase(ctx);
    else drawMapPhase(ctx);
  };

  return {
    enter(payload) {
      parseTitlePayload(payload);
      state = initialTitleState();
      // Il titolo chiude la sfida giornaliera: da qui auto e modalità sono di nuovo quelle scelte.
      deps.daily?.stop();
      engine = factory(deps.firstStage, deps.assets);
      snapshot = engine.snapshot();
      // Letta una volta qui, non a ogni fotogramma: come l'engine e lo
      // snapshot, la classifica non cambia sotto i piedi di questa
      // schermata fra un enter() e il successivo.
      topScores = deps.scores.load().slice(0, TOP_SCORES_SHOWN);
    },
    update(dt, actions) {
      if (engine !== null && snapshot !== null) {
        engine.update(dt, attractActions(snapshot));
        snapshot = engine.snapshot();
      }
      const r = stepTitle(state, dt, actions, deps.daily !== undefined);
      state = r.state;
      return r.transition;
    },
    render(ctx) {
      const t = state.idleT;
      const phase = attractPhase(t);
      drawPhase(ctx, phase);
      // Dissolvenza attraverso il nero (spec §11): un velo nero sopra la
      // fase nuova, che si alza in ATTRACT_FADE_S secondi. Non si
      // sovrappongono due fasi con `globalAlpha`, perché `renderWorld`
      // rimette l'alfa a 1 più volte dentro un fotogramma.
      const fade = attractFade(t);
      if (fade < 1) {
        ctx.globalAlpha = 1 - fade;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
        ctx.globalAlpha = 1;
      }

      if (titleBlinkOn(state.blinkT)) {
        // Contorno scuro: il ruling del merge H+G sulla leggibilità resta
        // valido, perché la fase 0 è un'illustrazione chiarissima. Nella
        // fase mappa a 420 cadeva dentro il grafo del percorso (il nodo più
        // basso, livello 0, sta a cy ≈ 648 su LOGICAL_H = 720): più in
        // basso, fuori dal triangolo dei quindici nodi.
        const y = phase === 'map' ? PRESS_ENTER_MAP_Y : PRESS_ENTER_Y;
        const line = titleStartLine(deps.device?.() ?? 'keyboard');
        // Con DAILY scelto da tastiera o gamepad la partenza normale si spegne un po'.
        drawTextOutlined(ctx, line, LOGICAL_W / 2, y, 3, state.choice === 'daily' ? '#888888' : '#ffffff', 'center');
      }
      if (deps.daily !== undefined && dailyShown(phase)) {
        drawDailyButton(ctx, DAILY_RECT, state.choice === 'daily', deps.now);
        // La serie di giorni, da 2 in su (spec prima tappa e ritorno §5).
        const today = dailyKey(new Date(deps.now?.() ?? Date.now()));
        const streak = streakLine(deps.streak?.current(today) ?? 0);
        if (streak !== null) drawTextOutlined(ctx, streak, LOGICAL_W / 2, STREAK_Y, 2, STREAK_COLOR, 'center');
      }
    },
    exit() {
      // Il motore dell'autopilota va buttato: tiene un array di segmenti per
      // tutta la tappa e continuerebbe a occupare memoria per l'intera
      // partita. Il prossimo enter() ne costruisce uno nuovo.
      engine = null;
      snapshot = null;
    },
  };
}

/** La riga della serie, sotto il pulsante DAILY e sopra la fascia dei link (da y 630). */
export const STREAK_Y = DAILY_RECT.y + DAILY_RECT.h + 14;
export const STREAK_COLOR = '#ffaa33';

/**
 * DAILY CHALLENGE, con la sfida di oggi in piccolo (`RETRO · HARD`): acceso
 * quando la tastiera o il gamepad lo scelgono.
 */
function drawDailyButton(ctx: CanvasRenderingContext2D, r: Rect, lit: boolean, now?: () => number): void {
  const challenge = dailyChallenge(dailyKey(new Date(now?.() ?? Date.now())));
  drawMenuButton(ctx, r, '', 1, lit);
  drawTextOutlined(ctx, 'DAILY CHALLENGE', r.x + r.w / 2, r.y + 18, 4, lit ? '#ffee55' : '#ffffff', 'center');
  drawTextOutlined(ctx, `TODAY: ${challengeLabel(challenge)}`, r.x + r.w / 2, r.y + 64, 2, '#cccccc', 'center');
}
