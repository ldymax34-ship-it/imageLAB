/*
 * tools/ascii-motion · 动态字符画
 *
 * 用 three（MIT，仓库已锁定 0.186.1）搭真实的三维动画，再将有界低分辨率采样绘到
 * 一张复用的 Canvas 2D 字符画画布。没有自定义着色器、
 * 没有外部模型 / 贴图 / 字体。
 *
 * 水母触手用 three 自带 `addons/lines`（Line2 + LineGeometry + LineMaterial，均 MIT）
 * 画原生宽线：1 像素的 LineBasicMaterial 在字符采样格里会碎成孤立短划，宽线能保持连续；
 * 每帧只原地改写 instanceStart / instanceEnd 共用的数据，不重建、不销毁几何体。
 *
 * 预览与 PNG 导出使用同一张 Canvas，固定最多 160×100 字符格；暂停与隐藏页面停止 RAF。
 */

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { mountCategoryTabs } from "../../assets/workspace.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const DEFAULT_CHARSET = " .:-=+*#%@";
const CHARSETS = [
  { id: "standard", label: "经典 .:-=+*%@", set: DEFAULT_CHARSET },
  { id: "soft", label: "柔和 .·:*#@", set: " .·:*#@" },
  { id: "blocks", label: "方块 ░▒▓█", set: " ░▒▓█" },
  { id: "dense", label: "密集 .,:;i1tfLCG08@", set: " .,:;i1tfLCG08@" }
];
let charset = DEFAULT_CHARSET, glyphPalette = Array.from(DEFAULT_CHARSET), glyphIndices = new Uint8Array(16000), glyphColors = new Uint32Array(16000);
let customMode = "scene", motion = "wave", customText = "", customImage = null, customImageHasAlpha = false, imageHasAlpha = false, imageSampling = "auto", loadToken = 0, customPlane = null, customTexture = null, lastFrameAt = 0, accentRgb = 0xb8c6ff;
const MAX_FILE = 10 * 1024 * 1024, MAX_SIDE = 4096;

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

function resolution() { return 0.09 + state.density * 0.11; }
function splitGlyphs(value) { const seg=typeof Intl.Segmenter==="function"?new Intl.Segmenter(undefined,{granularity:"grapheme"}):null; return (seg?[...seg.segment(value)].map(x=>x.segment):Array.from(value)); }
function setCharset(value) {
  const chars = splitGlyphs(value);
  if (!chars.some((glyph) => glyph.trim())) return "empty";
  if (chars.length > 64) return "limit";
  charset = chars.join("");
  glyphPalette = chars;
  state.charsetId = "custom";
  return "ok";
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
    rings.push({ mesh, speed: s.speed, baseX: s.rx, baseY: s.ry, baseZ: 0 });
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
      rr.mesh.rotation.z = rr.baseZ + t * 0.32 * rr.speed;
      rr.mesh.rotation.y = rr.baseY + t * 0.2 * rr.speed;
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

/* ----------------------------------------------- Canvas glyph renderer */
let effect = null;
const outputCanvas = document.createElement("canvas");
const outCtx = outputCanvas.getContext("2d");
const sampleCanvas = document.createElement("canvas");
const glowCanvas=document.createElement("canvas"),glowCtx=glowCanvas.getContext("2d");
const crispCanvas=document.createElement("canvas"),crispCtx=crispCanvas.getContext("2d");
const colorCache = Array.from({ length: 4096 }, (_, i) => {
  const r = ((i >> 8) & 15) * 17;
  const g = ((i >> 4) & 15) * 17;
  const b = (i & 15) * 17;
  return `rgb(${r},${g},${b})`;
});
const sampleCtx = sampleCanvas.getContext("2d",{willReadFrequently:true});
let sampleCols=0,sampleRows=0,frameCount=0,lastRenderMs=0;
function buildEffect(){ effect=true; holder.replaceChildren(outputCanvas); outputCanvas.className="il-ascii"; resize(); }
function resize() {
  const width = Math.max(280, stage.clientWidth || 900);
  const height = Math.max(180, stage.clientHeight || Math.round(width * 0.625));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5, 1600 / width, 1600 / height);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height);
  outputCanvas.width = Math.round(width * dpr);
  outputCanvas.height = Math.round(height * dpr);
  crispCanvas.width = outputCanvas.width;
  crispCanvas.height = outputCanvas.height;
  glowCanvas.width = Math.ceil(outputCanvas.width / 8);
  glowCanvas.height = Math.ceil(outputCanvas.height / 8);
  outputCanvas.style.width = "100%";
  outputCanvas.style.height = "100%";
  sampleCols = Math.min(160, Math.max(20, Math.floor(width / (16 - state.density * 5))));
  sampleRows = Math.min(100, Math.max(12, Math.floor(height / (17 - state.density * 5))));
  sampleCanvas.width = sampleCols;
  sampleCanvas.height = sampleRows;
  for (const material of materials) {
    if (material.isLineMaterial) material.resolution.set(width, height);
  }
  schedule();
}
function renderFrame() {
  const started = performance.now();
  renderer.render(scene, camera);
  sampleCtx.clearRect(0, 0, sampleCols, sampleRows);
  sampleCtx.drawImage(renderer.domElement, 0, 0, sampleCols, sampleRows);
  const pixels = sampleCtx.getImageData(0, 0, sampleCols, sampleRows).data;
  const cellWidth = outputCanvas.width / sampleCols;
  const cellHeight = outputCanvas.height / sampleRows;
  crispCtx.clearRect(0, 0, crispCanvas.width, crispCanvas.height);
  crispCtx.font = `${Math.max(7, Math.min(cellWidth, cellHeight) * 0.92)}px ui-monospace, Menlo, monospace`;
  crispCtx.textAlign = "center";
  crispCtx.textBaseline = "middle";
  outCtx.fillStyle = BG;
  outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  const alphaMode = customMode === "image" && (imageSampling === "alpha" || (imageSampling === "auto" && imageHasAlpha));
  for (let y = 0; y < sampleRows; y += 1) {
    for (let x = 0; x < sampleCols; x += 1) {
      const cellIndex = y * sampleCols + x;
      const pixelIndex = cellIndex * 4;
      const alpha = pixels[pixelIndex + 3] / 255;
      const red = pixels[pixelIndex];
      const green = pixels[pixelIndex + 1];
      const blue = pixels[pixelIndex + 2];
      let brightness = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 * alpha;
      if (alphaMode) brightness = alpha;
      else if (customMode === "image" && imageSampling === "invert") brightness = (1 - (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255) * alpha;
      let glyphIndex = brightness < 0.025
        ? 255
        : Math.max(0, Math.min(glyphPalette.length - 1, Math.floor(brightness * (glyphPalette.length - 1))));
      if (glyphIndex !== 255 && !glyphPalette[glyphIndex].trim()) glyphIndex = 255;
      glyphIndices[cellIndex] = glyphIndex;
      glyphColors[cellIndex] = alphaMode ? accentRgb : ((red << 16) | (green << 8) | blue);
      if (glyphIndex === 255) continue;
      const color = glyphColors[cellIndex];
      crispCtx.fillStyle = alphaMode
        ? state.color
        : colorCache[(((color >> 16) & 240) << 4) | (((color >> 8) & 240)) | ((color & 240) >> 4)];
      crispCtx.fillText(glyphPalette[glyphIndex], (x + 0.5) * cellWidth, (y + 0.5) * cellHeight);
    }
  }

  if (state.glow > 0.02) {
    glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    glowCtx.drawImage(crispCanvas, 0, 0, glowCanvas.width, glowCanvas.height);
    outCtx.fillStyle = BG;
    outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    outCtx.save();
    outCtx.globalCompositeOperation = "lighter";
    outCtx.globalAlpha = state.glow * 0.5;
    outCtx.filter = `blur(${2 + state.glow * 4}px)`;
    outCtx.drawImage(glowCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
    outCtx.restore();
    outCtx.drawImage(crispCanvas, 0, 0);
  } else {
    outCtx.drawImage(crispCanvas, 0, 0);
  }
  frameCount += 1;
  lastRenderMs = performance.now() - started;
}
function glyphStats() {
  let colored = 0;
  let count = sampleCols * sampleRows;
  let hash = 0;
  let colorHash = 0;
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let lit = 0;
  const chars = new Set();
  const colors = new Set();
  for (let i = 0; i < count; i += 1) {
    const index = glyphIndices[i];
    if (index === 255) continue;
    const glyph = glyphPalette[index];
    const rgb = glyphColors[i];
    hash = (Math.imul(hash, 31) + glyph.codePointAt(0)) >>> 0;
    chars.add(glyph);
    colored += 1;
    const red = (rgb >> 16) & 255;
    const green = (rgb >> 8) & 255;
    const blue = rgb & 255;
    redTotal += red;
    greenTotal += green;
    blueTotal += blue;
    lit += 1;
    colors.add(rgb.toString(16));
    colorHash = (Math.imul(colorHash, 31) + rgb) >>> 0;
  }
  hash = (hash ^ Math.imul(sampleRows, 73856093) ^ Math.imul(sampleCols, 19349663) ^ count) >>> 0;
  return {
    rows: sampleRows,
    cols: sampleCols,
    count,
    colored,
    colors: colors.size,
    chars: chars.size,
    signature: hash.toString(36),
    colorSignature: colorHash.toString(36),
    avgColor: lit
      ? [Math.round(redTotal / lit), Math.round(greenTotal / lit), Math.round(blueTotal / lit)]
      : [0, 0, 0]
  };
}
function visualSignal(){let fg=0,top=-1,bottom=-1,left=sampleCols,right=-1;const varied=new Set(),lowerCols=new Set();for(let y=0;y<sampleRows;y++)for(let x=0;x<sampleCols;x++){const i=y*sampleCols+x;if(glyphIndices[i]===255)continue;fg++;varied.add(glyphPalette[glyphIndices[i]]);if(top<0)top=y;bottom=y;left=Math.min(left,x);right=Math.max(right,x);}const mid=(top+bottom)/2;let lowerCells=0,lowerRows=0;for(let y=0;y<sampleRows;y++){if(y<=mid)continue;let hit=false;for(let x=0;x<sampleCols;x++)if(glyphIndices[y*sampleCols+x]!==255){lowerCells++;lowerCols.add(x);hit=true;}if(hit)lowerRows++;}return{rows:sampleRows,cols:sampleCols,fg,varied:varied.size,top,bottom,left,right,topMargin:top,bottomMargin:top<0?0:sampleRows-1-bottom,leftMargin:left,rightMargin:right<0?0:sampleCols-1-right,lowerCells,lowerRows,lowerCols:lowerCols.size,dashRatio:0};}
const exportCanvas=outputCanvas;
function buildExportCanvas(){return sampleCols&&sampleRows?outputCanvas:null;}
function updateCustomTexture() {
  if (!customPlane) return;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (customMode === "image" && customImage) {
    const scale = Math.min(
      canvas.width / customImage.naturalWidth,
      canvas.height / customImage.naturalHeight
    );
    const width = customImage.naturalWidth * scale;
    const height = customImage.naturalHeight * scale;
    context.drawImage(customImage, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  } else {
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "bold 90px sans-serif";
    const lines = customText.split("\n").slice(0, 5);
    lines.forEach((line, index) => context.fillText(line, canvas.width / 2, canvas.height * (0.3 + index * 0.1), 900));
  }
  if (customTexture) customTexture.dispose();
  customTexture = new THREE.CanvasTexture(canvas);
  customTexture.colorSpace = THREE.SRGBColorSpace;
  customPlane.material.map = customTexture;
  customPlane.material.needsUpdate = true;
}

function setCustomMode(mode) {
  customMode = mode;
  const presetSection = $("preset-chips").closest(".il-group");
  presetSection.hidden = mode !== "scene";
  $("custom-text").hidden = mode !== "text";
  $("custom-image-label").hidden = mode !== "image";
  if (customTexture) {
    customTexture.dispose();
    customTexture = null;
  }
  if (mode === "scene") {
    imageHasAlpha = false;
    customPlane = null;
    buildPreset(state.preset);
  } else {
    imageHasAlpha = mode === "image" && customImageHasAlpha;
    clearRoot();
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    camera.position.set(0, 0.5, 5.4);
    camera.lookAt(0, 0, 0);
    const geometry = track(new THREE.PlaneGeometry(4.7, 2.35, 20, 10));
    const material = new THREE.MeshBasicMaterial({ transparent: true, map: null, side: THREE.DoubleSide });
    materials.push(material);
    customPlane = new THREE.Mesh(geometry, material);
    root.add(customPlane);
    updateCustomTexture();
  }
  schedule();
}

function loadCustomImage(file) {
  if (!file) return;
  const token = ++loadToken;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > MAX_FILE) {
    $("custom-image-name").textContent = "仅支持 10 MiB 内的 PNG / JPEG / WebP。";
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    if (token !== loadToken) return;
    if (image.naturalWidth > MAX_SIDE || image.naturalHeight > MAX_SIDE) {
      $("custom-image-name").textContent = "图片单边超过 4096 像素，已保留当前图片。";
      return;
    }
    customImage = image;
    const probe = document.createElement("canvas");
    if (image.naturalWidth >= image.naturalHeight) {
      probe.width = 64;
      probe.height = Math.max(1, Math.round(64 * image.naturalHeight / image.naturalWidth));
    } else {
      probe.height = 64;
      probe.width = Math.max(1, Math.round(64 * image.naturalWidth / image.naturalHeight));
    }
    const probeContext = probe.getContext("2d", { willReadFrequently: true });
    probeContext.drawImage(image, 0, 0, probe.width, probe.height);
    const alphaPixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
    customImageHasAlpha = false;
    for (let i = 3; i < alphaPixels.length; i += 4) {
      if (alphaPixels[i] < 250) {
        customImageHasAlpha = true;
        break;
      }
    }
    imageHasAlpha = customMode === "image" && customImageHasAlpha;
    $("custom-image-name").textContent = `已载入：${file.name}`;
    if (customMode === "image") updateCustomTexture();
    schedule();
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    if (token === loadToken) $("custom-image-name").textContent = "图片解码失败，已保留当前图片。";
  };
  image.src = url;
}
function updateCustomMotion(t) {
  if (!customPlane) return;
  const position = customPlane.geometry.attributes.position;
  if (motion === "rotate") {
    customPlane.rotation.z = t * 0.35;
    customPlane.scale.set(1, 1, 1);
  } else if (motion === "breathe") {
    const scale = 1 + 0.08 * Math.sin(t * 1.5);
    customPlane.scale.set(scale, scale, 1);
    customPlane.rotation.z = 0;
  } else {
    customPlane.scale.set(1, 1, 1);
    customPlane.rotation.z = 0;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      position.setZ(i, 0.11 * Math.sin(x * 2.1 + t * 1.5) * Math.cos(y * 1.7 - t));
    }
    position.needsUpdate = true;
  }
}
/* ---------------------------------------------------------------- 主循环 */

let paused = false;
let time = 0;
let lastTs = null;
let lastHud = 0;
let dirty = true;
let raf = 0;

function schedule(){dirty=true;if(document.hidden)return;if(paused){if(customMode==="scene")updateScene(time);else updateCustomMotion(time);if(effect){renderFrame();dirty=false;}return;}if(!raf)raf=requestAnimationFrame(loop);}

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
  raf = 0;
  if (document.hidden) return;
  if (lastTs == null) lastTs = ts;
  if (!paused && ts-lastFrameAt < 33) { raf=requestAnimationFrame(loop); return; }
  lastFrameAt=ts;
  const dt = Math.min(64, ts - lastTs) / 1000;
  lastTs = ts;
  if (!paused) {
    time += dt * state.speed;
    if(customMode==="scene") updateScene(time); else updateCustomMotion(time);
    dirty = true;
  }
  if (dirty && effect) {
    renderFrame();
    dirty = false;
  }
  updateHud(ts);
  if(!paused) raf=requestAnimationFrame(loop);
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
    schedule();
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
  const charsetSelect = $("char-pattern");
  for (const preset of CHARSETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    charsetSelect.appendChild(option);
  }
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "自定义";
  charsetSelect.appendChild(customOption);
  charsetSelect.value = state.charsetId;
  charsetSelect.addEventListener("change", () => {
    const preset = CHARSETS.find((item) => item.id === charsetSelect.value);
    if (!preset) return;
    charset = preset.set;
    glyphPalette = splitGlyphs(charset);
    state.charsetId = preset.id;
    $("charset-input").value = charset;
    schedule();
  });
  bindRange("density", "density"); bindRange("speed", "speed"); bindRange("glow", "glow");
  bindChips("preset-chips", "preset", (value) => { state.preset=value; buildPreset(value); $("preset-note").textContent=PRESETS[value]||""; schedule(); });
  bindChips("color-chips", "color", (value) => { state.color=value; accentRgb=parseInt(value.slice(1),16); applyColor(); schedule(); });
  $("charset-input").addEventListener("input",e=>{const result=setCharset(e.target.value);if(result==="ok"){charsetSelect.value="custom";schedule();}else{e.target.value=charset;$("status").textContent=result==="limit"?"字符集最多 64 个字素，已保留上一次有效设置。":"字符集不能空白，已保留上一次有效设置。";}});
  document.querySelectorAll("[data-custom-mode]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-custom-mode]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));setCustomMode(b.dataset.customMode);}));
  document.querySelectorAll("[data-motion]").forEach(b=>b.addEventListener("click",()=>{motion=b.dataset.motion;if(customPlane&&motion!=="wave"){const pos=customPlane.geometry.attributes.position;for(let i=0;i<pos.count;i++)pos.setZ(i,0);pos.needsUpdate=true;}if(customMode!=="scene")updateCustomMotion(time);document.querySelectorAll("[data-motion]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));schedule();}));
  $("custom-text").addEventListener("input",e=>{customText=e.target.value.slice(0,160);if(customMode==="text")updateCustomTexture();schedule();});
  $("custom-image-file").addEventListener("change",e=>loadCustomImage(e.target.files&&e.target.files[0]));
  $("image-sampling").addEventListener("change",e=>{imageSampling=e.target.value;schedule();});
  $("btn-pause").addEventListener("click",()=>{paused=true;if(raf)cancelAnimationFrame(raf);raf=0;});
  $("btn-play").addEventListener("click",()=>{paused=false;lastTs=null;dirty=true;if(!raf)raf=requestAnimationFrame(loop);});
  $("btn-export").addEventListener("click",()=>{if(dirty)renderFrame();const c=buildExportCanvas();if(!c)return;c.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="ascii-motion.png";a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);},"image/png");});
  buildPreset(state.preset);$("preset-note").textContent=PRESETS[state.preset];buildEffect();updateScene(0);
  if(typeof ResizeObserver==="function")new ResizeObserver(resize).observe(stage);else window.addEventListener("resize",resize);
  document.addEventListener("visibilitychange",()=>{if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;}else{lastTs=null;if(dirty||paused)schedule();else if(!raf)raf=requestAnimationFrame(loop);}});if(!raf)raf=requestAnimationFrame(loop);
}

/* 测试 / 验收钩子：只读状态 + 活跃查找，便于浏览器验收断言。 */
window.imagelab = {
  ready: false,
  preset: () => state.preset,
  paused: () => paused,
  frame: () => time,
  resolution: () => resolution(),
  presetCount: () => Object.keys(PRESETS).length,
  charsets: () => CHARSETS.map((preset) => preset.id),
  charsetGlyphs: () => glyphPalette.slice(),
  setCharset: (v) => setCharset(v),
  mode: () => customMode,
  motion: () => motion,
  diagnostics: () => ({cells:sampleCols*sampleRows,renderMs:lastRenderMs,renderCount:frameCount,alphaMode:customMode==="image"&&(imageSampling==="alpha"||(imageSampling==="auto"&&imageHasAlpha))}),
  hasImage: () => !!customImage,
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
  mountCategoryTabs();
  boot();
  window.imagelab.ready = true;
} catch (err) {
  setStatus(`初始化失败：${err && err.message ? err.message : err}`);
  window.imagelab.ready = false;
}
