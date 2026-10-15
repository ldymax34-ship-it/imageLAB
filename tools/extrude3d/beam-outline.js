/**
 * SVG 转 3D · 光束外轮廓整理（纯函数，可 Node 测试）
 *
 * 建模页签把采样轮廓映射到渲染页签用的世界 XY 后，由这里整理成色散光束可用的
 * **单个闭合凸多边形**：去重、按弧长限点、统一逆时针、判凸（容差按尺寸归一化，
 * 近似凸形放行）。不满足时返回中文原因，渲染页签据此只关闭可见光束、保留普通玻璃。
 *
 * 首版不支持：多轮廓、孔洞、明显凹形、自交 —— 这些在这里统一拒绝，不静默近似。
 */

/** 采样点上限：凸多边形求交是 O(顶点数)，64 个顶点已足够贴合常见轮廓。 */
export const BEAM_OUTLINE_MAX_POINTS = 64;
/** 判凸容差（按最大坐标归一化后）；允许轻微内凹的「近似凸形」。 */
const CONVEX_TOLERANCE = 1e-4;

/** 点数超上限时按弧长等分重采样（凸轮廓的采样点不改变形状语义）。 */
export function resampleOutline(points, maxPoints = BEAM_OUTLINE_MAX_POINTS) {
  const spans = [];
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    spans.push(span);
    total += span;
  }
  if (!(total > 0)) return points;
  const out = [];
  let edge = 0;
  let walked = 0;
  for (let index = 0; index < maxPoints; index += 1) {
    const target = (total * index) / maxPoints;
    while (edge < spans.length - 1 && walked + spans[edge] < target) {
      walked += spans[edge];
      edge += 1;
    }
    const a = points[edge];
    const b = points[(edge + 1) % points.length];
    const amount = spans[edge] > 0 ? (target - walked) / spans[edge] : 0;
    out.push([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount]);
  }
  return out;
}

/**
 * @param {Array<[number, number]>} rawPoints 世界 XY 上的采样轮廓
 * @returns {{ok: true, points: Float32Array, count: number} | {ok: false, reason: string}}
 */
export function finalizeBeamOutline(rawPoints) {
  const points = [];
  for (const point of rawPoints) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const previous = points[points.length - 1];
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 1e-6) continue;
    points.push([point[0], point[1]]);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 2 && first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) points.pop();
  if (points.length < 3) {
    return { ok: false, reason: "当前轮廓退化（不足 3 个顶点），色散光束已关闭。" };
  }
  const trimmed =
    points.length > BEAM_OUTLINE_MAX_POINTS ? resampleOutline(points, BEAM_OUTLINE_MAX_POINTS) : points;
  let area = 0;
  let extent = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const a = trimmed[index];
    const b = trimmed[(index + 1) % trimmed.length];
    area += a[0] * b[1] - a[1] * b[0];
    extent = Math.max(extent, Math.abs(a[0]), Math.abs(a[1]));
  }
  if (extent <= 1e-6) {
    return { ok: false, reason: "当前轮廓尺寸为零，色散光束已关闭。" };
  }
  if (area < 0) trimmed.reverse();
  let convex = true;
  for (let index = 0; index < trimmed.length && convex; index += 1) {
    const a = trimmed[index];
    const b = trimmed[(index + 1) % trimmed.length];
    const c = trimmed[(index + 2) % trimmed.length];
    const cross =
      ((b[0] - a[0]) / extent) * ((c[1] - b[1]) / extent) -
      ((b[1] - a[1]) / extent) * ((c[0] - b[0]) / extent);
    if (cross < -CONVEX_TOLERANCE) convex = false;
  }
  if (!convex) {
    return {
      ok: false,
      reason: "当前 SVG 外轮廓是凹形，色散光束第一版只支持单个闭合凸轮廓（近似凸形）；仍保留普通玻璃、背景折射与色散。"
    };
  }
  const flat = new Float32Array(trimmed.length * 2);
  trimmed.forEach((point, index) => {
    flat[index * 2] = point[0];
    flat[index * 2 + 1] = point[1];
  });
  return { ok: true, points: flat, count: trimmed.length };
}
