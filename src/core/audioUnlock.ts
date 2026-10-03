// Sblocco dell'AudioContext (lancio, punto 14). Safari, e iOS in
// particolare, lo fanno partire solo dentro un gesto che "attiva" la
// pagina: un tasto, un clic, oppure il **rilascio** di un dito
// (`touchend`, `pointerup`). Il `pointerdown` di un dito non basta: se lo
// sblocco si fermasse lì, come faceva prima, su iPhone il gioco resterebbe
// muto. Si prova a ogni gesto finché non ne arriva uno che attiva, poi i
// gestori si tolgono (unlock() è comunque idempotente).

/** Eventi su cui si prova lo sblocco. */
export const UNLOCK_EVENTS = ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'] as const;

/** Questo evento attiva la pagina, quindi lo sblocco è riuscito o non riuscirà mai? Pura. */
export function activatesAudio(event: { type: string; pointerType?: string }): boolean {
  if (event.type === 'pointerdown') return event.pointerType === 'mouse';
  return (UNLOCK_EVENTS as readonly string[]).includes(event.type);
}

/** Collega lo sblocco ai gesti della finestra. */
export function installAudioUnlock(win: EventTarget, unlock: () => void): void {
  const handler = (ev: Event): void => {
    unlock();
    if (!activatesAudio(ev as Event & { pointerType?: string })) return;
    for (const name of UNLOCK_EVENTS) win.removeEventListener(name, handler);
  };
  for (const name of UNLOCK_EVENTS) win.addEventListener(name, handler);
}
