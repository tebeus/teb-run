// Statistiche senza cookie (lancio, punto 11): GoatCounter, solo nella build
// site. Nessuno script esterno e nessuna copia di count.js: questo modulo
// manda da sé le visite e gli eventi all'endpoint `/count`, con i parametri
// di GoatCounter in query string (`p` percorso o nome dell'evento, `t`
// titolo, `e=true` per un evento, `r` referrer, `rnd` contro la cache).
//
// Niente dati personali: nessun nome della classifica, nessun punteggio,
// nessun id utente, niente localStorage. Gli eventi sono nomi fissi, tutti
// nella tabella `STAT_EVENTS`; al massimo uno per nome per partita. Gli
// errori di rete non arrivano mai al gioco né alla console.

import { indexOf } from '../game/stage-graph';
import type { CarChoice, Difficulty, RaceEngine } from '../types';

/** I nomi degli eventi, in un posto solo. Documentati nel README. */
export const STAT_EVENTS = {
  /** Una partita parte (il via dalla radio, o RESTART dalla pausa). */
  start: (): string => 'game/start',
  /** Tappa raggiunta a un checkpoint (`0-0` è la partenza, non conta). */
  stage: (id: string): string => `stage/${id}`,
  /** Bivio preso: la tappa lasciata e il lato. */
  fork: (fromId: string, side: 'L' | 'R'): string => `fork/${fromId}-${side}`,
  /** Finale raggiunto, 1..5 come "ENDING 3 OF 5". */
  ending: (n: number): string => `ending/${n}`,
  /** Il pulsante SHARE (o il tasto S) a fine partita. */
  share: (): string => 'share',
  /** Modalità della partita. */
  mode: (mode: Difficulty): string => `mode/${mode}`,
  /** Auto della partita. */
  car: (car: CarChoice): string => `car/${car}`,
} as const;

/** Forma di ogni nome ammesso: minuscole, cifre, `-` e al più una `/`; L e R solo per i bivi. */
export const EVENT_NAME = /^[a-z]+(\/[a-z0-9-]+(-[LR])?)?$/;

/** Host da non contare: le prove in locale e in rete privata. Pura. */
export function statsHostExcluded(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (m === null) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/** Un colpo da contare. */
export interface Hit {
  /** Percorso della pagina, o il nome dell'evento. */
  path: string;
  title: string;
  event: boolean;
  /** Solo per la visita: l'origine di chi ci ha mandato, se c'è. */
  referrer?: string;
}

/** L'indirizzo di un colpo verso `endpoint`. Pura. */
export function hitUrl(endpoint: string, hit: Hit, rnd: string): string {
  const q = new URLSearchParams();
  q.set('p', hit.path);
  q.set('t', hit.title);
  if (hit.event) q.set('e', 'true');
  if (hit.referrer) q.set('r', hit.referrer);
  q.set('rnd', rnd);
  return `${endpoint}?${q.toString()}`;
}

/** Solo l'origine del referrer: niente percorso né query, che potrebbero dire troppo. Pura. */
export function referrerOrigin(referrer: string, ownOrigin: string): string {
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin === ownOrigin ? '' : u.origin;
  } catch {
    return '';
  }
}

/** Ciò che serve del browser, iniettabile nei test. */
export interface StatsEnv {
  hostname: string;
  pathname: string;
  origin: string;
  referrer: string;
  title: string;
  /** Manda l'indirizzo, senza mai lanciare. */
  send(url: string): void;
  rnd(): string;
}

export interface Stats {
  /** Vero se manda davvero qualcosa. */
  readonly active: boolean;
  /** La visita alla pagina, una sola volta. */
  pageview(): void;
  /** Una partita nuova: `game/start`, la modalità e l'auto. */
  startGame(mode: Difficulty, car: CarChoice): void;
  /** Un evento della partita in corso; lo stesso nome due volte conta una. */
  event(name: string): void;
}

/** Statistiche spente: nessuna richiesta. */
export const NO_STATS: Stats = {
  active: false,
  pageview: () => undefined,
  startGame: () => undefined,
  event: () => undefined,
};

/** Titolo leggibile di un evento, per l'elenco di GoatCounter. Pura. */
export function eventTitle(name: string): string {
  const [kind, arg] = name.split('/');
  switch (kind) {
    case 'game':
      return 'Game started';
    case 'stage':
      return `Stage ${arg} reached`;
    case 'fork':
      return `Fork ${arg}`;
    case 'ending':
      return `Ending ${arg}`;
    case 'share':
      return 'Result shared';
    case 'mode':
      return `Mode ${arg}`;
    case 'car':
      return `Car ${arg}`;
    default:
      return name;
  }
}

/**
 * Statistiche verso `endpoint`. Con `enabled` falso, o su un host locale o
 * privato, ritorna `NO_STATS`: nessuna richiesta, mai.
 */
export function createStats(enabled: boolean, endpoint: string, env: StatsEnv): Stats {
  if (!enabled || statsHostExcluded(env.hostname)) return NO_STATS;
  let viewed = false;
  let sent = new Set<string>();
  const send = (hit: Hit): void => {
    try {
      env.send(hitUrl(endpoint, hit, env.rnd()));
    } catch {
      // Le statistiche non rompono mai il gioco.
    }
  };
  const event = (name: string): void => {
    if (!EVENT_NAME.test(name) || sent.has(name)) return;
    sent.add(name);
    send({ path: name, title: eventTitle(name), event: true });
  };
  return {
    active: true,
    pageview() {
      if (viewed) return;
      viewed = true;
      const referrer = referrerOrigin(env.referrer, env.origin);
      send({ path: env.pathname || '/', title: env.title, event: false, ...(referrer ? { referrer } : {}) });
    },
    startGame(mode, car) {
      sent = new Set();
      event(STAT_EVENTS.start());
      event(STAT_EVENTS.mode(mode));
      event(STAT_EVENTS.car(car));
    },
    event,
  };
}

/**
 * Invio dal browser: `navigator.sendBeacon` (non aspetta risposta, regge la
 * chiusura della scheda), altrimenti un'immagine. Ogni errore resta qui.
 */
export function beaconSender(win: Window): (url: string) => void {
  return (url) => {
    try {
      if (typeof win.navigator.sendBeacon === 'function' && win.navigator.sendBeacon(url)) return;
    } catch {
      // ripiega sull'immagine
    }
    try {
      const img = win.document.createElement('img');
      img.onerror = () => undefined;
      img.src = url;
    } catch {
      // niente da fare: le statistiche tacciono
    }
  };
}

/** L'ambiente vero del browser. */
export function browserStatsEnv(win: Window): StatsEnv {
  return {
    hostname: win.location.hostname,
    pathname: win.location.pathname,
    origin: win.location.origin,
    referrer: win.document.referrer,
    title: win.document.title,
    send: beaconSender(win),
    rnd: () => Math.random().toString(36).slice(2, 7),
  };
}

/**
 * Il motore di una partita con gli eventi contati: tappa raggiunta e bivio
 * preso a ogni checkpoint, finale all'arrivo. Il motore e i suoi eventi
 * passano intatti; nessun lavoro in più per fotogramma oltre a scorrere gli
 * eventi che il motore ritorna già.
 */
export function trackRace(race: RaceEngine, stats: Stats, startStageId: string): RaceEngine {
  if (!stats.active) return race;
  let current = startStageId;
  return {
    update(dt, actions) {
      const events = race.update(dt, actions);
      for (const e of events) {
        if (e.type === 'checkpoint') {
          const side = indexOf(e.nextStage.id) === indexOf(current) ? 'L' : 'R';
          stats.event(STAT_EVENTS.fork(current, side));
          stats.event(STAT_EVENTS.stage(e.nextStage.id));
          current = e.nextStage.id;
        } else if (e.type === 'finish') {
          stats.event(STAT_EVENTS.ending(e.ending + 1));
        }
      }
      return events;
    },
    snapshot: () => race.snapshot(),
  };
}
