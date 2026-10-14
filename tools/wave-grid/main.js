/*
 * 辉光点阵 · 固定字符网格上的宽厚分段辉光色带（imageLAB 自有代码）
 *
 * 形态与渲染管线参考 basementstudio/shader-lab（Apache-2.0，
 * pin 6f39a889db74978d93d882643e3cd2073b3666d6）：
 *   - src/renderer/directional-blur-pass.ts：有限方向取样（MAX_SAMPLES=16，
 *     角度与长度分离）→ 本文件改编为 Canvas 低分辨率缓冲上的 8 次位移 drawImage；
 *   - src/renderer/dual-filter-bloom.ts：逐级缩小 / 放大的 bloom → 本文件改编为
 *     1/8 与 1/16 两级低分辨率黑底不透明 RGB 缓冲的模糊叠加；
 *   - src/renderer/particle-grid-pass.ts：按格采样 + 阈值字形 + 低分辨率缓冲复用。
 * 只做 Canvas 2D 等效适配，未搬运其 TSL/WGSL 源码，也未接入 Next/React 编辑器。
 * 许可原文见 third-party-licenses/basementstudio-shader-lab-LICENSE.txt。
 *
 * 噪声复用仓库已锁定的 three@0.186.1 自带 addons（MIT）：
 * three/addons/math/SimplexNoise.js，仅在每次布局时按格预计算，逐帧零噪声调用。
 */
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { BAND_COLORS, CORE_COLOR, clamp01, nextGlyph, sampleGlow } from "./field.js";
import { mountCategoryTabs } from "../../assets/workspace.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const MAX_CELLS = 12000;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_CANVAS = 1600;
const MAX_CSS_WIDTH = 720;
const ASPECT = 900 / 720;
// 统一工作台把桌面画布改为按 100dvh 可用高度定宽（1440×960 下约 580×725），
// 而改版前是 max-width 720 的 720×900。辉光长度是固定 CSS px，画布变小会让 72px 辉光
// 的相对占比变大、黑留白跌破旧阈值。这里把「桌面显示尺寸」与「内部渲染基准」解耦：
// 断点与 workspace.css 的 1000px 一致，桌面固定按 720 宽基准排点 / 渲染，再由 CSS 等比
// 缩到显示尺寸，保持改版前的辉光 / 黑留白比例；小屏仍按真实宽度渲染。
const DESKTOP_RENDER_QUERY = "(min-width: 1000px)";
const GLYPHS = ["", "\u00d7", "\u25a1", "\u25a0"];

// 密度 → 网格间距（CSS px）。0 最粗、1 最细，等比且单调；默认 0.55 ≈ 9px。
const SPACING_COARSE = 13.5;
const SPACING_FINE = 7.4;
const DENSITY_GAMMA = 0.51;

// 低分辨率缓存：块缓冲 / 圆形 bloom / 更宽的柔光 / 方向拉丝。
const BLOCK_DIVISOR = 4;
const BLOOM_DIVISOR = 8;
const WIDE_DIVISOR = 16;
const STREAK_SAMPLES = 8;
const PALETTE_STEPS = 8;

// 默认辉光统一增益：只对「已与黑底混合、RGB 携带能量」的辉光缓存在模糊之后曝光一次
// （最终 ctx 的宽柔光 / bloom / 光丝三个 lighter 整帧 drawImage 共享同一 brightness(3.6)），
// 不加控件，强度 0 仍严格关闭辉光。关键：增益既不能乘进最终合成 alpha，也不能在透明缓存上做
// brightness——Skia 对透明缓存会先解预乘：饱和主色（如 #ed58ff 的 237/88/255）×3.6 后每通道
// 都截到 1，bloom 被冲成灰白。改为 alpha:false 黑底不透明缓存，先把「主色 × 字形 opacity」存成
// 真实 RGB 能量再 blur / 降采样，模糊后的低亮 RGB ×3.6 仍落在 0..1 内、色相保留，只有高亮核心
// 才会逐通道饱和；黑色 RGB0 在 lighter 合成中不抬黑、不盖画面。最终 alpha 仍 glow^0.8
// （默认 0.55 → α≈0.62），α(1)=1 且全程严格递增，既不 clamp 也与「明亮默认」等效能量对齐。
const GLOW_GAIN = 3.6;
const GLOW_ALPHA = 0.8;

const sample = { value: 0, band: -1, color: CORE_COLOR, glowColor: CORE_COLOR };
const fieldOpts = { amp: 0.6, bandWidth: 1 };

const state = {
  preset: "ribbons",
  density: 0.55,
  amp: 0.6,
  speed: 1,
  glow: 0.55,
  glowLength: 72,
  glowAngle: 90,
  bandWidth: 1,
  text: "",
  seed: 7654321
};

const canvas = $("wave-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const sharpCanvas = document.createElement("canvas");
const sharpCtx = sharpCanvas.getContext("2d");
// 辉光缓存统一用黑底不透明 RGB（alpha:false）承载「辐射量」：饱和主色先按字形 opacity 与黑底
// 混合成真实 RGB 能量，再 blur / 降采样（与 ShaderLab DirectionalBlurPass 输出 vec4(rgb,1) 一致）。
// 固定曝光 brightness(3.6) 只在模糊之后于最终 ctx 的 lighter 合成施加一次，缓存源 Alpha=1
// 使低亮 RGB 获得真实增益且色相保留，只有高亮核心会饱和。清晰层 sharpCanvas 仍保持透明
// （默认 alpha:true），最终 canvas 仍黑底不透明，原图片 alpha 采样与几何 / 种子均不变。
const blockCanvas = document.createElement("canvas");
const blockCtx = blockCanvas.getContext("2d", { alpha: false });
const streakCanvas = document.createElement("canvas");
const streakCtx = streakCanvas.getContext("2d", { alpha: false });
const streakBlurCanvas = document.createElement("canvas");
const streakBlurCtx = streakBlurCanvas.getContext("2d", { alpha: false });
const bloomCanvas = document.createElement("canvas");
const bloomCtx = bloomCanvas.getContext("2d", { alpha: false });
const wideCanvas = document.createElement("canvas");
const wideCtx = wideCanvas.getContext("2d", { alpha: false });

// SimplexNoise 默认拿 Math.random 建置换表，导致每次 reload 构图不同；这里用一个固定种子的小
// PRNG（mulberry32，等价 three 自带 seededRandom 的算法，不新增依赖）只建一次，逐帧 / 改布局都不重随机。
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const simplex = new SimplexNoise({ random: mulberry32(state.seed) });

let grid = { cols: 0, rows: 0, count: 0, cellW: 1, cellH: 1, spacing: 9 };
let cells = [];
let glyphState = new Uint8Array(0);
let noiseWave = new Float32Array(0);
let noiseSeg = new Float32Array(0);
let noiseDetail = new Float32Array(0);
let mask = null;
let imageData = null;
let imageSource = null;
let imageHasAlpha = false;
let imageSampling = "auto";
let loadToken = 0;
let paused = false;
let time = 0;
let lastTs = 0;
let lastDrawAt = 0;
let dirty = true;
let raf = 0;
let renderCount = 0;
let drawCalls = 0;
let glyphCounts = [0, 0, 0, 0];
let lastPixelRatio = 1;

function mixHex(from, to, amount) {
  const a = [1, 3, 5].map((i) => parseInt(from.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(to.slice(i, i + 2), 16));
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// 每个色带 8 级调色板：越靠亮核越接近浅色核心，避免逐格拼字符串。
const PALETTES = BAND_COLORS.map((color) =>
  Array.from({ length: PALETTE_STEPS }, (_, step) => mixHex(color, CORE_COLOR, step / (PALETTE_STEPS - 1)))
);

function setStatus(message) {
  $("status").textContent = message;
}

function schedule() {
  dirty = true;
  if (document.hidden) return;
  if (paused) {
    draw();
    dirty = false;
  } else if (!raf && !document.hidden) {
    raf = requestAnimationFrame(loop);
  }
}

function spacingForDensity(density) {
  const t = Math.pow(clamp01(density), DENSITY_GAMMA);
  return SPACING_COARSE + (SPACING_FINE - SPACING_COARSE) * t;
}

function layoutCanvas() {
  const stage = $("stage");
  const displayWidth = clamp(stage.clientWidth || MAX_CSS_WIDTH, 200, MAX_CSS_WIDTH);
  // 桌面固定用 720 基准宽渲染，显示尺寸由 workspace.css 的 ratio 模式（4:5、100dvh 内）决定；
  // 小屏回退到真实宽度，保持自然适配。见文件顶部 DESKTOP_RENDER_QUERY 的说明。
  const desktop = typeof window.matchMedia === "function"
    ? window.matchMedia(DESKTOP_RENDER_QUERY).matches
    : window.innerWidth >= 1000;
  const cssWidth = desktop ? MAX_CSS_WIDTH : displayWidth;
  const cssHeight = Math.round(cssWidth * ASPECT);
  const dpr = Math.min(window.devicePixelRatio || 1, 2, MAX_CANVAS / cssWidth, MAX_CANVAS / cssHeight);
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  lastPixelRatio = pixelWidth / cssWidth;
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  sharpCanvas.width = pixelWidth;
  sharpCanvas.height = pixelHeight;
  for (const [buffer, divisor] of [
    [blockCanvas, BLOCK_DIVISOR],
    [streakCanvas, BLOCK_DIVISOR],
    [streakBlurCanvas, BLOCK_DIVISOR],
    [bloomCanvas, BLOOM_DIVISOR],
    [wideCanvas, WIDE_DIVISOR]
  ]) {
    buffer.width = Math.max(1, Math.ceil(pixelWidth / divisor));
    buffer.height = Math.max(1, Math.ceil(pixelHeight / divisor));
  }

  const spacing = spacingForDensity(state.density);
  let cols = Math.max(1, Math.floor(cssWidth / spacing));
  let rows = Math.max(1, Math.floor(cssHeight / spacing));
  if (cols * rows > MAX_CELLS) {
    // 保留 12000 格上限：按比例同时缩小行列，而不是只压行。
    const factor = Math.sqrt(MAX_CELLS / (cols * rows));
    cols = Math.max(1, Math.floor(cols * factor));
    rows = Math.max(1, Math.floor(rows * factor));
  }

  grid = {
    cols,
    rows,
    count: cols * rows,
    cellW: pixelWidth / cols,
    cellH: pixelHeight / rows,
    spacing: cssWidth / cols
  };
  glyphState = new Uint8Array(grid.count);
  glyphCounts = [0, 0, 0, 0];
  cells = new Array(grid.count);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const index = y * cols + x;
      cells[index] = {
        x,
        y,
        nx: (x + 0.5) / cols,
        ny: (y + 0.5) / rows,
        px: (x + 0.5) * grid.cellW,
        py: (y + 0.5) * grid.cellH,
        phase: ((x * 17 + y * 31 + (state.seed % 997)) * 0.017)
      };
    }
  }

  buildNoiseBuffers();
  makeMask();
  if (imageSource) sampleImage(imageSource);
  updateStatus();
  schedule();
}

// 噪声只在布局时按格算一次：形状固定不漂移，逐帧只改亮度。
function buildNoiseBuffers() {
  const count = grid.count;
  noiseWave = new Float32Array(count);
  noiseSeg = new Float32Array(count);
  noiseDetail = new Float32Array(count);
  const seed = state.seed % 997;
  for (let i = 0; i < count; i += 1) {
    const cell = cells[i];
    noiseWave[i] = simplex.noise3d(cell.nx * 2.1 + 3.3, cell.ny * 1.6 + 7.1, seed * 0.013);
    noiseSeg[i] = simplex.noise3d(cell.nx * 4.6 + 1.2, cell.ny * 4.1 + 5.7, seed * 0.013 + 11.3);
    noiseDetail[i] = simplex.noise3d(cell.nx * 10.5 + 0.4, cell.ny * 10.2 + 2.9, seed * 0.013 + 23.9);
  }
}

function makeMask() {
  if (state.preset !== "letters") {
    mask = null;
    return;
  }
  const text = state.text.trim();
  if (!text) {
    mask = null;
    return;
  }
  const { cols, rows } = grid;
  const source = document.createElement("canvas");
  source.width = cols;
  source.height = rows;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  sourceCtx.fillStyle = "#000";
  sourceCtx.fillRect(0, 0, cols, rows);
  sourceCtx.fillStyle = "#fff";
  sourceCtx.textAlign = "center";
  sourceCtx.textBaseline = "alphabetic";

  // 先按目标墨迹高度反推字号：单个 a 约画面 17%，其余文字约 72%。
  const target = text === "a" ? rows * 0.17 : rows * 0.72;
  let fontSize = Math.max(1, rows * 0.5);
  sourceCtx.font = `bold ${fontSize}px sans-serif`;
  const probe = sourceCtx.measureText(text);
  const inkHeight = (probe.actualBoundingBoxAscent || fontSize * 0.72) + (probe.actualBoundingBoxDescent || 0);
  if (inkHeight > 0) fontSize = Math.max(1, (fontSize * target) / inkHeight);
  sourceCtx.font = `bold ${fontSize}px sans-serif`;
  const measuredWidth = sourceCtx.measureText(text).width;
  if (measuredWidth > cols * 0.92) {
    fontSize = Math.max(1, (fontSize * cols * 0.92) / measuredWidth);
    sourceCtx.font = `bold ${fontSize}px sans-serif`;
  }
  const metrics = sourceCtx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.72;
  const descent = metrics.actualBoundingBoxDescent || 0;
  sourceCtx.fillText(text, cols / 2, rows / 2 + (ascent - descent) / 2);

  const pixels = sourceCtx.getImageData(0, 0, cols, rows).data;
  mask = new Float32Array(grid.count);
  for (let i = 0; i < mask.length; i += 1) mask[i] = pixels[i * 4] / 255;
}

function detectSourceAlpha(img) {
  const probe = document.createElement("canvas");
  if (img.naturalWidth >= img.naturalHeight) {
    probe.width = 64;
    probe.height = Math.max(1, Math.round((64 * img.naturalHeight) / img.naturalWidth));
  } else {
    probe.height = 64;
    probe.width = Math.max(1, Math.round((64 * img.naturalWidth) / img.naturalHeight));
  }
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });
  probeCtx.drawImage(img, 0, 0, probe.width, probe.height);
  const data = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
  imageHasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      imageHasAlpha = true;
      break;
    }
  }
}

function sampleImage(img) {
  const { cols, rows } = grid;
  const source = document.createElement("canvas");
  source.width = cols;
  source.height = rows;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  sourceCtx.clearRect(0, 0, cols, rows);
  const scale = Math.min(cols / img.naturalWidth, rows / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  sourceCtx.drawImage(img, (cols - width) / 2, (rows - height) / 2, width, height);

  const pixels = sourceCtx.getImageData(0, 0, cols, rows).data;
  const bright = new Float32Array(grid.count);
  const alpha = new Float32Array(grid.count);
  const rgb = new Array(grid.count);
  for (let i = 0; i < grid.count; i += 1) {
    const offset = i * 4;
    alpha[i] = pixels[offset + 3] / 255;
    bright[i] = (alpha[i] * (0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2])) / 255;
    rgb[i] = `rgb(${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]})`;
  }
  imageData = { bright, alpha, rgb };
}

function imageValue(index) {
  if (imageSampling === "alpha" || (imageSampling === "auto" && imageHasAlpha)) return imageData.alpha[index];
  if (imageSampling === "invert") return imageData.alpha[index] - imageData.bright[index];
  return imageData.bright[index];
}

function field(cell, t) {
  const index = cell.y * grid.cols + cell.x;
  if (imageData) {
    const brightness = clamp01(imageValue(index));
    sample.value = brightness * (0.82 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.1 + cell.phase)));
    sample.band = -1;
    sample.color =
      imageSampling === "alpha" || (imageSampling === "auto" && imageHasAlpha) ? CORE_COLOR : imageData.rgb[index];
    sample.glowColor = sample.color;
    return sample;
  }

  if (mask || state.preset === "letters") {
    const base = mask ? mask[index] : 0;
    sample.value = base * (0.8 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.1 + cell.phase)));
    sample.band = -1;
    sample.color = CORE_COLOR;
    sample.glowColor = CORE_COLOR;
    return sample;
  }

  fieldOpts.amp = state.amp;
  fieldOpts.bandWidth = state.bandWidth;
  sampleGlow(cell.nx, cell.ny, noiseWave[index], noiseSeg[index], noiseDetail[index], t, fieldOpts, sample);
  if (sample.band < 0) {
    sample.color = CORE_COLOR;
    sample.glowColor = CORE_COLOR;
  } else {
    const level = sample.value > 0.58 ? Math.min(PALETTE_STEPS - 1, Math.floor(((sample.value - 0.58) / 0.42) * PALETTE_STEPS)) : 0;
    // 清晰层用逐渐提亮的浅色核；辉光层始终用该色带的饱和主色，避免柔光发白。
    sample.color = PALETTES[sample.band][level];
    sample.glowColor = BAND_COLORS[sample.band];
  }
  return sample;
}

function draw() {
  if (!grid.count) return;
  const width = canvas.width;
  const height = canvas.height;
  const useGlow = state.glow > 0.01;
  const useStreak = useGlow && state.glowLength > 0.5;
  const blockScaleX = blockCanvas.width / width;
  const blockScaleY = blockCanvas.height / height;
  const blockW = Math.max(1, grid.cellW * blockScaleX * 0.62);
  const blockH = Math.max(1, grid.cellH * blockScaleY * 0.62);
  drawCalls = 0;

  sharpCtx.setTransform(1, 0, 0, 1, 0, 0);
  sharpCtx.clearRect(0, 0, width, height);
  sharpCtx.globalAlpha = 1;
  sharpCtx.globalCompositeOperation = "source-over";
  sharpCtx.filter = "none";
  sharpCtx.font = `${Math.max(5, Math.min(grid.cellW, grid.cellH) * 0.78)}px ui-monospace,Menlo,monospace`;
  sharpCtx.textAlign = "center";
  sharpCtx.textBaseline = "middle";

  if (useGlow) {
    blockCtx.setTransform(1, 0, 0, 1, 0, 0);
    blockCtx.clearRect(0, 0, blockCanvas.width, blockCanvas.height);
    blockCtx.globalAlpha = 1;
    blockCtx.globalCompositeOperation = "source-over";
  }

  glyphCounts = [0, 0, 0, 0];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    const value = field(cell, time).value;
    const next = nextGlyph(glyphState[i], value);
    glyphState[i] = next;
    glyphCounts[next] += 1;
    if (!next) continue;

    sharpCtx.fillStyle = sample.color;
    sharpCtx.globalAlpha = next === 3 ? 0.96 : next === 2 ? 0.72 : 0.42;
    sharpCtx.fillText(GLYPHS[next], cell.px, cell.py);

    if (useGlow) {
      // 辉光层用色带饱和主色（图片 / 文字模式仍沿用各自颜色），清晰层才逐渐提亮到浅色核。
      blockCtx.fillStyle = sample.glowColor;
      blockCtx.globalAlpha = next === 3 ? 0.95 : next === 2 ? 0.62 : 0.32;
      blockCtx.fillRect(
        cell.px * blockScaleX - blockW / 2,
        cell.py * blockScaleY - blockH / 2,
        blockW,
        blockH
      );
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  if (useGlow) {
    blockCtx.globalAlpha = 1;
    // 圆形 bloom：1/8 与 1/16 两级黑底不透明 RGB 缓冲。先在 RGB 域 blur / 降采样，
    // 固定 3.6 曝光统一留到最终 ctx 的 lighter 合成一次性施加（见下），因此两层不会叠乘。
    bloomCtx.setTransform(1, 0, 0, 1, 0, 0);
    bloomCtx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
    bloomCtx.filter = "blur(2px)";
    bloomCtx.drawImage(blockCanvas, 0, 0, bloomCanvas.width, bloomCanvas.height);
    bloomCtx.filter = "none";
    drawCalls += 1;

    wideCtx.setTransform(1, 0, 0, 1, 0, 0);
    wideCtx.clearRect(0, 0, wideCanvas.width, wideCanvas.height);
    wideCtx.filter = "blur(1.4px)";
    wideCtx.drawImage(bloomCanvas, 0, 0, wideCanvas.width, wideCanvas.height);
    wideCtx.filter = "none";
    drawCalls += 1;

    ctx.globalCompositeOperation = "lighter";
    // 曝光在模糊之后、对已与黑底混合的 RGB 能量缓存施加一次：缓存源 alpha=1，
    // brightness 直接按通道乘系数，低亮主色也获得真实增益且色相保留，只有高亮核心饱和；
    // 黑色 RGB0 在 lighter 合成中不抬黑。宽柔光 / bloom / 光丝三个整帧 drawImage 共享此 filter。
    ctx.filter = `brightness(${GLOW_GAIN})`;
    // 最终合成 alpha 只随 glow 单调连续变化（≤1，无需 clamp）：
    // 高段不会再被截到 1，0.6 / 0.8 / 1 真实连续递增。
    const glowAlpha = Math.pow(state.glow, GLOW_ALPHA);
    ctx.globalAlpha = glowAlpha;
    ctx.drawImage(wideCanvas, 0, 0, width, height);
    ctx.globalAlpha = glowAlpha;
    ctx.drawImage(bloomCanvas, 0, 0, width, height);
    drawCalls += 2;

    if (useStreak) {
      // 方向拉丝（directional-blur-pass 的 Canvas 等效）：低分辨率缓存整帧，
      // 沿角度做有限次位移取样；长度控制延伸、强度控制能量，两者独立。
      const radians = (state.glowAngle * Math.PI) / 180;
      const spanPx = (state.glowLength * lastPixelRatio) / BLOCK_DIVISOR;
      const dirX = Math.cos(radians);
      const dirY = Math.sin(radians);
      streakCtx.setTransform(1, 0, 0, 1, 0, 0);
      streakCtx.clearRect(0, 0, streakCanvas.width, streakCanvas.height);
      streakCtx.globalCompositeOperation = "lighter";
      for (let s = 0; s < STREAK_SAMPLES; s += 1) {
        const step = STREAK_SAMPLES === 1 ? 0 : s / (STREAK_SAMPLES - 1) - 0.5;
        streakCtx.globalAlpha = 1 / STREAK_SAMPLES;
        streakCtx.drawImage(blockCanvas, dirX * spanPx * step, dirY * spanPx * step);
        drawCalls += 1;
      }
      streakCtx.globalAlpha = 1;
      // 低分辨率再柔化一次，把 8 个离散取样融成连续光丝（整帧 drawImage 仍在预算内）；
      // 曝光同样留到最终 lighter 合成，这里只做 blur。
      streakBlurCtx.setTransform(1, 0, 0, 1, 0, 0);
      streakBlurCtx.clearRect(0, 0, streakBlurCanvas.width, streakBlurCanvas.height);
      streakBlurCtx.filter = "blur(1.6px)";
      streakBlurCtx.drawImage(streakCanvas, 0, 0);
      streakBlurCtx.filter = "none";
      drawCalls += 1;
      ctx.globalAlpha = glowAlpha;
      ctx.drawImage(streakBlurCanvas, 0, 0, width, height);
      drawCalls += 1;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // 合成结束必须恢复 filter，再叠透明的清晰字形层，避免清晰层被辉光曝光污染。
    ctx.filter = "none";
  }

  drawCalls += 1;
  ctx.drawImage(sharpCanvas, 0, 0);
  renderCount += 1;
  lastDrawAt = performance.now();
}

function updateStatus() {
  const mode = imageData ? "图片轮廓 / 明暗" : mask ? "文字图形" : state.preset === "letters" ? "字母图形" : "宽厚色带";
  setStatus(
    `${grid.cols}×${grid.rows} · ${grid.count} 格 · 间距 ${grid.spacing.toFixed(1)}px · ${mode} · ${paused ? "已暂停" : "运行中"}`
  );
}

function loop(timestamp) {
  raf = 0;
  if (document.hidden) return;
  if (!lastTs) lastTs = timestamp;
  const delta = Math.min(50, timestamp - lastTs);
  lastTs = timestamp;
  if (!paused) {
    time += delta * 0.001 * state.speed;
    dirty = true;
  }
  if (dirty && timestamp - lastDrawAt >= 33) {
    draw();
    dirty = false;
    lastDrawAt = timestamp;
  }
  if (!paused) raf = requestAnimationFrame(loop);
}

function bindRange(id, key, onChange) {
  const range = $("p-" + id);
  const number = $("n-" + id);
  const apply = (raw) => {
    let value = Number(raw);
    if (!Number.isFinite(value)) value = state[key];
    state[key] = clamp(value, Number(range.min), Number(range.max));
    range.value = number.value = String(state[key]);
    if (onChange) onChange();
    updateStatus();
    schedule();
  };
  range.addEventListener("input", () => apply(range.value));
  number.addEventListener("input", () => apply(number.value));
  number.addEventListener("change", () => apply(number.value));
}

function syncDensityControls() {
  $("p-density").value = String(state.density);
  $("n-density").value = String(state.density);
  document.querySelectorAll("[data-density]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Math.abs(Number(button.dataset.density) - state.density) < 0.005));
  });
}

function loadFile(file) {
  if (!file) return;
  const token = ++loadToken;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > MAX_FILE) {
    setStatus("请选择 10 MiB 内的 PNG / JPEG / WebP。当前图片已保留。");
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    if (token !== loadToken) return;
    if (img.naturalWidth > MAX_SIDE || img.naturalHeight > MAX_SIDE) {
      setStatus("图片单边不能超过 4096 像素，当前图片已保留。");
      return;
    }
    imageSource = img;
    detectSourceAlpha(img);
    sampleImage(img);
    $("image-name").textContent = `已载入 ${file.name}`;
    $("image-clear").hidden = false;
    updateStatus();
    schedule();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (token === loadToken) setStatus("图片解码失败，当前图片已保留。");
  };
  img.src = url;
}

function boot() {
  bindRange("density", "density", () => {
    syncDensityControls();
    layoutCanvas();
  });
  bindRange("amp", "amp");
  bindRange("speed", "speed");
  bindRange("glow", "glow");
  bindRange("glowLength", "glowLength");
  bindRange("glowAngle", "glowAngle");
  bindRange("bandWidth", "bandWidth");

  document.querySelectorAll("[data-density]").forEach((button) => {
    button.addEventListener("click", () => {
      state.density = clamp(Number(button.dataset.density), 0, 1);
      syncDensityControls();
      layoutCanvas();
    });
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.preset = button.dataset.preset;
      if (state.preset === "letters" && !state.text) {
        state.text = "a";
        $("mask-text").value = state.text;
      }
      document.querySelectorAll("[data-preset]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      makeMask();
      updateStatus();
      schedule();
    });
  });

  $("mask-text").addEventListener("input", (event) => {
    state.text = event.target.value.slice(0, 48);
    if (state.text) {
      state.preset = "letters";
      $("preset-ribbons").setAttribute("aria-pressed", "false");
      $("preset-letters").setAttribute("aria-pressed", "true");
    }
    makeMask();
    updateStatus();
    schedule();
  });

  $("image-file").addEventListener("change", (event) => loadFile(event.target.files && event.target.files[0]));
  $("image-sampling").addEventListener("change", (event) => {
    imageSampling = event.target.value;
    updateStatus();
    schedule();
  });
  $("image-clear").addEventListener("click", () => {
    loadToken += 1;
    imageSource = null;
    imageData = null;
    imageHasAlpha = false;
    $("image-file").value = "";
    $("image-clear").hidden = true;
    $("image-name").textContent = "未选择图片。";
    updateStatus();
    schedule();
  });

  $("btn-pause").addEventListener("click", () => {
    paused = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    updateStatus();
  });
  $("btn-play").addEventListener("click", () => {
    paused = false;
    lastTs = 0;
    updateStatus();
    schedule();
  });
  $("btn-export").addEventListener("click", () => {
    if (dirty) draw();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `wave-grid-${state.seed}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  });

  syncDensityControls();
  layoutCanvas();
  draw();
  if (typeof ResizeObserver === "function") new ResizeObserver(layoutCanvas).observe($("stage"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else {
      lastTs = 0;
      if (dirty || paused) schedule();
      else if (!raf) raf = requestAnimationFrame(loop);
    }
  });
}

window.imagelab = {
  ready: false,
  paused: () => paused,
  seed: () => state.seed,
  frame: () => time,
  cells: () => grid.count,
  shape: () => "glyphs",
  preset: () => state.preset,
  hasImage: () => Boolean(imageData),
  params: () => ({ ...state }),
  spacing: () => grid.spacing,
  stats: () => ({
    cells: grid.count,
    cols: grid.cols,
    rows: grid.rows,
    spacing: grid.spacing,
    renderCount,
    drawCalls,
    glyphCounts: [...glyphCounts],
    coverage: grid.count ? (grid.count - glyphCounts[0]) / grid.count : 0,
    glow: state.glow,
    glowLength: state.glowLength,
    glowAngle: state.glowAngle,
    bandWidth: state.bandWidth,
    density: state.density,
    alphaMode: imageHasAlpha && (imageSampling === "auto" || imageSampling === "alpha")
  }),
  snapshot: () => canvas.toDataURL("image/png")
};

// lastPixelRatio 在 layoutCanvas 里记录，供方向拉丝把 CSS px 换算到低分辨率缓冲。
mountCategoryTabs();
boot();
window.imagelab.ready = true;
