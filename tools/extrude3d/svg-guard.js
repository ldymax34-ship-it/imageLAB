/**
 * SVG 安全闸门（解析前 + 挤出前检查）。
 *
 * three 的 SVGLoader 对下面这些内容要么直接忽略、要么只在 console 里 warn，
 * 结果是页面「静默」给出一个缺东西的模型。本模块把这些情况在解析**之前**
 * 拦下来，返回可直接展示给用户的中文原因。
 *
 * 三道闸门：
 *   1. `inspectSvg`：字符串/计数级别的粗判（文件大小上限、图形元素数量、
 *      文本 / 图片 / 滤镜 / 渐变描边 / <use> 等会被静默忽略的内容，
 *      以及脚本 / 事件属性 / 内部实体 / 外部资源引用的最小 unsupported-input 拦截）。
 *   2. `estimateMinimumVertices`：解析后、`measureFlatMaxDim` 三角化**之前**的下限估算。
 *      单个 <path> 里塞几千条曲线时，`ShapeGeometry` 三角化本身就可能卡住主线程；
 *      这里先按最低细分（曲线下限，倒角关闭时为 0 段）估算，连下限都超预算就提前拒绝。
 *   3. `inspectShapes` / `planShapes`：几何级硬上限。复用上游 `parseShapesFromSVG` 解析后的
 *      Shape，用 three 的 `Shape.getPoints` 按**本次真实使用的** curveSegments 采样轮廓点，
 *      再乘按真实 bevelEnabled / bevelSegments 计算的保守倍数估算挤出顶点数。
 *      超预算时先按采样数下调 curveSegments / bevelSegments（three 原生细分），
 *      到合理下限仍超出才拒绝。
 *
 * 不自己解析 SVG、不自己写几何算法：解析与挤出参数全部来自上游库 / three 原生。
 */

/** 硬性上限（可被调用方覆盖）。 */
export const LIMITS = {
  /** 单个 SVG 文件最大字节数（普通含 defs / 元数据的 SVG 通常远小于此）。 */
  maxBytes: 1024 * 1024,
  /** 最多可绘制的图形元素数量。 */
  maxPaths: 500,
  /** 顶点预算，与上游 `buildExtrudedGeometry` 的默认值保持一致。 */
  vertexBudget: 600000
};

/** 自适应下调细分时的合理下限（仍使用 three 原生细分，不再往下）。 */
export const SEGMENT_FLOORS = {
  curveSegments: 8,
  bevelSegments: 2
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
    // filter="none" / filter:none 是无害的显式关闭，不算使用滤镜。
    test: (t) => {
      if (/<\s*filter[\s>/]/i.test(t)) return true;
      for (const m of t.matchAll(/\bfilter\s*[:=]\s*["']?\s*([^"';\s>]+)/gi)) {
        if (String(m[1]).toLowerCase() !== "none") return true;
      }
      return false;
    },
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
 * 仅用于「静默忽略 / 不支持」正则检查的扫描文本：去掉 `<metadata>` 与 `<defs>` 中
 * **未直接参与可见几何**的普通定义（未使用的滤镜 / 渐变 / 符号等），
 * 避免把冗余定义误判成不支持。这里不做任何 SVG 修复、也不解析引用关系：
 * 可见元素上的 `filter=` / `stroke:url(...)` / `<text>` / `<use>` 仍会被拒绝。
 */
export function stripInertDefinitions(svgText) {
  return String(svgText)
    .replace(/<\s*metadata\b[\s\S]*?<\s*\/\s*metadata\s*>/gi, " ")
    .replace(/<\s*defs\b[\s\S]*?<\s*\/\s*defs\s*>/gi, " ");
}

/**
 * 「不支持能力 / 资源引用」最小闸门。只做字符串层面的最小拦截：
 * 不清理输入、不解析 / 展开实体、不执行脚本、不发起任何网络请求。
 *
 * 与 `stripInertDefinitions` 不同，这里扫描**原始 SVG**：`<defs>` / `<metadata>` 里的
 * `<script>`、内联事件属性、内部实体定义、外部资源引用同样要拒绝。
 * 明确放行（普通导出会用到）：`xmlns*` 命名空间 URL、metadata 正文、
 * 本地 `#fragment` 引用（`href="#x"` / `xlink:href="#x"` / `url(#x)`）、
 * 不含内部实体的普通 SVG 1.1 `<!DOCTYPE>`。
 *
 * 注意：它是「最小 unsupported-input guard」，不是 sanitizer / 解析器；
 * 命中的内容一律拒绝，绝不执行 / 展开。
 */
function tagAndStyleInteriors(text) {
  const parts = [];
  const tagRe = /<[^>]*>/g;
  let m;
  while ((m = tagRe.exec(text))) parts.push(m[0]);
  for (const style of text.matchAll(/<\s*style\b[^>]*>([\s\S]*?)<\s*\/\s*style\s*>/gi)) {
    parts.push(style[1]);
  }
  return parts.join("\n");
}

/** 在标签 / style 正文里找非 `#fragment` 的 href / src / url() 资源引用。 */
function findExternalReference(scan) {
  const attrRe = /(?<![\w-])(?:xlink\s*:\s*)?(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  while ((m = attrRe.exec(scan))) {
    const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (value && !value.startsWith("#")) return `${m[1]}="${value.slice(0, 80)}"`;
  }
  const urlRe = /(?<![\w-])url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/gi;
  while ((m = urlRe.exec(scan))) {
    const value = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (value && !value.startsWith("#")) return `url(${value.slice(0, 80)})`;
  }
  return null;
}

/**
 * 返回命中的不支持能力（含中文原因），没有命中返回 null。
 * 只用于 `inspectSvg` 的原始文本扫描，可被单独测试。
 */
export function findUnsupportedFeature(svgText) {
  // 注释是惰性内容：先去掉，避免把注释里的示例 / 字词当成真实能力。
  const raw = String(svgText).replace(/<!--[\s\S]*?-->/g, " ");

  if (/<\s*script[\s>/]/i.test(raw)) {
    return {
      code: "script",
      reason: "SVG 含 <script> 脚本：立体化只接受纯几何，脚本不会被执行。请删除脚本后重新导出。"
    };
  }
  if (/<!\s*ENTITY\b/i.test(raw)) {
    return {
      code: "entity",
      reason:
        "SVG 含内部实体定义（<!ENTITY>）：解析器不会展开实体定义。请移除 DOCTYPE 内部子集 / 实体声明后重新导出。"
    };
  }

  const scan = tagAndStyleInteriors(raw);
  if (/\bon[a-z]+\s*=/i.test(scan)) {
    return {
      code: "event-handler",
      reason: "SVG 含内联事件属性（on*）：立体化不会执行任何事件脚本。请删除 on… 属性后重新导出。"
    };
  }
  if (/@import\b/i.test(scan)) {
    return {
      code: "css-import",
      reason: "SVG 内联 CSS 含 @import：不支持外部样式资源。请改为内联样式或删除后重新导出。"
    };
  }
  const ref = findExternalReference(scan);
  if (ref) {
    return {
      code: "external-ref",
      reason:
        `SVG 引用了外部 / 非本地资源（${ref}）：立体化只处理本地几何，不加载外部或内嵌资源。` +
        "请把引用改为本地 #fragment，或导出时展开后再试。"
    };
  }
  return null;
}

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
 * `bevelEnabled === false` 时没有倒角分层，倍数相应变小。
 * 只用于估算，宁大勿小。
 */
export function extrusionVertexFactor(bevelSegments, bevelEnabled = true) {
  const layers = bevelEnabled ? 1 + 2 * Math.max(0, Number(bevelSegments) || 0) : 1;
  return 6 * layers + 18;
}

/**
 * 按「图形数量」粗估顶点数的旧口径，仅作参考；
 * 真正的硬上限是 `inspectShapes` / `planShapes` 的采样点数 × {@link extrusionVertexFactor}。
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
  const scanText = stripInertDefinitions(text);
  const pathCount = countDrawables(scanText);

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
      `文件过大（${formatBytes(bytes)}，上限 ${formatBytes(maxBytes)}）。` +
        "请先在设计软件里合并图层、简化节点后再导出。"
    );
  }

  // 最小 unsupported-input guard：扫原始文本（含 defs / metadata），
  // 只拦截脚本 / 事件属性 / 内部实体 / 外部资源引用，放行命名空间与 #fragment。
  const unsupported = findUnsupportedFeature(text);
  if (unsupported) return reject(unsupported.code, unsupported.reason);

  for (const rule of REJECT_RULES) {
    if (rule.test(scanText)) return reject(rule.code, rule.reason);
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

/** 人类可读的字节数，用于真实 size 提示。 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MiB`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * 按给定 curveSegments 采样所有轮廓（含孔洞）的点数。
 * 调用方（页面）会按 SVG 文本缓存结果，避免拖动参数时反复遍历曲线。
 */
export function sampleContourPoints(shapes, curveSegments) {
  const list = Array.isArray(shapes) ? shapes : [];
  const cs = Math.max(1, Math.round(curveSegments) || 1);
  let sampled = 0;
  for (const shape of list) {
    if (shape && typeof shape.getPoints === "function") {
      sampled += shape.getPoints(cs).length;
    }
    const holes = shape && Array.isArray(shape.holes) ? shape.holes : [];
    for (const hole of holes) {
      if (hole && typeof hole.getPoints === "function") {
        sampled += hole.getPoints(cs).length;
      }
    }
  }
  return sampled;
}

/**
 * 解析后、三角化前的**下限**估算：按最低可利用细分（curveSegments 下限；
 * 倒角关闭时为 0 段）估算挤出顶点。即使这样也超预算的输入，在 `measureFlatMaxDim`
 * 对大 path 做 `ShapeGeometry` 三角化之前就拒绝，避免主线程被卡死。
 *
 * 选项：
 *   bevelEnabled：本次是否启用倒角。开启时下限用 bevelSegments 下限；
 *                 关闭时下限用 0 段（即放行「关掉倒角才装得下」的输入）。
 *   samplePoints：可选缓存采样函数 (curveSegments) => 点数。
 *
 * 只做保守下限，不下结论「一定能建」：真正的自适应裁剪仍由 `planShapes` 决定。
 */
export function estimateMinimumVertices(shapes, options = {}) {
  const list = Array.isArray(shapes) ? shapes : [];
  const bevelEnabled = options.bevelEnabled !== false;
  const curveSegments = SEGMENT_FLOORS.curveSegments;
  const bevelSegments = bevelEnabled ? SEGMENT_FLOORS.bevelSegments : 0;
  const factor = extrusionVertexFactor(bevelSegments, bevelEnabled);
  const sampledPoints =
    typeof options.samplePoints === "function"
      ? options.samplePoints(curveSegments)
      : sampleContourPoints(list, curveSegments);
  return {
    shapeCount: list.length,
    sampledPoints,
    estVerts: sampledPoints * factor,
    factor,
    curveSegments,
    bevelSegments,
    bevelEnabled
  };
}

/**
 * 几何级硬上限：解析后的 Shape 按**本次真实使用的** curveSegments 采样，
 * 再乘按真实 bevelEnabled / bevelSegments 计算的保守倍数，估算挤出顶点数。
 *
 * options:
 *   curveSegments / bevelSegments / bevelEnabled：本次真正交给 three.ExtrudeGeometry 的参数
 *   vertexBudget：顶点上限
 *   samplePoints：可选缓存采样函数 (curveSegments) => 点数；缺省时现场遍历曲线
 *
 * 返回：
 *   { ok: true, shapeCount, sampledPoints, estVerts, factor, curveSegments, bevelSegments }
 *   { ok: false, ...同字段, code, reason }
 */
export function inspectShapes(shapes, options = {}) {
  const list = Array.isArray(shapes) ? shapes : [];
  const shapeCount = list.length;
  const vertexBudget = options.vertexBudget ?? LIMITS.vertexBudget;
  const curveSegments = clampInt(options.curveSegments ?? 32, 1, 512);
  const bevelSegments = clampInt(options.bevelSegments ?? 4, 0, 128);
  const bevelEnabled = options.bevelEnabled !== false;
  const factor = extrusionVertexFactor(bevelSegments, bevelEnabled);

  const fail = (code, reason, sampledPoints, estVerts) => ({
    ok: false,
    code,
    reason,
    shapeCount,
    sampledPoints,
    estVerts,
    factor,
    curveSegments,
    bevelSegments
  });

  if (shapeCount === 0) {
    return fail("no-shapes", "已拒绝导入：SVG 里没有可挤出的轮廓。", 0, 0);
  }

  const sampledPoints =
    typeof options.samplePoints === "function"
      ? options.samplePoints(curveSegments)
      : sampleContourPoints(list, curveSegments);
  const estVerts = sampledPoints * factor;

  if (estVerts > vertexBudget) {
    return fail(
      "vertex-budget",
      `已拒绝导入：路径曲线过多，按本次细分（曲线 ${curveSegments} 段 / 倒角 ${bevelEnabled ? bevelSegments : 0} 段）` +
        `采样 ${sampledPoints.toLocaleString("en-US")} 个轮廓点，估算约 ${estVerts.toLocaleString("en-US")} 个挤出顶点，` +
        `超过上限 ${vertexBudget.toLocaleString("en-US")}（×${factor}）。请减少曲线/节点，或降低平滑度。`,
      sampledPoints,
      estVerts
    );
  }

  return { ok: true, shapeCount, sampledPoints, estVerts, factor, curveSegments, bevelSegments };
}

/**
 * 在 `inspectShapes` 之上做自适应细分：
 *   1. 先按基础 curveSegments / bevelSegments 估算；
 *   2. 超预算就优先减少 curveSegments，再减少 bevelSegments，直到最低合理下限；
 *   3. 下限仍超出才返回拒绝（真正的极端密集文件）。
 *
 * 返回 { ok, reduced, curveSegments, bevelSegments, sampledPoints, estVerts, factor, reason? }。
 */
export function planShapes(shapes, options = {}) {
  const vertexBudget = options.vertexBudget ?? LIMITS.vertexBudget;
  const bevelEnabled = options.bevelEnabled !== false;
  const samplePoints = options.samplePoints;

  let curveSegments = clampInt(options.curveSegments ?? 32, SEGMENT_FLOORS.curveSegments, 512);
  let bevelSegments = clampInt(
    options.bevelSegments ?? 4,
    bevelEnabled ? SEGMENT_FLOORS.bevelSegments : 0,
    128
  );
  let reduced = false;

  let result = inspectShapes(shapes, {
    curveSegments,
    bevelSegments,
    bevelEnabled,
    vertexBudget,
    samplePoints
  });

  while (
    !result.ok &&
    (curveSegments > SEGMENT_FLOORS.curveSegments ||
      (bevelEnabled && bevelSegments > SEGMENT_FLOORS.bevelSegments))
  ) {
    if (curveSegments > SEGMENT_FLOORS.curveSegments) {
      curveSegments = Math.max(SEGMENT_FLOORS.curveSegments, Math.floor(curveSegments / 2));
    } else {
      bevelSegments = Math.max(SEGMENT_FLOORS.bevelSegments, Math.floor(bevelSegments / 2));
    }
    reduced = true;
    result = inspectShapes(shapes, {
      curveSegments,
      bevelSegments,
      bevelEnabled,
      vertexBudget,
      samplePoints
    });
  }

  if (!result.ok) {
    return {
      ...result,
      reduced,
      reason:
        `已拒绝导入：路径曲线过于密集，即使降到最低细分（曲线 ${SEGMENT_FLOORS.curveSegments} 段 / ` +
        `倒角 ${bevelEnabled ? SEGMENT_FLOORS.bevelSegments : 0} 段）仍估算约 ${result.estVerts.toLocaleString("en-US")} 个挤出顶点，` +
        `超过硬上限 ${vertexBudget.toLocaleString("en-US")}。请减少曲线 / 节点后再试。`
    };
  }

  return { ...result, reduced };
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
