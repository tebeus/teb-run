// Controlli touch (lancio, punto 14): pulsanti semitrasparenti disegnati sul
// canvas, uno schema per schermata, che producono le stesse `Actions` della
// tastiera. Si fondono con quelle di `createInput` in `main.ts`, quindi le
// schermate non sanno niente del tocco: il pulsante pausa, per esempio,
// manda `pause` come il tasto P, e apre la stessa pausa.
//
// Strato generico e riusabile: per aggiungere un pulsante toccabile a una
// schermata basta una riga in `touchLayout`. Solo le dita (pointerType
// touch o pen) passano di qui: il mouse no, e su un computer senza touch
// niente cambia.
//
// In gara le zone di tocco sono grandi ma invisibili: a schermo ci sono solo
// cerchi scuri col bordo chiaro, leggibili su cielo, sabbia e neve, che
// diventano gialli sotto il dito.

import { LOGICAL_H, LOGICAL_W } from '../core/canvas';
import type { InputDevice } from '../core/device';
import { emptyActions } from '../core/input';
import { toLogical, type LogicalPoint } from '../core/signals';
import type { TiltControl } from '../core/tilt';
import type { Actions } from '../types';
import type { ScreenName } from './fsm';
import { inside, touchRect, type Rect } from './rect';
import {
  MOTION_BLOCKED_LINES,
  MOTION_BLOCKED_SECONDS,
  MOTION_BLOCKED_Y,
  RADIO_BACK_RECT,
  RADIO_CAR_RECT,
  RADIO_MODE_RECT,
  RADIO_TILT_RECT,
  TILT_HINT_LINES,
  TILT_HINT_RIGHT,
  TILT_HINT_Y,
} from './radioTouch';
import { drawTextOutlined, measureText } from './text';

export type ActionName = keyof Actions;

export interface TouchButton {
  id: string;
  rect: Rect;
  /** L'azione che manda; `tilt` accende e spegne lo sterzo con inclinazione. */
  action: ActionName | 'tilt';
  /**
   * `held`: vera finché un dito ci sta sopra (gas, sterzo, frecce del
   * nome); `tap`: vera un tick, alla pressione (conferma, pausa, marcia).
   */
  kind: 'held' | 'tap';
  label?: string;
  icon?: 'left' | 'right' | 'pause' | 'tilt';
  /** Acceso, come un interruttore (TILT ON): pieno e colorato. */
  lit?: boolean;
  /** Solo area di tocco, non disegnata (tocca ovunque per iniziare). */
  hidden?: boolean;
  /** Cerchio discreto al posto del riquadro (la gara): la zona di tocco resta `rect`. */
  mark?: TouchMark;
}

/** Un cerchio centrato in (x, y), largo `size` px logici. */
export interface TouchMark {
  x: number;
  y: number;
  size: number;
}

/** Opzioni che cambiano lo schema: il pulsante TILT e la sua scritta, la misura dello schermo. */
export interface LayoutOptions {
  tiltAvailable: boolean;
  tiltOn: boolean;
  /**
   * Quanti px CSS vale un px logico (letterbox compreso): lo sterzo della
   * gara si misura in px CSS, cioè in millimetri sotto il pollice. Assente vale 1.
   */
  cssPerLogical?: number;
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** Centro del cerchio di sinistra, contro il bordo, e misura dei due cerchi dello sterzo. */
export const STEER_LEFT_X = 95;
export const STEER_MARK_Y = 570;
export const STEER_MARK_SIZE = 84;
/** Spazio fra i due cerchi, in px CSS: circa un pollice (17 mm), da uno all'altro senza allungarsi. */
export const STEER_SPACE_CSS = 64;
/** Fascia morta fra le due zone, in px CSS. */
export const STEER_DEAD_CSS = 24;
/** La zona di destra finisce prima del menu di pausa (da x 440) e dell'auto (da x 500). */
export const STEER_MAX_X = 440;
const STEER_TOP = 430;
const STEER_H = 200;

export interface SteerGeometry {
  left: Rect;
  right: Rect;
  /** La fascia fra le due zone: un tocco lì non fa niente. */
  gap: Rect;
  leftMark: TouchMark;
  rightMark: TouchMark;
}

/**
 * Le due zone dello sterzo, misurate in px CSS (`cssPerLogical`): il
 * cerchio di sinistra contro il bordo, quello di destra a un pollice, e le
 * zone grandi attorno, divise da una fascia morta stretta. Pura.
 */
export function steerGeometry(cssPerLogical = 1): SteerGeometry {
  const k = cssPerLogical > 0 && Number.isFinite(cssPerLogical) ? cssPerLogical : 1;
  const half = STEER_MARK_SIZE / 2;
  const rightX = Math.min(STEER_LEFT_X + STEER_MARK_SIZE + STEER_SPACE_CSS / k, STEER_MAX_X - half - 20);
  const mid = (STEER_LEFT_X + rightX) / 2;
  const dead = Math.min(STEER_DEAD_CSS / k, rightX - STEER_LEFT_X - STEER_MARK_SIZE);
  const leftEnd = mid - dead / 2;
  const rightStart = mid + dead / 2;
  const rightEnd = Math.min(STEER_MAX_X, rightX + (rightX - rightStart));
  return {
    left: r(0, STEER_TOP, leftEnd, STEER_H),
    right: r(rightStart, STEER_TOP, rightEnd - rightStart, STEER_H),
    gap: r(leftEnd, STEER_TOP, dead, STEER_H),
    leftMark: { x: STEER_LEFT_X, y: STEER_MARK_Y, size: STEER_MARK_SIZE },
    rightMark: { x: rightX, y: STEER_MARK_Y, size: STEER_MARK_SIZE },
  };
}

/**
 * Le fasce morte di una schermata: chi ci scivola dentro da una zona
 * `held` continua a tenerla, chi ci appoggia il dito non tiene niente. Pura.
 */
export function deadZones(screen: ScreenName, cssPerLogical = 1): Rect[] {
  return screen === 'race' ? [steerGeometry(cssPerLogical).gap] : [];
}

/**
 * I pulsanti di una schermata, in coordinate logiche. Tutti larghi almeno
 * 80 px logici, cioè 44 px CSS già su un telefono da 700 px di larghezza;
 * la prova del tocco li allarga comunque con `touchRect`. Pura.
 */
export function touchLayout(screen: ScreenName, opts: LayoutOptions): TouchButton[] {
  switch (screen) {
    case 'title':
      // Tocca ovunque per iniziare, tranne la fascia bassa: lì ci sono i
      // link e lo schermo intero, gestiti da `launchUi`.
      return [{ id: 'start', rect: r(0, 0, LOGICAL_W, 630), action: 'confirm', kind: 'tap', hidden: true }];
    case 'radio': {
      const buttons: TouchButton[] = [
        { id: 'back', rect: RADIO_BACK_RECT, action: 'back', kind: 'tap', label: 'BACK' },
        { id: 'prev', rect: r(185, 420, 150, 170), action: 'left', kind: 'held', icon: 'left' },
        { id: 'next', rect: r(890, 420, 150, 170), action: 'right', kind: 'held', icon: 'right' },
        { id: 'start', rect: r(490, 570, 300, 88), action: 'confirm', kind: 'tap', label: 'START' },
        // Auto e modalità: pulsanti con la cornice, che disegna la radio
        // (sa cosa c'è dentro); qui solo le zone di tocco.
        { id: 'car', rect: RADIO_CAR_RECT, action: 'gearToggle', kind: 'tap', hidden: true },
        { id: 'mode', rect: RADIO_MODE_RECT, action: 'modeToggle', kind: 'tap', hidden: true },
      ];
      if (opts.tiltAvailable) {
        buttons.push({
          id: 'tilt',
          rect: RADIO_TILT_RECT,
          action: 'tilt',
          kind: 'tap',
          icon: 'tilt',
          label: opts.tiltOn ? 'TILT ON' : 'TILT OFF',
          lit: opts.tiltOn,
        });
      }
      return buttons;
    }
    case 'race': {
      const steer = steerGeometry(opts.cssPerLogical);
      // Zone grandi, cerchi dentro: sopra la velocità (in basso a sinistra,
      // da y 656) e sopra STAGE (in basso a destra, da y 608), lontani
      // dall'auto (x 500-780). A destra GAS sopra BRAKE in una colonna senza
      // buchi, e GEAR accanto, verso il centro, a metà fra i due. Con TILT
      // acceso sterza il telefono: niente frecce, né cerchi né zone.
      const steering: TouchButton[] = opts.tiltOn
        ? []
        : [
            { id: 'left', rect: steer.left, action: 'left', kind: 'held', icon: 'left', mark: steer.leftMark },
            { id: 'right', rect: steer.right, action: 'right', kind: 'held', icon: 'right', mark: steer.rightMark },
          ];
      return [
        { id: 'pause', rect: r(160, 14, 96, 80), action: 'pause', kind: 'tap', icon: 'pause', mark: { x: 208, y: 54, size: 62 } },
        ...steering,
        { id: 'gas', rect: r(1096, 330, 160, 135), action: 'accelerate', kind: 'held', label: 'GAS', mark: { x: 1176, y: 398, size: 88 } },
        { id: 'brake', rect: r(1096, 465, 160, 135), action: 'brake', kind: 'held', label: 'BRAKE', mark: { x: 1176, y: 532, size: 88 } },
        { id: 'gear', rect: r(940, 400, 156, 130), action: 'gearToggle', kind: 'tap', label: 'GEAR', mark: { x: 1020, y: 465, size: 78 } },
      ];
    }
    case 'nameEntry':
      return [
        { id: 'up', rect: r(370, 520, 160, 100), action: 'accelerate', kind: 'held', label: 'UP' },
        { id: 'down', rect: r(560, 520, 160, 100), action: 'brake', kind: 'held', label: 'DOWN' },
        { id: 'next', rect: r(750, 520, 160, 100), action: 'right', kind: 'held', label: 'NEXT' },
      ];
    case 'gameOver':
    case 'ending':
      return [{ id: 'continue', rect: r(1010, 620, 250, 84), action: 'confirm', kind: 'tap', label: 'CONTINUE' }];
    case 'scores':
      return [{ id: 'skip', rect: r(0, 0, LOGICAL_W, LOGICAL_H), action: 'confirm', kind: 'tap', hidden: true }];
    default:
      return [];
  }
}

/**
 * Il pulsante sotto un punto, o null. Si provano prima quelli disegnati,
 * poi le aree nascoste; ognuno con l'area allargata ad almeno 44 px CSS
 * (`cssPerLogical`: quanti px CSS vale un px logico). Pura.
 */
export function buttonAt(buttons: readonly TouchButton[], p: LogicalPoint, cssPerLogical: number): TouchButton | null {
  const ordered = [...buttons.filter((b) => !b.hidden), ...buttons.filter((b) => b.hidden)];
  for (const b of ordered) {
    // Allargare un pulsante grande non cambia niente; uno piccolo non deve
    // rubare il tocco al vicino: prima il riquadro vero, poi quello allargato.
    if (inside(b.rect, p.x, p.y)) return b;
  }
  for (const b of ordered) {
    if (inside(touchRect(b.rect, cssPerLogical), p.x, p.y)) return b;
  }
  return null;
}

/**
 * Il pulsante `held` che un dito tiene adesso, dato quello che teneva al
 * tick prima (`prev`): quello sotto il dito; nella fascia morta, ancora
 * `prev`; altrove nessuno. Pura.
 */
export function fingerHold(
  buttons: readonly TouchButton[],
  dead: readonly Rect[],
  prev: string | null,
  p: LogicalPoint,
  cssPerLogical: number,
): string | null {
  const b = buttonAt(buttons, p, cssPerLogical);
  if (b !== null) return b.kind === 'held' ? b.id : null;
  return dead.some((d) => inside(d, p.x, p.y)) ? prev : null;
}

/**
 * Le azioni tenute: una per ogni pulsante `held` tenuto da almeno un dito
 * (gli id di `fingerHold`). Più dita, più pulsanti (gas e sterzo insieme). Pura.
 */
export function heldActions(buttons: readonly TouchButton[], holds: Iterable<string | null>): Actions {
  const a = emptyActions();
  for (const id of holds) {
    const b = id === null ? undefined : buttons.find((x) => x.id === id);
    if (b !== undefined && b.kind === 'held' && b.action !== 'tilt') a[b.action] = true;
  }
  return a;
}

const FILL = 'rgba(10,14,40,0.62)';
const FILL_DOWN = 'rgba(255,238,85,0.45)';
const FILL_LIT = '#3ddc84';
const EDGE = 'rgba(255,255,255,0.9)';
const EDGE_DOWN = '#ffee55';

/** Una freccia piena, fatta di rettangoli: verso sinistra (-1) o destra (1). */
function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: -1 | 1, size: number): void {
  const step = 4;
  for (let i = 0; i < size; i += step) {
    const h = (size - i) * 1.4;
    const x = dir === 1 ? cx - size / 2 + i : cx + size / 2 - i - step;
    ctx.fillRect(x, cy - h / 2, step, h);
  }
}

const MARK_FILL = 'rgba(10,14,40,0.5)';
const MARK_EDGE = 'rgba(255,255,255,0.85)';
const MARK_INK = '#101018';

/** Un telefono inclinato, a tratto spesso nel colore corrente: l'icona di TILT. */
function drawPhoneIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, colour: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.45);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 4;
  ctx.strokeRect(-13, -24, 26, 48);
  ctx.fillRect(-4, 15, 8, 4);
  ctx.restore();
}

/** Freccia o II del cerchio, piena, nel colore corrente. */
function drawMarkIcon(ctx: CanvasRenderingContext2D, b: TouchButton, m: TouchMark, dx: number, dy: number): void {
  const x = m.x + dx;
  const y = m.y + dy;
  if (b.icon === 'left' || b.icon === 'right') {
    drawArrow(ctx, x, y, b.icon === 'left' ? -1 : 1, m.size * 0.4);
  } else if (b.icon === 'pause') {
    const bh = m.size * 0.4;
    ctx.fillRect(x - 10, y - bh / 2, 7, bh);
    ctx.fillRect(x + 3, y - bh / 2, 7, bh);
  }
}

/**
 * Un cerchio scuro col bordo chiaro e l'icona o la scritta bianca a
 * contorno scuro; premuto, giallo pieno con l'inchiostro scuro.
 */
function drawMark(ctx: CanvasRenderingContext2D, b: TouchButton, m: TouchMark, on: boolean): void {
  ctx.globalAlpha = on ? 0.9 : 1;
  ctx.fillStyle = on ? EDGE_DOWN : MARK_FILL;
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = on ? EDGE_DOWN : MARK_EDGE;
  ctx.lineWidth = 4;
  ctx.stroke();
  // Contorno scuro dell'icona: la stessa icona spostata di 2 px nei quattro versi.
  if (!on) {
    ctx.fillStyle = MARK_INK;
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) drawMarkIcon(ctx, b, m, dx, dy);
  }
  ctx.fillStyle = on ? MARK_INK : '#ffffff';
  drawMarkIcon(ctx, b, m, 0, 0);
  if (b.label !== undefined) {
    drawTextOutlined(ctx, b.label, m.x, m.y - 7, 2, on ? MARK_INK : '#ffffff', 'center', on ? EDGE_DOWN : MARK_INK);
  }
}

/** I pulsanti di una schermata. `down` sono gli id sotto un dito adesso. */
export function drawTouchButtons(ctx: CanvasRenderingContext2D, buttons: readonly TouchButton[], down: ReadonlySet<string>): void {
  const before = ctx.globalAlpha;
  for (const b of buttons) {
    if (b.hidden) continue;
    const on = down.has(b.id);
    if (b.mark !== undefined) {
      drawMark(ctx, b, b.mark, on);
      continue;
    }
    const { x, y, w, h } = b.rect;
    const lit = b.lit === true && !on;
    ctx.globalAlpha = 1;
    ctx.fillStyle = on ? FILL_DOWN : lit ? FILL_LIT : FILL;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = on ? EDGE_DOWN : EDGE;
    const t = 4;
    ctx.fillRect(x, y, w, t);
    ctx.fillRect(x, y + h - t, w, t);
    ctx.fillRect(x, y, t, h);
    ctx.fillRect(x + w - t, y, t, h);
    ctx.globalAlpha = lit ? 1 : 0.85;
    const ink = on ? EDGE_DOWN : lit ? MARK_INK : '#ffffff';
    ctx.fillStyle = ink;
    // Con l'icona di TILT a sinistra, la scritta sta nel resto del pulsante.
    const iconW = b.icon === 'tilt' ? 64 : 0;
    const cx = x + iconW + (w - iconW) / 2;
    const cy = y + h / 2;
    if (b.icon === 'tilt') {
      drawPhoneIcon(ctx, x + 38, cy, ink);
    } else if (b.icon === 'left' || b.icon === 'right') {
      drawArrow(ctx, cx, cy, b.icon === 'left' ? -1 : 1, Math.min(w, h) * 0.4);
    } else if (b.icon === 'pause') {
      const bh = h * 0.45;
      ctx.fillRect(cx - 14, cy - bh / 2, 9, bh);
      ctx.fillRect(cx + 5, cy - bh / 2, 9, bh);
    }
    if (b.label !== undefined) {
      const scale = measureText(b.label, 3) <= w - iconW - 16 ? 3 : 2;
      drawTextOutlined(ctx, b.label, cx, cy - 4 * scale, scale, ink, 'center', lit ? '#ffffff' : MARK_INK);
    }
  }
  ctx.globalAlpha = before;
}

/** Le scritte di TILT sopra i pulsanti: la spiegazione sulla radio e il permesso negato. */
export interface TouchNotices {
  tiltHint: boolean;
  motionBlocked: boolean;
}

/**
 * La spiegazione di TILT si vede sulla radio, col tocco, finché TILT non è
 * mai stato toccato (e non è già acceso da un'altra volta). Pura.
 */
export function showTiltHint(screen: ScreenName, device: InputDevice, tiltAvailable: boolean, seen: boolean, tiltOn: boolean): boolean {
  return screen === 'radio' && device === 'touch' && tiltAvailable && !seen && !tiltOn;
}

/** Righe su una fascia scura, a scala 3, allineate al centro o a destra di `x`. */
function drawNotice(ctx: CanvasRenderingContext2D, lines: readonly string[], x: number, y: number, align: 'center' | 'right', colour: string): void {
  const w = Math.max(...lines.map((line) => measureText(line, 3))) + 24;
  const left = align === 'center' ? x - w / 2 : x - w + 12;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#0a0e28';
  ctx.fillRect(left, y - 8, w, lines.length * 30 + 10);
  ctx.globalAlpha = 1;
  lines.forEach((line, i) => drawTextOutlined(ctx, line, x, y + i * 30, 3, colour, align));
}

export interface TouchControls {
  /** Le azioni del tocco per questo tick: le `tap` si consumano qui. */
  poll(): Actions;
  /** Quali scritte di TILT si vedono adesso (le disegna `draw`). */
  notices(): TouchNotices;
  /** Da chiamare dopo `app.render`: i pulsanti, solo se si gioca col tocco. */
  draw(ctx: CanvasRenderingContext2D): void;
}

interface CanvasLike extends EventTarget {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

export interface TouchOptions {
  win: EventTarget;
  canvas: CanvasLike;
  screen: () => ScreenName;
  device: () => InputDevice;
  tilt?: TiltControl;
  /** Vero quando i controlli vanno spenti (telefono in verticale). */
  blocked?: () => boolean;
  /** TILT è mai stato toccato (`persist/tilt.ts`)? Finché no, la radio lo spiega. */
  tiltSeen?: { get(): boolean; set(seen: boolean): void };
  /** Orologio in millisecondi, per quanto resta il messaggio del permesso negato. */
  now?: () => number;
}

/** Di quanto (in frazione) deve cambiare la larghezza del canvas perché un `resize` lasci andare le dita. */
export const RESIZE_RELEASE = 0.15;

/** Collega le dita sul canvas ai pulsanti della schermata corrente. */
export function createTouchControls(opts: TouchOptions): TouchControls {
  const { win, canvas, screen, device, tilt, tiltSeen } = opts;
  const now = opts.now ?? (() => performance.now());
  /** Rifiuti del permesso già visti, e fino a quando si mostra l'ultimo. */
  let refusalsSeen = tilt?.refusals ?? 0;
  let blockedUntil = -Infinity;
  /**
   * Dita sul canvas, in px CSS della finestra: il punto logico si ricava a
   * ogni lettura dal riquadro di adesso, così un dito fermo resta giusto
   * anche se il letterbox si sposta (la barra di Safari che compare).
   */
  const fingers = new Map<number, { x: number; y: number }>();
  /** Larghezza del canvas all'ultimo `resize`: un salto grande è un telefono piegato, aperto o ruotato. */
  let lastWidth = canvas.getBoundingClientRect().width;
  /** Il pulsante `held` che ogni dito teneva all'ultimo tick (per la fascia morta). */
  const holds = new Map<number, string | null>();
  /** Azioni `tap` e `held` premute dall'ultimo tick: un colpetto più breve di un tick conta lo stesso. */
  let pressed = emptyActions();
  /** Dove è sceso ogni dito, per il pulsante TILT (vale al rilascio). */
  const downOn = new Map<number, string>();

  const layout = (): TouchButton[] =>
    touchLayout(screen(), {
      tiltAvailable: tilt?.available === true,
      // Ricordata accesa e in attesa del permesso conta già come accesa.
      tiltOn: tilt?.on === true || tilt?.pending === true,
      cssPerLogical: k(),
    });
  const k = (): number => canvas.getBoundingClientRect().width / LOGICAL_W;
  const point = (e: PointerEvent): LogicalPoint | null => toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
  const fingerPoints = (): [number, LogicalPoint | null][] => {
    const rect = canvas.getBoundingClientRect();
    return [...fingers].map(([id, c]) => [id, toLogical(c.x, c.y, rect)]);
  };
  const releaseAll = (): void => {
    fingers.clear();
    holds.clear();
    downOn.clear();
    pressed = emptyActions();
  };
  const isFinger = (e: PointerEvent): boolean => e.pointerType === 'touch' || e.pointerType === 'pen';
  const isBlocked = (): boolean => opts.blocked?.() === true;

  canvas.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (!isFinger(e)) return;
    const p = point(e);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (p === null || isBlocked()) return;
    const b = buttonAt(layout(), p, k());
    if (b === null) return;
    downOn.set(e.pointerId, b.id);
    if (b.action !== 'tilt') pressed[b.action] = true;
  });
  canvas.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const lift = (ev: Event): void => {
    const e = ev as PointerEvent;
    const startedOn = downOn.get(e.pointerId);
    fingers.delete(e.pointerId);
    holds.delete(e.pointerId);
    downOn.delete(e.pointerId);
    // TILT al rilascio: su iOS il permesso dei sensori vuole un gesto
    // completo, e `pointerdown` di un dito non lo è.
    if (ev.type !== 'pointerup' || tilt === undefined || isBlocked()) return;
    const p = point(e);
    if (startedOn === 'tilt' && p !== null && buttonAt(layout(), p, k())?.id === 'tilt') {
      tilt.toggle();
      tiltSeen?.set(true);
      return;
    }
    // TILT ricordato acceso dopo il ricaricamento: su iOS il permesso si
    // chiede di nuovo, al primo dito che si alza in gara o sulla radio.
    const where = screen();
    if (where === 'race' || where === 'radio') tilt.gesture();
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  win.addEventListener('blur', releaseAll);
  // Telefono piegato, aperto o ruotato in gara: lo schermo sotto le dita
  // non è più quello, e il browser non sempre manda `pointercancel`.
  // Si lasciano andare tutte; un dito ancora giù riprende alla prossima
  // pressione. Un salto piccolo (la barra di Safari) non conta.
  win.addEventListener('resize', () => {
    const w = canvas.getBoundingClientRect().width;
    if (!(lastWidth > 0) || Math.abs(w - lastWidth) > lastWidth * RESIZE_RELEASE) releaseAll();
    lastWidth = w;
  });

  const notices = (): TouchNotices => {
    // Un rifiuto nuovo (anche arrivato dopo, con la risposta di iOS) accende il messaggio.
    const refusals = tilt?.refusals ?? 0;
    if (refusals > refusalsSeen) {
      refusalsSeen = refusals;
      blockedUntil = now() + MOTION_BLOCKED_SECONDS * 1000;
    }
    const tiltOn = tilt?.on === true || tilt?.pending === true;
    return {
      tiltHint: showTiltHint(screen(), device(), tilt?.available === true, tiltSeen?.get() === true, tiltOn),
      motionBlocked: device() === 'touch' && now() < blockedUntil,
    };
  };

  return {
    poll() {
      const out = pressed;
      pressed = emptyActions();
      if (isBlocked()) return emptyActions();
      const buttons = layout();
      const kk = k();
      const dead = deadZones(screen(), kk);
      for (const [id, p] of fingerPoints()) holds.set(id, p === null ? null : fingerHold(buttons, dead, holds.get(id) ?? null, p, kk));
      const held = heldActions(buttons, holds.values());
      for (const name of Object.keys(held) as ActionName[]) if (held[name]) out[name] = true;
      if (screen() === 'race' && tilt !== undefined) {
        const s = tilt.steer();
        if (s < 0) out.left = true;
        if (s > 0) out.right = true;
      }
      return out;
    },
    notices,
    draw(ctx) {
      if (device() !== 'touch' || isBlocked()) return;
      const buttons = layout();
      const kk = k();
      const down = new Set<string>();
      for (const [id, p] of fingerPoints()) {
        if (p === null) continue;
        // Nella fascia morta resta acceso il pulsante che il dito tiene ancora.
        const held = holds.get(id) ?? buttonAt(buttons, p, kk)?.id;
        if (held !== undefined && held !== null) down.add(held);
      }
      drawTouchButtons(ctx, buttons, down);
      const shown = notices();
      const before = ctx.globalAlpha;
      if (shown.tiltHint) drawNotice(ctx, TILT_HINT_LINES, TILT_HINT_RIGHT, TILT_HINT_Y, 'right', '#ffffff');
      if (shown.motionBlocked) drawNotice(ctx, MOTION_BLOCKED_LINES, LOGICAL_W / 2, MOTION_BLOCKED_Y, 'center', '#ff8a7a');
      ctx.globalAlpha = before;
    },
  };
}
