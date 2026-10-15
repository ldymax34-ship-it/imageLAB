/**
 * 色散光束 · 凸多边形光学自检（纯 Node，跑真实上游 optics / light-mesh 实现）
 *
 * 上游 vercel-labs/vgpu 的求交只认三角棱镜；本项目把它泛化成**凸多边形**。这里用方形 /
 * 六边形验证泛化后的数学与光路：入 / 出射点确实落在轮廓边界上、出射方向按 Snell 偏折、
 * 不同波长出射方向不同（色散）、光谱网格真的被填上数据（白光束 + 内部条带 + 出射扇形），
 * 以及「光束完全错过模型」时整条网格为空（不误画）。
 *
 * 这些断言同时也是对上一轮抄写缺陷的回归：出射界面的 Fresnel 透过率必须取 `-exit.normal`，
 * 否则穿透率恒为 0、出射扇形全黑。
 */
import test from "node:test";
import assert from "node:assert/strict";

const optics = await import("../tools/extrude3d/prism/scene/optics.js");
const lightMesh = await import("../tools/extrude3d/prism/scene/light-mesh.js");
const { PRISM_DISPERSION, PRISM_SPECTRAL_SAMPLES, PRISM_BEAM_SLICES } = await import("../tools/extrude3d/prism/types.js");

const SQUARE = [
  [-2, -2],
  [2, -2],
  [2, 2],
  [-2, 2]
];

const HEXAGON = Array.from({ length: 6 }, (_, index) => {
  const angle = (Math.PI * index) / 3;
  return [2 * Math.cos(angle), 2 * Math.sin(angle)];
});

/** 正五边形：没有一个面与另一个面平行，所以出射方向真的按波长张开（真正的色散扇形）。 */
const PENTAGON = Array.from({ length: 5 }, (_, index) => {
  const angle = Math.PI / 2 + (2 * Math.PI * index) / 5;
  return [2 * Math.cos(angle), 2 * Math.sin(angle)];
});

const lightFrom = (center, direction, beamHalfWidth = 0.1) => ({ center, direction, beamHalfWidth });

test("凸多边形求交：入 / 出射点落在轮廓边界上，退化输入返回 undefined", () => {
  const direction = [1, 0];
  const origin = [-6, 0];
  const path = optics.tracePolygonDetailed(SQUARE, origin, direction, 1.5);
  assert.ok(path, "水平光路应能穿过方形截面");
  assert.deepEqual(path.points.map((point) => [Number(point[0].toFixed(6)), Number(point[1].toFixed(6))]), [
    [-2, 0],
    [2, 0]
  ]);
  assert.equal(path.bounces, 0);
  // 出射界面的 Fresnel 必须非零（取 -exit.normal 的回归）。
  assert.ok(path.transmission > 0.8, `出射透过率应接近 1，实际 ${path.transmission}`);
  // 反向 / 侧面射入不应被当成「进入玻璃」。
  assert.equal(optics.tracePolygonDetailed(SQUARE, [6, 0], direction, 1.5), undefined);
  assert.equal(optics.tracePolygonDetailed(SQUARE, [-6, 9], direction, 1.5), undefined);
});

test("外轮廓整理：凸多边形可用，凹形 / 退化轮廓带中文原因被拒绝", async () => {
  const { finalizeBeamOutline, BEAM_OUTLINE_MAX_POINTS } = await import("../tools/extrude3d/beam-outline.js");
  const convex = finalizeBeamOutline([
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2]
  ]);
  assert.equal(convex.ok, true);
  assert.equal(convex.count, 4);
  // 顺时针输入会被统一成逆时针（旋转起点不同，但顶点集合与绕向一致）。
  const clockwise = finalizeBeamOutline([
    [-2, -2],
    [-2, 2],
    [2, 2],
    [2, -2]
  ]);
  const winding = (outline) => {
    const list = [];
    for (let index = 0; index < outline.count; index += 1) list.push([outline.points[index * 2], outline.points[index * 2 + 1]]);
    let area = 0;
    for (let index = 0; index < list.length; index += 1) {
      const a = list[index];
      const b = list[(index + 1) % list.length];
      area += a[0] * b[1] - a[1] * b[0];
    }
    return area;
  };
  assert.equal(clockwise.count, convex.count);
  assert.ok(winding(clockwise) > 0 && winding(convex) > 0, "两者都必须是逆时针");
  assert.deepEqual(
    [...clockwise.points].filter((_, index) => index % 2 === 0).sort((a, b) => a - b),
    [...convex.points].filter((_, index) => index % 2 === 0).sort((a, b) => a - b)
  );
  // 重复点与闭合重复的首点会被去掉，不影响判定。
  const duplicated = finalizeBeamOutline([
    [-2, -2],
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
    [-2, -2]
  ]);
  assert.equal(duplicated.count, 4);
  // 凹形（这里是一个明显的箭头凹口）：拒绝，并给出中文原因供界面显示。
  const concave = finalizeBeamOutline([
    [0, 0],
    [4, 0],
    [4, 4],
    [2, 1.5],
    [0, 4]
  ]);
  assert.equal(concave.ok, false);
  assert.match(concave.reason, /凹形/);
  assert.match(concave.reason, /凸轮廓/);
  // 退化输入：点数不足 / 尺寸为零。
  assert.equal(finalizeBeamOutline([[0, 0], [1, 1]]).ok, false);
  assert.equal(finalizeBeamOutline([[0, 0], [0, 0], [0, 0]]).ok, false);
  // 曲线轮廓点数是上限内的有限值。
  const circle = Array.from({ length: 400 }, (_, index) => {
    const angle = (2 * Math.PI * index) / 400;
    return [3 * Math.cos(angle), 3 * Math.sin(angle)];
  });
  const rounded = finalizeBeamOutline(circle);
  assert.equal(rounded.ok, true);
  assert.ok(rounded.count <= BEAM_OUTLINE_MAX_POINTS, `点数应被限到 ${BEAM_OUTLINE_MAX_POINTS} 以内，实际 ${rounded.count}`);
  assert.equal(rounded.points.length, rounded.count * 2);
});

test("凸多边形判定：内部为真、外部为假（凹形输入只保证凸包语义，调用方先用整理函数拒绝）", () => {
  assert.equal(optics.insideConvexPolygon(SQUARE, [0, 0]), true);
  assert.equal(optics.insideConvexPolygon(SQUARE, [2.5, 0]), false);
  assert.equal(optics.insideConvexPolygon(PENTAGON, [0, 0]), true);
  assert.equal(optics.insideConvexPolygon(PENTAGON, [0, 3]), false);
});

test("五边形：按 Snell 偏折，且不同波长出射方向不同（真实色散）", () => {
  const trace = (wavelength) =>
    optics.tracePolygonDetailed(
      PENTAGON,
      [-6, 0],
      [1, 0],
      optics.iorAt(wavelength, PRISM_DISPERSION.base, PRISM_DISPERSION.strength)
    );
  const blue = trace(430);
  const green = trace(550);
  const red = trace(680);
  assert.ok(blue && green && red, "三个波长都应穿过五边形");
  // 三个波长走同一组界面（入射 / 出射边相同），只有偏折角不同。
  assert.equal(blue.edges[0], green.edges[0]);
  assert.equal(green.edges[0], red.edges[0]);
  assert.equal(blue.edges[1], green.edges[1]);
  assert.equal(green.edges[1], red.edges[1]);
  for (const path of [blue, green, red]) {
    // 出射点在轮廓边界上：沿出射方向前后各挪一点，前者在外、后者在内。
    const out = [path.origin[0] + path.direction[0] * 0.05, path.origin[1] + path.direction[1] * 0.05];
    const back = [path.origin[0] - path.direction[0] * 0.05, path.origin[1] - path.direction[1] * 0.05];
    assert.equal(optics.insideConvexPolygon(PENTAGON, out), false, "出射点外侧应在轮廓外");
    assert.equal(optics.insideConvexPolygon(PENTAGON, back), true, "出射点内侧应在轮廓内");
  }
  const heading = (path) => Math.atan2(path.direction[1], path.direction[0]);
  assert.ok(heading(blue) > heading(green) + 1e-3, `蓝光应比绿光更偏：${heading(blue)} vs ${heading(green)}`);
  assert.ok(heading(green) > heading(red) + 1e-3, `绿光应比红光更偏：${heading(green)} vs ${heading(red)}`);
  const spread = ((heading(blue) - heading(red)) * 180) / Math.PI;
  assert.ok(spread > 3, `红蓝分离角应肉眼可辨，实际 ${spread.toFixed(2)}°`);
});

test("光谱网格：白光束 / 内部条带 / 出射扇形都被真实填上数据", async () => {
  const layout = lightMesh.lightMeshLayout();
  const built = lightMesh.buildLightMesh({
    polygon: PENTAGON,
    light: lightFrom([-6, 0], [1, 0]),
    dispersion: PRISM_DISPERSION,
    wallHalfExtent: [8, 8],
    samples: layout.samples,
    beamSlices: layout.beamSlices,
    edgeFalloff: 16
  });
  assert.equal(built.vertexCount, lightMesh.lightVertexCount(PRISM_SPECTRAL_SAMPLES, PRISM_BEAM_SLICES));
  assert.equal(built.stats.validBands, layout.samples, "每个波长都应有一条有效光路");
  assert.ok(built.stats.maxOutputWidth > built.stats.minOutputWidth, "出射扇形应真实张开（红蓝分离）");
  assert.ok(built.stats.totalFlux > 0, "总通量应大于 0（出射 Fresnel 不得恒为 0）");

  const intensityAt = (firstVertex, count) => {
    let lit = 0;
    let max = 0;
    for (let index = 0; index < count; index += 1) {
      const value = built.vertices[(firstVertex + index) * lightMesh.LIGHT_VERTEX_FLOATS + 2];
      if (value > 0) lit += 1;
      max = Math.max(max, value);
    }
    return { lit, max };
  };
  const white = intensityAt(0, layout.whiteVertices);
  const internal = intensityAt(layout.internalFirstVertex, layout.internalVertices);
  const outgoing = intensityAt(layout.outgoingFirstVertex, layout.outgoingVertices);
  assert.ok(white.lit > 0 && white.max > 0, "白光入射段应有亮度");
  assert.ok(internal.lit > 0 && internal.max > 0, "玻璃内部条带应有亮度");
  assert.ok(outgoing.lit > 0 && outgoing.max > 0, "出射光谱扇形应有亮度");
});

test("外轮廓输入转换：Float32Array（建模页签交接格式）与顶点数组等价", async () => {
  const { toPolygonPoints, lampForPolygon } = await import("../tools/extrude3d/prism/scene/beam-scene.js");
  const flat = new Float32Array([2, 0, 1, 1.732, -1, 1.732, -2, 0, -1, -1.732, 1, -1.732]);
  const points = toPolygonPoints(flat);
  assert.equal(points.length, 6);
  assert.deepEqual(points[0], [2, 0]);
  assert.deepEqual(points[5], [1, -1.7319999933242798]);
  assert.equal(points[5][1], flat[11]); // Float32 精度原样保留，不做多余转换
  const lamp = lampForPolygon(points, { angle: 0, position: 0, halfWidthRatio: 0.05 });
  assert.ok(Math.abs(lamp.direction[0] - 1) < 1e-9 && Math.abs(lamp.direction[1]) < 1e-9, "0° 方向沿 +x");
  assert.ok(Number.isFinite(lamp.center[0]) && lamp.center[0] < -2, "灯位在轮廓外侧");
  assert.ok(lamp.beamHalfWidth > 0, "光束半宽为正");
  // 位置偏移沿垂直于光束的轴移动灯位。
  const shifted = lampForPolygon(points, { angle: 0, position: 50, halfWidthRatio: 0.05 });
  assert.ok(Math.abs(shifted.center[1]) > 0.5 && Math.abs(shifted.center[0] - lamp.center[0]) < 1e-9, "position 只沿垂直于方向的轴偏移");
  // position 上限 ±200%：偏移到凸形垂足投影之外，整条光束必然错过轮廓。
  const outside = lampForPolygon(points, { angle: 0, position: 200 });
  const far = optics.tracePolygonDetailed(points, outside.center, outside.direction, 1.45);
  assert.equal(far, undefined, "±200% 偏移后必须整体移出轮廓");
  // 90° 方向：沿 +y。
  const up = lampForPolygon(points, { angle: 90, position: 0 });
  assert.ok(Math.abs(up.direction[0]) < 1e-9 && Math.abs(up.direction[1] - 1) < 1e-9, "90° 方向沿 +y");
});

test("光束错过模型：不画任何东西（空四边形哨兵）", () => {
  const layout = lightMesh.lightMeshLayout();
  const built = lightMesh.buildLightMesh({
    polygon: PENTAGON,
    light: lightFrom([-6, 20], [1, 0]),
    dispersion: PRISM_DISPERSION,
    wallHalfExtent: [8, 8],
    samples: layout.samples,
    beamSlices: layout.beamSlices,
    edgeFalloff: 16
  });
  assert.equal(built.stats.validBands, 0);
  for (let index = 0; index < built.vertexCount; index += 1) {
    assert.equal(built.vertices[index * lightMesh.LIGHT_VERTEX_FLOATS + 2], -1, "空四边形必须写 -1 哨兵");
  }
});
