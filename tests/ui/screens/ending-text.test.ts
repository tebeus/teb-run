import { describe, expect, test, vi } from 'vitest';
import type { AssetStore, SfxName, SpriteAsset } from '../../../src/types';
import type { ScoresStore } from '../../../src/persist/scores';
import type { ScreenDeps } from '../../../src/ui/deps';

/**
 * `drawText` disegna glifo per glifo con `fillRect`: per sapere *quali stringhe*
 * la schermata scrive si sostituisce il modulo del testo con un registratore.
 */
const drawn: string[] = [];
/** Solo le scritte con il contorno scuro, nell'ordine in cui arrivano. */
const outlined: string[] = [];
vi.mock('../../../src/ui/text', () => ({
  drawText: (_ctx: unknown, text: string) => {
    drawn.push(text);
  },
  drawTextOutlined: (_ctx: unknown, text: string) => {
    drawn.push(text);
    outlined.push(text);
  },
  measureText: () => 0,
}));

const { ENDINGS } = await import('../../../src/game/endings');
const { createEndingScreen } = await import('../../../src/ui/screens/ending');
const { stageById } = await import('../../../src/game/stages');

function makeCtx(): CanvasRenderingContext2D {
  return {
    fillRect() {},
    drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    fillStyle: '',
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

function makeDeps(assets: AssetStore, sfx: SfxName[] = []): ScreenDeps {
  const scores = {
    load: () => [],
    qualifies: () => false,
    insert: () => -1,
    clear: () => {},
  } as unknown as ScoresStore;
  return {
    assets,
    audio: {
      unlock() {},
      playSong() {},
      stopSong() {},
      sfx: (name: SfxName) => {
        sfx.push(name);
      },
      setEngine() {},
      setSkid() {},
      setRumble() {},
      toggleMute: () => false,
      muted: false,
      available: true,
    },
    scores,
    raceFactory: () => {
      throw new Error('unused');
    },
    renderWorld: () => {},
    firstStage: stageById('0-0'),
  };
}

/**
 * AssetStore che dichiara di avere ogni nome, per esercitare il ramo
 * dell'illustrazione. Registra i nomi passati a `get`, non a `has`: il README
 * stabilisce che `get` non ha bisogno di `has`, quindi legare il test a `has`
 * lo farebbe rompere se un domani D smettesse di chiamarlo.
 */
function assetsWithEverything(fetched: string[]): AssetStore {
  const asset = (name: string): SpriteAsset => ({
    name,
    image: { width: 1, height: 1 } as unknown as CanvasImageSource,
    w: 640,
    h: 480,
    entry: { kind: 'illustration', scale: 1, solid: false, collideW: 0, anchorY: 0.5 },
  });
  return {
    ready: Promise.resolve(),
    get: (name) => {
      fetched.push(name);
      return asset(name);
    },
    has: () => true,
    stats: { png: 0, procedural: 0, missing: 0 },
  };
}

describe('ending screen text', () => {
  test('draws the title and every line of the reached ending, plus the score', () => {
    for (const ending of ENDINGS) {
      drawn.length = 0;
      const screen = createEndingScreen(makeDeps(assetsWithEverything([])));
      screen.enter({ score: 4242, ending: ending.index, stage: stageById(`4-${ending.index}`), route: [] });
      screen.render(makeCtx());
      expect(drawn).toContain(ending.title);
      for (const line of ending.lines) expect(drawn).toContain(line);
      expect(drawn).toContain('SCORE 4242');
      // Nessun testo di un altro finale.
      for (const other of ENDINGS.filter((e) => e.index !== ending.index)) {
        expect(drawn).not.toContain(other.title);
      }
    }
  });

  test('every ending opens with GOAL! and CONGRATULATIONS, outlined, before its title', () => {
    // Collaudo dell'utente: «ROADSIDE STEAM» con il motore che fuma è stato
    // letto come un guasto. In cima a ogni finale, prima del testo che
    // scorre, il gioco dice che si è arrivati.
    for (const ending of ENDINGS) {
      drawn.length = 0;
      outlined.length = 0;
      const screen = createEndingScreen(makeDeps(assetsWithEverything([])));
      screen.enter({ score: 1, ending: ending.index, stage: stageById(`4-${ending.index}`), route: [] });
      screen.render(makeCtx());
      expect(outlined.slice(0, 2), ending.title).toEqual(['GOAL!', 'CONGRATULATIONS']);
      const goal = drawn.indexOf('GOAL!');
      const congrats = drawn.indexOf('CONGRATULATIONS');
      const title = drawn.indexOf(ending.title);
      expect(goal, ending.title).toBeGreaterThanOrEqual(0);
      expect(congrats, ending.title).toBeGreaterThan(goal);
      expect(title, ending.title).toBeGreaterThan(congrats);
    }
  });

  test('the arcade border is the last image, over the illustrated route map', () => {
    const fetched: string[] = [];
    const screen = createEndingScreen(makeDeps(assetsWithEverything(fetched)));
    screen.enter({ score: 0, ending: 1, stage: stageById('4-1'), route: ['L'] });
    screen.render(makeCtx());
    expect(fetched).toContain('map_full');
    expect(fetched[fetched.length - 1]).toBe('ending_border');
  });

  test('fetches ending_${n + 1} from the asset store', () => {
    const fetched: string[] = [];
    const screen = createEndingScreen(makeDeps(assetsWithEverything(fetched)));
    screen.enter({ score: 0, ending: 2, stage: stageById('4-2'), route: [] });
    screen.render(makeCtx());
    expect(fetched).toContain('ending_3');
  });

  test('an ending index above the range clamps to the last ending instead of drawing nothing', () => {
    drawn.length = 0;
    const screen = createEndingScreen(makeDeps(assetsWithEverything([])));
    screen.enter({ score: 0, ending: 99, stage: stageById('4-0'), route: [] });
    screen.render(makeCtx());
    expect(drawn).toContain(ENDINGS[ENDINGS.length - 1].title);
  });

  test('plays the fanfare once on enter (spec §10)', () => {
    const sfx: SfxName[] = [];
    const screen = createEndingScreen(makeDeps(assetsWithEverything([]), sfx));
    screen.enter({ score: 0, ending: 0, stage: stageById('4-0'), route: [] });
    expect(sfx).toEqual(['fanfare']);
    // Il rendering non la ripete: 8 secondi di fanfare sovrapposte sarebbero un rumore.
    screen.render(makeCtx());
    screen.render(makeCtx());
    expect(sfx).toEqual(['fanfare']);
  });

  test('a malformed payload still draws the first ending', () => {
    drawn.length = 0;
    const screen = createEndingScreen(makeDeps(assetsWithEverything([])));
    screen.enter(undefined);
    screen.render(makeCtx());
    expect(drawn).toContain(ENDINGS[0].title);
  });
});
