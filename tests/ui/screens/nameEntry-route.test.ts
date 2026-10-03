import { describe, expect, test } from 'vitest';
import { routeString, stageById } from '../../../src/game/stages';
import type { ScoreEntry, ScoresStore } from '../../../src/persist/scores';
import type { AssetStore } from '../../../src/types';
import type { ScreenDeps } from '../../../src/ui/deps';
import { createNameEntryScreen } from '../../../src/ui/screens/nameEntry';
// `?raw` è il modo di Vite di importare un file come testo (come in
// tests/wiring/main-graph.test.ts): l'assert sul comportamento sopra non può
// fallire per una schermata che tenesse il proprio `join(' ')` producendo per
// caso lo stesso risultato, quindi si legge anche il testo del modulo.
import NAME_ENTRY_SRC from '../../../src/ui/screens/nameEntry.ts?raw';

/**
 * `nameEntry` scriveva il percorso con un `join(' ')` suo. Ora usa
 * `routeString` di `game/stages.ts`, così il formato della classifica esiste in
 * un posto solo: questo test è ciò che impedisce alla seconda copia di tornare.
 */
function makeDeps(inserted: ScoreEntry[]): ScreenDeps {
  const scores = {
    load: () => [],
    qualifies: () => true,
    insert: (entry: ScoreEntry) => {
      inserted.push(entry);
      return 1;
    },
    clear: () => {},
  } as unknown as ScoresStore;
  const assets = {
    ready: Promise.resolve(),
    get: (name: string) => ({
      name,
      image: { width: 1, height: 1 } as unknown as CanvasImageSource,
      w: 1,
      h: 1,
      entry: { kind: 'scenery' as const, scale: 0.1, solid: false, collideW: 0, anchorY: 1 },
    }),
    has: () => false,
    stats: { png: 0, procedural: 0, missing: 0 },
  } satisfies AssetStore;
  return {
    assets,
    audio: {
      unlock() {},
      playSong() {},
      stopSong() {},
      sfx() {},
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

const NO_ACTIONS = {
  accelerate: false,
  brake: false,
  left: false,
  right: false,
  gearToggle: false,
  modeToggle: false,
  confirm: false,
  back: false,
  mute: false,
};

/**
 * `stepNameEntry` avanza sul **fronte** di destra e seeda il fronte al primo
 * tick, così un tasto tenuto giù dalla schermata precedente non conta: servono
 * quindi un tick a vuoto e poi tre pressioni separate da un rilascio.
 */
function commit(deps: ScreenDeps, route: ('L' | 'R')[]): void {
  const screen = createNameEntryScreen(deps);
  screen.enter({ score: 1234, stageId: '4-2', route });
  screen.update(0, NO_ACTIONS);
  for (let i = 0; i < 3; i++) {
    screen.update(0, { ...NO_ACTIONS, right: true });
    screen.update(0, NO_ACTIONS);
  }
}

describe('nameEntry route formatting', () => {
  test('stores the route through routeString, not its own join', () => {
    const inserted: ScoreEntry[] = [];
    commit(makeDeps(inserted), ['L', 'R', 'R', 'L']);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].route).toBe(routeString(['L', 'R', 'R', 'L']));
    expect(inserted[0].route).toBe('L R R L');
  });

  test('an empty route stores the empty string, the same as routeString', () => {
    const inserted: ScoreEntry[] = [];
    commit(makeDeps(inserted), []);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].route).toBe(routeString([]));
  });

  test('calls routeString in the source instead of formatting the route itself', () => {
    expect(NAME_ENTRY_SRC).toContain('routeString(');
    expect(NAME_ENTRY_SRC).not.toContain(".join(' ')");
  });
});
