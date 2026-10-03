import type { Projected, SegmentPoint, Vec3 } from '../types';

// Costanti mondo, spec §4.1.
export const SEGMENT_LENGTH = 200;
/** Larghezza totale della strada in unità mondo (spec §4.1): quattro corsie. */
export const ROAD_WIDTH = 2600;
/** Mezza larghezza: un punto a world.x = ±ROAD_HALF è sul bordo strada. */
export const ROAD_HALF = ROAD_WIDTH / 2;
export const LANES = 4;
export const CAMERA_HEIGHT = 1000;
export const FIELD_OF_VIEW = 100;
export const CAMERA_DEPTH = 1 / Math.tan(((FIELD_OF_VIEW / 2) * Math.PI) / 180);
export const DRAW_DISTANCE = 300;
export const FOG_DENSITY = 5;
/** Distanza dell'auto del giocatore davanti alla telecamera. */
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frazione di unità già percorsa a z (0 all'inizio del segmento, 0.5 a metà).
 * Precondizione: z non negativa. Chi chiama passa sempre una z già riportata
 * in [0, trackLength) con `wrapZ`; con z negativa la frazione è negativa.
 */
export function percentInSegment(z: number, total: number): number {
  return (z % total) / total;
}

/**
 * Distanza minima dalla telecamera usata nella divisione. Serve solo a tenere
 * la scala finita: con dz esattamente 0 la scala sarebbe Infinity e x e y
 * diventerebbero NaN (Infinity * 0).
 */
export const MIN_CAMERA_Z = 1e-6;

/**
 * Proietta un punto mondo sullo schermo, spec §4.2.
 * `roadWidth` è la MEZZA larghezza strada (ROAD_HALF): screen.w è una semilarghezza.
 */
export function project(
  p: Vec3,
  cam: Vec3,
  cameraDepth: number,
  width: number,
  height: number,
  roadWidth: number,
): Projected {
  const dz = p.z - cam.z;
  // Si conserva il segno: un punto dietro la telecamera ha ancora scala negativa.
  const safeDz = Math.abs(dz) < MIN_CAMERA_Z ? (dz < 0 ? -MIN_CAMERA_Z : MIN_CAMERA_Z) : dz;
  const scale = cameraDepth / safeDz;
  return {
    scale,
    x: width / 2 + scale * (p.x - cam.x) * (width / 2),
    y: height / 2 - scale * (p.y - cam.y) * (height / 2),
    w: scale * roadWidth * (width / 2),
  };
}

/** Riempie camera e screen di un punto di segmento, senza allocare. */
export function projectPoint(
  point: SegmentPoint,
  cam: Vec3,
  width: number,
  height: number,
  roadWidth = ROAD_HALF,
): void {
  point.camera.x = point.world.x - cam.x;
  point.camera.y = point.world.y - cam.y;
  point.camera.z = point.world.z - cam.z;
  const pr = project(point.world, cam, CAMERA_DEPTH, width, height, roadWidth);
  point.screen.x = pr.x;
  point.screen.y = pr.y;
  point.screen.w = pr.w;
  point.screen.scale = pr.scale;
}
