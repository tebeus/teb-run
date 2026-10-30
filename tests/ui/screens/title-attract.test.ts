import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../../src/core/input';
import {
  ATTRACT_CYCLE_S,
  ATTRACT_FADE_S,
  ATTRACT_ORDER,
  ATTRACT_PHASE_S,
  ATTRACT_PHASES,
  attractFade,
  attractPhase,
  initialTitleState,
  shownFade,
  shownPhase,
  stepTitle,
  TOP_SCORES_SHOWN,
} from '../../../src/ui/screens/title';

describe('ciclo attrattivo del titolo (spec §11)', () => {
  test('three phases of twelve seconds, thirty-six in all', () => {
    expect(ATTRACT_PHASE_S).toBe(12);
    expect(ATTRACT_PHASES).toBe(3);
    expect(ATTRACT_CYCLE_S).toBe(36);
    expect(ATTRACT_ORDER).toEqual(['title', 'demo', 'map']);
    expect(ATTRACT_FADE_S).toBeCloseTo(0.8, 10);
    expect(TOP_SCORES_SHOWN).toBe(3);
  });

  test('the phase follows the idle clock', () => {
    expect(attractPhase(0)).toBe('title');
    expect(attractPhase(11.9)).toBe('title');
    expect(attractPhase(12)).toBe('demo');
    expect(attractPhase(23.9)).toBe('demo');
    expect(attractPhase(24)).toBe('map');
    expect(attractPhase(35.9)).toBe('map');
    // Oltre il ciclo la fase resta l'ultima: a quel punto si è già passati
    // alla classifica, ma la funzione non deve leggere fuori dall'array.
    expect(attractPhase(1000)).toBe('map');
    expect(attractPhase(-5)).toBe('title');
  });

  test('the crossfade fills the first ATTRACT_FADE_S of each phase', () => {
    // La dissolvenza passa per il nero: `attractFade` è l'alfa della
    // schermata, non di una fase sopra l'altra, quindi non serve sapere
    // quale fase stava uscendo.
    expect(attractFade(12)).toBe(0);
    expect(attractFade(12 + ATTRACT_FADE_S / 2)).toBeCloseTo(0.5, 6);
    expect(attractFade(12 + ATTRACT_FADE_S)).toBe(1);
    expect(attractFade(18)).toBe(1);
    for (const t of [0, 0.4, 12.1, 24.7, 35.99]) {
      expect(attractFade(t), `t=${t}`).toBeGreaterThanOrEqual(0);
      expect(attractFade(t), `t=${t}`).toBeLessThanOrEqual(1);
    }
  });

  test('the whole cycle ends on the score table, not before', () => {
    let state = initialTitleState();
    const quiet = emptyActions();
    for (let t = 0; t < ATTRACT_CYCLE_S - 0.1; t += 1 / 60) {
      const r = stepTitle(state, 1 / 60, quiet);
      expect(r.transition, `transizione a t=${t.toFixed(2)}`).toBeNull();
      state = r.state;
    }
    let seen: string | null = null;
    for (let i = 0; i < 20 && seen === null; i++) {
      const r = stepTitle(state, 1 / 60, quiet);
      state = r.state;
      if (r.transition) seen = r.transition.to;
    }
    expect(seen).toBe('scores');
  });

  test('any input restarts the cycle from the first phase', () => {
    let state = initialTitleState();
    for (let i = 0; i < 60 * 20; i++) state = stepTitle(state, 1 / 60, emptyActions()).state;
    expect(attractPhase(state.idleT)).toBe('demo');
    state = stepTitle(state, 1 / 60, { ...emptyActions(), left: true }).state;
    expect(attractPhase(state.idleT)).toBe('title');
  });

  test('ENTER still goes to the radio at once', () => {
    const r = stepTitle(initialTitleState(), 1 / 60, { ...emptyActions(), confirm: true });
    expect(r.transition?.to).toBe('radio');
  });
});

describe('attract phases wait for their sprites (spec telefono e finali §B.2)', () => {
  const none = { stage: false, map: false };
  const all = { stage: true, map: true };

  test('the demo shows only with the first stage ready, the map only with map_full', () => {
    expect(shownPhase('demo', all)).toBe('demo');
    expect(shownPhase('demo', none)).toBe('title');
    expect(shownPhase('map', { stage: true, map: false })).toBe('title');
    expect(shownPhase('map', all)).toBe('map');
    expect(shownPhase('title', none)).toBe('title');
  });

  test('no fade to black from the title to the title', () => {
    const t = ATTRACT_PHASE_S + 0.1;
    expect(shownFade(t, all)).toBeLessThan(1);
    expect(shownFade(t, none)).toBe(1);
    expect(shownFade(2 * ATTRACT_PHASE_S + 0.1, { stage: true, map: false })).toBeLessThan(1);
    expect(shownFade(0.1, none)).toBeLessThan(1);
  });
});
