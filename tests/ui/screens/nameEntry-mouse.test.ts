// Le iniziali col mouse: UP, DOWN e NEXT si vedono anche su computer e un
// clic vale quel pulsante; la tastiera resta com'era. I pulsanti non coprono
// le lettere, il cursore né la riga di aiuto (1280x720, e su telefono la
// geometria logica è la stessa).

import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createNameEntryScreen } from '../../../src/ui/screens/nameEntry';
import { createTouchControls, mouseButtonActions, touchLayout } from '../../../src/ui/touch';
import { clickable } from '../../../src/ui/mouse';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createScoresStore, type ScoreEntry } from '../../../src/persist/scores';
import { LOGICAL_W } from '../../../src/core/canvas';
import { measureText } from '../../../src/ui/text';
import { createRecordCtx } from '../../helpers/recordCtx';
import type { ScreenDeps } from '../../../src/ui/deps';
import type { InputDevice } from '../../../src/core/device';
import type { Rect } from '../../../src/ui/rect';

const buttons = touchLayout('nameEntry', { tiltAvailable: false, tiltOn: false, cssPerLogical: 1 });
const centre = (id: string) => {
  const r = buttons.find((b) => b.id === id)!.rect;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function screenWith(inserted: ScoreEntry[], device: InputDevice = 'keyboard') {
  const scores = createScoresStore();
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
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
    scores: {
      ...scores,
      insert: (e) => {
        inserted.push(e);
        return scores.insert(e);
      },
    },
    raceFactory: () => {
      throw new Error('unused');
    },
    renderWorld: () => {},
    firstStage: { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 1, timeLimit: 1, seed: 1, difficulty: 0 },
    device: () => device,
  };
  const screen = createNameEntryScreen(deps);
  screen.enter({ score: 5000, stageId: '0-0', route: [] });
  // Il primo tick fa da seme ai fronti.
  screen.update(1 / 60, emptyActions());
  return screen;
}

describe('name entry by mouse', () => {
  test('a click on UP, DOWN or NEXT is that button for one tick', () => {
    expect(mouseButtonActions('nameEntry', centre('up'))).toEqual({ accelerate: true });
    expect(mouseButtonActions('nameEntry', centre('down'))).toEqual({ brake: true });
    expect(mouseButtonActions('nameEntry', centre('next'))).toEqual({ right: true });
    expect(mouseButtonActions('nameEntry', { x: 640, y: 340 })).toEqual({});
    expect(mouseButtonActions('nameEntry', null)).toEqual({});
    // Solo sulle iniziali: altrove i pulsanti del tocco restano alle dita.
    expect(mouseButtonActions('race', { x: 1176, y: 398 })).toEqual({});
  });

  test('clicks spell the initials and NEXT on the third letter saves them', () => {
    const inserted: ScoreEntry[] = [];
    const screen = screenWith(inserted);
    const click = (id: string) => {
      screen.update(1 / 60, { ...emptyActions(), click: centre(id) });
      return screen.update(1 / 60, emptyActions());
    };
    click('up'); // B
    click('up'); // C
    click('next');
    click('down'); // Z
    click('next');
    click('next');
    expect(inserted.map((e) => e.name)).toEqual(['CZA']);
  });

  test('the buttons are drawn on a computer too, and the pointer is a hand on them', () => {
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) });
    for (const device of ['keyboard', 'touch'] as const) {
      const controls = createTouchControls({ win: new EventTarget(), canvas, screen: () => 'nameEntry', device: () => device });
      const rec = createRecordCtx();
      controls.draw(rec.ctx);
      for (const b of buttons) {
        expect(rec.fills().some((op) => op.type === 'fillRect' && overlaps({ x: op.args[0], y: op.args[1], w: op.args[2], h: op.args[3] }, b.rect)), `${device} ${b.id}`).toBe(true);
      }
    }
    expect(clickable('nameEntry', centre('up'))).toBe(true);
    expect(clickable('nameEntry', { x: 40, y: 40 })).toBe(false);
  });

  test('control: elsewhere the computer still gets no touch buttons', () => {
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) });
    const controls = createTouchControls({ win: new EventTarget(), canvas, screen: () => 'race', device: () => 'keyboard' });
    const rec = createRecordCtx();
    controls.draw(rec.ctx);
    expect(rec.ops).toEqual([]);
  });

  test('the buttons cover neither the letters, nor the cursor, nor the help line', () => {
    const screen = screenWith([]);
    const rec = createRecordCtx();
    screen.render(rec.ctx);
    // Le lettere (scala 6, y 340) col cursore sotto, e la riga di aiuto (y 460).
    const letters: Rect = { x: LOGICAL_W / 2 - 60 - 24, y: 340, w: 168, h: 48 + 68 + 30 };
    const help = (text: string): Rect => ({ x: LOGICAL_W / 2 - measureText(text, 2) / 2, y: 460, w: measureText(text, 2), h: 16 });
    for (const b of buttons) {
      expect(overlaps(b.rect, letters), b.id).toBe(false);
      expect(overlaps(b.rect, help('UP DOWN TO CHOOSE, RIGHT TO CONFIRM')), b.id).toBe(false);
      expect(overlaps(b.rect, help('UP DOWN TO CHOOSE, NEXT TO CONFIRM')), b.id).toBe(false);
      expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(720);
    }
    // Nessuna operazione della schermata cade nei pulsanti, a parte lo sfondo.
    const drawn = rec.fills().filter((op) => op.type === 'fillRect' && !(op.args[2] === 1280 && op.args[3] === 720));
    for (const b of buttons) {
      expect(drawn.filter((op) => overlaps({ x: op.args[0], y: op.args[1], w: op.args[2], h: op.args[3] }, b.rect))).toEqual([]);
    }
  });
});
