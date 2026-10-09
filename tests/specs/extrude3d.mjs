/**
 * SVG 挤出三维（tools/extrude3d）外部 smoke 规格。
 *
 * 覆盖：页面可进入 / WebGL2 可用 / 真实渲染出 3D 内容 / 参数与材质变化真的改变像素 /
 * 上传样例成功建模 / 危险 SVG 被明确拒绝且不崩 / 导出 PNG 非空且尺寸正确 / 透明导出带 alpha。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, canvasLooksDrawn, pngInfo, webglReport } from "../harness.mjs";

export const id = "extrude3d";
export const title = "SVG 挤出三维";
export const gpu = "webgl2";

const SAMPLE = resolve(ROOT, "tools/extrude3d/samples/square-ring.svg");
const TMP_DIR = resolve(ROOT, ".tmp");
const TEXT_SVG = resolve(TMP_DIR, "extrude3d-reject-text.svg");
const MANY_CURVES_SVG = resolve(TMP_DIR, "extrude3d-reject-many-curves.svg");

/**
 * 生成「单条 path 含大量曲线」的 SVG：图形元素只有 1 条、字符串远小于 64 KB，
 * 但采样轮廓点估算出的挤出顶点会超预算——只数图形元素是拦不住的。
 */
function manyCurveSvg(count = 400) {
  const d = ["M 10 100"];
  for (let i = 0; i < count; i++) {
    const x = 20 + ((i * 7) % 160);
    const y = 20 + ((i * 13) % 160);
    d.push(`C ${x} ${y} ${x + 3} ${y + 4} ${x + 6} ${y + 2}`);
  }
  d.push("Z");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="${d.join(" ")}" fill="#000000"/>
</svg>
`;
}

/** 采样画布像素（40×40 网格，RGBA 平铺数组）。 */
function sampleCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const w = 40;
    const h = 40;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    return Array.from(ctx.getImageData(0, 0, w, h).data);
  });
}

/** 背景色（#efede8）下两份采样的差异：只在「模型区域」内统计，避免被大片背景稀释。 */
function pixelDiff(a, b) {
  const BG = [239, 237, 232];
  if (!a || !b || a.length !== b.length) return { changed: 0, model: 0, ratio: 0 };
  const near = (d, i) =>
    Math.abs(d[i] - BG[0]) + Math.abs(d[i + 1] - BG[1]) + Math.abs(d[i + 2] - BG[2]) > 14;
  let changed = 0;
  let model = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!near(a, i) && !near(b, i)) continue; // 两帧都是背景 → 不计
    model++;
    const d =
      Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 12) changed++;
  }
  return { changed, model, ratio: model ? +(changed / model).toFixed(4) : 0 };
}

/** 设置 input/select 的值并派发原生事件，等价于用户操作。 */
function setControl(page, id, value, type = "input") {
  return page.evaluate(
    (sel, val, evt) => {
      const el = document.getElementById(sel);
      if (!el) throw new Error(`缺少控件 #${sel}`);
      if (el.type === "checkbox") el.checked = !!val;
      else el.value = String(val);
      el.dispatchEvent(new Event(evt, { bubbles: true }));
      return el.value;
    },
    id,
    value,
    type
  );
}

const waitModelled = (page, timeout = 25000) =>
  page.waitForFunction(
    () => {
      const el = document.getElementById("status");
      return el && el.textContent.includes("已建模");
    },
    { timeout, polling: 120 }
  );

export async function run({ page, base, downloads, check, sleep }) {
  const url = `${base}/tools/extrude3d/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);

  const pageTitle = await page.title();
  check.ok("标题正确", pageTitle.includes("挤出三维"), pageTitle);

  const webgl = await webglReport(page);
  check.ok("WebGL2 可用", webgl.webgl2 === true, `renderer=${webgl.renderer || "n/a"}`);

  // 首次加载即展示 samples/square-ring.svg
  await page.waitForSelector("canvas", { timeout: 20000 });
  await waitModelled(page).catch(() => {});
  const firstName = await page.$eval("#svg-name", (n) => n.textContent.trim());
  check.ok("首次加载展示内置样例", firstName.includes("square-ring.svg"), `当前=${firstName}`);

  await sleep(900);
  const initial = await sampleCanvas(page);
  const drawn = await canvasLooksDrawn(page);
  check.ok(
    "画布真实渲染出 3D 内容",
    drawn.drawn === true,
    `drawn=${drawn.drawn} opaqueRatio=${drawn.opaqueRatio} meanLuma=${drawn.meanLuma} size=${drawn.size}`
  );

  // 材质下拉必须能给出关键预设
  const presetIds = await page.$$eval("#material option", (nodes) => nodes.map((n) => n.value));
  for (const required of ["chrome", "glass", "frostedGlass", "plastic"]) {
    check.ok(`材质预设含 ${required}`, presetIds.includes(required), `共 ${presetIds.length} 项`);
  }

  // 参数变化 → 几何重建 → 几何厚度真的变了，并且画面像素变化
  const beforeDepth = await page.evaluate(() => window.__extrude3d.getInfo());
  await setControl(page, "depth", "5.5", "input");
  await sleep(800);
  const afterDepthInfo = await page.evaluate(() => window.__extrude3d.getInfo());
  const afterDepth = await sampleCanvas(page);
  const depthDiff = pixelDiff(initial, afterDepth);
  check.ok(
    "改厚度后几何 z 尺寸真的增大",
    afterDepthInfo.size[2] > beforeDepth.size[2] * 1.5,
    `几何局部尺寸 z: ${beforeDepth.size[2]} → ${afterDepthInfo.size[2]}`
  );
  check.ok(
    "改厚度后画面像素变化",
    depthDiff.ratio > 0.03,
    `模型区域内变化像素 ${depthDiff.changed}/${depthDiff.model}（${(depthDiff.ratio * 100).toFixed(1)}%）`
  );

  // 取景：厚度拉满时模型仍完整落在视图内（自适应取景，不裁切）
  await setControl(page, "depth", "10", "input");
  await sleep(900);
  const framing = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const w = 140;
    const h = 140;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const diff = Math.abs(d[i] - 239) + Math.abs(d[i + 1] - 237) + Math.abs(d[i + 2] - 232);
        if (diff > 14) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      coverage: +(count / (w * h)).toFixed(3),
      bbox: [minX, minY, maxX, maxY],
      touchesEdge: minX <= 0 || minY <= 0 || maxX >= w - 1 || maxY >= h - 1
    };
  });
  check.ok(
    "厚度拉满时模型完整落在视图内",
    framing.touchesEdge === false && framing.coverage > 0.05,
    `bbox=${framing.bbox.join(",")} coverage=${framing.coverage}`
  );

  // 材质变化 → 像素变化（镀铬 → 玻璃），厚度先回到 5.5 保持单一变量
  await setControl(page, "depth", "5.5", "input");
  await sleep(700);
  const beforeMaterial = await sampleCanvas(page);
  await setControl(page, "material", "glass", "change");
  await sleep(800);
  const afterMaterial = await sampleCanvas(page);
  const materialDiff = pixelDiff(beforeMaterial, afterMaterial);
  check.ok(
    "改材质预设后画面像素变化",
    materialDiff.ratio > 0.1,
    `模型区域内变化像素 ${materialDiff.changed}/${materialDiff.model}（${(materialDiff.ratio * 100).toFixed(1)}%）`
  );

  // 上传内置样例 SVG 成功建模
  const input = await page.$("input[type=file]");
  check.ok("存在文件上传控件", !!input);
  await input.uploadFile(SAMPLE);
  await waitModelled(page);
  await sleep(600);
  const uploaded = await page.evaluate(() => ({
    name: document.getElementById("svg-name").textContent.trim(),
    info: window.__extrude3d.getInfo()
  }));
  check.ok(
    "上传 square-ring.svg 成功建模",
    uploaded.name.includes("square-ring.svg") &&
      uploaded.info.shapeCount > 0 &&
      uploaded.info.vertexCount > 0,
    `name=${uploaded.name} shapeCount=${uploaded.info.shapeCount} verts=${uploaded.info.vertexCount}`
  );
  const afterUpload = await canvasLooksDrawn(page);
  check.ok("上传后画布仍有内容", afterUpload.drawn === true, `opaqueRatio=${afterUpload.opaqueRatio}`);

  // 透明背景：画布alpha生效（导出 PNG 走 alpha:true 的渲染器）
  await setControl(page, "transparent-bg", true, "change");
  await sleep(500);
  const alphaProbe = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const tmp = document.createElement("canvas");
    tmp.width = 30;
    tmp.height = 30;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 30, 30);
    ctx.drawImage(canvas, 0, 0, 30, 30);
    const d = ctx.getImageData(0, 0, 30, 30).data;
    const a = (x, y) => d[(y * 30 + x) * 4 + 3];
    let maxAlpha = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > maxAlpha) maxAlpha = d[i];
    return { corner: a(0, 0), corner2: a(29, 0), maxAlpha };
  });
  check.ok(
    "透明背景开关生效（边角 alpha=0 且模型处有内容）",
    alphaProbe.corner === 0 && alphaProbe.corner2 === 0 && alphaProbe.maxAlpha > 0,
    `corner=${alphaProbe.corner} corner2=${alphaProbe.corner2} maxAlpha=${alphaProbe.maxAlpha}`
  );

  // 导出 PNG
  const viewWidth = await page.$eval("#view", (n) => Math.round(n.clientWidth));
  await setControl(page, "export-scale", "2", "change");
  await page.click("#export-png");
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "PNG 下载非空且尺寸有效",
    file.size > 1000 && info.width > 0 && info.height > 0,
    `${file.name} ${file.size}B ${info.width}x${info.height}`
  );
  check.ok("导出文件名含 extrude3d", /extrude3d/i.test(file.name), file.name);
  check.ok(
    "PNG 倍率生效（2× 视图宽度）",
    Math.abs(info.width - viewWidth * 2) <= 10,
    `png=${info.width}px 视图=${viewWidth}px`
  );
  check.ok("透明模式导出的 PNG 带 alpha 通道", file.bytes[25] === 6, `IHDR colorType=${file.bytes[25]}`);
  check.ok("页面无未捕获异常", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));

  // 危险 SVG：含 <text> 必须被明确拒绝
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(
    TEXT_SVG,
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <text x="20" y="120" font-size="72" font-family="sans-serif">Hi</text>
</svg>
`,
    "utf8"
  );
  const fileInput = await page.$("input[type=file]");
  await fileInput.uploadFile(TEXT_SVG);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim().length > 0;
    },
    { timeout: 15000, polling: 100 }
  );
  const rejection = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    hidden: document.getElementById("error").hidden,
    info: window.__extrude3d.getInfo(),
    canvasCount: document.querySelectorAll("canvas").length
  }));
  check.ok(
    "含 <text> 的 SVG 被明确拒绝并给出中文原因",
    rejection.hidden === false &&
      rejection.text.includes("拒绝") &&
      /text|tspan/i.test(rejection.text),
    rejection.text.slice(0, 120)
  );
  check.ok(
    "拒绝后不崩溃且保留上一次成功模型",
    rejection.canvasCount === 1 &&
      rejection.info.shapeCount > 0 &&
      rejection.info.lastError !== null,
    `shapeCount=${rejection.info.shapeCount} lastError=${String(rejection.info.lastError).slice(0, 60)}`
  );
  const afterReject = await canvasLooksDrawn(page);
  check.ok("拒绝后画布仍可渲染", afterReject.drawn === true, `opaqueRatio=${afterReject.opaqueRatio}`);

  // 单条 path 内塞入大量曲线：图形元素只有 1 条，字符串很小，
  // 但采样轮廓点估算的挤出顶点超预算，必须在挤出前被拒绝，并保留上一次成功模型。
  const beforeMany = await page.evaluate(() => document.getElementById("error").textContent.trim());
  await writeFile(MANY_CURVES_SVG, manyCurveSvg(400), "utf8");
  const manyInput = await page.$("input[type=file]");
  await manyInput.uploadFile(MANY_CURVES_SVG);
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim() !== prev && /曲线|顶点/.test(el.textContent);
    },
    { timeout: 20000, polling: 100 },
    beforeMany
  );
  const manyReject = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    info: window.__extrude3d.getInfo(),
    canvasCount: document.querySelectorAll("canvas").length
  }));
  check.ok(
    "单条 path 含大量曲线被拒绝并给出中文原因",
    manyReject.text.includes("拒绝") && /曲线|顶点/.test(manyReject.text),
    manyReject.text.slice(0, 140)
  );
  check.ok(
    "曲线超限后保留上一次成功模型",
    manyReject.canvasCount === 1 &&
      manyReject.info.shapeCount > 0 &&
      manyReject.info.lastError !== null,
    `shapeCount=${manyReject.info.shapeCount} lastError=${String(manyReject.info.lastError).slice(0, 60)}`
  );
  const afterManyReject = await canvasLooksDrawn(page);
  check.ok("曲线超限后画布仍可渲染", afterManyReject.drawn === true, `opaqueRatio=${afterManyReject.opaqueRatio}`);
  check.ok("曲线超限后页面无未捕获异常", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
}
