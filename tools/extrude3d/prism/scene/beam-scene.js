/**
 * 光束的灯位与 uniform（纯函数，可 Node 测试；不 import WGSL）
 *
 * 灯位与 `Scene` uniform 结构分别对应上游 prism-background 的
 * `types.ts`（`lampForIncidence`）与 `pipelines/light/uniforms.ts`：上游把灯瞄准固定三角棱镜的
 * 入射面，这里改成瞄准「当前 SVG 外轮廓的凸多边形」；uniform 字段与 `scene/scene.wgsl`
 * 的 `Scene` 结构一一对应，缺一不可（vgpu 的 `set()` 要求提供全部字段）。
 */

import { LIGHT_INTERNAL_SEGMENTS } from "./light-mesh.js";

/**
 * 外轮廓输入（`Float32Array` 的 x,y 交替，来自建模页签）→ `[[x, y], ...]`。
 * 求交 / 灯位都按「顶点数组」工作，这里做唯一一次转换。
 */
export function toPolygonPoints(outline) {
  if (Array.isArray(outline) && Array.isArray(outline[0])) return outline.map((point) => [point[0], point[1]]);
  const list = [];
  for (let index = 0; index + 1 < outline.length; index += 2) list.push([outline[index], outline[index + 1]]);
  return list;
}

/**
 * 光束灯位：从外接圆外沿射入，沿 `angle` 方向穿过（按 `position` 偏移后的）截面。
 *
 * `position` 以「到形心的最大距离（外接圆半径）」为单位、界面用百分比表示，上限 ±200%：
 * 凸形的垂足投影不超过半径，所以 ±200% 一定能整体移出轮廓（叶片中心就无光路）。
 */
export function lampForPolygon(polygon, { angle = 0, position = 0, halfWidthRatio = 0.05 } = {}) {
  const centroid = [0, 0];
  for (const point of polygon) {
    centroid[0] += point[0];
    centroid[1] += point[1];
  }
  centroid[0] /= polygon.length;
  centroid[1] /= polygon.length;
  let radius = 1e-3;
  for (const point of polygon) {
    radius = Math.max(radius, Math.hypot(point[0] - centroid[0], point[1] - centroid[1]));
  }
  const radians = (angle * Math.PI) / 180;
  const direction = [Math.cos(radians), Math.sin(radians)];
  const perpendicular = [-direction[1], direction[0]];
  const offset = (Math.max(-200, Math.min(200, position)) / 100) * radius;
  const aim = [centroid[0] + perpendicular[0] * offset, centroid[1] + perpendicular[1] * offset];
  const reach = radius * 2 + 4;
  return {
    center: [aim[0] - direction[0] * reach, aim[1] - direction[1] * reach],
    direction,
    beamHalfWidth: Math.max(radius * halfWidthRatio, 1e-3)
  };
}

/** `scene.wgsl` 的 `Scene` uniform（字段顺序与结构体一致）。 */
export function beamSceneUniforms({
  layout,
  viewProjection,
  light,
  intensity,
  wallHalfExtent,
  planeZ,
  fade
}) {
  return {
    viewProjection,
    wallHalfExtent,
    inputBeamDirection: light.direction,
    wallColor: [0, 0, 0],
    causticOnly: 0,
    lightPlaneZ: planeZ,
    lightWhiteQuads: layout.whiteQuads,
    lightBeamSlices: layout.beamSlices,
    lightSpectralSamples: layout.samples,
    lightInternalQuads: layout.internalQuads,
    lightInternalSegments: LIGHT_INTERNAL_SEGMENTS,
    lightOpacity: intensity,
    lightEdgeFalloff: fade.edgeFalloff,
    rainbowFalloffRate: fade.rainbowFalloffRate,
    rainbowFalloffPower: fade.rainbowFalloffPower,
    beamWidthReveal: 1
  };
}
