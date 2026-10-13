/*
 * tools/ascii-motion · 动态字符画
 *
 * 用 three（MIT，仓库已锁定 0.186.1）搭真实的三维动画，再用 three 自带的
 * `addons/effects/AsciiEffect`（MIT）把渲染结果转成字符。没有自定义着色器、
 * 没有外部模型 / 贴图 / 字体。
 *
 * 水母触手用 three 自带 `addons/lines`（Line2 + LineGeometry + LineMaterial，均 MIT）
 * 画原生宽线：1 像素的 LineBasicMaterial 在字符采样格里会碎成孤立短划，宽线能保持连续；
 * 每帧只原地改写 instanceStart / instanceEnd 共用的数据，不重建、不销毁几何体。
 *
 * 预览：AsciiEffect 生成的 DOM 表格（真实字符 + 行内颜色）。
 * 导出：读取当前这一帧表格里的「真实字符 + 行内颜色 + 背景」，用 Canvas 2D 重绘成 PNG，
 *       因此导出的是字符画本身，而不是原始三维网格，也不需要 html2canvas 之类的依赖。
 */

import * as THREE from "three";
import { AsciiEffect } from "three/addons/effects/AsciiEffect.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const CHARSETS = [
  { id: "standard", label: "经典 .:-=+*#%@", set: " .:-=+*#%@" },
  { id: "soft", label: "柔和 .·:*#@", set: " .·:*#@" },
  { id: "blocks", label: "方块 ░▒▓█", set: " ░▒▓█" },
  { id: "dense", label: "密集 .,:;i1tfLCG08@", set: " .,:;i1tfLCG08@" }
];

const PRESETS = {
  jellyfish: "水母：伞盖 + 摆动的触手（球面片段 + 线段）",
  ring: "圆环：三层旋转圆环（环面几何体）",
  tunnel: "隧道：一圈圈向镜头推进的环（环面几何体）",
  wave: "波形：顶点起伏的网格平面（平面几何体）"
};

const BG = "#05060b";
const FALLBACK_COLOR = "#f2f4ff";
/** 触手宽线的逻辑像素宽度：字符采样格约 13px，太细会在采样时断成孤立短划。 */
const STRAND_WIDTH = 6;

const state = {
  preset: "jellyfish",
  density: 0.55,
  speed: 1,
  glow: 0.65,
  color: "#b8c6ff",
  charsetId: "standard"
};

function charsetSet() {
  const hit = CHARSETS.find((c) => c.id === state.charsetId);
  return (hit || CHARSETS[0]).set;
}
function resolution() {
  return 0.09 + state.density * 0.11;
}

/* ------------------------------------------------------------------ three */

const stage = $("stage");
const holder = $("ascii-holder");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1.6, 0.1, 120);
camera.position.set(0, 0.5, 5.4);

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setClearColor(0x000000, 0);

const root = new THREE.Group();
scene.add(root);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 1.15);
key.position.set(3.5, 4.5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.45);
rim.position.set(-4, -2, -3);
scene.add(rim);

let materials = [];
let geometries = [];
let tentacles = [];
let rings = [];
let waveGeo = null;

function mat() {
  const m = new THREE.MeshLambertMaterial({ color: state.color });
  materials.push(m);
  return m;
}
function track(geo) {
  geometries.push(geo);
  return geo;
}

function clearRoot() {
  root.clear();
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  materials = [];
  geometries = [];
  tentacles = [];
  rings = [];
  waveGeo = null;
}

function applyColor() {
  for (const m of materials) if (m.color) m.color.set(state.color);
}

/* ---------------------------------------------------------------- 预设构建 */

function buildJellyfish() {
  const body = new THREE.Mesh(
    track(new THREE.SphereGeometry(1.18, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.62)),
    mat()
  );
  body.position.y = 0.32;
  root.add(body);

  const rimRing = new THREE.Mesh(track(new THREE.TorusGeometry(1.12, 0.045, 8, 40)), mat());
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = 0.32 + 1.18 * Math.cos(Math.PI * 0.62);
  root.add(rimRing);

  const count = 10;
  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2;
    const N = 18;
    // LineGeometry.setPositions 接收 N 个点，内部换算成 N-1 段并建立 instanceStart /
    // instanceEnd 共用缓冲区；这里只建一次，之后每帧原地改写该原生缓冲区，不再分配 / 销毁几何体。
    const geo = track(new LineGeometry());
    geo.setPositions(new Float32Array(N * 3));
    const segs = geo.attributes.instanceStart.data.array;
    const lineMat = new LineMaterial({ color: state.color, linewidth: STRAND_WIDTH });
    lineMat.resolution.set(1, 1); // 真实分辨率在 resize() / buildEffect() 后同步
    materials.push(lineMat);
    const line = new Line2(geo, lineMat);
    line.frustumCulled = false; // 缓冲区原地更新后包围球会过期，关掉剔除
    root.add(line);
    tentacles.push({ segs, geo, points: N, angle, phase: k * 0.9, length: 1.5 + (k % 3) * 0.45, radius: 1.05 });
  }
  root.position.y = 0.1;
}

function buildRing() {
  const specs = [
    { r: 1.35, t: 0.28, rx: 0, ry: 0, speed: 0.6 },
    { r: 1.0, t: 0.16, rx: Math.PI / 2.4, ry: 0.4, speed: -0.9 },
    { r: 1.75, t: 0.1, rx: Math.PI / 1.7, ry: -0.5, speed: 1.3 }
  ];
  for (const s of specs) {
    const mesh = new THREE.Mesh(track(new THREE.TorusGeometry(s.r, s.t, 12, 60)), mat());
    mesh.rotation.set(s.rx, s.ry, 0);
    root.add(mesh);
    rings.push({ mesh, speed: s.speed });
  }
}

function buildTunnel() {
  const N = 18;
  const span = 46;
  for (let i = 0; i < N; i++) {
    const mesh = new THREE.Mesh(track(new THREE.TorusGeometry(2.35, 0.12, 8, 30)), mat());
    root.add(mesh);
    rings.push({ mesh, offset: (i / N) * span, index: i, span });
  }
}

function buildWave() {
  const geo = track(new THREE.PlaneGeometry(7.2, 7.2, 46, 46));
  const mesh = new THREE.Mesh(geo, mat());
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.3;
  root.add(mesh);
  waveGeo = geo;
}

function buildPreset(name) {
  clearRoot();
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  camera.position.set(0, 0.5, 5.4);
  if (name === "ring") buildRing();
  else if (name === "tunnel") buildTunnel();
  else if (name === "wave") buildWave();
  else buildJellyfish();
  if (name === "jellyfish") camera.position.set(0, 0.35, 6.5);
  applyColor();
}

/* --------------------------------------------------------------- 动画更新 */

/** 水母触手：同样的相位 / 路径曲线，写进 LineGeometry 共用的 instance 缓冲区。 */
function updateTentacles(t) {
  for (const tn of tentacles) {
    const segs = tn.segs;
    const N = tn.points;
    const cos = Math.cos(tn.angle);
    const sin = Math.sin(tn.angle);
    for (let j = 0; j < N; j++) {
      const f = j / (N - 1);
      const sway = Math.sin(t * 2 + f * 6.5 + tn.phase) * 0.3 * f;
      const sway2 = Math.cos(t * 1.35 + f * 4 + tn.phase * 0.7) * 0.24 * f;
      const r = tn.radius - f * 0.5;
      const x = cos * r + sway * cos + sway2 * -sin * 0.7;
      const y = -f * tn.length;
      const z = sin * r + sway * sin + sway2 * cos * 0.7;
      // 点 j 同时是线段 j 的起点、线段 j-1 的终点（instanceStart / instanceEnd 共用一块数据）。
      if (j > 0) {
        const e = (j - 1) * 6 + 3;
        segs[e] = x;
        segs[e + 1] = y;
        segs[e + 2] = z;
      }
      if (j < N - 1) {
        const s = j * 6;
        segs[s] = x;
        segs[s + 1] = y;
        segs[s + 2] = z;
      }
    }
    tn.geo.attributes.instanceStart.data.needsUpdate = true;
  }
}

function updateScene(t) {
  if (state.preset === "jellyfish") {
    updateTentacles(t);
    root.rotation.y = Math.sin(t * 0.25) * 0.35;
    root.position.y = 0.1 + Math.sin(t * 0.9) * 0.08;
    // 伞盖 + 触手整体偏下：镜头拉远到 6.5、看向 y≈-0.4，保证最长触手也在画面内。
    camera.position.x = Math.sin(t * 0.22) * 0.7;
    camera.position.y = 0.35 + Math.sin(t * 0.5) * 0.18;
    camera.position.z = 6.5;
    camera.lookAt(0, -0.4, 0);
  } else if (state.preset === "ring") {
    for (const rr of rings) {
      rr.mesh.rotation.z += 0.016 * rr.speed;
      rr.mesh.rotation.y += 0.01 * rr.speed;
    }
    root.rotation.y = t * 0.3;
    camera.position.x = Math.sin(t * 0.25) * 1.1;
    camera.lookAt(0, 0, 0);
  } else if (state.preset === "tunnel") {
    for (const rr of rings) {
      const z = 4 - ((rr.offset + t * 4.2) % rr.span);
      rr.mesh.position.z = z;
      rr.mesh.rotation.z = t * 0.5 + rr.index * 0.32;
      rr.mesh.rotation.x = Math.sin(t * 0.4 + rr.index * 0.5) * 0.16;
    }
    camera.position.x = Math.sin(t * 0.3) * 0.35;
    camera.lookAt(0, 0, -6);
  } else {
    if (waveGeo) {
      const pos = waveGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 1.25 + t * 1.8) * 0.34 + Math.sin(y * 1.05 - t * 1.3) * 0.26);
      }
      pos.needsUpdate = true;
      waveGeo.computeVertexNormals();
    }
    camera.position.set(Math.sin(t * 0.2) * 0.5, 1.9 + Math.sin(t * 0.4) * 0.2, 4.6);
    camera.lookAt(0, -0.2, 0);
  }
}

/* ------------------------------------------------------------- AsciiEffect */

let effect = null;

function glowShadow() {
  if (state.glow <= 0.02) return "none";
  return `0 0 ${Math.round(state.glow * 7)}px rgba(190, 214, 255, ${(0.35 + state.glow * 0.5).toFixed(2)})`;
}

function buildEffect() {
  if (effect) {
    effect.domElement.remove();
    effect = null;
  }
  effect = new AsciiEffect(renderer, charsetSet(), {
    resolution: resolution(),
    scale: 1,
    color: true,
    invert: false
  });
  effect.domElement.className = "il-ascii";
  holder.textContent = "";
  holder.appendChild(effect.domElement);
  const table = effect.domElement.querySelector("table");
  if (table) {
    table.style.background = "transparent";
    table.style.textShadow = glowShadow();
  }
  resize();
}

function resize() {
  const w = Math.max(280, stage.clientWidth || 900);
  const h = Math.max(180, stage.clientHeight || Math.round(w * 0.625));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (effect) effect.setSize(w, h);
  // 宽线着色器按 resolution 把线宽换算到屏幕像素，跟随画布尺寸同步。
  for (const m of materials) if (m.isLineMaterial) m.resolution.set(w, h);
  dirty = true;
}

/* ------------------------------------------------------ 字符快照 / 导出 */

/** 从当前 AsciiEffect 表格读取真实字符与行内颜色（预览与导出共用这一份快照）。 */
function readGlyphRows() {
  const td = effect && effect.domElement ? effect.domElement.querySelector("td") : null;
  if (!td) return null;
  const rows = [];
  let row = [];
  const push = (ch, color) => {
    row.push({ ch: ch === "\u00a0" ? " " : ch, color: color || FALLBACK_COLOR });
  };
  for (const node of td.childNodes) {
    if (node.nodeType === 3) {
      for (const ch of node.nodeValue || "") push(ch, null);
    } else if (node.nodeName === "BR") {
      rows.push(row);
      row = [];
    } else if (node.nodeType === 1) {
      const color = (node.style && node.style.color) || null;
      for (const ch of node.textContent || "") push(ch, color);
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

function glyphStats() {
  const rows = readGlyphRows();
  if (!rows) return { rows: 0, cols: 0, count: 0, colored: 0, colors: 0, chars: 0, signature: "0", colorSignature: "0", avgColor: [0, 0, 0] };
  let cols = 0;
  let count = 0;
  let colored = 0;
  let hash = 0;
  let colorHash = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let lit = 0;
  const colorSet = new Set();
  const charSet = new Set();
  const rgb = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/;
  for (const row of rows) {
    if (row.length > cols) cols = row.length;
    for (const cell of row) {
      count++;
      if (cell.ch !== " ") {
        hash = (Math.imul(hash, 31) + cell.ch.charCodeAt(0)) >>> 0;
        charSet.add(cell.ch);
      }
      if (cell.color) {
        colored++;
        colorSet.add(cell.color);
        const m = rgb.exec(cell.color);
        if (m && cell.ch !== " ") {
          sr += Number(m[1]);
          sg += Number(m[2]);
          sb += Number(m[3]);
          lit++;
          colorHash = (Math.imul(colorHash, 31) + Number(m[1]) * 65536 + Number(m[2]) * 256 + Number(m[3])) >>> 0;
        }
      }
    }
  }
  hash = (hash ^ Math.imul(rows.length, 73856093) ^ Math.imul(cols, 19349663) ^ count) >>> 0;
  colorHash = (colorHash ^ Math.imul(colorSet.size, 2654435761)) >>> 0;
  const avgColor = lit ? [Math.round(sr / lit), Math.round(sg / lit), Math.round(sb / lit)] : [0, 0, 0];
  return {
    rows: rows.length,
    cols,
    count,
    colored,
    colors: colorSet.size,
    chars: charSet.size,
    signature: hash.toString(36),
    colorSignature: colorHash.toString(36),
    avgColor
  };
}

const exportCanvas = document.createElement("canvas");

/**
 * 紧凑视觉信号：从当前字符快照一次性算出
 * - 前景是否不止是横线（非横线字符种类 / 横线占比）；
 * - 前景包围盒四边留白（判断模型有没有被画面裁切，底部尤其关键）；
 * - 下半部前景字符数 / 覆盖行数 / 占列数（判断触手是连续成束还是零星短划）。
 */
function visualSignal() {
  const rows = readGlyphRows();
  if (!rows || !rows.length) return null;
  const dashChars = new Set(["-", "=", "_", "~", "\u2014", "\u2013"]);
  let cols = 0;
  let fg = 0;
  let dash = 0;
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  const varied = new Set();
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (row.length > cols) cols = row.length;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell || cell.ch === " ") continue;
      fg++;
      if (dashChars.has(cell.ch)) dash++;
      else varied.add(cell.ch);
      if (top < 0) top = r;
      bottom = r;
      if (left < 0 || c < left) left = c;
      if (c > right) right = c;
    }
  }
  const mid = top < 0 ? 0 : (top + bottom) / 2;
  let lowerCells = 0;
  let lowerRows = 0;
  const lowerCols = new Set();
  for (let r = 0; r < rows.length; r++) {
    if (r <= mid) continue;
    const row = rows[r];
    let hitRow = false;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell || cell.ch === " ") continue;
      lowerCells++;
      lowerCols.add(c);
      hitRow = true;
    }
    if (hitRow) lowerRows++;
  }
  return {
    rows: rows.length,
    cols,
    fg,
    dash,
    dashRatio: fg ? +(dash / fg).toFixed(3) : 1,
    varied: varied.size,
    top,
    bottom,
    left,
    right,
    topMargin: top,
    bottomMargin: top < 0 ? 0 : rows.length - 1 - bottom,
    leftMargin: left,
    rightMargin: right < 0 ? 0 : cols - 1 - right,
    lowerCells,
    lowerRows,
    lowerCols: lowerCols.size
  };
}

/** 把当前字符快照真正画到 canvas（不是原始网格、不是页面截图）。 */
function buildExportCanvas() {
  const rows = readGlyphRows();
  if (!rows || !rows.length) return null;
  const table = effect.domElement.querySelector("table");
  const cs = table ? getComputedStyle(table) : null;
  const fontSize = cs ? parseFloat(cs.fontSize) || 12 : 12;
  const lineHeight = cs ? parseFloat(cs.lineHeight) || fontSize : fontSize;
  const letterSpacing = cs ? parseFloat(cs.letterSpacing) || 0 : 0;
  const fontFamily = (cs && cs.fontFamily) || '"Courier New", monospace';
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cellW = Math.max(1, fontSize * 0.6 + letterSpacing);
  const W = Math.max(1, Math.round(cols * cellW));
  const H = Math.max(1, Math.round(rows.length * lineHeight));
  const scale = Math.min(1, 2400 / Math.max(W, H));
  exportCanvas.width = Math.round(W * scale);
  exportCanvas.height = Math.round(H * scale);

  const x = exportCanvas.getContext("2d");
  x.setTransform(scale, 0, 0, scale, 0, 0);
  x.fillStyle = BG;
  x.fillRect(0, 0, W, H);
  x.font = `${fontSize}px ${fontFamily}`;
  x.textAlign = "left";
  x.textBaseline = "alphabetic";
  const glow = state.glow;
  if (glow > 0.02) x.shadowBlur = glow * fontSize * 1.1;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const by = r * lineHeight + fontSize * 0.82;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell.ch === " ") continue;
      x.fillStyle = cell.color;
      if (glow > 0.02) x.shadowColor = cell.color;
      x.fillText(cell.ch, c * cellW, by);
    }
  }
  return exportCanvas;
}

/* ---------------------------------------------------------------- 主循环 */

let paused = false;
let time = 0;
let lastTs = null;
let lastHud = 0;
let dirty = true;
let raf = 0;

function setStatus(message) {
  const el = $("status");
  if (el) el.textContent = message;
}

function updateHud(now) {
  if (now - lastHud < 500) return;
  lastHud = now;
  const st = glyphStats();
  $("frame-info").textContent = `${time.toFixed(2)}s · ${st.rows} 行 × ${st.cols} 列`;
  setStatus(
    `${PRESETS[state.preset] ? state.preset : ""} · ${st.count} 个字符单元 · ${st.colored} 个着色 · ${paused ? "已暂停" : "运行中"}`
  );
}

function loop(ts) {
  raf = requestAnimationFrame(loop);
  if (lastTs == null) lastTs = ts;
  const dt = Math.min(64, ts - lastTs) / 1000;
  lastTs = ts;
  if (!paused) {
    time += dt * state.speed;
    updateScene(time);
    dirty = true;
  }
  if (dirty && effect) {
    effect.render(scene, camera);
    dirty = false;
  }
  updateHud(ts);
}

/* ------------------------------------------------------------------ 控件 */

function bindRange(id, key) {
  const range = $("p-" + id);
  const number = $("n-" + id);
  const apply = (raw) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = state[key];
    v = clamp(v, Number(range.min), Number(range.max));
    state[key] = v;
    range.value = String(v);
    number.value = String(v);
    if (key === "density") buildEffect();
    if (key === "glow") {
      const table = effect && effect.domElement.querySelector("table");
      if (table) table.style.textShadow = glowShadow();
    }
    dirty = true;
  };
  range.addEventListener("input", () => apply(range.value));
  number.addEventListener("input", () => apply(number.value));
  number.addEventListener("change", () => apply(number.value));
}

function bindChips(containerId, attribute, onPick) {
  const host = $(containerId);
  if (!host) return;
  host.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-" + attribute + "]");
    if (!btn || !host.contains(btn)) return;
    for (const b of host.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
    onPick(btn.dataset[attribute]);
  });
}

function boot() {
  const select = $("char-pattern");
  for (const c of CHARSETS) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label;
    select.appendChild(opt);
  }
  select.value = state.charsetId;
  select.addEventListener("change", () => {
    state.charsetId = select.value;
    buildEffect();
  });

  bindRange("density", "density");
  bindRange("speed", "speed");
  bindRange("glow", "glow");

  bindChips("preset-chips", "preset", (value) => {
    state.preset = value;
    buildPreset(value);
    $("preset-note").textContent = PRESETS[value] || "";
    dirty = true;
  });
  bindChips("color-chips", "color", (value) => {
    state.color = value;
    applyColor();
    dirty = true;
  });

  $("btn-pause").addEventListener("click", () => {
    paused = true;
  });
  $("btn-play").addEventListener("click", () => {
    paused = false;
    lastTs = null;
    dirty = true;
  });
  $("btn-export").addEventListener("click", () => {
    const c = buildExportCanvas();
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ascii-motion-${state.preset}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  });

  buildPreset(state.preset);
  $("preset-note").textContent = PRESETS[state.preset];
  buildEffect();
  updateScene(0);

  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => resize());
    ro.observe(stage);
  } else {
    window.addEventListener("resize", () => resize());
  }
  raf = requestAnimationFrame(loop);
}

/* 测试 / 验收钩子：只读状态 + 活跃查找，便于浏览器验收断言。 */
window.imagelab = {
  ready: false,
  preset: () => state.preset,
  paused: () => paused,
  frame: () => time,
  resolution: () => resolution(),
  presetCount: () => Object.keys(PRESETS).length,
  charsets: () => CHARSETS.map((c) => c.id),
  stats: () => glyphStats(),
  signature: () => glyphStats().signature,
  visualSignal: () => visualSignal(),
  exportSize: () => {
    const c = buildExportCanvas();
    return c ? { width: c.width, height: c.height } : null;
  },
  exportDataURL: () => {
    const c = buildExportCanvas();
    return c ? c.toDataURL("image/png") : null;
  }
};

try {
  boot();
  window.imagelab.ready = true;
} catch (err) {
  setStatus(`初始化失败：${err && err.message ? err.message : err}`);
  window.imagelab.ready = false;
}
