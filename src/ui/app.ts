import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import { createFsm, type Fsm, type Screen, type ScreenName } from './fsm';
import type { ScreenDeps } from './deps';
import { createEndingScreen } from './screens/ending';
import { createGameOverScreen } from './screens/gameOver';
import { createNameEntryScreen } from './screens/nameEntry';
import { createRaceScreen } from './screens/race';
import { createRadioScreen } from './screens/radio';
import { createScoresScreen } from './screens/scores';
import { createTitleScreen } from './screens/title';
import { createWipe } from './transition';

/**
 * Costruisce tutte le schermate del gioco e la macchina a stati, a partire
 * dal titolo. `createFsm.render` (frozen, ui/fsm.ts) chiama solo
 * `screens[current].render(ctx)` e non pulisce mai il frame da solo: senza
 * questo, i pixel dell'ultima schermata restano sul canvas finché la
 * successiva non li ricopre per intero, ed è esattamente il difetto per cui
 * il titolo di "TEB RUN" restava visibile sopra la radio. Si avvolge
 * `render` qui, non in fsm.ts (frozen), così ogni schermata futura (binari E
 * ed F) eredita la garanzia senza doverci pensare.
 */
export function createApp(deps: ScreenDeps): Fsm {
  const screens: Record<ScreenName, Screen> = {
    title: createTitleScreen(deps),
    radio: createRadioScreen(deps),
    race: createRaceScreen(deps),
    ending: createEndingScreen(deps),
    gameOver: createGameOverScreen(deps),
    nameEntry: createNameEntryScreen(deps),
    scores: createScoresScreen(deps),
  };
  const fsm = createFsm(screens, 'title');
  // Tendina fra schermate (spec §11). Vive qui e non in `ui/fsm.ts`, che è
  // il contratto fra i binari: `app` è l'unico che vede il nome cambiare.
  const wipe = createWipe();
  let shown: ScreenName = fsm.name;
  return {
    get name() {
      return fsm.name;
    },
    update(dt, actions) {
      // Una volta sola qui, prima di delegare alla schermata corrente: così
      // M funziona su tutte le sette schermate, non solo in gara. Prima
      // dell'ondata di fix finale del binario G, solo race.ts guardava
      // actions.mute, e tornare al titolo lasciava la musica della gara a
      // suonare senza modo di zittirla.
      if (actions.mute && deps.audio.available) deps.audio.toggleMute();
      fsm.update(dt, actions);
      if (fsm.name !== shown) {
        shown = fsm.name;
        wipe.start();
      }
      wipe.update(dt);
    },
    render(ctx) {
      // Nessuna schermata può lasciare pixel a quella dopo.
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      fsm.render(ctx);
      // Sopra la schermata nuova: la tendina copre il passaggio.
      wipe.draw(ctx, deps.assets, LOGICAL_W, LOGICAL_H);
    },
  };
}
