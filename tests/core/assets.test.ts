import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SIZE,
  browserEnv,
  countSources,
  fileOf,
  frameCountOf,
  frameIndexOf,
  frameRect,
  manifestWarnings,
  parseManifest,
  pickSource,
  summaryLine,
  targetSize,
  type Manifest,
  type Source,
} from '../../src/core/assets';

const procedural = new Set(['player_straight', 'player_left1', 'player_left2', 'bg_beach_far', 'common_gantry']);

const manifest = (entries: Manifest): Manifest => entries;

describe('nomi, file e frame', () => {
  test('un frame di strip risale al file della strip', () => {
    expect(fileOf('player_left2')).toBe('player_strip_turn');
    expect(frameIndexOf('player_left2')).toBe(2);
    expect(frameCountOf('player_left2')).toBe(3);
  });

  test('un nome normale è il proprio file, frame 0 di 1', () => {
    expect(fileOf('traffic_sedan')).toBe('traffic_sedan');
    expect(frameIndexOf('traffic_sedan')).toBe(0);
    expect(frameCountOf('traffic_sedan')).toBe(1);
  });

  test('la misura target di un frame di strip è quella del singolo frame', () => {
    expect(targetSize('player_spin_3')).toEqual({ w: 320, h: 200 });
  });

  test('la misura target viene da sprite-targets.json', () => {
    expect(targetSize('bg_beach_far')).toEqual({ w: 2048, h: 220 });
    expect(targetSize('title_logo')).toEqual({ w: 900, h: 300 });
  });

  test('i nomi solo procedurali hanno una misura dedicata', () => {
    expect(targetSize('common_barrier')).toEqual({ w: 160, h: 120 });
    expect(targetSize('common_gantry')).toEqual({ w: 1024, h: 320 });
  });

  test('un nome sconosciuto ricade sulla misura di default', () => {
    expect(targetSize('nonesistente')).toEqual(DEFAULT_SIZE);
  });
});

describe('frameRect', () => {
  test('divide la larghezza in frame uguali arrotondando per difetto', () => {
    expect(frameRect(961, 200, 3, 0)).toEqual({ sx: 0, sy: 0, sw: 320, sh: 200 });
    expect(frameRect(961, 200, 3, 2)).toEqual({ sx: 640, sy: 0, sw: 320, sh: 200 });
  });

  test('con un solo frame prende tutta l\'immagine', () => {
    expect(frameRect(280, 180, 1, 0)).toEqual({ sx: 0, sy: 0, sw: 280, sh: 180 });
  });

  test('frames <= 0 vale 1', () => {
    expect(frameRect(280, 180, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 280, sh: 180 });
  });
});

describe('pickSource', () => {
  test('usa il PNG del file di strip per ogni frame', () => {
    const m = manifest({ player_strip_turn: { file: 'player_strip_turn.png', w: 960, h: 200, frames: 3 } });
    expect(pickSource('player_left1', m, procedural)).toEqual({
      kind: 'png',
      file: 'player_strip_turn',
      url: '/sprites/player_strip_turn.png',
      frames: 3,
      index: 1,
    });
  });

  test('un PNG col nome logico vince sul file di strip', () => {
    const m = manifest({
      player_strip_turn: { file: 'player_strip_turn.png', w: 960, h: 200, frames: 3 },
      player_left1: { file: 'player_left1.png', w: 300, h: 190 },
    });
    expect(pickSource('player_left1', m, procedural)).toEqual({
      kind: 'png',
      file: 'player_left1',
      url: '/sprites/player_left1.png',
      frames: 1,
      index: 0,
    });
  });

  test('manifest vuoto: procedurale alla misura del target', () => {
    expect(pickSource('bg_beach_far', {}, procedural)).toEqual({ kind: 'procedural', w: 2048, h: 220 });
  });

  test('senza PNG e senza disegnatore: rettangolo magenta', () => {
    expect(pickSource('traffic_sedan', {}, procedural)).toEqual({ kind: 'missing', w: 300, h: 220 });
  });

  test('un nome che non esiste nel catalogo dà il segnaposto, non un errore', () => {
    expect(pickSource('nome_inventato', {}, procedural)).toEqual({
      kind: 'missing',
      w: DEFAULT_SIZE.w,
      h: DEFAULT_SIZE.h,
    });
    expect(pickSource('nome_inventato', { altro: { file: 'altro.png', w: 10, h: 10 } }, procedural).kind).toBe(
      'missing',
    );
  });

  test('strip con meno frame nel manifest: i frame oltre il conteggio ripiegano sul procedurale', () => {
    const m = manifest({ player_strip_turn: { file: 'player_strip_turn.png', w: 640, h: 200, frames: 2 } });
    expect(pickSource('player_left1', m, procedural).kind).toBe('png');
    expect(pickSource('player_left2', m, procedural)).toEqual({ kind: 'procedural', w: 320, h: 200 });
  });

  test('una voce con misure non valide viene ignorata', () => {
    const m = manifest({ bg_beach_far: { file: 'bg_beach_far.png', w: 0, h: 220 } });
    expect(pickSource('bg_beach_far', m, procedural).kind).toBe('procedural');
  });

  test('il prefisso degli url è configurabile', () => {
    const m = manifest({ bg_beach_far: { file: 'bg_beach_far.png', w: 2048, h: 220 } });
    const s = pickSource('bg_beach_far', m, procedural, '/altro/');
    expect(s.kind === 'png' && s.url).toBe('/altro/bg_beach_far.png');
  });
});

describe('parseManifest', () => {
  test('accetta la forma buona e completa il campo file', () => {
    expect(parseManifest({ traffic_van: { w: 300, h: 240 } })).toEqual({
      traffic_van: { file: 'traffic_van.png', w: 300, h: 240 },
    });
  });

  test('conserva frames quando è un intero >= 1', () => {
    expect(parseManifest({ s: { file: 's.png', w: 10, h: 10, frames: 4 } }).s.frames).toBe(4);
  });

  test('scarta voci malformate senza lanciare', () => {
    const out = parseManifest({
      a: { w: 10, h: 10 },
      b: { w: -1, h: 10 },
      c: { w: 10 },
      d: 'nope',
      e: null,
      f: { w: 10, h: 10, frames: 0 },
    });
    expect(Object.keys(out)).toEqual(['a', 'f']);
    expect(out.f.frames).toBeUndefined();
  });

  test('input non oggetto dà manifest vuoto', () => {
    expect(parseManifest(null)).toEqual({});
    expect(parseManifest('x')).toEqual({});
    expect(parseManifest([1, 2])).toEqual({});
  });
});

describe('manifestWarnings', () => {
  test('segnala il numero di frame diverso da STRIPS', () => {
    const w = manifestWarnings({ player_strip_turn: { file: 'player_strip_turn.png', w: 640, h: 200, frames: 2 } });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('player_strip_turn');
    expect(w[0]).toContain('2');
    expect(w[0]).toContain('3');
  });

  test('segnala una chiave che non è né un file noto né un nome del catalogo', () => {
    const w = manifestWarnings({ pippo: { file: 'pippo.png', w: 10, h: 10 } });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('pippo');
  });

  test('segnala frames > 1 su un nome che non è una strip', () => {
    const w = manifestWarnings({ traffic_van: { file: 'traffic_van.png', w: 300, h: 240, frames: 3 } });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('traffic_van');
  });

  test('un manifest coerente non produce warning', () => {
    expect(
      manifestWarnings({
        player_strip_turn: { file: 'player_strip_turn.png', w: 960, h: 200, frames: 3 },
        traffic_van: { file: 'traffic_van.png', w: 300, h: 240 },
        player_brake: { file: 'player_brake.png', w: 320, h: 200 },
      }),
    ).toEqual([]);
  });
});

describe('statistiche', () => {
  test('conta le sorgenti per tipo', () => {
    const sources: Source[] = [
      { kind: 'png', file: 'a', url: '/a.png', frames: 1, index: 0 },
      { kind: 'png', file: 'b', url: '/b.png', frames: 1, index: 0 },
      { kind: 'procedural', w: 1, h: 1 },
      { kind: 'missing', w: 1, h: 1 },
    ];
    expect(countSources(sources)).toEqual({ png: 2, procedural: 1, missing: 1 });
  });

  test('la riga di riepilogo nomina i tre conteggi e il totale', () => {
    expect(summaryLine({ png: 3, procedural: 62, missing: 2 }, 67)).toBe(
      'TEB RUN assets: 3 png, 62 procedural, 2 missing (67 names)',
    );
  });
});

describe('browserEnv().surface senza OffscreenCanvas né DOM (Minor 2)', () => {
  test('non lancia: ritorna una superficie che non disegna ma non rompe niente', () => {
    // In questo ambiente di test (Vitest, `environment: node`) sia
    // OffscreenCanvas sia document sono già assenti: è esattamente il caso
    // di un browser senza OffscreenCanvas (Safari < 16.4) che deve restare
    // "mai bloccante" (spec §15) invece di far rigettare `ready`.
    expect(typeof OffscreenCanvas).toBe('undefined');
    expect(typeof document).toBe('undefined');
    const env = browserEnv();
    let surface: ReturnType<typeof env.surface> | undefined;
    expect(() => {
      surface = env.surface(10, 20);
    }).not.toThrow();
    expect(surface?.image).toBeDefined();
    expect(() => surface?.blit({} as CanvasImageSource, 0, 0, 10, 20)).not.toThrow();
    expect(() => {
      const ctx = surface!.ctx;
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, 10, 20);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('x', 5, 10);
    }).not.toThrow();
  });
});
