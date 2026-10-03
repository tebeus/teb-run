// Schermo intero, con le varianti `webkit` di Safari (desktop e iPad; su
// iPhone Safari non concede lo schermo intero a un elemento che non sia un
// video, e allora il pulsante non si mostra). requestFullscreen vuole un
// gesto dell'utente: la si chiama solo da un handler di tasto o di clic.

/** Il documento come lo vede questo modulo: standard più `webkit`. */
export interface FullscreenDoc {
  fullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

/** L'elemento da portare a schermo intero, standard più `webkit`. */
export interface FullscreenTarget {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => void;
}

/** Eventi che dicono che lo schermo intero è cambiato (entrata, uscita con Esc). */
export const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

/** Il browser concede lo schermo intero a un elemento? */
export function canFullscreen(doc: FullscreenDoc, el: FullscreenTarget): boolean {
  const enabled = doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
  return enabled && (typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function');
}

/** Vero se qualcosa è a schermo intero adesso. */
export function isFullscreen(doc: FullscreenDoc): boolean {
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
}

/**
 * Entra nello schermo intero, o ne esce se c'è già. Non lancia mai: un
 * rifiuto del browser (permessi, iframe senza `allowfullscreen`) lascia le
 * cose come stanno.
 */
export function toggleFullscreen(doc: FullscreenDoc, el: FullscreenTarget): void {
  try {
    if (isFullscreen(doc)) {
      if (typeof doc.exitFullscreen === 'function') void doc.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    } else {
      el.webkitRequestFullscreen?.();
    }
  } catch {
    // Browser che lancia invece di rigettare: nessun effetto.
  }
}
