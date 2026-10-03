// Geometria della radio col tocco: dove stanno i pulsanti che `touch.ts`
// rende toccabili e i testi che `screens/radio.ts` scrive. Senza
// dipendenze, come `rect.ts`: la usano anche gli e2e.

import type { Rect } from './rect';

/** TILT in alto a destra: largo abbastanza per l'icona e TILT OFF a scala 3. */
export const RADIO_TILT_RECT: Rect = { x: 984, y: 12, w: 280, h: 88 };

/** La spiegazione di TILT finché non è mai stato toccato: sotto il pulsante, allineata a destra. */
export const TILT_HINT_LINES = ['TAP TILT TO STEER', 'BY TILTING THE PHONE'] as const;
export const TILT_HINT_RIGHT = RADIO_TILT_RECT.x + RADIO_TILT_RECT.w;
export const TILT_HINT_Y = 108;

/** Il permesso dei sensori negato o fallito: per qualche secondo, al centro. */
export const MOTION_BLOCKED_LINES = ['MOTION BLOCKED:', 'ALLOW IT IN SAFARI SETTINGS'] as const;
export const MOTION_BLOCKED_SECONDS = 4;
export const MOTION_BLOCKED_Y = 300;

/** BACK in alto a sinistra, alto quanto TILT. */
export const RADIO_BACK_RECT: Rect = { x: 16, y: 12, w: 200, h: 88 };

/** Il titolo a scala 4, fra BACK e TILT. */
export const RADIO_TOUCH_TITLE_Y = 34;

/**
 * L'elenco dei brani a scala 3: tre righe, sotto la spiegazione di TILT
 * (che finisce a y 170), con le frecce di scorrimento sopra e sotto.
 */
export const RADIO_TOUCH_ROWS = 3;
export const RADIO_TOUCH_LIST_Y = 176;
export const RADIO_TOUCH_ROW_STEP = 38;
export const RADIO_TOUCH_ARROW_UP_Y = 156;
export const RADIO_TOUCH_ARROW_DOWN_Y = 278;
/** Copertine e cursore più lontani dal centro: le righe a scala 3 sono più larghe. */
export const RADIO_TOUCH_ICON_X = 240;
export const RADIO_TOUCH_CURSOR_X = 270;
/** La fascia scura dietro l'elenco. */
export const RADIO_TOUCH_LIST_BAND: Rect = { x: 340, y: 148, w: 600, h: 146 };

/** Auto e modalità: due pulsanti veri, con la cornice, ai lati dell'elenco. */
export const RADIO_CAR_RECT: Rect = { x: 16, y: 112, w: 300, h: 178 };
export const RADIO_MODE_RECT: Rect = { x: 964, y: 180, w: 300, h: 110 };

/** La riga dei comandi a scala 3, sopra il pannello (che comincia a y 320). */
export const RADIO_TOUCH_CONTROLS_Y = 297;
