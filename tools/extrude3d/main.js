/**
 * SVG立体 · imageLAB 工具⑧
 *
 * 全部能力都是「官方现成件 + 上游库」的接线：
 *   - 解析 / 挤出 / 平滑法线 / 三平面 UV：`@visant/extrude3d`（MIT，0.1.0）
 *   - 渲染 / PBR 材质 / 环境反射 / 轨道控制：`three` 0.186.1（MIT）
 *   - 反射环境：three 自带 `RoomEnvironment` + `PMREMGenerator`（程序化，无远程 HDRI）
 * 没有自研渲染、自研着色器、自研几何算法。
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  MATERIAL_UI,
  buildExtrudedGeometry,
  getSimpleMaterialProps,
  materialPresets,
  parseShapesFromSVG,
  resolveMaterial
} from "@visant/extrude3d";
import { LIMITS, inspectShapes, inspectSvg } from "./svg-guard.js";

/* 样例以内联文本方式打包（?raw），首次加载即可显示，且不产生任何网络请求。 */
import hexNestSvg from "./samples/hex-nest.svg?raw";
import letterAStarSvg from "./samples/letter-a-star.svg?raw";
import squareRingSvg from "./samples/square-ring.svg?raw";

const SAMPLES = {
  "square-ring": { name: "square-ring.svg", text: squareRingSvg },
  "letter-a-star": { name: "letter-a-star.svg", text: letterAStarSvg },
  "hex-nest": { name: "hex-nest.svg", text: hexNestSvg }
};

/** MATERIAL_UI 精选列表里没有、但 materialPresets 中存在的预设（如实标注，不隐藏）。 */
const EXTRA_PRESET_IDS = Object.keys(materialPresets).filter(
  (id) => !MATERIAL_UI.some((entry) => entry.id === id)
);

const CATEGORY_LABELS = {
  basic: "基础",
  metals: "金属",
  surfaces: "表面",
  glass: "玻璃 / 透射",
  special: "特殊"
};

/**
 * 界面上显示的材质中文名。
 * 只用于下拉显示；下游始终把 value（上游 preset id）原样交给材质库。
 * 库来源与「陶瓷不在上游界面精选里」这件事写在 THIRD_PARTY.md，页面不展开。
 */
const MATERIAL_LABELS_ZH = {
  default: "默认",
  plastic: "塑料",
  clay: "陶土",
  emissive: "自发光",
  chrome: "镜面金属",
  brushedSteel: "拉丝钢",
  gold: "黄金",
  roseGold: "玫瑰金",
  copper: "紫铜",
  marble: "大理石",
  wood: "木纹",
  leather: "皮革",
  carbonFiber: "碳纤维",
  carPaint: "车漆",
  glass: "透明玻璃",
  frostedGlass: "磨砂玻璃",
  diamond: "水晶效果",
  pearl: "珍珠",
  obsidian: "黑曜石",
  holographic: "镭射",
  y2kGloss: "亮面",
  liquidChrome: "液态金属",
  titanium: "钛",
  candyInflate: "糖果塑料",
  soapBubble: "肥皂泡",
  opal: "欧泊",
  neonTube: "霓虹管",
  resin: "树脂",
  metal: "金属",
  rubber: "橡胶",
  aluminum: "铝",
  platinum: "铂金",
  ceramic: "陶瓷",
  concrete: "混凝土",
  velvet: "天鹅绒",
  ice: "冰",
  wax: "蜡",
  mattePaint: "哑光漆"
};

/** 下拉里显示的短名：中文优先，缺中文名才退回上游英文短名，都不重复 id。 */
function materialLabel(id) {
  return MATERIAL_LABELS_ZH[id] || materialPresets[id]?.label || id;
}

/** 预设没写颜色时的中性兜底色（仅 UI 取色，不参与任何 PBR 公式）。 */
const FALLBACK_COLOR = "#c9c4bd";

const els = {
  sample: document.getElementById("sample"),
  file: document.getElementById("svg-file"),
  name: document.getElementById("svg-name"),

  depth: document.getElementById("depth"),
  depthOut: document.getElementById("depth-out"),
  bevelEnabled: document.getElementById("bevel-enabled"),
  bevelThickness: document.getElementById("bevel-thickness"),
  bevelThicknessOut: document.getElementById("bevel-thickness-out"),
  bevelSize: document.getElementById("bevel-size"),
  bevelSizeOut: document.getElementById("bevel-size-out"),
  smoothness: document.getElementById("smoothness"),
  smoothnessOut: document.getElementById("smoothness-out"),

  material: document.getElementById("material"),
  colorOverride: document.getElementById("color-override"),
  color: document.getElementById("color"),
  roughnessOverride: document.getElementById("roughness-override"),
  roughness: document.getElementById("roughness"),
  roughnessOut: document.getElementById("roughness-out"),
  textureFile: document.getElementById("texture-file"),
  textureRemove: document.getElementById("texture-remove"),
  textureName: document.getElementById("texture-name"),

  envIntensity: document.getElementById("env-intensity"),
  envIntensityOut: document.getElementById("env-intensity-out"),
  exposure: document.getElementById("exposure"),
  exposureOut: document.getElementById("exposure-out"),
  bg: document.getElementById("bg"),
  transparentBg: document.getElementById("transparent-bg"),

  resetView: document.getElementById("reset-view"),
  exportScale: document.getElementById("export-scale"),
  exportPng: document.getElementById("export-png"),

  view: document.getElementById("view"),
  canvas: document.getElementById("view-canvas"),
  error: document.getElementById("error"),
  status: document.getElementById("status"),
  stats: document.getElementById("stats")
};

const state = {
  svgText: "",
  svgName: "",
  depth: 1.6,
  bevelEnabled: true,
  bevelThickness: 0.5,
  bevelSize: 0.5,
  smoothness: 0.5,
  preset: "chrome",
  colorOverride: false,
  color: FALLBACK_COLOR,
  roughnessOverride: false,
  roughness: 0.3,
  textureName: "",
  textureWidth: 0,
  textureHeight: 0,
  envIntensity: 1,
  exposure: 1,
  bg: "#efede8",
  transparent: false,
  shapeCount: 0,
  vertexCount: 0,
  lastError: null
};

/* ------------------------------------------------------------------ 渲染器 */

const renderer = new THREE.WebGLRenderer({
  canvas: els.canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true // 导出 PNG 时直接读 canvas 像素
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = state.exposure;
renderer.setClearAlpha(1);

const scene = new THREE.Scene();

const VIEW_DISTANCE = 8.6;
const VIEW_DIR = new THREE.Vector3(3.0, 2.2, 6.0).normalize();

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.copy(VIEW_DIR).multiplyScalar(VIEW_DISTANCE);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 32;
controls.target.set(0, 0, 0);
controls.update();

/**
 * 取景：按当前几何「离原点的最大距离」+ 相机 fov 算一个刚好装下包围球的距离，
 * 同时保留用户自己的缩放比例（旋转/平移不受影响）。
 * 取的是顶点到原点的精确最大距离（几何已按包围盒中心平移到原点），
 * 因此 asin(R/d) < fov/2 恒成立，模型不会被裁切。
 * 只用 three 的 MathUtils 与三角函数，没有自研渲染。
 */
let fittedDistance = 0;
let hasGeometry = false;
let geometryRadius = 1;

function computeFitDistance() {
  const radius = Math.max(geometryRadius, 0.05);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(camera.aspect, 0.2));
  const distance = Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2));
  return distance * 1.12;
}

function setViewDistance(distance) {
  const clamped = THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance);
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 1e-9) direction.copy(VIEW_DIR);
  direction.normalize();
  camera.position.copy(controls.target).addScaledVector(direction, clamped);
  controls.update();
}

function refitView() {
  const next = computeFitDistance();
  const current = camera.position.distanceTo(controls.target);
  const userZoom =
    fittedDistance > 0.01 ? THREE.MathUtils.clamp(current / fittedDistance, 0.3, 3) : 1;
  fittedDistance = next;
  setViewDistance(next * userZoom);
}

/* 程序化环境反射：three 自带 RoomEnvironment → PMREM，无任何远程 HDRI。 */
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = new RoomEnvironment();
const envRT = pmrem.fromScene(roomEnv, 0.04);
scene.environment = envRT.texture;
scene.environmentIntensity = state.envIntensity;
roomEnv.dispose();
pmrem.dispose();

/* 网格：几何由上游构建，材质由上游预设解析。 */
const mesh = new THREE.Mesh(new THREE.BufferGeometry(), createMaterial());
mesh.rotation.x = Math.PI; // three 的 SVGLoader 输出 Y 向下，转过来与 SVG 观感一致（挤出体关于 z 中面对称）
scene.add(mesh);

function createMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.4 });
}

/* ------------------------------------------------------------------ 背景 */

function applyBackground() {
  const color = new THREE.Color(state.bg);
  if (state.transparent) {
    renderer.setClearColor(color, 0);
    renderer.setClearAlpha(0);
    els.view.style.background = "transparent";
  } else {
    renderer.setClearColor(color, 1);
    renderer.setClearAlpha(1);
    els.view.style.background = "";
  }
}

/* ------------------------------------------------------------------ 材质 */

function presetColor(id) {
  const ui = MATERIAL_UI.find((entry) => entry.id === id);
  return (ui && ui.color) || FALLBACK_COLOR;
}

/** 下拉：材质预设按类别分组；上游界面精选之外的预设收进「更多材质」。 */
function buildMaterialSelect() {
  const groups = new Map();
  for (const entry of MATERIAL_UI) {
    const key = entry.category || "special";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [category, entries] of groups) {
    const group = document.createElement("optgroup");
    group.label = CATEGORY_LABELS[category] || category;
    for (const entry of entries) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = materialLabel(entry.id);
      group.appendChild(option);
    }
    els.material.appendChild(group);
  }

  if (EXTRA_PRESET_IDS.length) {
    const group = document.createElement("optgroup");
    group.label = "更多材质";
    for (const id of EXTRA_PRESET_IDS) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = materialLabel(id);
      group.appendChild(option);
    }
    els.material.appendChild(group);
  }
}

/** 预设 → MeshPhysicalMaterial：PBR 数值一律来自上游 helper，本工具不自己写参数公式。 */
function applyMaterial() {
  const overrides = {};
  if (state.roughnessOverride) overrides.roughness = state.roughness;

  const resolved = resolveMaterial(state.preset, overrides);
  // 贴图激活且未自定义颜色时基色用纯白，让贴图按原色显示；勾选自定义颜色则给贴图染色。
  const colorHex = state.colorOverride
    ? state.color
    : surfaceTexture
      ? "#ffffff"
      : presetColor(state.preset);
  const simple = getSimpleMaterialProps(state.preset, colorHex);

  const props = {
    color: new THREE.Color(simple.color),
    map: surfaceTexture, // 上游三平面 UV；材质切换 / 几何重建都不影响这张贴图
    metalness: resolved.metalness,
    roughness: resolved.roughness,
    opacity: resolved.opacity,
    transparent: resolved.transparent,
    emissive: new THREE.Color(simple.emissive),
    emissiveIntensity: simple.emissiveIntensity,
    clearcoat: simple.clearcoat,
    clearcoatRoughness: simple.clearcoatRoughness,
    sheen: simple.sheen,
    sheenRoughness: simple.sheenRoughness,
    transmission: simple.transmission,
    ior: simple.ior,
    iridescence: simple.iridescence,
    reflectivity: resolved.reflectivity,
    thickness: resolved.thickness,
    iridescenceIOR: resolved.iridescenceIOR,
    sheenColor: resolved.sheenColor ? new THREE.Color(resolved.sheenColor) : undefined,
    side: THREE.FrontSide
  };
  for (const key of Object.keys(props)) {
    if (props[key] === undefined) delete props[key];
  }

  const previous = mesh.material;
  mesh.material = new THREE.MeshPhysicalMaterial(props);
  if (previous) previous.dispose();

  els.color.value = state.colorOverride ? state.color : presetColor(state.preset);
}

/* ------------------------------------------------------------- 表面贴图 */

/**
 * 基础色表面贴图：用户本地图片 → three `TextureLoader`（blob URL）→ `MeshPhysicalMaterial.map`。
 * 只用上游已生成的三平面 UV，不写自定义着色器 / UV 算法，不打包任何贴图素材，
 * 也不提供法线 / 粗糙度 / 置换贴图编辑器。素材仅在本地读取，不发起网络请求。
 */
const TEXTURE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxSide: 4096,
  mimeTypes: ["image/png", "image/jpeg", "image/webp"]
};

let surfaceTexture = null;
let textureSeq = 0;

/** 供既有调试钩子读取的最小贴图元信息（无贴图时为 null）。 */
function textureInfo() {
  if (!surfaceTexture) return null;
  const image = surfaceTexture.image || {};
  return {
    name: state.textureName,
    width: image.width || state.textureWidth || 0,
    height: image.height || state.textureHeight || 0
  };
}

/** 贴图被拒绝 / 解码失败：给出中文原因，保留当前有效贴图与模型。 */
function rejectTexture(reason) {
  setError(reason, "贴图未更换");
  setStatus("贴图未更换 · 保留当前贴图与模型");
  els.textureFile.value = "";
}

/** 贴图读取成功：校验实际解码尺寸后才换上，被替换的旧贴图立即释放。 */
function acceptTexture(texture, file) {
  const image = texture.image || {};
  const width = image.width || 0;
  const height = image.height || 0;

  if (!width || !height) {
    texture.dispose();
    rejectTexture("贴图读取失败：无法取得图像尺寸，可能不是有效的图片。");
    return;
  }
  if (width > TEXTURE_LIMITS.maxSide || height > TEXTURE_LIMITS.maxSide) {
    texture.dispose();
    rejectTexture(
      `贴图尺寸过大：${width}×${height} 像素，单边上限 ${TEXTURE_LIMITS.maxSide} 像素。请先缩小图片再上传。`
    );
    return;
  }

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  texture.needsUpdate = true;

  const previous = surfaceTexture;
  surfaceTexture = texture;
  state.textureName = file.name;
  state.textureWidth = width;
  state.textureHeight = height;
  if (previous && previous !== texture) previous.dispose(); // 释放被替换的贴图

  applyMaterial();
  els.textureName.textContent = file.name;
  els.textureName.title = `${file.name} · ${width}×${height}`;
  setError(null);
  setStatus(`已应用表面贴图 · ${file.name} · ${width}×${height}`);
  els.textureFile.value = "";
}

/**
 * 读取并校验本地图片：MIME 白名单 → 体积上限 → blob URL → three TextureLoader →
 * 实际解码尺寸。序列号用于丢弃过期回调（含加载中点「移除贴图」）；任何失败都不覆盖当前贴图。
 */
function loadTextureFile(file) {
  if (!file) return;

  // 每一次新的选择都先作废更早的「进行中」加载，即使这次选择随后会因
  // 类型 / 体积被拒。否则被拒文件的错误提示会被过期回调 acceptTexture 清掉，
  // 并错误地换上更早那次选择里的贴图。
  const seq = ++textureSeq;

  if (!TEXTURE_LIMITS.mimeTypes.includes(file.type)) {
    rejectTexture(
      `已拒绝贴图：仅支持 PNG / JPEG / WebP，当前文件类型「${file.type || "未知"}」。`
    );
    return;
  }
  if (file.size > TEXTURE_LIMITS.maxBytes) {
    rejectTexture(
      `已拒绝贴图：文件过大（${(file.size / 1024 / 1024).toFixed(1)} MiB，上限 10 MiB）。请先压缩图片。`
    );
    return;
  }

  const url = URL.createObjectURL(file);
  setStatus(`正在读取贴图 · ${file.name}…`);

  const loader = new THREE.TextureLoader();
  loader.load(
    url,
    (texture) => {
      try {
        if (seq !== textureSeq) {
          texture.dispose(); // 过期回调：不覆盖更新一次的选择
          return;
        }
        acceptTexture(texture, file);
      } catch (error) {
        if (surfaceTexture !== texture) texture.dispose();
        if (seq === textureSeq) {
          rejectTexture(`贴图读取失败：${error && error.message ? error.message : String(error)}`);
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    undefined,
    () => {
      URL.revokeObjectURL(url);
      if (seq === textureSeq) {
        rejectTexture("贴图解码失败：文件不是有效的 PNG / JPEG / WebP 图像。");
      }
    }
  );
}

/** 移除贴图：释放当前贴图、作废进行中的加载回调，并恢复材质预设颜色。 */
function removeTexture() {
  textureSeq += 1; // 让进行中的加载回调过期
  els.textureFile.value = "";
  if (!surfaceTexture) {
    els.textureName.textContent = "未使用贴图";
    els.textureName.title = "当前没有使用表面贴图";
    setStatus("当前没有表面贴图");
    return;
  }
  surfaceTexture.dispose();
  surfaceTexture = null;
  state.textureName = "";
  state.textureWidth = 0;
  state.textureHeight = 0;
  applyMaterial();
  els.textureName.textContent = "未使用贴图";
  els.textureName.title = "当前没有使用表面贴图";
  setError(null);
  setStatus("已移除表面贴图 · 恢复材质预设颜色");
}

/* ------------------------------------------------------------------ 几何 */

function setError(reason, title = "导入被拒绝") {
  state.lastError = reason || null;
  if (reason) {
    els.error.hidden = false;
    els.error.innerHTML = "";
    const strong = document.createElement("b");
    strong.textContent = title;
    els.error.appendChild(strong);
    els.error.appendChild(document.createTextNode(reason));
  } else {
    els.error.hidden = true;
    els.error.textContent = "";
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

function updateStats() {
  els.stats.textContent = state.shapeCount
    ? `${state.shapeCount} 个图形 · ${state.vertexCount.toLocaleString("en-US")} 顶点`
    : "—";
}

/** 参数变化 → 重新构建几何。拒绝时保留上一次成功模型，不渲染半个坏模型。 */
function rebuild() {
  if (!state.svgText) return;

  const guard = inspectSvg(state.svgText, { smoothness: state.smoothness });
  if (!guard.ok) {
    setError(guard.reason);
    setStatus(`已拒绝当前 SVG（${guard.code}）· 画布保留上一次成功模型`);
    return;
  }

  // 只解析一次：解析结果先过几何级采样闸门，再原样交给上游挤出，
  // 不再让 buildExtrudedGeometry 重新解析一遍字符串。
  let shapes;
  try {
    shapes = parseShapesFromSVG(state.svgText);
  } catch (error) {
    setError(`SVG 解析失败：${error && error.message ? error.message : String(error)}`);
    setStatus("解析失败 · 画布保留上一次成功模型");
    return;
  }

  const shapeGuard = inspectShapes(shapes, {
    smoothness: state.smoothness,
    vertexBudget: LIMITS.vertexBudget
  });
  if (!shapeGuard.ok) {
    setError(shapeGuard.reason);
    setStatus(`已拒绝当前 SVG（${shapeGuard.code}）· 画布保留上一次成功模型`);
    return;
  }

  let result = null;
  try {
    result = buildExtrudedGeometry(shapes, {
      depth: state.depth,
      smoothness: state.smoothness,
      bevelEnabled: state.bevelEnabled,
      bevelThickness: state.bevelThickness,
      bevelSize: state.bevelSize,
      vertexBudget: LIMITS.vertexBudget, // 与采样估算同一预算，交给上游做真正的细分裁剪
      creaseAngle: Math.PI / 6
    });
  } catch (error) {
    setError(`模型构建失败：${error && error.message ? error.message : String(error)}`);
    setStatus("构建失败 · 画布保留上一次成功模型");
    return;
  }

  if (!result) {
    setError("这个 SVG 生成立体模型失败：可能轮廓没有闭合，或图形无法三角化。");
    setStatus("构建失败 · 画布保留上一次成功模型");
    return;
  }

  const geometry = result.geometry;

  // 采样估算是保守近似；万一实际几何仍超硬上限，直接丢弃，绝不把坏模型换上去。
  const actualVerts = geometry.attributes.position ? geometry.attributes.position.count : 0;
  if (actualVerts > LIMITS.vertexBudget) {
    geometry.dispose();
    setError(
      `已拒绝导入：实际生成 ${actualVerts.toLocaleString("en-US")} 个顶点，超过上限 ` +
        `${LIMITS.vertexBudget.toLocaleString("en-US")}。请减少曲线或降低平滑度。`
    );
    setStatus("已拒绝 · 画布保留上一次成功模型");
    return;
  }

  geometry.translate(-result.center.x, -result.center.y, -result.center.z);
  geometry.computeBoundingBox();

  // 顶点到原点（几何中心）的精确最大距离 → 取景用；旋转不改变距离，故只需算一次
  let radiusSq = 0;
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const d = x * x + y * y + z * z;
    if (d > radiusSq) radiusSq = d;
  }
  geometryRadius = Math.sqrt(radiusSq) * result.baseScale;

  const previous = mesh.geometry;
  mesh.geometry = geometry;
  if (previous) previous.dispose();
  hasGeometry = true;

  mesh.scale.setScalar(result.baseScale); // 上游给出的「最大边 ≈ 4 单位」缩放
  state.shapeCount = result.shapeCount;
  state.vertexCount = geometry.attributes.position ? geometry.attributes.position.count : 0;
  state.lastError = null;

  refitView();
  setError(null);
  updateStats();
  setStatus(
    `已建模 · ${state.svgName} · 厚度 ${state.depth} · 平滑度 ${state.smoothness.toFixed(2)} · 材质 ${materialLabel(state.preset)}`
  );
}

/* ------------------------------------------------------------------ 载入 */

function loadSvg(text, name, { resetView = false } = {}) {
  state.svgText = text;
  state.svgName = name;
  els.name.textContent = name;
  els.name.title = name;
  rebuild();
  if (resetView) resetViewpoint();
}

function resetViewpoint() {
  camera.position.copy(VIEW_DIR).multiplyScalar(VIEW_DISTANCE);
  controls.target.set(0, 0, 0);
  fittedDistance = 0; // 放回 1:1，再按新几何重新取景
  refitView();
}

/* ------------------------------------------------------------------ 导出 */

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

let exporting = false;

function exportPng() {
  if (exporting) return;
  exporting = true;
  els.exportPng.disabled = true;

  const scale = Math.max(1, Number(els.exportScale.value) || 1);
  const previousPixelRatio = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());
  const width = Math.max(1, Math.round(size.x * scale));
  const height = Math.max(1, Math.round(size.y * scale));

  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.render(scene, camera);

  els.canvas.toBlob((blob) => {
    // 立刻恢复视图尺寸，避免导出分辨率残留；setSize 会清空画布，
    // 而下一帧 RAF 之前画布会保持空白，所以这里必须紧接着重绘一次预览。
    renderer.setPixelRatio(previousPixelRatio);
    renderer.setSize(size.x, size.y, false);
    renderer.render(scene, camera);
    exporting = false;
    els.exportPng.disabled = false;

    if (!blob) {
      setStatus("导出失败：canvas.toBlob 没有返回数据");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `extrude3d-${state.preset}-${timestamp()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    setStatus(`已导出 ${width}×${height} PNG${state.transparent ? "（透明背景 alpha）" : ""} · ${link.download}`);
  }, "image/png");
}

/* ------------------------------------------------------------------ 事件 */

const DECIMALS = {
  depth: (v) => v.toFixed(1),
  bevelThickness: (v) => v.toFixed(2),
  bevelSize: (v) => v.toFixed(2),
  smoothness: (v) => v.toFixed(2),
  roughness: (v) => v.toFixed(2),
  envIntensity: (v) => v.toFixed(2),
  exposure: (v) => v.toFixed(2)
};

function bindGeometrySlider(input, out, key) {
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    out.textContent = DECIMALS[key](state[key]);
    rebuild();
  });
  out.textContent = DECIMALS[key](state[key]);
  input.value = String(state[key]);
}

function init() {
  buildMaterialSelect();
  els.material.value = state.preset;
  applyMaterial();
  applyBackground();

  bindGeometrySlider(els.depth, els.depthOut, "depth");
  bindGeometrySlider(els.bevelThickness, els.bevelThicknessOut, "bevelThickness");
  bindGeometrySlider(els.bevelSize, els.bevelSizeOut, "bevelSize");
  bindGeometrySlider(els.smoothness, els.smoothnessOut, "smoothness");

  els.bevelEnabled.addEventListener("change", () => {
    state.bevelEnabled = els.bevelEnabled.checked;
    rebuild();
  });

  els.material.addEventListener("change", () => {
    state.preset = els.material.value;
    state.color = presetColor(state.preset);
    applyMaterial();
    setStatus(`材质已切换到 ${materialLabel(state.preset)}`);
  });

  els.colorOverride.addEventListener("change", () => {
    state.colorOverride = els.colorOverride.checked;
    els.color.disabled = !state.colorOverride;
    applyMaterial();
  });
  els.color.addEventListener("input", () => {
    state.color = els.color.value;
    if (state.colorOverride) applyMaterial();
  });

  els.roughnessOverride.addEventListener("change", () => {
    state.roughnessOverride = els.roughnessOverride.checked;
    els.roughness.disabled = !state.roughnessOverride;
    applyMaterial();
  });
  els.roughness.addEventListener("input", () => {
    state.roughness = Number(els.roughness.value);
    els.roughnessOut.textContent = DECIMALS.roughness(state.roughness);
    if (state.roughnessOverride) applyMaterial();
  });

  els.textureFile.addEventListener("change", () => {
    const file = els.textureFile.files && els.textureFile.files[0];
    if (file) loadTextureFile(file);
  });
  els.textureRemove.addEventListener("click", () => removeTexture());

  els.envIntensity.addEventListener("input", () => {
    state.envIntensity = Number(els.envIntensity.value);
    els.envIntensityOut.textContent = DECIMALS.envIntensity(state.envIntensity);
    scene.environmentIntensity = state.envIntensity;
  });
  els.exposure.addEventListener("input", () => {
    state.exposure = Number(els.exposure.value);
    els.exposureOut.textContent = DECIMALS.exposure(state.exposure);
    renderer.toneMappingExposure = state.exposure;
  });
  els.bg.addEventListener("input", () => {
    state.bg = els.bg.value;
    applyBackground();
  });
  els.transparentBg.addEventListener("change", () => {
    state.transparent = els.transparentBg.checked;
    applyBackground();
  });

  els.sample.addEventListener("change", () => {
    const sample = SAMPLES[els.sample.value];
    if (sample) loadSvg(sample.text, sample.name, { resetView: true });
  });

  els.file.addEventListener("change", async () => {
    const file = els.file.files && els.file.files[0];
    if (!file) return;
    // 文件大小先拦一层，避免把超大文件整个读进内存
    if (file.size > LIMITS.maxBytes) {
      setError(
        `已拒绝导入：文件过大（${(file.size / 1024).toFixed(1)} KB，上限 ${(LIMITS.maxBytes / 1024).toFixed(0)} KB）。` +
          "请先在设计软件里合并图层、简化节点后再导出。"
      );
      setStatus("已拒绝 · 画布保留上一次成功模型");
      els.file.value = "";
      return;
    }
    const text = await file.text(); // 本地读取，无任何网络请求
    loadSvg(text, file.name);
    els.file.value = "";
  });

  els.resetView.addEventListener("click", () => {
    resetViewpoint();
    setStatus("视角已重置");
  });

  els.exportPng.addEventListener("click", exportPng);

  /* 首次加载：直接展示内置样例，页面一进来就有真实内容 */
  new ResizeObserver(() => resize()).observe(els.view);
  resize();
  const first = SAMPLES[els.sample.value] || SAMPLES["square-ring"];
  loadSvg(first.text, first.name);
  animate();
}

function resize() {
  const width = Math.max(1, els.view.clientWidth);
  const height = Math.max(1, els.view.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (hasGeometry) refitView(); // 视口比例变了，重新取景（保留用户缩放）
  renderer.render(scene, camera); // setSize 会清空画布：同步补一帧，避免错误提示等布局变化后短暂空白
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (!exporting) renderer.render(scene, camera);
}

/* 调试 / 测试用只读快照（不改变任何行为）。 */
window.__extrude3d = {
  getState: () => ({ ...state }),
  getInfo: () => {
    let size = [0, 0, 0];
    if (hasGeometry) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      size = [
        +(box.max.x - box.min.x).toFixed(4),
        +(box.max.y - box.min.y).toFixed(4),
        +(box.max.z - box.min.z).toFixed(4)
      ];
    }
    return {
      preset: state.preset,
      shapeCount: state.shapeCount,
      vertexCount: state.vertexCount,
      size,
      cameraDistance: +camera.position.distanceTo(controls.target).toFixed(3),
      lastError: state.lastError,
      transparent: state.transparent,
      texture: textureInfo(),
      canvas: [els.canvas.width, els.canvas.height]
    };
  },
  scene,
  camera,
  renderer,
  mesh
};

init();
