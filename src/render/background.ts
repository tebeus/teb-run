import { backdropForStageId, rgbaOf, skyColourAt, type StageBackdrop, type ThemePalette } from './palette';
import type { AssetStore, RaceSnapshot, SpriteAsset, SpriteName } from '../types';

/**
 * `AssetStore` non promette `hasStageBg` (spec §4.4f facoltativa, binario
 * L): quel contratto è condiviso da tutti i binari e non si tocca per un
 * pezzo opzionale. Solo `core/assets.ts` la implementa davvero; qui è un
 * tipo locale per chiamarla se c'è, senza `any`. Un `AssetStore` di test
 * senza questo metodo resta valido: `?.()` non lo chiede mai.
 */
type AssetStoreWithStageBg = AssetStore & { hasStageBg?(name: SpriteName): boolean };

/**
 * Nome dello sprite `far`/`near` da chiedere: quello della tappa se
 * `assets` ne ha caricato davvero il PNG (spec §4.4f facoltativa), altrimenti
 * quello del tema. Evita di chiedere a `assets.get` un nome che non esiste:
 * non lancerebbe, ma disegnerebbe il segnaposto magenta al posto dello
 * sfondo del tema.
 */
function bgSpriteName(
  assets: AssetStore,
  stageId: string | undefined,
  layer: 'far' | 'near',
  themeName: SpriteName,
): SpriteName {
  if (stageId === undefined) return themeName;
  const candidate = `bg_${stageId}_${layer}`;
  return (assets as AssetStoreWithStageBg).hasStageBg?.(candidate) ? candidate : themeName;
}

/** La proiezione fa svanire i segmenti a metà altezza: lì sta l'orizzonte. */
export const HORIZON_RATIO = 0.5;
/** Spostamento verticale massimo degli strati con le colline, in pixel. */
export const FAR_Y_AMPLITUDE = 16;
export const NEAR_Y_AMPLITUDE = 40;
/** Larghezza della striscia di nuvole (spec §13). */
export const CLOUDS_TILE_W = 2048;
/** Deriva costante delle nuvole, pixel al secondo (spec §4.4c). */
export const CLOUD_DRIFT_PX_S = 6;
/** Spostamento verticale delle nuvole con le colline, in pixel. */
export const CLOUD_Y_AMPLITUDE = 8;
/** Quanto le nuvole stanno sopra l'orizzonte, in pixel: il minimo garantito. */
export const CLOUD_LIFT = 24;
/**
 * Quanto il fondo della striscia di nuvole scende dietro la cima dello strato
 * `far`, in pixel: le nuvole spariscono dietro le colline invece di finire con
 * un bordo dritto, e non restano intrappolate fra le colline (spec §4.4c).
 */
export const CLOUD_DIP = 20;

/**
 * Fondo della striscia di nuvole: appena dietro la cima dello strato `far`,
 * e in ogni caso almeno `CLOUD_LIFT` sopra l'orizzonte. Senza questo calcolo
 * la striscia resta a cavallo dell'orizzonte, dove le colline la coprono e i
 * suoi colori si leggono come blocchi in mezzo al terreno. Pura.
 */
export function cloudsBottomY(horizon: number, farH: number, parallaxY: number): number {
  const behindFar = horizon - (Number.isFinite(farH) && farH > 0 ? farH : 0) + CLOUD_DIP;
  const highest = horizon - CLOUD_LIFT;
  return Math.min(behindFar, highest) + parallaxY * CLOUD_Y_AMPLITUDE;
}

/**
 * Altezza della sfumatura sul bordo superiore degli strati di parallasse, in
 * pixel. Le strisce sono ritagliate in alto con una riga dritta, che a schermo
 * si legge come una cucitura orizzontale su tutta la larghezza: qui il bordo
 * si scioglie nel cielo (spec §4.4, «strati che sfumano nel cielo»).
 */
export const LAYER_FADE_PX = 40;
/** Idem per la striscia di nuvole, alta la metà di uno strato. */
export const CLOUD_FADE_PX = 24;

/**
 * Sfuma una fascia verso il cielo: opaca del colore del cielo a `fromY`,
 * trasparente a `toY`. `toY` può stare sopra o sotto `fromY`, così serve sia
 * al bordo superiore sia a quello inferiore di una striscia.
 */
export function fadeToSky(
  ctx: CanvasRenderingContext2D,
  pal: ThemePalette,
  fromY: number,
  toY: number,
  width: number,
  height: number,
): void {
  const span = Math.abs(toY - fromY);
  if (!(span > 0)) return;
  const g = ctx.createLinearGradient(0, fromY, 0, toY);
  g.addColorStop(0, rgbaOf(skyColourAt(pal, fromY, height), 1));
  g.addColorStop(1, rgbaOf(skyColourAt(pal, toY, height), 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, Math.min(fromY, toY), width, span);
}

/** Copie con la cima sfumata, una per immagine e altezza di sfumatura. */
const topFaded = new WeakMap<object, { fade: number; image: CanvasImageSource }>();

/**
 * Copia di `asset` con le prime `fade` righe sfumate **in alfa** verso il
 * trasparente, fatta una volta e poi riusata. Serve a `near` (Set 7): la
 * fascia di cielo opaco di `fadeToSky` copriva anche le nuvole da 256 px
 * dietro lo strato e le tagliava con una riga dritta; sfumando l'alfa dello
 * strato le nuvole restano visibili attraverso la foschia della sua cima.
 * `null` dove non c'è `OffscreenCanvas` (i test): lì resta la fascia.
 */
export function topFadedImage(asset: SpriteAsset, fade: number): CanvasImageSource | null {
  if (typeof OffscreenCanvas === 'undefined' || !(asset.w > 0) || !(asset.h > 0) || !(fade > 0)) return null;
  const key = asset.image as unknown as object;
  const hit = topFaded.get(key);
  if (hit !== undefined && hit.fade === fade) return hit.image;
  const canvas = new OffscreenCanvas(asset.w, asset.h);
  const g = canvas.getContext('2d');
  if (g === null) return null;
  g.drawImage(asset.image, 0, 0, asset.w, asset.h);
  // `destination-in` vale su tutta la tela, non solo sul rettangolo: il
  // gradiente copre l'altezza intera, trasparente in cima e opaco da `fade`
  // in giù, o il resto dello strato sparirebbe.
  g.globalCompositeOperation = 'destination-in';
  const ramp = g.createLinearGradient(0, 0, 0, asset.h);
  ramp.addColorStop(0, 'rgba(0,0,0,0)');
  ramp.addColorStop(Math.min(1, fade / asset.h), 'rgba(0,0,0,1)');
  ramp.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = ramp;
  g.fillRect(0, 0, asset.w, asset.h);
  topFaded.set(key, { fade, image: canvas });
  return canvas;
}

/**
 * x della prima copia di un'immagine affiancata, con offset in giri interi.
 * Il ramo su `f === 0` evita di ritornare -0, che `Object.is` distingue da 0.
 */
export function tileStartX(offset01: number, imgW: number): number {
  const f = offset01 - Math.floor(offset01);
  return f === 0 ? 0 : -f * imgW;
}

/** Cielo a gradiente verticale con i colori del tema (spec §4.4). */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  pal: ThemePalette,
  width: number,
  height: number,
): void {
  const g = ctx.createLinearGradient(0, 0, 0, height * 0.6);
  g.addColorStop(0, pal.sky[0]);
  g.addColorStop(0.55, pal.sky[1]);
  g.addColorStop(1, pal.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

/** Uno strato di parallasse, ripetuto in orizzontale, appoggiato a bottomY. */
export function drawLayer(
  ctx: CanvasRenderingContext2D,
  asset: SpriteAsset,
  offset01: number,
  bottomY: number,
  width: number,
): void {
  if (asset.w <= 0) return; // senza questa guardia il ciclo non avanzerebbe
  for (let x = tileStartX(offset01, asset.w); x < width; x += asset.w) {
    ctx.drawImage(asset.image, x, bottomY - asset.h, asset.w, asset.h);
  }
}

/**
 * Come applicare la variante di tappa a UN disegno di strato: filtro CSS,
 * velo di ripiego, scostamento di offset, specchio, alfa (usata dalla
 * densità delle nuvole). Locale a `drawTintedLayer`/`layerTint`.
 */
interface LayerTint {
  filter: string;
  veil: string;
  veilAlpha: number;
  offset: number;
  mirror: boolean;
  alpha: number;
}

/** Nessuna variante: il disegno è quello di sempre, byte per byte. */
const NO_TINT: LayerTint = { filter: '', veil: '#000000', veilAlpha: 0, offset: 0, mirror: false, alpha: 1 };

/**
 * `LayerTint` di uno strato dalla `StageBackdrop` della tappa (spec §4.4f
 * facoltativa, binario L). Le nuvole tengono un velo più leggero: sono
 * chiare, un velo alla stessa intensità di `far`/`near` le laverebbe via.
 */
function layerTint(b: StageBackdrop, layer: 'far' | 'near' | 'clouds'): LayerTint {
  if (layer === 'far') {
    return { filter: b.farFilter, veil: b.veil, veilAlpha: b.veilAlpha, offset: b.farOffset, mirror: false, alpha: 1 };
  }
  if (layer === 'near') {
    return {
      filter: b.nearFilter,
      veil: b.veil,
      veilAlpha: b.veilAlpha,
      offset: b.nearOffset,
      mirror: b.mirrorNear,
      alpha: 1,
    };
  }
  return {
    filter: b.cloudsFilter,
    veil: b.veil,
    veilAlpha: b.veilAlpha * 0.6,
    offset: b.cloudsOffset,
    mirror: false,
    alpha: b.cloudsAlpha,
  };
}

/**
 * Come `layerTint(b, 'far')`, ma senza il colore (filtro e velo) se lo strato
 * è lo sfondo dedicato della tappa (`bg_<id>_far`, consegna v2) invece di
 * quello condiviso del tema: il PNG di tappa ha già i suoi colori, la tinta
 * serviva solo a distinguere due tappe con lo stesso sprite. Restano lo
 * scostamento di offset e, fuori da qui, la tinta di cielo e nuvole.
 */
function farTint(b: StageBackdrop, dedicated: boolean): LayerTint {
  const tint = layerTint(b, 'far');
  return dedicated ? { ...tint, filter: '', veilAlpha: 0 } : tint;
}

/**
 * `ctx.filter` esiste su ogni Canvas 2D vero (torna la stringa `"none"` di
 * default): il contesto finto dei test non lo definisce affatto, e questo
 * basta a farli passare dal ripiego del velo senza uno stub apposito.
 */
function filterAvailable(ctx: CanvasRenderingContext2D): boolean {
  return typeof (ctx as unknown as { filter?: unknown }).filter === 'string';
}

/** Copie filtrate, una per immagine e stringa di filtro. */
const filtered = new WeakMap<object, Map<string, CanvasImageSource>>();

/**
 * Copia di `asset` con `filter` già applicato, fatta una volta alla prima
 * richiesta e poi riusata. `ctx.filter` a ogni fotogramma costava troppo:
 * sulla build di produzione in Chromium le tappe con il filtro scendevano
 * a 43-51 rAF/s contro 60 senza (consegna v2). `null` dove non c'è
 * `OffscreenCanvas` o un contesto con `filter` (i test): lì resta
 * `ctx.filter` per fotogramma, o il velo.
 */
export function filteredImage(asset: SpriteAsset, filter: string): CanvasImageSource | null {
  if (typeof OffscreenCanvas === 'undefined' || filter === '' || !(asset.w > 0) || !(asset.h > 0)) return null;
  const key = asset.image as unknown as object;
  const byFilter = filtered.get(key) ?? new Map<string, CanvasImageSource>();
  const hit = byFilter.get(filter);
  if (hit !== undefined) return hit;
  const canvas = new OffscreenCanvas(asset.w, asset.h);
  const g = canvas.getContext('2d');
  if (g === null || typeof (g as unknown as { filter?: unknown }).filter !== 'string') return null;
  g.filter = filter;
  g.drawImage(asset.image, 0, 0, asset.w, asset.h);
  byFilter.set(filter, canvas);
  filtered.set(key, byFilter);
  return canvas;
}

/**
 * Come `drawLayer`, con la variante di tappa sopra: stesso numero di
 * `drawImage` di prima, la variante è solo stato del contesto
 * (`ctx.globalAlpha`, `ctx.scale`) più il filtro, che arriva già cotto in
 * una copia di `filteredImage` — o, dove quella non si può fare,
 * `ctx.filter`; solo nel ripiego senza `ctx.filter`, un `fillRect` di velo,
 * mai un secondo `drawImage`.
 */
/**
 * Come `drawTintedLayer`, ma disegna alla misura nativa moltiplicata per
 * `scale` (≤1), appoggiata a `bottomY` come sempre: lo strato risulta più
 * basso e più stretto nella stessa proporzione (stesso rapporto d'aspetto),
 * senza un secondo `drawImage` — `ctx.drawImage` scala già la sorgente
 * nella misura di destinazione che gli si passa. `filteredImage`/
 * `topFadedImage` restano cotti alla misura nativa di `asset` (l'oggetto
 * arrivato qui, non toccato finché non si passa a `drawLayer`): la stessa
 * immagine condivisa da più tappe (es. `bg_beach_near`) a scale diverse non
 * corrompe la loro cache, che non conosce `scale`.
 */
function drawTintedLayer(
  ctx: CanvasRenderingContext2D,
  asset: SpriteAsset,
  offset01: number,
  bottomY: number,
  width: number,
  tint: LayerTint,
  scale: number = 1,
): void {
  if (asset.w <= 0) return;
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * tint.alpha;
  if (tint.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  const canFilter = tint.filter !== '' && filterAvailable(ctx);
  const baked = canFilter ? filteredImage(asset, tint.filter) : null;
  const live = canFilter && baked === null;
  if (live) ctx.filter = tint.filter;
  const drawn = baked === null ? asset : { ...asset, image: baked };
  drawLayer(ctx, scale === 1 ? drawn : { ...drawn, w: drawn.w * scale, h: drawn.h * scale }, offset01 + tint.offset, bottomY, width);
  if (live) ctx.filter = 'none';
  ctx.restore();
  if (!canFilter && tint.veilAlpha > 0 && asset.h > 0) {
    const h = asset.h * scale;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * tint.alpha * tint.veilAlpha;
    ctx.fillStyle = tint.veil;
    ctx.fillRect(0, bottomY - h, width, h);
    ctx.restore();
  }
}

/**
 * Scala (≤1) dello strato `near` quando la sua tappa ha un `far` dedicato
 * (consegna v2): abbastanza piccola perché almeno metà dell'altezza del
 * `far` resti visibile sopra di lui a riposo (le due basi coincidono
 * sull'orizzonte quando `parallax.y = 0`) — senza, `near` è quasi sempre
 * più alto del `far` di tema e lo coprirebbe quasi del tutto (le tappe di
 * spiaggia 1-1 e 4-4, ma con margini stretti anche altrove). 1 (nessuna
 * riduzione) se `near` è già abbastanza basso, o il `far` non è dedicato.
 * Pura.
 */
export function nearScaleForFar(nearH: number, farH: number, dedicated: boolean): number {
  if (!dedicated || !(nearH > 0) || !(farH > 0)) return 1;
  return Math.min(1, farH / 2 / nearH);
}

/** Cielo, due strati di parallasse e il piano di terra sotto l'orizzonte. */
export function renderBackground(
  ctx: CanvasRenderingContext2D,
  pal: ThemePalette,
  parallax: RaceSnapshot['parallax'],
  assets: AssetStore,
  width: number,
  height: number,
  overlay?: { pal: ThemePalette; alpha: number; id?: string },
  stageId?: string,
): void {
  drawSky(ctx, pal, width, height);
  const horizon = height * HORIZON_RATIO;
  // Variante d'aspetto della tappa (spec §4.4f, binario L): assente per un
  // id senza voce, o senza `stageId` (le schermate senza tappa reale, i test
  // che non lo passano) ritorna `NO_BACKDROP`, quindi si disegna come prima.
  const backdrop = backdropForStageId(stageId ?? '');
  const farName = bgSpriteName(assets, stageId, 'far', pal.bgFar);
  const far = assets.get(farName);
  const cloudsY = cloudsBottomY(horizon, far.h, parallax.y);
  const farY = horizon + parallax.y * FAR_Y_AMPLITUDE;
  const nearY = horizon + parallax.y * NEAR_Y_AMPLITUDE;
  const clouds = parallax.clouds ?? 0;

  /**
   * Uno strato più la sfumatura dei suoi bordi. L'ordine conta: la sfumatura
   * di uno strato va applicata **prima** di disegnare quello successivo, che
   * sta più in basso e più avanti, altrimenti la fascia sfumata cancellerebbe
   * anche lui.
   */
  const faded = (
    asset: SpriteAsset,
    offset: number,
    bottomY: number,
    fade: number,
    fadeBottom: boolean,
    tint: LayerTint = NO_TINT,
    scale: number = 1,
  ): void => {
    drawTintedLayer(ctx, asset, offset, bottomY, width, tint, scale);
    if (!(asset.h > 0)) return;
    const topY = bottomY - asset.h * scale;
    fadeToSky(ctx, pal, topY, topY + fade, width, height);
    if (fadeBottom) fadeToSky(ctx, pal, bottomY, bottomY - fade, width, height);
  };
  /** `near`: la cima sfuma in alfa sopra le nuvole, se si può; se no la fascia. */
  const fadedNear = (
    asset: SpriteAsset,
    offset: number,
    bottomY: number,
    tint: LayerTint = NO_TINT,
    scale: number = 1,
  ): void => {
    const image = topFadedImage(asset, LAYER_FADE_PX);
    if (image === null) {
      faded(asset, offset, bottomY, LAYER_FADE_PX, false, tint, scale);
      return;
    }
    drawTintedLayer(ctx, { ...asset, image }, offset, bottomY, width, tint, scale);
  };

  // Nuvole: fra il cielo e `far` (spec §4.4c). `clouds` è opzionale nello
  // snapshot: senza offset stanno ferme, non spariscono.
  faded(assets.get(pal.clouds), clouds, cloudsY, CLOUD_FADE_PX, true, layerTint(backdrop, 'clouds'));
  // get() non lancia mai: senza PNG arriva il procedurale o il segnaposto.
  const dedicatedFar = farName !== pal.bgFar;
  faded(far, parallax.far, farY, LAYER_FADE_PX, false, farTint(backdrop, dedicatedFar));
  const nearName = bgSpriteName(assets, stageId, 'near', pal.bgNear);
  const nearAsset = assets.get(nearName);
  fadedNear(nearAsset, parallax.near, nearY, layerTint(backdrop, 'near'), nearScaleForFar(nearAsset.h, far.h, dedicatedFar));

  // Strati del tema nuovo sopra i vecchi, con l'alfa del progresso (spec §4.4d).
  // La variante segue la tappa di arrivo (`overlay.id`), come le tessere di
  // `overlay.pal` seguono già il tema di arrivo: la transizione passa dalla
  // variante vecchia (sopra) alla nuova (qui) con lo stesso incrocio di alfa.
  if (overlay !== undefined && overlay.alpha > 0) {
    const overlayBackdrop = backdropForStageId(overlay.id ?? '');
    ctx.globalAlpha = overlay.alpha;
    faded(
      assets.get(overlay.pal.clouds),
      clouds,
      cloudsY,
      CLOUD_FADE_PX,
      true,
      layerTint(overlayBackdrop, 'clouds'),
    );
    const overlayFarName = bgSpriteName(assets, overlay.id, 'far', overlay.pal.bgFar);
    const overlayFar = assets.get(overlayFarName);
    const overlayDedicatedFar = overlayFarName !== overlay.pal.bgFar;
    faded(overlayFar, parallax.far, farY, LAYER_FADE_PX, false, farTint(overlayBackdrop, overlayDedicatedFar));
    const overlayNearName = bgSpriteName(assets, overlay.id, 'near', overlay.pal.bgNear);
    const overlayNear = assets.get(overlayNearName);
    fadedNear(
      overlayNear,
      parallax.near,
      nearY,
      layerTint(overlayBackdrop, 'near'),
      nearScaleForFar(overlayNear.h, overlayFar.h, overlayDedicatedFar),
    );
    ctx.globalAlpha = 1;
  }

  // Terra sotto l'orizzonte: copre i piedi degli strati e i buchi fra i segmenti.
  ctx.fillStyle = pal.grassDark;
  ctx.fillRect(0, horizon, width, height - horizon);
}
