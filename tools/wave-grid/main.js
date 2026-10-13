/*
 * tools/wave-grid · 波动点阵
 *
 * 原生 Canvas 2D 生成器（不引入任何着色器 / 第三方运行时代码）：
 * 在深色底上按网格铺发光单元，每个单元的亮度来自多组正弦波叠加，
 * 从而得到「逐行流动 + 轻微纵深」的观感；可把文字或本地图片采样成点阵亮度。
 *
 * 约定：
 * - 网格单元数硬上限 20000，画布边长上限约 1600，避免超大网格拖慢页面；
 * - 时间只在未暂停时推进，暂停后画面就是导出用的那一帧；
 * - 波浪相位 / 配色只由「参数 + 种子」决定，暂停状态下改参数也得到确定的一帧。
 * - 图片只在浏览器本地解码（≤10 MiB、单边 ≤4096），失败时保留上一张有效图片。
 */

const MAX_CELLS = 20000;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_CANVAS_SIDE = 1600;
const BG = "#05070c";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const state = {
  density: 0.55,
  amp: 0.6,
  speed: 1,
  glow: 0.55,
  shape: "squares",
  preset: "multi",
  text: "",
  seed: 7654321
};

const canvas = $("wave-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const glowCanvas = document.createElement("canvas");
const glowCtx = glowCanvas.getContext("2d");

let grid = { cols: 0, rows: 0, count: 0, cellW: 1, cellH: 1 };
let mask = null;
let imageData = null;
let imageSource = null;
let loadToken = 0;

let paused = false;
let time = 0;
let lastTs = null;
let dirty = true;
let raf = 0;

function setStatus(message) {
  const el = $("status");
  if (el) el.textContent = message;
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/* ------------------------------------------------------------ 网格与采样 */

function layoutCanvas() {
  const stage = $("stage");
  const cssW = clamp(stage.clientWidth || 960, 240, 1400);
  const cssH = Math.max(160, Math.round(cssW * 0.625));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.max(0.5, Math.min(dpr, MAX_CANVAS_SIDE / cssW, MAX_CANVAS_SIDE / cssH));

  const pw = Math.round(cssW * scale);
  const ph = Math.round(cssH * scale);
  canvas.width = pw;
  canvas.height = ph;
  if (glowCanvas.width !== pw || glowCanvas.height !== ph) {
    glowCanvas.width = pw;
    glowCanvas.height = ph;
  }

  let cell = 22 - state.density * 15;
  let cols = Math.max(6, Math.floor(cssW / cell));
  let rows = Math.max(4, Math.floor(cssH / cell));
  while (cols * rows > MAX_CELLS) {
    cell += 1;
    cols = Math.max(6, Math.floor(cssW / cell));
    rows = Math.max(4, Math.floor(cssH / cell));
  }
  grid = { cols, rows, count: cols * rows, cellW: pw / cols, cellH: ph / rows };

  mask = sampleText();
  if (imageSource) sampleImage(imageSource);
  dirty = true;
  updateStatus();
}

function sampleText() {
  const text = state.text.trim();
  if (!text) return null;
  const { cols, rows } = grid;
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#000000";
  x.fillRect(0, 0, cols, rows);
  x.fillStyle = "#ffffff";
  x.textAlign = "center";
  x.textBaseline = "middle";
  const family = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  let size = rows * 0.84;
  x.font = `bold ${size}px ${family}`;
  const width = x.measureText(text).width || 1;
  const maxW = cols * 0.94;
  if (width > maxW) {
    size *= maxW / width;
    x.font = `bold ${size}px ${family}`;
  }
  x.fillText(text, cols / 2, rows / 2);
  const d = x.getImageData(0, 0, cols, rows).data;
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

function sampleImage(img) {
  const { cols, rows } = grid;
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#000000";
  x.fillRect(0, 0, cols, rows);
  const s = Math.max(cols / img.naturalWidth, rows / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  x.drawImage(img, (cols - w) / 2, (rows - h) / 2, w, h);
  const d = x.getImageData(0, 0, cols, rows).data;
  const n = cols * rows;
  const bright = new Float32Array(n);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const rr = d[o];
    const gg = d[o + 1];
    const bb = d[o + 2];
    r[i] = rr;
    g[i] = gg;
    b[i] = bb;
    bright[i] = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255;
  }
  imageData = { bright, r, g, b };
}

/* ---------------------------------------------------------------- 渲染 */

function draw() {
  const pw = canvas.width;
  const ph = canvas.height;
  const { cols, rows, cellW, cellH } = grid;
  if (!cols || !rows) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, pw, ph);

  const t = time;
  const contrast = 0.35 + state.amp * 1.5;
  const seedPhase = ((state.seed % 997) / 997) * Math.PI * 2;
  const useImg = !!imageData;
  const useMask = !!mask && !useImg;
  const shape = state.shape;
  const preset = state.preset;
  const cellMin = Math.min(cellW, cellH);

  if (shape === "chars") {
    ctx.font = `${Math.round(cellH * 0.94)}px ui-monospace, "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  for (let y = 0; y < rows; y++) {
    const cy = y * cellH;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let v =
        0.5 +
        0.5 * Math.sin(t * 1.15 + x * 0.55 + y * 0.34 + seedPhase) +
        0.32 * Math.sin(t * 0.82 - x * 0.31 + y * 0.47 + seedPhase * 1.7) +
        0.18 * Math.sin((x + y) * 0.24 + t * 1.9);
      v = clamp(v / 1.5, 0, 1);
      v = clamp(0.5 + (v - 0.5) * contrast, 0, 1);

      if (useMask) v = mask[i] * (0.32 + 0.68 * v);
      if (useImg) v = imageData.bright[i] * (0.38 + 0.62 * v);
      v = clamp(v, 0, 1);

      let r;
      let g;
      let b;
      if (useImg) {
        const k = 0.22 + 0.82 * v;
        r = imageData.r[i] * k;
        g = imageData.g[i] * k;
        b = imageData.b[i] * k;
      } else if (preset === "mono") {
        const c = Math.round(30 + v * 222);
        r = g = b = c;
      } else if (preset === "cool") {
        const hue = 208 - v * 82 + 16 * Math.sin(x * 0.12 + y * 0.08 + t * 0.6);
        [r, g, b] = hslToRgb(hue, 0.82, 0.16 + v * 0.5);
      } else {
        const hue = x * 6.2 + y * 8.6 + state.seed * 0.7 + t * 26;
        [r, g, b] = hslToRgb(hue, 0.8, 0.18 + v * 0.52);
      }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;

      if (shape === "dots") {
        const rad = cellMin * 0.36 * (0.5 + v * 0.5);
        ctx.beginPath();
        ctx.arc((x + 0.5) * cellW, (y + 0.5) * cellH, Math.max(0.4, rad), 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === "chars") {
        const chars = " .:-=+*#%@";
        const ch = chars[Math.min(chars.length - 1, Math.floor(v * chars.length))];
        ctx.fillText(ch, (x + 0.5) * cellW, (y + 0.5) * cellH);
      } else {
        const s = Math.max(1, cellW * (0.42 + v * 0.5));
        const sh = Math.max(1, cellH * (0.42 + v * 0.5));
        ctx.fillRect(x * cellW + (cellW - s) / 2, y * cellH + (cellH - sh) / 2, s, sh);
      }
    }
  }

  if (state.glow > 0.02) {
    glowCtx.setTransform(1, 0, 0, 1, 0, 0);
    glowCtx.globalCompositeOperation = "copy";
    glowCtx.filter = "none";
    glowCtx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(0.9, state.glow * 0.95);
    ctx.filter = `blur(${Math.max(2, cellMin * 0.55)}px)`;
    ctx.drawImage(glowCanvas, 0, 0);
    ctx.restore();
  }
}

function updateStatus() {
  const shapeName = { squares: "方块", dots: "圆点", chars: "字符" }[state.shape] || state.shape;
  const presetName = { mono: "单色", cool: "冷色", multi: "多彩" }[state.preset] || state.preset;
  const source = imageData ? "图片采样" : mask ? "文字采样" : "纯波浪";
  $("seed-label").textContent = String(state.seed);
  setStatus(
    `${grid.cols}×${grid.rows} = ${grid.count} 个单元 · ${shapeName} · ${presetName} · ${source} · ${paused ? "已暂停" : "运行中"}`
  );
}

function loop(ts) {
  raf = requestAnimationFrame(loop);
  if (lastTs == null) lastTs = ts;
  const dt = Math.min(64, ts - lastTs);
  lastTs = ts;
  if (!paused) {
    time += dt * 0.001 * state.speed;
    dirty = true;
  }
  if (dirty) {
    draw();
    dirty = false;
  }
}

/* ---------------------------------------------------------------- 控件 */

function bindRange(id, key, { integer = false } = {}) {
  const range = $("p-" + id);
  const number = $("n-" + id);
  const apply = (raw) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = state[key];
    v = integer ? Math.round(v) : v;
    v = clamp(v, Number(range.min), Number(range.max));
    state[key] = v;
    range.value = String(v);
    number.value = String(v);
    if (key === "density") layoutCanvas();
    else {
      updateStatus();
      dirty = true;
    }
  };
  range.addEventListener("input", () => apply(range.value));
  number.addEventListener("input", () => apply(number.value));
  number.addEventListener("change", () => apply(number.value));
}

function bindChips(containerId, attribute, key, after) {
  const host = $(containerId);
  if (!host) return;
  host.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-" + attribute + "]");
    if (!btn || !host.contains(btn)) return;
    state[key] = btn.dataset[attribute];
    for (const b of host.querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b === btn));
    }
    if (after) after();
    updateStatus();
    dirty = true;
  });
}

function onFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    setStatus("只支持 PNG / JPEG / WebP，已保留当前图片。");
    return;
  }
  if (file.size > MAX_FILE) {
    setStatus("图片超过 10 MiB，已保留当前图片。");
    return;
  }
  const token = ++loadToken;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    if (token !== loadToken) return;
    if (img.naturalWidth > MAX_SIDE || img.naturalHeight > MAX_SIDE) {
      setStatus("图片单边超过 4096 像素，已保留当前图片。");
      return;
    }
    imageSource = img;
    sampleImage(img);
    $("image-clear").hidden = false;
    $("image-name").textContent = `已载入 ${file.name}（${img.naturalWidth}×${img.naturalHeight}）`;
    dirty = true;
    updateStatus();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (token !== loadToken) return;
    setStatus("图片解码失败，已保留当前图片。");
  };
  img.src = url;
}

function boot() {
  bindRange("density", "density");
  bindRange("amp", "amp");
  bindRange("speed", "speed");
  bindRange("glow", "glow");

  bindChips("shape-chips", "shape", "shape");
  bindChips("preset-chips", "preset", "preset");

  $("mask-text").addEventListener("input", (e) => {
    state.text = e.target.value.slice(0, 24);
    mask = sampleText();
    dirty = true;
    updateStatus();
  });

  $("image-file").addEventListener("change", (e) => {
    onFile(e.target.files && e.target.files[0]);
  });
  $("image-clear").addEventListener("click", () => {
    loadToken++;
    imageSource = null;
    imageData = null;
    $("image-file").value = "";
    $("image-clear").hidden = true;
    $("image-name").textContent = "未选择图片。";
    dirty = true;
    updateStatus();
  });

  $("btn-pause").addEventListener("click", () => {
    paused = true;
    updateStatus();
  });
  $("btn-play").addEventListener("click", () => {
    paused = false;
    lastTs = null;
    dirty = true;
    updateStatus();
  });
  $("btn-reroll").addEventListener("click", () => {
    state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
    dirty = true;
    updateStatus();
  });
  $("btn-export").addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wave-grid-${state.seed}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  });

  layoutCanvas();
  draw();
  raf = requestAnimationFrame(loop);

  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => layoutCanvas());
    ro.observe($("stage"));
  } else {
    window.addEventListener("resize", () => layoutCanvas());
  }
}

/* 测试 / 验收钩子：只读状态 + 当前画布快照。 */
window.imagelab = {
  ready: false,
  paused: () => paused,
  seed: () => state.seed,
  frame: () => time,
  cells: () => grid.count,
  shape: () => state.shape,
  preset: () => state.preset,
  hasImage: () => !!imageData,
  snapshot: () => canvas.toDataURL("image/png")
};

boot();
window.imagelab.ready = true;
