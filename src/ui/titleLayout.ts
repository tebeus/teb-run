import type { Rect } from './rect';

/**
 * Il pulsante DAILY CHALLENGE del titolo (spec classifica e sfida, §3.3):
 * sotto la riga di partenza, sopra la fascia dei link (da y 630), uguale su
 * computer e telefono. Qui da solo perché lo leggono sia il titolo sia i
 * comandi a dita (`touch.ts`), senza che uno importi l'altro.
 */
export const DAILY_RECT: Rect = { x: 410, y: 466, w: 460, h: 104 };

/** START della schermata della sfida (`screens/daily.ts`), in basso al centro come RETRY e CONTINUE. */
export const DAILY_START_RECT: Rect = { x: 470, y: 612, w: 340, h: 84 };
