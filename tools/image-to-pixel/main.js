/**
 * imageLAB · 工具③「像素化与抖动」
 * 页面：tools/image-to-pixel/index.html
 *
 * ── 上游来源与许可 ────────────────────────────────────────────────────────────
 * 算法库本体：Tezumie / Image-to-Pixel 的 image-to-pixel.js
 *   仓库：https://github.com/Tezumie/Image-to-Pixel
 *   commit：b0d5b7422db309dae22c2a69d4ebca0ce8c14b78
 *   许可：MIT（原文见 ./LICENSE-library.txt；注意 MIT 文件里的版权人字段仍是上游占位符
 *         "[YEAR] [YOUR NAME]"，这是上游瑕疵，本工具不做改写）
 *   文件：./vendor/image-to-pixel.js —— 逐字节复制，未做任何修改
 *         sha256 7f0952ba6ce608b5bffdf030ebb7a7e45782e5093c044da74ba20608400f22dd，19059 字节
 *   API（以 vendor 源码为准）：pixelate({ image, width, dither, strength, palette, resolution })
 *         → Promise<HTMLCanvasElement>；strength 取 0–100（源码内 `strength / 100` 归一化）；
 *         dither ∈ none | Floyd-Steinberg | atkinson | 2x2 Bayer | 4x4 Bayer | ordered | Clustered 4x4；
 *         resolution ∈ pixel | original。
 *
 * 上游的「应用部分」（index.html / css / src / LICENSE-app.txt，Apache-2.0）一律没有搬运，
 * 本文件与 index.html / style.css 是 imageLAB 自建的最小外壳，不含上游 UI 代码。
 *
 * ── 远程请求 ─────────────────────────────────────────────────────────────────
 * 上游库在 palette 传「字符串 slug」时，会去 lospec 拉 palette-list/<slug>.json（见 vendor 的 fetchPalette）。
 * 本工具彻底切断这条路径：PALETTES 里全部是本地颜色数组，调用库时再加一道 Array.isArray 断言，
 * 因此字符串分支不可达，运行期零远程请求（见 README.md 与本目录测试规格）。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* 库本体以「原文」方式引入：?raw 拿到的就是 vendor 文件字节，再作为经典脚本注入，
   这样 vendor 文件保持逐字节不变（没有为了 export 而改写），同时 dev / build 行为一致。 */
import vendorSource from "./vendor/image-to-pixel.js?raw";
import sampleUrl from "./assets/sample.png";

/** vendor/image-to-pixel.js 的字节数（完整性自检用，与 sha256 一起记录在上方注释）。 */
const VENDOR_BYTES = 19059;

/** 上传图任一边超过该值就先等比缩小再处理，避免大图卡死。 */
const MAX_SIDE = 4000;

/** 输出像素宽度的允许范围（与 index.html 的 min/max 保持一致）。 */
const WIDTH_MIN = 8;
const WIDTH_MAX = 512;

/**
 * 抖动方式：value 必须与 vendor/image-to-pixel.js 内部比较的字符串完全一致
 * （源码 87–105 行，以及上游 index.html 的 <select id="dithering">）。
 */
const DITHERS = [
  { value: "none", label: "None · 仅调色板量化" },
  { value: "Floyd-Steinberg", label: "Floyd-Steinberg · 误差扩散" },
  { value: "atkinson", label: "Atkinson · 误差扩散" },
  { value: "2x2 Bayer", label: "2x2 Bayer · 有序" },
  { value: "4x4 Bayer", label: "4x4 Bayer · 有序" },
  { value: "ordered", label: "Ordered 8x8 · 有序" },
  { value: "Clustered 4x4", label: "Clustered 4x4 · 有序" }
];

/**
 * 调色板：**全部是本地颜色数组常量**，不出现任何 Lospec slug / URL。
 * 传库时永远是数组，库内 `Array.isArray(palette)` 分支走 hexToRgb，字符串分支不会被触达。
 */
const PALETTES = {
  "bw-2": {
    label: "2 色 · 黑白",
    colors: ["#000000", "#ffffff"]
  },
  "gray-4": {
    label: "4 色 · 灰阶",
    colors: ["#000000", "#555555", "#aaaaaa", "#ffffff"]
  },
  "gray-8": {
    label: "8 色 · 灰阶",
    colors: ["#000000", "#242424", "#494949", "#6d6d6d", "#929292", "#b6b6b6", "#dbdbdb", "#ffffff"]
  },
  "gameboy-4": {
    label: "4 色 · Game Boy DMG",
    colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]
  },
  "sepia-6": {
    label: "6 色 · 复古暖褐",
    colors: ["#2b1b12", "#4a3424", "#6e4f32", "#9a7550", "#c8a47c", "#efe0c8"]
  },
  "pico8-16": {
    label: "16 色 · PICO-8",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751",
      "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436",
      "#29adff", "#83769c", "#ff77a8", "#ffccaa"
    ]
  }
};

const DEFAULT_PALETTE = "gameboy-4";

/* ── DOM ─────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const els = {
  file: $("file"),
  useSample: $("use-sample"),
  width: $("width"),
  widthNum: $("width-num"),
  widthOut: $("width-out"),
  dither: $("dither"),
  strength: $("strength"),
  strengthOut: $("strength-out"),
  palette: $("palette"),
  resolution: $("resolution"),
  exportBtn: $("export-png"),
  hint: $("hint"),
  preview: $("preview"),
  stats: $("stats"),
  foot: $("foot")
};

/* ── 状态 ────────────────────────────────────────────────────────────── */
/** 归一化后的源画布（已做 >MAX_SIDE 的等比缩小），库接受 HTMLCanvasElement。 */
let sourceCanvas = null;
/** 源图信息，用于界面提示与诊断。 */
let sourceInfo = { name: "", width: 0, height: 0, scaled: false };
/** 最近一次成功渲染的输出画布。 */
let outputCanvas = null;
/** 库是否已就绪（经典脚本注入成功且 window.pixelate 可用）。 */
let vendorReady = false;
let vendorError = null;

let renderSeq = 0;
let renderTimer = null;
let renderInFlight = null;

/* ── 启动就绪信号 ────────────────────────────────────────────────────── */
/**
 * 诊断与测试需要一个**明确的「初始化完成」时点**：window.__imageToPixel 是在
 * 库载入之前就挂上去的（为了让错误也能被读到），所以只要它存在就取样会踩到竞态。
 * 这里用 ready Promise + <html data-imagelab-ready> 双重信号，二者都在
 * 「库已载入、示例图已渲染（或已明确失败）」之后才落地。
 */
let markReady;
const readyPromise = new Promise((resolve) => {
  markReady = resolve;
});
let bootResult = null;

function finishBoot(result) {
  if (bootResult) return bootResult;
  bootResult = result;
  document.documentElement.setAttribute("data-imagelab-ready", result && result.ok ? "1" : "0");
  if (window.__imageToPixel) window.__imageToPixel.result = result;
  markReady(result);
  return result;
}

/** 绑定事件：元素缺失时安静跳过，绝不抛出未捕获异常。 */
function on(el, type, handler) {
  if (!el) {
    console.warn("[image-to-pixel] 缺少控件，已跳过绑定：", type);
    return;
  }
  el.addEventListener(type, handler);
}

/* ── 界面初始化 ──────────────────────────────────────────────────────── */

function fillSelects() {
  for (const d of DITHERS) {
    const o = document.createElement("option");
    o.value = d.value;
    o.textContent = d.label;
    els.dither.appendChild(o);
  }
  els.dither.value = "Floyd-Steinberg";

  for (const [key, p] of Object.entries(PALETTES)) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = `${p.label} · ${p.colors.length} 色`;
    els.palette.appendChild(o);
  }
  els.palette.value = DEFAULT_PALETTE;
}

function clampWidth(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return Number(els.width.value) || 160;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n));
}

function setHint(text, kind = "info") {
  els.hint.textContent = text;
  if (kind === "info") els.hint.removeAttribute("data-kind");
  else els.hint.setAttribute("data-kind", kind);
}

function setStats(text) {
  els.stats.textContent = text;
}

function setBusy(busy) {
  els.exportBtn.disabled = !!busy || !outputCanvas;
}

/* ── 库加载：把 vendor 原文作为经典脚本注入，函数声明进入全局作用域 ─────── */

function loadVendor() {
  if (typeof window.pixelate === "function") {
    vendorReady = true;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (vendorSource.length !== VENDOR_BYTES) {
      reject(new Error(`vendor/image-to-pixel.js 字节数异常：${vendorSource.length} ≠ ${VENDOR_BYTES}`));
      return;
    }
    const blobUrl = URL.createObjectURL(new Blob([vendorSource], { type: "text/javascript" }));
    const s = document.createElement("script");
    s.src = blobUrl;
    s.async = false;
    s.dataset.imagelabVendor = "image-to-pixel";
    s.onload = () => {
      URL.revokeObjectURL(blobUrl);
      if (typeof window.pixelate === "function") {
        vendorReady = true;
        resolve();
      } else {
        reject(new Error("vendor 已载入但未定义 window.pixelate"));
      }
    };
    s.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("无法载入 vendor/image-to-pixel.js"));
    };
    document.head.appendChild(s);
  });
}

/* ── 源图载入 ────────────────────────────────────────────────────────── */

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = url;
  });
}

/**
 * 把任意图片等比缩放到 MAX_SIDE 以内并落到一块源画布上。
 * 之后一律以画布作为库的输入，尺寸确定、也便于大图保护。
 */
function normalizeSource(img, name) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("图片尺寸为 0");

  let tw = w;
  let th = h;
  let scaled = false;
  const longSide = Math.max(w, h);
  if (longSide > MAX_SIDE) {
    const k = MAX_SIDE / longSide;
    tw = Math.max(1, Math.round(w * k));
    th = Math.max(1, Math.round(h * k));
    scaled = true;
  }

  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, tw, th);

  sourceCanvas = c;
  sourceInfo = { name, width: tw, height: th, origWidth: w, origHeight: h, scaled };

  setHint(
    scaled
      ? `原图 ${w}×${h} 超过单边 ${MAX_SIDE}px 上限，已等比缩小到 ${tw}×${th} 再处理（画布与导出均按缩小后的尺寸）。`
      : `已载入 ${name}：${tw}×${th}。图片只在本地内存中处理。`,
    scaled ? "warn" : "info"
  );
  return sourceInfo;
}

/**
 * 库在「输入是 canvas 且尺寸恰好等于目标像素尺寸」时会直接复用输入画布并就地写回，
 * 那会污染我们的源画布；这种巧合下传一份拷贝。
 */
function imageForRender(pixelWidth) {
  if (sourceCanvas.width !== pixelWidth) return sourceCanvas;
  const copy = document.createElement("canvas");
  copy.width = sourceCanvas.width;
  copy.height = sourceCanvas.height;
  copy.getContext("2d").drawImage(sourceCanvas, 0, 0);
  return copy;
}

/* ── 渲染 ────────────────────────────────────────────────────────────── */

async function render() {
  if (!vendorReady || !sourceCanvas) return null;

  const mySeq = renderSeq;
  const width = clampWidth(els.width.value);
  const dither = els.dither.value;
  const strength = Number(els.strength.value);
  const paletteKey = els.palette.value;
  const resolution = els.resolution.value;

  const paletteEntry = PALETTES[paletteKey];
  const palette = paletteEntry && paletteEntry.colors;

  // 硬性保证：传给库的 palette 永远是数组，字符串（Lospec slug / URL）分支不可达。
  if (!Array.isArray(palette) || palette.length === 0) {
    setHint(`调色板 "${paletteKey}" 不是数组，已拒绝渲染（不会触发任何远程取色）。`, "error");
    return null;
  }

  setBusy(true);
  setStats("渲染中…");
  try {
    const t0 = performance.now();
    const out = await window.pixelate({
      image: imageForRender(width),
      width,
      dither,
      strength: Number.isFinite(strength) ? strength : 100,
      palette, // ← 永远是数组
      resolution
    });
    const ms = performance.now() - t0;

    // 已经发了更新的渲染请求：丢弃这次结果，避免旧图覆盖新图。
    if (mySeq !== renderSeq) return out;

    outputCanvas = out;

    const holder = document.createElement("div");
    holder.className = "il-canvas-holder";
    holder.appendChild(out);
    els.preview.replaceChildren(holder);

    const label = paletteEntry.label;
    setStats(
      `输出 ${out.width}×${out.height} px · 输入像素宽 ${width} · ${dither} · 强度 ${strength} · ${label} · ${ms.toFixed(0)} ms`
    );
    if (!sourceInfo.scaled) setHint(`已生成：像素宽 ${width}px，输出画布 ${out.width}×${out.height}。`, "info");

    window.__imageToPixel.last = {
      seq: renderSeq,
      width,
      outWidth: out.width,
      outHeight: out.height,
      dither,
      strength,
      paletteKey,
      paletteIsArray: Array.isArray(palette),
      paletteSize: palette.length,
      resolution,
      ms: +ms.toFixed(1),
      at: Date.now()
    };
    return out;
  } catch (err) {
    if (mySeq !== renderSeq) return null;
    setStats("渲染失败");
    setHint(`渲染失败：${err && err.message ? err.message : String(err)}`, "error");
    window.__imageToPixel.error = String(err && err.message ? err.message : err);
    return null;
  } finally {
    if (mySeq === renderSeq) setBusy(false);
  }
}

/** 请求一次渲染（带防抖），返回等待中的 promise。 */
function requestRender(delay = 50) {
  if (renderTimer !== null) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderSeq += 1;
    renderInFlight = render().finally(() => {
      renderInFlight = null;
    });
  }, delay);
  return renderInFlight || Promise.resolve();
}

/** 等待「没有待触发的防抖 + 没有在飞渲染」。供测试与诊断使用。 */
async function settled() {
  for (let i = 0; i < 900; i++) {
    if (renderTimer === null && !renderInFlight) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

/* ── 导出 ────────────────────────────────────────────────────────────── */

function triggerDownload(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportPng() {
  const out = outputCanvas;
  if (!out) {
    setHint("还没有可导出的输出，请先选择图片或调整参数。", "warn");
    return;
  }
  const name = `image-to-pixel-${out.width}px.png`;

  const fallback = () => {
    try {
      triggerDownload(out.toDataURL("image/png"), name);
      setHint(`已导出 ${name}（toDataURL 兜底路径）。`, "info");
    } catch (e) {
      setHint(`导出失败：${e && e.message ? e.message : String(e)}`, "error");
    }
  };

  if (typeof out.toBlob === "function") {
    out.toBlob((blob) => {
      if (!blob || !blob.size) {
        fallback();
        return;
      }
      const url = URL.createObjectURL(blob);
      triggerDownload(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      setHint(`已导出 ${name}（${(blob.size / 1024).toFixed(0)} KB）。`, "info");
    }, "image/png");
  } else {
    fallback();
  }
}

/* ── 事件绑定 ────────────────────────────────────────────────────────── */

function bindEvents() {
  on(els.file, "change", async () => {
    const f = els.file.files && els.file.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImageElement(url);
      normalizeSource(img, f.name);
      await renderNow();
    } catch (e) {
      setHint(`无法读取该文件：${e && e.message ? e.message : String(e)}`, "error");
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  on(els.useSample, "click", async () => {
    try {
      const img = await loadImageElement(sampleUrl);
      normalizeSource(img, "assets/sample.png（本地测试图）");
      await renderNow();
    } catch (e) {
      setHint(`示例图载入失败：${e && e.message ? e.message : String(e)}`, "error");
    }
  });

  on(els.width, "input", () => {
    const w = clampWidth(els.width.value);
    if (els.widthNum) els.widthNum.value = String(w);
    if (els.widthOut) els.widthOut.textContent = String(w);
    requestRender();
  });

  on(els.widthNum, "input", () => {
    const w = clampWidth(els.widthNum.value);
    if (els.width) els.width.value = String(w);
    if (els.widthOut) els.widthOut.textContent = String(w);
    requestRender();
  });

  on(els.dither, "change", () => requestRender(0));
  on(els.palette, "change", () => requestRender(0));
  on(els.resolution, "change", () => requestRender(0));

  on(els.strength, "input", () => {
    if (els.strengthOut) els.strengthOut.textContent = String(els.strength.value);
    requestRender();
  });

  on(els.exportBtn, "click", exportPng);
}

/** 立即渲染并等待完成（首次载入 / 换图时用）。 */
async function renderNow() {
  if (renderTimer !== null) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  renderSeq += 1;
  renderInFlight = render().finally(() => {
    renderInFlight = null;
  });
  await renderInFlight;
  return outputCanvas;
}

/* ── 诊断面（测试用，不是公共 API） ──────────────────────────────────── */

function installDiagnostics() {
  window.__imageToPixel = {
    version: 1,
    vendorBytes: VENDOR_BYTES,
    loadedVendorBytes: vendorSource.length,
    maxSide: MAX_SIDE,
    widthRange: [WIDTH_MIN, WIDTH_MAX],
    dithers: DITHERS.map((d) => d.value),
    /** 调色板注册表：全部必须是数组（测试据此断言不存在 slug / URL）。 */
    palettes: Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, v.colors])),
    paletteLabels: Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, v.label])),
    isVendorReady: () => vendorReady,
    /** 启动完成信号：resolve 后 last / 画布 / vendor 状态才可靠。 */
    ready: readyPromise,
    isReady: () => bootResult !== null,
    result: null,
    source: () => ({ ...sourceInfo, canvasWidth: sourceCanvas ? sourceCanvas.width : 0 }),
    last: null,
    error: null,
    settled,
    /** 直接把一张画布/图片作为源（供大图保护等分支的诊断）。 */
    setSource: async (canvas, name = "diagnostic") => {
      normalizeSource(canvas, name);
      await renderNow();
      return window.__imageToPixel.source();
    },
    render: renderNow
  };
}

/* ── 启动 ────────────────────────────────────────────────────────────── */

async function boot() {
  installDiagnostics();
  fillSelects();
  if (els.widthOut && els.width) els.widthOut.textContent = els.width.value;
  if (els.strengthOut && els.strength) els.strengthOut.textContent = els.strength.value;
  bindEvents();
  setBusy(true);
  setHint("正在载入像素化库（本地文件，无远程请求）…", "info");

  try {
    await loadVendor();
  } catch (e) {
    vendorError = String((e && e.message) || e);
    window.__imageToPixel.error = vendorError;
    setStats("库载入失败");
    setHint(`像素化库载入失败：${vendorError}`, "error");
    if (els.preview) {
      els.preview.replaceChildren(Object.assign(document.createElement("p"), {
        className: "il-placeholder",
        textContent: "像素化库载入失败，页面无法工作。"
      }));
    }
    setBusy(false);
    finishBoot({ ok: false, stage: "vendor", error: vendorError });
    return;
  }

  try {
    const img = await loadImageElement(sampleUrl);
    normalizeSource(img, "assets/sample.png（本地测试图，来自 tests/fixtures/test-photo.png）");
    await renderNow();
    finishBoot({ ok: true, sample: true });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    setHint(`示例图载入失败：${msg}`, "error");
    setStats("缺少输入图片");
    if (els.preview) {
      els.preview.replaceChildren(Object.assign(document.createElement("p"), {
        className: "il-placeholder",
        textContent: "请选择一张本地图片开始。"
      }));
    }
    setBusy(false);
    // 库是好的，只是默认示例图没载入：页面仍可正常上传使用，因此 ok 仍为 true
    finishBoot({ ok: true, sample: false, error: msg });
  }
}

boot().catch((e) => {
  const msg = e && e.message ? e.message : String(e);
  window.__imageToPixel.error = msg;
  setStats("发生未预期错误");
  setHint(`初始化失败：${msg}`, "error");
  setBusy(false);
  finishBoot({ ok: false, stage: "boot", error: msg });
});
