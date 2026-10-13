/*
 * tools/mixed-type · 文字混排
 *
 * 独立 Canvas 2D 生成器：把一段中英文混排文字按字族池逐字排版，
 * 每个字带一点字号 / 基线抖动，并可切换到描边字（Canvas strokeText）。
 *
 * 可复现性：版式完全由「参数 + 随机种子」决定。渲染开始时用一个由种子初始化的
 * 伪随机数发生器重新开始，因此同一组参数重复渲染得到同一张图，不存在「每帧重排」。
 *
 * 无第三方字体、无远程请求：字族池只使用访问者本机已安装的系统字体，
 * 「读取本地字体」按钮才会调用浏览器原生的 queryLocalFonts（需用户点击 + 安全上下文）。
 */

const MAX_TEXT = 2000;
const MIN_SIZE = 10;
const MAX_SIZE = 200;
const MIN_CANVAS_W = 640;
const MAX_CANVAS_W = 2400;
const ASPECT = 1.25; // 画布高 = 宽 × 1.25

const DEFAULT_TEXT = "汉字与 Latin 混排\nType & 文字 123\n排版实验室 imageLAB";

const GENERIC_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace"
]);

/* 默认字族池：三种通用字族一定可用（首次打开即可正常渲染），
 * 其余是本机常见的西文 / 中文字族，没装时浏览器自动回退，不会破版。 */
const BASE_FAMILIES = [
  "sans-serif",
  "serif",
  "monospace",
  "PingFang SC",
  "Hiragino Sans GB",
  "Songti SC",
  "Kaiti SC",
  "Heiti SC",
  "Microsoft YaHei",
  "SimSun",
  "Arial",
  "Helvetica Neue",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana"
];
const DEFAULT_POOL = ["sans-serif", "serif", "monospace"];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const state = {
  seed: 20240101,
  text: DEFAULT_TEXT,
  size: 68,
  lineMul: 1.25,
  tracking: 2,
  jitter: 0.28,
  outline: 0.22,
  canvasW: 1200,
  pool: new Set(DEFAULT_POOL),
  families: BASE_FAMILIES.slice(),
  localCount: 0
};

const canvas = $("mix-canvas");
const ctx = canvas.getContext("2d", { alpha: false });

/* ----------------------------------------------------------------- 随机数 */

/** mulberry32：小而稳定的 32 位种子伪随机数发生器。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------- 字族 */

function quoteFamily(family) {
  const clean = String(family).replace(/["']/g, "").trim();
  if (!clean) return "sans-serif";
  return GENERIC_FAMILIES.has(clean) ? clean : `"${clean}"`;
}

/** 单个字族 + 中文回退栈：任何字族后面都兜底到中文字体与通用无衬线。 */
function stackFor(family) {
  return `${quoteFamily(family)}, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
}

function fontString(family, size) {
  return `${size}px ${stackFor(family)}`;
}

function addFamily(family, { check = true } = {}) {
  const clean = String(family || "").replace(/["']/g, "").trim();
  if (!clean) return false;
  if (!state.families.includes(clean)) state.families.push(clean);
  if (check) state.pool.add(clean);
  return true;
}

function syncPoolFallback() {
  if (state.pool.size === 0) {
    state.pool.add("sans-serif");
    setFontStatus("至少保留一个字族，已自动勾选系统无衬线。");
  }
}

function renderFontList() {
  const host = $("font-list");
  host.textContent = "";
  for (const family of state.families) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.pool.has(family);
    box.dataset.family = family;
    box.addEventListener("change", () => {
      if (box.checked) state.pool.add(family);
      else state.pool.delete(family);
      syncPoolFallback();
      renderFontList();
      scheduleRender();
    });
    const text = document.createElement("span");
    text.textContent = family;
    label.appendChild(box);
    label.appendChild(text);
    if (!GENERIC_FAMILIES.has(family) && !BASE_FAMILIES.includes(family)) {
      const tag = document.createElement("span");
      tag.className = "il-font-tag";
      tag.textContent = "本机";
      label.appendChild(tag);
    }
    host.appendChild(label);
  }
  $("font-status").textContent = state.localCount
    ? `本机字体仅在你点击后读取，不会上传；已读取 ${state.localCount} 个本机字族。`
    : "本机字体仅在你点击后读取，不会上传，也不会打包含字体文件。";
}

function setFontStatus(message) {
  $("font-status").textContent = message;
}

/* ------------------------------------------------------------ 本地字体读取 */

async function readLocalFonts() {
  if (typeof navigator.queryLocalFonts !== "function") {
    setFontStatus("当前浏览器不支持读取本机字体；已继续使用系统字族渲染，不影响导出。");
    return;
  }
  if (!window.isSecureContext) {
    setFontStatus("当前页面不是安全上下文（需 https 或 127.0.0.1），已继续使用系统字族渲染。");
    return;
  }
  try {
    const fonts = await navigator.queryLocalFonts();
    const families = [...new Set((fonts || []).map((f) => f && f.family).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN")
    );
    state.localCount = families.length;
    let added = 0;
    for (const f of families) if (addFamily(f, { check: false })) added++;
    renderFontList();
    setFontStatus(`已读取 ${families.length} 个本机字族（去重后），可在上方勾选使用。`);
    return added;
  } catch (err) {
    const name = err && err.name ? err.name : "Error";
    const message =
      name === "NotAllowedError" || name === "SecurityError"
        ? "未获得读取本机字体的权限，已继续使用系统字族渲染。"
        : "读取本机字体失败，已继续使用系统字族渲染。";
    setFontStatus(message);
  }
}

/* ---------------------------------------------------------------- 排版渲染 */

const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("zh-Hans-CN", { granularity: "grapheme" })
    : null;

function graphemes(line) {
  if (!line) return [];
  if (segmenter) return [...segmenter.segment(line)].map((s) => s.segment);
  return Array.from(line);
}

async function fontsReady() {
  if (!document.fonts) return;
  const named = [...state.pool].filter((f) => !GENERIC_FAMILIES.has(f));
  try {
    await Promise.all(
      named.map((f) => {
        try {
          return document.fonts.load(fontString(f, state.size)).catch(() => null);
        } catch {
          return Promise.resolve(null);
        }
      })
    );
    await document.fonts.ready;
  } catch {
    /* 字体加载失败时按系统回退渲染即可 */
  }
}

let renderToken = 0;
let lastInfo = { lines: 0, glyphs: 0, overflow: false };

async function render() {
  const token = ++renderToken;
  const info = $("status");
  const empty = $("empty");

  const text = state.text;
  $("text-count").textContent = `${text.length} / ${MAX_TEXT}`;
  $("seed-label").textContent = String(state.seed);

  if (!text.trim()) {
    const W = state.canvasW;
    const H = Math.round(W * ASPECT);
    canvas.width = W;
    canvas.height = H;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    empty.hidden = false;
    if (info) info.textContent = "还没有文字：输入内容后即可生成版式。";
    lastInfo = { lines: 0, glyphs: 0, overflow: false };
    return;
  }
  empty.hidden = true;
  if (info) info.textContent = "排版中…";

  await fontsReady();
  if (token !== renderToken) return; // 期间又触发了新的渲染，放弃本次

  const W = clamp(Math.round(state.canvasW), MIN_CANVAS_W, MAX_CANVAS_W);
  const H = Math.round(W * ASPECT);
  canvas.width = W;
  canvas.height = H;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const padX = Math.round(W * 0.065);
  const padY = Math.round(H * 0.06);
  const lineH = state.size * state.lineMul;
  const rng = mulberry32(state.seed);
  const pool = state.pool.size ? [...state.pool] : ["sans-serif"];

  let x = padX;
  let baseline = padY + state.size;
  let lines = 0;
  let glyphs = 0;
  let overflow = false;

  const sourceLines = text.split(/\r?\n/);
  for (const source of sourceLines) {
    const chars = graphemes(source);
    lines++;
    if (chars.length === 0) {
      baseline += lineH;
      x = padX;
      continue;
    }
    for (const ch of chars) {
      const family = pool[Math.floor(rng() * pool.length) % pool.length];
      const sizeJ = state.size * (1 + (rng() * 2 - 1) * state.jitter * 0.5);
      const dy = (rng() * 2 - 1) * state.jitter * state.size * 0.18;
      const isOutline = rng() < state.outline;

      ctx.font = fontString(family, sizeJ);
      const advance = ctx.measureText(ch).width;

      if (x + advance > W - padX && x > padX) {
        x = padX;
        baseline += lineH;
        if (baseline > H - padY + lineH * 0.5) {
          overflow = true;
          break;
        }
      }
      if (baseline > H - padY + lineH * 0.5) {
        overflow = true;
        break;
      }

      if (isOutline) {
        ctx.lineWidth = Math.max(1, sizeJ * 0.055);
        ctx.strokeStyle = "#111111";
        ctx.strokeText(ch, x, baseline + dy);
      } else {
        ctx.fillStyle = "#111111";
        ctx.fillText(ch, x, baseline + dy);
      }
      glyphs++;
      x += advance + state.tracking;
    }
    if (overflow) break;
    baseline += lineH;
    x = padX;
  }

  lastInfo = { lines, glyphs, overflow };
  if (info) {
    info.textContent = overflow
      ? `已生成 ${glyphs} 个字 · 内容超出画布，超出部分被裁切（可减小字号或缩短文字）。`
      : `已生成 ${glyphs} 个字 · 画布 ${W}×${H} · 种子 ${state.seed}`;
  }
}

let renderTimer = 0;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render(), 60);
}

/* ------------------------------------------------------------------ 控件 */

function bindRange(id, key, { integer = false, onChange } = {}) {
  const range = $(`p-${id}`);
  const number = $(`n-${id}`);
  const apply = (raw, from) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = state[key];
    v = integer ? Math.round(v) : v;
    v = clamp(v, Number(range.min), Number(range.max));
    state[key] = v;
    range.value = String(v);
    number.value = String(v);
    if (from !== "range") range.value = String(v);
    if (onChange) onChange(v);
    scheduleRender();
  };
  range.addEventListener("input", () => apply(range.value, "range"));
  number.addEventListener("input", () => apply(number.value, "number"));
  number.addEventListener("change", () => apply(number.value, "number"));
}

function boot() {
  $("text-input").value = state.text;
  $("text-input").addEventListener("input", (e) => {
    let v = e.target.value;
    if (v.length > MAX_TEXT) {
      v = v.slice(0, MAX_TEXT);
      e.target.value = v;
    }
    state.text = v;
    scheduleRender();
  });

  renderFontList();

  $("btn-add-custom").addEventListener("click", () => {
    const input = $("custom-font");
    if (addFamily(input.value)) {
      input.value = "";
      renderFontList();
      scheduleRender();
      setFontStatus("已加入自定义字族；若本机没有该字族，将按系统回退渲染。");
    }
  });
  $("custom-font").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-add-custom").click();
  });

  $("btn-local-fonts").addEventListener("click", () => {
    readLocalFonts();
  });

  bindRange("size", "size", { integer: true });
  bindRange("line", "lineMul");
  bindRange("tracking", "tracking");
  bindRange("jitter", "jitter");
  bindRange("outline", "outline");
  bindRange("width", "canvasW", { integer: true });

  $("btn-reroll").addEventListener("click", () => {
    state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
    render();
  });

  $("btn-export").addEventListener("click", () => {
    fontsReady().then(() => {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mixed-type-${state.seed}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, "image/png");
    });
  });

  render();
}

/* 测试 / 验收钩子：只读状态 + 主动重渲染，不改版式逻辑。 */
window.imagelab = {
  ready: false,
  seed: () => state.seed,
  text: () => state.text,
  fonts: () => [...state.pool],
  families: () => [...state.families],
  info: () => ({ ...lastInfo, seed: state.seed, size: state.size, tracking: state.tracking }),
  render: () => render(),
  snapshot: () => canvas.toDataURL("image/png")
};

boot();
render().then(() => {
  window.imagelab.ready = true;
});

