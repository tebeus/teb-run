import { describe, expect, test } from 'vitest';
import {
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  clamp,
  DRAW_DISTANCE,
  FIELD_OF_VIEW,
  FOG_DENSITY,
  interpolate,
  LANES,
  MIN_CAMERA_Z,
  percentInSegment,
  PLAYER_Z,
  project,
  projectPoint,
  ROAD_HALF,
  ROAD_WIDTH,
  SEGMENT_LENGTH,
} from '../../src/render/project';
import type { SegmentPoint } from '../../src/types';

const W = 1280;
const H = 720;
const origin = { x: 0, y: 0, z: 0 };

describe('world constants (spec 4.1)', () => {
  test('exact values from the spec table', () => {
    expect(SEGMENT_LENGTH).toBe(200);
    expect(ROAD_WIDTH).toBe(2600);
    expect(ROAD_HALF).toBe(1300);
    expect(LANES).toBe(4);
    expect(CAMERA_HEIGHT).toBe(1000);
    expect(FIELD_OF_VIEW).toBe(100);
    expect(DRAW_DISTANCE).toBe(300);
    expect(FOG_DENSITY).toBe(5);
  });

  test('cameraDepth is 1 / tan(fov / 2)', () => {
    expect(CAMERA_DEPTH).toBeCloseTo(1 / Math.tan((50 * Math.PI) / 180), 10);
    expect(CAMERA_DEPTH).toBeCloseTo(0.8391, 4);
  });

  test('playerZ is the camera height times the camera depth', () => {
    expect(PLAYER_Z).toBeCloseTo(839.0996, 3);
  });
});

describe('clamp, interpolate, percentInSegment', () => {
  test('clamp keeps the value inside the range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-3, -3, 3)).toBe(-3);
  });

  test('interpolate hits both ends and the middle', () => {
    expect(interpolate(10, 20, 0)).toBe(10);
    expect(interpolate(10, 20, 1)).toBe(20);
    expect(interpolate(10, 20, 0.5)).toBe(15);
  });

  test('percentInSegment is the fraction covered inside the current unit', () => {
    expect(percentInSegment(0, 200)).toBe(0);
    expect(percentInSegment(50, 200)).toBeCloseTo(0.25, 10);
    expect(percentInSegment(250, 200)).toBeCloseTo(0.25, 10);
    expect(percentInSegment(400, 200)).toBe(0);
    expect(percentInSegment(199.99, 200)).toBeCloseTo(0.99995, 10);
  });

  test('percentInSegment expects a non negative z: callers wrap first', () => {
    // Documenta la precondizione: con z negativa la frazione è negativa.
    expect(percentInSegment(-50, 200)).toBeCloseTo(-0.25, 10);
  });
});

describe('project (spec 4.2)', () => {
  test('a point on the axis lands in the middle of the screen', () => {
    const p = project({ x: 0, y: 0, z: 1000 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    expect(p.x).toBeCloseTo(W / 2, 10);
    expect(p.y).toBeCloseTo(H / 2, 10);
    expect(p.scale).toBeCloseTo(CAMERA_DEPTH / 1000, 12);
  });

  test('a point twice as far is half as wide', () => {
    const near = project({ x: 0, y: 0, z: 1000 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    const far = project({ x: 0, y: 0, z: 2000 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    expect(far.w).toBeCloseTo(near.w / 2, 10);
    expect(far.scale).toBeCloseTo(near.scale / 2, 12);
  });

  test('the projected half width matches the projection of the road edge', () => {
    const centre = project({ x: 0, y: 0, z: 4000 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    const edge = project({ x: ROAD_HALF, y: 0, z: 4000 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    expect(edge.x - centre.x).toBeCloseTo(centre.w, 8);
  });

  test('a point above the camera is drawn higher on screen', () => {
    const flat = project({ x: 0, y: 0, z: 4000 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    const up = project({ x: 0, y: 2000, z: 4000 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    expect(up.y).toBeLessThan(flat.y);
  });

  test('the camera position shifts the point the other way', () => {
    const p = project({ x: 0, y: 0, z: 4000 }, { x: 500, y: 0, z: 0 }, CAMERA_DEPTH, W, H, ROAD_HALF);
    expect(p.x).toBeLessThan(W / 2);
  });

  test('a point behind the camera has a negative scale', () => {
    const behind = project({ x: 0, y: 0, z: -500 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    expect(Number.isNaN(behind.scale)).toBe(false);
    expect(behind.scale).toBeLessThan(0);
    expect(behind.w).toBeLessThan(0);
  });

  test('a point exactly on the camera plane stays finite and centred', () => {
    const onCamera = project({ x: 0, y: 0, z: 0 }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
    expect(Number.isFinite(onCamera.scale)).toBe(true);
    expect(Number.isFinite(onCamera.x)).toBe(true);
    expect(Number.isFinite(onCamera.y)).toBe(true);
    expect(Number.isFinite(onCamera.w)).toBe(true);
    expect(onCamera.x).toBe(W / 2);
    expect(onCamera.y).toBe(H / 2);
  });

  test('a point a whisker in front of or behind the camera stays finite', () => {
    for (const dz of [MIN_CAMERA_Z / 2, -MIN_CAMERA_Z / 2, 1e-300, -1e-300]) {
      const p = project({ x: 500, y: 500, z: dz }, origin, CAMERA_DEPTH, W, H, ROAD_HALF);
      expect(Number.isFinite(p.scale), `dz ${dz}`).toBe(true);
      expect(Number.isFinite(p.x), `dz ${dz}`).toBe(true);
      expect(Number.isFinite(p.y), `dz ${dz}`).toBe(true);
      expect(Number.isFinite(p.w), `dz ${dz}`).toBe(true);
    }
  });
});

describe('projectPoint', () => {
  const makePoint = (x: number, y: number, z: number): SegmentPoint => ({
    world: { x, y, z },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  });

  test('fills camera coordinates relative to the camera', () => {
    const pt = makePoint(100, 200, 3000);
    projectPoint(pt, { x: 10, y: 20, z: 1000 }, W, H);
    expect(pt.camera).toEqual({ x: 90, y: 180, z: 2000 });
  });

  test('fills the same screen values as project', () => {
    const pt = makePoint(0, 0, 3000);
    const cam = { x: 0, y: 1000, z: 0 };
    projectPoint(pt, cam, W, H);
    const expected = project(pt.world, cam, CAMERA_DEPTH, W, H, ROAD_HALF);
    expect(pt.screen).toEqual(expected);
  });

  test('does not allocate new objects for camera and screen', () => {
    const pt = makePoint(0, 0, 3000);
    const camRef = pt.camera;
    const screenRef = pt.screen;
    projectPoint(pt, { x: 0, y: 1000, z: 0 }, W, H);
    expect(pt.camera).toBe(camRef);
    expect(pt.screen).toBe(screenRef);
  });
});
