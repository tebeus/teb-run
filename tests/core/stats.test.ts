// Statistiche senza cookie (lancio, punto 11): nomi degli eventi, host
// esclusi, indirizzo dei colpi, un evento per nome per partita, e il motore
// di gara osservato senza cambiarlo.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { STATS_ENABLED, STATS_ENDPOINT } from '../../src/core/config';
import {
  EVENT_NAME,
  NO_STATS,
  STAT_EVENTS,
  createStats,
  eventTitle,
  hitUrl,
  referrerOrigin,
  statsHostExcluded,
  trackRace,
  type StatsEnv,
} from '../../src/core/stats';
import { FEATURES, STATS_BUILD, featuresOf } from '../../src/core/target';
import { STAGES } from '../../src/game/stages';
import type { RaceEngine, RaceEvent, RaceSnapshot, StageDef } from '../../src/types';

const env = (over: Partial<StatsEnv> = {}): StatsEnv & { sent: string[] } => {
  const sent: string[] = [];
  return {
    hostname: 'play.tebrun.io',
    pathname: '/',
    origin: 'https://play.tebrun.io',
    referrer: '',
    title: 'TEB RUN',
    send: (url) => sent.push(url),
    rnd: () => 'abcde',
    ...over,
    sent,
  };
};
const params = (url: string): Record<string, string> => Object.fromEntries(new URL(url).searchParams);

describe('the event table', () => {
  test('every name is short, stable and matches the documented form', () => {
    const names = [
      STAT_EVENTS.start(),
      STAT_EVENTS.share(),
      STAT_EVENTS.mode('normal'),
      STAT_EVENTS.mode('hard'),
      ...(['new', 'classic', 'retro', 'sport', 'super'] as const).map((c) => STAT_EVENTS.car(c)),
      ...[1, 2, 3, 4, 5].map((n) => STAT_EVENTS.ending(n)),
      ...[...STAGES.keys()].map((id) => STAT_EVENTS.stage(id)),
      ...[...STAGES.keys()].flatMap((id) => [STAT_EVENTS.fork(id, 'L'), STAT_EVENTS.fork(id, 'R')]),
      STAT_EVENTS.dailyStart(),
      STAT_EVENTS.dailyEnd(),
    ];
    for (const n of names) {
      expect(n, n).toMatch(EVENT_NAME);
      expect(n.length, n).toBeLessThanOrEqual(16);
    }
    expect(STAT_EVENTS.start()).toBe('game/start');
    expect(STAT_EVENTS.stage('2-1')).toBe('stage/2-1');
    expect(STAT_EVENTS.fork('0-0', 'L')).toBe('fork/0-0-L');
    expect(STAT_EVENTS.ending(3)).toBe('ending/3');
    expect(STAT_EVENTS.share()).toBe('share');
    expect(STAT_EVENTS.mode('hard')).toBe('mode/hard');
    expect(STAT_EVENTS.car('sport')).toBe('car/sport');
  });

  test('anything that is not a table name is refused', () => {
    for (const bad of ['', 'Game/Start', 'name/AAA', 'a/b/c', 'x?y', 'car/new&e=1', 'stage/1 0', 'https://x']) {
      expect(EVENT_NAME.test(bad), bad).toBe(false);
    }
  });

  test('titles are readable and carry nothing but the name', () => {
    expect(eventTitle('game/start')).toBe('Game started');
    expect(eventTitle('stage/2-1')).toBe('Stage 2-1 reached');
    expect(eventTitle('fork/0-0-L')).toBe('Fork 0-0-L');
    expect(eventTitle('ending/3')).toBe('Ending 3');
    expect(eventTitle('share')).toBe('Result shared');
    expect(eventTitle('mode/normal')).toBe('Mode normal');
    expect(eventTitle('car/new')).toBe('Car new');
  });

  test('the README documents every kind of event', () => {
    const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');
    for (const n of ['game/start', 'stage/', 'fork/', 'ending/', '`share`', 'mode/', 'car/']) expect(readme, n).toContain(n);
  });
});

describe('hosts that never count', () => {
  test('localhost, loopback and private networks', () => {
    for (const h of ['localhost', 'LOCALHOST', 'a.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '0.0.0.0',
      '10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.255', '169.254.1.1', 'mac.local', '', '[fd12:3456::1]']) {
      expect(statsHostExcluded(h), h).toBe(true);
    }
  });

  test('public hosts count', () => {
    for (const h of ['play.tebrun.io', 'tebrun.io', '172.15.0.1', '172.32.0.1', '8.8.8.8', '192.169.0.1', 'example.com']) {
      expect(statsHostExcluded(h), h).toBe(false);
    }
  });
});

describe('the hit URL', () => {
  test('a page view: path, title, origin of the referrer, rnd; no e', () => {
    const url = hitUrl(STATS_ENDPOINT, { path: '/', title: 'TEB RUN', event: false, referrer: 'https://tebrun.io' }, 'x1y2z');
    expect(url.startsWith('https://tebrun.goatcounter.com/count?')).toBe(true);
    expect(params(url)).toEqual({ p: '/', t: 'TEB RUN', r: 'https://tebrun.io', rnd: 'x1y2z' });
  });

  test('an event: e=true, the name as path', () => {
    expect(params(hitUrl(STATS_ENDPOINT, { path: 'fork/0-0-L', title: 'Fork 0-0-L', event: true }, 'r'))).toEqual({
      p: 'fork/0-0-L',
      t: 'Fork 0-0-L',
      e: 'true',
      rnd: 'r',
    });
  });

  test('the referrer keeps only another origin', () => {
    expect(referrerOrigin('https://tebrun.io/play/?x=1#y', 'https://play.tebrun.io')).toBe('https://tebrun.io');
    expect(referrerOrigin('https://play.tebrun.io/', 'https://play.tebrun.io')).toBe('');
    expect(referrerOrigin('', 'https://play.tebrun.io')).toBe('');
    expect(referrerOrigin('javascript:alert(1)', 'https://play.tebrun.io')).toBe('');
  });
});

describe('createStats', () => {
  test('off by switch, or on a local host: no stats object sends anything', () => {
    const a = env();
    const off = createStats(false, STATS_ENDPOINT, a);
    expect(off).toBe(NO_STATS);
    const b = env({ hostname: 'localhost' });
    const local = createStats(true, STATS_ENDPOINT, b);
    for (const s of [off, local]) {
      s.pageview();
      s.startGame('normal', 'new');
      s.event('share');
    }
    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([]);
  });

  test('one page view, then per game start/mode/car and each event at most once', () => {
    const e = env({ referrer: 'https://tebrun.io/' });
    const s = createStats(true, STATS_ENDPOINT, e);
    s.pageview();
    s.pageview();
    s.startGame('hard', 'retro');
    s.event('share');
    s.event('share');
    s.event('stage/1-0');
    s.startGame('normal', 'new');
    s.event('share');
    const paths = e.sent.map((u) => params(u).p);
    expect(paths).toEqual(['/', 'game/start', 'mode/hard', 'car/retro', 'share', 'stage/1-0', 'game/start', 'mode/normal', 'car/new', 'share']);
    expect(params(e.sent[0])).toEqual({ p: '/', t: 'TEB RUN', r: 'https://tebrun.io', rnd: 'abcde' });
    for (const u of e.sent.slice(1)) expect(params(u).e).toBe('true');
  });

  test('a name outside the form is dropped, a throwing sender never reaches the game', () => {
    const e = env();
    const s = createStats(true, STATS_ENDPOINT, e);
    s.event('name/AAA BBB');
    s.event('https://x');
    expect(e.sent).toEqual([]);
    const boom = createStats(true, STATS_ENDPOINT, env({ send: () => { throw new Error('offline'); } }));
    expect(() => {
      boom.pageview();
      boom.startGame('normal', 'new');
    }).not.toThrow();
  });

  test('no personal data: no score, no name, no storage', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/core/stats.ts', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie|\.score\b|userAgent/);
  });
});

describe('only the site build, and the switch', () => {
  test('FEATURES.stats only in site; the literal constant agrees with it', () => {
    expect(featuresOf('site').stats).toBe(true);
    expect(featuresOf('portal').stats).toBe(false);
    expect(featuresOf('private').stats).toBe(false);
    expect(STATS_BUILD).toBe(FEATURES.stats);
    expect(STATS_ENABLED).toBe(true);
  });

  test('main.ts builds the stats only behind STATS_BUILD, FEATURES.stats and STATS_ENABLED', () => {
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    expect(main).toMatch(/STATS_BUILD && FEATURES\.stats \? createStats\(STATS_ENABLED, STATS_ENDPOINT/);
  });
});

describe('trackRace', () => {
  const stage = (id: string): StageDef => STAGES.get(id)!;
  const fake = (script: RaceEvent[][]): RaceEngine => {
    let i = 0;
    return {
      update: () => script[i++] ?? [],
      snapshot: () => ({}) as RaceSnapshot,
    };
  };

  test('checkpoints count the fork taken and the stage reached, the finish counts the ending', () => {
    const e = env();
    const s = createStats(true, STATS_ENDPOINT, e);
    s.startGame('normal', 'new');
    const script: RaceEvent[][] = [
      [{ type: 'countdown', step: 0 }],
      [{ type: 'checkpoint', bonus: 0, nextStage: stage('1-1') }],
      [{ type: 'checkpoint', bonus: 0, nextStage: stage('2-1') }],
      [{ type: 'checkpoint', bonus: 0, nextStage: stage('3-2') }],
      [{ type: 'checkpoint', bonus: 0, nextStage: stage('4-2') }],
      [{ type: 'finish', ending: 2, score: 123456 }],
    ];
    const race = trackRace(fake(script), s, '0-0');
    const seen: RaceEvent[][] = [];
    for (let k = 0; k < script.length + 2; k++) seen.push(race.update(1 / 60, {} as never));
    expect(seen.slice(0, script.length)).toEqual(script);
    expect(e.sent.map((u) => params(u).p).slice(3)).toEqual([
      'fork/0-0-R',
      'stage/1-1',
      'fork/1-1-L',
      'stage/2-1',
      'fork/2-1-R',
      'stage/3-2',
      'fork/3-2-L',
      'stage/4-2',
      'ending/3',
    ]);
    expect(e.sent.join(' ')).not.toContain('123456');
  });

  test('a daily game: daily/end once at the end (game over or finish), never the score or the initials', () => {
    for (const end of [{ type: 'gameover', score: 4321, stage: stage('2-1') }, { type: 'finish', ending: 0, score: 4321 }] as RaceEvent[]) {
      const e = env();
      const s = createStats(true, STATS_ENDPOINT, e);
      s.startGame('hard', 'retro');
      s.event(STAT_EVENTS.dailyStart());
      const race = trackRace(fake([[], [end]]), s, '0-0', true);
      race.update(1 / 60, {} as never);
      race.update(1 / 60, {} as never);
      const sent = e.sent.map((u) => params(u).p);
      expect(sent).toContain('daily/start');
      expect(sent.filter((p) => p === 'daily/end')).toHaveLength(1);
      expect(e.sent.join(' ')).not.toContain('4321');
    }
    const e = env();
    const s = createStats(true, STATS_ENDPOINT, e);
    s.startGame('normal', 'new');
    const race = trackRace(fake([[{ type: 'finish', ending: 0, score: 1 }]]), s, '0-0');
    race.update(1 / 60, {} as never);
    expect(e.sent.map((u) => params(u).p)).not.toContain('daily/end');
  });

  test('with stats off the engine is returned untouched', () => {
    const engine = fake([]);
    expect(trackRace(engine, NO_STATS, '0-0')).toBe(engine);
  });
});
