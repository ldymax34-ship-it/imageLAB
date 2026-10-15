/** vgpu 官方 `scene/camera.ts` 的最小运行时移植（MIT，commit 81c4a27）。 */
import { createCameraState } from "./scene-camera.js";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEGREES,
  CAMERA_ORBIT_DEGREES,
  CAMERA_PITCH_DEGREES,
  CAMERA_YAW_DEGREES,
} from "../types.js";

const WALL_SAFETY = 1.02;
let memoizedAspect = 0;
let memoizedDistance = 0;
let memoizedFov = 0;
let memoizedHalfHeight = 0;

export function cameraView(aspect, orbitX = 0, orbitY = 0, distance = CAMERA_DISTANCE, fov = CAMERA_FOV_DEGREES) {
  const yaw = radians(CAMERA_YAW_DEGREES + clamp(orbitX, -1, 1) * CAMERA_ORBIT_DEGREES);
  const pitch = radians(CAMERA_PITCH_DEGREES - clamp(orbitY, -1, 1) * CAMERA_ORBIT_DEGREES);
  const cosPitch = Math.cos(pitch);
  const position = [
    Math.sin(yaw) * cosPitch * distance,
    Math.sin(pitch) * distance,
    Math.cos(yaw) * cosPitch * distance,
  ];
  const forward = normalize([-position[0], -position[1], -position[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const camera = createCameraState({
    fov,
    aspect,
    near: 0.05,
    far: 4 * distance,
    position,
    target: [0, 0, 0],
  });
  return {
    camera,
    viewProjection: camera.viewProjection,
    position,
    forward,
    right,
    up: cross(right, forward),
  };
}

export function wallHalfHeight(aspect, distance = CAMERA_DISTANCE, fov = CAMERA_FOV_DEGREES) {
  if (aspect === memoizedAspect && distance === memoizedDistance && fov === memoizedFov) return memoizedHalfHeight;
  let worst = 0;
  for (const orbitX of [-1, 0, 1]) {
    for (const orbitY of [-1, 0, 1]) {
      worst = Math.max(worst, wallCoverage(aspect, orbitX, orbitY, distance, fov));
    }
  }
  memoizedAspect = aspect;
  memoizedDistance = distance;
  memoizedFov = fov;
  memoizedHalfHeight = worst * WALL_SAFETY;
  return memoizedHalfHeight;
}

export function wallCoverage(aspect, orbitX = 0, orbitY = 0, distance = CAMERA_DISTANCE, fov = CAMERA_FOV_DEGREES) {
  const view = cameraView(aspect, orbitX, orbitY, distance, fov);
  const tanHalfFov = Math.tan(radians(fov) / 2);
  let worst = 0;
  for (const horizontal of [-1, 1]) {
    for (const vertical of [-1, 1]) {
      const direction = [0, 1, 2].map(
        (axis) => view.forward[axis] + view.right[axis] * horizontal * tanHalfFov * aspect + view.up[axis] * vertical * tanHalfFov
      );
      if (direction[2] >= 0) return Infinity;
      const t = -view.position[2] / direction[2];
      const x = view.position[0] + direction[0] * t;
      const y = view.position[1] + direction[1] * t;
      worst = Math.max(worst, Math.abs(x) / aspect, Math.abs(y));
    }
  }
  return worst;
}

export function wallExtent(aspect, distance = CAMERA_DISTANCE, fov = CAMERA_FOV_DEGREES) {
  const halfHeight = wallHalfHeight(aspect, distance, fov);
  return [halfHeight * aspect, halfHeight];
}

export function lightWallExtent(aspect, distance = CAMERA_DISTANCE, fov = CAMERA_FOV_DEGREES) {
  const extent = wallExtent(aspect, distance, fov);
  const overscan = Math.min(2.5, Math.max(1, 1 / Math.max(aspect, 1e-3)));
  return [extent[0] * overscan, extent[1] * overscan];
}

export function rotationMatrix(degrees) {
  const [x, y, z] = degrees.map(radians);
  const [sx, cx] = [Math.sin(x), Math.cos(x)];
  const [sy, cy] = [Math.sin(y), Math.cos(y)];
  const [sz, cz] = [Math.sin(z), Math.cos(z)];
  return new Float32Array([
    cy * cz, cy * sz, -sy, 0,
    sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, 0,
    cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy, 0,
    0, 0, 0, 1,
  ]);
}

function radians(degrees) { return (degrees * Math.PI) / 180; }
function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(value) { const length = Math.hypot(value[0], value[1], value[2]) || 1; return [value[0] / length, value[1] / length, value[2] / length]; }
