/**
 * SVG 安全闸门（解析前检查）。
 *
 * three 的 SVGLoader 对下面这些内容要么直接忽略、要么只在 console 里 warn，
 * 结果是页面「静默」给出一个缺东西的模型。本模块把这些情况在解析**之前**
 * 拦下来，返回可直接展示给用户的中文原因。
 *
 * 只做字符串/计数级别的粗判，不自己解析 SVG 几何、不自己写渲染算法。
 * 顶点预算是「粗估」，真正的裁剪仍交给上游 `buildExtrudedGeometry` 的
 * `vertexBudget` 选项；这里只是提前止损，避免浏览器被超大图卡死。
 */

/** 硬性上限（可被调用方覆盖）。 */
export const LIMITS = {
  /** 单个 SVG 文件最大字节数。 */
  maxBytes: 2 * 1024 * 1024,
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
 * 顶点数粗估：与上游 `buildExtrudeSettings` 内部使用的估算式一致
 * （idealBevel × idealCurve × 6，按图形数量累加）。
 * 不是精确值，只用于提前拦截明显超预算的输入。
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
 *   { ok: true, pathCount, estVerts, bytes }
 *   { ok: false, code, reason, pathCount, estVerts, bytes }
 */
export function inspectSvg(svgText, options = {}) {
  const smoothness = options.smoothness ?? 0.5;
  const maxBytes = options.maxBytes ?? LIMITS.maxBytes;
  const maxPaths = options.maxPaths ?? LIMITS.maxPaths;
  const vertexBudget = options.vertexBudget ?? LIMITS.vertexBudget;
  const text = typeof svgText === "string" ? svgText : "";
  const bytes = byteLength(text);
  const pathCount = countDrawables(text);
  const est = estimateVertices(pathCount, smoothness, vertexBudget);

  const reject = (code, reason) => ({
    ok: false,
    code,
    reason: `已拒绝导入：${reason}`,
    pathCount,
    estVerts: est.total,
    bytes
  });

  if (!text.trim()) return reject("empty", "文件内容为空。");
  if (!/<\s*svg[\s>/]/i.test(text)) return reject("not-svg", "文件里找不到 <svg> 根元素，不是 SVG 文件。");
  if (bytes > maxBytes) {
    return reject(
      "too-large",
      `文件过大（${(bytes / 1024 / 1024).toFixed(2)} MB，上限 ${(maxBytes / 1024 / 1024).toFixed(0)} MB）。` +
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

  if (est.total > vertexBudget) {
    return reject(
      "vertex-budget",
      `预估顶点数 ${est.total.toLocaleString("en-US")} 超过预算 ${vertexBudget.toLocaleString("en-US")}` +
        `（${pathCount} 条图形 × 约 ${est.perShape.toLocaleString("en-US")} 顶点/条，当前圆滑度 ${smoothness}）。` +
        "请降低圆滑度、减少路径数量或简化节点。"
    );
  }

  return { ok: true, pathCount, estVerts: est.total, bytes };
}
