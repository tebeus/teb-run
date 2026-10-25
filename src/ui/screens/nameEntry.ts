import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { routeString } from '../../game/stages';
import type { Actions } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type ScreenPayloads, type Transition } from '../fsm';
import { drawText } from '../text';
import { mouseButtonActions } from '../touch';
import { blockedInitials } from '../../shared/initials';
import { DEFAULT_CAR } from '../../game/car';
import type { RunBody } from '../../shared/validate';
import type { CarChoice, Difficulty } from '../../types';

export const NAME_ENTRY_TIMEOUT_S = 30;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type NameEntryPayload = ScreenPayloads['nameEntry'];

export interface NameEntryState {
  letters: [string, string, string];
  cursor: 0 | 1 | 2;
  t: number;
  prevUp: boolean;
  prevDown: boolean;
  prevAdvance: boolean;
  /** Falso solo prima del primissimo tick osservato: vedi il suo uso in `stepNameEntry`. */
  seeded: boolean;
  payload: NameEntryPayload;
  done: boolean;
}

/** Valida il payload di ingresso nome; con dati mancanti o malformati punteggio 0, tappa vuota, percorso vuoto. Pura. */
export function parseNameEntryPayload(payload: unknown): NameEntryPayload {
  const p = payload as Partial<NameEntryPayload> | undefined;
  return {
    score: typeof p?.score === 'number' ? p.score : 0,
    stageId: typeof p?.stageId === 'string' ? p.stageId : '',
    route: Array.isArray(p?.route) ? p.route : [],
    ...(typeof p?.song === 'number' ? { song: p.song } : {}),
    ...(typeof p?.time === 'number' && Number.isFinite(p.time) ? { time: p.time } : {}),
    ...(typeof p?.ending === 'number' && Number.isInteger(p.ending) ? { ending: p.ending } : {}),
  };
}

function initialNameEntryState(payload: NameEntryPayload, last?: string | null): NameEntryState {
  // Si riparte dalle ultime iniziali usate, se ci sono.
  const letters: [string, string, string] = last && /^[A-Z]{3}$/.test(last) ? [last[0], last[1], last[2]] : ['A', 'A', 'A'];
  return {
    letters,
    cursor: 0,
    t: 0,
    prevUp: false,
    prevDown: false,
    prevAdvance: false,
    seeded: false,
    payload,
    done: false,
  };
}

function cycleLetter(letter: string, dir: 1 | -1): string {
  const i = LETTERS.indexOf(letter);
  const n = LETTERS.length;
  return LETTERS[(i + dir + n) % n];
}

/**
 * Riduttore puro: `accelerate`/`brake` fanno da su/giù per scorrere A..Z sulla
 * lettera corrente, `right` o `confirm` avanzano al cursore successivo, tutti
 * con fronte di salita perché sono azioni continue tranne `confirm`. Dopo la
 * terza lettera un altro avanzamento segnala `commit`. Un timeout di 30 s
 * segnala `commit` comunque, col nome raggiunto fin lì. Una volta `done`, non
 * fa più nulla: previene un doppio inserimento. Non ritorna una transizione:
 * il rango in classifica del nome appena inserito si conosce solo dopo
 * l'inserimento vero, quindi è la fabbrica (`createNameEntryScreen`) a
 * costruire la transizione quando `commit` è vero.
 */
export function stepNameEntry(
  state: NameEntryState,
  dt: number,
  actions: Actions,
): { state: NameEntryState; commit: boolean } {
  if (state.done) return { state, commit: false };

  const t = state.t + dt;
  const letters = [...state.letters] as [string, string, string];
  let cursor = state.cursor;

  // Sul primissimo tick osservato non c'è un vero "tick precedente": si
  // seeda il fronte con l'input di questo stesso tick, così un tasto già
  // tenuto giù dalla schermata precedente (ending o game over) non conta
  // come una pressione fresca e non fa avanzare il cursore o scorrere una
  // lettera a sorpresa.
  const prevUp = state.seeded ? state.prevUp : actions.accelerate;
  const prevDown = state.seeded ? state.prevDown : actions.brake;
  const advancePressed = actions.right || actions.confirm;
  const prevAdvance = state.seeded ? state.prevAdvance : advancePressed;

  if (actions.accelerate && !prevUp) letters[cursor] = cycleLetter(letters[cursor], 1);
  if (actions.brake && !prevDown) letters[cursor] = cycleLetter(letters[cursor], -1);

  const advanceEdge = advancePressed && !prevAdvance;

  let done = false;
  let commit = false;

  if (advanceEdge) {
    if (cursor === 2) {
      done = true;
      commit = true;
    } else {
      cursor = (cursor + 1) as 1 | 2;
    }
  } else if (t + 1e-9 >= NAME_ENTRY_TIMEOUT_S) {
    done = true;
    commit = true;
  }

  const next: NameEntryState = {
    letters,
    cursor,
    t,
    prevUp: actions.accelerate,
    prevDown: actions.brake,
    prevAdvance: advancePressed,
    seeded: true,
    payload: state.payload,
    done,
  };

  return { state: next, commit };
}

/** Per quanto resta a schermo "TRY OTHER LETTERS" dopo iniziali bloccate. */
export const BLOCKED_NOTICE_S = 2.5;

/**
 * Il corpo di `POST /score` da una partita e dalle iniziali, o null se
 * manca il tempo di gara (allora non si manda). Pura.
 */
export function runBody(
  payload: NameEntryPayload,
  initials: string,
  car: CarChoice,
  mode: Difficulty,
  daily: string | null,
): RunBody | null {
  if (payload.time === undefined) return null;
  return {
    initials,
    score: payload.score,
    mode,
    car,
    stageId: payload.stageId,
    route: payload.route.join(''),
    ending: payload.ending === undefined ? null : payload.ending + 1,
    durationMs: Math.round(payload.time * 1000),
    ...(daily === null ? {} : { daily }),
  };
}

export function createNameEntryScreen(deps: ScreenDeps): Screen {
  let state: NameEntryState = initialNameEntryState({ score: 0, stageId: '', route: [] });
  /** Secondi rimasti della scritta "TRY OTHER LETTERS". */
  let notice = 0;

  return {
    enter(payload) {
      state = initialNameEntryState(parseNameEntryPayload(payload), deps.initials?.get());
      notice = 0;
    },
    update(dt, actions) {
      notice = Math.max(0, notice - dt);
      // Un clic del mouse su UP, DOWN o NEXT vale quel pulsante per un tick.
      const r = stepNameEntry(state, dt, { ...actions, ...mouseButtonActions('nameEntry', actions.click) });
      state = r.state;
      if (!r.commit) return null;

      let name = state.letters.join('');
      if (blockedInitials(name)) {
        // Combinazione della lista di blocco (la stessa del server): si dice
        // subito e si ricomincia dalla prima lettera. Allo scadere del tempo,
        // invece, si va avanti con AAA.
        if (state.t + 1e-9 < NAME_ENTRY_TIMEOUT_S) {
          state = { ...state, done: false, cursor: 0, t: 0, seeded: false };
          notice = BLOCKED_NOTICE_S;
          return null;
        }
        name = 'AAA';
      }
      deps.initials?.set(name);

      const now = deps.now ? new Date(deps.now()) : new Date();
      const daily = deps.daily?.current() ?? null;
      // La TOP 10 locale: non le partite DAILY (traffico diverso), e solo se
      // il punteggio ci entra (le iniziali possono servire solo alla mondiale).
      const local = daily === null && deps.scores.qualifies(state.payload.score);
      const rank = local
        ? deps.scores.insert({
            name,
            score: state.payload.score,
            stageId: state.payload.stageId,
            route: routeString(state.payload.route),
            date: now.toISOString(),
          })
        : -1;
      // La classifica mondiale, in background: la posizione arriva in `scores`.
      const board = daily === null ? 'today' : 'daily';
      const body = runBody(state.payload, name, deps.car?.get() ?? DEFAULT_CAR, deps.mode?.get() ?? 'normal', daily?.key ?? null);
      if (deps.board !== undefined && body !== null) deps.board.submit(body, board);
      // insert() ritorna il rango 1-based (o -1); la tabella in scores.ts si
      // indicizza da 0, quindi si converte qui, all'unico punto di contatto.
      // Dopo le iniziali la TOP 10 offre RETRY, con il brano della partita;
      // si apre sulla pagina dove la partita è entrata.
      const page = rank > 0 ? 'local' : deps.board !== undefined ? board : 'local';
      return go('scores', { highlight: rank > 0 ? rank - 1 : undefined, retry: { song: state.payload.song ?? 0 }, page });
    },
    render(ctx) {
      // Sfondo proprio: `createApp.render` già pulisce il frame ad ogni
      // schermata (vedi ui/app.ts), ma questo dà alla schermata il suo
      // colore invece del nero neutro, e protegge anche chi chiamasse
      // `screen.render` direttamente senza passare per `createApp`.
      ctx.fillStyle = '#101028';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      drawText(ctx, 'ENTER YOUR NAME', LOGICAL_W / 2, 200, 4, '#ffffff', 'center');
      const cursor = deps.assets.get('menu_cursor');
      state.letters.forEach((letter, i) => {
        const on = i === state.cursor;
        const x = LOGICAL_W / 2 + (i - 1) * 60;
        drawText(ctx, letter, x, 340, 6, on ? '#ffee55' : '#ffffff', 'center');
        // Cursore sotto la lettera corrente, ruotato in su (spec §11).
        if (on && cursor.w > 0 && cursor.h > 0) {
          const w = 28;
          const h = (w * cursor.h) / cursor.w;
          ctx.save();
          ctx.translate(x, 340 + 68 + h / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(cursor.image, -w / 2, -h / 2, w, h);
          ctx.restore();
        }
      });
      if (notice > 0) drawText(ctx, 'TRY OTHER LETTERS', LOGICAL_W / 2, 270, 3, '#ffee55', 'center');
      const hint = deps.device?.() === 'touch' ? 'UP DOWN TO CHOOSE, NEXT TO CONFIRM' : 'UP DOWN TO CHOOSE, RIGHT TO CONFIRM';
      drawText(ctx, hint, LOGICAL_W / 2, LOGICAL_H - 260, 2, '#cccccc', 'center');
    },
  };
}
