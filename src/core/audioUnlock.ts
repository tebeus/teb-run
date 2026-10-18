// Sblocco dell'AudioContext (lancio, punto 14). Safari, e iOS in
// particolare, lo fanno partire solo dentro un gesto che "attiva" la
// pagina: un tasto, un clic, oppure il **rilascio** di un dito
// (`touchend`, `pointerup`). Il `pointerdown` di un dito non basta: se lo
// sblocco si fermasse lì, come faceva prima, su iPhone il gioco resterebbe
// muto.
//
// Si prova a **ogni** gesto, per sempre, non solo fino al primo che attiva:
// iOS sospende il contesto anche dopo (una chiamata, Siri, Safari in
// background, il telefono bloccato) e lo lascia `suspended` o `interrupted`
// finché un gesto non chiama di nuovo resume(). Non basta
// `visibilitychange`, che non è un gesto (requisiti di CrazyGames). Con il
// contesto che gira unlock() non fa niente (è idempotente), quindi un
// gesto in più costa poco.

/** Eventi su cui si prova lo sblocco. */
export const UNLOCK_EVENTS = ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'] as const;

/** Collega lo sblocco ai gesti della finestra. */
export function installAudioUnlock(win: EventTarget, unlock: () => void): void {
  for (const name of UNLOCK_EVENTS) win.addEventListener(name, () => unlock());
}
