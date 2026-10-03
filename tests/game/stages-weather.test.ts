import { describe, expect, test } from 'vitest';
import { levelOf, STAGE_LIST, stageById, STAGE_WEATHER } from '../../src/game/stages';
import type { Weather } from '../../src/types';

const WITH_WEATHER: readonly [string, Weather][] = [
  ['3-0', 'rain'],
  ['3-1', 'snow'],
  ['3-3', 'dust'],
  ['4-1', 'snow'],
  ['4-2', 'rain'],
  ['4-3', 'dust'],
];

describe('meteo per tappa (spec §4.4f e §9)', () => {
  test('the six stages with weather are exactly the ones the spec lists', () => {
    expect(Object.entries(STAGE_WEATHER).sort()).toEqual([...WITH_WEATHER].sort());
  });

  test('every stage carries a resolved weather, and the other nine are clear', () => {
    const named = new Map(WITH_WEATHER);
    for (const stage of STAGE_LIST) {
      expect(stage.weather, `stage ${stage.id}`).toBe(named.get(stage.id) ?? 'clear');
    }
  });

  test('weather is a pair per level and per kind: two rains, two snows, two dusts', () => {
    const count = (w: Weather): number => WITH_WEATHER.filter(([, k]) => k === w).length;
    expect(count('rain')).toBe(2);
    expect(count('snow')).toBe(2);
    expect(count('dust')).toBe(2);
    // Una per livello 3 e una per livello 4, per ogni tipo.
    for (const w of ['rain', 'snow', 'dust'] as const) {
      const levels = WITH_WEATHER.filter(([, k]) => k === w).map(([id]) => levelOf(id));
      expect(levels.sort(), w).toEqual([3, 4]);
    }
  });

  test('snow only falls where the theme already snows, and dust only in the desert', () => {
    expect(stageById('3-1').theme).toBe('alpine');
    expect(stageById('4-1').theme).toBe('alpine');
    expect(stageById('3-3').theme).toBe('desert');
    expect(stageById('4-3').theme).toBe('desert');
  });

  test('no route meets every weather and none avoids them all', () => {
    // I sedici percorsi del grafo: L → (l+1)-i, R → (l+1)-(i+1).
    for (let bits = 0; bits < 16; bits++) {
      const ids = ['0-0'];
      let index = 0;
      for (let level = 0; level < 4; level++) {
        if (((bits >> level) & 1) === 1) index++;
        ids.push(`${level + 1}-${index}`);
      }
      const met = ids.filter((id) => id in STAGE_WEATHER);
      expect(met.length, ids.join(' ')).toBeGreaterThanOrEqual(1);
      expect(met.length, ids.join(' ')).toBeLessThanOrEqual(2);
    }
  });

  test('Pine Pass keeps its snowfall without a weather: it comes from the theme', () => {
    // Regressione del binario H: 2-1 nevica perche il tema e alpine,
    // non perche la tappa abbia un meteo (spec §4.4b).
    expect(stageById('2-1').weather).toBe('clear');
    expect(stageById('2-1').theme).toBe('alpine');
  });
});
