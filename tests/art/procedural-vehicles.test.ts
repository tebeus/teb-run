import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { VEHICLES } from '../../src/art/procedural/vehicles';
import { PROCEDURAL, hasDrawer } from '../../src/art/procedural/index';
import { createFakeCtx } from '../helpers/fakeCtx';

const PLAYER = [
  'player_straight',
  'player_left1',
  'player_left2',
  'player_right1',
  'player_right2',
  'player_spin_0',
  'player_spin_1',
  'player_spin_2',
  'player_spin_3',
  'player_brake',
];
const TRAFFIC = [
  'traffic_sedan',
  'traffic_hatchback',
  'traffic_van',
  'traffic_truck',
  'traffic_bike',
  'traffic_coupe',
  'traffic_offroad',
  'traffic_sportscar',
  'traffic_bus',
  'traffic_pickup',
  'traffic_supercar',
  'traffic_roadster',
  'traffic_muscle',
  'traffic_rally',
];

describe('disegnatori dei veicoli', () => {
  test('ci sono i 10 frame del giocatore e i 14 veicoli di traffico', () => {
    expect(Object.keys(VEHICLES).sort()).toEqual([...PLAYER, ...TRAFFIC].sort());
  });

  test('ogni nome è nel catalogo', () => {
    for (const name of Object.keys(VEHICLES)) expect(CATALOG[name], name).toBeDefined();
  });

  test.each([...PLAYER, ...TRAFFIC])('%s disegna qualcosa senza lanciare', (name) => {
    const ctx = createFakeCtx();
    VEHICLES[name](ctx, 320, 200);
    expect(ctx.paints, name).toBeGreaterThan(3);
  });

  test('nessun disegnatore esce dal riquadro di più del 2%', () => {
    for (const [name, draw] of Object.entries(VEHICLES)) {
      const ctx = createFakeCtx();
      draw(ctx, 320, 200);
      for (const op of ctx.ops) {
        if (op.type === 'fillRect' || op.type === 'rect') {
          expect(op.args[0], `${name} x`).toBeGreaterThanOrEqual(-6.4);
          expect(op.args[1], `${name} y`).toBeGreaterThanOrEqual(-4);
          expect(op.args[0] + op.args[2], `${name} x+w`).toBeLessThanOrEqual(326.4);
          expect(op.args[1] + op.args[3], `${name} y+h`).toBeLessThanOrEqual(204);
        }
      }
    }
  });

  test('i frame con i freni accesi usano un rosso più chiaro degli altri', () => {
    const brake = createFakeCtx();
    VEHICLES.player_brake(brake, 320, 200);
    const straight = createFakeCtx();
    VEHICLES.player_straight(straight, 320, 200);
    const bright = (c: ReturnType<typeof createFakeCtx>) => c.ops.filter((o) => o.fill === '#ff6b6b').length;
    expect(bright(brake)).toBeGreaterThan(bright(straight));
  });

  test('PROCEDURAL contiene i veicoli e hasDrawer li riconosce', () => {
    for (const name of [...PLAYER, ...TRAFFIC]) {
      expect(PROCEDURAL[name], name).toBeDefined();
      expect(hasDrawer(name), name).toBe(true);
    }
    expect(hasDrawer('non_esiste')).toBe(false);
  });
});
