/**
 * SVG 安全闸门（解析前 + 挤出前检查）。
 *
 * three 的 SVGLoader 对下面这些内容要么直接忽略、要么只在 console 里 warn，
 * 结果是页面「静默」给出一个缺东西的模型。本模块把这些情况在解析**之前**
 * 拦下来，返回可直接展示给用户的中文原因。
 *
 * 两道闸门：
 *   1. `inspectSvg`：字符串/计数级别的粗判（文件大小上限、图形元素数量、
 *      文本 / 图片 / 滤镜 / 渐变描边 / <use> 等会被静默忽略的内容）。
 *   2. `inspectShapes`：几何级硬上限。单个 <path> 里塞几千条曲线时，
 *      只数「图形元素个数」是拦不住的；这里复用上游 `parseShapesFromSVG`
 *      解析后的 Shape，按上游 `buildExtrudeSettings` 给出的曲线细分，
 *      用 three 的 `Shape.getPoints` / `shape.holes` 采样轮廓点，
 *      再乘保守倍数估算挤出顶点数，超过 `vertexBudget` 直接拒绝。
 *
 * 不自己解析 SVG、不自己写几何算法：解析与细分参数全部来自上游库。
 */

import { buildExtrudeSettings } from "@visant/extrude3d";

/** 硬性上限（可被调用方覆盖）。 */
export const LIMITS = {
  /** 单个 SVG 文件最大字节数（保守小上限，曲线密集型输入在几何闸门另有采样拦截）。 */
  maxBytes: 64 * 1024,
  /** 最多可绘制的图形元素数量。 */
  maxPaths: 500,
  /** 顶点预算，与上游 `buildExtrudedGeometry` 的默认值保持一致。 */
  vertexBudget: 600000
};

/** 会触发「不可用 / 会被静默忽略」的节点与属性。 */
const REJECT_RULES = [
  {
    code: "text",
    test: (t) => /<\s*text[\s>/]/i.test(t) || /<\s*tspan[\s>/]/i.test(t),
    reason:
      "SVG 含 <text>/<tspan> 文本元素：three 的 SVGLoader 不支持文本，文字会被整段忽略。请先把文字转成轮廓路径（path）再导入。"
  },
  {
    code: "image",
    test: (t) => /<\s*image[\s>/]/i.test(t),
    reason: "SVG 含 <image> 内嵌位图：只支持矢量轮廓，位图会被整段忽略。请先描摹成路径。"
  },
  {
    code: "filter",
    test: (t) => /<\s*filter[\s>/]/i.test(t) || /\bfilter\s*[:=]/i.test(t),
    reason:
      "SVG 含滤镜（<filter> 或 filter=）：three 的 SVGLoader 明确不支持滤镜（THREE.SVGLoader: Filters are not supported.）。请先在设计软件里栅格化或删除滤镜后导出纯几何 SVG。"
  },
  {
    code: "gradient-stroke",
    test: (t) => /stroke\s*:\s*url\s*\(/i.test(t) || /stroke\s*=\s*["'][^"']*url\s*\(/i.test(t),
    reason:
      "SVG 使用渐变描边（stroke: url(...)）：SVGLoader 不支持渐变描边（Gradient strokes are not supported.），描边会丢失或出错。请把描边改成纯色或先转成填充路径。"
  },
  {
    code: "use",
    test: (t) => /<\s*use[\s>/]/i.test(t),
    reason:
      "SVG 含 <use> 引用节点：引用解析在 SVGLoader 中不完整（引用不存在时只 warn 后静默跳过）。请在导出前执行「展开/转曲」把 <use> 展开成实际路径。"
  }
];

/**
 * 统计可绘制图形元素数量（path / rect / circle / ellipse / polygon / polyline / line）。
 * 这是「路径数量」的粗判口径，用于触发 maxPaths 拦截。
 */
export function countDrawables(svgText) {
  const matches = svgText.match(/<\s*(path|rect|circle|ellipse|polygon|polyline|line)[\s>/]/gi);
  return matches ? matches.length : 0;
}

/** UTF-8 字节数（SVG 可能含中文注释）。 */
export function byteLength(text) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

/**
 * 轮廓点 → 挤出顶点的保守倍数：
 * 侧壁 + 倒角分层，再为封盖 / 三角化留出余量。
 * 只用于估算，宁大勿小。
 */
export function extrusionVertexFactor(bevelSegments) {
  return 6 * (1 + 2 * bevelSegments) + 18;
}

/**
 * 按「图形数量」粗估顶点数的旧口径，仅作参考；
 * 真正的硬上限是 `inspectShapes` 的采样点数 × {@link extrusionVertexFactor}。
 */
export function estimateVertices(shapeCount, smoothness, vertexBudget = LIMITS.vertexBudget) {
  const s = Math.min(1, Math.max(0, Number(smoothness) || 0));
  const idealBevel = Math.round(4 + s * 8);
  const idealCurve = Math.round(32 + s * 64);
  const perShape = idealBevel * idealCurve * 6;
  return {
    perShape,
    total: perShape * Math.max(shapeCount, 1),
    vertexBudget
  };
}

/**
 * 解析前检查。返回：
 *   { ok: true, pathCount, bytes }
 *   { ok: false, code, reason, pathCount, bytes }
 */
export function inspectSvg(svgText, options = {}) {
  const maxBytes = options.maxBytes ?? LIMITS.maxBytes;
  const maxPaths = options.maxPaths ?? LIMITS.maxPaths;
  const text = typeof svgText === "string" ? svgText : "";
  const bytes = byteLength(text);
  const pathCount = countDrawables(text);

  const reject = (code, reason) => ({
    ok: false,
    code,
    reason: `已拒绝导入：${reason}`,
    pathCount,
    bytes
  });

  if (!text.trim()) return reject("empty", "文件内容为空。");
  if (!/<\s*svg[\s>/]/i.test(text)) return reject("not-svg", "文件里找不到 <svg> 根元素，不是 SVG 文件。");
  if (bytes > maxBytes) {
    return reject(
      "too-large",
      `文件过大（${(bytes / 1024).toFixed(1)} KB，上限 ${(maxBytes / 1024).toFixed(0)} KB）。` +
        "请先在设计软件里合并图层、简化节点后再导出。"
    );
  }

  for (const rule of REJECT_RULES) {
    if (rule.test(text)) return reject(rule.code, rule.reason);
  }

  if (pathCount === 0) {
    return reject(
      "no-shapes",
      "SVG 里没有任何 path / rect / circle / ellipse / polygon / polyline / line 图形元素，没有可挤出的轮廓。"
    );
  }

  if (pathCount > maxPaths) {
    return reject(
      "too-many-paths",
      `图形元素过多（${pathCount} 条，上限 ${maxPaths} 条）。请先合并/简化路径，或只导出需要立体化的部分。`
    );
  }

  return { ok: true, pathCount, bytes };
}

/**
 * 几何级硬上限：解析后的 Shape 先按上游曲线细分采样，再估算挤出顶点。
 *
 * `curveSegments` / `bevelSegments` 只由平滑度、图形数量与顶点预算决定，
 * 与 `maxFlatDim` 无关（后者只影响厚度与倒角尺寸），因此这里传占位尺寸 1，
 * 不为了取参数而提前构建任何临时几何。
 *
 * 返回：
 *   { ok: true, shapeCount, sampledPoints, estVerts, curveSegments, bevelSegments }
 *   { ok: false, code, reason, shapeCount, sampledPoints, estVerts, curveSegments, bevelSegments }
 */
export function inspectShapes(shapes, options = {}) {
  const smoothness = options.smoothness ?? 0.5;
  const vertexBudget = options.vertexBudget ?? LIMITS.vertexBudget;
  const list = Array.isArray(shapes) ? shapes : [];
  const shapeCount = list.length;

  if (shapeCount === 0) {
    return {
      ok: false,
      code: "no-shapes",
      reason: "已拒绝导入：SVG 里没有可挤出的轮廓。",
      shapeCount,
      sampledPoints: 0,
      estVerts: 0,
      curveSegments: 0,
      bevelSegments: 0
    };
  }

  const settings = buildExtrudeSettings(1, shapeCount, {
    depth: options.depth ?? 1,
    smoothness,
    bevelEnabled: options.bevelEnabled ?? true,
    bevelThickness: options.bevelThickness ?? 0.5,
    bevelSize: options.bevelSize ?? 0.5,
    vertexBudget
  });
  const { curveSegments, bevelSegments } = settings;
  const factor = extrusionVertexFactor(bevelSegments);

  let sampledPoints = 0;
  for (const shape of list) {
    if (shape && typeof shape.getPoints === "function") {
      sampledPoints += shape.getPoints(curveSegments).length;
    }
    const holes = shape && Array.isArray(shape.holes) ? shape.holes : [];
    for (const hole of holes) {
      if (hole && typeof hole.getPoints === "function") {
        sampledPoints += hole.getPoints(curveSegments).length;
      }
    }
    // 已经确定超预算就不必继续采样后面的图形。
    if (sampledPoints * factor > vertexBudget) break;
  }

  const estVerts = sampledPoints * factor;
  if (estVerts > vertexBudget) {
    return {
      ok: false,
      code: "vertex-budget",
      reason:
        `已拒绝导入：路径曲线过多，按采样轮廓点估算约 ${estVerts.toLocaleString("en-US")} 个挤出顶点，` +
        `超过上限 ${vertexBudget.toLocaleString("en-US")}（${sampledPoints.toLocaleString("en-US")} 个采样点 × ${factor}）。` +
        "请减少曲线/节点，或降低平滑度。",
      shapeCount,
      sampledPoints,
      estVerts,
      curveSegments,
      bevelSegments
    };
  }

  return { ok: true, shapeCount, sampledPoints, estVerts, curveSegments, bevelSegments };
}
