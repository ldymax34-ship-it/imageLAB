/**
 * tools/extrude3d · SVG 转 3D 双页签 smoke
 *
 * 职责（最终架构）：
 *   - 建模页签（Three.js）：SVG 导入 / 安全校验 / 厚度 / 倒角 / 平滑度 / 中性灰诊断预览，
 *     产出 position / normal / uv / index 标准网格；
 *   - 渲染页签（vgpu + WebGPU）：7 个中文材质预设、灯光、背景、镜头、当前帧 PNG 导出；
 *   - 不再有 38 个 Three.js 材质预设、表面贴图与 Three 最终渲染控件。
 *
 * 覆盖：HTTP 200 / 0 外部请求 / 0 console 错误；默认立方体与中性灰诊断材质；建模→渲染网格交接
 * （GPU 未初始化时也保存摘要）；厚度按 bounds Z / thickness 判定（不用顶点数）；SVG 安全闸门
 * （普通导出放行、未使用 defs/metadata 放行、text/script/内部实体/外部资源/可见滤镜拒绝、
 * 1 MiB 上限、复杂曲线拒绝、平顺曲线自适应）；厚度/倒角/比例归一化；SVG 切换状态保持；
 * WebGPU 7 种真实材质、透明 PNG、1×/2× 导出尺寸；背景模式 / 校验 / 缩放 / 平移。
 *
 * 像素取样：本机 Chrome 把 WebGPU / WebGL canvas 直接 drawImage 到 2D canvas 会得到透明位图
 * （同类限制见 tests/specs/psychos.mjs），因此统一改用 Puppeteer ElementHandle.screenshot
 * 捕获浏览器合成结果，再在页面内用 Image + 2D canvas 解码取样。
 *
 * 浏览器实测由 Codex 执行；实现侧不启动浏览器。
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ROOT, pngInfo } from "../harness.mjs";

export const id = "extrude3d";
export const title = "SVG 转 3D（建模 / 渲染双页签）";
export const gpu = "webgpu";

const PRESET_IDS = ["glass", "frosted-glass", "acrylic", "plastic", "ceramic", "metal", "chrome"];
const PRESET_LABELS = ["透明玻璃", "磨砂玻璃", "彩色亚克力", "塑料", "陶瓷", "金属", "镀铬"];

const TMP_DIR = resolve(ROOT, ".tmp");
const FIX = {
  text: resolve(TMP_DIR, "extrude3d-reject-text.svg"),
  script: resolve(TMP_DIR, "extrude3d-script.svg"),
  entity: resolve(TMP_DIR, "extrude3d-entity.svg"),
  external: resolve(TMP_DIR, "extrude3d-external-ref.svg"),
  visibleFilter: resolve(TMP_DIR, "extrude3d-visible-filter.svg"),
  inertDefs: resolve(TMP_DIR, "extrude3d-inert-defs.svg"),
  ordinary: resolve(TMP_DIR, "extrude3d-allowed-ordinary.svg"),
  solid: resolve(TMP_DIR, "extrude3d-solid.svg"),
  smooth100: resolve(TMP_DIR, "extrude3d-smooth-100.svg"),
  smooth400: resolve(TMP_DIR, "extrude3d-smooth-400.svg"),
  manyCurves: resolve(TMP_DIR, "extrude3d-reject-many-curves.svg"),
  bigOk: resolve(TMP_DIR, "extrude3d-big-ok.svg"),
  overLimit: resolve(TMP_DIR, "extrude3d-over-limit.svg"),
  fakePng: resolve(TMP_DIR, "extrude3d-fake-texture.png"),
  plainText: resolve(TMP_DIR, "extrude3d-texture.txt"),
  props: [20, 200, 2000].map((units) => resolve(TMP_DIR, `extrude3d-prop-${units}.svg`))
};

/* --------------------------------------------------------------- SVG 素材 */

/**
 * 单条 path 含大量曲线：图形元素只有 1 条、字符串远小于 1 MiB，
 * 即使自适应降到最低细分，估算挤出顶点仍超硬上限。
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

/** 平顺闭合轮廓（近似圆）：切向连续、无自交，属于「普通平滑输入」。 */
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

/** 与 square-ring 同比例、只改 viewBox 单位（20 / 200 / 2000）。 */
function proportionalSvg(units) {
  const u = units / 200;
  const a = (n) => +(n * u).toFixed(4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${units} ${units}" width="${units}" height="${units}">
  <path fill="#111111" fill-rule="evenodd" d="M${a(20)} ${a(20)} H${a(180)} V${a(180)} H${a(20)} Z M${a(100)} ${a(60)} A${a(40)} ${a(40)} 0 1 0 ${a(100)} ${a(140)} A${a(40)} ${a(40)} 0 1 0 ${a(100)} ${a(60)} Z"/>
</svg>
`;
}

/** 生成总字节数约为 `bytes` 的普通 SVG（用于 1 MiB 闸门）。 */
function paddedSvg(bytes) {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">\n`;
  const body = `  <rect x="30" y="30" width="140" height="140" fill="#111111"/>\n`;
  const tail = `</svg>\n`;
  const padLen = Math.max(0, bytes - head.length - body.length - tail.length);
  return head + `<!-- ${"x".repeat(Math.max(0, padLen - 8))} -->\n` + body + tail;
}

const TEXT_SVG_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <text x="20" y="120" font-size="72" font-family="sans-serif">Hi</text>
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

/** 外部资源引用（href 指向网络 + CSS @import）：必须拒绝。 */
const EXTERNAL_REF_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 200" width="200" height="200">
  <style>@import url("https://example.com/theme.css");</style>
  <a xlink:href="https://example.com/icon.svg"><rect x="40" y="40" width="120" height="120" fill="#111111"/></a>
</svg>
`;

/** 只有未使用的 defs / metadata：不影响可见几何，不应被误判为「含滤镜」。 */
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

/** 可见元素上直接使用滤镜：仍必须被拒绝。 */
const VISIBLE_FILTER_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="M20 20 H180 V180 H20 Z" fill="#111111" filter="url(#blur)"/>
</svg>
`;

/** 普通导出最小组合：DOCTYPE / 命名空间 / metadata 正文 / 未使用 defs / 本地 #fragment。 */
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

/** 实心方块：玻璃折射 / 背景测试用。 */
const SOLID_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect x="20" y="20" width="160" height="160" fill="#111111"/>
</svg>
`;

/* --------------------------------------------------------------- 工具函数 */

function watchExternal(page, base) {
  const host = new URL(base).host;
  const external = [];
  page.on("request", (req) => {
    let url;
    try {
      url = new URL(req.url());
    } catch {
      return;
    }
    if (url.protocol.startsWith("http") && url.host !== host) external.push(req.url());
  });
  return external;
}

async function setControl(page, id, value, event = "input") {
  await page.$eval(
    `#${id}`,
    (node, next, ev) => {
      if (node.type === "checkbox") node.checked = !!next;
      else node.value = String(next);
      node.dispatchEvent(new Event(ev, { bubbles: true }));
    },
    value,
    event
  );
}

function waitModelled(page, timeout = 25000) {
  return page.waitForFunction(
    () => {
      const el = document.getElementById("model-status");
      return el && /已建模/.test(el.textContent);
    },
    { timeout, polling: 100 }
  );
}

function waitRejected(page, pattern, timeout = 20000) {
  return page.waitForFunction(
    (source) => {
      const el = document.getElementById("model-error");
      return el && !el.hidden && new RegExp(source).test(el.textContent);
    },
    { timeout, polling: 100 },
    pattern
  );
}

async function uploadSvg(page, file) {
  const input = await page.$("#svg-file");
  await input.uploadFile(file);
}

async function readMesh(page) {
  return page.evaluate(() => {
    const mesh = window.__extrude3d.getMesh();
    return mesh
      ? {
          vertexCount: mesh.vertexCount,
          indexCount: mesh.indexCount,
          thickness: mesh.thickness,
          z: +(mesh.bounds.max[2] - mesh.bounds.min[2]).toFixed(6),
          min: mesh.bounds.min,
          max: mesh.bounds.max,
          renderMesh: window.__extrude3d.getInfo().render.mesh
        }
      : null;
  });
}

/**
 * 通过 Puppeteer ElementHandle.screenshot 采样 canvas 的浏览器合成结果。
 *
 * 本机 Chrome 把 WebGPU / WebGL canvas 直接 drawImage 到 2D canvas 会得到透明位图
 * （同类限制见 tests/specs/psychos.mjs），所以改走真实合成截图：
 * ElementHandle.screenshot({ type: "png" }) → base64 传回页面 → Image + 2D canvas 解码到 n×n。
 * 返回 rgba / opaqueRatio / meanLuma / variance；元素缺失、不可见、截图失败、尺寸非法或
 * 解码失败时返回 ok:false 且 rgba 为空，绝不伪造非空数据。合成截图带页面底色，单看
 * opaqueRatio 无法区分空白画布，因此 `drawn` 用亮度方差判断「画布上确有内容」（纯色区域方差为 0）。
 */
const DRAWN_VARIANCE_MIN = 1;

async function sampleCanvasShot(page, selector, n = 64) {
  const fail = (reason) => ({
    ok: false,
    reason,
    width: 0,
    height: 0,
    rgba: [],
    opaqueRatio: 0,
    meanLuma: 0,
    variance: 0,
    drawn: false
  });

  const element = await page.$(selector);
  if (!element) return fail(`找不到元素 ${selector}`);
  const box = await element.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return fail(`元素不可见或尺寸为 0（${selector}）`);

  let bytes;
  try {
    bytes = await element.screenshot({ type: "png" });
  } catch (e) {
    return fail(`截图失败（${selector}）: ${e.message}`);
  }

  let header;
  try {
    header = pngInfo(bytes);
  } catch (e) {
    return fail(`截图不是有效 PNG（${selector}）: ${e.message}`);
  }

  const decoded = await page
    .evaluate(
      async (data, size) => {
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = () => rej(new Error("截图 PNG 解码失败"));
          img.src = "data:image/png;base64," + data;
        });
        if (!img.width || !img.height) throw new Error("解码后的截图尺寸为 0");
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const d = ctx.getImageData(0, 0, size, size).data;
        let opaque = 0;
        let sum = 0;
        let sumSq = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 8) opaque += 1;
          const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          sum += luma;
          sumSq += luma * luma;
        }
        const px = d.length / 4;
        const mean = sum / px;
        return {
          width: img.width,
          height: img.height,
          rgba: Array.from(d),
          opaqueRatio: opaque / px,
          meanLuma: mean,
          variance: Math.max(0, sumSq / px - mean * mean)
        };
      },
      Buffer.from(bytes).toString("base64"),
      n
    )
    .catch((e) => ({ error: e.message }));

  if (!decoded || decoded.error) return fail(`截图解码失败（${selector}）: ${(decoded && decoded.error) || "无结果"}`);
  if (!decoded.width || !decoded.height) return fail(`截图尺寸非法（${selector}）: ${decoded.width}×${decoded.height}`);
  if (decoded.width !== header.width || decoded.height !== header.height) {
    return fail(`截图尺寸不一致（${selector}）: PNG 头 ${header.width}×${header.height}，解码 ${decoded.width}×${decoded.height}`);
  }

  return {
    ok: true,
    reason: null,
    width: decoded.width,
    height: decoded.height,
    rgba: decoded.rgba,
    opaqueRatio: +decoded.opaqueRatio.toFixed(4),
    meanLuma: +decoded.meanLuma.toFixed(2),
    variance: +decoded.variance.toFixed(2),
    drawn: decoded.variance >= DRAWN_VARIANCE_MIN
  };
}

function changedPixels(a, b, threshold = 20) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > threshold) changed += 1;
  }
  return changed;
}

/** 采样平均 RGB 粗签名，用来判断不同材质是否产生不同画面。 */
function signature(data) {
  if (!data.length) return "empty";
  let r = 0;
  let g = 0;
  let b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return `${Math.round(r / n / 8)}-${Math.round(g / n / 8)}-${Math.round(b / n / 8)}`;
}

/** 9 宫格外圈（避开中间的模型）的平均亮度 / 饱和度，用来判断背景真实颜色。 */
function borderStats(data, n) {
  if (!data.length) return null;
  let luma = 0;
  let spread = 0;
  let count = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (x > n / 3 && x < (n * 2) / 3 && y > n / 3 && y < (n * 2) / 3) continue;
      const i = (y * n + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      luma += 0.299 * r + 0.587 * g + 0.114 * b;
      spread += Math.max(r, g, b) - Math.min(r, g, b);
      count += 1;
    }
  }
  return count ? { meanLuma: +(luma / count).toFixed(2), meanSpread: +(spread / count).toFixed(2) } : null;
}

async function waitRenderReady(page) {
  return page
    .waitForFunction(
      () => {
        const info = window.__extrude3d && window.__extrude3d.getInfo();
        if (!info) return false;
        return info.render.ready === true || !!info.render.failed;
      },
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
}

async function waitRenderStatus(page, pattern, timeout = 15000) {
  return page.waitForFunction(
    (source) => {
      const el = document.getElementById("render-status");
      return el && new RegExp(source).test(el.textContent);
    },
    { timeout, polling: 100 },
    pattern
  );
}

async function cleanDownloads(downloads) {
  for (const name of await readdir(downloads.dir)) {
    if (name.toLowerCase().endsWith(".png")) await rm(join(downloads.dir, name), { force: true });
  }
}

/** 在页面内生成非周期高对比马赛克 PNG 并上传为渲染页签背景（不引入外部素材）。 */
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
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size, size * 0.6);
    ctx.stroke();
    ctx.strokeStyle = "#000000";
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size * 0.7, 0);
    ctx.stroke();
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(size * 0.6, size * 0.15, 72, 72);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const input = document.getElementById("render-bg-file");
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "varied-mosaic.png", { type: "image/png" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () => {
      const el = document.getElementById("render-bg-name");
      return el && el.textContent.includes("varied-mosaic");
    },
    { timeout: 20000, polling: 100 }
  );
  await sleep(500);
}

/** 在页面内解码导出的 PNG，返回四角 alpha 与不透明像素占比。 */
async function analyzePng(page, bytes) {
  const b64 = Buffer.from(bytes).toString("base64");
  return page.evaluate(async (data) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = "data:image/png;base64," + data;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    const full = ctx.getImageData(0, 0, c.width, c.height).data;
    const pick = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    let opaque = 0;
    for (let i = 3; i < full.length; i += 4) if (full[i] > 16) opaque += 1;
    return {
      corners: [pick(1, 1), pick(c.width - 2, 1), pick(1, c.height - 2), pick(c.width - 2, c.height - 2)],
      opaqueRatio: opaque / (c.width * c.height)
    };
  }, b64);
}

/* --------------------------------------------------------------- 规格主体 */

export async function run({ page, base, downloads, check, sleep }) {
  await mkdir(TMP_DIR, { recursive: true });
  const external = watchExternal(page, base);
  const url = `${base}/tools/extrude3d/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("SVG 转 3D"), await page.title());

  await page.waitForFunction(() => window.__extrude3d && window.__extrude3d.getInfo, { timeout: 30000 });
  await sleep(500);

  /* ================================================ 默认建模页签与网格交接 */

  const boot = await page.evaluate(() => {
    const api = window.__extrude3d;
    const info = api.getInfo();
    const snapshot = api.getMeshSnapshot();
    return {
      tab: info.tab,
      modeling: info.modeling,
      render: { ready: info.render.ready, failed: info.render.failed, mesh: info.render.mesh, hasGpuGeometry: info.render.hasGpuGeometry },
      name: document.getElementById("svg-name").textContent.trim(),
      sample: document.getElementById("sample").value,
      snapshot:
        snapshot && {
          positions: snapshot.positions.length,
          normals: snapshot.normals.length,
          uvs: snapshot.uvs.length,
          vertexCount: snapshot.vertexCount
        }
    };
  });
  check.ok("默认停在建模页签", boot.tab === "model");
  check.ok(
    "默认展示原生真实立方体并生成几何",
    boot.modeling.source === "cube" && boot.sample === "cube" && boot.name.includes("立方体") && boot.modeling.vertexCount > 0,
    `source=${boot.modeling.source} sample=${boot.sample} name=${boot.name} verts=${boot.modeling.vertexCount}`
  );
  check.ok(
    "建模预览使用固定中性灰 MeshStandardMaterial",
    boot.modeling.materialType === "MeshStandardMaterial" && boot.modeling.materialColor === "#9c9c9c",
    `${boot.modeling.materialType} ${boot.modeling.materialColor}`
  );
  check.ok(
    "交接网格 position / normal / uv 数组长度与顶点数一致",
    boot.snapshot &&
      boot.snapshot.positions === boot.snapshot.vertexCount * 3 &&
      boot.snapshot.normals === boot.snapshot.vertexCount * 3 &&
      boot.snapshot.uvs === boot.snapshot.vertexCount * 2,
    JSON.stringify(boot.snapshot)
  );
  check.ok(
    "WebGPU 尚未初始化时渲染页签已保存建模网格摘要（状态同步先于 GPU）",
    boot.render.ready === false &&
      boot.render.failed === null &&
      boot.render.hasGpuGeometry === false &&
      boot.render.mesh &&
      boot.render.mesh.vertexCount === boot.modeling.vertexCount,
    `ready=${boot.render.ready} hasGpuGeometry=${boot.render.hasGpuGeometry} mesh=${JSON.stringify(boot.render.mesh && { v: boot.render.mesh.vertexCount })}`
  );

  /* ================================================ 厚度：按 bounds Z / thickness 判定 */

  await setControl(page, "sample", "square-ring", "change");
  await waitModelled(page);
  await sleep(500);
  const firstName = await page.$eval("#svg-name", (n) => n.textContent.trim());
  check.ok("切换到 square-ring 样例建模成功", firstName.includes("square-ring.svg"), `当前=${firstName}`);

  await setControl(page, "bevel-enabled", false, "change");
  await setControl(page, "depth", "16", "input");
  await sleep(600);
  const mesh16 = await readMesh(page);
  await setControl(page, "depth", "70", "input");
  await sleep(600);
  const mesh70 = await readMesh(page);
  check.ok(
    "厚度变化改变真实几何厚度（比较 bounds Z / thickness，不拿顶点数当判据）",
    mesh16 && mesh70 && mesh70.thickness > mesh16.thickness * 1.5 && mesh70.z > mesh16.z * 1.4,
    `thickness ${mesh16 && mesh16.thickness} → ${mesh70 && mesh70.thickness}；z ${mesh16 && mesh16.z} → ${mesh70 && mesh70.z}`
  );
  check.ok(
    "渲染页签同步到同一份新网格（thickness / vertexCount）",
    mesh70 &&
      mesh70.renderMesh &&
      mesh70.renderMesh.thickness === mesh70.thickness &&
      mesh70.renderMesh.vertexCount === mesh70.vertexCount,
    JSON.stringify(mesh70 && mesh70.renderMesh)
  );

  /* ================================================ 厚度 / 倒角 / 比例归一化 */

  await setControl(page, "bevel-enabled", false, "change");
  const thicknessSteps = [];
  for (const value of [2, 16, 70]) {
    await setControl(page, "depth", String(value), "input");
    await sleep(600);
    thicknessSteps.push(await page.evaluate(() => window.__extrude3d.getInfo().modeling));
  }
  check.ok(
    "厚度按最大平面边长百分比映射（2 / 16 / 70 为真实百分比）",
    thicknessSteps.every((info, i) => info.settings.depthPercent === [2, 16, 70][i]),
    thicknessSteps.map((info) => `${info.settings.depthPercent}%`).join(" / ")
  );
  check.ok(
    "厚度 2 < 16 < 70% 的归一化 z 尺寸单调增大",
    thicknessSteps[0].normalizedSize.size[2] < thicknessSteps[1].normalizedSize.size[2] &&
      thicknessSteps[1].normalizedSize.size[2] < thicknessSteps[2].normalizedSize.size[2],
    thicknessSteps.map((info) => info.normalizedSize.size[2]).join(" → ")
  );

  await setControl(page, "depth", "16", "input");
  await setControl(page, "bevel-enabled", true, "change");
  const bevelSteps = [];
  for (const value of [0, 2, 6]) {
    await setControl(page, "bevel-size", String(value), "input");
    await setControl(page, "bevel-thickness", String(value), "input");
    await sleep(600);
    bevelSteps.push(await page.evaluate(() => window.__extrude3d.getInfo().modeling));
  }
  check.ok("倒角宽度 / 深度都为 0 时完全关闭倒角", bevelSteps[0].settings.bevelEnabled === false, `bevelEnabled=${bevelSteps[0].settings.bevelEnabled}`);
  check.ok(
    "倒角 0 → 2 → 6% 真实增大归一化 XY 与 z 尺寸",
    bevelSteps[0].normalizedSize.size[0] < bevelSteps[1].normalizedSize.size[0] &&
      bevelSteps[1].normalizedSize.size[0] < bevelSteps[2].normalizedSize.size[0] &&
      bevelSteps[0].normalizedSize.size[2] < bevelSteps[1].normalizedSize.size[2] &&
      bevelSteps[1].normalizedSize.size[2] < bevelSteps[2].normalizedSize.size[2],
    bevelSteps.map((info) => `${info.normalizedSize.size[0]}/${info.normalizedSize.size[2]}`).join(" → ")
  );
  check.ok(
    "倒角 6% 未被隐藏钳制（厚度 16% 时上限为 8%）",
    bevelSteps[2].settings.bevelLimit === false,
    `bevelLimit=${bevelSteps[2].settings.bevelLimit} 实际=${bevelSteps[2].settings.bevelSizePercent}%`
  );

  await setControl(page, "depth", "2", "input");
  await setControl(page, "bevel-size", "6", "input");
  await setControl(page, "bevel-thickness", "6", "input");
  await sleep(600);
  const clamped = await page.evaluate(() => ({
    info: window.__extrude3d.getInfo().modeling,
    status: document.getElementById("model-status").textContent.trim()
  }));
  check.ok(
    "达到几何保护上限时明确反馈实际倒角值",
    clamped.info.settings.bevelLimit === true &&
      clamped.info.settings.bevelSizePercent <= 1.01 &&
      /限制|实际/.test(clamped.status),
    `limited=${clamped.info.settings.bevelLimit} 实际=${clamped.info.settings.bevelSizePercent}% status=${clamped.status.slice(0, 90)}`
  );

  await setControl(page, "depth", "16", "input");
  await setControl(page, "bevel-size", "2", "input");
  await setControl(page, "bevel-thickness", "2", "input");
  await sleep(400);
  const proportionSizes = [];
  for (let i = 0; i < FIX.props.length; i++) {
    const units = [20, 200, 2000][i];
    await writeFile(FIX.props[i], proportionalSvg(units), "utf8");
    await uploadSvg(page, FIX.props[i]);
    await waitModelled(page);
    await sleep(400);
    const info = await page.evaluate(() => window.__extrude3d.getInfo().modeling);
    proportionSizes.push({ units, size: info.normalizedSize.size, scale: info.normalizedSize.baseScale });
  }
  const propMaxDelta = Math.max(
    ...proportionSizes.map((p) => Math.max(...p.size.map((v, k) => Math.abs(v - proportionSizes[0].size[k]))))
  );
  check.ok(
    "同比例 SVG（20 / 200 / 2000）归一化后结果相等",
    propMaxDelta < 0.02,
    proportionSizes.map((p) => `${p.units}:${p.size.join("×")}`).join(" | ")
  );

  /* ================================================ SVG 安全闸门 */

  // 未使用 defs / metadata 放行
  await writeFile(FIX.inertDefs, INERT_DEFS_SVG_TEXT, "utf8");
  await uploadSvg(page, FIX.inertDefs);
  await waitModelled(page);
  await sleep(400);
  const inert = await page.evaluate(() => ({
    errorHidden: document.getElementById("model-error").hidden,
    info: window.__extrude3d.getInfo().modeling
  }));
  check.ok(
    "只有未使用的 defs / metadata 定义的 SVG 可以正常导入",
    inert.errorHidden === true && inert.info.shapeCount > 0 && inert.info.lastError === null,
    `shapeCount=${inert.info.shapeCount} lastError=${String(inert.info.lastError).slice(0, 60)}`
  );

  // 普通导出放行
  await writeFile(FIX.ordinary, ALLOWED_ORDINARY_SVG_TEXT, "utf8");
  await uploadSvg(page, FIX.ordinary);
  await waitModelled(page);
  await sleep(400);
  const ordinary = await page.evaluate(() => ({
    name: document.getElementById("svg-name").textContent.trim(),
    errorHidden: document.getElementById("model-error").hidden,
    info: window.__extrude3d.getInfo().modeling
  }));
  check.ok(
    "普通导出（SVG 1.1 DOCTYPE / 命名空间 / metadata 正文 / 未使用 defs / 本地 #fragment）可正常导入",
    ordinary.errorHidden === true && ordinary.info.shapeCount > 0 && /allowed-ordinary/.test(ordinary.name),
    `name=${ordinary.name} shapeCount=${ordinary.info.shapeCount} lastError=${String(ordinary.info.lastError).slice(0, 60)}`
  );

  // 可见元素上使用滤镜：拒绝
  await writeFile(FIX.visibleFilter, VISIBLE_FILTER_SVG_TEXT, "utf8");
  await uploadSvg(page, FIX.visibleFilter);
  await waitRejected(page, "滤镜");
  const visibleFilter = await page.evaluate(() => window.__extrude3d.getInfo().modeling);
  check.ok(
    "可见元素上使用滤镜仍被拒绝，且保留上一次成功模型",
    visibleFilter.lastError !== null && visibleFilter.shapeCount > 0,
    `lastError=${String(visibleFilter.lastError).slice(0, 60)}`
  );

  // text / script / 内部实体 / 外部资源：逐项拒绝
  const guardRejects = [
    { key: "text", file: FIX.text, text: TEXT_SVG_TEXT, label: "含 <text> 的 SVG", pattern: "text|tspan", expect: /text|tspan/i },
    { key: "script", file: FIX.script, text: SCRIPT_SVG_TEXT, label: "真实 <script>", pattern: "脚本", expect: /脚本/ },
    { key: "entity", file: FIX.entity, text: ENTITY_SVG_TEXT, label: "内部 ENTITY 定义", pattern: "实体", expect: /实体/ },
    { key: "external", file: FIX.external, text: EXTERNAL_REF_SVG_TEXT, label: "外部资源引用（href + @import）", pattern: "外部|资源", expect: /外部|资源/ }
  ];
  for (const item of guardRejects) {
    await writeFile(item.file, item.text, "utf8");
    await uploadSvg(page, item.file);
    await waitRejected(page, item.pattern);
    const rejected = await page.evaluate(() => ({
      text: document.getElementById("model-error").textContent.trim(),
      info: window.__extrude3d.getInfo().modeling,
      canvasCount: document.querySelectorAll("canvas").length
    }));
    check.ok(
      `${item.label} 被最小闸门拒绝并给出中文原因`,
      /拒绝/.test(rejected.text) && item.expect.test(rejected.text),
      rejected.text.slice(0, 120)
    );
    check.ok(
      `${item.label} 被拒后保留上一次成功模型`,
      rejected.info.lastError !== null && rejected.info.shapeCount > 0 && rejected.canvasCount === 2,
      `shapeCount=${rejected.info.shapeCount} lastError=${String(rejected.info.lastError).slice(0, 60)}`
    );
  }
  const afterReject = await sampleCanvasShot(page, "#model-canvas");
  check.ok(
    "拒绝后建模画布仍可渲染",
    afterReject.ok && afterReject.drawn === true,
    afterReject.ok
      ? `variance=${afterReject.variance} opaqueRatio=${afterReject.opaqueRatio} 尺寸=${afterReject.width}×${afterReject.height}`
      : afterReject.reason
  );

  // 1 MiB 闸门：90 KiB 通过，1.1 MiB 拒绝且给出真实大小
  await writeFile(FIX.bigOk, paddedSvg(90 * 1024), "utf8");
  await uploadSvg(page, FIX.bigOk);
  await waitModelled(page);
  await sleep(400);
  const bigOk = await page.evaluate(() => ({
    name: document.getElementById("svg-name").textContent.trim(),
    errorHidden: document.getElementById("model-error").hidden,
    info: window.__extrude3d.getInfo().modeling
  }));
  check.ok(
    "64 KiB–1 MiB 的普通 SVG 可以导入",
    bigOk.errorHidden === true && bigOk.info.shapeCount > 0 && /big-ok/.test(bigOk.name),
    `name=${bigOk.name} shapeCount=${bigOk.info.shapeCount}`
  );

  await writeFile(FIX.overLimit, paddedSvg(1100 * 1024), "utf8");
  await uploadSvg(page, FIX.overLimit);
  await waitRejected(page, "过大");
  const overLimit = await page.evaluate(() => ({
    text: document.getElementById("model-error").textContent.trim(),
    info: window.__extrude3d.getInfo().modeling
  }));
  check.ok(
    "超过 1 MiB 的 SVG 被拒绝并给出真实大小",
    /过大/.test(overLimit.text) && /MiB/.test(overLimit.text) && overLimit.info.shapeCount > 0,
    overLimit.text.slice(0, 120)
  );

  // 平顺曲线：自适应降低细分后接受；大量曲线：拒绝
  await setControl(page, "bevel-size", "6", "input");
  await setControl(page, "bevel-thickness", "6", "input");
  await sleep(300);

  const uploadSmooth = async (file, segments, label) => {
    await writeFile(file, smoothCurveSvg(segments), "utf8");
    await uploadSvg(page, file);
    await waitModelled(page, 45000);
    await sleep(500);
    const result = await page.evaluate(() => ({
      info: window.__extrude3d.getInfo().modeling,
      status: document.getElementById("model-status").textContent.trim(),
      errorHidden: document.getElementById("model-error").hidden
    }));
    check.ok(
      `${label} 段平顺闭合轮廓能自适应接受`,
      result.errorHidden === true && result.info.shapeCount > 0 && /已建模/.test(result.status),
      `shapeCount=${result.info.shapeCount} verts=${result.info.vertexCount} status=${result.status.slice(0, 80)}`
    );
    check.ok(
      `${label} 段平顺轮廓自适应后实际顶点不超过硬上限`,
      result.info.settings.actualVerts > 0 && result.info.settings.actualVerts <= 600000,
      `actualVerts=${result.info.settings.actualVerts}`
    );
    return result;
  };

  const smooth = await uploadSmooth(FIX.smooth100, 100, "100");
  check.ok(
    "自适应降低了细分并如实反馈",
    smooth.info.settings.reduction === true &&
      smooth.info.settings.curveSegments <= 32 &&
      /降低细分|细分/.test(smooth.status),
    `curve=${smooth.info.settings.curveSegments} bevel=${smooth.info.settings.bevelSegments} status=${smooth.status.slice(0, 110)}`
  );
  await uploadSmooth(FIX.smooth400, 400, "400");

  await writeFile(FIX.manyCurves, manyCurveSvg(2200), "utf8");
  await uploadSvg(page, FIX.manyCurves);
  await waitRejected(page, "曲线|顶点", 30000);
  const manyReject = await page.evaluate(() => ({
    text: document.getElementById("model-error").textContent.trim(),
    info: window.__extrude3d.getInfo().modeling
  }));
  check.ok(
    "单条 path 含大量曲线被拒绝并给出中文原因",
    /拒绝/.test(manyReject.text) && /曲线|顶点/.test(manyReject.text),
    manyReject.text.slice(0, 140)
  );
  check.ok(
    "曲线超限后保留上一次成功模型且无未捕获异常",
    manyReject.info.shapeCount > 0 && manyReject.info.lastError !== null && page.errors.length === 0,
    `shapeCount=${manyReject.info.shapeCount} lastError=${String(manyReject.info.lastError).slice(0, 60)}`
  );

  /* ================================================ SVG 切换状态保持 */

  await setControl(page, "sample", "square-ring", "change");
  await waitModelled(page);
  await sleep(400);
  await setControl(page, "depth", "42", "input");
  await setControl(page, "bevel-size", "4", "input");
  await setControl(page, "bevel-thickness", "3", "input");
  await setControl(page, "smoothness", "0.62", "input");
  await sleep(600);
  const beforeSwitchState = await page.evaluate(() => {
    const api = window.__extrude3d;
    return {
      state: api.getState(),
      verts: api.getInfo().modeling.vertexCount,
      cameraDistance: api.getInfo().modeling.cameraDistance
    };
  });
  await setControl(page, "sample", "hex-nest", "change");
  await waitModelled(page);
  await sleep(600);
  const afterSwitchState = await page.evaluate(() => {
    const api = window.__extrude3d;
    return {
      state: api.getState(),
      verts: api.getInfo().modeling.vertexCount,
      name: document.getElementById("svg-name").textContent.trim(),
      cameraDistance: api.getInfo().modeling.cameraDistance
    };
  });
  check.ok(
    "切换 SVG 样例保留厚度 / 倒角 / 平滑度参数与相机",
    afterSwitchState.state.depth === beforeSwitchState.state.depth &&
      afterSwitchState.state.bevelSize === beforeSwitchState.state.bevelSize &&
      afterSwitchState.state.bevelThickness === beforeSwitchState.state.bevelThickness &&
      afterSwitchState.state.smoothness === beforeSwitchState.state.smoothness &&
      afterSwitchState.verts > 0 &&
      afterSwitchState.verts !== beforeSwitchState.verts &&
      afterSwitchState.cameraDistance > 0,
    `depth=${afterSwitchState.state.depth} smoothness=${afterSwitchState.state.smoothness} verts=${beforeSwitchState.verts}→${afterSwitchState.verts}`
  );
  check.ok(
    "切换 SVG 后错误提示清空且状态栏为已建模",
    afterSwitchState.name.includes("hex-nest.svg") && afterSwitchState.state.lastError === null,
    `name=${afterSwitchState.name} lastError=${afterSwitchState.state.lastError}`
  );

  /* ================================================ 渲染页签 / WebGPU */

  await page.click("#tab-render");
  await sleep(400);
  const switched = await page.evaluate(() => ({
    renderSelected: document.getElementById("tab-render").getAttribute("aria-selected"),
    modelHidden: document.getElementById("panel-model").hidden,
    canvasVisible: !document.getElementById("stage-render").hidden
  }));
  check.ok(
    "切到渲染页签后面板与画布可见",
    switched.renderSelected === "true" && switched.modelHidden === true && switched.canvasVisible === true
  );

  /* ---------- 渲染画布工具栏：重置视图（复用 render-reset-view） ---------- */
  const resetEntry = await page.evaluate(() => {
    const button = document.getElementById("render-reset-view");
    return button
      ? {
          exists: true,
          text: button.textContent.trim(),
          title: button.getAttribute("title") || "",
          inRenderToolbar: !!button.closest("#stage-render .il-canvas-toolbar")
        }
      : { exists: false };
  });
  check.ok(
    "重置视图位于渲染画布工具栏且复用 render-reset-view",
    resetEntry.exists && resetEntry.inRenderToolbar && resetEntry.text === "重置视图" && /观察中心/.test(resetEntry.title),
    JSON.stringify(resetEntry)
  );
  await page.click("#render-reset-view");
  await sleep(200);
  const resetResult = await page.evaluate(() => ({
    status: document.getElementById("render-status").textContent.trim(),
    distance: window.__extrude3d.getInfo().render.cameraDistance
  }));
  check.ok(
    "点击重置视图反馈「摄像机与模型构图已重置」并恢复默认机位",
    /摄像机与模型构图已重置/.test(resetResult.status) && Math.abs(resetResult.distance - 8.6) < 0.3,
    JSON.stringify(resetResult)
  );

  const settled = await waitRenderReady(page);
  const render = await page.evaluate(() => window.__extrude3d.getInfo().render);
  check.ok("渲染页签给出明确结论（就绪或中文不可用提示）", settled && (render.ready || render.failed), render.failed || "ready");

  if (!render.ready) {
    const hint = await page.$eval("#render-hint", (n) => ({ hidden: n.hidden, text: n.textContent.trim() }));
    check.ok("WebGPU 不可用时显示中文提示且建模页签仍可用", !hint.hidden && /WebGPU/.test(hint.text), hint.text);
    const stillThere = await page.evaluate(() => {
      window.__extrude3d.setTab("model");
      return window.__extrude3d.getInfo().modeling.vertexCount > 0;
    });
    check.ok("切回建模页签不丢几何参数", stillThere);
  } else {
    check.ok(
      "WebGPU 就绪时渲染页签持有已上传网格",
      render.hasGpuGeometry === true && render.mesh && render.mesh.vertexCount > 0,
      `mesh=${render.mesh && render.mesh.vertexCount}`
    );

    /* ---------- 7 个中文材质预设（真实 GPU 渲染） ---------- */
    const presetOptions = await page.$$eval("#render-material option", (nodes) =>
      nodes.map((n) => ({ value: n.value, label: (n.textContent || "").trim() }))
    );
    check.ok(
      "渲染页签正好 7 个中文材质预设",
      presetOptions.length === 7 &&
        PRESET_IDS.every((id) => presetOptions.some((o) => o.value === id)) &&
        PRESET_LABELS.every((label) => presetOptions.some((o) => o.label === label)),
      presetOptions.map((o) => `${o.value}:${o.label}`).join(" / ")
    );

    const materials = [];
    for (const presetId of PRESET_IDS) {
      await setControl(page, "render-material", presetId, "change");
      await sleep(280);
      const applied = await page.evaluate(() => window.__extrude3d.getInfo().render);
      const shot = await sampleCanvasShot(page, "#render-canvas", 40);
      materials.push({
        id: presetId,
        applied: applied.preset,
        ok: shot.ok,
        reason: shot.reason,
        drawn: shot.drawn,
        ratio: shot.opaqueRatio,
        variance: shot.variance,
        pixels: shot.rgba
      });
    }
    check.ok(
      "7 种材质都能从下拉选中并生效",
      materials.every((m) => m.applied === m.id),
      materials.map((m) => m.applied).join(",")
    );
    check.ok(
      "7 种材质都在 GPU 中渲染出非空画面",
      materials.every((m) => m.ok && m.drawn === true),
      materials.map((m) => `${m.id}:${m.ok ? `variance=${m.variance}` : m.reason}`).join(" ")
    );
    const signatures = new Set(materials.map((m) => signature(m.pixels)));
    check.ok(
      "不同材质产生真实像素差异（粗签名至少 4 类）",
      signatures.size >= 4,
      `签名=${[...signatures].join(" / ")}`
    );
    const glassVsOpaque = changedPixels(materials[0].pixels, materials[3].pixels);
    const glassVsMetal = changedPixels(materials[0].pixels, materials[5].pixels);
    check.ok(
      "透明玻璃与不透明材质渲染结果明显不同",
      glassVsOpaque > 30 && glassVsMetal > 30,
      `玻璃↔塑料=${glassVsOpaque} 玻璃↔金属=${glassVsMetal}`
    );

    // 玻璃现在有独立的背面通道：模型区域应同时出现前后两个界面的亮度结构（平滑填充的
    // 单层壳不会有这种内部变化），并且必须存在实际有颜色 / 有层次的像素。
    const glassShot = materials[0];
    let glassColored = 0;
    let glassLumaSum = 0;
    let glassLumaSumSq = 0;
    let glassPixels = 0;
    for (let i = 0; i < glassShot.pixels.length; i += 4) {
      const r = glassShot.pixels[i];
      const g = glassShot.pixels[i + 1];
      const b = glassShot.pixels[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 10) glassColored += 1;
      glassLumaSum += luma;
      glassLumaSumSq += luma * luma;
      glassPixels += 1;
    }
    const glassLumaMean = glassLumaSum / Math.max(1, glassPixels);
    const glassLumaVar = glassLumaSumSq / Math.max(1, glassPixels) - glassLumaMean * glassLumaMean;
    check.ok(
      "透明玻璃在 GPU 里出现前后界面 / 内部结构，不是单层纯色壳",
      glassShot.ok && glassColored > 0 && glassLumaVar > 200,
      glassShot.ok
        ? `有彩色像素=${glassColored} luma方差=${glassLumaVar.toFixed(1)}`
        : glassShot.reason
    );

    /* ---------- 透明 PNG 与 1× / 2× 导出尺寸 ---------- */
    const canvasSize = await page.evaluate(() => window.__extrude3d.getInfo().render.canvas);
    check.ok("渲染画布尺寸有效", canvasSize[0] > 0 && canvasSize[1] > 0, canvasSize.join("×"));

    await setControl(page, "render-material", "glass", "change");
    await setControl(page, "render-transparent", true, "change");
    await setControl(page, "render-export-scale", "1", "change");
    await sleep(400);
    await cleanDownloads(downloads);
    // 导出按钮在「输出」分类里；分类切换只改显示，不重置材质 / 背景 / 相机状态。
    await page.$eval('[data-cat="output"]', (node) => node.click());
    await page.click("#render-export-png");
    const png1 = await downloads.waitForFile({ ext: ".png", timeoutMs: 45000 });
    const info1 = pngInfo(png1.bytes);
    check.ok(
      "透明背景 1× 导出尺寸等于视图尺寸",
      Math.abs(info1.width - canvasSize[0]) <= 2 && Math.abs(info1.height - canvasSize[1]) <= 2,
      `PNG=${info1.width}×${info1.height} 视图=${canvasSize.join("×")}`
    );
    check.ok("透明模式导出的 PNG 带 alpha 通道", png1.bytes[25] === 6, `IHDR colorType=${png1.bytes[25]}`);
    const alpha = await analyzePng(page, png1.bytes);
    check.ok(
      "透明导出的 PNG 四角透明且模型像素保留",
      alpha.corners.every((c) => c[3] === 0) && alpha.opaqueRatio > 0.01,
      `四角alpha=${alpha.corners.map((c) => c[3]).join(",")} 模型占比=${alpha.opaqueRatio.toFixed(3)}`
    );

    await setControl(page, "render-transparent", false, "change");
    await setControl(page, "render-export-scale", "2", "change");
    await sleep(400);
    await cleanDownloads(downloads);
    await page.click("#render-export-png");
    const png2 = await downloads.waitForFile({ ext: ".png", timeoutMs: 45000 });
    const info2 = pngInfo(png2.bytes);
    check.ok(
      "2× 导出尺寸约为视图尺寸 2 倍",
      Math.abs(info2.width - canvasSize[0] * 2) <= 3 && Math.abs(info2.height - canvasSize[1] * 2) <= 3,
      `PNG=${info2.width}×${info2.height} 期望=${canvasSize[0] * 2}×${canvasSize[1] * 2}`
    );
    await sleep(400);
    const restored = await page.evaluate(() => window.__extrude3d.getInfo().render.canvas);
    check.ok(
      "导出后预览画布恢复视图尺寸",
      Math.abs(restored[0] - canvasSize[0]) <= 1 && Math.abs(restored[1] - canvasSize[1]) <= 1,
      `恢复=${restored.join("×")}`
    );

    /* ---------- 纯色背景黑 / 白快速预设（默认白色） ---------- */

    const bgPresetDefault = await page.evaluate(() => ({
      color: document.getElementById("render-bg").value,
      black: document.getElementById("render-bg-black").getAttribute("aria-pressed"),
      white: document.getElementById("render-bg-white").getAttribute("aria-pressed"),
      labelBlack: document.getElementById("render-bg-black").textContent.trim(),
      labelWhite: document.getElementById("render-bg-white").textContent.trim(),
      state: window.__extrude3d.getInfo().render.state
    }));
    check.ok(
      "纯色背景默认白色，黑 / 白预设中文名与选中态正确",
      bgPresetDefault.color === "#ffffff" &&
        bgPresetDefault.state.bgColor === "#ffffff" &&
        bgPresetDefault.state.bgPreset === "white" &&
        bgPresetDefault.white === "true" &&
        bgPresetDefault.black === "false" &&
        bgPresetDefault.labelBlack === "黑色" &&
        bgPresetDefault.labelWhite === "白色",
      JSON.stringify(bgPresetDefault)
    );

    const whiteShot = await sampleCanvasShot(page, "#render-canvas", 24);
    const whiteBorder = whiteShot.ok ? borderStats(whiteShot.rgba, 24) : null;
    check.ok(
      "默认白色纯色背景：画面外圈是亮背景而不是模型 / 白色 fallback 混淆",
      whiteShot.ok && whiteBorder && whiteBorder.meanLuma >= 180 && whiteBorder.meanSpread <= 26,
      whiteShot.ok ? `luma=${whiteBorder && whiteBorder.meanLuma} spread=${whiteBorder && whiteBorder.meanSpread}` : whiteShot.reason
    );

    await page.$eval('[data-cat="background"]', (node) => node.click());
    await page.click("#render-bg-black");
    await sleep(400);
    const bgBlack = await page.evaluate(() => ({
      color: document.getElementById("render-bg").value,
      state: window.__extrude3d.getInfo().render.state,
      black: document.getElementById("render-bg-black").getAttribute("aria-pressed"),
      white: document.getElementById("render-bg-white").getAttribute("aria-pressed"),
      mode: document.getElementById("render-bg-mode").value
    }));
    check.ok(
      "点击「黑色」预设映射为 #000000 并切回纯色",
      bgBlack.color === "#000000" &&
        bgBlack.state.bgColor === "#000000" &&
        bgBlack.state.bgPreset === "black" &&
        bgBlack.mode === "pure" &&
        bgBlack.black === "true" &&
        bgBlack.white === "false",
      JSON.stringify(bgBlack)
    );
    const blackShot = await sampleCanvasShot(page, "#render-canvas", 24);
    const blackBorder = blackShot.ok ? borderStats(blackShot.rgba, 24) : null;
    check.ok(
      "黑色预设真实压暗背景（外圈平均亮度明显低于白色）",
      blackShot.ok && blackBorder && whiteBorder && blackBorder.meanLuma <= 60 && whiteBorder.meanLuma - blackBorder.meanLuma >= 120,
      blackShot.ok ? `黑=${blackBorder && blackBorder.meanLuma} 白=${whiteBorder && whiteBorder.meanLuma}` : blackShot.reason
    );

    await page.click("#render-bg-white");
    await sleep(400);
    const bgWhite = await page.evaluate(() => ({
      color: document.getElementById("render-bg").value,
      preset: window.__extrude3d.getInfo().render.state.bgPreset,
      white: document.getElementById("render-bg-white").getAttribute("aria-pressed")
    }));
    check.ok(
      "点击「白色」预设映射为 #ffffff 并恢复选中态",
      bgWhite.color === "#ffffff" && bgWhite.preset === "white" && bgWhite.white === "true",
      JSON.stringify(bgWhite)
    );

    /* ---------- 色散：默认明显增强但 0 仍为关闭 ---------- */

    const dispersionDefault = await page.evaluate(() => ({
      input: document.getElementById("render-dispersion").value,
      out: document.getElementById("render-dispersion-out").textContent.trim(),
      state: window.__extrude3d.getInfo().render.state
    }));
    check.ok(
      "色散默认值明显增强且与控件 / 状态一致",
      Number(dispersionDefault.input) >= 0.09 &&
        dispersionDefault.state.dispersion === Number(dispersionDefault.input) &&
        /^0\.0\d\d$/.test(dispersionDefault.out),
      JSON.stringify(dispersionDefault)
    );
    await setControl(page, "render-dispersion", "0", "input");
    await sleep(400);
    const dispersionOff = await page.evaluate(() => ({
      out: document.getElementById("render-dispersion-out").textContent.trim(),
      state: window.__extrude3d.getInfo().render.state
    }));
    check.ok(
      "色散滑到 0 表示关闭且状态同步为 0",
      dispersionOff.state.dispersion === 0 && dispersionOff.out === "0.000",
      JSON.stringify(dispersionOff)
    );
    await setControl(page, "render-dispersion", "0.09", "input");
    await sleep(300);

    /* ---------- 背景：模式 / 校验 / 缩放 / 平移 ---------- */
    const bgModeDefault = await page.$eval("#render-bg-mode", (el) => ({
      value: el.value,
      options: Array.from(el.options).map((o) => o.value)
    }));
    check.ok(
      "背景模式默认纯色且提供 纯色 / 棚拍渐变 / 图片 三种选择",
      bgModeDefault.value === "pure" &&
        ["pure", "studio", "image"].every((v) => bgModeDefault.options.includes(v)),
      `value=${bgModeDefault.value} options=${bgModeDefault.options.join(",")}`
    );

    // 校验：非白名单类型
    await writeFile(FIX.plainText, "not an image at all\n", "utf8");
    const bgInput1 = await page.$("#render-bg-file");
    await bgInput1.uploadFile(FIX.plainText);
    await waitRenderStatus(page, "已拒绝背景图片");
    const bgMimeReject = await page.$eval("#render-status", (n) => n.textContent.trim());
    check.ok("非白名单类型的背景被拒绝并说明原因", /仅支持 PNG/.test(bgMimeReject), bgMimeReject.slice(0, 120));

    // 校验：伪 PNG 解码失败
    await writeFile(FIX.fakePng, "这不是一张真正的 PNG 图片\n", "utf8");
    const bgInput2 = await page.$("#render-bg-file");
    await bgInput2.uploadFile(FIX.fakePng);
    await waitRenderStatus(page, "无法解码");
    const bgDecodeReject = await page.$eval("#render-status", (n) => n.textContent.trim());
    check.ok("无法解码的背景被拒绝并说明原因", /无法解码/.test(bgDecodeReject), bgDecodeReject.slice(0, 120));

    // 有效背景：上传后自动切图片模式，缩放 / 平移真实改变像素
    await uploadVariedBackground(page, sleep);
    const bgApplied = await page.evaluate(() => ({
      mode: window.__extrude3d.getInfo().render.state.bgMode,
      select: document.getElementById("render-bg-mode").value,
      name: document.getElementById("render-bg-name").textContent.trim()
    }));
    check.ok(
      "上传背景图片自动切到图片模式并显示文件名",
      bgApplied.mode === "image" && bgApplied.select === "image" && bgApplied.name.includes("varied-mosaic"),
      JSON.stringify(bgApplied)
    );

    const bgBase = await sampleCanvasShot(page, "#render-canvas", 64);
    const bgBaseBorder = bgBase.ok ? borderStats(bgBase.rgba, 64) : null;
    check.ok(
      "上传后的背景是原图内容而不是白色 fallback（外圈有真实彩色 / 明暗差异）",
      bgBase.ok &&
        bgBaseBorder &&
        bgBaseBorder.meanLuma < 235 &&
        bgBaseBorder.meanLuma > 8 &&
        // 马赛克含红 / 蓝 / 绿 / 品红等色块，必须出现明显色度，纯白或纯黑 fallback 都会是 ~0。
        (bgBaseBorder.meanSpread >= 6 || bgBase.variance >= 120),
      bgBase.ok
        ? `luma=${bgBaseBorder && bgBaseBorder.meanLuma} spread=${bgBaseBorder && bgBaseBorder.meanSpread} variance=${bgBase.variance}`
        : bgBase.reason
    );
    await setControl(page, "render-bg-zoom", "2", "input");
    await sleep(400);
    const bgZoomed = await sampleCanvasShot(page, "#render-canvas", 64);
    const zoomChanged = changedPixels(bgBase.rgba, bgZoomed.rgba);
    check.ok(
      "背景缩放 1× → 2× 真实改变像素",
      bgBase.ok && bgZoomed.ok && zoomChanged > 100,
      bgBase.ok && bgZoomed.ok ? `变化像素=${zoomChanged}` : `取样失败：${bgBase.reason || bgZoomed.reason}`
    );

    await setControl(page, "render-bg-pan-x", "60", "input");
    await sleep(400);
    const bgPanX = await sampleCanvasShot(page, "#render-canvas", 64);
    const panXChanged = changedPixels(bgZoomed.rgba, bgPanX.rgba);
    check.ok(
      "背景横向平移真实改变像素",
      bgZoomed.ok && bgPanX.ok && panXChanged > 100,
      bgZoomed.ok && bgPanX.ok ? `变化像素=${panXChanged}` : `取样失败：${bgZoomed.reason || bgPanX.reason}`
    );

    await setControl(page, "render-bg-pan-y", "-70", "input");
    await sleep(400);
    const bgPanY = await sampleCanvasShot(page, "#render-canvas", 64);
    const panYChanged = changedPixels(bgPanX.rgba, bgPanY.rgba);
    check.ok(
      "背景纵向平移真实改变像素",
      bgPanX.ok && bgPanY.ok && panYChanged > 100,
      bgPanX.ok && bgPanY.ok ? `变化像素=${panYChanged}` : `取样失败：${bgPanX.reason || bgPanY.reason}`
    );

    const bgStateBeforeTransparent = await page.evaluate(() => window.__extrude3d.getInfo().render.state);
    await setControl(page, "render-transparent", true, "change");
    await sleep(200);
    await setControl(page, "render-transparent", false, "change");
    await sleep(400);
    const bgStateAfterTransparent = await page.evaluate(() => window.__extrude3d.getInfo().render.state);
    check.ok(
      "透明背景开关不重置背景裁切位置与缩放",
      bgStateAfterTransparent.bgPanX === bgStateBeforeTransparent.bgPanX &&
        bgStateAfterTransparent.bgPanY === bgStateBeforeTransparent.bgPanY &&
        bgStateAfterTransparent.bgZoom === bgStateBeforeTransparent.bgZoom,
      `pan=${bgStateAfterTransparent.bgPanX}/${bgStateAfterTransparent.bgPanY} zoom=${bgStateAfterTransparent.bgZoom}`
    );

    await page.click("#render-bg-pan-reset");
    await sleep(400);
    const bgReset = await page.evaluate(() => window.__extrude3d.getInfo().render.state);
    check.ok("重置背景位置回到居中（0% / 0%）", bgReset.bgPanX === 0 && bgReset.bgPanY === 0, `${bgReset.bgPanX}/${bgReset.bgPanY}`);

    await setControl(page, "render-bg-zoom", "1", "input");
    await sleep(300);
    const bgNoRoom = await page.$eval("#render-bg-pan-note", (n) => n.textContent.trim());
    check.ok("缩放回 1× 时给出无裁切余量提示", /放大背景后可移动裁切位置/.test(bgNoRoom), bgNoRoom.slice(0, 80));

    // 移除背景回到纯色
    await page.click("#render-bg-remove");
    await sleep(400);
    const bgRemoved = await page.evaluate(() => ({
      mode: window.__extrude3d.getInfo().render.state.bgMode,
      name: document.getElementById("render-bg-name").textContent.trim()
    }));
    check.ok("移除背景后回到纯色模式", bgRemoved.mode === "pure" && bgRemoved.name.includes("未使用"), JSON.stringify(bgRemoved));

    // 切回建模页签不丢几何参数
    await page.click("#tab-model");
    await sleep(400);
    const backToModel = await page.evaluate(() => ({
      tab: window.__extrude3d.getInfo().tab,
      name: document.getElementById("svg-name").textContent.trim(),
      state: window.__extrude3d.getState(),
      verts: window.__extrude3d.getInfo().modeling.vertexCount
    }));
    check.ok(
      "切回建模页签保留 SVG / 厚度 / 倒角参数与几何",
      backToModel.tab === "model" &&
        backToModel.name.includes("hex-nest.svg") &&
        backToModel.state.depth === 42 &&
        backToModel.state.bevelSize === 4 &&
        backToModel.state.bevelThickness === 3 &&
        backToModel.verts > 0,
      `name=${backToModel.name} depth=${backToModel.state.depth} verts=${backToModel.verts}`
    );
  }

  /* ================================================ 全局边界 */

  check.ok("无跨源请求", external.length === 0, external.slice(0, 4).join(" | "));
  check.ok("无 console 错误", page.errors.length === 0, page.errors.slice(0, 4).join(" | "));
}
