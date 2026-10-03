import type { SurfaceKind, Weather } from '../types';

/**
 * Aderenza per superficie (spec §5): 1 è l'asfalto asciutto, e tutto il
 * resto è meno. Il numero entra nella fisica come divisore della
 * centrifuga e dello scivolamento e come moltiplicatore delle soglie di
 * derapata, quindi 0.7 non vuol dire «il 70% della presa» in senso
 * fisico: vuol dire «la neve di questo gioco», tarata a mano contro il
 * test del pilota prudente (`tests/game/balance.test.ts`).
 */
export const SURFACE_GRIP: Readonly<Record<SurfaceKind, number>> = {
  asphalt: 1,
  wet: 0.85,
  dirt: 0.8,
  snow: 0.7,
};

/**
 * Sopra questa miscela il tratto è la superficie che si vede e si sente:
 * serve solo a chi vuole **un** nome invece di una miscela (la pagina di
 * diagnostica, i test, un messaggio di errore). Il renderer e la fisica
 * usano la miscela, non il nome.
 */
export const DOMINANT_MIX = 0.5;

/** Il minimo che serve a risolvere una superficie: un `Segment` lo soddisfa. */
export interface SurfaceSource {
  surfaceKind?: SurfaceKind;
  surfaceMix?: number;
}

/**
 * Le due superfici di un segmento e quanto vale la seconda sulla prima.
 * `base` viene dal meteo della tappa e vale su tutta la tappa; `kind`
 * viene dal tratto e vale solo dove il generatore l'ha scritto. Fuori
 * dai tratti le due coincidono e `mix` è zero, che è il caso di gran
 * lunga più comune: quasi tutti i segmenti di quasi tutte le tappe.
 */
export interface SurfaceBlend {
  base: SurfaceKind;
  kind: SurfaceKind;
  /** In `[0, 1]`: 0 = solo `base`, 1 = solo `kind`. */
  mix: number;
}

/**
 * Superficie di fondo di una tappa (spec §4.4f): solo la pioggia bagna,
 * e bagna tutto. Neve e sabbia cadono dal cielo e non cambiano l'asfalto
 * da sole: la neve **sulla strada** è un tratto, scritto dal generatore.
 * Pura.
 */
export function baseSurfaceFor(weather: Weather = 'clear'): SurfaceKind {
  return weather === 'rain' ? 'wet' : 'asphalt';
}

/**
 * La miscela di un segmento, sempre in `[0, 1]` (Review Focus 1): un
 * campo assente vale 0, uno fuori intervallo viene riportato dentro, e
 * uno non finito (`NaN`, `±Infinity`) vale 0 come uno assente: un dato
 * rotto non inventa un tratto, e un `NaN` che si propagasse nell'aderenza
 * renderebbe `NaN` la posizione del giocatore. Pura.
 */
export function surfaceMixOf(seg: SurfaceSource): number {
  const m = seg.surfaceMix;
  if (m === undefined || !Number.isFinite(m)) return 0;
  return m < 0 ? 0 : m > 1 ? 1 : m;
}

/**
 * Risolve fondo, tratto e miscela di un segmento (spec §4.4f). Un
 * tratto del **tipo del fondo** non è un tratto: si riduce al fondo con
 * miscela zero, così `mix > 0` implica sempre due superfici davvero
 * diverse. Pura.
 */
export function surfaceBlendOf(seg: SurfaceSource, weather: Weather = 'clear'): SurfaceBlend {
  const base = baseSurfaceFor(weather);
  const kind = seg.surfaceKind;
  if (kind === undefined || kind === base) return { base, kind: base, mix: 0 };
  return { base, kind, mix: surfaceMixOf(seg) };
}

/**
 * La superficie dominante di un segmento: il tratto se la sua miscela ha
 * superato `DOMINANT_MIX`, il fondo altrimenti. **Un** nome, non una
 * miscela: per la diagnostica e per i test. Pura.
 */
export function surfaceKindOf(seg: SurfaceSource, weather: Weather = 'clear'): SurfaceKind {
  const blend = surfaceBlendOf(seg, weather);
  return blend.mix >= DOMINANT_MIX ? blend.kind : blend.base;
}

/**
 * Aderenza di una miscela: interpolazione lineare fra le due aderenze
 * (spec §5). Lineare e non `smoothstep`, perché la rampa che produce
 * `mix` è **già** una `smoothstep` (spec §4.4f): comporne due
 * schiaccerebbe la variazione al centro del tratto invece che ai bordi.
 * Pura.
 */
export function gripOf(blend: SurfaceBlend): number {
  const from = SURFACE_GRIP[blend.base];
  const to = SURFACE_GRIP[blend.kind];
  return from + (to - from) * blend.mix;
}

/** Aderenza di un segmento sotto un meteo, in un colpo. Pura. */
export function gripFor(seg: SurfaceSource, weather: Weather = 'clear'): number {
  return gripOf(surfaceBlendOf(seg, weather));
}

/**
 * Quanto la strada riflette, in `[0, 1]` (spec §4.4f): serve al velo di
 * riflesso e alle linee di corsia più larghe del bagnato. È la frazione
 * della miscela che è `'wet'`, da qualunque dei due lati venga: su una
 * tappa che piove il fondo è bagnato e un tratto di sterrato lo copre,
 * quindi il riflesso si spegne insieme alla rampa. Pura.
 */
export function wetnessOf(blend: SurfaceBlend): number {
  const fromWet = blend.base === 'wet' ? 1 - blend.mix : 0;
  const toWet = blend.kind === 'wet' ? blend.mix : 0;
  return fromWet + toWet;
}
