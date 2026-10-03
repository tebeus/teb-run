import type { SpriteName } from '../../types';
import { ARCADE_ART } from './arcade';
import { BACKGROUNDS } from './backgrounds';
import { CLOUDS } from './clouds';
import { DETAILS } from './details';
import { FX_SPRITES } from './fxsprites';
import { ILLUSTRATIONS } from './illustrations';
import { NPC_ART } from './npc';
import type { Drawer } from './palette';
import { RACE_ART } from './race';
import { SCENERY } from './scenery';
import { SCENERY2 } from './scenery2';
import { TEXTURES } from './textures';
import { VEHICLES } from './vehicles';
import { WALLS } from './walls';

/**
 * Ripieghi delle auto selezionabili oltre alla nuova: le serie
 * `player_classic_*`, `player_retro_*`, `player_sport_*`, `player_super_*` e i finali
 * `ending_classic_*` disegnano come l'auto nuova. Il procedurale è una
 * cabrio rossa generica, uguale per tutte e cinque.
 */
const CAR_FRAMES = [
  'straight',
  'left1',
  'left2',
  'right1',
  'right2',
  'brake',
  'spin_0',
  'spin_1',
  'spin_2',
  'spin_3',
] as const;
const OTHER_CARS: Record<SpriteName, Drawer> = {
  ...Object.fromEntries(
    (['classic', 'retro', 'sport', 'super'] as const).flatMap((car) =>
      CAR_FRAMES.map((f) => [`player_${car}_${f}`, VEHICLES[`player_${f}`]]),
    ),
  ),
  ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`ending_classic_${n}`, ILLUSTRATIONS[`ending_${n}`]])),
};

/** Tutti gli sprite disegnati da codice, per nome logico del catalogo. */
export const PROCEDURAL: Record<SpriteName, Drawer> = {
  ...OTHER_CARS,
  ...TEXTURES,
  ...VEHICLES,
  ...SCENERY,
  ...SCENERY2,
  ...RACE_ART,
  ...FX_SPRITES,
  ...NPC_ART,
  ...ARCADE_ART,
  ...BACKGROUNDS,
  ...ILLUSTRATIONS,
  ...WALLS,
  ...CLOUDS,
  ...DETAILS,
};

export function hasDrawer(name: SpriteName): boolean {
  return Object.prototype.hasOwnProperty.call(PROCEDURAL, name);
}

export type { Ctx2D, Drawer } from './palette';
