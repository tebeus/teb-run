import { describe, expect, test } from 'vitest';
import { CATALOG } from '../../src/art/catalog';
import { LOGICAL_H, LOGICAL_W } from '../../src/core/canvas';
import { initialPlayer } from '../../src/game/player';
import { createFullRace, updateVisible } from '../../src/game/race';
import { createStageGraph } from '../../src/game/stage-graph';
import { STAGE_LIST, stageById } from '../../src/game/stages';
import { buildTrack, commitFork, FORK_COMMIT, FORK_ZONE_SEGMENTS, MIN_STAGE_SEGMENTS } from '../../src/game/track';
import { spawnTraffic } from '../../src/game/traffic';
import { createParticles } from '../../src/render/effects';
import { renderWorld } from '../../src/render/world';
import { SEGMENT_LENGTH } from '../../src/render/project';
import { createSkidTrail, MAX_SKID_SEGMENTS } from '../../src/render/skid';
import type { SkidTrail } from '../../src/render/skid';
import type { AssetStore, RaceSnapshot, SpriteAsset, StageDef } from '../../src/types';
import { createRecordCtx } from '../helpers/recordCtx';
import { driveToward, has } from '../helpers/race-script';

/**
 * Tetto delle chiamate di disegno costose in un frame. Non è un
 * cronometro: è il modo deterministico di accorgersi che il costo per frame è
 * cambiato di un ordine di grandezza.
 *
 * **Regola dei tetti:** il tetto sta almeno il 20% sopra il frame **peggiore**
 * misurato, non un fattore due. Un tetto al 99,9% del misurato (come lo era
 * `PAINT_BUDGET` prima del fix del task 21) è fragile.
 *
 * Storia delle misure, tutte sul frame più carico della tappa più pesante
 * (Sunset Lagoon, 300 segmenti, texture, pareti, traffico, particelle):
 * 2958 / 470 / 90 prima del task 21; 3996 / 480 / 121 con la chicane;
 * 3871 / 1134 / 198 con la doppia carreggiata; 4536 / 1386 / 452 con i pesi
 * di spec §5/§9 del task 14; 4655 / 1387 / 452 con il velo per tema del
 * task 24.
 *
 * Il task 15 misura **quattro** frame invece di uno, perché il più carico non
 * è quello che si campionava:
 *
 * | frame | paint | drawImage | clip |
 * |---|---|---|---|
 * | metà tappa, 6 tick di particelle | 4658 | 1386 | 452 |
 * | zona di bivio (due carreggiate nuove, niente usura) | 3070 | 321 | 39 |
 * | particelle al massimo (256 vive) | 4874 | 1386 | 452 |
 * | **transizione fra tappe + particelle al massimo** | **5800** | **2206** | **558** |
 *
 * La transizione raddoppia le immagini di strada e i ritagli, perché ogni
 * fetta di terreno e di asfalto si disegna due volte, con la tessera vecchia
 * e con quella nuova (spec §4.4d); le particelle piene aggiungono 220 `fill`.
 * I tetti sono quel 5800 / 2206 / 558 più il 20%. Il gioco vero gira a
 * 111-121 rAF/s su questo frame, senza errori di console.
 *
 * **Rimisurato sul merge `binario-hg`** (binario H dentro il binario G, con
 * la zona libera dal traffico a 180 segmenti invece di 150): 4651 / 1379 /
 * 452, 3068 / 319 / 39, 4867 / 1379 / 452, e **5793 / 2199 / 558** in
 * transizione. Il frame peggiore cala di sette `paint` e sette `drawImage`
 * perché la zona libera più lunga toglie un veicolo dal campo visivo del
 * frame campionato. I tetti reggono la regola del 20% senza cambiare
 * (5793 · 1,2 = 6952 ≤ 7000; 2199 · 1,2 = 2639 ≤ 2700; 558 · 1,2 = 670 ≤
 * 680), e il test "per il verbale" qui sotto la fa valere a ogni esecuzione.
 *
 * **Rimisurato sul brief del controllore `fork-geometry-brief.md`** (binario
 * H, deroga di geometria: `FORK_ZONE_SEGMENTS` 200 → 320, allargamento nel
 * primo 30 % della zona, isola fino a `FORK_ZONE_SPLIT_MAX = 1.0` invece di
 * `FORK_SPLIT_MAX = 0.8`): 4630 / 1268 / 335 a metà tappa, 3068 / 319 / 39
 * sulla zona di bivio campionata (resta il rettilineo finale di livello 4,
 * senza isola: la zona vera non cambia questo campione), 4846 / 1268 / 335
 * con le particelle al massimo, **5824 / 2088 / 441** in transizione. Nuovo
 * quinto campione, sull'uscita dal bivio (la carreggiata scartata che si
 * allontana, `forkExit`, appena dopo una giunzione vera su `createFullRace`):
 * 3828 / 332 / 40, ben sotto il frame peggiore — la zona più larga non
 * aggiunge poligoni al disegno dell'uscita (`drawForkExitRoad` non è
 * cambiata). Il frame peggiore resta la transizione e cala leggermente
 * rispetto al merge `binario-hg` (5793 → 5824 è quasi lo stesso, la
 * differenza sta nel traffico e nella scenografia del corpo più corto, non
 * nella zona). I tetti reggono la regola del 20% senza cambiare (5824 · 1,2 =
 * 6989 ≤ 7000; 2088 · 1,2 = 2506 ≤ 2700; 441 · 1,2 = 529 ≤ 680), e il test
 * "per il verbale" qui sotto la fa valere a ogni esecuzione.
 *
 * **Rimisurato sul terzo addendum del collaudo** (uscita dal bivio vera:
 * `FORK_EXIT_SEGMENTS` 150 → 360, `drawForkExitRoad` disegna anche le linee
 * di corsia, come la strada vera): 4630 / 1268 / 335 a metà tappa, 3067 / 318
 * / 39 sulla zona di bivio campionata (invariata, stesso motivo di sopra),
 * 4846 / 1268 / 335 con le particelle al massimo, **5824 / 2088 / 441** in
 * transizione (invariata: le corsie dell'uscita non toccano quel campione).
 * Il campione sull'uscita dal bivio sale da 3828 / 332 / 40 a
 * **4990 / 312 / 40** (+1162 `paint`, le linee di corsia in più), ma resta
 * ben sotto il frame peggiore (transizione), che quindi continua a fissare i
 * tetti senza cambiarli (regola del 20% già verificata sopra).
 *
 * **Rimisurato dopo il task 10 di questo binario** (detriti, scintille,
 * impatto, spruzzi, erba e righe di velocità, più le 40 tick di striscia di
 * gomma di `createSkidTrail` che ora entrano in `countFrame`): le 256
 * particelle passano da un `fill` a un `drawImage` ciascuna, quindi i
 * `drawImage` salgono e i `paint`/`clip` restano quasi identici (un
 * `drawImage` prende il posto di un `fill`). Misurato sui quattro frame:
 *
 * | frame | paint | drawImage | clip |
 * |---|---|---|---|
 * | metà tappa | 4624 | 1406 | 432 |
 * | zona di bivio | 3088 | 373 | 39 |
 * | particelle al massimo | 4800 | 1582 | 432 |
 * | **transizione fra tappe** | **5778** | **2402** | **538** |
 *
 * Il peggiore è la transizione: la regola del 20% chiede 6934 / 2883 / 646,
 * e i tre tetti sotto la rispettano. `IMAGE_BUDGET` sale a 3000 (non
 * scende), `PAINT_BUDGET` e `CLIP_BUDGET` non cambiano.
 *
 * **Addendum alla revisione del task 9**: i 40 tick sopra marcano un solo
 * segmento, perché passano sempre lo stesso `snapshot` (`player.z` non
 * cambia da un tick all'altro), quindi la piscina delle strisce non si
 * riempiva mai per davvero e non contribuiva quasi nulla al conteggio.
 * `fillSkidTrail` occupa invece tutti i `MAX_SKID_SEGMENTS` = 320 slot con
 * una derapata lunga, allineata così che la parte più recente cada dentro
 * la finestra dei 300 segmenti visibili, e un quinto frame la misura sul
 * caso di metà tappa: **5006 / 1406 / 432**, sotto il peggiore su tutte e
 * tre le colonne (5006 < 5778, 1406 < 2402, 432 < 538): i tetti non
 * cambiano. Il costo proprio della striscia piena, isolato dal resto (5006
 * meno i 4624 di metà tappa con i 40 tick), è 382 `paint` in più, cioè il
 * 5,5% di `PAINT_BUDGET`: sotto la soglia del 10% che avrebbe richiesto di
 * segnalarlo come voce a parte.
 *
 * I portali non entrano in nessuno dei cinque frame. Il giocatore è a
 * metà tappa o nella zona di bivio, e i portali stanno a `CROWD_START` e a
 * `FLAGMAN_FROM_END` dalla fine: nessuno dei due cade nella finestra di 300
 * segmenti. Misurati a parte, i frame che **contengono** un portale
 * costano **meno** del peggiore di questi (3217 `paint`, 463 `drawImage`,
 * 85 `clip` sul segmento del portale di partenza), quindi il tetto resta
 * valido; ma non è una copertura, e la prossima rimisura non deve fidarsene.
 *
 * **Rimisurato sul bivio v3** (deroga «bivio v3, collaudo utente»: la Y
 * vera, `commitFork`, la strada scartata con i due capi, il velo e il
 * taglio dell'asfalto per carreggiata quando c'è l'isola). Due campioni
 * nuovi, su una tappa vera con bivio (0-0): la Y statica appena prima della
 * punta e la strada scelta dieci segmenti dopo il commit.
 *
 * | frame | paint | drawImage | clip |
 * |---|---|---|---|
 * | metà tappa | 4687 | 1320 | 335 |
 * | zona di bivio (livello 4, rettilineo) | 3092 | 377 | 39 |
 * | particelle al massimo | 4863 | 1496 | 335 |
 * | **transizione fra tappe** | **5841** | **2316** | **441** |
 * | uscita dal bivio | 5278 | 325 | 40 |
 * | Y alla punta | 4486 | 148 | 39 |
 * | Y dopo il commit | 4685 | 150 | 39 |
 * | striscia di gomma piena | 5069 | 1320 | 335 |
 *
 * Il peggiore resta la transizione, che sale di pochi `paint` perché le
 * doppie carreggiate del corpo ora hanno velo e taglio per carreggiata (due
 * `quad` invece di uno). La regola del 20% chiede 7009 / 2779 / 529:
 * `PAINT_BUDGET` sale da 7000 a 7100, gli altri due tetti non cambiano.
 * L'uscita sale da 4990 a 5278 perché la tappa nuova riavrà scenografia,
 * pareti e acqua sul lato della strada scartata, che ora parte a più di 20
 * unità e non copre più niente (`FORK_EXIT_REACH`).
 *
 * Se il gioco andasse a scatti pur restando sotto i tetti, le leve sono
 * `MIN_TEXTURE_BAND` (alzarla a 1.5) o `WALL_MAX_RATIO` (abbassarlo a 0.45),
 * non il tetto del test.
 *
 * **Binario K, meteo e superfici.** Tre fotogrammi in più, uno per meteo,
 * misurati con la tappa vera e la transizione in corso:
 *
 * | frame | paint | drawImage | clip | stroke |
 * |---|---|---|---|---|
 * | pioggia (3-0 Old Harbor) | 4594 | 936 | 294 | 110 |
 * | sabbia (4-3 Dune Highway) | 3620 | 937 | 369 | 90 |
 * | neve fitta (4-1 Glacier Road) | 5530 | 887 | 252 | 0 |
 *
 * Il peggiore dei sette fotogrammi resta la **transizione su Sunset
 * Lagoon**: 4-4 è di tema `beach`, quindi senza tratti di superficie e con
 * meteo sereno, e su asfalto asciutto questo binario non aggiunge un solo
 * disegno (`surfaceRoadColour` ritorna la stringa che riceve, `hasKerb` è
 * vera, il riflesso non si disegna). Le tappe con meteo costano **meno**
 * del peggiore storico (5841/2316/441): la pioggia aggiunge un `fill` per
 * segmento scuro (il riflesso) ma i sessanta `fill` di fiocchi diventano
 * `stroke` di gocce, e uno sterrato toglie due `quad` di cordolo per
 * segmento. I tre tetti PAINT/IMAGE/CLIP non cambiano: i fotogrammi nuovi
 * stanno tutti sotto il peggiore già misurato. Gli `stroke` hanno il loro
 * tetto, `STROKE_BUDGET` (110 · 1,2 = 132 ≤ 200).
 *
 * **Rimisurato dopo «cartelli di curva visibili»** (spec §13/§4.4e: chevron
 * a scala 0.22 invece di 0.11, cartello di pericolo a 0.2, una fila di 3-8
 * chevron per curva media o peggiore invece di uno solo prima della curva,
 * due chevron sul lato interno delle curve dure, e il triangolo di
 * pericolo sempre sulle curve dure invece che nel 30% dei casi). Più
 * sprite per curva, quindi più `drawImage` nei fotogrammi che ne
 * incontrano:
 *
 * | frame | paint | drawImage | clip |
 * |---|---|---|---|
 * | metà tappa | 4310 | 1313 | 331 |
 * | zona di bivio | 3088 | 376 | 39 |
 * | particelle al massimo | 4486 | 1489 | 331 |
 * | **transizione** | **5464** | **2309** | **437** |
 * | uscita dal bivio | 5275 | 322 | 40 |
 * | Y alla punta | 4481 | 148 | 39 |
 * | Y dopo il commit | 4677 | 150 | 39 |
 * | striscia di gomma piena | 4692 | 1313 | 331 |
 *
 * più i tre fotogrammi del meteo (paint/drawImage/clip/stroke): pioggia
 * 4693/984/345/110, sabbia 3166/884/328/140, **neve fitta
 * 5711/975/345/0**. Il `paint` peggiore non è più la transizione ma la
 * neve fitta (5530 → 5711): i chevron in più sull'anello di curve di
 * Glacier Road pesano più dei due `quad` di cordolo che il tema toglie
 * altrove. `drawImage` e `clip` restano peggiori in transizione, e lo
 * `stroke` peggiore sale un poco con la sabbia (90 → 140, un triangolo di
 * pericolo in più da disegnare col contorno del tema). Nessuno dei
 * quattro tetti si muove: la regola del 20% chiede 6853 / 2771 / 524 /
 * 168, e `PAINT_BUDGET` = 7100, `IMAGE_BUDGET` = 3000, `CLIP_BUDGET` =
 * 680, `STROKE_BUDGET` = 200 li superano già tutti così com'erano. La
 * scenografia non legata ai cartelli (`placeScenery`, `placeWalls`,
 * `placeRoadsideLife`, `placeSailboats`, `placeSurfaces`) non si è mossa
 * di un pixel: `placeChevrons` e `placeCurveSigns` consumano dall'`Rng`
 * esattamente quanto consumavano prima, entrata per entrata, quindi le
 * quindici tappe restano quelle di prima con l'aggiunta dei soli cartelli
 * (verificato confrontando la firma di tutti gli sprite non di curva
 * delle quindici tappe, prima e dopo: identica).
 */
const PAINT_BUDGET = 7100;
const IMAGE_BUDGET = 3000;
const CLIP_BUDGET = 680;
/**
 * Tetto degli `stroke` (spec §4.4f, task 11 di questo binario). Pioggia e
 * sabbia si disegnano con linee, non con riempimenti: il peggiore misurato è
 * la pioggia su 3-0 Old Harbor, 110 `stroke` (`RAIN_DROPS`); 110 · 1,2 = 132,
 * e 200 lascia margine per una meteora nuova senza rimisurare. Separato dai
 * tre tetti sopra perché aggiungere `stroke` a `paints` renderebbe
 * illeggibili i numeri storici dei binari H e I.
 */
const STROKE_BUDGET = 200;

const store = (): AssetStore => ({
  ready: Promise.resolve(),
  get: (name): SpriteAsset => ({
    name,
    image: { name } as unknown as CanvasImageSource,
    w: 512,
    h: 512,
    entry: CATALOG[name] ?? { kind: 'scenery', scale: 0.3, solid: false, collideW: 0, anchorY: 1 },
  }),
  has: () => true,
  stats: { png: 0, procedural: 0, missing: 0 },
});

/**
 * Uno snapshot vero: tracciato vero, traffico vero, giocatore dove si dice.
 * `at` è l'indice di segmento del giocatore; `over` aggiunge o sostituisce
 * campi dello snapshot, per esempio la transizione fra tappe; `stage` è la
 * tappa da montare, e con lei arrivano il suo meteo e i suoi tratti di
 * superficie (spec §4.4f).
 */
function heavySnapshot(
  at = 900,
  over: Partial<RaceSnapshot> = {},
  stage: StageDef = STAGE_LIST[STAGE_LIST.length - 1],
): RaceSnapshot {
  const segments = buildTrack(stage);
  spawnTraffic(segments, stage);
  const player = { ...initialPlayer(), z: at * SEGMENT_LENGTH, speed: 12000, skidding: true };
  return {
    segments: updateVisible(segments, player, LOGICAL_W, LOGICAL_H),
    player,
    crash: { active: false, t: 0, frame: 0 },
    timeLeft: 42,
    score: 1000,
    stage,
    level: 4,
    route: ['L', 'R', 'L', 'R'],
    parallax: { far: 0.2, near: 0.4, y: 0.1, clouds: 0.3 },
    theme: stage.theme,
    banner: 'none',
    kmh: 280,
    ...over,
  };
}

/**
 * Uno snapshot vero appena dopo la giunzione, con la strada secondaria
 * dell'uscita dal bivio (`forkExit`) ancora visibile (brief del controllore:
 * remisura del budget anche sull'uscita, non solo sulla zona di bivio).
 * Guida verso x = 0,85 (come i test del binario H su `createFullRace`)
 * finché non arriva il `checkpoint`, poi ritorna lo snapshot subito dopo.
 */
function forkExitSnapshot(): RaceSnapshot {
  const shortStage = (id: string, name: string): StageDef => ({
    id,
    name,
    theme: 'beach',
    lengthSegments: MIN_STAGE_SEGMENTS,
    timeLimit: 600,
    seed: 4242,
    difficulty: 0,
  });
  const stages = [shortStage('0-0', 'Alpha'), shortStage('1-0', 'Bravo'), shortStage('1-1', 'Charlie')];
  const graph = createStageGraph(stages);
  const race = createFullRace({ graph, assets: store(), startStage: graph.first() });
  let after: RaceSnapshot | null = null;
  driveToward(race, 0.85, (events) => {
    const fired = has(events, 'checkpoint');
    if (fired) after = race.snapshot();
    return fired;
  });
  if (after === null) throw new Error('checkpoint never fired');
  return after;
}

/**
 * La Y del bivio v3 su una tappa vera con bivio (0-0): `committed` falso è
 * la telecamera appena prima della punta, con i due rami statici fino
 * all'orizzonte; vero è dieci segmenti dopo il commit (`commitFork`), con la
 * strada scelta, la scartata che si allontana e l'anteprima dell'uscita.
 */
function forkYSnapshot(committed: boolean): RaceSnapshot {
  const stage = STAGE_LIST.find((st) => st.id === '0-0')!;
  const segments = buildTrack(stage);
  const zoneStart = segments.length - FORK_ZONE_SEGMENTS;
  let x = 0.3;
  let at = zoneStart + FORK_COMMIT - 2;
  if (committed) {
    x += commitFork(segments, 1, stage.roadHalf ?? 1);
    at = zoneStart + FORK_COMMIT + 10;
  }
  const player = { ...initialPlayer(), z: at * SEGMENT_LENGTH, x, speed: 12000 };
  return {
    ...heavySnapshot(),
    segments: updateVisible(segments, player, LOGICAL_W, LOGICAL_H),
    player,
    stage,
    level: 0,
    theme: stage.theme,
    banner: 'fork',
    forkNames: ['SANDSTONE GATE', 'BLUE LAGOON'],
  };
}

/**
 * Conteggi di un frame, per la misura e per i tetti. `trail`, se passata, si
 * disegna così com'è invece dei soliti 40 tick: serve al caso peggiore di
 * `fillSkidTrail`, con tutti i `MAX_SKID_SEGMENTS` occupati.
 */
function countFrame(
  snapshot: RaceSnapshot,
  particleTicks = 6,
  trail?: SkidTrail,
): { paints: number; images: number; clips: number; strokes: number } {
  const rec = createRecordCtx();
  const particles = createParticles(() => 0.5);
  for (let i = 0; i < particleTicks; i++) particles.update(1 / 60, snapshot);
  // Strisce di gomma: 40 tick di derapata marcano il segmento sotto l'auto,
  // due quadrilateri ciascuno (spec §4.4b, task 9 di questo binario).
  const t = trail ?? createSkidTrail();
  if (trail === undefined) for (let i = 0; i < 40; i++) t.update(1 / 60, snapshot);
  renderWorld(rec.ctx, snapshot, store(), particles, { trail: t });
  return {
    paints: rec.ops.filter(
      (op) => op.type === 'fill' || op.type === 'fillRect' || op.type === 'drawImage' || op.type === 'clip',
    ).length,
    images: rec.ops.filter((op) => op.type === 'drawImage').length,
    clips: rec.ops.filter((op) => op.type === 'clip').length,
    // `stroke` **non** entra in `paints`: aggiungerlo cambierebbe il
    // significato dei numeri storici del commento in testa al file (binari
    // H e I). Ha il suo tetto, `STROKE_BUDGET` (spec §4.4f, task 11).
    strokes: rec.ops.filter((op) => op.type === 'stroke').length,
  };
}

/**
 * Striscia di gomma al caso peggiore: tutti i `MAX_SKID_SEGMENTS` occupati
 * da una derapata lunga, allineata a partire dal segmento del giocatore
 * `at`, cosà che la parte più recente (quella vicino alla telecamera) cada
 * dentro la finestra dei segmenti visibili. I 40 tick di `countFrame`
 * marcano un solo segmento (`player.z` non cambia da un tick all'altro fra
 * le chiamate di test): questa invece riempie davvero la piscina, con due
 * soli `update()`, il primo che segna il punto di partenza e il secondo che
 * salta in avanti di `MAX_SKID_SEGMENTS - 1` segmenti (la stessa logica di
 * `mark` in `skid.ts` marca tutti quelli intermedi in un colpo).
 */
function fillSkidTrail(at: number): SkidTrail {
  const trail = createSkidTrail();
  const base = heavySnapshot(at);
  const tick = (z: number): RaceSnapshot => ({ ...base, player: { ...base.player, z, skidding: true, surface: 'road' } });
  trail.update(1 / 60, tick(at * SEGMENT_LENGTH));
  trail.update(1 / 60, tick((at + MAX_SKID_SEGMENTS - 1) * SEGMENT_LENGTH));
  return trail;
}

describe('budget di disegno per frame (prestazioni, spec §16)', () => {
  test('the heaviest frame stays inside the paint budget', () => {
    const rec = createRecordCtx();
    const particles = createParticles(() => 0.5);
    const snapshot = heavySnapshot();
    for (let i = 0; i < 6; i++) particles.update(1 / 60, snapshot);
    const trail = createSkidTrail();
    for (let i = 0; i < 40; i++) trail.update(1 / 60, snapshot);
    renderWorld(rec.ctx, snapshot, store(), particles, { trail });
    const paints = rec.ops.filter(
      (op) => op.type === 'fill' || op.type === 'fillRect' || op.type === 'drawImage' || op.type === 'clip',
    ).length;
    expect(paints).toBeLessThan(PAINT_BUDGET);
  });

  test('the number of drawImage and clip calls stays small', () => {
    const rec = createRecordCtx();
    renderWorld(rec.ctx, heavySnapshot(), store());
    expect(rec.ops.filter((op) => op.type === 'drawImage').length).toBeLessThan(IMAGE_BUDGET);
    expect(rec.ops.filter((op) => op.type === 'clip').length).toBeLessThan(CLIP_BUDGET);
  });

  test('il frame peggiore e quello della transizione, e sta nei tetti', () => {
    const worst = countFrame(heavySnapshot(900, { transition: { from: 'beach', to: 'desert', t: 2 } }), 60);
    expect(worst.paints).toBeLessThan(PAINT_BUDGET);
    expect(worst.images).toBeLessThan(IMAGE_BUDGET);
    expect(worst.clips).toBeLessThan(CLIP_BUDGET);
    // Piu carico di meta tappa senza transizione: e' lui a fissare i tetti.
    const plain = countFrame(heavySnapshot(), 60);
    expect(worst.images).toBeGreaterThan(plain.images);
    expect(worst.clips).toBeGreaterThan(plain.clips);
  });

  test('la zona di bivio costa meno di meta tappa', () => {
    const stage = STAGE_LIST[STAGE_LIST.length - 1];
    const fork = countFrame(heavySnapshot(buildTrack(stage).length - 40));
    expect(fork.paints).toBeLessThan(PAINT_BUDGET);
    expect(fork.images).toBeLessThan(IMAGE_BUDGET);
    expect(fork.clips).toBeLessThan(CLIP_BUDGET);
    expect(fork.paints).toBeLessThan(countFrame(heavySnapshot()).paints);
  });

  test("l'uscita dal bivio (la strada secondaria che si allontana) sta nei tetti", () => {
    // Terzo addendum del collaudo: `drawForkExitRoad` ora disegna anche le
    // linee di corsia, come la strada vera (spec §4.4), non solo banchina,
    // cordolo e asfalto: qualche `fill` in più per segmento marcato
    // `forkExit`, ma resta ben dentro i tetti (misurato: vedi il commento in
    // testa al file).
    const exit = countFrame(forkExitSnapshot());
    expect(exit.paints).toBeLessThan(PAINT_BUDGET);
    expect(exit.images).toBeLessThan(IMAGE_BUDGET);
    expect(exit.clips).toBeLessThan(CLIP_BUDGET);
  });

  test('un frame in transizione disegna le tessere di entrambi i temi', () => {
    const rec = createRecordCtx();
    const snapshot = heavySnapshot(900, { transition: { from: 'beach', to: 'desert', t: 2 } });
    renderWorld(rec.ctx, snapshot, store());
    const names = new Set(rec.ops.filter((op) => op.type === 'drawImage').map((op) => op.image));
    expect(names.has('ground_beach')).toBe(true);
    expect(names.has('ground_desert')).toBe(true);
  });

  test('every save is matched by a restore: no leaked clip', () => {
    const rec = createRecordCtx();
    renderWorld(rec.ctx, heavySnapshot(), store());
    const saves = rec.ops.filter((op) => op.type === 'save').length;
    const restores = rec.ops.filter((op) => op.type === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBeGreaterThan(0);
  });

  test('una derapata lunga (tutti i MAX_SKID_SEGMENTS attivi) sta nei tetti', () => {
    // Addendum alla revisione del task 9: `countFrame` con i suoi 40 tick
    // marca un solo segmento, perché lo stesso `snapshot` passa sempre lo
    // stesso `player.z` — la piscina delle strisce non si riempiva mai per
    // davvero. `fillSkidTrail` la riempie fino al tetto.
    const worst = countFrame(heavySnapshot(900), 6, fillSkidTrail(900));
    expect(worst.paints).toBeLessThan(PAINT_BUDGET);
    expect(worst.images).toBeLessThan(IMAGE_BUDGET);
    expect(worst.clips).toBeLessThan(CLIP_BUDGET);
  });

  test('i cinque frame misurati sono riportati, per il verbale', () => {
    const frames = {
      'meta tappa': countFrame(heavySnapshot(), 6),
      'zona di bivio': countFrame(heavySnapshot(buildTrack(STAGE_LIST[STAGE_LIST.length - 1]).length - 40)),
      'particelle al massimo': countFrame(heavySnapshot(), 60),
      transizione: countFrame(heavySnapshot(900, { transition: { from: 'beach', to: 'desert', t: 2 } }), 60),
      // Quinto frame (brief del controllore): l'uscita dal bivio, con la
      // carreggiata scartata (`forkExit`) ancora in scena.
      'uscita dal bivio': countFrame(forkExitSnapshot()),
      // Bivio v3: la Y statica prima della punta e la strada scelta dopo il commit.
      'Y alla punta': countFrame(forkYSnapshot(false)),
      'Y dopo il commit': countFrame(forkYSnapshot(true)),
      'striscia di gomma piena': countFrame(heavySnapshot(900), 6, fillSkidTrail(900)),
    };
    // Il tetto sta almeno il 20% sopra il frame peggiore misurato: questa e'
    // la regola, non un commento, quindi il test la fa valere (i numeri sono
    // nel commento in testa al file, non serve un console.log qui).
    if (process.env.DRAW_BUDGET_LOG === '1') console.info(JSON.stringify(frames));
    const worst = Object.values(frames).reduce((a, b) => ({
      paints: Math.max(a.paints, b.paints),
      images: Math.max(a.images, b.images),
      clips: Math.max(a.clips, b.clips),
      strokes: Math.max(a.strokes, b.strokes),
    }));
    expect(PAINT_BUDGET).toBeGreaterThanOrEqual(worst.paints * 1.2);
    expect(IMAGE_BUDGET).toBeGreaterThanOrEqual(worst.images * 1.2);
    expect(CLIP_BUDGET).toBeGreaterThanOrEqual(worst.clips * 1.2);
  });

  test('i tre frame del meteo, e stanno nei tetti', () => {
    // Le tre tappe con il meteo più costoso, ognuna a metà tappa con le
    // particelle al massimo e la transizione in corso: il caso peggiore
    // che il meteo può produrre (spec §4.4f).
    const frames = {
      'pioggia (3-0 Old Harbor)': countFrame(
        heavySnapshot(900, { transition: { from: 'farm', to: 'town', t: 2, fromId: '2-2' } }, stageById('3-0')),
        60,
      ),
      'sabbia (4-3 Dune Highway)': countFrame(
        heavySnapshot(900, { transition: { from: 'alpine', to: 'desert', t: 2, fromId: '3-1' } }, stageById('4-3')),
        60,
      ),
      'neve fitta (4-1 Glacier Road)': countFrame(
        heavySnapshot(900, { transition: { from: 'town', to: 'alpine', t: 2, fromId: '3-0' } }, stageById('4-1')),
        60,
      ),
    };
    const line = Object.entries(frames)
      .map(([k, v]) => `${k} ${v.paints}/${v.images}/${v.clips}/${v.strokes}`)
      .join(', ');
    console.log(`budget del meteo (paint/drawImage/clip/stroke): ${line}`);
    for (const [name, v] of Object.entries(frames)) {
      expect(v.paints, name).toBeLessThan(PAINT_BUDGET);
      expect(v.images, name).toBeLessThan(IMAGE_BUDGET);
      expect(v.clips, name).toBeLessThan(CLIP_BUDGET);
      expect(v.strokes, name).toBeLessThan(STROKE_BUDGET);
    }
    // La regola dei tetti vale anche su questi: il tetto sta almeno il
    // 20% sopra il peggiore misurato.
    const worst = Object.values(frames).reduce((a, b) => ({
      paints: Math.max(a.paints, b.paints),
      images: Math.max(a.images, b.images),
      clips: Math.max(a.clips, b.clips),
      strokes: Math.max(a.strokes, b.strokes),
    }));
    expect(PAINT_BUDGET).toBeGreaterThanOrEqual(worst.paints * 1.2);
    expect(IMAGE_BUDGET).toBeGreaterThanOrEqual(worst.images * 1.2);
    expect(CLIP_BUDGET).toBeGreaterThanOrEqual(worst.clips * 1.2);
    expect(STROKE_BUDGET).toBeGreaterThanOrEqual(worst.strokes * 1.2);
  });

  test('uno sterrato costa meno di un asfalto: i cordoli non si disegnano', () => {
    // 2-0 Red Canyon ha tratti di sterrato (spec §4.4f): due `quad` di
    // cordolo in meno per ogni segmento visibile.
    //
    // Il confronto è fra lo **stesso** fotogramma con e senza il tratto,
    // non fra due posizioni diverse della tappa: scenografia, pareti e
    // traffico cambiano da un punto all'altro e dominano largamente i
    // due `quad` risparmiati.
    const stage = stageById('2-0');
    const segs = buildTrack(stage);
    const inRun = segs.find((s) => (s.surfaceMix ?? 0) >= 1);
    expect(inRun, 'la tappa 2-0 deve avere un tratto di sterrato').toBeDefined();
    const withRun = heavySnapshot(inRun!.index, {}, stage);
    // Copia i segmenti, non li muta: sono oggetti vivi del motore, e
    // azzerare `surfaceKind` su quelli veri lascerebbe la tappa senza
    // tratti per gli altri test dello stesso file.
    const stripped: RaceSnapshot = {
      ...withRun,
      segments: withRun.segments.map((seg) => ({ ...seg, surfaceKind: undefined, surfaceMix: undefined })),
    };
    expect(countFrame(withRun).paints).toBeLessThan(countFrame(stripped).paints);
  });

  test('il frame peggiore resta quello della transizione su Sunset Lagoon', () => {
    // 4-4 è di tema `beach`: nessun tratto di superficie, meteo sereno,
    // e quindi il meteo non aggiunge un solo disegno a quel fotogramma
    // (spec §4.4f). Se questa asserzione cade, qualcosa di questo
    // binario è finito dove non doveva.
    const worst = countFrame(heavySnapshot(900, { transition: { from: 'beach', to: 'desert', t: 2 } }), 60);
    expect(worst.strokes).toBe(0);
    expect(worst.paints).toBeLessThan(PAINT_BUDGET);
  });

  test('the frame leaves the alpha at one', () => {
    const rec = createRecordCtx();
    renderWorld(rec.ctx, heavySnapshot(), store());
    expect(rec.ctx.globalAlpha).toBe(1);
  });
});
