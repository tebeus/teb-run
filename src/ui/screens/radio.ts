import { SONG_TITLES } from '../../audio/songs';
import { stagedOf } from '../../core/assets';
import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { carLabel, playerFrame } from '../../game/car';
import { modeLabel } from '../../game/mode';
import type { Actions } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type ScreenPayloads, type Transition } from '../fsm';
import { drawTextOutlined } from '../text';
import { drawRadioControls, DRIVE_LINE_TOUCH_TILT, DRIVE_LINES, radioChangeLine, radioMenuLine } from '../controlsHelp';
import {
  RADIO_BACK_RECT,
  RADIO_CAR_RECT,
  RADIO_MODE_RECT,
  RADIO_TILT_RECT,
  RADIO_TOUCH_ARROW_DOWN_Y,
  RADIO_TOUCH_ARROW_UP_Y,
  RADIO_TOUCH_CONTROLS_Y,
  RADIO_TOUCH_CURSOR_X,
  RADIO_TOUCH_ICON_X,
  RADIO_TOUCH_LIST_BAND,
  RADIO_TOUCH_LIST_Y,
  RADIO_TOUCH_ROW_STEP,
  RADIO_TOUCH_ROWS,
  RADIO_TOUCH_TITLE_Y,
} from '../radioTouch';
import { measureText } from '../text';
import { inside, type Rect } from '../rect';
import { touchLayout } from '../touch';
import type { InputDevice } from '../../core/device';
import { RADIO_TIMER_BUILD } from '../../core/target';

/**
 * I titoli mostrati vengono da `audio/songs`, in maiuscolo perché il font
 * bitmap di `ui/text.ts` ha solo le maiuscole: così cambiare un brano non
 * lascia la radio a indicarne uno che non esiste più.
 */
export const SONGS: readonly [string, string, string] = [
  SONG_TITLES[0].toUpperCase(),
  SONG_TITLES[1].toUpperCase(),
  SONG_TITLES[2].toUpperCase(),
];

/** Larghezza e altezza del pannello, sempre centrato in basso (spec §11). */
export const PANEL_W = 1000;
export const PANEL_H = 400;
/**
 * Display del pannello, in coordinate locali all'immagine 1000x400
 * (spec §11): lì il gioco scrive il titolo del brano scelto.
 */
export const PANEL_DISPLAY_X = [300, 700] as const;
export const PANEL_DISPLAY_Y = [130, 210] as const;

/** Quante righe di elenco stanno sullo schermo insieme (spec §11). */
export const RADIO_VISIBLE_ROWS = 5;

/**
 * Geometria dell'elenco, in pixel logici. Cinque righe non stanno dove ne
 * stavano tre: fra il titolo in alto e il pannello (che comincia a
 * `LOGICAL_H - PANEL_H`, cioè 320) ci sono 240 px, e servono anche le due
 * frecce di scorrimento e la riga dei comandi. Quindi il titolo sale, il passo
 * fra le righe scende da 36 a 32, e tutto ci sta con margine:
 * 78 titolo, 112 freccia su, 130..274 le cinque righe, 282 freccia giù,
 * 302 comandi, 320 il pannello.
 */
export const RADIO_TITLE_Y = 78;
export const RADIO_ARROW_UP_Y = 112;
export const RADIO_LIST_Y = 130;
export const RADIO_ROW_STEP = 32;
export const RADIO_ARROW_DOWN_Y = 282;
export const RADIO_HINT_Y = 302;

// Copertine e cursore del binario I (spec §11, §13). Le righe di J stanno
// a `RADIO_ROW_STEP = 32` px l'una dall'altra e sono scritte a scala 2,
// cioè glifi alti 16 px: una copertina larga 18 px esce alta ~27 e ci sta
// con margine.
/** Copertina di un brano: una delle tre celle di `radio_track_icons`. */
export const ICON_W = 18;
export const ICON_CELLS = 3;
/** Distanza delle copertine dal centro dello schermo. */
export const ICON_X = 300;
/** Cursore a sinistra della riga scelta, al margine dell'elenco. */
export const CURSOR_W = 16;
export const CURSOR_X = 330;

/**
 * Scelta dell'auto (Set 7), a sinistra dell'elenco dei brani, che non
 * cambia: il frame dritto dell'auto scelta largo `RADIO_CAR_W`, appoggiato
 * a `RADIO_CAR_BOTTOM_Y`, con sotto la scritta e il tasto. Le copertine
 * stanno a x = 340, quindi fra 65 e 235 c'è posto.
 */
export const RADIO_CAR_X = 150;
export const RADIO_CAR_W = 170;
export const RADIO_CAR_BOTTOM_Y = 240;
export const RADIO_CAR_LABEL_Y = 252;
export const RADIO_CAR_HINT_Y = 274;

/**
 * Scelta della modalità (collaudo utente: due livelli di difficoltà),
 * accanto a quella dell'auto, dall'altra parte dell'elenco: stessa altezza
 * della scritta `CAR:` e del suo tasto, specchiata rispetto al centro. La
 * scritta più lunga, `MODE: NORMAL` a scala 2, è larga 192 px e sta fra
 * 1034 e 1226, fuori dall'elenco quanto la scelta dell'auto.
 */
export const RADIO_MODE_X = LOGICAL_W - RADIO_CAR_X;

/** Colore della scritta: giallo come `CAR:` in NORMAL, rosso in HARD. */
export const RADIO_MODE_COLORS = { normal: '#ffee55', hard: '#ff5a4a' } as const;

/** Il tasto D della radio cambia modalità: azione momentanea, un tocco vale un cambio. Pura. */
export function wantsModeToggle(actions: Actions): boolean {
  return actions.modeToggle;
}

/**
 * Il tasto C della radio cambia auto. C è anche il cambio marcia
 * (`gearToggle`, con Shift e Y del gamepad): sulla radio la marcia non
 * serve, e l'azione è momentanea, quindi un tocco vale un cambio. Pura.
 */
export function wantsCarToggle(actions: Actions): boolean {
  return actions.gearToggle;
}

export interface RadioState {
  selected: number;
  prevLeft: boolean;
  prevRight: boolean;
}

export function initialRadioState(): RadioState {
  return { selected: 0, prevLeft: false, prevRight: false };
}

/** La radio non riceve mai un payload utile: lo ignora, non lancia mai. Pura. */
export function parseRadioPayload(_payload: unknown): ScreenPayloads['radio'] {
  return undefined;
}

/**
 * Finestra di righe da mostrare: tiene la selezione dentro, centrata quando
 * può, appoggiata a un estremo quando la lista finisce. Pura.
 */
export function visibleWindow(
  selected: number,
  count: number,
  rows: number = RADIO_VISIBLE_ROWS,
): { from: number; to: number } {
  if (count <= 0) return { from: 0, to: 0 };
  if (count <= rows) return { from: 0, to: count };
  const half = Math.floor(rows / 2);
  const from = Math.min(Math.max(0, selected - half), count - rows);
  return { from, to: from + rows };
}

/**
 * Riduttore puro della radio. `count` è quanti brani ci sono in tutto (tre
 * sintetici più i personali): arriva da fuori perché la lista si allunga
 * quando il manifest finisce di caricarsi, anche a schermata già aperta.
 */
export function stepRadio(
  state: RadioState,
  actions: Actions,
  count: number,
): { state: RadioState; transition: Transition | null; songChanged: boolean } {
  const total = Math.max(1, count);
  // La lista può essere cambiata sotto i piedi: la selezione si riporta
  // dentro prima di muoverla.
  let selected = state.selected >= total || state.selected < 0 ? 0 : state.selected;
  let songChanged = selected !== state.selected;

  if (actions.left && !state.prevLeft) {
    selected = (selected + total - 1) % total;
    songChanged = true;
  } else if (actions.right && !state.prevRight) {
    selected = (selected + 1) % total;
    songChanged = true;
  }

  const next: RadioState = { selected, prevLeft: actions.left, prevRight: actions.right };

  if (actions.confirm) {
    return { state: next, transition: go('race', { song: selected }), songChanged };
  }
  // Esc è "Indietro" (lancio, punto 5): dalla radio si torna al titolo.
  if (actions.back) {
    return { state: next, transition: go('title', undefined), songChanged };
  }
  return { state: next, transition: null, songChanged };
}

/**
 * Timer della radio (solo build crazygames, `RADIO_TIMER_BUILD`), come nei
 * cabinati: dieci secondi a vista, e allo zero si parte con il brano, l'auto
 * e la modalità scelti. Un input **non** lo azzera: chi sceglie con calma ha
 * comunque dieci secondi, e chi non capisce i comandi (quello che il Basic
 * Launch perdeva) arriva in gara lo stesso. Si ferma solo mentre iOS mostra
 * la finestra del permesso dei sensori.
 */
export const RADIO_TIMER_SECONDS = 10;

/** I secondi da scrivere dopo `t` secondi di radio: 10, 9, ... 1, poi 0. Pura. */
export function radioTimerShown(t: number): number {
  return Math.max(0, Math.ceil(RADIO_TIMER_SECONDS - t - 1e-9));
}

/** Il timer è arrivato a zero? Pura. */
export function radioTimerExpired(t: number): boolean {
  return t + 1e-9 >= RADIO_TIMER_SECONDS;
}

/**
 * Il timer, sopra a destra (su computer: fuori dalle righe dei comandi, che
 * finiscono a x 1144) o, col tocco, fra BACK e il titolo (TILT occupa
 * l'angolo a destra). Rosso negli ultimi tre secondi.
 */
export function drawRadioTimer(ctx: CanvasRenderingContext2D, t: number, touch: boolean): void {
  const n = radioTimerShown(t);
  const colour = n <= 3 ? '#ff5a4a' : '#ffee55';
  if (touch) {
    const cx = (RADIO_BACK_RECT.x + RADIO_BACK_RECT.w + LOGICAL_W / 2 - measureText('SELECT YOUR RADIO', 4) / 2) / 2;
    drawTextOutlined(ctx, 'TIME', cx, RADIO_BACK_RECT.y + 4, 2, '#ffffff', 'center');
    drawTextOutlined(ctx, String(n), cx, RADIO_BACK_RECT.y + 28, 6, colour, 'center');
  } else {
    const right = RADIO_TILT_RECT.x + RADIO_TILT_RECT.w - 6;
    drawTextOutlined(ctx, 'TIME', right, 14, 2, '#ffffff', 'right');
    drawTextOutlined(ctx, String(n), right, 38, 6, colour, 'right');
  }
}

/** Cosa c'è sotto un clic del mouse sulla radio. */
export type RadioClick =
  | { kind: 'song'; index: number }
  | { kind: 'car' }
  | { kind: 'mode' }
  | { kind: 'back' }
  | { kind: 'none' }
  | { kind: 'start' };

/**
 * Il bersaglio di un clic del mouse sulla radio: un brano lo sceglie e basta
 * (non parte), l'auto e la modalità cambiano, le frecce scorrono l'elenco;
 * altrove, la partenza. Con lo schema del telefono (un portatile touch che
 * ha appena usato le dita) valgono anche i suoi pulsanti. Pura.
 */
export function radioClickTarget(device: InputDevice, selected: number, count: number, p: { x: number; y: number }): RadioClick {
  const look = device === 'touch' ? TOUCH_LOOK : DESK_LOOK;
  const total = Math.max(1, count);
  if (inside(RADIO_CAR_RECT, p.x, p.y)) return { kind: 'car' };
  if (inside(RADIO_MODE_RECT, p.x, p.y)) return { kind: 'mode' };
  if (look.touch) {
    const b = touchLayout('radio', { tiltAvailable: true, tiltOn: false, cssPerLogical: 1 }).find((x) => inside(x.rect, p.x, p.y));
    if (b?.id === 'back') return { kind: 'back' };
    if (b?.id === 'tilt') return { kind: 'none' };
    if (b?.id === 'prev') return { kind: 'song', index: (selected + total - 1) % total };
    if (b?.id === 'next') return { kind: 'song', index: (selected + 1) % total };
    if (b?.id === 'start') return { kind: 'start' };
  }
  const { from, to } = visibleWindow(selected, total, look.rows);
  const half = look.cursorX + 10;
  for (let i = from; i < to; i++) {
    const rowY = look.listY + (i - from) * look.rowStep;
    const row: Rect = { x: LOGICAL_W / 2 - half, y: rowY - (look.rowStep - 16) / 2, w: 2 * half, h: look.rowStep };
    if (inside(row, p.x, p.y)) return { kind: 'song', index: i };
  }
  const arrow = (y: number): Rect => ({ x: LOGICAL_W / 2 - 40, y: y - 8, w: 80, h: 32 });
  if (from > 0 && inside(arrow(look.arrowUpY), p.x, p.y)) return { kind: 'song', index: from - 1 };
  if (to < total && inside(arrow(look.arrowDownY), p.x, p.y)) return { kind: 'song', index: to };
  return { kind: 'start' };
}

/**
 * Dove stanno le cose sulla radio: lo schema di sempre, o quello del
 * telefono (`radioTouch.ts`), con testi a scala 3, tre righe e fasce scure
 * dietro, perché a 375 px CSS di altezza la scala 2 non si legge.
 */
interface RadioLook {
  touch: boolean;
  titleY: number;
  rows: number;
  listY: number;
  rowStep: number;
  rowScale: number;
  arrowUpY: number;
  arrowDownY: number;
  iconX: number;
  cursorX: number;
}

const DESK_LOOK: RadioLook = {
  touch: false,
  titleY: RADIO_TITLE_Y,
  rows: RADIO_VISIBLE_ROWS,
  listY: RADIO_LIST_Y,
  rowStep: RADIO_ROW_STEP,
  rowScale: 2,
  arrowUpY: RADIO_ARROW_UP_Y,
  arrowDownY: RADIO_ARROW_DOWN_Y,
  iconX: ICON_X,
  cursorX: CURSOR_X,
};

const TOUCH_LOOK: RadioLook = {
  touch: true,
  titleY: RADIO_TOUCH_TITLE_Y,
  rows: RADIO_TOUCH_ROWS,
  listY: RADIO_TOUCH_LIST_Y,
  rowStep: RADIO_TOUCH_ROW_STEP,
  rowScale: 3,
  arrowUpY: RADIO_TOUCH_ARROW_UP_Y,
  arrowDownY: RADIO_TOUCH_ARROW_DOWN_Y,
  iconX: RADIO_TOUCH_ICON_X,
  cursorX: RADIO_TOUCH_CURSOR_X,
};

/** Scala 3 se il testo ci sta in `w`, altrimenti 2: i titoli dei brani personali possono essere lunghi. Pura. */
export function fitScale(text: string, w: number): 2 | 3 {
  return measureText(text, 3) <= w ? 3 : 2;
}

/** Una fascia scura dietro i testi, per leggerli sopra il tramonto. */
function band(ctx: CanvasRenderingContext2D, r: Rect, alpha = 0.62): void {
  const before = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#0a0e28';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.globalAlpha = before;
}

/** Un pulsante della radio disegnato dalla radio stessa (auto, modalità): fondo scuro e cornice chiara. */
function buttonFrame(ctx: CanvasRenderingContext2D, r: Rect): void {
  band(ctx, r, 0.72);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const t = 4;
  ctx.fillRect(r.x, r.y, r.w, t);
  ctx.fillRect(r.x, r.y + r.h - t, r.w, t);
  ctx.fillRect(r.x, r.y, t, r.h);
  ctx.fillRect(r.x + r.w - t, r.y, t, r.h);
}

export function createRadioScreen(deps: ScreenDeps): Screen {
  let state = initialRadioState();
  /** Secondi di timer passati (solo build crazygames). */
  let timerT = 0;

  /**
   * Titoli mostrati: i tre sintetici più i personali (spec §11).
   * `customTracks` è opzionale sul contratto, quindi assente e vuoto vogliono
   * dire la stessa cosa. Si rilegge a ogni frame di proposito: il manifest
   * arriva con una fetch, quindi la lista può allungarsi a schermata aperta.
   */
  const titles = (): string[] => [
    ...SONG_TITLES.map((title) => title.toUpperCase()),
    ...(deps.audio.customTracks ?? []).map((track) => track.title.toUpperCase()),
  ];

  return {
    enter(payload) {
      parseRadioPayload(payload);
      state = initialRadioState();
      timerT = 0;
      deps.audio.playSong(state.selected);
    },
    update(dt, actions) {
      // Il clic del mouse: un brano si sceglie, l'auto e la modalità cambiano
      // come con C e D, altrove si parte (come ENTER).
      if (actions.click) {
        const hit = radioClickTarget(deps.device?.() ?? 'keyboard', state.selected, titles().length, actions.click);
        if (hit.kind === 'song' && hit.index !== state.selected) {
          state = { ...state, selected: hit.index };
          deps.audio.playSong(state.selected);
        } else if (hit.kind === 'car') {
          actions = { ...actions, gearToggle: true };
        } else if (hit.kind === 'mode') {
          actions = { ...actions, modeToggle: true };
        } else if (hit.kind === 'back') {
          actions = { ...actions, back: true };
        } else if (hit.kind === 'start') {
          actions = { ...actions, confirm: true };
        }
      }
      if (deps.mode !== undefined && wantsModeToggle(actions)) deps.mode.toggle();
      if (deps.car !== undefined && wantsCarToggle(actions)) {
        deps.car.toggle();
        // Caricamento a fasi: i frame dell'auto appena scelta passano in
        // testa al background, così di solito ci sono già alla partenza.
        stagedOf(deps.assets)?.requestStage({ id: deps.firstStage.id, theme: deps.firstStage.theme }, deps.car.get());
      }
      if (RADIO_TIMER_BUILD) {
        if (deps.tiltAsking?.() !== true) timerT += dt;
        // Allo zero si parte, come con ENTER.
        if (radioTimerExpired(timerT)) actions = { ...actions, confirm: true };
      }
      const r = stepRadio(state, actions, titles().length);
      state = r.state;
      if (r.songChanged) deps.audio.playSong(state.selected);
      return r.transition;
    },
    render(ctx) {
      // Sfondo proprio: `createApp.render` già pulisce il frame ad ogni
      // schermata (vedi ui/app.ts), ma questo dà alla radio il suo colore
      // invece del nero neutro, e protegge anche chi chiamasse
      // `screen.render` direttamente senza passare per `createApp`. Resta il
      // primo `fillRect`, poi l'illustrazione ci va sopra se c'è (spec §11).
      ctx.fillStyle = '#101028';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      // `assets.get` non lancia mai (procedurale o segnaposto): `has` decide
      // solo se disegnare l'immagine o il ripiego minimo di questo schermo.
      if (deps.assets.has('screen_attract')) {
        const bg = deps.assets.get('screen_attract');
        ctx.drawImage(bg.image, 0, 0, LOGICAL_W, LOGICAL_H);
      }

      // Contorno scuro su tutto (spec §11): l'illustrazione del tramonto è
      // chiarissima, e il testo piatto grigio ci sparisce dentro.
      const device = deps.device?.() ?? 'keyboard';
      // Col tocco la radio si legge a misura di telefono; senza, resta com'era.
      const look = device === 'touch' ? TOUCH_LOOK : DESK_LOOK;
      drawTextOutlined(ctx, 'SELECT YOUR RADIO', LOGICAL_W / 2, look.titleY, 4, '#ffffff', 'center');

      // L'elenco: i tre brani sintetici più i personali, in una finestra di
      // `look.rows` righe che tiene dentro la selezione.
      const list = titles();
      const { from, to } = visibleWindow(state.selected, list.length, look.rows);
      if (look.touch) band(ctx, RADIO_TOUCH_LIST_BAND);
      // `get` non lancia mai: senza PNG arriva il ripiego procedurale, e
      // un asset senza misura salta il disegno (decisione di contratto).
      const icons = deps.assets.get('radio_track_icons');
      const cursor = deps.assets.get('menu_cursor');
      for (let i = from; i < to; i++) {
        const on = i === state.selected;
        const rowY = look.listY + (i - from) * look.rowStep;
        // La copertina vale solo per i tre brani sintetici: i brani
        // personali del giocatore non hanno un'illustrazione. La striscia
        // è larga esattamente tre celle uguali (spec §13).
        if (i < SONGS.length && icons.w > 0 && icons.h > 0) {
          const cw = icons.w / ICON_CELLS;
          const ih = (ICON_W * icons.h) / cw;
          ctx.drawImage(icons.image, i * cw, 0, cw, icons.h, LOGICAL_W / 2 - look.iconX, rowY - 4, ICON_W, ih);
        }
        // Un solo cursore: il glifo `>` è un ripiego per quando manca il PNG
        // (`assets.get` dà comunque il procedurale, quindi in pratica non
        // succede mai), non un secondo cursore disegnato sempre insieme a
        // `menu_cursor` (spec §11).
        const hasCursorImage = cursor.w > 0 && cursor.h > 0;
        if (on && hasCursorImage) {
          const ch = (CURSOR_W * cursor.h) / cursor.w;
          ctx.drawImage(cursor.image, LOGICAL_W / 2 - look.cursorX, rowY, CURSOR_W, ch);
        }
        const row = `${on && !hasCursorImage ? '>' : ' '} ${list[i] ?? ''}`;
        const rowScale = look.touch ? fitScale(row, 2 * (look.cursorX - 24)) : look.rowScale;
        drawTextOutlined(ctx, row, LOGICAL_W / 2, rowY, rowScale, on ? '#ffee55' : '#e8e8e8', 'center');
      }
      // Frecce di scorrimento, solo quando c'è qualcosa fuori dalla finestra.
      if (from > 0) {
        drawTextOutlined(ctx, '^', LOGICAL_W / 2, look.arrowUpY, 2, '#e8e8e8', 'center');
      }
      if (to < list.length) {
        drawTextOutlined(ctx, 'V', LOGICAL_W / 2, look.arrowDownY, 2, '#e8e8e8', 'center');
      }

      if (look.touch) {
        // Col tocco frecce e START del pannello si spiegano da soli: al posto
        // della riga del menu, la riga dei comandi di guida, grande, sopra il pannello.
        const line = deps.tiltOn?.() === true ? DRIVE_LINE_TOUCH_TILT : DRIVE_LINES.touch;
        const w = measureText(line, 3) + 24;
        band(ctx, { x: LOGICAL_W / 2 - w / 2, y: RADIO_TOUCH_CONTROLS_Y - 5, w, h: 30 });
        drawTextOutlined(ctx, line, LOGICAL_W / 2, RADIO_TOUCH_CONTROLS_Y, 3, '#ffffff', 'center');
      } else {
        drawTextOutlined(ctx, radioMenuLine(device), LOGICAL_W / 2, RADIO_HINT_Y, 2, '#e8e8e8', 'center');
        // I comandi di guida (lancio, punto 7), sopra il titolo.
        drawRadioControls(ctx, device);
      }

      // Nella sfida del giorno auto e modalità sono quelle della sfida: al
      // posto di "C TO CHANGE" si dice che sono fissate.
      const locked = deps.daily?.current() != null;
      const changeLine = (key: 'C' | 'D'): string => (locked ? 'DAILY CHALLENGE' : radioChangeLine(device, key));

      // L'auto scelta (Set 7): anteprima del frame dritto e scritta.
      if (deps.car !== undefined) {
        const car = deps.car.get();
        const preview = deps.assets.get(playerFrame(car, 'straight'));
        // Col tocco l'auto è un pulsante vero: cornice, auto, nome a scala 3 e TAP TO CHANGE.
        const box = RADIO_CAR_RECT;
        if (look.touch) buttonFrame(ctx, box);
        const carX = look.touch ? box.x + box.w / 2 : RADIO_CAR_X;
        const carW = look.touch ? 128 : RADIO_CAR_W;
        const carBottom = look.touch ? box.y + 98 : RADIO_CAR_BOTTOM_Y;
        if (preview.w > 0 && preview.h > 0) {
          const ph = (carW * preview.h) / preview.w;
          ctx.drawImage(preview.image, carX - carW / 2, carBottom - ph, carW, ph);
        }
        if (look.touch) {
          const label = carLabel(car);
          drawTextOutlined(ctx, label, carX, box.y + 108, fitScale(label, box.w - 8), '#ffee55', 'center');
          drawTextOutlined(ctx, changeLine('C'), carX, box.y + 142, 2, '#ffffff', 'center');
        } else {
          drawTextOutlined(ctx, carLabel(car), RADIO_CAR_X, RADIO_CAR_LABEL_Y, 2, '#ffee55', 'center');
          drawTextOutlined(ctx, changeLine('C'), RADIO_CAR_X, RADIO_CAR_HINT_Y, 1, '#e8e8e8', 'center');
        }
      }

      // La modalità scelta, dall'altra parte dell'elenco.
      if (deps.mode !== undefined) {
        const mode = deps.mode.get();
        if (look.touch) {
          const box = RADIO_MODE_RECT;
          const label = modeLabel(mode);
          buttonFrame(ctx, box);
          drawTextOutlined(ctx, label, box.x + box.w / 2, box.y + 24, fitScale(label, box.w - 8), RADIO_MODE_COLORS[mode], 'center');
          drawTextOutlined(ctx, changeLine('D'), box.x + box.w / 2, box.y + 70, 2, '#ffffff', 'center');
        } else {
          drawTextOutlined(ctx, modeLabel(mode), RADIO_MODE_X, RADIO_CAR_LABEL_Y, 2, RADIO_MODE_COLORS[mode], 'center');
          drawTextOutlined(ctx, changeLine('D'), RADIO_MODE_X, RADIO_CAR_HINT_Y, 1, '#e8e8e8', 'center');
        }
      }

      if (RADIO_TIMER_BUILD) drawRadioTimer(ctx, timerT, look.touch);

      // Pannello dell'autoradio, largo 1000 px centrato in basso (spec §11).
      const panelX = (LOGICAL_W - PANEL_W) / 2;
      const panelY = LOGICAL_H - PANEL_H;
      if (deps.assets.has('radio_panel')) {
        const panel = deps.assets.get('radio_panel');
        ctx.drawImage(panel.image, panelX, panelY, PANEL_W, PANEL_H);
      } else {
        ctx.fillStyle = '#2b2b3a';
        ctx.fillRect(panelX, panelY, PANEL_W, PANEL_H);
      }

      // Il titolo scelto, scritto nel display del pannello.
      const displayCx = panelX + (PANEL_DISPLAY_X[0] + PANEL_DISPLAY_X[1]) / 2;
      const displayCy = panelY + (PANEL_DISPLAY_Y[0] + PANEL_DISPLAY_Y[1]) / 2;
      const shown = list[state.selected] ?? '';
      const displayScale = look.touch ? fitScale(shown, PANEL_DISPLAY_X[1] - PANEL_DISPLAY_X[0] - 16) : 2;
      drawTextOutlined(ctx, shown, displayCx, displayCy - 4 * displayScale, displayScale, '#ffee55', 'center');
    },
    exit() {
      deps.audio.stopSong();
    },
  };
}
