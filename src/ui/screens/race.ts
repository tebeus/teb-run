import { createParticles, playerSegment } from '../../render/effects';
import { renderHud } from '../../render/hud';
import { createSkidTrail } from '../../render/skid';
import { createFlock } from '../../render/wildlife';
import { DOMINANT_MIX, surfaceBlendOf } from '../../game/surface';
import type { Gear, RaceEngine, RaceEvent, RaceSnapshot, SfxName } from '../../types';
import type { ScreenDeps } from '../deps';
import { go, type Screen, type ScreenPayloads, type Transition } from '../fsm';
import { drawRaceHint, raceHintAlpha } from '../controlsHelp';
import { closedPause, drawPause, openPause, stepPause, wantsPause, type PauseState } from '../pause';
import { drawTextOutlined } from '../text';
import { LOGICAL_H, LOGICAL_W } from '../../core/canvas';
import { stagedOf } from '../../core/assets';
import { successorIds } from '../../core/phases';
import { STAGES } from '../../game/stages';

/** Il payload di ingresso in gara: valida `song`, con 0 come default sicuro. Pura. */
export function parseRacePayload(payload: unknown): ScreenPayloads['race'] {
  const p = payload as Partial<ScreenPayloads['race']> | undefined;
  const song = p?.song;
  return { song: typeof song === 'number' && Number.isInteger(song) && song >= 0 ? song : 0 };
}

/**
 * Interpreta gli eventi discreti di un tick: quali suoni far partire e a
 * quale schermata passare. Il banner in gara non è deciso qui: viene letto
 * da `snapshot.banner`/`.forkNames`. `finish`/`gameover` portano la
 * `StageDef` intera nel payload della schermata successiva (spec di
 * `ScreenPayloads`); `finish` la prende dallo snapshot corrente (l'evento
 * non la porta), `gameover` da quella già presente nell'evento. Pura.
 */
export function handleRaceEvents(
  events: RaceEvent[],
  snapshot: RaceSnapshot,
): { transition: Transition | null; sfx: SfxName[] } {
  const sfx: SfxName[] = [];
  let transition: Transition | null = null;

  for (const ev of events) {
    switch (ev.type) {
      case 'checkpoint':
        sfx.push('checkpoint');
        break;
      case 'crash':
        sfx.push('crash');
        break;
      case 'bump':
        sfx.push('bump');
        break;
      case 'finish':
        // snapshot.route è l'array vivo del motore: si copia qui, al confine,
        // perché il payload lo attraversa per più schermate (fino a 30s in
        // nameEntry) e il motore potrebbe continuare a scriverci. Vince la
        // prima transizione del tick, non l'ultima: se un motore emettesse
        // sia 'finish' che 'gameover' nello stesso tick, l'esito deciso per
        // primo è quello che conta.
        if (!transition) {
          transition = go('ending', {
            score: ev.score,
            ending: ev.ending,
            stage: snapshot.stage,
            route: [...snapshot.route],
            time: snapshot.elapsed,
          });
        }
        break;
      case 'gameover':
        if (!transition) {
          transition = go('gameOver', {
            score: ev.score,
            stage: ev.stage,
            route: [...snapshot.route],
            time: snapshot.elapsed,
          });
        }
        break;
      case 'countdown':
        // spec §4.4e: una fase del semaforo, un blip.
        sfx.push('blip');
        break;
      case 'fork':
      case 'overtake':
        break;
    }
  }

  return { transition, sfx };
}

/** `speedPercent` non è nello snapshot: si ricava da kmh = speedPercent * 293 (spec §5). Pura. */
export function engineParams(snapshot: RaceSnapshot): { speedPercent: number; gear: Gear; running: boolean } {
  const speedPercent = Math.max(0, Math.min(1, snapshot.kmh / 293));
  const running = !snapshot.crash.active && snapshot.timeLeft > 0;
  return { speedPercent, gear: snapshot.player.gear, running };
}

/** Derapata udibile: sterzo a fondo scala e velocità sopra il 60% (spec §10). Pura. */
/**
 * Derapata udibile: la decide la fisica (spec §5.1), non la schermata. Resta
 * una funzione perché il tick e i test la chiamano per nome. Pura.
 */
export function isSkidding(snapshot: RaceSnapshot): boolean {
  return snapshot.player.skidding;
}

/**
 * Livello della pioggia (spec §10, §4.4f): piena sulle due tappe che
 * piovono mentre si gara, zero altrove e zero in incidente o a tempo
 * scaduto, dove tutto il resto dell'audio tace già. La dissolvenza la
 * fa `setRain`, non questa funzione. Pura.
 */
export function rainLevelFor(snapshot: RaceSnapshot): number {
  if ((snapshot.stage.weather ?? 'clear') !== 'rain') return 0;
  return snapshot.crash.active || snapshot.timeLeft <= 0 ? 0 : 1;
}

/**
 * Se il fruscio di sterrato va acceso (spec §10, §4.4f): fuori
 * dall'asfalto come da sempre, **oppure** su una strada di terra
 * battuta, dove il fruscio c'è anche restando in carreggiata. Pura.
 */
export function rumbleFor(snapshot: RaceSnapshot, speedPercent: number): boolean {
  if (!(speedPercent > 0.1)) return false;
  if (snapshot.player.surface !== 'road') return true;
  const seg = playerSegment(snapshot);
  if (seg === null) return false;
  const blend = surfaceBlendOf(seg, snapshot.stage.weather ?? 'clear');
  return blend.kind === 'dirt' && blend.mix >= DOMINANT_MIX;
}

/**
 * Quanto aspetta al più, in secondi, una tappa che parte prima che i suoi
 * sprite siano arrivati dal background (lancio, punto 12): poi si guida
 * comunque, con i ripieghi procedurali al posto di ciò che manca.
 */
export const STAGE_WAIT_S = 3;

/**
 * Chiede allo store la tappa `stage` con l'auto `car` e, in testa alla
 * coda dopo di lei, le due del bivio successivo. Vero se i file della
 * tappa sono già tutti risolti (o se lo store non va a fasi).
 */
export function stageAssetsSettled(assets: ScreenDeps['assets'], stage: { id: string; theme: string }, car: string): boolean {
  const staged = stagedOf(assets);
  if (staged === null) return true;
  const settled = staged.requestStage({ id: stage.id, theme: stage.theme }, car);
  if (settled) {
    for (const id of successorIds(stage.id)) {
      const next = STAGES.get(id);
      if (next) staged.requestStage({ id: next.id, theme: next.theme }, car);
    }
  }
  return settled;
}

/** Scritta sopra la strada ferma mentre si aspettano gli sprite della tappa. */
function drawStageWait(ctx: CanvasRenderingContext2D): void {
  drawTextOutlined(ctx, 'LOADING', LOGICAL_W / 2, LOGICAL_H / 2 - 120, 4, '#ffee55', 'center');
}

export function createRaceScreen(deps: ScreenDeps): Screen {
  let engine: RaceEngine | null = null;
  // Caricamento a fasi: l'ultima tappa di cui gli sprite sono stati
  // aspettati (o si è smesso di aspettarli), e da quanto si aspetta.
  let checkedStage: string | null = null;
  let waitT = 0;
  let waiting = false;
  // Uno snapshot per tick, preso in update() e riusato in render(): su
  // main, snapshot() del motore vero cammina i segmenti visibili e scrive
  // il loro clip, quindi chiamarlo due volte per frame raddoppia il lavoro
  // di progezione e muta due volte i segmenti vivi condivisi.
  let snapshot: RaceSnapshot | null = null;
  // Un campo per schermata: allocato una volta, svuotato a ogni ingresso.
  const particles = createParticles();
  // Una striscia per schermata: allocata una volta, svuotata a ogni ingresso.
  const trail = createSkidTrail();
  const birds = createFlock();
  // Pausa (lancio, punto 5): con il menu aperto il motore non riceve
  // nessun tick, quindi tempo, semaforo, checkpoint e transizioni restano
  // dove sono, e il dt di quei tick va perso invece di accumularsi.
  let pause: PauseState = closedPause();
  let song = 0;
  // Suggerimento dei comandi (lancio, punto 7): solo nella prima gara della
  // sessione, per i primi secondi, fermo con la pausa. null = spento.
  let hintT: number | null = null;
  let hintShown = false;

  /** Motore, derapata, sterrato, pioggia e musica: tutto zitto. */
  const silence = (): void => {
    deps.audio.setEngine(0, 'lo', false);
    deps.audio.setSkid(false);
    deps.audio.setRumble(false, 0);
    deps.audio.setRain?.(0);
    deps.audio.stopAll?.();
    deps.audio.stopSong();
  };

  return {
    enter(payload) {
      ({ song } = parseRacePayload(payload));
      engine = deps.raceFactory(deps.firstStage, deps.assets);
      snapshot = null;
      checkedStage = null;
      waitT = 0;
      waiting = false;
      particles.clear();
      trail.clear();
      pause = closedPause();
      hintT = hintShown ? null : 0;
      hintShown = true;
      // Un tocco o una perdita di fuoco arrivati prima della gara (titolo,
      // radio) non devono aprire la pausa al primo tick.
      deps.signals?.takeTap();
      deps.signals?.takeFocusLost();
      deps.audio.playSong(song);
    },
    update(dt, actions) {
      if (!engine) return null;
      const tap = deps.signals?.takeTap() ?? null;
      const focusLost = deps.signals?.takeFocusLost() ?? false;
      if (pause.open) {
        const r = stepPause(pause, actions, tap);
        pause = r.state;
        if (r.choice === 'continue') {
          pause = closedPause();
          // Il dt di questo tick si scarta: il motore riparte al tick dopo.
          // La musica riprende da dove era, non dall'inizio del brano.
          deps.audio.playSong(song, { resume: true });
        } else if (r.choice === 'restart') {
          // Stessa schermata: la macchina a stati chiama exit() e poi
          // enter(), che ricostruisce il motore dalla prima tappa con
          // l'auto e la modalità di adesso (la radio non è passata).
          return go('race', { song });
        } else if (r.choice === 'title') {
          // exit() ferma motore e musica (stopAll, stopSong).
          return go('title', undefined);
        }
        return null;
      }
      if (wantsPause(actions) || focusLost) {
        pause = openPause(actions);
        // Se la pausa arriva al primo tick, render() ha comunque una gara
        // da disegnare sotto il menu.
        snapshot ??= engine.snapshot();
        silence();
        return null;
      }
      // Una tappa nuova (la prima, o quella dopo un checkpoint) aspetta i
      // suoi sprite al più STAGE_WAIT_S secondi, a motore fermo: tempo,
      // semaforo e transizione restano dove sono, come in pausa.
      // Solo con uno store a fasi: al primo tick serve uno snapshot in più.
      if (stagedOf(deps.assets) !== null) snapshot ??= engine.snapshot();
      const stage = snapshot?.stage;
      if (stage !== undefined && stage.id !== checkedStage) {
        const settled = stageAssetsSettled(deps.assets, stage, deps.car?.get() ?? 'new');
        if (!settled && waitT < STAGE_WAIT_S) {
          waitT += dt;
          waiting = true;
          return null;
        }
        checkedStage = stage.id;
        waitT = 0;
        waiting = false;
      }
      if (hintT !== null) hintT += dt;
      const events = engine.update(dt, actions);
      snapshot = engine.snapshot();
      particles.update(dt, snapshot, deps.car?.get());
      trail.update(dt, snapshot);
      birds.update(dt, snapshot);

      const { transition, sfx } = handleRaceEvents(events, snapshot);
      for (const name of sfx) deps.audio.sfx(name);
      // Lo scoppio dell'incidente non si ricava dallo snapshot, che dice
      // solo che l'incidente è in corso: lo fa partire l'evento (spec §4.4b).
      if (events.some((ev) => ev.type === 'crash')) particles.burst('crash');

      const { speedPercent, gear, running } = engineParams(snapshot);
      deps.audio.setEngine(speedPercent, gear, running);
      deps.audio.setSkid(isSkidding(snapshot));
      // Sterrato: fuori dall'asfalto, o su una strada di terra, e in
      // movimento (spec §10, §4.4f). Il taglio del filtro sale con la
      // velocità.
      deps.audio.setRumble(rumbleFor(snapshot, speedPercent), speedPercent);
      // Pioggia: il meteo della tappa (spec §4.4f). Chiamata opzionale:
      // i bus finti e `null-audio.ts` non la implementano.
      deps.audio.setRain?.(rainLevelFor(snapshot));

      // actions.mute è gestito una volta per tutte in ui/app.ts, prima di
      // delegare alla schermata corrente: qui non va toccato, o M
      // silenzierebbe due volte in un solo tick di gara.
      return transition;
    },
    render(ctx) {
      if (!engine || !snapshot) return;
      deps.renderWorld(ctx, snapshot, deps.assets, particles, { trail, birds, car: deps.car?.get() });
      renderHud(ctx, snapshot, deps.assets, {
        muted: deps.audio.muted,
        audioAvailable: deps.audio.available,
        paused: pause.open,
      });
      const device = deps.device?.() ?? 'keyboard';
      if (waiting && !pause.open) drawStageWait(ctx);
      // Con il menu aperto il suggerimento dei comandi, come il semaforo
      // nell'HUD, non si disegna: cadrebbe sotto i pulsanti. Il suo tempo è
      // fermo, quindi a CONTINUE riappare dov'era.
      if (pause.open) drawPause(ctx, pause, device);
      else if (hintT !== null) drawRaceHint(ctx, device, raceHintAlpha(hintT), deps.tiltOn?.() === true);
    },
    exit() {
      deps.audio.setEngine(0, 'lo', false);
      deps.audio.setSkid(false);
      deps.audio.setRumble(false, 0);
      deps.audio.setRain?.(0);
      deps.audio.stopAll?.();
      // Senza questa chiamata un brano personale (`<audio loop>`) continua a
      // girare a ciclo su game over, classifica e titolo (Minor 1 della
      // revisione finale): stopSong è l'unico modo per fermarlo.
      deps.audio.stopSong();
      engine = null;
      snapshot = null;
      pause = closedPause();
      particles.clear();
      trail.clear();
    },
  };
}
