import type { SpriteCatalogEntry, SpriteKind, SpriteName } from '../types';

const e = (
  kind: SpriteKind,
  scale: number,
  solid: boolean,
  collideW: number,
  anchorY = 1,
): SpriteCatalogEntry => ({ kind, scale, solid, collideW: solid ? collideW : 0, anchorY });

/**
 * Con la strada a 2600 unità (spec §4.1) le scale di scenografia sono quelle
 * della strada a 2000 moltiplicate per 2000/2600, così la dimensione a
 * schermo non cambia (spec §4.4 punto 4, §13). Il numero scritto in ogni voce
 * resta quello leggibile della strada stretta: il fattore sta qui, una volta.
 */
export const WIDE_ROAD_FACTOR = 2000 / 2600;

/**
 * Dove stanno le gambe di `race_checkpoint`, in frazioni della metà
 * larghezza dello sprite dal suo centro: misurate sul PNG della consegna B
 * (1280 px, gambe fra le colonne 1-84 e 1195-1279 in basso). Con la metà
 * larghezza pari a `scale` unità `x`, la gamba va da `scale * inner` a
 * `scale * outer`.
 */
export const CHECKPOINT_LEGS = { inner: 1 - (2 * 84) / 1280, outer: 1 - (2 * 1) / 1280 } as const;

/** Come `e`, ma riscalata per la strada larga: si usa per la scenografia. */
const s = (
  kind: SpriteKind,
  scale: number,
  solid: boolean,
  collideW: number,
  anchorY = 1,
): SpriteCatalogEntry => e(kind, scale * WIDE_ROAD_FACTOR, solid, collideW * WIDE_ROAD_FACTOR, anchorY);

/** Unica fonte di verità sulle dimensioni nel mondo. Chiave = nome logico. */
export const CATALOG: Record<SpriteName, SpriteCatalogEntry> = {
  // Auto del giocatore. scale 0.14 = 233 px su 1280, il 18% della larghezza
  // e il 32% dell'altezza dello schermo, come il riferimento arcade misurato in widescreen
  // (spec §13); collideW resta 0 perché l'urto usa PLAYER_COLLIDE_W.
  player_straight: e('player', 0.14, false, 0),
  player_left1: e('player', 0.14, false, 0),
  player_left2: e('player', 0.14, false, 0),
  player_right1: e('player', 0.14, false, 0),
  player_right2: e('player', 0.14, false, 0),
  player_spin_0: e('player', 0.14, false, 0),
  player_spin_1: e('player', 0.14, false, 0),
  player_spin_2: e('player', 0.14, false, 0),
  player_spin_3: e('player', 0.14, false, 0),
  player_brake: e('player', 0.14, false, 0),
  // Auto classica, la serie di prima del Set 7, selezionabile nella radio
  // (`CarChoice`). Stessa `scale`: a schermo è larga quanto la nuova.
  player_classic_straight: e('player', 0.14, false, 0),
  player_classic_left1: e('player', 0.14, false, 0),
  player_classic_left2: e('player', 0.14, false, 0),
  player_classic_right1: e('player', 0.14, false, 0),
  player_classic_right2: e('player', 0.14, false, 0),
  player_classic_spin_0: e('player', 0.14, false, 0),
  player_classic_spin_1: e('player', 0.14, false, 0),
  player_classic_spin_2: e('player', 0.14, false, 0),
  player_classic_spin_3: e('player', 0.14, false, 0),
  player_classic_brake: e('player', 0.14, false, 0),
  // Auto retrò e sportiva, selezionabili anche loro. Stessa `scale`: a
  // schermo sono larghe quanto la nuova. Niente finali propri.
  player_retro_straight: e('player', 0.14, false, 0),
  player_retro_left1: e('player', 0.14, false, 0),
  player_retro_left2: e('player', 0.14, false, 0),
  player_retro_right1: e('player', 0.14, false, 0),
  player_retro_right2: e('player', 0.14, false, 0),
  player_retro_spin_0: e('player', 0.14, false, 0),
  player_retro_spin_1: e('player', 0.14, false, 0),
  player_retro_spin_2: e('player', 0.14, false, 0),
  player_retro_spin_3: e('player', 0.14, false, 0),
  player_retro_brake: e('player', 0.14, false, 0),
  player_sport_straight: e('player', 0.14, false, 0),
  player_sport_left1: e('player', 0.14, false, 0),
  player_sport_left2: e('player', 0.14, false, 0),
  player_sport_right1: e('player', 0.14, false, 0),
  player_sport_right2: e('player', 0.14, false, 0),
  player_sport_spin_0: e('player', 0.14, false, 0),
  player_sport_spin_1: e('player', 0.14, false, 0),
  player_sport_spin_2: e('player', 0.14, false, 0),
  player_sport_spin_3: e('player', 0.14, false, 0),
  player_sport_brake: e('player', 0.14, false, 0),
  // Supercar rossa: gruppo proprio nella pipeline, stessa `scale` (larga a
  // schermo quanto le altre), finali della nuova.
  player_super_straight: e('player', 0.14, false, 0),
  player_super_left1: e('player', 0.14, false, 0),
  player_super_left2: e('player', 0.14, false, 0),
  player_super_right1: e('player', 0.14, false, 0),
  player_super_right2: e('player', 0.14, false, 0),
  player_super_spin_0: e('player', 0.14, false, 0),
  player_super_spin_1: e('player', 0.14, false, 0),
  player_super_spin_2: e('player', 0.14, false, 0),
  player_super_spin_3: e('player', 0.14, false, 0),
  player_super_brake: e('player', 0.14, false, 0),

  // Traffico, misure di spec §13 con collideW = 0.9 · scale.
  traffic_sedan: e('car', 0.14, true, 0.126),
  traffic_hatchback: e('car', 0.13, true, 0.117),
  traffic_van: e('car', 0.16, true, 0.144),
  traffic_truck: e('car', 0.2, true, 0.18),
  // Collaudo utente: a 0,06 la moto era larga meno di metà di una
  // berlina e di lontano non si vedeva. A 0,08 il casco sta poco sopra il
  // tetto di una berlina accanto (a 0,095 era alta una volta e mezza).
  traffic_bike: e('car', 0.08, true, 0.072),
  traffic_coupe: e('car', 0.135, true, 0.1215),
  traffic_offroad: e('car', 0.13, true, 0.117),
  traffic_sportscar: e('car', 0.135, true, 0.1215),
  traffic_bus: e('car', 0.2, true, 0.18),
  traffic_pickup: e('car', 0.15, true, 0.135),
  // Sportive extra del Set 6 (anticipate dal binario I): stessa regola,
  // collideW = 0.9 · scale.
  traffic_supercar: e('car', 0.135, true, 0.1215),
  traffic_roadster: e('car', 0.13, true, 0.117),
  traffic_muscle: e('car', 0.15, true, 0.135),
  traffic_rally: e('car', 0.14, true, 0.126),

  // Spiaggia
  beach_palm_1: s('scenery', 0.55, true, 0.12),
  beach_palm_2: s('scenery', 0.55, true, 0.12),
  beach_umbrella: s('scenery', 0.35, true, 0.3),
  beach_hut: s('scenery', 0.7, true, 0.65),
  beach_surf_sign: s('scenery', 0.35, true, 0.3),
  beach_bush: s('scenery', 0.3, false, 0),

  // Deserto
  desert_cactus_1: s('scenery', 0.3, true, 0.15),
  desert_cactus_2: s('scenery', 0.35, true, 0.3),
  desert_rock_1: s('scenery', 0.55, true, 0.5),
  desert_rock_2: s('scenery', 0.5, true, 0.4),
  desert_dead_tree: s('scenery', 0.4, true, 0.1),
  desert_skull_sign: s('scenery', 0.25, true, 0.1),

  // Montagna
  alpine_pine_1: s('scenery', 0.45, true, 0.15),
  alpine_pine_2: s('scenery', 0.45, true, 0.15),
  alpine_chalet: s('scenery', 0.75, true, 0.7),
  alpine_fence: s('scenery', 0.5, true, 0.45),
  alpine_rock: s('scenery', 0.5, true, 0.45),
  alpine_cow: s('scenery', 0.35, true, 0.3),

  // Campagna
  farm_haybale: s('scenery', 0.35, true, 0.3),
  farm_windmill: s('scenery', 0.6, true, 0.4),
  farm_barn: s('scenery', 0.8, true, 0.75),
  farm_vine_row: s('scenery', 0.55, true, 0.5),
  farm_oak: s('scenery', 0.7, true, 0.15),
  farm_sunflowers: s('scenery', 0.35, false, 0),

  // Città
  town_arch: s('scenery', 0.75, true, 0.7),
  town_column: s('scenery', 0.2, true, 0.15),
  town_lamp: s('scenery', 0.18, true, 0.08),
  town_facade: s('scenery', 0.85, true, 0.8),
  town_fountain: s('scenery', 0.55, true, 0.5),
  town_cypress: s('scenery', 0.22, true, 0.1),

  // Set 2, scenografia (spec §13). Un cartello stradale è alto quanto un'auto,
  // non quanto una capanna: 0.3 e 0.25 erano enormi a schermo, mai visti prima
  // del task 21 perché nessuna sezione li piazzava davvero sul tracciato
  // (fix round 1). `collideW` scala in proporzione, come nella voce originale.
  //
  // Task «cartelli di curva visibili»: a 0.11 il chevron era invisibile a
  // 250 km/h (segnalazione utente «non vedo i cartelli delle curve»). 0.22 è
  // l'ordine di grandezza dell'auto del giocatore (0.14, senza il fattore
  // `WIDE_ROAD_FACTOR`): a schermo il cartello risulta un po' più largo
  // dell'auto, leggibile da lontano come nei racer arcade dell'epoca. `collideW` resta
  // stretto (0.037, non riscalato in proporzione): un pannello sottile,
  // solido ma senza allargare l'ostacolo.
  common_sign_chevron: s('scenery', 0.22, true, 0.037),
  common_sign_speed: s('scenery', 0.11, true, 0.035),
  common_lamp_highway: s('scenery', 0.2, true, 0.06),
  common_bridge_pylon: s('scenery', 0.45, true, 0.4),
  common_boulder_large: s('scenery', 0.55, true, 0.5),
  beach_lifeguard_tower: s('scenery', 0.5, true, 0.3),
  beach_boat: s('scenery', 0.5, true, 0.42),
  beach_rock_arch: s('scenery', 0.8, true, 0.2),
  desert_pillar: s('scenery', 0.3, true, 0.26),
  desert_bush_dry: s('scenery', 0.28, false, 0),
  alpine_snow_pine: s('scenery', 0.5, true, 0.16),
  alpine_signpost: s('scenery', 0.28, true, 0.08),
  farm_tractor: s('scenery', 0.32, true, 0.28),
  farm_fence_wood: s('scenery', 0.55, true, 0.5),
  farm_silo: s('scenery', 0.35, true, 0.3),
  town_cafe: s('scenery', 0.7, true, 0.6),
  town_bus_stop: s('scenery', 0.4, true, 0.34),
  town_tower: s('scenery', 0.4, true, 0.34),

  // Comuni
  common_billboard: s('scenery', 0.65, true, 0.6),
  common_bush_1: s('scenery', 0.3, false, 0),
  common_bush_2: s('scenery', 0.3, false, 0),
  common_boulder: s('scenery', 0.35, true, 0.3),
  // Solo procedurali
  common_barrier: s('scenery', 0.2, true, 0.18),
  common_gantry: s('scenery', 2.6, false, 0),

  // Set 4, spettatori (spec §13). `common_crowd` è larga mezza strada: a
  // `offset ±1.5` il suo bordo interno cade sul bordo dell'asfalto.
  // L'auto del giocatore è larga 233 px e alta 146, cioè circa 1,16 m: una
  // persona in piedi sta fra 1,5 e 1,9 volte quell'altezza. Con 0.45 e 0.22 i
  // bagnanti erano alti 4,1 volte l'auto e l'uomo con la bandiera 3,8, cioè
  // quanto una capanna (revisione visiva del task 15). `common_crowd` resta
  // a 0.65: la sua fila di spettatori misura 1,4 volte l'auto.
  beach_bathers: s('scenery', 0.17, false, 0),
  common_crowd: s('scenery', 0.65, false, 0),
  common_flagman: s('scenery', 0.11, true, 0.04),

  // Set 5, momenti di gara (spec §4.4e, §13). I tre portali usano `e()` e
  // non `s()`: la loro larghezza è definita rispetto alla strada, che
  // devono scavalcare, quindi non va corretta per l'allargamento a 2600.
  // `scale = 1` è esattamente la larghezza della strada.
  race_start_gantry: e('scenery', 1.35, false, 0),
  // Il checkpoint cade in fondo alla zona di bivio, dove dal bivio v3 c'è un
  // portale per ramo della Y e dopo il commit la strada del giocatore è una
  // sola, larga al più una base (spec §4.4, §4.4e). 1.7 porta le gambe
  // (`CHECKPOINT_LEGS`) fra 1,22 e 1,57 semilarghezze dal centro: oltre il
  // cordolo anche con base 1 e tre corsie (1 + 1/6), sulla banchina o
  // sull'erba, e ben dentro le bandiere a `FLAG_OFFSET = 1.9`. Era 2.8, la
  // larghezza delle due carreggiate parallele della v2.
  race_checkpoint: e('scenery', 1.7, false, 0),
  race_goal: e('scenery', 1.35, false, 0),
  race_flag_left: s('scenery', 0.2, false, 0),
  race_flag_right: s('scenery', 0.2, false, 0),
  race_finish_flags: s('scenery', 0.24, false, 0),
  // Tabelloni e pannelli del bivio: non solidi, perché la zona di bivio è
  // dove chi gioca cambia lato (spec §4.4e).
  race_fork_left: s('scenery', 0.42, false, 0),
  race_fork_right: s('scenery', 0.42, false, 0),
  race_direction_left: s('scenery', 0.3, false, 0),
  race_direction_right: s('scenery', 0.3, false, 0),
  // Segnali di curva: solidi e stretti come il chevron del Set 2.
  race_speed_sign: s('scenery', 0.11, true, 0.035),
  // Cartello di pericolo, stesso task del chevron: 0.2 lo rende leggibile
  // quanto il chevron a 250 km/h. `collideW` non cambia: resta sottile.
  race_caution_sign: s('scenery', 0.2, true, 0.038),
  // Sovrapposizioni dell'HUD: la scala non conta, non sono nel mondo.
  race_start_lights: e('ui', 1, false, 0, 0.5),
  race_finish_banner: e('ui', 1, false, 0, 0.5),

  // Set 5, sprite di particella (spec §4.4b, §13). `kind: 'ui'` perché
  // vivono in coordinate di schermo: la scala di catalogo non li tocca,
  // la misura la decide la particella.
  fx_dust_small: e('ui', 1, false, 0, 0.5),
  fx_dust_large: e('ui', 1, false, 0, 0.5),
  fx_smoke: e('ui', 1, false, 0, 0.5),
  fx_debris_small: e('ui', 1, false, 0, 0.5),
  fx_debris_large: e('ui', 1, false, 0, 0.5),
  fx_sparks: e('ui', 1, false, 0, 0.5),
  fx_speed_lines: e('ui', 1, false, 0, 0.5),
  fx_impact: e('ui', 1, false, 0, 0.5),
  fx_water_splash: e('ui', 1, false, 0, 0.5),
  fx_grass_spray: e('ui', 1, false, 0, 0.5),

  // Set 5, vita a bordo strada (spec §13). Nessuno è solido: la gente a
  // bordo strada guarda passare, non fa da ostacolo. L'auto del
  // giocatore è 0.14: una figura sola sta intorno a 0.6 volte tanto.
  npc_photographer: s('scenery', 0.11, false, 0),
  npc_cyclist: s('scenery', 0.12, false, 0),
  npc_surfer: s('scenery', 0.1, false, 0),
  npc_couple: s('scenery', 0.13, false, 0),
  npc_dog: s('scenery', 0.09, false, 0),
  npc_sheep: s('scenery', 0.16, false, 0),
  npc_sailboat: s('scenery', 0.3, false, 0),
  // I gabbiani sono una sovrapposizione 2D con parallasse, non scenografia
  // in prospettiva (spec §13): li disegna `render/wildlife.ts`.
  npc_seagull_0: e('ui', 1, false, 0, 0.5),
  npc_seagull_1: e('ui', 1, false, 0, 0.5),
  npc_seagull_2: e('ui', 1, false, 0, 0.5),

  // Set 5, cornice arcade (spec §11, §13). La mappa è un'illustrazione a
  // tutto schermo; le altre sei sono sovrapposte all'interfaccia.
  map_full: e('illustration', 1, false, 0, 0.5),
  radio_track_icons: e('ui', 1, false, 0, 0.5),
  transition_arrow: e('ui', 1, false, 0, 0.5),
  transition_sunset: e('ui', 1, false, 0, 0.5),
  transition_wipe: e('ui', 1, false, 0, 0.5),
  ending_border: e('ui', 1, false, 0, 0.5),
  menu_cursor: e('ui', 1, false, 0, 0.5),

  // Texture ripetibili (spec §4.4a). La scala non conta: non sono sprite.
  ground_beach: e('texture', 1, false, 0),
  ground_desert: e('texture', 1, false, 0),
  ground_alpine: e('texture', 1, false, 0),
  ground_farm: e('texture', 1, false, 0),
  ground_town: e('texture', 1, false, 0),
  asphalt: e('texture', 1, false, 0),
  // Tessere di superficie (spec §4.4f): sterrato e neve sulla carreggiata,
  // al posto dell'asfalto velato. Stessa regola delle altre tessere.
  ground_dirt_road: e('texture', 1, false, 0),
  ground_snow_road: e('texture', 1, false, 0),

  // Pareti continue (spec §4.4c). `solid: false` perché la voce descrive la
  // tessera, non un oggetto piazzato: l'urto usa WALL_COLLIDE_W di
  // src/game/wall-hit.ts.
  wall_rock_red: e('wall', 1, false, 0),
  wall_rock_grey: e('wall', 1, false, 0),
  wall_guardrail: e('wall', 1, false, 0),
  wall_seawall: e('wall', 1, false, 0),
  wall_hedge: e('wall', 1, false, 0),
  wall_bridge_rail: e('wall', 1, false, 0),
  wall_town_facades: e('wall', 1, false, 0),

  // Dettagli del fuori strada (spec §4.4a), solo procedurali.
  ground_tuft: s('scenery', 0.12, false, 0),
  ground_stone: s('scenery', 0.1, false, 0),
  ground_crack: s('scenery', 0.16, false, 0),

  // Sfondi a parallasse
  bg_beach_far: e('background', 1, false, 0),
  bg_beach_near: e('background', 1, false, 0),
  bg_desert_far: e('background', 1, false, 0),
  bg_desert_near: e('background', 1, false, 0),
  bg_alpine_far: e('background', 1, false, 0),
  bg_alpine_near: e('background', 1, false, 0),
  bg_farm_far: e('background', 1, false, 0),
  bg_farm_near: e('background', 1, false, 0),
  bg_town_far: e('background', 1, false, 0),
  bg_town_near: e('background', 1, false, 0),
  bg_beach_clouds: e('background', 1, false, 0),
  bg_desert_clouds: e('background', 1, false, 0),
  bg_alpine_clouds: e('background', 1, false, 0),
  bg_farm_clouds: e('background', 1, false, 0),
  bg_town_clouds: e('background', 1, false, 0),

  // Finali e titolo
  ending_1: e('illustration', 1, false, 0, 0.5),
  ending_2: e('illustration', 1, false, 0, 0.5),
  ending_3: e('illustration', 1, false, 0, 0.5),
  ending_4: e('illustration', 1, false, 0, 0.5),
  ending_5: e('illustration', 1, false, 0, 0.5),
  // Finali 1-5 con l'auto classica, quelli di prima del Set 7.
  ending_classic_1: e('illustration', 1, false, 0, 0.5),
  ending_classic_2: e('illustration', 1, false, 0, 0.5),
  ending_classic_3: e('illustration', 1, false, 0, 0.5),
  ending_classic_4: e('illustration', 1, false, 0, 0.5),
  ending_classic_5: e('illustration', 1, false, 0, 0.5),
  title_logo: e('ui', 1, false, 0, 0.5),

  // Schermata radio (spec §11): sfondo a tutto schermo e pannello in basso.
  screen_attract: e('illustration', 1, false, 0, 0.5),
  radio_panel: e('ui', 1, false, 0, 0.5),
};

/** File strip → nomi logici dei frame, da sinistra a destra. */
export const STRIPS: Record<string, SpriteName[]> = {
  player_strip_turn: ['player_straight', 'player_left1', 'player_left2'],
  player_strip_turn_right: ['player_right1', 'player_right2'],
  player_strip_spin: ['player_spin_0', 'player_spin_1', 'player_spin_2', 'player_spin_3'],
  npc_seagull: ['npc_seagull_0', 'npc_seagull_1', 'npc_seagull_2'],
};

/** Sprite che esistono solo in forma procedurale: nessun PNG previsto. */
export const PROCEDURAL_ONLY: ReadonlySet<SpriteName> = new Set([
  'common_barrier',
  'common_gantry',
  'ground_tuft',
  'ground_stone',
  'ground_crack',
]);

export const SPRITE_NAMES: SpriteName[] = Object.keys(CATALOG);
