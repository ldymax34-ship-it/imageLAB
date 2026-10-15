/** vgpu 官方 `lib/scene-camera.ts` 的最小运行时副本（vgpu/scene API）。 */
import { group, perspective, viewMatrices } from "vgpu/scene";

export function createCameraState(options) {
  const camera = {
    position: copyVec3(options.position),
    quaternion: new Float32Array(4),
    target: copyVec3(options.target),
    up: copyVec3(options.up ?? [0, 1, 0]),
    lens: { fov: options.fov, near: options.near, far: options.far },
    aspect: options.aspect,
    projection: new Float32Array(16),
    view: new Float32Array(16),
    viewProjection: new Float32Array(16),
  };
  recompute(camera);
  return camera;
}

export function updateCameraState(camera, values) {
  if (values.position !== undefined) camera.position.set(copyVec3(values.position));
  if (values.target !== undefined) camera.target.set(copyVec3(values.target));
  if (values.up !== undefined) camera.up.set(copyVec3(values.up));
  if (values.fov !== undefined) camera.lens.fov = values.fov;
  if (values.near !== undefined) camera.lens.near = values.near;
  if (values.far !== undefined) camera.lens.far = values.far;
  if (values.aspect !== undefined) camera.aspect = values.aspect;
  recompute(camera);
  return camera;
}

function recompute(camera) {
  const node = group({ position: camera.position }).lookAt(camera.target, camera.up);
  camera.quaternion.set(node.quaternion);
  perspective(camera.lens, camera.aspect, camera.projection);
  viewMatrices(camera, camera.projection, camera);
}

function copyVec3(value) {
  return new Float32Array([value[0], value[1], value[2]]);
}
