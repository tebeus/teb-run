import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { createEmptyAssets } from '../../src/dev/empty-assets';
import { createFakeRace, FAKE_CHECKPOINT_EVERY_S, FAKE_CHECKPOINTS_TO_FINISH } from '../../src/dev/fake-race';
import { renderFakeWorld } from '../../src/dev/fake-world';
import { createNullAudio } from '../../src/dev/null-audio';
import { createScoresStore } from '../../src/persist/scores';
import { createApp } from '../../src/ui/app';
import type { ScreenDeps } from '../../src/ui/deps';
import { WIPE_S } from '../../src/ui/transition';
import { createRecordCtx, type RecOp } from '../helpers/recordCtx';
import type { StageDef } from '../../src/types';

const stage: StageDef = {
  id: '0-0',
  name: 'Palm Bay',
  theme: 'beach',
  lengthSegments: 2260,
  timeLimit: 200,
  seed: 1,
  difficulty: 0.15,
};

function makeDeps(): ScreenDeps {
  return {
    assets: createEmptyAssets(),
    audio: createNullAudio(),
    scores: createScoresStore(),
    raceFactory: (s, a) => createFakeRace(s, a),
    renderWorld: renderFakeWorld,
    firstStage: stage,
    now: () => 0, // rende deterministica la data inserita da nameEntry
  };
}

describe('createApp', () => {
  test('enters title immediately', () => {
    const app = createApp(makeDeps());
    expect(app.name).toBe('title');
  });

  test('a screen change starts the wipe, drawn over the new screen, and it ends after WIPE_S', () => {
    // Immagini con il nome, perché il registratore sappia riconoscerle.
    const empty = createEmptyAssets();
    const deps: ScreenDeps = {
      ...makeDeps(),
      assets: { ...empty, get: (name) => ({ ...empty.get(name), image: { name } as unknown as CanvasImageSource }) },
    };
    const app = createApp(deps);
    const wipes = (): RecOp[] => {
      const rec = createRecordCtx();
      app.render(rec.ctx);
      return rec.images().filter((op) => op.image === 'transition_wipe');
    };
    expect(wipes(), 'nessuna tendina al primo titolo').toHaveLength(0);
    app.update(1 / 60, { ...emptyActions(), confirm: true });
    expect(app.name).toBe('radio');
    // Due copie della striscia di palme affiancate (la seconda specchiata).
    expect(wipes(), 'tendina dopo il cambio').toHaveLength(2);
    app.update(WIPE_S, emptyActions());
    expect(wipes(), 'tendina finita').toHaveLength(0);
  });

  test('a momentary confirm does not skip a screen on the following tick', () => {
    const app = createApp(makeDeps());
    app.update(1 / 60, { ...emptyActions(), confirm: true });
    expect(app.name).toBe('radio');
    app.update(1 / 60, emptyActions()); // core/input.ts would clear confirm on the next poll
    expect(app.name).toBe('radio');
  });

  test('the whole flow is navigable: title -> radio -> race -> ending -> nameEntry -> scores -> title', () => {
    const deps = makeDeps();
    const app = createApp(deps);

    app.update(1 / 60, { ...emptyActions(), confirm: true });
    expect(app.name).toBe('radio');

    app.update(1 / 60, { ...emptyActions(), confirm: true });
    expect(app.name).toBe('race');

    const finishAt = FAKE_CHECKPOINT_EVERY_S * FAKE_CHECKPOINTS_TO_FINISH;
    for (let t = 1; t < finishAt; t++) {
      app.update(1, emptyActions());
      expect(app.name).toBe('race');
    }
    app.update(1, emptyActions());
    expect(app.name).toBe('ending');

    app.update(1 / 60, { ...emptyActions(), confirm: true });
    expect(app.name).toBe('nameEntry');

    // The very first tick after entry seeds nameEntry's edge-detection state
    // (see stepNameEntry), so it must be a clear tick before real presses count.
    app.update(1 / 60, emptyActions());
    app.update(1 / 60, { ...emptyActions(), right: true });
    app.update(1 / 60, emptyActions());
    app.update(1 / 60, { ...emptyActions(), right: true });
    app.update(1 / 60, emptyActions());
    app.update(1 / 60, { ...emptyActions(), right: true });
    expect(app.name).toBe('scores');
    expect(deps.scores.load()).toEqual([
      expect.objectContaining({ name: 'AAA', date: new Date(0).toISOString() }),
    ]);

    app.update(1 / 60, { ...emptyActions(), confirm: true });
    expect(app.name).toBe('title');
  });

  test('M toggles mute exactly once per press, on any screen, and race does not double it', () => {
    let toggleCalls = 0;
    const audio = createNullAudio();
    const spyAudio = {
      ...audio,
      toggleMute() {
        toggleCalls++;
        return audio.toggleMute();
      },
    };
    const deps: ScreenDeps = { ...makeDeps(), audio: spyAudio };
    const app = createApp(deps);

    app.update(1 / 60, { ...emptyActions(), mute: true }); // title
    expect(toggleCalls).toBe(1);

    app.update(1 / 60, { ...emptyActions(), confirm: true }); // -> radio
    app.update(1 / 60, { ...emptyActions(), mute: true }); // radio
    expect(toggleCalls).toBe(2);

    app.update(1 / 60, { ...emptyActions(), confirm: true }); // -> race
    app.update(1 / 60, { ...emptyActions(), mute: true }); // race: una sola chiamata, non due
    expect(toggleCalls).toBe(3);
  });

  test('mute does nothing when audio is unavailable', () => {
    let toggleCalls = 0;
    const audio = createNullAudio({ available: false });
    const spyAudio = {
      ...audio,
      toggleMute() {
        toggleCalls++;
        return audio.toggleMute();
      },
    };
    const deps: ScreenDeps = { ...makeDeps(), audio: spyAudio };
    const app = createApp(deps);

    app.update(1 / 60, { ...emptyActions(), mute: true });
    expect(toggleCalls).toBe(0);
  });

  test('leaving race calls exit() and tears down engine/skid sound before ending enters', () => {
    const calls: string[] = [];
    const audio = createNullAudio();
    const spyAudio = {
      ...audio,
      setEngine(sp: number, gear: string, running: boolean) {
        calls.push(`engine:${sp}:${gear}:${running}`);
      },
      setSkid(on: boolean) {
        calls.push(`skid:${on}`);
      },
      setRumble(_on: boolean) {},
    };
    const deps: ScreenDeps = { ...makeDeps(), audio: spyAudio };
    const app = createApp(deps);

    app.update(1 / 60, { ...emptyActions(), confirm: true }); // -> radio
    app.update(1 / 60, { ...emptyActions(), confirm: true }); // -> race
    calls.length = 0;

    const finishAt = FAKE_CHECKPOINT_EVERY_S * FAKE_CHECKPOINTS_TO_FINISH;
    for (let t = 1; t <= finishAt; t++) app.update(1, emptyActions());
    expect(app.name).toBe('ending');

    expect(calls).toContain('engine:0:lo:false');
    expect(calls).toContain('skid:false');
  });

  test('render always clears the whole frame before drawing, so one screen in a sequence cannot bleed into the next', () => {
    // Recording fake context: no real drawing, only logs each call so the
    // first op of a render pass can be inspected. This is what caught issue
    // 1 in the review: no screen's own render cleared the frame, so the
    // previous screen's last frame (e.g. title's "TEB RUN") stayed on the
    // canvas underneath the next one (e.g. radio).
    const calls: { op: string; args: unknown[] }[] = [];
    const record =
      (op: string) =>
      (...args: unknown[]) => {
        calls.push({ op, args });
      };
    const ctx = {
      fillStyle: '',
      fillRect: record('fillRect'),
      drawImage: record('drawImage'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      closePath: record('closePath'),
      fill: record('fill'),
      save: record('save'),
      restore: record('restore'),
      translate: record('translate'),
      scale: record('scale'),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as unknown as CanvasRenderingContext2D;

    const app = createApp(makeDeps());

    app.render(ctx); // title
    expect(app.name).toBe('title');
    expect(calls[0]).toEqual({ op: 'fillRect', args: [0, 0, LOGICAL_W, LOGICAL_H] });

    calls.length = 0;
    app.update(1 / 60, { ...emptyActions(), confirm: true }); // -> radio
    app.render(ctx); // second screen in sequence, same context, nothing cleared in between
    expect(app.name).toBe('radio');
    expect(calls[0]).toEqual({ op: 'fillRect', args: [0, 0, LOGICAL_W, LOGICAL_H] });
  });
});
