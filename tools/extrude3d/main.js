/**
 * SVG立体 · imageLAB 工具⑧
 *
 * 全部能力都是「官方现成件 + 上游库」的接线：
 *   - 解析：`@visant/extrude3d` 的 `parseShapesFromSVG`（MIT，0.1.0）
 *   - 平面尺寸：上游 `measureFlatMaxDim`
 *   - 挤出：three 原生 `THREE.ExtrudeGeometry` + `BufferGeometryUtils.mergeGeometries`
 *   - 平滑法线 / 三平面 UV：上游 `smoothCreaseNormals` / `recomputeTriplanarUVs`
 *   - 细分预算：上游 `buildExtrudeSettings` 的曲线 / 倒角分段与顶点预算裁剪
 *   - 渲染 / PBR 材质 / 环境反射 / 轨道控制：`three` 0.186.1（MIT）
 *   - 反射环境：three 自带 `RoomEnvironment` + `PMREMGenerator`（程序化，无远程 HDRI）
 *   - 棚拍空间背景：three 原生 `RectAreaLight` + `RectAreaLightUniformsLib` 柔光箱、
 *     自发光板 + `PMREMGenerator` 环境贴图（只生成一次）、原生 `Reflector` 地面反射
 *   - 主光：three 原生 `DirectionalLight`（白光、无阴影）
 * 没有自研渲染、自研着色器、自研几何算法；本工具只做参数映射（厚度 / 倒角按最大平面边长百分比）
 * 与界面接线。
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import {
  MATERIAL_UI,
  buildExtrudeSettings,
  getSimpleMaterialProps,
  materialPresets,
  measureFlatMaxDim,
  parseShapesFromSVG,
  recomputeTriplanarUVs,
  resolveMaterial,
  smoothCreaseNormals
} from "@visant/extrude3d";
import {
  LIMITS,
  estimateMinimumVertices,
  formatBytes,
  inspectSvg,
  planShapes,
  sampleContourPoints
} from "./svg-guard.js";

/* 样例以内联文本方式打包（?raw），首次加载即可显示，且不产生任何网络请求。 */
import hexNestSvg from "./samples/hex-nest.svg?raw";
import letterAStarSvg from "./samples/letter-a-star.svg?raw";
import squareRingSvg from "./samples/square-ring.svg?raw";

const SAMPLES = {
  "square-ring": { name: "square-ring.svg", text: squareRingSvg },
  "letter-a-star": { name: "letter-a-star.svg", text: letterAStarSvg },
  "hex-nest": { name: "hex-nest.svg", text: hexNestSvg }
};

/**
 * 原生真实立方体（默认几何）：与 SVG 走同一次「平面最大边长 = 4 单位」归一化口径，
 * 宽 / 高固定 4，厚（Z）由「厚度%」映射为最大边的百分比（默认 100% → 4×4×4 实心立方体）。
 * 圆角走 three 自带 addon `RoundedBoxGeometry`，不是 SVG 近似，也没有自研建模系统。
 */
const CUBE_SAMPLE_ID = "cube";
const CUBE_MAX_EDGE = 4;
const CUBE_ROUND_SEGMENTS = 4;

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
  glassIor: document.getElementById("glass-ior"),
  glassIorOut: document.getElementById("glass-ior-out"),
  glassThickness: document.getElementById("glass-thickness"),
  glassThicknessOut: document.getElementById("glass-thickness-out"),
  glassDispersion: document.getElementById("glass-dispersion"),
  glassDispersionOut: document.getElementById("glass-dispersion-out"),
  glassNote: document.getElementById("glass-note"),
  dispersionDemo: document.getElementById("dispersion-demo"),
  textureFile: document.getElementById("texture-file"),
  textureRemove: document.getElementById("texture-remove"),
  textureName: document.getElementById("texture-name"),

  envIntensity: document.getElementById("env-intensity"),
  envIntensityOut: document.getElementById("env-intensity-out"),
  lightIntensity: document.getElementById("light-intensity"),
  lightIntensityOut: document.getElementById("light-intensity-out"),
  lightAngle: document.getElementById("light-angle"),
  lightAngleOut: document.getElementById("light-angle-out"),
  exposure: document.getElementById("exposure"),
  exposureOut: document.getElementById("exposure-out"),
  bg: document.getElementById("bg"),
  bgMode: document.getElementById("bg-mode"),
  transparentBg: document.getElementById("transparent-bg"),
  bgFile: document.getElementById("bg-file"),
  bgName: document.getElementById("bg-name"),
  bgRemove: document.getElementById("bg-remove"),
  bgZoom: document.getElementById("bg-zoom"),
  bgZoomOut: document.getElementById("bg-zoom-out"),
  bgPanX: document.getElementById("bg-pan-x"),
  bgPanXOut: document.getElementById("bg-pan-x-out"),
  bgPanY: document.getElementById("bg-pan-y"),
  bgPanYOut: document.getElementById("bg-pan-y-out"),
  bgPanReset: document.getElementById("bg-pan-reset"),
  bgPanNote: document.getElementById("bg-pan-note"),

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
  // 几何来源：cube 原生真实立方体（默认）/ svg 内置样例或用户导入
  source: CUBE_SAMPLE_ID,
  // 厚度 2–100（最大平面边长的百分比）：cube 下即 Z 轴占最大边的百分比（默认 100% = 4×4×4）
  depth: 100,
  bevelEnabled: true,
  // 倒角深度 0–10（最大平面边长的百分比），默认 2%
  bevelThickness: 2,
  // 边缘圆角宽度 0–10（最大平面边长的百分比），默认 2%；cube 下映射 RoundedBoxGeometry 圆角半径
  bevelSize: 2,
  smoothness: 0.5,
  // 玻璃：折射率 / 光学厚度倍数 / 色散。默认值对应官方透明玻璃配置，仅对「透明玻璃」预设生效。
  glassIor: 1.5,
  glassThickness: 1,
  // 色散强度（three 原生 MeshPhysicalMaterial.dispersion，0–20）：默认 6，强色散示例按钮会给到 10
  glassDispersion: 6,
  preset: "glass",
  colorOverride: false,
  color: FALLBACK_COLOR,
  roughnessOverride: false,
  roughness: 0.3,
  textureName: "",
  textureWidth: 0,
  textureHeight: 0,
  envIntensity: 1,
  lightIntensity: 1.2,
  lightAngle: 40,
  exposure: 1,
  bg: "#ffffff",
  // 背景模式：pure 纯色（默认，保持旧行为）/ studio 棚拍空间 / image 本地图片
  bgMode: "pure",
  bgName: "",
  bgWidth: 0,
  bgHeight: 0,
  bgZoom: 1,
  // 背景图片裁切位置：-100..100（%），0 为居中；只在有裁切余量的轴上生效
  bgPanX: 0,
  bgPanY: 0,
  transparent: false,
  shapeCount: 0,
  vertexCount: 0,
  // 归一化后（平面最大边长 = 4 单位）的世界空间真实模型厚度，供透射材质换算局部 thickness 使用
  modelThickness: 0,
  lastError: null
};

/**
 * 本次几何实际使用的设置（供 UI 状态提示与只读诊断读取）。
 * depth / bevel 数值是「最大平面边长百分比」，units 是归一化前的本地单位。
 */
let appliedSettings = {
  maxFlatDim: 0,
  baseScale: 1,
  depthPercent: 0,
  depthUnits: 0,
  bevelSizePercent: 0,
  bevelSizeUnits: 0,
  bevelThicknessPercent: 0,
  bevelThicknessUnits: 0,
  bevelEnabled: true,
  bevelSegments: 0,
  curveSegments: 0,
  reduction: false,
  bevelLimit: null
};

/* ------------------------------------------------------------------ 渲染器 */

/**
 * 按需渲染：只有「内容变脏」或「轨道控制确实改变相机」时才真正渲染一帧，
 * 空闲时只跑 `controls.update()`（阻尼收敛）而不再重复出图，避免棚拍反射 /
 * 透射这类多趟绘制在静止时也持续占用 GPU。任何改画面 / 改材质 / 改背景 /
 * 改几何 / 改窗口大小的入口都会调用 `markDirty()`。
 */
let renderDirty = true;
let renderCount = 0;
function markDirty() {
  renderDirty = true;
}

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

/** 统一归一化目标：把「平面最大边长」缩放到 4 单位（一次确定，不随厚度 / 倒角变化）。 */
const FLAT_NORMALIZED_SIZE = 4;

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.copy(VIEW_DIR).multiplyScalar(VIEW_DISTANCE);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 32;
controls.target.set(0, 0, 0);
controls.addEventListener("change", markDirty);
controls.update();

/** 唯一的出图入口：便于统计真实渲染帧数（按需渲染的自检用）。 */
function renderFrame() {
  renderer.render(scene, camera);
  renderCount += 1;
  renderDirty = false;
}

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
  markDirty();
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
const roomEnvTexture = generateEnvironment(new RoomEnvironment());

/** 用一次性 PMREM 生成器把场景烘成环境贴图；生成器用完即弃，不每帧重建。 */
function generateEnvironment(envScene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.04, 0.1, 240);
  envScene.dispose();
  pmrem.dispose();
  return target.texture;
}

scene.environment = roomEnvTexture;

/**
 * 「灯光强度」是统一的总光量增益（master light gain），不是单纯的一盏灯：
 *   - 原生直接光：`DirectionalLight` 主光 + 棚拍两盏 `RectAreaLight` 面光源；
 *   - 可见自发光柔光箱板（加法混合 `MeshBasicMaterial`，颜色 × gain）；
 *   - `scene.environmentIntensity`（静态 PMREM 环境的反射强度，不每帧重建贴图）。
 * 现有「环境光」滑杆是叠加在增益之上的独立倍数（environmentIntensity = envIntensity × gain），
 * 这样 gain=0 时总反射 / 面板光被抑制而背景色 / 图片保留，gain=1 为标称（默认灯光强度 1.2）。
 */
const LIGHT_GAIN_NOMINAL = 1.2;

function lightGain() {
  return Math.max(0, Number(state.lightIntensity) || 0) / LIGHT_GAIN_NOMINAL;
}

/** 环境反射强度 = 独立「环境光」滑杆 × 总光量增益；只改 intensity，不重烘 PMREM。 */
function applySceneEnvironmentIntensity() {
  scene.environmentIntensity = state.envIntensity * lightGain();
}

applySceneEnvironmentIntensity();

/**
 * 基础主光：three 原生 `DirectionalLight`（白光、不投影以避开阴影的额外开销）。
 * 与自带 `RoomEnvironment` 环境反射同时工作；只暴露「强度 + 方向角」两个控件，
 * 改参数只更新灯光本身，立即影响真实高光，不重建几何。
 */
const keyLight = new THREE.DirectionalLight(0xffffff, state.lightIntensity);
const KEY_LIGHT_ELEVATION = THREE.MathUtils.degToRad(42);

function updateKeyLight() {
  const azimuth = THREE.MathUtils.degToRad(state.lightAngle);
  keyLight.position
    .set(
      Math.cos(KEY_LIGHT_ELEVATION) * Math.cos(azimuth),
      Math.sin(KEY_LIGHT_ELEVATION),
      Math.cos(KEY_LIGHT_ELEVATION) * Math.sin(azimuth)
    )
    .multiplyScalar(12);
  keyLight.target.position.set(0, 0, 0);
  keyLight.intensity = state.lightIntensity;
  markDirty();
}

scene.add(keyLight);
scene.add(keyLight.target);
updateKeyLight();

/* 网格：几何由上游解析 + three 原生挤出构建，材质由上游预设解析。 */
const mesh = new THREE.Mesh(new THREE.BufferGeometry(), createMaterial());
mesh.rotation.x = Math.PI; // three 的 SVGLoader 输出 Y 向下，转过来与 SVG 观感一致（挤出体关于 z 中面对称）
scene.add(mesh);

function createMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.4 });
}

/* ------------------------------------------------------------------ 背景 */

/**
 * 背景三种模式（`state.bgMode`）：
 *   - `pure`  纯色（默认，保持旧测试与旧状态）；渲染语义与旧版完全一致。
 *   - `studio` 棚拍空间：真实 WebGL 场景（背景幕 + 柔光箱 + 真实地面反射），见下方「棚拍空间」。
 *   - `image` 本地图片：用户本地图片 → three `TextureLoader`（blob URL）→ `scene.background`。
 *
 * 图片贴法完全是 three 原生能力：`scene.background` 为普通贴图时，renderer 用贴图的
 * `matrix`（由 `repeat` / `offset` 生成）做 uv 变换，因此这里只设这两个原生属性，
 * 就能实现「居中 cover、保持原图宽高比」；不写自定义着色器 / 背景算法。
 * 缩放（1×–3×）只是等比缩小 `repeat`；「横向 / 纵向位置」只是在 cover 后剩下的
 * 裁切窗口里平移 `offset`（永远落在 [0, 1-repeat] 内，因此不会拉伸 / 平铺 / 露白边）。
 * 透明背景开启时三类背景的可见部分都被抑制（图片与棚拍资源都保留）。
 */
let bgTexture = null;

/** 当前视口 + 原图宽高比 + 缩放下的 cover 重复比例（repeat）。 */
function backgroundRepeat() {
  const image = (bgTexture && bgTexture.image) || {};
  const imageWidth = image.width || state.bgWidth || 1;
  const imageHeight = image.height || state.bgHeight || 1;
  const viewWidth = Math.max(1, els.view.clientWidth);
  const viewHeight = Math.max(1, els.view.clientHeight);
  const viewAspect = viewWidth / viewHeight;
  const imageAspect = imageWidth / imageHeight;
  const zoom = THREE.MathUtils.clamp(state.bgZoom || 1, 1, 3);
  return [Math.min(1, viewAspect / imageAspect) / zoom, Math.min(1, imageAspect / viewAspect) / zoom];
}

/** 供既有调试钩子读取的最小背景元信息（无背景图时为 null）。 */
function backgroundInfo() {
  if (!bgTexture) return null;
  const image = bgTexture.image || {};
  const [repeatX, repeatY] = backgroundRepeat();
  return {
    mode: state.bgMode,
    name: state.bgName,
    width: image.width || state.bgWidth || 0,
    height: image.height || state.bgHeight || 0,
    zoom: state.bgZoom,
    pan: [state.bgPanX, state.bgPanY],
    // 每个轴还剩多少裁切余量（>0 才能平移；1× 且该轴无余量时对应滑杆禁用）
    room: [+Math.max(0, 1 - repeatX).toFixed(6), +Math.max(0, 1 - repeatY).toFixed(6)],
    repeat: [+bgTexture.repeat.x.toFixed(6), +bgTexture.repeat.y.toFixed(6)],
    offset: [+bgTexture.offset.x.toFixed(6), +bgTexture.offset.y.toFixed(6)]
  };
}

function formatPan(value) {
  return `${Number(value).toFixed(0)}%`;
}

/**
 * 写回贴图的 repeat / offset：先按视口做居中 cover，再把「横向 / 纵向位置」
 * 映射到 [0, 1-repeat] 的裁切窗口内。没有余量的轴恒为居中。
 */
function fitBackgroundTexture() {
  updateBackgroundPanControls();
  if (!bgTexture) {
    markDirty();
    return;
  }
  const [repeatX, repeatY] = backgroundRepeat();
  bgTexture.repeat.set(repeatX, repeatY);
  const roomX = Math.max(0, 1 - repeatX);
  const roomY = Math.max(0, 1 - repeatY);
  const panToOffset = (pan, room) =>
    THREE.MathUtils.clamp(room * (0.5 + THREE.MathUtils.clamp(pan, -100, 100) / 200), 0, room);
  bgTexture.offset.set(panToOffset(state.bgPanX, roomX), panToOffset(state.bgPanY, roomY));
  markDirty();
}

/** 没有裁切余量的轴禁用对应滑杆，并说明原因（不静默失效）。 */
function updateBackgroundPanControls() {
  const [repeatX, repeatY] = backgroundRepeat();
  const roomX = 1 - repeatX;
  const roomY = 1 - repeatY;
  const hasTexture = !!bgTexture;
  const entries = [
    [els.bgPanX, els.bgPanXOut, state.bgPanX, roomX],
    [els.bgPanY, els.bgPanYOut, state.bgPanY, roomY]
  ];
  for (const [input, out, value, room] of entries) {
    if (input) input.disabled = !hasTexture || room <= 1e-4;
    if (out) out.textContent = formatPan(value);
  }
  if (els.bgPanNote) {
    if (!hasTexture) {
      els.bgPanNote.textContent = "上传背景图片后可移动裁切位置。";
    } else if (roomX <= 1e-4 || roomY <= 1e-4) {
      const axes = [roomX <= 1e-4 ? "横向" : null, roomY <= 1e-4 ? "纵向" : null].filter(Boolean);
      els.bgPanNote.textContent = `放大背景后可移动裁切位置（${axes.join(" / ")}当前没有裁切余量）。`;
    } else {
      els.bgPanNote.textContent = "在图片范围内移动裁切位置，不会拉伸、平铺或露出空白边。";
    }
  }
}

/** 背景模式 / 颜色 / 图片 / 透明开关的统一出口：只改渲染状态，不碰相机。 */
function applyBackground() {
  const color = new THREE.Color(state.bg);
  if (state.transparent) {
    scene.background = null; // 透明背景：预览与导出都不显示任何背景
    renderer.setClearColor(color, 0);
    renderer.setClearAlpha(0);
    els.view.style.background = "transparent";
  } else if (state.bgMode === "studio") {
    scene.background = null; // 棚拍背景由真实几何提供
    renderer.setClearColor(STUDIO_CLEAR, 1);
    renderer.setClearAlpha(1);
    els.view.style.background = "";
  } else if (state.bgMode === "image" && bgTexture) {
    renderer.setClearAlpha(1);
    scene.background = bgTexture;
    renderer.setClearColor(color, 1); // 兜底：cover 正常应铺满，不露出纯色
    els.view.style.background = "";
    fitBackgroundTexture();
  } else {
    // pure（或 image 模式但还没有图片时退化为纯色）
    scene.background = null;
    renderer.setClearColor(color, 1);
    renderer.setClearAlpha(1);
    els.view.style.background = "";
  }
  syncStudioVisibility();
  applyEnvironmentMode();
  updateBackgroundPanControls();
  markDirty();
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

/** 本工具的「透明玻璃」预设 id（上游该预设只有 opacity / transparent，没有 transmission）。 */
const GLASS_PRESET_ID = "glass";

/** 是否属于玻璃 / 透射材质：本工具的透明玻璃，或上游预设本身带透射。 */
function isTransmissivePreset(id) {
  if (id === GLASS_PRESET_ID) return true;
  const preset = materialPresets[id];
  return !!preset && Number(preset.transmission) > 0;
}

/** 只有「透明玻璃」暴露本工具的折射控件；其他透射材质保持各自预设参数。 */
function isGlassPreset(id) {
  return id === GLASS_PRESET_ID;
}

/** 玻璃控件只在「透明玻璃」下可调；其他材质保持自己的预设折射参数。 */
function updateGlassControls() {
  const enabled = isGlassPreset(state.preset);
  for (const input of [els.glassIor, els.glassThickness, els.glassDispersion]) {
    if (input) input.disabled = !enabled;
  }
  if (els.glassNote) {
    els.glassNote.textContent = enabled
      ? "折射需要背景有细节：纯色背景基本看不出效果，请上传背景图片，或点上方「强色散示例」。透明背景导出时没有可折射的背景，玻璃会接近透明。"
      : "当前材质使用它自己的预设折射参数；切到「透明玻璃」可调折射率 / 光学厚度 / 色散强度。";
  }
}

/**
 * 预设 → MeshPhysicalMaterial：PBR 数值一律来自上游 helper，本工具不自己写参数公式。
 * 透射适配（用户本轮专项授权）：
 *   - 透射材质一律 `opacity = 1`，由 `transmission` 负责透光，不用低 opacity 稀释折射；
 *   - 「透明玻璃」采用 three 官方 webgl_materials_physical_transmission 的成熟配置
 *     （transmission 1 / opacity 1 / metalness 0 / 低 roughness / ior 1.5），
 *     世界空间有效厚度 = 归一化后真实模型厚度 × 光学厚度倍数，dispersion 由色散控件给出；
 *   - 其他透射材质保留各自预设的世界空间目标厚度（`resolved.thickness`）。
 *
 * 坐标换算（关键）：three 0.186.1 的 `getVolumeTransmissionRay` 明确写着
 * 「The thickness is specified in local space」并在着色器里乘 `modelScale`；
 * 而 modelThickness / resolved.thickness 都是「平面最大边长 = 4」后的世界单位。
 * 本工具又对 `mesh.scale` 做了一次统一归一化，所以 `props.thickness` 必须先除以
 * `|mesh.scale.z|` 换回网格局部坐标，否则会被缩放两次。
 * 只读诊断见 `getInfo().material.effectiveThickness` = `thickness × scale`（世界单位）。
 */
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

  const transmissive = isTransmissivePreset(state.preset);
  const glass = isGlassPreset(state.preset);

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
    // 透射材质用 DoubleSide：three 0.186.1 的 renderTransmissionPass 会对
    // transparent + DoubleSide + forceSinglePass=false 的材质先画背面再画正面，
    // 这样透过玻璃能看到后方 / 内侧的真实表面；不透明材质保持 FrontSide。
    side: transmissive ? THREE.DoubleSide : THREE.FrontSide
  };

  if (transmissive) {
    props.opacity = 1;
    props.transparent = true;
    props.forceSinglePass = false; // 多趟透射（正面 + 背面），不是单趟近似
    // 世界目标厚度 → 网格局部厚度：着色器会再乘 modelScale，故这里先除回去（等比缩放）。
    const scaleZ = Math.abs(mesh.scale.z) || 1;
    const worldTarget = glass
      ? Math.max(0, state.modelThickness) * state.glassThickness
      : Number.isFinite(resolved.thickness)
        ? resolved.thickness
        : Math.max(0, state.modelThickness);
    props.thickness = worldTarget / scaleZ;
  }

  if (glass) {
    props.metalness = 0;
    props.transmission = 1;
    props.opacity = 1;
    props.transparent = true;
    props.ior = state.glassIor;
    props.dispersion = state.glassDispersion;
  }

  for (const key of Object.keys(props)) {
    if (props[key] === undefined) delete props[key];
  }

  const previous = mesh.material;
  mesh.material = new THREE.MeshPhysicalMaterial(props);
  if (previous) previous.dispose();

  els.color.value = state.colorOverride ? state.color : presetColor(state.preset);
  updateGlassControls();
  markDirty();
}

/* --------------------------------------------------------- 本地图片校验 */

/**
 * 本地图片上限（表面贴图与背景图片共用同一套校验）。
 * 表面贴图：three `TextureLoader`（blob URL）→ `MeshPhysicalMaterial.map`；
 * 背景图片：同一加载器 → `scene.background`（见上方「背景」一节）。
 * 只用 three 原生能力，不写自定义着色器 / UV 算法，素材仅在本地读取、不发起网络请求。
 */
const IMAGE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxSide: 4096,
  mimeTypes: ["image/png", "image/jpeg", "image/webp"]
};

let surfaceTexture = null;

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

/**
 * 本地图片读取器（表面贴图 / 背景图片各持一个实例）：
 * MIME 白名单 → 体积上限 → blob URL → three `TextureLoader` → 实际解码尺寸。
 * 每次选择都递增序列号，过期回调（含加载中点「移除」、随后选择无效文件）一律丢弃；
 * 任何失败都不覆盖各自当前已生效的图片，并释放已创建的贴图与 blob URL。
 */
function createLocalImageLoader({ noun, onAccept, onReject }) {
  let seq = 0;
  return {
    load(file) {
      if (!file) return;

      // 无论这次选择最终会不会被拒，都先作废更早的「进行中」加载，
      // 否则被拒文件的提示会被过期回调清掉、甚至错误换上更早那次选择的图片。
      const current = ++seq;

      if (!IMAGE_LIMITS.mimeTypes.includes(file.type)) {
        onReject(`已拒绝${noun}：仅支持 PNG / JPEG / WebP，当前文件类型「${file.type || "未知"}」。`);
        return;
      }
      if (file.size > IMAGE_LIMITS.maxBytes) {
        onReject(
          `已拒绝${noun}：文件过大（${(file.size / 1024 / 1024).toFixed(1)} MiB，上限 10 MiB）。请先压缩图片。`
        );
        return;
      }

      const url = URL.createObjectURL(file);
      setStatus(`正在读取${noun} · ${file.name}…`);

      new THREE.TextureLoader().load(
        url,
        (texture) => {
          try {
            if (current !== seq) {
              texture.dispose(); // 过期回调：不覆盖更新一次的选择
              return;
            }
            const image = texture.image || {};
            const width = image.width || 0;
            const height = image.height || 0;
            if (!width || !height) {
              texture.dispose();
              onReject(`${noun}读取失败：无法取得图像尺寸，可能不是有效的图片。`);
              return;
            }
            if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide) {
              texture.dispose();
              onReject(
                `${noun}尺寸过大：${width}×${height} 像素，单边上限 ${IMAGE_LIMITS.maxSide} 像素。请先缩小图片再上传。`
              );
              return;
            }

            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
            texture.needsUpdate = true;
            onAccept(texture, file, width, height);
          } catch (error) {
            if (surfaceTexture !== texture && bgTexture !== texture) texture.dispose();
            if (current === seq) {
              onReject(`${noun}读取失败：${error && error.message ? error.message : String(error)}`);
            }
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        undefined,
        () => {
          URL.revokeObjectURL(url);
          if (current === seq) onReject(`${noun}解码失败：文件不是有效的 PNG / JPEG / WebP 图像。`);
        }
      );
    },
    cancel() {
      seq += 1; // 让进行中的加载回调过期
    }
  };
}

/* ------------------------------------------------------------- 表面贴图 */

/** 贴图被拒绝 / 解码失败：给出中文原因，保留当前有效贴图与模型。 */
function rejectTexture(reason) {
  setError(reason, "贴图未更换");
  setStatus("贴图未更换 · 保留当前贴图与模型");
  els.textureFile.value = "";
}

/** 贴图读取成功：被替换的旧贴图立即释放，材质重新绑定新贴图。 */
function acceptTexture(texture, file, width, height) {
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

const textureLoader = createLocalImageLoader({
  noun: "贴图",
  onAccept: acceptTexture,
  onReject: rejectTexture
});

/** 移除贴图：释放当前贴图、作废进行中的加载回调，并恢复材质预设颜色。 */
function removeTexture() {
  textureLoader.cancel();
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

/* ------------------------------------------------------------- 背景图片 */

/** 背景图片被拒绝 / 解码失败：保留当前背景，不影响表面贴图。 */
function rejectBackground(reason) {
  setError(reason, "背景图片未更换");
  setStatus("背景图片未更换 · 保留当前背景");
  els.bgFile.value = "";
}

/** 背景图片读取成功：换上、切到图片模式并按视口做居中 cover；旧背景贴图释放。 */
function acceptBackground(texture, file, width, height) {
  const previous = bgTexture;
  bgTexture = texture;
  state.bgName = file.name;
  state.bgWidth = width;
  state.bgHeight = height;
  if (previous && previous !== texture) previous.dispose();

  // 上传即进入图片模式；新图片从「居中 · 1×」开始，不继承上一张图的裁切位置。
  resetBackgroundView();
  state.bgMode = "image";
  applyBackground();
  updateBackgroundControls();
  els.bgName.textContent = file.name;
  els.bgName.title = `${file.name} · ${width}×${height}`;
  setError(null);
  setStatus(`已应用背景图片 · ${file.name} · ${width}×${height}`);
  els.bgFile.value = "";
}

const backgroundLoader = createLocalImageLoader({
  noun: "背景图片",
  onAccept: acceptBackground,
  onReject: rejectBackground
});

/** 背景位置 / 缩放复位：居中、1×（滑杆与读数同步）。 */
function resetBackgroundView() {
  state.bgZoom = 1;
  state.bgPanX = 0;
  state.bgPanY = 0;
  if (els.bgZoom) els.bgZoom.value = "1";
  if (els.bgZoomOut) els.bgZoomOut.textContent = "1.00";
  if (els.bgPanX) els.bgPanX.value = "0";
  if (els.bgPanY) els.bgPanY.value = "0";
  if (els.bgPanXOut) els.bgPanXOut.textContent = "0%";
  if (els.bgPanYOut) els.bgPanYOut.textContent = "0%";
}

/** 移除背景：释放贴图与进行中的加载，并回到纯色模式（棚拍资源保留，可再次选择）。 */
function removeBackground() {
  backgroundLoader.cancel();
  els.bgFile.value = "";
  const hadImage = !!bgTexture;
  resetBackgroundView();
  if (bgTexture) bgTexture.dispose();
  bgTexture = null;
  state.bgName = "";
  state.bgWidth = 0;
  state.bgHeight = 0;
  state.bgMode = "pure";
  applyBackground();
  updateBackgroundControls();
  els.bgName.textContent = "未使用背景图片";
  els.bgName.title = "当前没有使用背景图片";
  if (hadImage) {
    setError(null);
    setStatus("已移除背景图片 · 恢复所选背景色");
  } else {
    setStatus("当前没有背景图片 · 背景模式：纯色");
  }
}

/* --------------------------------------------------------------- 棚拍空间 */

/**
 * 「棚拍空间」是真实的 three WebGL 场景，用来贴近 vercel-labs/vgpu 的 glass-sculpture
 * 官方 studio 观感（MIT，<https://github.com/vercel-labs/vgpu>；只对齐构图 / 材质 / 布光，
 * 不搬运其 SDF 光线步进 / WGSL 引擎）：
 *   - 大范围无棱边的背景幕：球面几何 + 顶点渐变（上近白、下中性深灰，参考官方
 *     backgroundTop / backgroundBottom），从内侧观看，不会露出盒状硬边或矩形地平线；
 *   - 中性灰物理地面：原生 `Reflector` 低分辨率镜像（分辨率上限 512）叠加一层中性
 *     `MeshPhysicalMaterial` 地面薄层，用原生材质叠色压低反射，不写新着色器；
 *   - 布光：两盏原生 `RectAreaLight`（暖色主光条 + 冷色轮廓光条，参考官方
 *     keyColor / rimColor）+ 自发光柔光箱板（软边，无硬矩形）；强度复用现有
 *     「主光强度」，方位复用现有「主光方向」；
 *   - 环境反射：把上述静物一次性烘成环境贴图（只生成一次，绝不每帧重建），
 *     让金属 / 玻璃出现宽条柔光反射。
 * 明确不做的：vgpu 的 SDF 光线步进、多次内反射（TIR）、真实接触阴影 —— 这些不是
 * three 原生 `transmission` 能等价的能力，页面上不声称；地面只有单次真实平面反射。
 */
const STUDIO_CLEAR = 0x35363a;
const STUDIO_MIRROR_TARGET = 512; // 反射目标上限（不做全分辨率镜像）
const STUDIO_RADIUS = 80;
const STUDIO_BACKDROP_TOP = new THREE.Color(0.95, 0.96, 1.0);
// 天幕底部略提亮：让玻璃背景折射到的是「中性浅灰空间」而不是近黑，玻璃才清透不发黑。
const STUDIO_BACKDROP_BOTTOM = new THREE.Color(0.4, 0.42, 0.46);
const STUDIO_FLOOR_COLOR = 0x9a9a9c;
const STUDIO_KEY_COLOR = new THREE.Color(1.0, 0.92, 0.82);
const STUDIO_RIM_COLOR = new THREE.Color(0.65, 0.8, 1.0);
// 雾与天幕同色、近端更早介入：远处地面边缘与天幕一起过渡到雾色，消掉硬地平线。
const studioFog = new THREE.Fog(STUDIO_CLEAR, 34, 118);

/** 柔光箱布局：同一套静物给「可见场景」（gain）与「环境烘焙场景」（envGain）。 */
const STUDIO_SOFTBOXES = [
  { width: 30, height: 11, position: [-16, 13, 9], color: STUDIO_KEY_COLOR, gain: 1.05, envGain: 3.4 },
  { width: 20, height: 8, position: [17, 11, -12], color: STUDIO_RIM_COLOR, gain: 1.0, envGain: 2.6 },
  { width: 40, height: 26, position: [0, 24, 2], color: new THREE.Color(1, 1, 1), gain: 0.95, envGain: 1.9 }
];

let studioGroup = null;
let studioFloorY = -2;
let studioReflector = null;
let studioEnvTexture = null;
let studioSoftTexture = null;
let studioFloorFadeTexture = null;
const studioRectLights = [];
/** 可见柔光箱板：按「灯光强度」总增益实时缩放颜色，0 时加法混合自然熄灭。 */
const studioSoftboxes = [];

/** 背景幕：大球面（上大半球 + 略低于地面）顶点渐变，从内侧观看，没有可见棱边。 */
function createStudioBackdropMesh() {
  const geometry = new THREE.SphereGeometry(STUDIO_RADIUS, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.58);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(position.getY(i) / STUDIO_RADIUS, 0, 1);
    const s = t * t * (3 - 2 * t); // smoothstep：上下过渡无硬线
    color.setRGB(
      STUDIO_BACKDROP_BOTTOM.r + (STUDIO_BACKDROP_TOP.r - STUDIO_BACKDROP_BOTTOM.r) * s,
      STUDIO_BACKDROP_BOTTOM.g + (STUDIO_BACKDROP_TOP.g - STUDIO_BACKDROP_BOTTOM.g) * s,
      STUDIO_BACKDROP_BOTTOM.b + (STUDIO_BACKDROP_TOP.b - STUDIO_BACKDROP_BOTTOM.b) * s
    );
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: true });
  return new THREE.Mesh(geometry, material);
}

/** 柔光箱贴图：一次性生成的径向渐变（软边，避免出现硬矩形光斑）。 */
function studioSoftboxTexture() {
  if (studioSoftTexture) return studioSoftTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  studioSoftTexture = new THREE.CanvasTexture(canvas);
  studioSoftTexture.colorSpace = THREE.SRGBColorSpace;
  return studioSoftTexture;
}

/**
 * 地面淡出贴图：一次性径向渐变（中心不透明、外圈透明），作为中性灰地面层的 `alphaMap`。
 * 外圈逐渐透明 → 地面边缘与天幕 / 雾自然过渡，不出现硬边地平线；只是原生材质贴图，无新着色器。
 */
function createStudioFloorFadeTexture() {
  if (studioFloorFadeTexture) return studioFloorFadeTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.8, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  studioFloorFadeTexture = new THREE.CanvasTexture(canvas);
  return studioFloorFadeTexture;
}

/**
 * 自发光柔光箱板：原生 `MeshBasicMaterial` + 径向渐变贴图 + 加法混合，
 * 边缘自然淡出，不会出现「硬矩形 / 盒子地平线」。
 */
function createStudioSoftboxMesh(spec, gain) {
  const material = new THREE.MeshBasicMaterial({
    map: studioSoftboxTexture(),
    color: spec.color.clone().multiplyScalar(gain),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), material);
  mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
  mesh.lookAt(0, 0, 0);
  return mesh;
}

/** 懒构建一次可见棚拍静物（背景幕 + 地面 Reflector + 中性地面层 + 柔光箱 + 面光源）。 */
function buildStudioRig() {
  if (studioGroup) return;
  RectAreaLightUniformsLib.init();

  studioGroup = new THREE.Group();
  studioGroup.visible = false;
  studioGroup.add(createStudioBackdropMesh());

  // 原生 Reflector 在 onBeforeRender 里用「物体 matrixWorld 旋转后的本地 +Z」当镜面法线，
  // 因此几何体必须保持未旋转的 XY 圆盘，靠物体 rotation.x = -PI/2 把它放平；
  // 这样世界法线才是 (0,1,0)。此前对几何数据 rotateX(-PI/2) 会让镜面法线仍是 (0,0,1)，
  // 反射相机 / 斜切裁剪面都错，地面出现斜切灰带、玻璃也发黑。
  const floorGeometry = new THREE.CircleGeometry(STUDIO_RADIUS * 0.98, 96);
  studioReflector = new Reflector(floorGeometry, {
    clipBias: 0.003,
    textureWidth: STUDIO_MIRROR_TARGET,
    textureHeight: STUDIO_MIRROR_TARGET,
    color: 0x565659,
    multisample: 0
  });
  studioReflector.rotation.x = -Math.PI / 2;
  studioReflector.position.y = 0;
  studioGroup.add(studioReflector);

  // 原生中性灰地面薄层：与镜面共用同一份未旋转几何并同样转平，叠在镜像之上压低反射。
  // alphaMap 让外圈渐隐，地面边缘平滑过渡，不再有硬边地平线。
  const overlay = new THREE.Mesh(
    floorGeometry,
    new THREE.MeshPhysicalMaterial({
      color: STUDIO_FLOOR_COLOR,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.62,
      alphaMap: createStudioFloorFadeTexture(),
      depthWrite: false
    })
  );
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = 0.003;
  studioGroup.add(overlay);

  for (const spec of STUDIO_SOFTBOXES) {
    const softbox = createStudioSoftboxMesh(spec, spec.gain);
    studioSoftboxes.push({ mesh: softbox, spec });
    studioGroup.add(softbox);
  }

  const keyArea = new THREE.RectAreaLight(STUDIO_KEY_COLOR, 6, 26, 9);
  const rimArea = new THREE.RectAreaLight(STUDIO_RIM_COLOR, 5, 18, 7);
  for (const light of [keyArea, rimArea]) {
    light.visible = false;
    scene.add(light);
    studioRectLights.push(light);
  }
  studioGroup.userData.keyArea = keyArea;
  studioGroup.userData.rimArea = rimArea;

  scene.add(studioGroup);
  updateStudioPlacement();
  updateStudioLights();
}

/** 把棚拍静物一次性烘成环境贴图（只做一次，不每帧重建）。 */
function buildStudioEnvironment() {
  if (studioEnvTexture) return;
  const envScene = new THREE.Scene();
  envScene.background = STUDIO_BACKDROP_BOTTOM.clone();
  envScene.add(createStudioBackdropMesh());

  const floorGeometry = new THREE.CircleGeometry(STUDIO_RADIUS * 0.98, 64);
  floorGeometry.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(
    floorGeometry,
    new THREE.MeshBasicMaterial({ color: 0x24242a, fog: false })
  );
  floor.position.y = -0.05;
  envScene.add(floor);

  for (const spec of STUDIO_SOFTBOXES) envScene.add(createStudioSoftboxMesh(spec, spec.envGain));

  studioEnvTexture = generateEnvironment(envScene);
  // 环境烘焙场景只用于一次性出图：显式释放它自己的几何 / 材质（共享的柔光箱贴图不释放）。
  envScene.traverse((object) => {
    if (object.isMesh) {
      object.geometry.dispose();
      if (object.material) object.material.dispose();
    }
  });
}

/** 面光源 / 柔光箱强度复用现有「灯光强度」总增益，方位复用「主光方向」，只在棚拍模式可见。 */
function updateStudioLights() {
  if (!studioGroup) return;
  const keyArea = studioGroup.userData.keyArea;
  const rimArea = studioGroup.userData.rimArea;
  const gain = lightGain();
  const azimuth = THREE.MathUtils.degToRad(state.lightAngle);
  if (keyArea) {
    keyArea.position.set(Math.cos(azimuth) * 22, 13, Math.sin(azimuth) * 22);
    keyArea.lookAt(0, 0, 0);
    // 官方 keyPower 6 / rimPower 5 是 WGSL 侧数值，不能直接照搬 three 面光源单位；
    // 这里取较小基数，避免与棚拍环境贴图叠加后过曝（观感细节待 Codex 浏览器复核）。
    keyArea.intensity = 2.5 * gain;
  }
  if (rimArea) {
    rimArea.position.set(17, 11, -12);
    rimArea.lookAt(0, 0, 0);
    rimArea.intensity = 2 * gain;
  }
  // 可见发光柔光箱板：颜色 × 总增益（加法混合，gain=0 即熄灭，不残留灰板）。
  for (const { mesh: softbox, spec } of studioSoftboxes) {
    softbox.material.color.copy(spec.color).multiplyScalar(spec.gain * gain);
  }
  markDirty();
}

/** 地面跟随真实世界包围盒：始终落在模型最低点下方一个小间隙处，厚 / 高模型不会被切。 */
function updateStudioPlacement() {
  if (!studioGroup) return;
  let minY = -2;
  let height = 4;
  if (hasGeometry && mesh.geometry && mesh.geometry.boundingBox) {
    const box = mesh.geometry.boundingBox;
    const scale = Math.abs(mesh.scale.y) || 1;
    minY = Math.min(box.min.y, box.max.y) * scale;
    height = Math.abs(box.max.y - box.min.y) * scale;
  }
  const gap = THREE.MathUtils.clamp(height * 0.06, 0.08, 0.6);
  studioFloorY = minY - gap;
  studioGroup.position.y = studioFloorY;
  markDirty();
}

/** 棚拍几何只在「棚拍模式且非透明」时可见（透明导出仍保留资源，解除勾选即恢复）。 */
function syncStudioVisibility() {
  if (!studioGroup) return;
  studioGroup.visible = state.bgMode === "studio" && !state.transparent;
}

/** 棚拍环境 / 主光只在棚拍模式启用；离开时恢复原有 RoomEnvironment。 */
function applyEnvironmentMode() {
  const studio = state.bgMode === "studio";
  scene.environment = studio && studioEnvTexture ? studioEnvTexture : roomEnvTexture;
  applySceneEnvironmentIntensity();
  scene.fog = studio && !state.transparent ? studioFog : null;
  if (studioGroup) {
    const keyArea = studioGroup.userData.keyArea;
    const rimArea = studioGroup.userData.rimArea;
    if (keyArea) keyArea.visible = studio;
    if (rimArea) rimArea.visible = studio;
  }
  markDirty();
}

/** 背景模式下拉 / 状态同步（不碰相机，也不重建已有图片或棚拍资源）。 */
function updateBackgroundControls() {
  if (els.bgMode) els.bgMode.value = state.bgMode;
  updateBackgroundPanControls();
}

/** 切换背景模式：进入棚拍时才懒构建静物与环境；图片与棚拍资源都保留备用。 */
function setBackgroundMode(mode) {
  state.bgMode = mode === "studio" || mode === "image" ? mode : "pure";
  if (state.bgMode === "studio") {
    buildStudioRig();
    buildStudioEnvironment();
  }
  applyBackground();
  updateBackgroundControls();
  const labels = { pure: "纯色", studio: "棚拍空间", image: "图片" };
  setStatus(
    `背景模式：${labels[state.bgMode]}` +
      (state.bgMode === "image" && !bgTexture ? "（尚未上传图片，暂时显示纯色）" : "")
  );
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

/* ------------------------------------------------- 解析缓存与参数映射 */

/**
 * 解析缓存：按 SVG 文本缓存 shapes / 平面最大边长 / 各 curveSegments 的采样点数。
 * 拖动参数时只重建几何，不重复 parseSVG、不重复 `getPoints` 遍历曲线，也不会累积内存。
 */
let shapeCache = { text: "", shapes: null, maxFlatDim: 0, sampleCounts: new Map() };

/**
 * 解析并缓存 shapes。
 *
 * 顺序很重要：`parseShapesFromSVG` → **下限估算** → `measureFlatMaxDim`。
 * `measureFlatMaxDim` 内部用 `ShapeGeometry` 三角化；单条 path 塞几千条曲线时
 * 三角化本身就要数秒，所以先用最低细分做一次下限估算，连下限都超硬上限的输入
 * 在这里就抛错，交给 `rebuild` 拒绝并保留上一次成功模型（缓存不被覆盖）。
 * 真正装得下的输入继续走 `planShapes` 的自适应裁剪。
 */
function getShapes(text, options = {}) {
  if (shapeCache.text === text && shapeCache.shapes) return shapeCache;

  const shapes = parseShapesFromSVG(text);

  const bevelEnabled = options.bevelEnabled !== false;
  const minimum = estimateMinimumVertices(shapes, { bevelEnabled });
  if (minimum.estVerts > LIMITS.vertexBudget) {
    const error = new Error(
      `已拒绝导入：路径曲线过于密集，即使降到最低细分（曲线 ${minimum.curveSegments} 段 / ` +
        `倒角 ${minimum.bevelEnabled ? minimum.bevelSegments : 0} 段）仍估算约 ` +
        `${minimum.estVerts.toLocaleString("en-US")} 个挤出顶点，超过硬上限 ` +
        `${LIMITS.vertexBudget.toLocaleString("en-US")}。请减少曲线 / 节点后再试。`
    );
    error.guard = { code: "vertex-budget-min", reason: error.message };
    throw error;
  }

  const maxFlatDim = measureFlatMaxDim(shapes);
  shapeCache = {
    text,
    shapes,
    maxFlatDim,
    sampleCounts: new Map([[minimum.curveSegments, minimum.sampledPoints]])
  };
  return shapeCache;
}

/** 采样点数缓存：同一个 curveSegments 只遍历一次曲线。 */
function samplePointsFor(cache, curveSegments) {
  if (!cache.sampleCounts.has(curveSegments)) {
    cache.sampleCounts.set(curveSegments, sampleContourPoints(cache.shapes, curveSegments));
  }
  return cache.sampleCounts.get(curveSegments);
}

/**
 * 本次是否真的启用倒角：勾选开启且圆角宽度 / 倒角深度至少有一个 > 0%。
 * 两处共用同一判定（下限估算的降级下限、`buildExtrudeSettings` 的入参），避免漂移。
 */
function bevelIsActive() {
  const toRatio = (v) => Math.max(0, Number(v) || 0) / 100;
  return state.bevelEnabled && (toRatio(state.bevelSize) > 0 || toRatio(state.bevelThickness) > 0);
}

/**
 * 几何参数映射（本工具只做百分比 → 上游 / three 参数的换算）：
 *   - 厚度 = 最大平面边长 × 厚度%（2–100，默认 16）；
 *   - 边缘圆角宽度 = 最大平面边长 × 圆角%（0–10，默认 2）；
 *   - 倒角深度 = 最大平面边长 × 倒角%（0–10，默认 2）。
 *
 * 上游 `buildExtrudeSettings` 的 `bevelScale = min(maxFlatDim*0.05, 1)` 会把大 SVG 的倒角
 * 绝对封顶在 1，因此这里只复用它的 depth / curveSegments / bevelSegments 与顶点预算裁剪，
 * 倒角尺寸单独按百分比换算；并沿用「倒角不超过厚度一半」的几何保护上限，
 * 达到上限时记录**实际值**与限制原因，而不是悄悄钳制。
 */
function computeExtrudeSettings(cache, shapeCount) {
  const toRatio = (v) => Math.max(0, Number(v) || 0) / 100;
  const flat = cache.maxFlatDim;

  // 圆角宽度与倒角深度都为 0 时完全关闭倒角（不生成无意义的零尺寸倒角层）。
  const bevelActive = bevelIsActive();

  const base = buildExtrudeSettings(flat, shapeCount, {
    depth: (Number(state.depth) || 0) / 10, // 上游 depth 旋钮 0–10 等价于 0–100%
    smoothness: state.smoothness,
    bevelEnabled: bevelActive,
    bevelThickness: 1,
    bevelSize: 1,
    vertexBudget: LIMITS.vertexBudget
  });

  const depthUnits = base.depth;
  const maxBevel = Math.max(0.0001, depthUnits * 0.5);
  const requestedBevelSize = bevelActive ? toRatio(state.bevelSize) * flat : 0;
  const requestedBevelThickness = bevelActive ? toRatio(state.bevelThickness) * flat : 0;
  const bevelSizeUnits = Math.min(requestedBevelSize, maxBevel);
  const bevelThicknessUnits = Math.min(requestedBevelThickness, maxBevel);
  const limited =
    requestedBevelSize > bevelSizeUnits + 1e-9 || requestedBevelThickness > bevelThicknessUnits + 1e-9;

  const actualPercent = (units) => (flat > 0 ? +((units / flat) * 100).toFixed(2) : 0);

  return {
    settings: {
      depth: depthUnits,
      bevelEnabled: bevelActive,
      bevelThickness: bevelThicknessUnits,
      bevelSize: bevelSizeUnits,
      bevelSegments: base.bevelSegments,
      curveSegments: base.curveSegments
    },
    meta: {
      maxFlatDim: flat,
      depthUnits,
      bevelSizeUnits,
      bevelThicknessUnits,
      bevelSizePercent: actualPercent(bevelSizeUnits),
      bevelThicknessPercent: actualPercent(bevelThicknessUnits),
      bevelLimit: limited
    }
  };
}

/** 状态行：把本次真实使用的百分比、细分与限制如实写出来。 */
function modelStatusText(plan) {
  const parts = [
    `已建模 · ${state.svgName}`,
    `厚度 ${state.depth}%`,
    state.bevelEnabled
      ? `倒角 ${state.bevelThickness}% / 圆角 ${state.bevelSize}%`
      : "倒角 关",
    `平滑度 ${state.smoothness.toFixed(2)}`,
    `材质 ${materialLabel(state.preset)}`
  ];
  if (plan && plan.reduced) {
    parts.push(`已自动降低细分（曲线 ${plan.curveSegments} 段 / 倒角 ${plan.bevelSegments} 段）`);
  }
  if (appliedSettings.bevelLimit) {
    parts.push(
      `倒角受厚度限制：实际 圆角 ${appliedSettings.bevelSizePercent}% / 深度 ${appliedSettings.bevelThicknessPercent}%（不超过厚度一半）`
    );
  }
  return parts.join(" · ");
}

/* ------------------------------------------- 几何来源：原生立方体 / SVG 分支 */

/**
 * 每个来源各自记住上一次的几何滑杆值：切到立方体再切回 SVG 时恢复上次 SVG 的深度 / 倒角，
 * 不覆盖用户手动编辑；第一次进入某来源用它自己的默认值（SVG 深度 16%、立方体 100%）。
 */
const geometrySettingsMemory = {
  svg: { depth: 16, bevelSize: 2, bevelThickness: 2, bevelEnabled: true, smoothness: 0.5 },
  cube: { depth: 100, bevelSize: 2, bevelThickness: 2, bevelEnabled: true, smoothness: 0.5 }
};

function rememberGeometrySettings(source) {
  if (!geometrySettingsMemory[source]) return;
  geometrySettingsMemory[source] = {
    depth: state.depth,
    bevelSize: state.bevelSize,
    bevelThickness: state.bevelThickness,
    bevelEnabled: state.bevelEnabled,
    smoothness: state.smoothness
  };
}

/** 把 state 里的几何参数写回滑杆 / 输出，保持界面与状态一致（不回派事件）。 */
function syncGeometryControls() {
  const set = (input, out, value, format) => {
    if (input) input.value = String(value);
    if (out) out.textContent = format(value);
  };
  set(els.depth, els.depthOut, state.depth, DECIMALS.depth);
  set(els.bevelSize, els.bevelSizeOut, state.bevelSize, DECIMALS.bevelSize);
  set(els.bevelThickness, els.bevelThicknessOut, state.bevelThickness, DECIMALS.bevelThickness);
  set(els.smoothness, els.smoothnessOut, state.smoothness, DECIMALS.smoothness);
  if (els.bevelEnabled) els.bevelEnabled.checked = state.bevelEnabled;
}

/** 恢复某来源的上次几何滑杆值并同步 UI（不触发重建，由调用方接着 rebuild）。 */
function restoreGeometrySettings(source) {
  const saved = geometrySettingsMemory[source];
  if (!saved) return;
  state.depth = saved.depth;
  state.bevelSize = saved.bevelSize;
  state.bevelThickness = saved.bevelThickness;
  state.bevelEnabled = saved.bevelEnabled;
  state.smoothness = saved.smoothness;
  syncGeometryControls();
}

/** 当前立方体的真实尺寸与圆角半径：Z = 最大边 × 厚度%；圆角受最短边一半限制。 */
function cubeShape() {
  const depthPercent = THREE.MathUtils.clamp(Number(state.depth) || 0, 2, 100);
  const depthUnits = (CUBE_MAX_EDGE * depthPercent) / 100;
  const minEdge = Math.min(CUBE_MAX_EDGE, depthUnits);
  const requestedRadius = state.bevelEnabled
    ? (Math.max(0, Number(state.bevelSize) || 0) / 100) * CUBE_MAX_EDGE
    : 0;
  const radius = Math.min(requestedRadius, Math.max(0, minEdge / 2 - 1e-4));
  return { depthPercent, depthUnits, radius, limited: requestedRadius > radius + 1e-9 };
}

/** 立方体状态行：写出真实尺寸、圆角与限制，而不是复用 SVG 的厚度 / 倒角文案。 */
function cubeStatusText() {
  const shape = cubeShape();
  const round =
    shape.radius > 1e-4
      ? `圆角 ${appliedSettings.bevelSizePercent}%（${shape.radius.toFixed(3)} 单位）`
      : "直角（未启用圆角）";
  const limit = shape.limited ? " · 圆角受最短边限制" : "";
  return `已建模 · 立方体 4×4×${shape.depthUnits.toFixed(2)} · ${round} · 材质 ${materialLabel(state.preset)}${limit}`;
}

/**
 * 原生真实立方体：three `BoxGeometry` / addon `RoundedBoxGeometry`，宽高固定 4（与 SVG
 * 归一化口径一致），Z = 4 × 厚度%，圆角半径由现有「边缘圆角宽度%」按最大边换算。
 * 没有 SVG 近似、没有自研建模系统，只是一个几何来源分支。
 */
function rebuildCube() {
  const { depthPercent, depthUnits, radius, limited } = cubeShape();
  let geometry;
  try {
    geometry =
      radius > 1e-4
        ? new RoundedBoxGeometry(CUBE_MAX_EDGE, CUBE_MAX_EDGE, depthUnits, CUBE_ROUND_SEGMENTS, radius)
        : new THREE.BoxGeometry(CUBE_MAX_EDGE, CUBE_MAX_EDGE, depthUnits);
  } catch (error) {
    setError(`立方体构建失败：${error && error.message ? error.message : String(error)}`);
    return;
  }

  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();

  let radiusSq = 0;
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const d = x * x + y * y + z * z;
    if (d > radiusSq) radiusSq = d;
  }

  const previous = mesh.geometry;
  mesh.geometry = geometry;
  if (previous) previous.dispose();
  hasGeometry = true;
  mesh.scale.setScalar(1); // 立方体本身已经按「最大边 = 4」归一化
  geometryRadius = Math.max(Math.sqrt(radiusSq), 0.05);

  state.shapeCount = 1;
  state.vertexCount = position.count;
  state.modelThickness = depthUnits;
  state.lastError = null;

  appliedSettings = {
    maxFlatDim: CUBE_MAX_EDGE,
    baseScale: 1,
    depthPercent,
    depthUnits: +depthUnits.toFixed(6),
    bevelEnabled: radius > 1e-4,
    bevelSizePercent: depthUnits > 0 ? +((radius / CUBE_MAX_EDGE) * 100).toFixed(2) : 0,
    bevelSizeUnits: +radius.toFixed(6),
    bevelThicknessPercent: 0,
    bevelThicknessUnits: 0,
    bevelLimit: limited,
    bevelSegments: radius > 1e-4 ? CUBE_ROUND_SEGMENTS : 0,
    curveSegments: 0,
    reduction: false,
    sampledPoints: 0,
    estVerts: 0,
    actualVerts: position.count
  };

  refitView();
  setError(null);
  updateStats();
  // 透射材质的局部 thickness 依赖归一化模型厚度，几何变化后同步一次。
  if (isTransmissivePreset(state.preset)) applyMaterial();
  updateStudioPlacement();
  markDirty();
  setStatus(cubeStatusText());
}

/** 参数变化 → 重新构建几何。拒绝时保留上一次成功模型，不渲染半个坏模型。 */
function rebuild() {
  if (state.source === CUBE_SAMPLE_ID) {
    rebuildCube();
    return;
  }
  rebuildSvg();
}

function rebuildSvg() {
  if (!state.svgText) return;

  const guard = inspectSvg(state.svgText);
  if (!guard.ok) {
    setError(guard.reason);
    setStatus(`已拒绝当前 SVG（${guard.code}）· 画布保留上一次成功模型`);
    return;
  }

  // 只解析一次：shapes / 平面尺寸按 SVG 文本缓存，参数变化不重复解析。
  // 下限估算在三角化前拦掉连最低细分都装不下的输入；拒绝时不覆盖缓存。
  let cache;
  try {
    cache = getShapes(state.svgText, { bevelEnabled: bevelIsActive() });
  } catch (error) {
    if (error && error.guard) {
      setError(error.guard.reason);
      setStatus(`已拒绝当前 SVG（${error.guard.code}）· 画布保留上一次成功模型`);
    } else {
      setError(`SVG 解析失败：${error && error.message ? error.message : String(error)}`);
      setStatus("解析失败 · 画布保留上一次成功模型");
    }
    return;
  }

  const shapeCount = cache.shapes.length;
  const { settings, meta } = computeExtrudeSettings(cache, shapeCount);

  // 几何级闸门：按本次真实 curveSegments / bevelSegments / bevelEnabled 估算；
  // 超预算先自适应降低细分，降到合理下限仍超出才拒绝。
  const plan = planShapes(cache.shapes, {
    curveSegments: settings.curveSegments,
    bevelSegments: settings.bevelSegments,
    bevelEnabled: settings.bevelEnabled,
    vertexBudget: LIMITS.vertexBudget,
    samplePoints: (cs) => samplePointsFor(cache, cs)
  });
  if (!plan.ok) {
    setError(plan.reason);
    setStatus(`已拒绝当前 SVG（${plan.code}）· 画布保留上一次成功模型`);
    return;
  }
  settings.curveSegments = plan.curveSegments;
  settings.bevelSegments = plan.bevelSegments;

  let merged = null;
  try {
    const geos = cache.shapes.map((shape) => new THREE.ExtrudeGeometry(shape, settings));
    merged = BufferGeometryUtils.mergeGeometries(geos, false);
    geos.forEach((geo) => geo.dispose());
  } catch (error) {
    setError(`模型构建失败：${error && error.message ? error.message : String(error)}`);
    setStatus("构建失败 · 画布保留上一次成功模型");
    return;
  }

  if (!merged) {
    setError("这个 SVG 生成立体模型失败：可能轮廓没有闭合，或图形无法三角化。");
    setStatus("构建失败 · 画布保留上一次成功模型");
    return;
  }

  // 与 buildExtrudedGeometry 完全一致的收尾：平滑折痕法线 + 三平面 UV（均为上游实现）。
  const smoothed = smoothCreaseNormals(merged, Math.PI / 6);
  merged.dispose();
  merged = smoothed;
  merged.computeBoundingBox();
  recomputeTriplanarUVs(merged, merged.boundingBox);

  const center = new THREE.Vector3();
  merged.boundingBox.getCenter(center);

  // 采样估算是保守近似；万一实际几何仍超硬上限，直接丢弃，绝不把坏模型换上去。
  const actualVerts = merged.attributes.position ? merged.attributes.position.count : 0;
  if (actualVerts > LIMITS.vertexBudget) {
    merged.dispose();
    setError(
      `已拒绝导入：实际生成 ${actualVerts.toLocaleString("en-US")} 个顶点，超过上限 ` +
        `${LIMITS.vertexBudget.toLocaleString("en-US")}。请减少曲线或降低平滑度。`
    );
    setStatus("已拒绝 · 画布保留上一次成功模型");
    return;
  }

  merged.translate(-center.x, -center.y, -center.z);
  merged.computeBoundingBox();

  // 顶点到原点（几何中心）的精确最大距离 → 取景用；旋转不改变距离，故只需算一次
  let radiusSq = 0;
  const position = merged.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const d = x * x + y * y + z * z;
    if (d > radiusSq) radiusSq = d;
  }

  // 一次归一化：平面最大边长固定为 4 单位；与厚度 / 倒角无关，改动不会被缩放抵消。
  const baseScale = meta.maxFlatDim > 0 ? FLAT_NORMALIZED_SIZE / meta.maxFlatDim : 1;
  geometryRadius = Math.sqrt(radiusSq) * baseScale;

  const previous = mesh.geometry;
  mesh.geometry = merged;
  if (previous) previous.dispose();
  hasGeometry = true;
  mesh.scale.setScalar(baseScale);

  state.shapeCount = shapeCount;
  state.vertexCount = actualVerts;
  state.lastError = null;
  // 归一化后的世界空间真实模型厚度（z 尺寸 × baseScale），供透射材质换算局部 thickness 使用。
  state.modelThickness = Math.max(0, merged.boundingBox.max.z - merged.boundingBox.min.z) * baseScale;

  appliedSettings = {
    maxFlatDim: +meta.maxFlatDim.toFixed(6),
    baseScale: +baseScale.toFixed(6),
    depthPercent: state.depth,
    depthUnits: +meta.depthUnits.toFixed(6),
    bevelEnabled: settings.bevelEnabled,
    bevelSizePercent: meta.bevelSizePercent,
    bevelSizeUnits: +meta.bevelSizeUnits.toFixed(6),
    bevelThicknessPercent: meta.bevelThicknessPercent,
    bevelThicknessUnits: +meta.bevelThicknessUnits.toFixed(6),
    bevelLimit: meta.bevelLimit,
    bevelSegments: plan.bevelSegments,
    curveSegments: plan.curveSegments,
    reduction: plan.reduced,
    sampledPoints: plan.sampledPoints,
    estVerts: plan.estVerts,
    actualVerts
  };

  refitView();
  setError(null);
  updateStats();
  // 透射材质的局部 thickness 依赖等比缩放（玻璃还依赖归一化模型厚度），几何变化后同步一次。
  if (isTransmissivePreset(state.preset)) applyMaterial();
  // 棚拍地面跟随新的真实包围盒（切换过棚拍模式才存在）。
  updateStudioPlacement();
  markDirty();
  setStatus(modelStatusText(plan));
}

/* ----------------------------- 输入合并：拖动滑块每帧最多重建一次 */

let rebuildQueued = false;

function requestRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    rebuild();
  });
}

/* ------------------------------------------------------------------ 载入 */

/**
 * 切到 SVG 来源：记住立方体的几何滑杆，恢复上一次 SVG 的值（第一次为深度 16%）。
 * 已经在 SVG 时直接返回，避免覆盖用户当前手动编辑。
 */
function enterSvgSource() {
  if (state.source === "svg") return;
  rememberGeometrySettings(state.source);
  state.source = "svg";
  restoreGeometrySettings("svg");
}

/** 切到原生立方体来源：记住 SVG 的几何滑杆，恢复立方体自己的上次值（第一次为 100%）。 */
function setSourceCube({ resetView = false } = {}) {
  if (state.source !== CUBE_SAMPLE_ID) {
    rememberGeometrySettings(state.source);
    state.source = CUBE_SAMPLE_ID;
    restoreGeometrySettings(CUBE_SAMPLE_ID);
  }
  state.svgName = "立方体";
  els.name.textContent = "立方体";
  els.name.title = "内置立方体（three 原生 BoxGeometry / RoundedBoxGeometry）";
  rebuild();
  if (resetView) resetViewpoint();
}

function loadSvg(text, name, { resetView = false } = {}) {
  enterSvgSource();
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
  renderFrame();

  els.canvas.toBlob((blob) => {
    // 立刻恢复视图尺寸，避免导出分辨率残留；setSize 会清空画布，
    // 而下一帧 RAF 之前画布会保持空白，所以这里必须紧接着重绘一次预览。
    renderer.setPixelRatio(previousPixelRatio);
    renderer.setSize(size.x, size.y, false);
    renderFrame();
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
  depth: (v) => `${v.toFixed(0)}%`,
  bevelThickness: (v) => `${v.toFixed(1)}%`,
  bevelSize: (v) => `${v.toFixed(1)}%`,
  smoothness: (v) => v.toFixed(2),
  roughness: (v) => v.toFixed(2),
  envIntensity: (v) => v.toFixed(2),
  exposure: (v) => v.toFixed(2),
  glassIor: (v) => v.toFixed(2),
  glassThickness: (v) => `×${v.toFixed(2)}`,
  glassDispersion: (v) => v.toFixed(2),
  lightIntensity: (v) => v.toFixed(2),
  lightAngle: (v) => `${v.toFixed(0)}°`
};

/** 几何参数滑块：同步状态与标签后，用 RAF 合并重建（拖动过程中每帧最多一次）。 */
function bindGeometrySlider(input, out, key) {
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    out.textContent = DECIMALS[key](state[key]);
    requestRebuild();
  });
  out.textContent = DECIMALS[key](state[key]);
  input.value = String(state[key]);
}

/** 材质 / 灯光参数滑块：同步状态与标签后立即应用（不重建几何）。 */
function bindValueSlider(input, out, key, apply) {
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    out.textContent = DECIMALS[key](state[key]);
    apply();
  });
  out.textContent = DECIMALS[key](state[key]);
  input.value = String(state[key]);
}

/**
 * 「强色散示例」：一次点击就把界面填成「原生立方体 + 透明玻璃 + 强色散 + 本地白底黑字背景」。
 * 背景用页面内 canvas 现画（白底 + 大号黑字 ImageLAB），再走既有本地图片校验管线
 * （PNG blob → File → backgroundLoader），不联网、不使用任何用户截图 / 商标素材。
 */
function buildDispersionDemoBackground() {
  const width = 1600;
  const height = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(height * 0.28)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText("ImageLAB", width / 2, height / 2);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

async function applyDispersionDemo() {
  // 1) 立方体 + 透明玻璃 + ior 1.5 + 色散 10：直接写控件并派发原生事件，UI 与状态一致
  els.sample.value = CUBE_SAMPLE_ID;
  els.sample.dispatchEvent(new Event("change", { bubbles: true }));
  els.material.value = GLASS_PRESET_ID;
  els.material.dispatchEvent(new Event("change", { bubbles: true }));
  els.glassIor.value = "1.5";
  els.glassIor.dispatchEvent(new Event("input", { bubbles: true }));
  els.glassDispersion.value = "10";
  els.glassDispersion.dispatchEvent(new Event("input", { bubbles: true }));

  // 2) 本地 canvas 生成白底黑字背景，复用既有本地图片校验 / 解码 / cover 管线
  const blob = await buildDispersionDemoBackground();
  if (!blob) {
    setStatus("强色散示例：本地背景生成失败，请改用「上传背景图片」");
    return;
  }
  const file = new File([blob], "imagelab-dispersion-demo.png", { type: "image/png" });
  backgroundLoader.load(file);
  setStatus("强色散示例：立方体 + 透明玻璃 + 折射率 1.50 + 色散 10 + 本地白底黑字背景");
}

function init() {
  buildMaterialSelect();
  els.material.value = state.preset;
  applyMaterial();
  applyBackground();
  updateBackgroundControls();

  bindGeometrySlider(els.depth, els.depthOut, "depth");
  bindGeometrySlider(els.bevelThickness, els.bevelThicknessOut, "bevelThickness");
  bindGeometrySlider(els.bevelSize, els.bevelSizeOut, "bevelSize");
  bindGeometrySlider(els.smoothness, els.smoothnessOut, "smoothness");

  els.bevelEnabled.addEventListener("change", () => {
    state.bevelEnabled = els.bevelEnabled.checked;
    requestRebuild();
  });

  els.material.addEventListener("change", () => {
    state.preset = els.material.value;
    state.color = presetColor(state.preset);
    applyMaterial();
    setStatus(`材质已切换到 ${materialLabel(state.preset)}`);
  });

  // 玻璃设置：只在「透明玻璃」下可调，改参数立即更新材质高光 / 折射。
  bindValueSlider(els.glassIor, els.glassIorOut, "glassIor", applyMaterial);
  bindValueSlider(els.glassThickness, els.glassThicknessOut, "glassThickness", applyMaterial);
  bindValueSlider(els.glassDispersion, els.glassDispersionOut, "glassDispersion", applyMaterial);

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
    if (file) textureLoader.load(file);
  });
  els.textureRemove.addEventListener("click", () => removeTexture());

  els.bgFile.addEventListener("change", () => {
    const file = els.bgFile.files && els.bgFile.files[0];
    if (file) backgroundLoader.load(file);
  });
  els.bgRemove.addEventListener("click", () => removeBackground());
  els.bgZoom.addEventListener("input", () => {
    state.bgZoom = Number(els.bgZoom.value);
    els.bgZoomOut.textContent = state.bgZoom.toFixed(2);
    fitBackgroundTexture(); // 缩放改变裁切余量：同步重算居中 / 裁切位置与滑杆可用性
  });
  els.bgPanX.addEventListener("input", () => {
    state.bgPanX = Number(els.bgPanX.value);
    els.bgPanXOut.textContent = formatPan(state.bgPanX);
    fitBackgroundTexture();
  });
  els.bgPanY.addEventListener("input", () => {
    state.bgPanY = Number(els.bgPanY.value);
    els.bgPanYOut.textContent = formatPan(state.bgPanY);
    fitBackgroundTexture();
  });
  els.bgPanReset.addEventListener("click", () => {
    state.bgPanX = 0;
    state.bgPanY = 0;
    els.bgPanX.value = "0";
    els.bgPanY.value = "0";
    els.bgPanXOut.textContent = "0%";
    els.bgPanYOut.textContent = "0%";
    fitBackgroundTexture();
    setStatus("背景位置已重置（居中）");
  });

  els.envIntensity.addEventListener("input", () => {
    state.envIntensity = Number(els.envIntensity.value);
    els.envIntensityOut.textContent = DECIMALS.envIntensity(state.envIntensity);
    applySceneEnvironmentIntensity();
    markDirty();
  });
  // 灯光强度 = 总光量增益：原生直接光 + 可见发光柔光箱板 + 静态环境反射强度一起缩放。
  bindValueSlider(els.lightIntensity, els.lightIntensityOut, "lightIntensity", () => {
    keyLight.intensity = state.lightIntensity;
    applySceneEnvironmentIntensity();
    updateStudioLights();
    markDirty();
  });
  bindValueSlider(els.lightAngle, els.lightAngleOut, "lightAngle", () => {
    updateKeyLight();
    updateStudioLights();
  });
  els.exposure.addEventListener("input", () => {
    state.exposure = Number(els.exposure.value);
    els.exposureOut.textContent = DECIMALS.exposure(state.exposure);
    renderer.toneMappingExposure = state.exposure;
    markDirty();
  });
  els.bg.addEventListener("input", () => {
    state.bg = els.bg.value;
    applyBackground();
  });
  els.bgMode.addEventListener("change", () => setBackgroundMode(els.bgMode.value));
  els.transparentBg.addEventListener("change", () => {
    state.transparent = els.transparentBg.checked;
    applyBackground();
  });

  els.sample.addEventListener("change", () => {
    if (els.sample.value === CUBE_SAMPLE_ID) {
      setSourceCube({ resetView: true });
      return;
    }
    const sample = SAMPLES[els.sample.value];
    if (sample) loadSvg(sample.text, sample.name, { resetView: true });
  });

  els.file.addEventListener("change", async () => {
    const file = els.file.files && els.file.files[0];
    if (!file) return;
    // 文件大小先拦一层，避免把超大文件整个读进内存
    if (file.size > LIMITS.maxBytes) {
      setError(
        `已拒绝导入：文件过大（${formatBytes(file.size)}，上限 ${formatBytes(LIMITS.maxBytes)}）。` +
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
  if (els.dispersionDemo) els.dispersionDemo.addEventListener("click", applyDispersionDemo);

  /* 首次加载：直接展示原生立方体（透明玻璃 + 默认色散），页面一进来就有真实光学内容 */
  new ResizeObserver(() => resize()).observe(els.view);
  resize();
  if (els.sample.value === CUBE_SAMPLE_ID) {
    setSourceCube();
  } else {
    const first = SAMPLES[els.sample.value] || SAMPLES["square-ring"];
    loadSvg(first.text, first.name);
  }
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
  fitBackgroundTexture(); // 背景图片按新视口比例重算 cover，并保留当前裁切位置
  // setSize 会清空画布：同步补一帧，避免错误提示等布局变化后短暂空白。
  markDirty();
  renderFrame();
}

function animate() {
  requestAnimationFrame(animate);
  if (document.hidden) return; // 页面隐藏时不再出图
  const controlsChanged = controls.update();
  if (!exporting && (renderDirty || controlsChanged)) renderFrame();
}

// 页面重新可见时补一帧，避免隐藏期间错过的更新被永久跳过。
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) markDirty();
});

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
    const material = mesh.material;
    // 反射面的真实世界法线（原生 Reflector 用物体 matrixWorld 旋转本地 +Z 得到）：
    // 只读诊断，供测试确认地面法线是 (0,1,0) 而不是 (0,0,1)。
    let reflectorNormal = null;
    if (studioReflector) {
      studioReflector.updateWorldMatrix(true, false);
      const normal = new THREE.Vector3(0, 0, 1)
        .applyMatrix4(new THREE.Matrix4().extractRotation(studioReflector.matrixWorld))
        .normalize();
      reflectorNormal = [+normal.x.toFixed(4), +normal.y.toFixed(4), +normal.z.toFixed(4)];
    }
    return {
      preset: state.preset,
      source: state.source,
      geometryType: hasGeometry ? mesh.geometry.type : null,
      shapeCount: state.shapeCount,
      vertexCount: state.vertexCount,
      size,
      // 本地几何单位 → 归一化单位（平面最大边长 = 4）后的实际尺寸
      normalizedSize: {
        size: appliedSettings.baseScale ? size.map((v) => +(v * appliedSettings.baseScale).toFixed(4)) : size,
        baseScale: appliedSettings.baseScale
      },
      // 本次真实使用的几何 / 细分参数与预算诊断（只读）
      settings: {
        depthPercent: appliedSettings.depthPercent,
        depthUnits: appliedSettings.depthUnits,
        bevelEnabled: appliedSettings.bevelEnabled,
        bevelSizePercent: appliedSettings.bevelSizePercent,
        bevelThicknessPercent: appliedSettings.bevelThicknessPercent,
        bevelLimit: appliedSettings.bevelLimit,
        bevelSegments: appliedSettings.bevelSegments,
        curveSegments: appliedSettings.curveSegments,
        reduction: appliedSettings.reduction,
        sampledPoints: appliedSettings.sampledPoints,
        estVerts: appliedSettings.estVerts,
        actualVerts: appliedSettings.actualVerts
      },
      // 本次材质的关键 PBR / 透射参数（只读）
      material: material
        ? {
            type: material.type,
            transmission: material.transmission,
            opacity: material.opacity,
            transparent: material.transparent,
            ior: material.ior,
            thickness: material.thickness,
            // 世界空间有效厚度 = 局部 thickness × 等比缩放（着色器 getVolumeTransmissionRay 同口径）
            effectiveThickness: +((material.thickness || 0) * Math.abs(mesh.scale.z)).toFixed(6),
            dispersion: material.dispersion ?? 0,
            metalness: material.metalness,
            roughness: material.roughness,
            hasMap: !!material.map,
            // 透射材质应为 DoubleSide(2) + forceSinglePass=false：three 原生多趟背面透射
            side: material.side,
            forceSinglePass: material.forceSinglePass
          }
        : null,
      // 基础主光 / 总光量增益只读快照
      light: {
        intensity: keyLight.intensity,
        gain: +lightGain().toFixed(4),
        environmentIntensity: +scene.environmentIntensity.toFixed(4),
        angle: state.lightAngle,
        position: [keyLight.position.x, keyLight.position.y, keyLight.position.z].map((v) => +v.toFixed(4))
      },
      // 棚拍空间只读快照（未进入 == 全部空值 / 0）
      studio: {
        mode: state.bgMode,
        active: state.bgMode === "studio" && !state.transparent,
        visible: !!studioGroup && studioGroup.visible,
        floorY: +studioFloorY.toFixed(4),
        reflector: !!studioReflector,
        reflectorNormal,
        mirrorTarget: studioReflector
          ? [studioReflector.getRenderTarget().width, studioReflector.getRenderTarget().height]
          : null,
        rectLights: studioRectLights.length,
        softboxes: studioSoftboxes.length,
        environment: studioEnvTexture && scene.environment === studioEnvTexture ? "studio" : "room"
      },
      cameraDistance: +camera.position.distanceTo(controls.target).toFixed(3),
      renders: renderCount,
      lastError: state.lastError,
      transparent: state.transparent,
      texture: textureInfo(),
      background: backgroundInfo(),
      canvas: [els.canvas.width, els.canvas.height]
    };
  },
  scene,
  camera,
  renderer,
  mesh,
  keyLight
};

init();
