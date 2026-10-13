/**
 * SVG立体（tools/extrude3d）外部 smoke 规格。
 *
 * 覆盖：页面可进入 / WebGL2 可用 / 真实渲染出 3D 内容 / 参数与材质变化真的改变像素 /
 * 上传样例成功建模 / 危险 SVG 被明确拒绝且不崩 / 导出 PNG 非空且尺寸正确 / 透明导出带 alpha /
 * 上传本地 PNG 作为基础色表面贴图（真实改变像素、随材质与几何保留、移除恢复预设颜色、
 * 无效文件不丢当前贴图）。
 */
import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ROOT, canvasLooksDrawn, pngInfo, webglReport } from "../harness.mjs";

export const id = "extrude3d";
export const title = "SVG立体";
export const gpu = "webgl2";

const SAMPLE = resolve(ROOT, "tools/extrude3d/samples/square-ring.svg");
const TEXTURE_PHOTO = resolve(ROOT, "tests/fixtures/test-photo.png");
const TMP_DIR = resolve(ROOT, ".tmp");
const TEXT_SVG = resolve(TMP_DIR, "extrude3d-reject-text.svg");
const MANY_CURVES_SVG = resolve(TMP_DIR, "extrude3d-reject-many-curves.svg");
const FAKE_PNG = resolve(TMP_DIR, "extrude3d-fake-texture.png");
const TEXT_PLAIN = resolve(TMP_DIR, "extrude3d-texture.txt");
const SOLID_SVG = resolve(TMP_DIR, "extrude3d-solid.svg");
const SMOOTH_100_SVG = resolve(TMP_DIR, "extrude3d-smooth-100.svg");
const SMOOTH_400_SVG = resolve(TMP_DIR, "extrude3d-smooth-400.svg");
const ALLOWED_ORDINARY_SVG = resolve(TMP_DIR, "extrude3d-allowed-ordinary.svg");
const SCRIPT_SVG = resolve(TMP_DIR, "extrude3d-script.svg");
const ENTITY_SVG = resolve(TMP_DIR, "extrude3d-entity.svg");
const EXTERNAL_REF_SVG = resolve(TMP_DIR, "extrude3d-external-ref.svg");
const INERT_DEFS_SVG = resolve(TMP_DIR, "extrude3d-inert-defs.svg");
const VISIBLE_FILTER_SVG = resolve(TMP_DIR, "extrude3d-visible-filter.svg");
const BIG_OK_SVG = resolve(TMP_DIR, "extrude3d-big-ok.svg");
const OVER_LIMIT_SVG = resolve(TMP_DIR, "extrude3d-over-limit.svg");
const PROPORTION_SVGS = [20, 200, 2000].map((units) => resolve(TMP_DIR, `extrude3d-prop-${units}.svg`));

/**
 * 生成「单条 path 含大量曲线」的 SVG：图形元素只有 1 条、字符串远小于 1 MiB，
 * 但即使自适应降到最低细分，采样轮廓点估算出的挤出顶点仍超硬上限——
 * 只数图形元素是拦不住的。默认 2200 条，保证是真正的硬上限用例。
 */
function manyCurveSvg(count = 2200) {
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

/**
 * 平顺闭合轮廓（近似圆）：`segments` 段三次贝塞尔、切向连续、无自交。
 * 这是「普通平滑输入」——用于验证自适应降级会接受它，而不是像随机自交折线那样
 * 让三角化本身变成压力测试。segments 越多，单条 path 内曲线越多。
 */
function smoothCurveSvg(segments = 100) {
  const center = 100;
  const radius = 70;
  const handle = ((4 / 3) * Math.tan(Math.PI / (2 * segments))) * radius;
  const f = (n) => +n.toFixed(3);
  const d = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (2 * Math.PI * i) / segments;
    const a1 = (2 * Math.PI * (i + 1)) / segments;
    const x0 = center + radius * Math.cos(a0);
    const y0 = center + radius * Math.sin(a0);
    const x1 = center + radius * Math.cos(a1);
    const y1 = center + radius * Math.sin(a1);
    const c0x = x0 - handle * Math.sin(a0);
    const c0y = y0 + handle * Math.cos(a0);
    const c1x = x1 + handle * Math.sin(a1);
    const c1y = y1 - handle * Math.cos(a1);
    if (i === 0) d.push(`M ${f(x0)} ${f(y0)}`);
    d.push(`C ${f(c0x)} ${f(c0y)} ${f(c1x)} ${f(c1y)} ${f(x1)} ${f(y1)}`);
  }
  d.push("Z");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="${d.join(" ")}" fill="#111111"/>
</svg>
`;
}

/**
 * 与 square-ring 完全同比例、只改 viewBox 单位的 SVG（20 / 200 / 2000）。
 * 经过「平面最大边长 → 4 单位」的一次归一化后，三者归一化尺寸应一致。
 */
function proportionalSvg(units) {
  const u = units / 200;
  const a = (n) => +(n * u).toFixed(4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${units} ${units}" width="${units}" height="${units}">
  <path fill="#111111" fill-rule="evenodd" d="M${a(20)} ${a(20)} H${a(180)} V${a(180)} H${a(20)} Z M${a(100)} ${a(60)} A${a(40)} ${a(40)} 0 1 0 ${a(100)} ${a(140)} A${a(40)} ${a(40)} 0 1 0 ${a(100)} ${a(60)} Z"/>
</svg>
`;
}

/** 实心方块：玻璃折射测试用，模型区域整块都是玻璃，便于观察背景错位。 */
const SOLID_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect x="20" y="20" width="160" height="160" fill="#111111"/>
</svg>
`;

/**
 * 只有未使用的普通定义（defs 里的 filter / 渐变 + metadata）的 SVG：
 * 不影响可见几何，不应被正则误判为「含滤镜」而拒绝。
 */
const INERT_DEFS_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <metadata>生成信息：仅元数据，不含几何</metadata>
  <defs>
    <filter id="unused-blur"><feGaussianBlur stdDeviation="3"/></filter>
    <linearGradient id="unused-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/>
    </linearGradient>
  </defs>
  <rect x="40" y="40" width="120" height="120" fill="#111111"/>
</svg>
`;

/** 可见元素上直接使用滤镜：仍必须被拒绝（范围明确，不因为放宽 defs 而失效）。 */
const VISIBLE_FILTER_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="M20 20 H180 V180 H20 Z" fill="#111111" filter="url(#blur)"/>
</svg>
`;

/**
 * 普通导出应放行的最小组合：普通 SVG 1.1 DOCTYPE（无内部实体）、
 * xmlns / xmlns:xlink 命名空间 URL、metadata 正文（含看起来像 URL 的说明文字）、
 * defs 里未使用的 filter / 渐变，以及本地 `#fragment` 引用。都应正常导入。
 */
const ALLOWED_ORDINARY_SVG_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 200" width="200" height="200">
  <metadata>导出说明：参考 https://example.com/design ，正文里的 onload= 只是文字</metadata>
  <defs>
    <filter id="allowed-unused-blur"><feGaussianBlur stdDeviation="2"/></filter>
    <linearGradient id="allowed-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/>
    </linearGradient>
    <linearGradient id="allowed-grad-alias" xlink:href="#allowed-grad"/>
  </defs>
  <rect x="40" y="40" width="120" height="120" fill="url(#allowed-grad)"/>
</svg>
`;

/** 真实 <script>：最小 unsupported-input guard 必须拒绝（不执行、不解析）。 */
const SCRIPT_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <script>alert("x")</script>
  <rect x="40" y="40" width="120" height="120" fill="#111111"/>
</svg>
`;

/** 内部 ENTITY 定义：必须拒绝，绝不能展开。 */
const ENTITY_SVG_TEXT = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect x="40" y="40" width="120" height="120" fill="#111111"/>
</svg>
`;

/** 外部资源引用（href 指向网络 + CSS @import）：即使只是普通导出也必须拒绝。 */
const EXTERNAL_REF_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 200" width="200" height="200">
  <style>@import url("https://example.com/theme.css");</style>
  <a xlink:href="https://example.com/icon.svg"><rect x="40" y="40" width="120" height="120" fill="#111111"/></a>
</svg>
`;

/** 生成一个含指定 ASCII 注释填充、总字节数约为 `bytes` 的普通 SVG。 */
function paddedSvg(bytes) {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">\n`;
  const body = `  <rect x="30" y="30" width="140" height="140" fill="#111111"/>\n`;
  const tail = `</svg>\n`;
  const padLen = Math.max(0, bytes - head.length - body.length - tail.length);
  return head + `<!-- ${"x".repeat(Math.max(0, padLen - 8))} -->\n` + body + tail;
}

/** 采样 `n×n` 网格的 RGBA（用于玻璃折射的空间错位比对）。 */
function sampleCanvasN(page, n) {
  return page.evaluate((size) => {
    const canvas = document.querySelector("canvas");
    const tmp = document.createElement("canvas");
    tmp.width = size;
    tmp.height = size;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(canvas, 0, 0, size, size);
    return Array.from(ctx.getImageData(0, 0, size, size).data);
  }, n);
}

/**
 * 在 [x0,x1)×[y0,y1) 区域内搜索最佳平移 (dx,dy)，返回最小平均 RGB 差与对应位移。
 * `range` 为搜索半径（像素）。用来区分「空间错位」（玻璃折射）和「单纯明暗变化」。
 */
function bestShift(a, b, size, box, range = 4) {
  const [x0, y0, x1, y1] = box;
  let best = { dx: 0, dy: 0, err: Infinity, zeroErr: Infinity };
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      let err = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
          const i = (y * size + x) * 4;
          const j = (sy * size + sx) * 4;
          err += Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);
          n++;
        }
      }
      if (!n) continue;
      const mean = err / n;
      if (dx === 0 && dy === 0) best.zeroErr = +mean.toFixed(2);
      if (mean < best.err) best = { ...best, dx, dy, err: +mean.toFixed(2) };
    }
  }
  return best;
}

/** RGBA 采样的平均通道标准差：用来确认背景确有细节，不是纯色 / 糊成一片。 */
function sampleVariance(data) {
  if (!data || !data.length) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

/**
 * 在页面内生成**非周期、高对比**的马赛克 PNG 并用 DataTransfer 上传为背景图
 * （不引入外部素材）。规则棋盘在整数像素平移下会混叠，随机马赛克的自相关峰
 * 只在零位移处最尖锐，才能可靠地检出玻璃折射的空间错位。
 */
async function uploadVariedBackground(page, sleep) {
  await page.evaluate(async () => {
    const size = 512;
    const cell = 8;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const palette = [
      "#111111",
      "#f5f5f5",
      "#e53935",
      "#1e88e5",
      "#43a047",
      "#fdd835",
      "#8e24aa",
      "#fb8c00",
      "#00acc1",
      "#6d4c41"
    ];
    let seed = 20240521;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
        ctx.fillRect(x, y, cell, cell);
      }
    }
    // 两条不对称对角线 + 一个偏心方块：提供低频、方向明确的特征
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size, size * 0.6);
    ctx.stroke();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size * 0.7, 0);
    ctx.stroke();
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(size * 0.6, size * 0.15, 72, 72);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const input = document.getElementById("bg-file");
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "varied-mosaic.png", { type: "image/png" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.getElementById("bg-name").textContent.includes("varied-mosaic"),
    { timeout: 20000, polling: 100 }
  );
  await sleep(700);
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

/** 背景色（#ffffff）下两份采样的差异：只在「模型区域」内统计，避免被大片背景稀释。 */
function pixelDiff(a, b) {
  const BG = [255, 255, 255];
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

/**
 * 两份 40×40 RGBA 采样在「模型区域」（任一帧 alpha>8）内的差异。
 * 用于把「真正解码出来的导出 PNG」和「预览画布」放在同一分辨率下比较：
 * 覆盖像素数应接近，模型内部（两帧都 alpha>200）的差异应极小；
 * 边缘允许少量抗锯齿差异，因此每像素差异要足够大才计入 changed。
 */
function modelSampleDiff(a, b) {
  if (!a || !b || a.length !== b.length) {
    return {
      model: 0,
      changed: 0,
      ratio: 1,
      modelA: 0,
      modelB: 0,
      core: 0,
      coreChanged: 0,
      coreRatio: 1,
      meanA: [0, 0, 0],
      meanB: [0, 0, 0],
      meanDelta: 255
    };
  }
  let model = 0;
  let changed = 0;
  let modelA = 0;
  let modelB = 0;
  let core = 0;
  let coreChanged = 0;
  const sumA = [0, 0, 0];
  const sumB = [0, 0, 0];
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3];
    const ba = b[i + 3];
    if (aa > 8) {
      modelA++;
      sumA[0] += a[i];
      sumA[1] += a[i + 1];
      sumA[2] += a[i + 2];
    }
    if (ba > 8) {
      modelB++;
      sumB[0] += b[i];
      sumB[1] += b[i + 1];
      sumB[2] += b[i + 2];
    }
    const delta =
      Math.abs(a[i] - b[i]) +
      Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]) +
      Math.abs(aa - ba);
    if (aa > 8 || ba > 8) {
      model++;
      if (delta > 100) changed++;
    }
    if (aa > 200 && ba > 200) {
      core++;
      const rgb =
        Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (rgb > 60) coreChanged++;
    }
  }
  const meanA = sumA.map((s) => s / Math.max(modelA, 1));
  const meanB = sumB.map((s) => s / Math.max(modelB, 1));
  const meanDelta =
    Math.abs(meanA[0] - meanB[0]) + Math.abs(meanA[1] - meanB[1]) + Math.abs(meanA[2] - meanB[2]);
  return {
    model,
    changed,
    ratio: model ? +(changed / model).toFixed(4) : 1,
    modelA,
    modelB,
    core,
    coreChanged,
    coreRatio: core ? +(coreChanged / core).toFixed(4) : 1,
    meanA,
    meanB,
    meanDelta: +meanDelta.toFixed(1)
  };
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
  check.ok("标题正确", pageTitle.includes("SVG 转 3D"), pageTitle);

  const webgl = await webglReport(page);
  check.ok("WebGL2 可用", webgl.webgl2 === true, `renderer=${webgl.renderer || "n/a"}`);

  // 首次加载即展示原生真实立方体（默认来源 cube，玻璃材质）；随后切回 square-ring 跑旧回归。
  await page.waitForSelector("canvas", { timeout: 20000 });
  await waitModelled(page).catch(() => {});
  const firstCube = await page.evaluate(() => {
    const api = window.__extrude3d;
    const info = api.getInfo();
    return {
      name: document.getElementById("svg-name").textContent.trim(),
      source: info.source,
      geometryType: info.geometryType,
      preset: info.preset,
      size: info.normalizedSize.size,
      depthPercent: info.settings.depthPercent,
      sampleValue: document.getElementById("sample").value
    };
  });
  check.ok(
    "首次加载展示原生真实立方体（默认来源 cube，three 原生几何，非 SVG 近似）",
    firstCube.source === "cube" &&
      firstCube.sampleValue === "cube" &&
      /BoxGeometry|RoundedBoxGeometry/.test(firstCube.geometryType || "") &&
      firstCube.name.includes("立方体"),
    `source=${firstCube.source} geometry=${firstCube.geometryType} name=${firstCube.name}`
  );
  check.ok(
    "默认立方体是 4×4×4（厚度 100% = 最大边）且默认透明玻璃",
    firstCube.preset === "glass" &&
      firstCube.depthPercent === 100 &&
      firstCube.size.every((v) => Math.abs(v - 4) < 0.05),
    `preset=${firstCube.preset} depth=${firstCube.depthPercent}% size=${JSON.stringify(firstCube.size)}`
  );

  // 旧回归以 square-ring 为基线：切回 SVG 样例并等建模完成再继续（不废弃旧 115 项断言）。
  await setControl(page, "sample", "square-ring", "change");
  await waitModelled(page).catch(() => {});
  await sleep(500);
  const firstName = await page.$eval("#svg-name", (n) => n.textContent.trim());
  check.ok("切换到 square-ring 样例建模成功（旧回归基线）", firstName.includes("square-ring.svg"), `当前=${firstName}`);

  // 背景模式默认必须是纯色（旧行为），且提供纯色 / 棚拍空间 / 图片三种选择。
  const bgModeDefault = await page.$eval("#bg-mode", (el) => ({
    value: el.value,
    options: Array.from(el.options).map((o) => o.value)
  }));
  check.ok(
    "背景模式默认纯色且提供 纯色 / 棚拍空间 / 图片 三种选择",
    bgModeDefault.value === "pure" &&
      ["pure", "studio", "image"].every((v) => bgModeDefault.options.includes(v)),
    `value=${bgModeDefault.value} options=${bgModeDefault.options.join(",")}`
  );

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

  // 轻量名称断言：38 个材质预设全部有中文名，value（上游 preset id）不变，
  // 常用材质仍然可从下拉里选中并生效。
  const materialOptions = await page.$$eval("#material option", (nodes) =>
    nodes.map((n) => ({ value: n.value, label: (n.textContent || "").trim() }))
  );
  check.ok("材质预设共 38 个", materialOptions.length === 38, `共 ${materialOptions.length} 项`);
  const noChinese = materialOptions.filter((o) => !/[\u4e00-\u9fff]/.test(o.label));
  check.ok(
    "38 个材质中文名齐全",
    noChinese.length === 0,
    noChinese.length ? noChinese.map((o) => `${o.value}=${o.label}`).join("、") : "全部含中文"
  );
  check.ok(
    "材质 value（上游 preset id）无重复",
    new Set(presetIds).size === presetIds.length,
    `${new Set(presetIds).size}/${presetIds.length}`
  );
  const MATERIAL_ZH = {
    chrome: "镜面金属",
    glass: "透明玻璃",
    diamond: "水晶效果",
    y2kGloss: "亮面",
    candyInflate: "糖果塑料",
    plastic: "塑料",
    gold: "黄金",
    frostedGlass: "磨砂玻璃"
  };
  for (const [value, label] of Object.entries(MATERIAL_ZH)) {
    const option = materialOptions.find((o) => o.value === value);
    check.ok(`材质 ${value} 中文名为「${label}」`, !!option && option.label === label, option ? option.label : "缺失");
  }
  // 常用材质：通过界面 change 事件选一遍，value 未改、状态跟随。
  const commonPicked = await page.evaluate(() => {
    const select = document.getElementById("material");
    const wanted = ["plastic", "chrome", "glass", "gold"];
    return wanted.map((id) => {
      const exists = Array.from(select.options).some((o) => o.value === id);
      if (!exists) return { id, exists, active: null };
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return { id, exists, active: window.__extrude3d.getState().preset };
    });
  });
  for (const item of commonPicked) {
    check.ok(
      `常用材质「${item.id}」可选且生效`,
      item.exists && item.active === item.id,
      item.exists ? `当前=${item.active}` : "下拉里没有"
    );
  }
  // 恢复默认材质，后续「改材质像素变化」从 chrome 起算。
  await setControl(page, "material", "chrome", "change");
  await sleep(300);

  // 参数变化 → 几何重建 → 几何厚度真的变了，并且画面像素变化
  const beforeDepth = await page.evaluate(() => window.__extrude3d.getInfo());
  await setControl(page, "depth", "55", "input");
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
  await setControl(page, "depth", "100", "input");
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
        const diff = Math.abs(d[i] - 255) + Math.abs(d[i + 1] - 255) + Math.abs(d[i + 2] - 255);
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

  // 材质变化 → 像素变化（镀铬 → 玻璃），厚度先回到 55% 保持单一变量
  await setControl(page, "depth", "55", "input");
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

  /* ---------- 表面贴图：本地 PNG → 上游 UV → MeshPhysicalMaterial.map ---------- */
  // 贴图在非透射材质上最直观：先切到塑料（当前是透明玻璃）
  await setControl(page, "material", "plastic", "change");
  await sleep(500);
  const beforeTexture = await sampleCanvas(page);
  const textureInput = await page.$("#texture-file");
  check.ok("存在「上传表面贴图」控件", !!textureInput);
  await textureInput.uploadFile(TEXTURE_PHOTO);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("texture-name");
      return el && el.textContent.includes("test-photo");
    },
    { timeout: 20000, polling: 100 }
  );
  await sleep(800);
  const textured = await page.evaluate(() => {
    const material = window.__extrude3d.mesh.material;
    const map = material.map;
    return {
      hasMap: !!map,
      colorSpace: map ? map.colorSpace : null,
      baseColor: material.color.getHexString(),
      mapSize: map && map.image ? [map.image.width, map.image.height] : null,
      name: document.getElementById("texture-name").textContent.trim(),
      info: window.__extrude3d.getInfo()
    };
  });
  check.ok(
    "上传 PNG 后材质绑定基础色贴图",
    textured.hasMap &&
      textured.info.texture !== null &&
      textured.info.texture.name.includes("test-photo") &&
      !!textured.mapSize &&
      textured.mapSize[0] === 640 &&
      textured.mapSize[1] === 480,
    `map=${textured.hasMap} size=${textured.mapSize} name=${textured.name}`
  );
  check.ok("贴图使用 sRGB 色彩空间", textured.colorSpace === "srgb", String(textured.colorSpace));
  check.ok("未自定义颜色时基色为纯白", textured.baseColor === "ffffff", `color=#${textured.baseColor}`);
  const afterTexture = await sampleCanvas(page);
  const textureDiff = pixelDiff(beforeTexture, afterTexture);
  check.ok(
    "上传真实贴图后画布像素变化",
    textureDiff.ratio > 0.12,
    `模型区域内变化像素 ${textureDiff.changed}/${textureDiff.model}（${(textureDiff.ratio * 100).toFixed(1)}%）`
  );

  // 自定义颜色可以给贴图染色
  await setControl(page, "color-override", true, "change");
  await setControl(page, "color", "#c81e1e", "input");
  await sleep(400);
  const tintedColor = await page.evaluate(() => window.__extrude3d.mesh.material.color.getHexString());
  check.ok("自定义颜色可给贴图染色", tintedColor === "c81e1e", `当前基色=#${tintedColor}`);
  await setControl(page, "color-override", false, "change");
  await sleep(300);

  // 切换材质预设后贴图仍在（map 不因材质重建而丢失）
  await setControl(page, "material", "gold", "change");
  await sleep(500);
  const afterPreset = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "切换材质预设后贴图保留",
    afterPreset.hasMap && !!afterPreset.texture && afterPreset.texture.name.includes("test-photo"),
    `map=${afterPreset.hasMap} texture=${afterPreset.texture ? afterPreset.texture.name : "null"}`
  );

  // 切换 SVG 重建几何后贴图仍在（继续使用上游三平面 UV）
  await setControl(page, "sample", "hex-nest", "change");
  await waitModelled(page);
  await sleep(700);
  const afterSvgSwap = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "切换 SVG 重建几何后贴图保留",
    afterSvgSwap.hasMap && !!afterSvgSwap.texture && afterSvgSwap.texture.name.includes("test-photo"),
    `map=${afterSvgSwap.hasMap} texture=${afterSvgSwap.texture ? afterSvgSwap.texture.name : "null"}`
  );

  // 无效贴图：伪 PNG（解码失败）与非白名单类型都不得丢掉当前有效贴图
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(FAKE_PNG, "这不是一张真正的 PNG 图片\n", "utf8");
  await writeFile(TEXT_PLAIN, "not an image at all\n", "utf8");
  const beforeFake = await page.evaluate(() => document.getElementById("error").textContent.trim());
  const fakeInput = await page.$("#texture-file");
  await fakeInput.uploadFile(FAKE_PNG);
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim() !== prev && /贴图/.test(el.textContent);
    },
    { timeout: 15000, polling: 100 },
    beforeFake
  );
  const fakeReject = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "伪 PNG 被拒并给出中文原因",
    fakeReject.text.includes("贴图") && /PNG|JPEG|WebP|解码/.test(fakeReject.text),
    fakeReject.text.slice(0, 120)
  );
  check.ok(
    "无效贴图后保留当前有效贴图",
    fakeReject.hasMap && !!fakeReject.texture && fakeReject.texture.name.includes("test-photo"),
    `map=${fakeReject.hasMap} texture=${fakeReject.texture ? fakeReject.texture.name : "null"}`
  );

  const beforeMime = await page.evaluate(() => document.getElementById("error").textContent.trim());
  const mimeInput = await page.$("#texture-file");
  await mimeInput.uploadFile(TEXT_PLAIN);
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim() !== prev && /仅支持|文件类型/.test(el.textContent);
    },
    { timeout: 15000, polling: 100 },
    beforeMime
  );
  const mimeReject = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "非白名单类型被拒并保留贴图",
    /PNG|JPEG|WebP/.test(mimeReject.text) &&
      mimeReject.hasMap &&
      !!mimeReject.texture &&
      mimeReject.texture.name.includes("test-photo"),
    mimeReject.text.slice(0, 120)
  );

  // 移除贴图：材质不再绑定 map，基色恢复材质预设颜色
  const beforeClear = await sampleCanvas(page);
  await page.click("#texture-remove");
  await page.waitForFunction(
    () => {
      const el = document.getElementById("texture-name");
      return el && el.textContent.includes("未使用贴图");
    },
    { timeout: 10000, polling: 100 }
  );
  await sleep(500);
  const cleared = await page.evaluate(() => {
    const material = window.__extrude3d.mesh.material;
    return {
      hasMap: !!material.map,
      baseColor: material.color.getHexString(),
      texture: window.__extrude3d.getInfo().texture,
      name: document.getElementById("texture-name").textContent.trim()
    };
  });
  check.ok(
    "移除贴图后材质不再绑定 map 且调试信息为 null",
    !cleared.hasMap && cleared.texture === null && cleared.name.includes("未使用"),
    `map=${cleared.hasMap} texture=${cleared.texture} name=${cleared.name}`
  );
  check.ok(
    "移除贴图后基色恢复预设颜色（黄金 #ffd891）",
    cleared.baseColor === "ffd891",
    `当前基色=#${cleared.baseColor}`
  );
  const afterClear = await sampleCanvas(page);
  const clearDiff = pixelDiff(beforeClear, afterClear);
  check.ok(
    "移除贴图后画面像素变化",
    clearDiff.ratio > 0.1,
    `模型区域内变化像素 ${clearDiff.changed}/${clearDiff.model}（${(clearDiff.ratio * 100).toFixed(1)}%）`
  );

  // 再次选择同一文件（验证 file input 已重置，可重复上传）
  const reselectInput = await page.$("#texture-file");
  await reselectInput.uploadFile(TEXTURE_PHOTO);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("texture-name");
      return el && el.textContent.includes("test-photo");
    },
    { timeout: 20000, polling: 100 }
  );
  await sleep(600);
  const reselected = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "重选同一文件可再次上传贴图",
    reselected.hasMap && !!reselected.texture && reselected.texture.name.includes("test-photo"),
    `map=${reselected.hasMap} texture=${reselected.texture ? reselected.texture.name : "null"}`
  );

  /* ---------- 背景图片（第六轮，用户专项授权）：真实 scene.background + 居中 cover + 基础缩放 ---------- */
  // 上传前先记录四角（纯白背景），用于确认背景图片真的改变了画布像素。
  const bgBeforePixel = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const tmp = document.createElement("canvas");
    tmp.width = 4;
    tmp.height = 4;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    return [d[0], d[1], d[2], d[3]];
  });

  const bgInput = await page.$("#bg-file");
  await bgInput.uploadFile(TEXTURE_PHOTO);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("bg-name");
      return el && el.textContent.includes("test-photo");
    },
    { timeout: 20000, polling: 100 }
  );
  await sleep(700);
  const bgApplied = await page.evaluate(() => {
    const api = window.__extrude3d;
    const tex = api.scene.background;
    const view = document.getElementById("view");
    const img = tex && tex.image;
    const viewAspect = view.clientWidth / view.clientHeight;
    const imgAspect = img ? img.width / img.height : 1;
    return {
      isTexture: !!(tex && tex.isTexture),
      info: api.getInfo().background,
      hasMap: !!api.mesh.material.map,
      name: document.getElementById("bg-name").textContent.trim(),
      expectedRepeat: [Math.min(1, viewAspect / imgAspect), Math.min(1, imgAspect / viewAspect)],
      repeat: tex ? [tex.repeat.x, tex.repeat.y] : null,
      offset: tex ? [tex.offset.x, tex.offset.y] : null
    };
  });
  check.ok(
    "背景图片载入并挂到真实 scene.background 贴图",
    bgApplied.isTexture && !!bgApplied.info && bgApplied.name.includes("test-photo"),
    `isTexture=${bgApplied.isTexture} name=${bgApplied.name}`
  );
  check.ok(
    "背景按视口与原图宽高比居中 cover（repeat / offset 符合公式）",
    !!bgApplied.repeat &&
      Math.abs(bgApplied.repeat[0] - bgApplied.expectedRepeat[0]) < 0.01 &&
      Math.abs(bgApplied.repeat[1] - bgApplied.expectedRepeat[1]) < 0.01 &&
      Math.abs(bgApplied.offset[0] - (1 - bgApplied.repeat[0]) / 2) < 0.005 &&
      Math.abs(bgApplied.offset[1] - (1 - bgApplied.repeat[1]) / 2) < 0.005,
    `repeat=${JSON.stringify(bgApplied.repeat)} 期望=${JSON.stringify(bgApplied.expectedRepeat)} offset=${JSON.stringify(bgApplied.offset)}`
  );
  const bgPixels = await sampleCanvas(page);
  const bgDelta =
    Math.abs(bgPixels[0] - bgBeforePixel[0]) +
    Math.abs(bgPixels[1] - bgBeforePixel[1]) +
    Math.abs(bgPixels[2] - bgBeforePixel[2]);
  check.ok(
    "背景图片真实改变画布像素（不是 CSS 背景）",
    bgPixels[3] === 255 && bgPixels[0] + bgPixels[1] + bgPixels[2] < 740 && bgDelta > 12,
    `上传前=${bgBeforePixel.slice(0, 3).join(",")} 上传后=${bgPixels.slice(0, 4).join(",")}`
  );
  check.ok(
    "背景图片与表面贴图互不影响（同时存在）",
    bgApplied.hasMap && bgApplied.isTexture,
    `map=${bgApplied.hasMap} background=${bgApplied.isTexture}`
  );

  // 背景在材质 / SVG 变化后仍然保留。
  await setControl(page, "material", "plastic", "change");
  await setControl(page, "sample", "letter-a-star", "change");
  await waitModelled(page).catch(() => {});
  await sleep(700);
  const bgPersisted = await page.evaluate(() => ({
    isTexture: !!(window.__extrude3d.scene.background && window.__extrude3d.scene.background.isTexture),
    name: (window.__extrude3d.getInfo().background || {}).name || ""
  }));
  check.ok(
    "切换材质 / SVG 后背景图片保留",
    bgPersisted.isTexture && bgPersisted.name.includes("test-photo"),
    `isTexture=${bgPersisted.isTexture} name=${bgPersisted.name}`
  );

  // 缩放：1× → 2×（repeat 减半、仍居中、像素变化）→ 1×（可缩回）。
  const bgZoomBase = await sampleCanvas(page);
  await setControl(page, "bg-zoom", "2", "input");
  await sleep(500);
  const bgZoomed = await page.evaluate(() => {
    const tex = window.__extrude3d.scene.background;
    return {
      zoom: window.__extrude3d.getState().bgZoom,
      repeat: [tex.repeat.x, tex.repeat.y],
      offset: [tex.offset.x, tex.offset.y],
      out: document.getElementById("bg-zoom-out").textContent.trim()
    };
  });
  check.ok(
    "背景缩放 2× 时贴图重复比例减半且仍居中",
    Math.abs(bgZoomed.repeat[0] - bgApplied.repeat[0] / 2) < 0.005 &&
      Math.abs(bgZoomed.repeat[1] - bgApplied.repeat[1] / 2) < 0.005 &&
      Math.abs(bgZoomed.offset[0] - (1 - bgZoomed.repeat[0]) / 2) < 0.005 &&
      Math.abs(bgZoomed.offset[1] - (1 - bgZoomed.repeat[1]) / 2) < 0.005,
    `zoom=${bgZoomed.zoom} repeat=${JSON.stringify(bgZoomed.repeat)} offset=${JSON.stringify(bgZoomed.offset)} 输出=${bgZoomed.out}`
  );
  const bgZoomPixels = await sampleCanvas(page);
  const bgZoomDiff = pixelDiff(bgZoomBase, bgZoomPixels);
  check.ok(
    "背景缩放改变真实像素",
    bgZoomDiff.ratio > 0.2,
    `变化 ${bgZoomDiff.changed}/${bgZoomDiff.model}（${(bgZoomDiff.ratio * 100).toFixed(1)}%）`
  );
  await setControl(page, "bg-zoom", "1", "input");
  await sleep(400);
  const bgBackToOne = await page.evaluate(() => {
    const tex = window.__extrude3d.scene.background;
    return { repeat: [tex.repeat.x, tex.repeat.y], zoom: window.__extrude3d.getState().bgZoom };
  });
  check.ok(
    "背景缩放可回到 1×（repeat 恢复 cover 基准）",
    bgBackToOne.zoom === 1 &&
      Math.abs(bgBackToOne.repeat[0] - bgApplied.repeat[0]) < 0.005 &&
      Math.abs(bgBackToOne.repeat[1] - bgApplied.repeat[1]) < 0.005,
    `zoom=${bgBackToOne.zoom} repeat=${JSON.stringify(bgBackToOne.repeat)}`
  );

  // 背景参与真实 PNG 导出：透明关闭时，导出的四角应是背景图片像素（不透明）。
  const bgPreview = await sampleCanvas(page);
  await setControl(page, "export-scale", "1", "change");
  await page.click("#export-png");
  const bgFile = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const bgPng = pngInfo(bgFile.bytes);
  const bgExportPixel = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const tmp = document.createElement("canvas");
    tmp.width = 40;
    tmp.height = 40;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 40, 40);
    ctx.drawImage(img, 0, 0, 40, 40);
    const d = ctx.getImageData(0, 0, 40, 40).data;
    return [d[0], d[1], d[2], d[3]];
  }, bgFile.bytes.toString("base64"));
  const bgExportDelta =
    Math.abs(bgExportPixel[0] - bgPreview[0]) +
    Math.abs(bgExportPixel[1] - bgPreview[1]) +
    Math.abs(bgExportPixel[2] - bgPreview[2]);
  check.ok(
    "含背景图的导出 PNG 非空且尺寸为 1× 视图",
    bgFile.size > 1000 && bgPng.width > 0 && bgPng.height > 0,
    `${bgPng.width}x${bgPng.height} ${bgFile.size}B`
  );
  check.ok(
    "导出的 PNG 真实包含背景图片（边角与预览一致、不透明且非纯白）",
    bgExportPixel[3] === 255 &&
      bgExportPixel[0] + bgExportPixel[1] + bgExportPixel[2] < 740 &&
      bgExportDelta < 90,
    `PNG 边角=${bgExportPixel.join(",")} 预览=${bgPreview.slice(0, 4).join(",")} 差=${bgExportDelta}`
  );
  // 清掉这次导出的文件，避免影响后面「透明导出」的下载选取。
  for (const n of await readdir(downloads.dir)) {
    if (n.toLowerCase().endsWith(".png")) await rm(join(downloads.dir, n), { force: true });
  }

  /* ---------- 背景选择竞态：最新一次无效选择不得顶替已生效背景 ---------- */
  await page.evaluate(async () => {
    const input = document.getElementById("bg-file");
    const makePng = async (name, color) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      return new File([blob], name, { type: "image/png" });
    };
    const setFile = (file) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setFile(await makePng("bg-pending.png", "#1e88e5")); // 开始异步解码
    setFile(new File(["not an image at all\n"], "bg-invalid.txt", { type: "text/plain" })); // 同一 tick 立刻拒绝
  });
  await sleep(900);
  const bgRace = await page.evaluate(() => ({
    isTexture: !!(window.__extrude3d.scene.background && window.__extrude3d.scene.background.isTexture),
    name: (window.__extrude3d.getInfo().background || {}).name || "",
    errorHidden: document.getElementById("error").hidden,
    errorText: document.getElementById("error").textContent.trim()
  }));
  check.ok(
    "最新无效背景选择后保留原背景（过期 pending 不顶替）",
    bgRace.isTexture && bgRace.name.includes("test-photo"),
    `isTexture=${bgRace.isTexture} name=${bgRace.name}`
  );
  check.ok(
    "无效背景选择给出中文原因且不被过期加载清掉",
    bgRace.errorHidden === false && /背景图片/.test(bgRace.errorText) && /仅支持|文件类型/.test(bgRace.errorText),
    bgRace.errorText.slice(0, 100)
  );

  // 透明背景抑制背景图片，但图片仍保留；关闭后恢复同一张贴图。
  await setControl(page, "transparent-bg", true, "change");
  await sleep(400);
  const bgSuppressed = await page.evaluate(() => ({
    background: window.__extrude3d.scene.background,
    info: window.__extrude3d.getInfo().background
  }));
  check.ok(
    "透明背景时 scene.background 被抑制但图片仍保留",
    bgSuppressed.background === null && !!bgSuppressed.info && bgSuppressed.info.name.includes("test-photo"),
    `scene.background=${bgSuppressed.background} 保留=${bgSuppressed.info ? bgSuppressed.info.name : "null"}`
  );
  await setControl(page, "transparent-bg", false, "change");
  await sleep(400);
  const bgRestored = await page.evaluate(() => ({
    isTexture: !!(window.__extrude3d.scene.background && window.__extrude3d.scene.background.isTexture),
    name: (window.__extrude3d.getInfo().background || {}).name || ""
  }));
  check.ok(
    "关闭透明背景后恢复保留的背景图片",
    bgRestored.isTexture && bgRestored.name.includes("test-photo"),
    `isTexture=${bgRestored.isTexture} name=${bgRestored.name}`
  );

  // 移除背景：回到所选纯色背景（这里先选 #dddddd 以便用像素确认），表面贴图不受影响。
  await setControl(page, "bg", "#dddddd", "input");
  await page.click("#bg-remove");
  await sleep(500);
  const bgRemoved = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const tmp = document.createElement("canvas");
    tmp.width = 4;
    tmp.height = 4;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    return {
      background: window.__extrude3d.scene.background,
      info: window.__extrude3d.getInfo().background,
      hasMap: !!window.__extrude3d.mesh.material.map,
      pixel: [d[0], d[1], d[2], d[3]]
    };
  });
  check.ok(
    "移除背景后 scene.background 归零并恢复所选纯色背景",
    bgRemoved.background === null &&
      bgRemoved.info === null &&
      Math.abs(bgRemoved.pixel[0] - 221) < 12 &&
      Math.abs(bgRemoved.pixel[1] - 221) < 12 &&
      Math.abs(bgRemoved.pixel[2] - 221) < 12,
    `background=${bgRemoved.background} info=${bgRemoved.info} 像素=${bgRemoved.pixel.join(",")}`
  );
  check.ok(
    "移除背景不影响表面贴图",
    bgRemoved.hasMap,
    `map=${bgRemoved.hasMap}`
  );
  await setControl(page, "bg", "#ffffff", "input"); // 恢复纯白，供后续断言使用

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

  // 导出 PNG（贴图仍激活：导出画面应包含贴图）
  const viewWidth = await page.$eval("#view", (n) => Math.round(n.clientWidth));
  const exportMap = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
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
    "导出尺寸生效（2× 视图宽度）",
    Math.abs(info.width - viewWidth * 2) <= 10,
    `png=${info.width}px 视图=${viewWidth}px`
  );
  check.ok("透明模式导出的 PNG 带 alpha 通道", file.bytes[25] === 6, `IHDR colorType=${file.bytes[25]}`);
  check.ok(
    "贴图激活时导出 PNG 非空",
    exportMap.hasMap && !!exportMap.texture && file.size > 1000,
    `map=${exportMap.hasMap} texture=${exportMap.texture ? exportMap.texture.name : "null"} ${file.size}B`
  );

  // 强化：不看「map 标志 / IHDR 头」就下结论，而是把下载到的 PNG 字节真正解码成
  // 图像（data URL → Image），和预览画布放在同一 40×40 分辨率下比较；
  // 并确认导出像素里确实有「带 alpha 的彩色模型像素」。复用上面这一次导出，不重复导出。
  const exportedSample = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const w = 40;
    const h = 40;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let solid = 0;
    let colored = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 200) {
        solid++;
        const spread = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        if (spread > 18) colored++;
      }
    }
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      solid,
      colored,
      data: Array.from(d)
    };
  }, file.bytes.toString("base64"));
  const previewSample = await sampleCanvas(page);
  const exportDiff = modelSampleDiff(exportedSample.data, previewSample);
  const coverageDelta =
    Math.abs(exportDiff.modelA - exportDiff.modelB) / Math.max(exportDiff.modelA, exportDiff.modelB, 1);
  check.ok(
    "导出 PNG 真实解码后有带 alpha 的彩色模型像素",
    exportedSample.solid > 20 && exportedSample.colored > 20,
    `解码=${exportedSample.width}x${exportedSample.height} 实心像素=${exportedSample.solid} 彩色像素=${exportedSample.colored}`
  );
  check.ok(
    "导出 PNG 与预览画布同分辨率下画面一致（允许抗锯齿差异）",
    coverageDelta < 0.25 && exportDiff.meanDelta < 45 && exportDiff.coreRatio < 0.25 && exportDiff.ratio < 0.5,
    `模型像素 ${exportDiff.modelA}(PNG)/${exportDiff.modelB}(预览) 覆盖差=${(coverageDelta * 100).toFixed(1)}% ` +
      `均值差=${exportDiff.meanDelta} 核心差异 ${exportDiff.coreChanged}/${exportDiff.core} ` +
      `明显差异 ${exportDiff.changed}/${exportDiff.model}（${(exportDiff.ratio * 100).toFixed(1)}%）`
  );

  /* ---------- 贴图选择竞态：最新一次选择（哪怕被拒）必须作废更早的进行中加载 ---------- */
  // 当前 baseline 贴图是 test-photo.png。同一 tick 里先选一张有效 PNG（异步解码，处于
  //「进行中」），紧接着选一个非白名单 .txt；后者被拒后，前一张的解码回调不得再顶替
  // baseline，也不得把这条错误提示清掉。
  await page.evaluate(async () => {
    const input = document.getElementById("texture-file");
    const makePng = async (name, color) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
      return new File([blob], name, { type: "image/png" });
    };
    const setFile = (file) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const pending = await makePng("pending.png", "#1e88e5");
    setFile(pending); // 开始异步解码
    setFile(new File(["not an image at all\n"], "invalid.txt", { type: "text/plain" })); // 同一 tick 立刻拒绝
  });
  await sleep(900);
  const raceAfterInvalid = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture,
    name: document.getElementById("texture-name").textContent.trim(),
    errorHidden: document.getElementById("error").hidden,
    errorText: document.getElementById("error").textContent.trim()
  }));
  check.ok(
    "最新无效选择后保留 baseline 贴图（过期 pending 不顶替）",
    raceAfterInvalid.hasMap &&
      !!raceAfterInvalid.texture &&
      raceAfterInvalid.texture.name.includes("test-photo") &&
      raceAfterInvalid.name.includes("test-photo"),
    `map=${raceAfterInvalid.hasMap} texture=${raceAfterInvalid.texture ? raceAfterInvalid.texture.name : "null"} name=${raceAfterInvalid.name}`
  );
  check.ok(
    "最新无效选择的中文原因不会被过期加载清掉",
    raceAfterInvalid.errorHidden === false && /仅支持|文件类型/.test(raceAfterInvalid.errorText),
    raceAfterInvalid.errorText.slice(0, 100)
  );

  // 加载中点「移除贴图」：进行中的加载必须过期，回调不得复活贴图。
  await page.evaluate(async () => {
    const input = document.getElementById("texture-file");
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#43a047";
    ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "pending2.png", { type: "image/png" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("texture-remove").click();
  });
  await sleep(900);
  const clearedDuringPending = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture,
    name: document.getElementById("texture-name").textContent.trim()
  }));
  check.ok(
    "加载中点「移除贴图」后保持为空（过期回调不复活贴图）",
    !clearedDuringPending.hasMap &&
      clearedDuringPending.texture === null &&
      clearedDuringPending.name.includes("未使用"),
    `map=${clearedDuringPending.hasMap} texture=${clearedDuringPending.texture} name=${clearedDuringPending.name}`
  );

  /* ============ 本轮：几何百分比映射 / 一次归一化 / 自适应细分 / 玻璃 / 主光 ============ */

  // 回到干净状态：内置样例、白背景、无背景图、不透明、镀铬、厚度 16%、倒角 2%
  const resetBaseline = async () => {
    await setControl(page, "sample", "square-ring", "change");
    await sleep(500);
    await page.click("#bg-remove");
    await setControl(page, "transparent-bg", false, "change");
    await setControl(page, "material", "chrome", "change");
    await setControl(page, "depth", "16", "input");
    await setControl(page, "bevel-enabled", true, "change");
    await setControl(page, "bevel-size", "2", "input");
    await setControl(page, "bevel-thickness", "2", "input");
    await setControl(page, "smoothness", "0.5", "input");
    await sleep(800);
  };
  await resetBaseline();

  // 厚度 2 / 16 / 70%：归一化 z 尺寸真实单调增大，且像素变化明显
  await setControl(page, "bevel-enabled", false, "change");
  await sleep(500);
  await setControl(page, "depth", "2", "input");
  await sleep(800);
  const thickness2 = await page.evaluate(() => window.__extrude3d.getInfo());
  await setControl(page, "depth", "16", "input");
  await sleep(800);
  const thickness16 = await page.evaluate(() => window.__extrude3d.getInfo());
  const thickness16Px = await sampleCanvas(page);
  await setControl(page, "depth", "70", "input");
  await sleep(800);
  const thickness70 = await page.evaluate(() => window.__extrude3d.getInfo());
  const thickness70Px = await sampleCanvas(page);
  check.ok(
    "厚度按最大平面边长百分比映射（2 / 16 / 70 为真实百分比）",
    thickness2.settings.depthPercent === 2 &&
      thickness16.settings.depthPercent === 16 &&
      thickness70.settings.depthPercent === 70,
    `${thickness2.settings.depthPercent}% / ${thickness16.settings.depthPercent}% / ${thickness70.settings.depthPercent}%`
  );
  check.ok(
    "厚度 2 < 16 < 70% 的归一化 z 尺寸单调增大",
    thickness2.normalizedSize.size[2] < thickness16.normalizedSize.size[2] &&
      thickness16.normalizedSize.size[2] < thickness70.normalizedSize.size[2],
    `z = ${thickness2.normalizedSize.size[2]} → ${thickness16.normalizedSize.size[2]} → ${thickness70.normalizedSize.size[2]}`
  );
  const thicknessDiff = pixelDiff(thickness16Px, thickness70Px);
  check.ok(
    "厚度变化真实改变画面像素",
    thicknessDiff.ratio > 0.03,
    `模型区域内变化像素 ${thicknessDiff.changed}/${thicknessDiff.model}（${(thicknessDiff.ratio * 100).toFixed(1)}%）`
  );

  // 倒角 0 / 2 / 6%：0 完全关闭，2 / 6 真实改变 XY 与 z 尺寸并改变像素
  await setControl(page, "bevel-enabled", true, "change");
  await setControl(page, "depth", "16", "input");
  await setControl(page, "bevel-size", "0", "input");
  await setControl(page, "bevel-thickness", "0", "input");
  await sleep(800);
  const bevel0 = await page.evaluate(() => window.__extrude3d.getInfo());
  const bevel0Px = await sampleCanvas(page);
  await setControl(page, "bevel-size", "2", "input");
  await setControl(page, "bevel-thickness", "2", "input");
  await sleep(800);
  const bevel2 = await page.evaluate(() => window.__extrude3d.getInfo());
  const bevel2Px = await sampleCanvas(page);
  await setControl(page, "bevel-size", "6", "input");
  await setControl(page, "bevel-thickness", "6", "input");
  await sleep(800);
  const bevel6 = await page.evaluate(() => window.__extrude3d.getInfo());
  const bevel6Px = await sampleCanvas(page);
  check.ok(
    "倒角宽度 / 深度都为 0 时完全关闭倒角",
    bevel0.settings.bevelEnabled === false,
    `bevelEnabled=${bevel0.settings.bevelEnabled}`
  );
  check.ok(
    "倒角 0 → 2 → 6% 真实增大归一化 XY 与 z 尺寸",
    bevel0.normalizedSize.size[0] < bevel2.normalizedSize.size[0] &&
      bevel2.normalizedSize.size[0] < bevel6.normalizedSize.size[0] &&
      bevel0.normalizedSize.size[2] < bevel2.normalizedSize.size[2] &&
      bevel2.normalizedSize.size[2] < bevel6.normalizedSize.size[2],
    `x = ${bevel0.normalizedSize.size[0]} → ${bevel2.normalizedSize.size[0]} → ${bevel6.normalizedSize.size[0]}；` +
      `z = ${bevel0.normalizedSize.size[2]} → ${bevel2.normalizedSize.size[2]} → ${bevel6.normalizedSize.size[2]}`
  );
  check.ok(
    "倒角 6% 未被隐藏钳制（厚度 16% 时上限为 8%）",
    bevel6.settings.bevelLimit === false,
    `bevelLimit=${bevel6.settings.bevelLimit} 实际=${bevel6.settings.bevelSizePercent}%`
  );
  const bevelDiff = pixelDiff(bevel0Px, bevel6Px);
  check.ok(
    "倒角变化真实改变画面像素",
    bevelDiff.ratio > 0.03,
    `模型区域内变化像素 ${bevelDiff.changed}/${bevelDiff.model}（${(bevelDiff.ratio * 100).toFixed(1)}%）`
  );

  // 几何保护上限：厚度 2% 时倒角最多 1%，状态栏必须写明实际值而不是偷偷钳制
  await setControl(page, "depth", "2", "input");
  await setControl(page, "bevel-size", "6", "input");
  await setControl(page, "bevel-thickness", "6", "input");
  await sleep(800);
  const clamped = await page.evaluate(() => ({
    info: window.__extrude3d.getInfo(),
    status: document.getElementById("status").textContent.trim()
  }));
  check.ok(
    "达到几何保护上限时明确反馈实际倒角值",
    clamped.info.settings.bevelLimit === true &&
      clamped.info.settings.bevelSizePercent <= 1.01 &&
      /限制|实际/.test(clamped.status),
    `limited=${clamped.info.settings.bevelLimit} 实际=${clamped.info.settings.bevelSizePercent}% status=${clamped.status.slice(0, 90)}`
  );

  // viewBox 同比例 20 / 200 / 2000：一次归一化后尺寸一致；
  // 同时用「透明玻璃」验证 thickness 的坐标换算：着色器里 thickness 是局部坐标、会再乘
  // modelScale，所以 props.thickness 必须随 baseScale 反向变化，而世界空间有效厚度
  // （getInfo().material.effectiveThickness = thickness × scale）三者一致。
  await setControl(page, "depth", "16", "input");
  await setControl(page, "bevel-size", "2", "input");
  await setControl(page, "bevel-thickness", "2", "input");
  await setControl(page, "material", "glass", "change");
  await setControl(page, "glass-thickness", "1", "input");
  await sleep(700);
  const proportionSizes = [];
  for (let i = 0; i < PROPORTION_SVGS.length; i++) {
    const units = [20, 200, 2000][i];
    await writeFile(PROPORTION_SVGS[i], proportionalSvg(units), "utf8");
    const propInput = await page.$("input[type=file]");
    await propInput.uploadFile(PROPORTION_SVGS[i]);
    await waitModelled(page);
    await sleep(500);
    const info = await page.evaluate(() => window.__extrude3d.getInfo());
    proportionSizes.push({
      units,
      size: info.normalizedSize.size,
      scale: info.normalizedSize.baseScale,
      thickness: info.material.thickness,
      effectiveThickness: info.material.effectiveThickness
    });
  }
  const propMaxDelta = Math.max(
    ...proportionSizes.map((p) =>
      Math.max(...p.size.map((v, k) => Math.abs(v - proportionSizes[0].size[k])))
    )
  );
  check.ok(
    "同比例 SVG（20 / 200 / 2000）归一化后结果相等",
    propMaxDelta < 0.02,
    proportionSizes.map((p) => `${p.units}:${p.size.join("×")}`).join(" | ")
  );
  const effMaxDelta = Math.max(
    ...proportionSizes.map((p) =>
      Math.abs(p.effectiveThickness - proportionSizes[0].effectiveThickness)
    )
  );
  check.ok(
    "同比例 SVG 的玻璃世界空间有效厚度一致（thickness × scale 不被二次缩放）",
    effMaxDelta < 0.01 &&
      proportionSizes.every((p) => p.thickness > 0 && p.effectiveThickness > 0),
    proportionSizes
      .map((p) => `${p.units}:local=${p.thickness}×scale=${p.scale}=${p.effectiveThickness}`)
      .join(" | ")
  );
  check.ok(
    "同一世界厚度下局部 thickness 随归一化缩放反向变化（确实存储为局部坐标）",
    Math.max(...proportionSizes.map((p) => p.thickness)) >
      Math.min(...proportionSizes.map((p) => p.thickness)) * 10,
    proportionSizes.map((p) => `${p.units}:${p.thickness}`).join(" | ")
  );

  // 平顺闭合轮廓（近似圆）的普通 SVG：提高倒角后自适应降低细分应接受，
  // 并如实反馈精度变化。100 段是普通平滑输入；400 段验证旧「400 曲线必拒」预期已废弃。
  const uploadSmoothAndAccept = async (file, segments, label) => {
    await writeFile(file, smoothCurveSvg(segments), "utf8");
    const input = await page.$("input[type=file]");
    await input.uploadFile(file);
    await waitModelled(page, 45000);
    await sleep(600);
    const result = await page.evaluate(() => ({
      info: window.__extrude3d.getInfo(),
      status: document.getElementById("status").textContent.trim(),
      errorHidden: document.getElementById("error").hidden
    }));
    check.ok(
      `${label} 段平顺闭合轮廓（普通平滑输入）能自适应接受`,
      result.errorHidden === true && result.info.shapeCount > 0 && /已建模/.test(result.status),
      `shapeCount=${result.info.shapeCount} verts=${result.info.vertexCount} status=${result.status.slice(0, 80)}`
    );
    check.ok(
      `${label} 段平顺轮廓自适应后实际顶点不超过 600000`,
      result.info.settings.actualVerts > 0 && result.info.settings.actualVerts <= 600000,
      `actualVerts=${result.info.settings.actualVerts}`
    );
    return result;
  };

  await setControl(page, "bevel-size", "6", "input");
  await setControl(page, "bevel-thickness", "6", "input");
  await sleep(300);
  const smooth = await uploadSmoothAndAccept(SMOOTH_100_SVG, 100, "100");
  check.ok(
    "自适应降低了细分并如实反馈（曲线段数 / 倒角段数与状态栏）",
    smooth.info.settings.reduction === true &&
      smooth.info.settings.curveSegments <= 32 &&
      /降低细分|细分/.test(smooth.status),
    `curve=${smooth.info.settings.curveSegments} bevel=${smooth.info.settings.bevelSegments} status=${smooth.status.slice(0, 110)}`
  );
  await uploadSmoothAndAccept(SMOOTH_400_SVG, 400, "400");
  check.ok(
    "旧「400 曲线被拒」预期已废弃：400 段平顺轮廓现在自适应接受且无错误",
    page.errors.length === 0,
    page.errors.slice(0, 3).join(" | ")
  );

  // defs / metadata 里未使用的普通定义不再误判；可见元素上的滤镜仍必须拒绝
  await writeFile(INERT_DEFS_SVG, INERT_DEFS_SVG_TEXT, "utf8");
  const inertInput = await page.$("input[type=file]");
  await inertInput.uploadFile(INERT_DEFS_SVG);
  await waitModelled(page);
  await sleep(500);
  const inert = await page.evaluate(() => ({
    name: document.getElementById("svg-name").textContent.trim(),
    errorHidden: document.getElementById("error").hidden,
    info: window.__extrude3d.getInfo()
  }));
  check.ok(
    "只有未使用的 defs / metadata 定义的 SVG 可以正常导入",
    inert.errorHidden === true && inert.info.shapeCount > 0,
    `name=${inert.name} shapeCount=${inert.info.shapeCount}`
  );

  const beforeVisibleFilter = await page.evaluate(() => document.getElementById("error").textContent.trim());
  await writeFile(VISIBLE_FILTER_SVG, VISIBLE_FILTER_SVG_TEXT, "utf8");
  const filterInput = await page.$("input[type=file]");
  await filterInput.uploadFile(VISIBLE_FILTER_SVG);
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim() !== prev && /滤镜/.test(el.textContent);
    },
    { timeout: 15000, polling: 100 },
    beforeVisibleFilter
  );
  const visibleFilter = await page.evaluate(() => window.__extrude3d.getInfo());
  check.ok(
    "可见元素上使用滤镜仍被拒绝（放宽范围明确）",
    visibleFilter.lastError !== null && visibleFilter.shapeCount > 0,
    `lastError=${String(visibleFilter.lastError).slice(0, 60)}`
  );

  // 最小 unsupported-input guard：普通导出（普通 SVG 1.1 DOCTYPE / 命名空间 URL /
  // metadata 正文 / 未使用 defs / 本地 #fragment）必须放行；真实脚本 / 内部实体 /
  // 外部资源引用必须拒绝（且不执行、不展开、不联网）。
  await writeFile(ALLOWED_ORDINARY_SVG, ALLOWED_ORDINARY_SVG_TEXT, "utf8");
  const allowedInput = await page.$("input[type=file]");
  await allowedInput.uploadFile(ALLOWED_ORDINARY_SVG);
  await waitModelled(page);
  await sleep(500);
  const allowedOrdinary = await page.evaluate(() => ({
    name: document.getElementById("svg-name").textContent.trim(),
    errorHidden: document.getElementById("error").hidden,
    info: window.__extrude3d.getInfo()
  }));
  check.ok(
    "普通导出（SVG 1.1 DOCTYPE / 命名空间 / metadata 正文 / 未使用 defs / 本地 #fragment）可正常导入",
    allowedOrdinary.errorHidden === true &&
      allowedOrdinary.info.shapeCount > 0 &&
      /allowed-ordinary/.test(allowedOrdinary.name),
    `name=${allowedOrdinary.name} shapeCount=${allowedOrdinary.info.shapeCount} lastError=${String(allowedOrdinary.info.lastError).slice(0, 60)}`
  );

  const guardRejects = [
    { file: SCRIPT_SVG, text: SCRIPT_SVG_TEXT, label: "真实 <script>", pattern: /脚本/ },
    { file: ENTITY_SVG, text: ENTITY_SVG_TEXT, label: "内部 ENTITY 定义", pattern: /实体/ },
    {
      file: EXTERNAL_REF_SVG,
      text: EXTERNAL_REF_SVG_TEXT,
      label: "外部资源引用（href + @import）",
      pattern: /外部|资源/
    }
  ];
  for (const item of guardRejects) {
    const prev = await page.evaluate(() => document.getElementById("error").textContent.trim());
    await writeFile(item.file, item.text, "utf8");
    const input = await page.$("input[type=file]");
    await input.uploadFile(item.file);
    await page.waitForFunction(
      (pattern, before) => {
        const el = document.getElementById("error");
        return (
          el && !el.hidden && el.textContent.trim() !== before && new RegExp(pattern).test(el.textContent)
        );
      },
      { timeout: 15000, polling: 100 },
      item.pattern.source,
      prev
    );
    const rejected = await page.evaluate(() => ({
      text: document.getElementById("error").textContent.trim(),
      info: window.__extrude3d.getInfo()
    }));
    check.ok(
      `${item.label} 被最小闸门拒绝并给出中文原因`,
      /拒绝/.test(rejected.text) && item.pattern.test(rejected.text),
      rejected.text.slice(0, 120)
    );
    check.ok(
      `${item.label} 被拒后保留上一次成功模型`,
      rejected.info.lastError !== null && rejected.info.shapeCount > 0,
      `shapeCount=${rejected.info.shapeCount} lastError=${String(rejected.info.lastError).slice(0, 60)}`
    );
  }

  // 文件大小闸门：64 KiB → 1 MiB。90 KiB 的普通 SVG 现在可导入，1.1 MiB 仍拒绝。
  await writeFile(BIG_OK_SVG, paddedSvg(90 * 1024), "utf8");
  const bigInput = await page.$("input[type=file]");
  await bigInput.uploadFile(BIG_OK_SVG);
  await waitModelled(page);
  await sleep(500);
  const bigOk = await page.evaluate(() => ({
    name: document.getElementById("svg-name").textContent.trim(),
    errorHidden: document.getElementById("error").hidden,
    info: window.__extrude3d.getInfo()
  }));
  check.ok(
    "64 KiB–1 MiB 的普通 SVG 现在可以导入",
    bigOk.errorHidden === true && bigOk.info.shapeCount > 0 && /big-ok/.test(bigOk.name),
    `name=${bigOk.name} shapeCount=${bigOk.info.shapeCount}`
  );

  await writeFile(OVER_LIMIT_SVG, paddedSvg(1100 * 1024), "utf8");
  const overInput = await page.$("input[type=file]");
  await overInput.uploadFile(OVER_LIMIT_SVG);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("error");
      return el && !el.hidden && /过大/.test(el.textContent);
    },
    { timeout: 15000, polling: 100 }
  );
  const overLimit = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    info: window.__extrude3d.getInfo()
  }));
  check.ok(
    "超过 1 MiB 的 SVG 仍被拒绝并给出真实大小",
    /过大/.test(overLimit.text) && /MiB/.test(overLimit.text) && overLimit.info.shapeCount > 0,
    overLimit.text.slice(0, 120)
  );

  // 玻璃折射：非周期高对比马赛克背景 + 透明玻璃，对比 ior 1（无折射基线）/ 1.5 / 2.0
  // 的空间错位。验收不能只看材质属性变化，必须在像素层面检出真实的空间位移。
  await writeFile(SOLID_SVG, SOLID_SVG_TEXT, "utf8");
  const solidInput = await page.$("input[type=file]");
  await solidInput.uploadFile(SOLID_SVG);
  await waitModelled(page);
  await setControl(page, "depth", "70", "input"); // 加厚：折射位移更明显
  await sleep(700);
  await setControl(page, "transparent-bg", false, "change");
  await setControl(page, "material", "glass", "change");
  await setControl(page, "glass-thickness", "1", "input");
  await sleep(500);
  await uploadVariedBackground(page, sleep);
  const GLASS_N = 128;
  const GLASS_BOX = [44, 44, 84, 84];
  await setControl(page, "glass-ior", "1", "input");
  await sleep(700);
  const glassBaseInfo = await page.evaluate(() => window.__extrude3d.getInfo());
  const glassBase = await sampleCanvasN(page, GLASS_N);
  await setControl(page, "glass-ior", "1.5", "input");
  await sleep(700);
  const glass15 = await sampleCanvasN(page, GLASS_N);
  await setControl(page, "glass-ior", "2", "input");
  await sleep(700);
  const glass20Info = await page.evaluate(() => window.__extrude3d.getInfo());
  const glass20 = await sampleCanvasN(page, GLASS_N);
  check.ok(
    "透明玻璃使用真实透射（transmission 1 / opacity 1 / metalness 0 / ior 可调）",
    glassBaseInfo.material.transmission === 1 &&
      glassBaseInfo.material.effectiveThickness > 0 &&
      glass20Info.material.transmission === 1 &&
      glass20Info.material.opacity === 1 &&
      glass20Info.material.transparent === true &&
      glass20Info.material.metalness === 0 &&
      glass20Info.material.ior === 2,
    `transmission=${glass20Info.material.transmission} opacity=${glass20Info.material.opacity} ior=${glass20Info.material.ior} effectiveThickness=${glass20Info.material.effectiveThickness}`
  );
  // 三个 ior 下的画面都必须有细节（背景特征不能糊成一片，否则错位无法判定）
  const glassVariances = [glassBase, glass15, glass20].map((d) => +sampleVariance(d).toFixed(1));
  check.ok(
    "ior 1 / 1.5 / 2 的画面都有可辨识的特征（非纯色背景）",
    glassVariances.every((v) => v > 20),
    `通道标准差=${glassVariances.join(" / ")}`
  );
  // 空间错位：与无折射基线相比，ior 1.5 / 2 都能找到非零平移且明显降低像素差。
  // 多取几个方位区域：折射位移是径向的，单一中心区域的平均位移可能相消。
  const glassRegions = [
    ["中心", GLASS_BOX],
    ["左侧", [24, 48, 60, 80]],
    ["右侧", [68, 48, 104, 80]],
    ["上半", [48, 24, 80, 60]],
    ["下半", [48, 68, 80, 104]]
  ];
  for (const [label, sample] of [
    ["1.5", glass15],
    ["2.0", glass20]
  ]) {
    const shifted = glassRegions
      .map(([region, box]) => ({ region, gap: bestShift(glassBase, sample, GLASS_N, box, 24) }))
      .filter((g) => Math.abs(g.gap.dx) + Math.abs(g.gap.dy) >= 2 && g.gap.err < g.gap.zeroErr - 2);
    check.ok(
      `ior 1 → ${label} 出现空间错位（不只是明暗变化）`,
      shifted.length >= 2,
      shifted.length
        ? shifted
            .map(
              (g) =>
                `${g.region}:位移=(${g.gap.dx},${g.gap.dy}) err=${g.gap.err}<${g.gap.zeroErr}`
            )
            .join(" | ")
        : `所有区域均无显著位移：` +
          glassRegions
            .map(([region, box]) => {
              const g = bestShift(glassBase, sample, GLASS_N, box, 24);
              return `${region}:(${g.dx},${g.dy}) ${g.err}/${g.zeroErr}`;
            })
            .join(" ")
    );
  }
  const glass15Diff = glassBase.reduce(
    (acc, v, i) => (i % 4 === 3 ? acc : acc + Math.abs(v - glass15[i])),
    0
  );
  check.ok(
    "ior 1.5 相对基线也真实改变画面",
    glass15Diff / (GLASS_N * GLASS_N * 3) > 1.5,
    `平均通道差=${(glass15Diff / (GLASS_N * GLASS_N * 3)).toFixed(2)}`
  );

  // 基础主光方向：改变方向角必须真实改变表面受光（像素变化），且 light.position 变化。
  // 用塑料（漫反射为主）在较低环境光强度下测直射光：镜面金属只出现稀疏高光，
  // 大面积漫反射才能稳定测出方向光变化；不额外加灯、不改渲染、不放宽阈值。
  await page.click("#bg-remove");
  await setControl(page, "bg", "#ffffff", "input");
  await sleep(400);
  await setControl(page, "material", "plastic", "change");
  await setControl(page, "env-intensity", "0.25", "input");
  await setControl(page, "light-intensity", "1.2", "input");
  await setControl(page, "light-angle", "40", "input");
  await sleep(600);
  const light40 = await page.evaluate(() => window.__extrude3d.getInfo().light);
  const light40Px = await sampleCanvas(page);
  await setControl(page, "light-angle", "220", "input");
  await sleep(600);
  const light220 = await page.evaluate(() => window.__extrude3d.getInfo().light);
  const light220Px = await sampleCanvas(page);
  const lightDiff = pixelDiff(light40Px, light220Px);
  check.ok(
    "主光方向真实改变表面受光（像素变化）",
    lightDiff.ratio > 0.02 &&
      Math.abs(light220.position[0] - light40.position[0]) +
        Math.abs(light220.position[1] - light40.position[1]) +
        Math.abs(light220.position[2] - light40.position[2]) >
        1,
    `变化像素 ${(lightDiff.ratio * 100).toFixed(1)}% 光源 ${light40.position.join(",")} → ${light220.position.join(",")}`
  );
  // 恢复本用例改动的环境强度 / 材质预设，避免影响后续用例。
  await setControl(page, "env-intensity", "1", "input");
  await setControl(page, "material", "glass", "change");
  await sleep(400);

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

  // 单条 path 内塞入大量曲线：图形元素只有 1 条、字符串远小于 1 MiB，
  // 即使自适应降到最低细分，采样轮廓点估算的挤出顶点仍超硬上限，必须被拒绝并保留上一次成功模型。
  const beforeMany = await page.evaluate(() => document.getElementById("error").textContent.trim());
  await writeFile(MANY_CURVES_SVG, manyCurveSvg(2200), "utf8");
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

  /* ============ 本批：棚拍空间 / 背景图片平移 / 透射双面 / 按需渲染 ============ */

  /** 清空下载目录：waitForFile 返回目录里第一个匹配文件，每次导出前必须清干净。 */
  const cleanDownloads = async () => {
    for (const n of await readdir(downloads.dir)) {
      if (n.toLowerCase().endsWith(".png")) await rm(join(downloads.dir, n), { force: true });
    }
  };
  /** 采样方格内 3 通道绝对差之和的统计（changed / total / mean）。 */
  const diffInBox = (a, b, size, box) => {
    let changed = 0;
    let total = 0;
    let sum = 0;
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const i = (y * size + x) * 4;
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        sum += d;
        total += 1;
        if (d > 8) changed += 1;
      }
    }
    return { changed, total, mean: total ? sum / total : 0 };
  };
  const varianceInBox = (data, size, box) => {
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const i = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = data[i + c];
          sum += v;
          sumSq += v * v;
          count += 1;
        }
      }
    }
    if (!count) return 0;
    const mean = sum / count;
    return Math.sqrt(Math.max(0, sumSq / count - mean * mean));
  };
  const changedPixels = (a, b, threshold = 20) => {
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > threshold) changed += 1;
    }
    return changed;
  };

  await resetBaseline();

  // 棚拍空间：真实 Reflector + RectAreaLight + 棚拍环境贴图，反射目标受分辨率上限。
  await setControl(page, "bg-mode", "studio", "change");
  await sleep(1200);
  const studio = await page.evaluate(() => {
    const api = window.__extrude3d;
    let reflector = null;
    let rectLights = 0;
    api.scene.traverse((o) => {
      if (o.isReflector) reflector = o;
      if (o.isRectAreaLight) rectLights += 1;
    });
    api.mesh.geometry.computeBoundingBox();
    const box = api.mesh.geometry.boundingBox;
    const scale = Math.abs(api.mesh.scale.y) || 1;
    return {
      info: api.getInfo(),
      hasReflector: !!reflector,
      mirror: reflector ? [reflector.getRenderTarget().width, reflector.getRenderTarget().height] : null,
      rectLights,
      minY: Math.min(box.min.y, box.max.y) * scale
    };
  });
  check.ok(
    "棚拍空间是真实三维静物（Reflector + ≥2 面光源 + 棚拍环境，反射目标 ≤512）",
    studio.hasReflector &&
      studio.rectLights >= 2 &&
      studio.info.studio.visible === true &&
      studio.info.studio.active === true &&
      studio.info.studio.environment === "studio" &&
      !!studio.mirror &&
      studio.mirror[0] > 0 &&
      studio.mirror[0] <= 512 &&
      studio.mirror[1] <= 512,
    `reflector=${studio.hasReflector} rectLights=${studio.rectLights} mirror=${JSON.stringify(studio.mirror)} env=${studio.info.studio.environment}`
  );
  const floorGap = studio.minY - studio.info.studio.floorY;
  check.ok(
    "棚拍地面位于模型最低点下方的小间隙（厚 / 高模型不被切）",
    floorGap > 0 && floorGap <= 0.8,
    `模型最低点=${studio.minY.toFixed(3)} 地面=${studio.info.studio.floorY} 间隙=${floorGap.toFixed(3)}`
  );

  // 地面：真实渲染的非纯色地面 + 模型在淡镜面里的真实反射。
  // 反射带按模型真实屏幕包围盒动态取在模型下方，避免把模型自身像素算进「反射」。
  const STUDIO_N = 96;
  const floorPlan = await page.evaluate((n) => {
    const api = window.__extrude3d;
    const geo = api.mesh.geometry;
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    api.mesh.updateWorldMatrix(true, false);
    api.camera.updateMatrixWorld();
    const Vector3 = api.camera.position.constructor;
    const p = new Vector3();
    let lowest = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          p.set(x, y, z).applyMatrix4(api.mesh.matrixWorld).project(api.camera);
          const screenY = (1 - p.y) / 2;
          if (screenY > lowest) lowest = screenY;
        }
      }
    }
    return { y0: Math.ceil(lowest * n) + 3, lowest };
  }, STUDIO_N);
  const floorBox = { x0: 8, y0: Math.min(STUDIO_N - 4, Math.max(2, floorPlan.y0)), x1: 88, y1: STUDIO_N };
  const studioFloor = await sampleCanvasN(page, STUDIO_N);
  const floorVariance = varianceInBox(studioFloor, STUDIO_N, floorBox);
  await page.evaluate(() => {
    const api = window.__extrude3d;
    api.mesh.visible = false;
    api.renderer.render(api.scene, api.camera);
  });
  await sleep(200);
  const studioFloorNoModel = await sampleCanvasN(page, STUDIO_N);
  await page.evaluate(() => {
    const api = window.__extrude3d;
    api.mesh.visible = true;
    api.renderer.render(api.scene, api.camera);
  });
  await sleep(200);
  const floorReflection = diffInBox(studioFloor, studioFloorNoModel, STUDIO_N, floorBox);
  check.ok(
    "棚拍地面是真实渲染的淡反射地面（非纯色 + 隐藏模型后反射区变化且幅度受抑制）",
    floorVariance > 1.5 && floorReflection.changed >= 3 && floorReflection.mean < 80,
    `地面标准差=${floorVariance.toFixed(2)} 反射变化=${floorReflection.changed}/${floorReflection.total} 平均差=${floorReflection.mean.toFixed(2)} 模型底部=${floorPlan.lowest.toFixed(3)} 反射带=${floorBox.y0}-${STUDIO_N}`
  );

  // 透明背景隐藏全部棚拍可见几何；导出 PNG 四角透明但模型像素保留。
  await setControl(page, "transparent-bg", true, "change");
  await sleep(500);
  const studioHidden = await page.evaluate(() => {
    const api = window.__extrude3d;
    return {
      visible: api.getInfo().studio.visible,
      active: api.getInfo().studio.active,
      background: api.scene.background,
      clearAlpha: api.renderer.getClearAlpha()
    };
  });
  check.ok(
    "透明背景隐藏全部棚拍可见几何（地面 / 反射 / 柔光箱）",
    studioHidden.visible === false &&
      studioHidden.active === false &&
      studioHidden.background === null &&
      studioHidden.clearAlpha === 0,
    `visible=${studioHidden.visible} active=${studioHidden.active} background=${studioHidden.background} clearAlpha=${studioHidden.clearAlpha}`
  );
  await cleanDownloads();
  await setControl(page, "export-scale", "1", "change");
  await page.click("#export-png");
  const studioPngFile = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const studioAlpha = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = "data:image/png;base64," + b64;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    const pick = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const full = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < full.length; i += 4) if (full[i] > 16) opaque += 1;
    return {
      corners: [pick(1, 1), pick(img.width - 2, 1), pick(1, img.height - 2), pick(img.width - 2, img.height - 2)],
      opaqueRatio: opaque / (c.width * c.height)
    };
  }, studioPngFile.bytes.toString("base64"));
  check.ok(
    "透明 + 棚拍导出的 PNG 四角透明、模型像素保留（棚拍不进导出）",
    studioAlpha.corners.every((c) => c[3] === 0) && studioAlpha.opaqueRatio > 0.01,
    `四角alpha=${studioAlpha.corners.map((c) => c[3]).join(",")} 模型占比=${studioAlpha.opaqueRatio.toFixed(3)}`
  );

  // 放大导出：PNG 尺寸 = 视图 × 2；导出后预览画布恢复视图尺寸。
  await setControl(page, "transparent-bg", false, "change");
  await sleep(500);
  const viewMetrics = await page.evaluate(() => {
    const view = document.getElementById("view");
    return { width: Math.round(view.clientWidth), dpr: Math.min(window.devicePixelRatio || 1, 2) };
  });
  await cleanDownloads();
  await setControl(page, "export-scale", "2", "change");
  await page.click("#export-png");
  const bigFile = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const bigPng = pngInfo(bigFile.bytes);
  await sleep(400);
  const restoredCanvas = await page.evaluate(() => window.__extrude3d.getInfo().canvas);
  check.ok(
    "放大导出尺寸正确（视图 × 2）且导出后预览画布恢复视图尺寸",
    Math.abs(bigPng.width - viewMetrics.width * 2) <= 2 &&
      Math.abs(restoredCanvas[0] - Math.round(viewMetrics.width * viewMetrics.dpr)) <= 1,
    `PNG=${bigPng.width}×${bigPng.height} 期望宽=${viewMetrics.width * 2} 预览恢复=${restoredCanvas.join("×")}`
  );

  // 背景图片：上传自动切图片模式；平移在裁切窗口内改 offset / 像素；resize 与材质 / SVG 保持；重置回中。
  await page.click("#bg-remove");
  await sleep(400);
  await uploadVariedBackground(page, sleep);
  const imageMode = await page.evaluate(() => ({
    mode: window.__extrude3d.getState().bgMode,
    select: document.getElementById("bg-mode").value,
    isTexture: !!(window.__extrude3d.scene.background && window.__extrude3d.scene.background.isTexture)
  }));
  check.ok(
    "上传背景图片自动切到图片模式并挂到真实 scene.background",
    imageMode.mode === "image" && imageMode.select === "image" && imageMode.isTexture === true,
    `mode=${imageMode.mode} select=${imageMode.select} isTexture=${imageMode.isTexture}`
  );

  await setControl(page, "bg-zoom", "2", "input");
  await sleep(500);
  const panBase = await page.evaluate(() => window.__extrude3d.getInfo().background);
  const panBasePixels = await sampleCanvasN(page, 64);
  await setControl(page, "bg-pan-x", "60", "input");
  await sleep(500);
  const panX = await page.evaluate(() => window.__extrude3d.getInfo().background);
  const panXPixels = await sampleCanvasN(page, 64);
  const panXChanged = changedPixels(panBasePixels, panXPixels);
  check.ok(
    "横向位置在裁切窗口内改变 offset 并真实改变像素",
    Math.abs(panX.offset[0] - panBase.offset[0]) > 0.01 &&
      panX.offset[0] >= -1e-6 &&
      panX.offset[0] <= panX.room[0] + 1e-6 &&
      panXChanged > 100,
    `offset=${JSON.stringify(panX.offset)} room=${JSON.stringify(panX.room)} 变化像素=${panXChanged}`
  );
  await setControl(page, "bg-pan-y", "-70", "input");
  await sleep(500);
  const panY = await page.evaluate(() => window.__extrude3d.getInfo().background);
  const panYPixels = await sampleCanvasN(page, 64);
  const panYChanged = changedPixels(panXPixels, panYPixels);
  check.ok(
    "纵向位置在裁切窗口内改变 offset 并真实改变像素",
    Math.abs(panY.offset[1] - panX.offset[1]) > 0.01 &&
      panY.offset[1] >= -1e-6 &&
      panY.offset[1] <= panY.room[1] + 1e-6 &&
      panYChanged > 100,
    `offset=${JSON.stringify(panY.offset)} room=${JSON.stringify(panY.room)} 变化像素=${panYChanged}`
  );

  // 透明背景开关不重置已选的裁切位置与缩放。
  await setControl(page, "transparent-bg", true, "change");
  await sleep(300);
  await setControl(page, "transparent-bg", false, "change");
  await sleep(400);
  const afterTransparent = await page.evaluate(() => window.__extrude3d.getInfo().background);
  check.ok(
    "透明背景打开 / 关闭不重置背景裁切位置与缩放",
    afterTransparent.pan[0] === 60 &&
      afterTransparent.pan[1] === -70 &&
      afterTransparent.zoom === 2 &&
      Math.abs(afterTransparent.offset[0] - panY.offset[0]) < 1e-6 &&
      Math.abs(afterTransparent.offset[1] - panY.offset[1]) < 1e-6,
    `pan=${JSON.stringify(afterTransparent.pan)} zoom=${afterTransparent.zoom} offset=${JSON.stringify(afterTransparent.offset)} 原=${JSON.stringify(panY.offset)}`
  );

  // 模式切换 / 材质 / SVG 变化都不重置相机、模型与已上传图片的裁切。
  await setControl(page, "material", "plastic", "change");
  await setControl(page, "sample", "hex-nest", "change");
  await waitModelled(page).catch(() => {});
  await sleep(600);
  const preSwitch = await page.evaluate(() => {
    const api = window.__extrude3d;
    return {
      shapeCount: api.getInfo().shapeCount,
      cameraDistance: api.getInfo().cameraDistance,
      cameraPosition: [api.camera.position.x, api.camera.position.y, api.camera.position.z].map((v) => +v.toFixed(4))
    };
  });
  await setControl(page, "bg-mode", "studio", "change");
  await sleep(700);
  const switched = await page.evaluate(() => {
    const api = window.__extrude3d;
    const s = api.getState();
    return {
      shapeCount: api.getInfo().shapeCount,
      cameraDistance: api.getInfo().cameraDistance,
      cameraPosition: [api.camera.position.x, api.camera.position.y, api.camera.position.z].map((v) => +v.toFixed(4)),
      zoom: s.bgZoom,
      panX: s.bgPanX,
      panY: s.bgPanY,
      imageName: (api.getInfo().background || {}).name || ""
    };
  });
  await setControl(page, "bg-mode", "image", "change");
  await sleep(500);
  const backToImage = await page.evaluate(() => ({
    isTexture: !!(window.__extrude3d.scene.background && window.__extrude3d.scene.background.isTexture),
    imageName: (window.__extrude3d.getInfo().background || {}).name || "",
    zoom: window.__extrude3d.getState().bgZoom,
    panX: window.__extrude3d.getState().bgPanX,
    panY: window.__extrude3d.getState().bgPanY
  }));
  check.ok(
    "背景模式切换保留模型 / 相机 / 缩放 / 位置，切走再切回图片仍在",
    switched.shapeCount === preSwitch.shapeCount &&
      switched.zoom === 2 &&
      switched.panX === 60 &&
      switched.panY === -70 &&
      switched.imageName.includes("varied-mosaic") &&
      Math.abs(switched.cameraDistance - preSwitch.cameraDistance) < 0.05 &&
      switched.cameraPosition.every((v, i) => Math.abs(v - preSwitch.cameraPosition[i]) < 0.01) &&
      backToImage.isTexture &&
      backToImage.imageName.includes("varied-mosaic") &&
      backToImage.zoom === 2 &&
      backToImage.panX === 60 &&
      backToImage.panY === -70,
    `studio:shape=${switched.shapeCount} zoom=${switched.zoom} pan=${switched.panX}/${switched.panY} cam=${switched.cameraDistance} image=${switched.imageName} back=${backToImage.isTexture}/${backToImage.imageName}`
  );

  // resize 改变视口宽高比：所选裁切与缩放保留，offset 重新落在合法范围。
  await page.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 });
  await sleep(700);
  const resized = await page.evaluate(() => {
    const s = window.__extrude3d.getState();
    const info = window.__extrude3d.getInfo().background;
    return { panX: s.bgPanX, panY: s.bgPanY, zoom: s.bgZoom, offset: info.offset, room: info.room };
  });
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
  await sleep(700);
  check.ok(
    "resize 后仍保留所选裁切位置与缩放（offset 落在合法范围）",
    resized.panX === 60 &&
      resized.panY === -70 &&
      resized.zoom === 2 &&
      resized.offset[0] >= -1e-6 &&
      resized.offset[0] <= resized.room[0] + 1e-6 &&
      resized.offset[1] >= -1e-6 &&
      resized.offset[1] <= resized.room[1] + 1e-6,
    `pan=${resized.panX}/${resized.panY} zoom=${resized.zoom} offset=${JSON.stringify(resized.offset)} room=${JSON.stringify(resized.room)}`
  );

  await page.click("#bg-pan-reset");
  await sleep(500);
  const panReset = await page.evaluate(() => window.__extrude3d.getInfo().background);
  check.ok(
    "重置背景位置回到居中（offset = (1-repeat)/2）",
    Math.abs(panReset.offset[0] - (1 - panReset.repeat[0]) / 2) < 0.005 &&
      Math.abs(panReset.offset[1] - (1 - panReset.repeat[1]) / 2) < 0.005,
    `offset=${JSON.stringify(panReset.offset)} repeat=${JSON.stringify(panReset.repeat)}`
  );
  await setControl(page, "bg-zoom", "1", "input");
  await sleep(500);
  const noRoom = await page.evaluate(() => {
    const info = window.__extrude3d.getInfo().background;
    return {
      room: info.room,
      xDisabled: document.getElementById("bg-pan-x").disabled,
      yDisabled: document.getElementById("bg-pan-y").disabled,
      note: document.getElementById("bg-pan-note").textContent.trim()
    };
  });
  check.ok(
    "只禁用没有裁切余量的轴，并提示「放大背景后可移动裁切位置」",
    (noRoom.xDisabled === (noRoom.room[0] <= 1e-4)) &&
      (noRoom.yDisabled === (noRoom.room[1] <= 1e-4)) &&
      (noRoom.xDisabled || noRoom.yDisabled) &&
      /放大背景后可移动裁切位置/.test(noRoom.note),
    `room=${JSON.stringify(noRoom.room)} disabled=${noRoom.xDisabled}/${noRoom.yDisabled} note=${noRoom.note}`
  );

  // 透射材质一律 DoubleSide + 多趟透射；只用同一个网格；转到背面仍真实渲染且无 GL 错误。
  await page.click("#bg-remove");
  await setControl(page, "transparent-bg", false, "change");
  await sleep(500);
  const transmissiveSides = await page.evaluate((presets) => {
    const select = document.getElementById("material");
    const api = window.__extrude3d;
    const out = {};
    for (const id of presets) {
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      out[id] = {
        side: api.mesh.material.side,
        forceSinglePass: api.mesh.material.forceSinglePass,
        transmission: api.mesh.material.transmission,
        transparent: api.mesh.material.transparent
      };
    }
    return out;
  }, ["glass", "frostedGlass", "diamond", "ice", "soapBubble", "resin"]);
  const badSide = Object.entries(transmissiveSides).filter(
    ([, v]) => !(v.side === 2 && v.forceSinglePass === false && v.transmission > 0 && v.transparent === true)
  );
  await setControl(page, "material", "glass", "change");
  await sleep(400);
  const transmissiveMeshCount = await page.evaluate(() => {
    let count = 0;
    window.__extrude3d.scene.traverse((o) => {
      if (o.isMesh && o.material && o.material.transmission > 0 && o.material.transparent === true) count += 1;
    });
    return count;
  });
  check.ok(
    "所有透射材质使用 DoubleSide + 多趟透射，且只用一个网格（无重复半透明替身）",
    badSide.length === 0 && transmissiveMeshCount === 1,
    `异常=${badSide.map(([k, v]) => `${k}:side=${v.side},single=${v.forceSinglePass}`).join(" | ") || "无"} 透射网格=${transmissiveMeshCount}`
  );

  const glassFront = await sampleCanvasN(page, 64);
  const dragStart = await page.$eval("#view-canvas", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 240, dragStart.y + 30, { steps: 14 });
  await page.mouse.up();
  await sleep(900);
  const glassRear = await sampleCanvasN(page, 64);
  const rearDrawn = await canvasLooksDrawn(page);
  const rearDiff = changedPixels(glassFront, glassRear);
  const glError = await page.evaluate(() => window.__extrude3d.renderer.getContext().getError());
  check.ok(
    "旋转到背面后玻璃仍真实渲染（画面明显变化、无 GL 错误）",
    rearDrawn.drawn === true && rearDiff > 50 && glError === 0,
    `drawn=${rearDrawn.drawn} opaqueRatio=${rearDrawn.opaqueRatio} 变化像素=${rearDiff} glError=${glError}`
  );

  // 按需渲染：空闲不再出图，参数变化立刻恢复出图。
  await sleep(900);
  const idleStart = await page.evaluate(() => window.__extrude3d.getInfo().renders);
  await sleep(600);
  const idleEnd = await page.evaluate(() => window.__extrude3d.getInfo().renders);
  await setControl(page, "depth", "30", "input");
  await sleep(600);
  const afterChange = await page.evaluate(() => window.__extrude3d.getInfo().renders);
  check.ok(
    "空闲时按需渲染停止出图，参数变化后恢复出图",
    idleEnd === idleStart && afterChange > idleEnd,
    `空闲 ${idleStart}→${idleEnd}，改厚度后 ${afterChange}`
  );

  /* ============ 本轮：真实立方体默认 / 总光量增益 / 强色散 / 示例导出 ============ */

  /** RGBA 采样里「彩色像素」占比（max - min 通道 > 阈值）：黑白背景上只有色散会带来彩色条纹。 */
  const colorfulCoverage = (data, threshold = 26) => {
    let colorful = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const spread = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      if (spread > threshold) colorful += 1;
      total += 1;
    }
    return total ? colorful / total : 0;
  };
  /** 三通道各自的方差之和：确认色散带来的是「空间通道差异」而不只是某个属性值变大。 */
  const channelVarianceSum = (data) => {
    const sum = [0, 0, 0];
    const sumSq = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        sum[c] += v;
        sumSq[c] += v * v;
      }
      n += 1;
    }
    return sum.reduce((acc, s, c) => {
      const mean = s / Math.max(n, 1);
      return acc + Math.sqrt(Math.max(0, sumSq[c] / Math.max(n, 1) - mean * mean));
    }, 0);
  };

  // 1) 内置立方体：真实 three 几何、厚度 = 最大边百分比、圆角走原生 RoundedBoxGeometry。
  const svgDepthBefore = await page.evaluate(() => window.__extrude3d.getInfo().settings.depthPercent);
  await page.click("#bg-remove");
  await setControl(page, "transparent-bg", false, "change");
  await setControl(page, "sample", "cube", "change");
  await setControl(page, "material", "glass", "change");
  await setControl(page, "depth", "100", "input");
  await setControl(page, "bevel-size", "2", "input");
  await sleep(700);
  const cubeDefault = await page.evaluate(() => {
    const api = window.__extrude3d;
    const info = api.getInfo();
    return { source: info.source, geometryType: api.mesh.geometry.type, size: info.normalizedSize.size, depthPercent: info.settings.depthPercent };
  });
  check.ok(
    "内置立方体是 three 原生真实几何（BoxGeometry / RoundedBoxGeometry，4×4×4）",
    cubeDefault.source === "cube" &&
      /BoxGeometry|RoundedBoxGeometry/.test(cubeDefault.geometryType) &&
      cubeDefault.depthPercent === 100 &&
      cubeDefault.size.every((v) => Math.abs(v - 4) < 0.05),
    `source=${cubeDefault.source} geometry=${cubeDefault.geometryType} size=${JSON.stringify(cubeDefault.size)}`
  );

  await setControl(page, "depth", "60", "input");
  await sleep(600);
  const cube60 = await page.evaluate(() => window.__extrude3d.getInfo());
  await setControl(page, "bevel-enabled", false, "change");
  await sleep(600);
  const cubeSquareType = await page.evaluate(() => window.__extrude3d.mesh.geometry.type);
  await setControl(page, "bevel-enabled", true, "change");
  await setControl(page, "bevel-size", "6", "input");
  await setControl(page, "depth", "100", "input");
  await sleep(600);
  const cubeRoundType = await page.evaluate(() => window.__extrude3d.mesh.geometry.type);
  check.ok(
    "立方体厚度按最大边百分比映射（60% → Z=2.4）",
    cube60.settings.depthPercent === 60 && Math.abs(cube60.normalizedSize.size[2] - 2.4) < 0.05,
    `Z=${cube60.normalizedSize.size[2]} depth=${cube60.settings.depthPercent}%`
  );
  check.ok(
    "立方体圆角走原生 RoundedBoxGeometry，关闭圆角回落到 BoxGeometry",
    cubeSquareType === "BoxGeometry" && cubeRoundType === "RoundedBoxGeometry",
    `关圆角=${cubeSquareType} 开圆角=${cubeRoundType}`
  );

  // 切回 SVG：来源 / 几何管线不变，且恢复切走前的手动深度（不覆盖旧设置）。
  await setControl(page, "sample", "square-ring", "change");
  await waitModelled(page).catch(() => {});
  await sleep(600);
  const svgBack = await page.evaluate(() => {
    const info = window.__extrude3d.getInfo();
    return { source: info.source, shapeCount: info.shapeCount, geometryType: info.geometryType, depthPercent: info.settings.depthPercent };
  });
  check.ok(
    "切回 SVG 样例仍走旧挤出管线并恢复切走前的手动深度",
    svgBack.source === "svg" &&
      svgBack.shapeCount > 0 &&
      svgBack.geometryType === "BufferGeometry" &&
      svgBack.depthPercent === svgDepthBefore,
    `source=${svgBack.source} shapeCount=${svgBack.shapeCount} geometry=${svgBack.geometryType} depth=${svgBack.depthPercent}/${svgDepthBefore}`
  );

  // 2) 强色散示例：一键填好参数并走本地 canvas 背景管线。
  await page.click("#dispersion-demo");
  await sleep(1600);
  const demoState = await page.evaluate(() => {
    const api = window.__extrude3d;
    const s = api.getState();
    const info = api.getInfo();
    return {
      source: s.source,
      preset: s.preset,
      ior: s.glassIor,
      dispersion: s.glassDispersion,
      bgMode: s.bgMode,
      bgName: s.bgName,
      materialDispersion: info.material ? info.material.dispersion : null,
      materialIor: info.material ? info.material.ior : null,
      sampleValue: document.getElementById("sample").value,
      dispersionSlider: document.getElementById("glass-dispersion").value
    };
  });
  check.ok(
    "强色散示例一键填好立方体 + 透明玻璃 + ior 1.5 + 色散 10 + 本地白底黑字背景",
    demoState.source === "cube" &&
      demoState.sampleValue === "cube" &&
      demoState.preset === "glass" &&
      demoState.ior === 1.5 &&
      demoState.dispersion === 10 &&
      demoState.dispersionSlider === "10" &&
      demoState.materialDispersion === 10 &&
      demoState.materialIor === 1.5 &&
      demoState.bgMode === "image" &&
      /dispersion-demo/.test(demoState.bgName || ""),
    `source=${demoState.source} preset=${demoState.preset} ior=${demoState.ior} disp=${demoState.dispersion} bg=${demoState.bgMode}/${demoState.bgName}`
  );

  // 3) 灯光强度 = 总光量增益：玻璃与镜面金属上 0 / 1.2 / 3 都真实改变像素。
  const lightGainSamples = async (preset) => {
    await setControl(page, "material", preset, "change");
    await sleep(500);
    const out = {};
    for (const value of [0, 1.2, 3]) {
      await setControl(page, "light-intensity", String(value), "input");
      await sleep(800);
      out[value] = {
        px: await sampleCanvasN(page, 96),
        info: await page.evaluate(() => window.__extrude3d.getInfo())
      };
    }
    return out;
  };
  const glassGain = await lightGainSamples("glass");
  const chromeGain = await lightGainSamples("chrome");
  const gainParams = [0, 1.2, 3].map((v) => glassGain[v].info.light.gain);
  const glassGainDiff = changedPixels(glassGain[0].px, glassGain[1.2].px, 30) + changedPixels(glassGain[1.2].px, glassGain[3].px, 30);
  const chromeGainDiff = changedPixels(chromeGain[0].px, chromeGain[1.2].px, 30) + changedPixels(chromeGain[1.2].px, chromeGain[3].px, 30);
  check.ok(
    "灯光强度映射为总光量增益（0 / 1 / 2.5，0 时环境反射与主光归零）",
    gainParams[0] === 0 &&
      Math.abs(gainParams[1] - 1) < 1e-6 &&
      Math.abs(gainParams[2] - 2.5) < 1e-6 &&
      glassGain[0].info.light.environmentIntensity === 0 &&
      glassGain[0].info.light.intensity === 0 &&
      glassGain[1.2].info.light.environmentIntensity > 0,
    `gain=${gainParams.join(" / ")} env0=${glassGain[0].info.light.environmentIntensity} env1.2=${glassGain[1.2].info.light.environmentIntensity}`
  );
  check.ok(
    "灯光强度 0/1.2/3 在玻璃与镜面金属上都真实改变像素（像素级，不是只改参数）",
    glassGainDiff > 100 && chromeGainDiff > 100,
    `玻璃变化=${glassGainDiff} 镜面金属变化=${chromeGainDiff}`
  );

  // 4) 色散 0 → 8 → 20：黑白文字背景上的彩色条纹覆盖与空间通道差异真实增加。
  await setControl(page, "material", "glass", "change");
  await sleep(500);
  const sampleDispersion = async (value) => {
    await setControl(page, "glass-dispersion", String(value), "input");
    await sleep(900);
    const px = await sampleCanvasN(page, 96);
    return {
      px,
      coverage: colorfulCoverage(px),
      channelVariance: channelVarianceSum(px),
      dispersion: await page.evaluate(() => window.__extrude3d.mesh.material.dispersion)
    };
  };
  const disp0 = await sampleDispersion(0);
  const disp8 = await sampleDispersion(8);
  const disp20 = await sampleDispersion(20);
  check.ok(
    "色散 0 → 8 → 20 在黑白文字背景上真实增加彩色条纹覆盖率（像素级）",
    disp0.dispersion === 0 &&
      disp8.dispersion === 8 &&
      disp20.dispersion === 20 &&
      disp0.coverage < disp8.coverage &&
      disp8.coverage < disp20.coverage,
    `彩色覆盖=${disp0.coverage.toFixed(4)} → ${disp8.coverage.toFixed(4)} → ${disp20.coverage.toFixed(4)}`
  );
  check.ok(
    "色散增强的是真实空间通道差异（三通道方差之和随色散升高）",
    disp8.channelVariance > disp0.channelVariance && disp20.channelVariance > disp8.channelVariance,
    `通道方差=${disp0.channelVariance.toFixed(2)} → ${disp8.channelVariance.toFixed(2)} → ${disp20.channelVariance.toFixed(2)}`
  );

  // 5) 示例导出 PNG 与视图一致（同一渲染，64×64 采样下核心像素差小）。
  await page.click("#dispersion-demo");
  await sleep(1400);
  await cleanDownloads();
  await setControl(page, "export-scale", "1", "change");
  await sleep(500);
  const demoView = await sampleCanvasN(page, 64);
  await page.click("#export-png");
  const demoPngFile = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const demoPngSample = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = "data:image/png;base64," + b64;
    });
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return Array.from(ctx.getImageData(0, 0, size, size).data);
  }, demoPngFile.bytes.toString("base64"));
  const exportCompare = modelSampleDiff(demoView, demoPngSample);
  check.ok(
    "强色散示例导出的 PNG 与视图一致（同渲染，核心像素差小）",
    exportCompare.core > 0 && exportCompare.coreRatio < 0.25 && exportCompare.meanDelta < 30,
    `核心像素=${exportCompare.core} 核心变化比例=${exportCompare.coreRatio} 平均通道差=${exportCompare.meanDelta}`
  );

  // 6) 棚拍反射面真实世界法线必须是 (0,1,0)（原生 Reflector 用物体 matrixWorld 旋转本地 +Z）。
  await page.click("#bg-remove");
  await setControl(page, "transparent-bg", false, "change");
  await setControl(page, "bg-mode", "studio", "change");
  await sleep(1200);
  const studioNormal = await page.evaluate(() => {
    const api = window.__extrude3d;
    let reflector = null;
    api.scene.traverse((o) => {
      if (o.isReflector) reflector = o;
    });
    const info = api.getInfo();
    return {
      normal: info.studio.reflectorNormal,
      hasReflector: !!reflector,
      rotationX: reflector ? +reflector.rotation.x.toFixed(4) : null,
      floorY: info.studio.floorY,
      visible: info.studio.visible
    };
  });
  check.ok(
    "棚拍地面 Reflector 法线为 (0,1,0)（未旋转几何 + 物体 rotation.x = -PI/2，不是数据旋转）",
    studioNormal.hasReflector &&
      studioNormal.visible === true &&
      Array.isArray(studioNormal.normal) &&
      Math.abs(studioNormal.normal[0]) < 1e-3 &&
      Math.abs(studioNormal.normal[1] - 1) < 1e-3 &&
      Math.abs(studioNormal.normal[2]) < 1e-3 &&
      Math.abs(studioNormal.rotationX + Math.PI / 2) < 1e-3,
    `normal=${JSON.stringify(studioNormal.normal)} rotationX=${studioNormal.rotationX} floorY=${studioNormal.floorY}`
  );

  check.ok("本批新用例后页面无未捕获异常", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
}
