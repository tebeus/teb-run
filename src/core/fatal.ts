// Ultima rete di sicurezza del bootstrap: se `main()` rigetta, la pagina non
// deve restare nera e muta. Il messaggio è puro e testato in Node;
// showStartupError è l'unico pezzo che tocca il DOM.

import { GAME_NAME } from './config';

/** Prefisso del messaggio mostrato a schermo, in inglese come il resto dell'interfaccia. */
export const STARTUP_ERROR_PREFIX = `${GAME_NAME} could not start`;

/**
 * Messaggio leggibile da qualunque cosa sia stata lanciata. Un `Error` dà il
 * suo `message`, una stringa se stessa, tutto il resto la sua forma migliore;
 * un motivo vuoto o assente diventa "unknown error", così il messaggio non
 * finisce mai con i due punti e il nulla. Pura, non lancia mai.
 */
export function startupErrorMessage(reason: unknown): string {
  let detail = '';
  if (reason instanceof Error) detail = reason.message;
  else if (typeof reason === 'string') detail = reason;
  else if (reason !== null && reason !== undefined) {
    try {
      detail = String(reason);
    } catch {
      detail = '';
    }
  }
  detail = detail.trim();
  if (detail === '' || detail === '[object Object]') detail = 'unknown error';
  return `${STARTUP_ERROR_PREFIX}: ${detail}`;
}

/** Il minimo del DOM che serve a mostrare l'errore: così il test non ha bisogno di jsdom. */
export interface ErrorHost {
  body: { textContent: string | null; style: { background: string; color: string; font: string } } | null;
}

/**
 * Scrive il messaggio nella pagina. Sostituisce il contenuto del body: a
 * questo punto il gioco non esiste, e un canvas nero sopra il messaggio
 * sarebbe peggio di niente. Non lancia mai: se il body non c'è, resta il
 * console.error.
 */
export function showStartupError(host: ErrorHost, message: string): void {
  const body = host.body;
  if (body === null) return;
  body.textContent = message;
  body.style.background = '#000000';
  body.style.color = '#ff5555';
  body.style.font = '20px monospace';
}
