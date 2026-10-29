import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import { modeLabel, modeOf } from '../game/mode';
import { KMH_AT_MAX } from '../game/player';
import { drawTextOutlined, measureText } from '../ui/text';
import type { AssetStore, Banner, RaceSnapshot } from '../types';

/** Cifre del punteggio nell'HUD (spec §11). */
export const SCORE_DIGITS = 7;

/** Punteggio a sette cifre con zeri iniziali, come negli arcade dell'epoca. Pura. */
export function formatScore(score: number): string {
  return Math.max(0, Math.floor(score)).toString().padStart(SCORE_DIGITS, '0');
}

/**
 * Tempo di giro nel formato classico degli arcade, `m'ss"cc` (spec §11). I centesimi
 * sono **troncati**, non arrotondati: 59,999 s resta `0'59"99` e non diventa
 * `0'60"00`. Pura.
 */
export function formatLap(seconds: number): string {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const cs = Math.floor(t * 100);
  const m = Math.floor(cs / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  const cc = cs % 100;
  return `${m}'${ss.toString().padStart(2, '0')}"${cc.toString().padStart(2, '0')}`;
}

/** Frazione di velocità dai km/h dell'HUD (kmh = percent · 293). Pura. */
export function speedPercentOfKmh(kmh: number): number {
  const p = kmh / KMH_AT_MAX;
  if (!Number.isFinite(p)) return 0;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

// Scala dell'acceleratore (spec §11).
export const ACCEL_BARS = 10;
export const BAR_MIN_H = 4;
export const BAR_MAX_H = 22;
export const BAR_W = 8;
export const BAR_GAP = 3;

/** Riga della modalità, sotto il giro: il valore del giro finisce a y 58. */
export const HUD_MODE_Y = 66;
/** NORMAL nel grigio del nome della tappa, HARD in rosso. */
export const HUD_MODE_COLORS = { normal: '#cfd6dd', hard: '#ff5a4a' } as const;

/** Colori dell'HUD, in un posto solo: i test li leggono da qui. */
export const HUD_COLORS = {
  outline: '#101018',
  timeLabel: '#ff9a3c',
  time: '#ffd23f',
  timeCritical: '#ff3333',
  scoreLabel: '#ff66cc',
  score: '#ffffff',
  lapLabel: '#66ff88',
  lap: '#ffffff',
  speed: '#ff3333',
  speedLabel: '#ffffff',
  stage: '#ffd23f',
  stageName: '#cfd6dd',
  gear: '#ffffff',
  barGreen: '#33cc44',
  barYellow: '#ffd23f',
  barRed: '#ff3333',
  barOff: '#333340',
  lampOff: '#3a2020',
  lampRed: '#ff3333',
  lampGreen: '#33cc44',
} as const;

/** Altezza della tacca `i`, da BAR_MIN_H a BAR_MAX_H crescendo a destra. Pura. */
export function barHeight(i: number): number {
  const k = Math.max(0, Math.min(ACCEL_BARS - 1, i));
  return BAR_MIN_H + ((BAR_MAX_H - BAR_MIN_H) * k) / (ACCEL_BARS - 1);
}

/** Quante tacche sono accese: `round(speedPercent · 10)` (spec §11). Pura. */
export function barLit(speedPercent: number): number {
  if (!Number.isFinite(speedPercent)) return 0;
  const p = speedPercent < 0 ? 0 : speedPercent > 1 ? 1 : speedPercent;
  return Math.round(p * ACCEL_BARS);
}

/** Colore della tacca `i` (0-based) con `lit` tacche accese (spec §11). Pura. */
export function barColor(i: number, lit: number): string {
  if (i >= lit) return HUD_COLORS.barOff;
  const n = i + 1;
  if (n <= 6) return HUD_COLORS.barGreen;
  return n <= 8 ? HUD_COLORS.barYellow : HUD_COLORS.barRed;
}

/** Larghezza totale della scala, per allinearla a destra. */
export const ACCEL_SCALE_W = ACCEL_BARS * BAR_W + (ACCEL_BARS - 1) * BAR_GAP;

/** Le dieci tacche, appoggiate a `bottomY`, a partire da `x`. */
export function drawAccelScale(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottomY: number,
  lit: number,
): void {
  for (let i = 0; i < ACCEL_BARS; i++) {
    const h = barHeight(i);
    ctx.fillStyle = barColor(i, lit);
    ctx.fillRect(x + i * (BAR_W + BAR_GAP), bottomY - h, BAR_W, h);
  }
}

/** Secondi interi arrotondati per eccesso, 2 cifre con zero iniziale. Pura. */
export function formatTime(seconds: number): string {
  return Math.max(0, Math.ceil(seconds)).toString().padStart(2, '0');
}

/** km/h arrotondati, 3 cifre con zeri iniziali. Pura. */
export function formatKmh(kmh: number): string {
  return Math.max(0, Math.round(kmh)).toString().padStart(3, '0');
}

/** Tempo critico sotto i 10 secondi: il timer lampeggia in rosso. Pura. */
export function isTimeCritical(timeLeft: number): boolean {
  return timeLeft < 10;
}

/**
 * Fase del lampeggio derivata dal tempo stesso, non da un orologio esterno:
 * deterministica e testabile senza timer reali. Circa 2 Hz.
 */
export function timeBlinkOn(timeLeft: number): boolean {
  return Math.floor(timeLeft * 4) % 2 === 0;
}

/** Righe di testo del banner centrale. Non lancia mai, anche senza forkNames. Pura. */
export function bannerText(banner: Banner, forkNames?: [string, string]): string[] {
  switch (banner) {
    case 'checkpoint':
      // spec §4.4e: il testo classico degli arcade, non la parola CHECKPOINT. I
      // secondi aggiunti li scrive `drawCheckpointBanner` in grande, sotto.
      return ['EXTEND TIME'];
    case 'gameover':
      return ['GAME OVER'];
    case 'fork': {
      const [left, right] = forkNames ?? ['???', '???'];
      return [`< ${left.toUpperCase()}`, `${right.toUpperCase()} >`];
    }
    default:
      return [];
  }
}

/** Riga del cartello prima del bivio (spec prima tappa e ritorno §4). */
export const FORK_AHEAD_TITLE = 'CHOOSE YOUR ROAD';

/**
 * Le righe del cartello prima del bivio: `CHOOSE YOUR ROAD` a scala 4 e i
 * nomi delle due tappe con le frecce a scala 3, o 2 se a 3 non ci stanno
 * (la larghezza logica meno 32 px per lato). Pura.
 */
export function forkAheadLines(forkNames?: [string, string]): { text: string; scale: number }[] {
  const [left, right] = forkNames ?? ['???', '???'];
  const names = `< ${left.toUpperCase()}   ${right.toUpperCase()} >`;
  const scale = measureText(names, 3) <= LOGICAL_W - 64 ? 3 : 2;
  return [
    { text: FORK_AHEAD_TITLE, scale: FORK_TEXT_SCALE },
    { text: names, scale },
  ];
}

/** La riga dopo il commit: `LEFT: <tappa>` o `RIGHT: <tappa>`. Pura. */
export function forkTakenText(side: 'L' | 'R', forkNames?: [string, string]): string {
  const [left, right] = forkNames ?? ['???', '???'];
  return side === 'L' ? `LEFT: ${left.toUpperCase()}` : `RIGHT: ${right.toUpperCase()}`;
}

// Semaforo di partenza (spec §4.4e).
/** Larghezza a schermo della scatola del semaforo. */
export const START_LIGHTS_W = 420;
/** Distanza dal bordo alto: sotto la riga di TIME/SCORE/LAP. */
export const START_LIGHTS_Y = 96;
/** Proporzione di ripiego della scatola, se l'asset non ha misura. */
export const START_LIGHTS_ASPECT = 180 / 520;
/** Lampade della scatola: il PNG ne ha cinque (spec §13). */
export const START_LAMPS = 5;

export type StartLightPhase = 'none' | 'red1' | 'red2' | 'green' | 'go';

/**
 * Fase del semaforo dal `countdown` dello snapshot (spec §4.4e). Un
 * `countdown` assente non è una fase: chi costruisce uno snapshot a mano
 * non disegna nessun semaforo. Pura.
 */
export function startLightPhase(countdown: number | undefined): StartLightPhase {
  if (countdown === undefined || !Number.isFinite(countdown)) return 'none';
  if (countdown > 2) return 'red1';
  if (countdown > 1) return 'red2';
  if (countdown > 0) return 'green';
  return 'go';
}

/**
 * Lampade accese per fase, indici da 0 a 4 sulla scatola a cinque lampade.
 * Tabella a livello di modulo, non letterali ricreati a ogni fotogramma:
 * `litLamps` la resistuisce così com'è (stesso riferimento per la stessa
 * fase), sicura perché `readonly` e mai mutata da chi la chiama.
 */
const LIT_LAMPS_BY_PHASE: Readonly<Record<StartLightPhase, readonly number[]>> = {
  none: [],
  red1: [0],
  red2: [0, 1],
  green: [3, 4],
  go: [3, 4],
};

/** Lampade accese, indici da 0 a 4 sulla scatola a cinque lampade. Pura. */
export function litLamps(phase: StartLightPhase): readonly number[] {
  return LIT_LAMPS_BY_PHASE[phase];
}

/** Disegna una lampada del semaforo di partenza. Fuori da `drawStartLights`: niente closure ricreata a ogni fotogramma. */
function drawStartLamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  i: number,
  fill: string,
): void {
  const r = h * 0.28;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x + w * (0.14 + i * 0.18), y + h * 0.55, r * 0.9, r, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Semaforo di partenza e la scritta READY o GO (spec §4.4e). Il PNG
 * consegnato ha le cinque lampade **già colorate**: disegnargli sopra
 * solo quelle accese non aggiungerebbe contrasto e la fase resterebbe
 * illeggibile. Quindi si spengono prima le lampade che non sono accese
 * in questa fase, e poi si accendono le altre: il PNG è la scatola, il
 * gioco decide le luci (deroga 9 di questo piano). Il ripiego
 * procedurale, che le ha spente, non ne soffre. `get()` non lancia mai;
 * un asset senza misura lascia solo i cerchi, che è comunque leggibile.
 */
export function drawStartLights(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  phase: StartLightPhase,
): void {
  if (phase === 'none') return;
  const asset = assets.get('race_start_lights');
  const w = START_LIGHTS_W;
  const h = asset.w > 0 && asset.h > 0 ? (w * asset.h) / asset.w : w * START_LIGHTS_ASPECT;
  const x = LOGICAL_W / 2 - w / 2;
  const y = START_LIGHTS_Y;
  if (asset.w > 0 && asset.h > 0) ctx.drawImage(asset.image, x, y, w, h);

  const lit = litLamps(phase);
  // Prima si spengono le lampade che il PNG mostra accese.
  for (let i = 0; i < START_LAMPS; i++) if (!lit.includes(i)) drawStartLamp(ctx, x, y, w, h, i, HUD_COLORS.lampOff);
  const red = phase === 'red1' || phase === 'red2';
  for (const i of lit) drawStartLamp(ctx, x, y, w, h, i, red ? HUD_COLORS.lampRed : HUD_COLORS.lampGreen);

  const go = phase === 'go';
  drawTextOutlined(
    ctx,
    go ? 'GO!' : 'READY',
    LOGICAL_W / 2,
    y + h + 18,
    6,
    go ? '#ff5533' : '#66e0ff',
    'center',
    HUD_COLORS.outline,
  );
}

// Striscione del checkpoint e frecce del bivio (spec §4.4e).
/** Larghezza a schermo dello striscione a scacchi. */
export const CHECKPOINT_BANNER_W = 700;
/** Proporzione di ripiego, se l'asset non ha misura. */
export const CHECKPOINT_BANNER_ASPECT = 220 / 900;
/** Quota del blocco del banner centrale. */
export const BANNER_Y = LOGICAL_H / 2 - 60;
/**
 * Quota della prima riga del banner del bivio (bivio v3, collaudo utente):
 * in alto, sotto il punteggio, non più a metà schermo. A metà schermo i nomi
 * delle tappe e le frecce cadevano proprio sull'orizzonte, cioè sulla Y del
 * bivio, e la coprivano per tutta la zona.
 */
export const FORK_BANNER_Y = 130;
/** Larghezza a schermo di una freccia del bivio. */
export const FORK_ARROW_W = 120;
/** Scala del testo del banner del bivio, la stessa di `bannerText` in `renderHud`. */
export const FORK_TEXT_SCALE = 4;
/** Spazio minimo fra il nome della tappa e la freccia più vicina. */
const FORK_ARROW_MARGIN = 24;
/** Spazio minimo fra la freccia e il bordo schermo. */
const FORK_ARROW_SCREEN_MARGIN = 16;

/**
 * Distanza dal centro dello schermo per le frecce del bivio (spec §4.4e,
 * revisione Task 7): `FORK_ARROW_X` fisso a 240 si sovrapponeva al testo del
 * bivio (`bannerText('fork', ...)`, disegnato a scala 4) con i nomi reali
 * più lunghi — es. `< SANDSTONE GATE` (16 caratteri, mezza larghezza 256 px)
 * scavalcava la freccia di 16 px. Misura il testo effettivo, come lo disegna
 * `renderHud`, e lascia `FORK_ARROW_MARGIN` px di margine, senza mai uscire
 * dallo schermo. Pura.
 */
export function forkArrowX(forkNames: [string, string] | undefined, scale: number): number {
  const [left, right] = forkNames ?? ['???', '???'];
  const leftTextHalf = measureText(`< ${left.toUpperCase()}`, scale) / 2;
  const rightTextHalf = measureText(`${right.toUpperCase()} >`, scale) / 2;
  const wanted = Math.max(leftTextHalf, rightTextHalf) + FORK_ARROW_MARGIN;
  const max = LOGICAL_W / 2 - FORK_ARROW_SCREEN_MARGIN - FORK_ARROW_W;
  return Math.min(wanted, max);
}

/**
 * Testo dei secondi aggiunti, o null se non ce ne sono (spec §4.4e). Un
 * `extendTime` assente, non finito o nullo non scrive niente: il banner
 * dice comunque EXTEND TIME. Pura.
 */
export function extendTimeText(extendTime: number | undefined): string | null {
  if (extendTime === undefined || !Number.isFinite(extendTime) || extendTime <= 0) return null;
  return `+${Math.round(extendTime)}`;
}

/**
 * Striscione del checkpoint: il PNG `race_finish_banner` (telaio a
 * scacchi, centro trasparente), EXTEND TIME dentro il telaio e i secondi
 * aggiunti in grande sotto (spec §4.4e). `get()` non lancia mai; un asset
 * senza misura lascia solo le due scritte.
 */
export function drawCheckpointBanner(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  extendTime: number | undefined,
): void {
  const asset = assets.get('race_finish_banner');
  const w = CHECKPOINT_BANNER_W;
  const sized = asset.w > 0 && asset.h > 0;
  const h = sized ? (w * asset.h) / asset.w : w * CHECKPOINT_BANNER_ASPECT;
  const x = LOGICAL_W / 2 - w / 2;
  if (sized) ctx.drawImage(asset.image, x, BANNER_Y, w, h);
  drawTextOutlined(ctx, 'EXTEND TIME', LOGICAL_W / 2, BANNER_Y + h * 0.32, 4, '#ffee55', 'center', HUD_COLORS.outline);
  const plus = extendTimeText(extendTime);
  if (plus !== null) {
    drawTextOutlined(ctx, plus, LOGICAL_W / 2, BANNER_Y + h + 12, 8, '#66ff88', 'center', HUD_COLORS.outline);
  }
}

/**
 * Le due frecce del bivio, ai lati dei nomi delle tappe (spec §4.4e). Il
 * PNG `transition_arrow` punta a destra: quella di sinistra è la stessa
 * immagine specchiata, come i cartelli di curva di §13.
 */
export function drawForkArrows(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  forkNames?: [string, string],
): void {
  const asset = assets.get('transition_arrow');
  if (!(asset.w > 0) || !(asset.h > 0)) return;
  const w = FORK_ARROW_W;
  const h = (w * asset.h) / asset.w;
  // Centrate sulle due righe del banner, come prima a metà schermo
  // (righe a -30 e +10 dal centro, frecce centrate sul centro).
  const y = FORK_BANNER_Y + 30 - h / 2;
  const x = forkArrowX(forkNames, FORK_TEXT_SCALE);
  ctx.drawImage(asset.image, LOGICAL_W / 2 + x, y, w, h);
  ctx.save();
  ctx.translate(LOGICAL_W / 2 - x, y);
  ctx.scale(-1, 1);
  ctx.drawImage(asset.image, 0, 0, w, h);
  ctx.restore();
}

export interface HudOptions {
  showFps?: boolean;
  fps?: number;
  muted?: boolean;
  audioAvailable?: boolean;
  /**
   * Menu di pausa aperto sopra la gara: semaforo, READY/GO e i banner al
   * centro (bivio, EXTEND TIME) non si disegnano, perché cadono proprio
   * dove stanno la scritta PAUSED e i pulsanti. Il resto dell'HUD resta.
   */
  paused?: boolean;
}

/**
 * Testo dell'icona audio nell'angolo: "NO AUDIO" (audio non disponibile,
 * prevale sempre) o "MUTE" (audio disponibile ma silenziato dall'utente), o
 * nessuna icona. Pura.
 */
export function audioIndicatorText(muted: boolean, available: boolean): string | null {
  if (!available) return 'NO AUDIO';
  if (muted) return 'MUTE';
  return null;
}

/**
 * HUD di gara nel layout classico degli arcade (spec §11), sopra il mondo già
 * disegnato. `assets` serve al semaforo di partenza (spec §4.4e); tutto il
 * resto è font a pixel e rettangoli. Non legge mai `snapshot.segments`.
 */
export function renderHud(
  ctx: CanvasRenderingContext2D,
  snapshot: RaceSnapshot,
  assets: AssetStore,
  opts: HudOptions = {},
): void {
  const { timeLeft, score, kmh, player, stage, level, banner, forkNames } = snapshot;

  // Riga in alto: TIME, SCORE, LAP.
  drawTextOutlined(ctx, 'TIME', 24, 14, 2, HUD_COLORS.timeLabel, 'left', HUD_COLORS.outline);
  const critical = isTimeCritical(timeLeft);
  if (!critical || timeBlinkOn(timeLeft)) {
    const colour = critical ? HUD_COLORS.timeCritical : HUD_COLORS.time;
    drawTextOutlined(ctx, formatTime(timeLeft), 24, 34, 5, colour, 'left', HUD_COLORS.outline);
  }

  drawTextOutlined(ctx, 'SCORE', 430, 14, 2, HUD_COLORS.scoreLabel, 'left', HUD_COLORS.outline);
  drawTextOutlined(ctx, formatScore(score), 430, 34, 3, HUD_COLORS.score, 'left', HUD_COLORS.outline);

  drawTextOutlined(ctx, 'LAP', 900, 14, 2, HUD_COLORS.lapLabel, 'left', HUD_COLORS.outline);
  drawTextOutlined(ctx, formatLap(snapshot.elapsed ?? 0), 900, 34, 3, HUD_COLORS.lap, 'left', HUD_COLORS.outline);
  // Modalità della partita, in piccolo sotto il giro (collaudo utente: due
  // livelli di difficoltà).
  const mode = modeOf(stage);
  // La sfida del giorno (traffico del giorno nella tappa): si dice anche in gara.
  const label = stage.trafficSalt === undefined ? modeLabel(mode) : `${modeLabel(mode)} · DAILY`;
  drawTextOutlined(ctx, label, 900, HUD_MODE_Y, 2, HUD_MODE_COLORS[mode], 'left', HUD_COLORS.outline);

  // In basso a sinistra: velocità e km/h.
  const speedY = LOGICAL_H - 64;
  const speedText = formatKmh(kmh);
  drawTextOutlined(ctx, speedText, 24, speedY, 5, HUD_COLORS.speed, 'left', HUD_COLORS.outline);
  drawTextOutlined(
    ctx,
    'KM/H',
    24 + measureText(speedText, 5) + 10,
    speedY + 24,
    2,
    HUD_COLORS.speedLabel,
    'left',
    HUD_COLORS.outline,
  );

  // In basso a destra: nome della tappa, STAGE n, scala, marcia.
  const right = LOGICAL_W - 24;
  drawTextOutlined(ctx, stage.name.toUpperCase(), right, LOGICAL_H - 112, 2, HUD_COLORS.stageName, 'right', HUD_COLORS.outline);
  drawTextOutlined(ctx, `STAGE ${level + 1}`, right, LOGICAL_H - 92, 4, HUD_COLORS.stage, 'right', HUD_COLORS.outline);
  drawAccelScale(ctx, right - ACCEL_SCALE_W, LOGICAL_H - 42, barLit(speedPercentOfKmh(kmh)));
  drawTextOutlined(ctx, player.gear.toUpperCase(), right, LOGICAL_H - 34, 2, HUD_COLORS.gear, 'right', HUD_COLORS.outline);

  const paused = opts.paused ?? false;
  if (paused) {
    // Niente banner al centro sotto il menu di pausa.
  } else if (banner === 'checkpoint') {
    drawCheckpointBanner(ctx, assets, snapshot.extendTime);
  } else if (banner === 'fork' && snapshot.forkTaken !== undefined) {
    // Il lato appena preso, per un attimo (spec prima tappa e ritorno §4).
    const text = forkTakenText(snapshot.forkTaken, forkNames);
    drawTextOutlined(ctx, text, LOGICAL_W / 2, FORK_BANNER_Y, FORK_TEXT_SCALE, '#ffee55', 'center', HUD_COLORS.outline);
  } else if (banner === 'forkAhead') {
    let y = FORK_BANNER_Y;
    for (const line of forkAheadLines(forkNames)) {
      drawTextOutlined(ctx, line.text, LOGICAL_W / 2, y, line.scale, '#ffee55', 'center', HUD_COLORS.outline);
      y += 8 * line.scale + 10;
    }
  } else {
    if (banner === 'fork') drawForkArrows(ctx, assets, forkNames);
    const top = banner === 'fork' ? FORK_BANNER_Y : LOGICAL_H / 2 - 30;
    bannerText(banner, forkNames).forEach((line, i) => {
      drawTextOutlined(
        ctx,
        line,
        LOGICAL_W / 2,
        top + i * 40,
        FORK_TEXT_SCALE,
        '#ffee55',
        'center',
        HUD_COLORS.outline,
      );
    });
  }

  const indicator = audioIndicatorText(opts.muted ?? false, opts.audioAvailable ?? true);
  if (indicator) {
    drawTextOutlined(ctx, indicator, 24, LOGICAL_H - 16, 2, indicator === 'NO AUDIO' ? '#888888' : '#ff6666', 'left', HUD_COLORS.outline);
  }

  // Semaforo di partenza sopra tutto il resto dell'HUD (spec §4.4e).
  // Con la pausa aperta il semaforo resta acceso ma non si vede: riappare
  // com'era a CONTINUE, perché il motore fermo non ha fatto avanzare il conto.
  if (!paused) drawStartLights(ctx, assets, startLightPhase(snapshot.countdown));

  if (opts.showFps) {
    drawTextOutlined(ctx, `${Math.round(opts.fps ?? 0)} FPS`, LOGICAL_W / 2, LOGICAL_H - 16, 2, '#66ff66', 'center', HUD_COLORS.outline);
  }
}
