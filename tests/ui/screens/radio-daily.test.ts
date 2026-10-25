// In DAILY la radio tiene auto e modalità della sfida (C e D, e i clic sui
// pulsanti, non le cambiano) e lo dice al posto di "C TO CHANGE"; il brano
// si sceglie come sempre. In gara l'HUD dice DAILY accanto alla modalità.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import { createEmptyAssets } from '../../../src/dev/empty-assets';
import { createFakeRace } from '../../../src/dev/fake-race';
import { createNullAudio } from '../../../src/dev/null-audio';
import { createCarSetting } from '../../../src/persist/car';
import { createModeSetting } from '../../../src/persist/mode';
import { createScoresStore } from '../../../src/persist/scores';
import { dailyChallenge } from '../../../src/shared/daily';
import { createDailySession, sessionCar, sessionMode } from '../../../src/ui/dailySession';
import { createRecordCtx } from '../../helpers/recordCtx';
import type { Actions, StageDef } from '../../../src/types';
import type { ScreenDeps } from '../../../src/ui/deps';

const drawn: string[] = [];
vi.mock('../../../src/ui/text', async (orig) => {
  const real = await orig<typeof import('../../../src/ui/text')>();
  return {
    ...real,
    drawText: (_c: unknown, text: string) => void drawn.push(text),
    drawTextOutlined: (_c: unknown, text: string) => void drawn.push(text),
  };
});
const { createRadioScreen } = await import('../../../src/ui/screens/radio');
const { renderHud } = await import('../../../src/render/hud');

const act = (a: Partial<Actions> = {}): Actions => ({ ...emptyActions(), ...a });
const stage: StageDef = { id: '0-0', name: 'Palm Bay', theme: 'beach', lengthSegments: 100, timeLimit: 80, seed: 1, difficulty: 0.15 };
const challenge = { ...dailyChallenge('2026-10-24'), car: 'retro' as const, mode: 'hard' as const };

afterEach(() => {
  drawn.length = 0;
});

function radio() {
  const session = createDailySession();
  const rawCar = createCarSetting(undefined, 'sport');
  const rawMode = createModeSetting(undefined, 'normal');
  const deps: ScreenDeps = {
    assets: createEmptyAssets(),
    audio: createNullAudio(),
    scores: createScoresStore(),
    raceFactory: (s, a) => createFakeRace(s, a),
    renderWorld: () => {},
    firstStage: stage,
    car: sessionCar(rawCar, session),
    mode: sessionMode(rawMode, session),
    daily: session,
  };
  return { screen: createRadioScreen(deps), session, deps, rawCar, rawMode };
}

describe('radio in DAILY', () => {
  test('C and D do nothing; the saved choice stays; the hint says DAILY CHALLENGE', () => {
    const r = radio();
    r.session.start(challenge);
    r.screen.enter(undefined);
    r.screen.update(1 / 60, act({ gearToggle: true, modeToggle: true }));
    expect([r.deps.car!.get(), r.deps.mode!.get()]).toEqual(['retro', 'hard']);
    expect([r.rawCar.get(), r.rawMode.get()]).toEqual(['sport', 'normal']);
    r.screen.render(createRecordCtx().ctx);
    expect(drawn).toContain('CAR: RETRO');
    expect(drawn).toContain('MODE: HARD');
    expect(drawn.filter((t) => t === 'DAILY CHALLENGE')).toHaveLength(2);
  });

  test('outside DAILY: C changes the car, and the hint is the usual one', () => {
    const r = radio();
    r.screen.enter(undefined);
    r.screen.update(1 / 60, act({ gearToggle: true }));
    expect(r.rawCar.get()).not.toBe('sport');
    r.screen.render(createRecordCtx().ctx);
    expect(drawn).not.toContain('DAILY CHALLENGE');
  });
});

describe('HUD in DAILY', () => {
  test('the mode label says DAILY only with the traffic of the day', () => {
    const snap = createFakeRace(stage, createEmptyAssets()).snapshot();
    renderHud(createRecordCtx().ctx, { ...snap, stage: { ...stage, mode: 'hard', trafficSalt: 99 } }, createEmptyAssets());
    expect(drawn).toContain('MODE: HARD · DAILY');
    drawn.length = 0;
    renderHud(createRecordCtx().ctx, { ...snap, stage }, createEmptyAssets());
    expect(drawn).toContain('MODE: NORMAL');
    expect(drawn.some((t) => t.includes('DAILY'))).toBe(false);
  });
});
