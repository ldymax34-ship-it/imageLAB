/**
 * SVG 转 3D · 建模页签（Three.js）
 *
 * 职责边界（与渲染页签分工）：
 *   - 只负责 SVG 导入与安全校验、挤出几何（厚度 / 倒角 / 平滑度）、原生立方体、诊断预览；
 *   - 预览固定使用中性灰材质与中性光，不是产品材质；不提供最终灯光 / 背景 / PNG 导出；
 *   - 几何构建成功后把同一份 position / normal / uv / index 网格交给渲染页签（in-memory）。
 *
 * 几何能力全部来自既有开源件：`@visant/extrude3d`（MIT）的解析 / 尺寸 / 挤出参数 / 平滑法线 /
 * 三平面 UV，以及 three 0.186.1（MIT）的 `ExtrudeGeometry` / `RoundedBoxGeometry` /
 * `mergeGeometries`。本工具只做百分比参数映射与界面接线。
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import {
  buildExtrudeSettings,
  measureFlatMaxDim,
  parseShapesFromSVG,
  recomputeTriplanarUVs,
  smoothCreaseNormals
} from "@visant/extrude3d";
import { finalizeBeamOutline } from "./beam-outline.js";
import {
  LIMITS,
  estimateMinimumVertices,
  formatBytes,
  inspectSvg,
  planShapes,
  sampleContourPoints
} from "./svg-guard.js";

import hexNestSvg from "./samples/hex-nest.svg?raw";
import letterAStarSvg from "./samples/letter-a-star.svg?raw";
import squareRingSvg from "./samples/square-ring.svg?raw";

const SAMPLES = {
  "square-ring": { name: "square-ring.svg", text: squareRingSvg },
  "letter-a-star": { name: "letter-a-star.svg", text: letterAStarSvg },
  "hex-nest": { name: "hex-nest.svg", text: hexNestSvg }
};

const CUBE_SAMPLE_ID = "cube";
const CUBE_MAX_EDGE = 4;
const CUBE_ROUND_SEGMENTS = 4;
const FLAT_NORMALIZED_SIZE = 4;
const VIEW_DISTANCE = 8.6;
const VIEW_DIR = new THREE.Vector3(3.0, 2.2, 6.0).normalize();
/** 交接给渲染页签的二维外轮廓采样密度（顶点上限与判凸见 `beam-outline.js`）。 */
const BEAM_OUTLINE_DIVISIONS = 16;

const DECIMALS = {
  depth: (v) => `${v.toFixed(0)}%`,
  bevelThickness: (v) => `${v.toFixed(1)}%`,
  bevelSize: (v) => `${v.toFixed(1)}%`,
  smoothness: (v) => v.toFixed(2)
};

export function createModelingTab({ els, onMesh, onStatus, onError }) {
  const state = {
    svgText: "",
    svgName: "",
    source: CUBE_SAMPLE_ID,
    depth: 100,
    bevelEnabled: true,
    bevelThickness: 2,
    bevelSize: 2,
    smoothness: 0.5,
    shapeCount: 0,
    vertexCount: 0,
    modelThickness: 0,
    lastError: null
  };

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

  let renderDirty = true;
  let renderCount = 0;
  let fittedDistance = 0;
  let hasGeometry = false;
  let geometryRadius = 1;
  /**
   * 交接给渲染页签的归一化二维外轮廓（世界 XY、已居中 / 缩放、Y 轴翻转、逆时针）。
   * `{ ok: true, points: Float32Array, count }` 或 `{ ok: false, reason }`。
   */
  let beamOutline = null;

  const renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x3c3f45, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3c3f45);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  camera.position.copy(VIEW_DIR).multiplyScalar(VIEW_DISTANCE);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.5;
  controls.maxDistance = 32;
  controls.target.set(0, 0, 0);
  controls.addEventListener("change", () => {
    renderDirty = true;
  });
  controls.update();

  // 中性诊断光照：半球环境 + 一盏白色方向光，只用于读出形体，不是产品灯光。
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b2d31, 1.1));
  const diagnosticLight = new THREE.DirectionalLight(0xffffff, 1.8);
  diagnosticLight.position.set(4, 6, 5);
  scene.add(diagnosticLight);
  scene.add(diagnosticLight.target);

  // 固定中性灰材质：不是用户可选材质，避免把诊断预览误当成最终渲染。
  const neutralMaterial = new THREE.MeshStandardMaterial({ color: 0x9c9c9c, roughness: 0.85, metalness: 0 });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), neutralMaterial);
  mesh.rotation.x = Math.PI; // three 的 SVG 输出 Y 向下，转过来与 SVG 观感一致
  scene.add(mesh);

  function markDirty() {
    renderDirty = true;
  }

  function renderFrame() {
    renderer.render(scene, camera);
    renderCount += 1;
    renderDirty = false;
  }

  function setError(reason) {
    state.lastError = reason;
    if (typeof onError === "function") onError(reason);
  }

  function status(text) {
    if (typeof onStatus === "function") onStatus(text);
  }

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
    const userZoom = fittedDistance > 0.01 ? THREE.MathUtils.clamp(current / fittedDistance, 0.3, 3) : 1;
    fittedDistance = next;
    setViewDistance(next * userZoom);
  }

  /* ------------------------------------------------- 解析缓存与参数映射 */

  let shapeCache = { text: "", shapes: null, maxFlatDim: 0, sampleCounts: new Map() };

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

  function samplePointsFor(cache, curveSegments) {
    if (!cache.sampleCounts.has(curveSegments)) {
      cache.sampleCounts.set(curveSegments, sampleContourPoints(cache.shapes, curveSegments));
    }
    return cache.sampleCounts.get(curveSegments);
  }

  function bevelIsActive() {
    const toRatio = (v) => Math.max(0, Number(v) || 0) / 100;
    return state.bevelEnabled && (toRatio(state.bevelSize) > 0 || toRatio(state.bevelThickness) > 0);
  }

  function computeExtrudeSettings(cache, shapeCount) {
    const toRatio = (v) => Math.max(0, Number(v) || 0) / 100;
    const flat = cache.maxFlatDim;
    const bevelActive = bevelIsActive();
    const base = buildExtrudeSettings(flat, shapeCount, {
      depth: (Number(state.depth) || 0) / 10,
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
    const limited = requestedBevelSize > bevelSizeUnits + 1e-9 || requestedBevelThickness > bevelThicknessUnits + 1e-9;
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

  function modelStatusText(plan) {
    const parts = [
      `已建模 · ${state.svgName}`,
      `厚度 ${state.depth}%`,
      state.bevelEnabled ? `倒角 ${state.bevelThickness}% / 圆角 ${state.bevelSize}%` : "倒角 关",
      `平滑度 ${state.smoothness.toFixed(2)}`
    ];
    if (plan && plan.reduced) parts.push(`已自动降低细分（曲线 ${plan.curveSegments} 段 / 倒角 ${plan.bevelSegments} 段）`);
    if (appliedSettings.bevelLimit) {
      parts.push(`倒角受厚度限制：实际 圆角 ${appliedSettings.bevelSizePercent}% / 深度 ${appliedSettings.bevelThicknessPercent}%（不超过厚度一半）`);
    }
    return parts.join(" · ");
  }

  /* ------------------------------------------- 几何来源：原生立方体 / SVG 分支 */

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

  function cubeShape() {
    const depthPercent = THREE.MathUtils.clamp(Number(state.depth) || 0, 2, 100);
    const depthUnits = (CUBE_MAX_EDGE * depthPercent) / 100;
    const minEdge = Math.min(CUBE_MAX_EDGE, depthUnits);
    const requestedRadius = state.bevelEnabled ? (Math.max(0, Number(state.bevelSize) || 0) / 100) * CUBE_MAX_EDGE : 0;
    const radius = Math.min(requestedRadius, Math.max(0, minEdge / 2 - 1e-4));
    return { depthPercent, depthUnits, radius, limited: requestedRadius > radius + 1e-9 };
  }

  function cubeStatusText() {
    const shape = cubeShape();
    const round =
      shape.radius > 1e-4 ? `圆角 ${appliedSettings.bevelSizePercent}%（${shape.radius.toFixed(3)} 单位）` : "直角（未启用圆角）";
    const limit = shape.limited ? " · 圆角受最短边限制" : "";
    return `已建模 · 立方体 4×4×${shape.depthUnits.toFixed(2)} · ${round}${limit}`;
  }

  /* ------------------------------------------- 光束用的归一化二维外轮廓 */

  /**
   * 从已解析的 Shape 生成外轮廓：把形状坐标映射到渲染页签用的世界 XY。
   *
   * 与 `buildSnapshot()` 同一条变换（`merged.translate(-center)` → `mesh.scale = baseScale`
   * → `mesh.rotation.x = π`），所以轮廓与用户实际看到的挤出网格对齐；采样自 `shape.getPoints`，
   * 因此是**外轮廓的采样近似**，不是逐三角形剪影。
   */
  function setOutlineFromShapes(shapes, center, scale) {
    if (!Array.isArray(shapes) || shapes.length !== 1) {
      beamOutline = {
        ok: false,
        reason: `当前 SVG 有 ${Array.isArray(shapes) ? shapes.length : 0} 个轮廓，色散光束第一版只支持单个闭合凸轮廓；仍保留普通玻璃、背景折射与色散。`
      };
      return;
    }
    const shape = shapes[0];
    const holes = shape && Array.isArray(shape.holes) ? shape.holes : [];
    if (holes.length > 0) {
      beamOutline = {
        ok: false,
        reason: "当前 SVG 轮廓带孔洞，色散光束第一版只支持单个闭合凸轮廓；仍保留普通玻璃、背景折射与色散。"
      };
      return;
    }
    let raw = [];
    try {
      raw = shape.getPoints(BEAM_OUTLINE_DIVISIONS).map((point) => [
        (point.x - center.x) * scale,
        -(point.y - center.y) * scale
      ]);
    } catch {
      raw = [];
    }
    beamOutline = finalizeBeamOutline(raw);
  }

  /** 内置立方体没有 SVG 轮廓，直接给一个与网格等大的正方形（圆角未参与，属可接受近似）。 */
  function setOutlineSquare(halfEdge) {
    beamOutline = finalizeBeamOutline([
      [-halfEdge, -halfEdge],
      [halfEdge, -halfEdge],
      [halfEdge, halfEdge],
      [-halfEdge, halfEdge]
    ]);
  }

  function buildSnapshot() {
    if (!hasGeometry) return null;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    if (!position) return null;
    const normalAttr = geometry.attributes.normal;
    const uvAttr = geometry.attributes.uv;
    const count = position.count;
    const scale = Math.abs(mesh.scale.x) || 1;
    const rotation = mesh.rotation.x || 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i += 1) {
      const x = position.getX(i) * scale;
      const y = position.getY(i) * scale;
      const z = position.getZ(i) * scale;
      const ry = y * cos - z * sin;
      const rz = y * sin + z * cos;
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = ry;
      positions[i * 3 + 2] = rz;
      if (x < min[0]) min[0] = x;
      if (ry < min[1]) min[1] = ry;
      if (rz < min[2]) min[2] = rz;
      if (x > max[0]) max[0] = x;
      if (ry > max[1]) max[1] = ry;
      if (rz > max[2]) max[2] = rz;
      if (normalAttr) {
        const nx = normalAttr.getX(i);
        const ny = normalAttr.getY(i);
        const nz = normalAttr.getZ(i);
        let ty = ny * cos - nz * sin;
        let tz = ny * sin + nz * cos;
        const length = Math.hypot(nx, ty, tz) || 1;
        normals[i * 3 + 0] = nx / length;
        normals[i * 3 + 1] = ty / length;
        normals[i * 3 + 2] = tz / length;
      }
      if (uvAttr) {
        uvs[i * 2 + 0] = uvAttr.getX(i);
        uvs[i * 2 + 1] = uvAttr.getY(i);
      }
    }
    let indices;
    if (geometry.index) {
      const source = geometry.index.array;
      indices = source instanceof Uint32Array ? source : new Uint32Array(source);
    } else {
      indices = new Uint32Array(count);
      for (let i = 0; i < count; i += 1) indices[i] = i;
    }
    return {
      positions,
      normals,
      uvs,
      indices,
      vertexCount: count,
      indexCount: indices.length,
      source: state.source,
      name: state.svgName,
      bounds: { min, max },
      thickness: Math.max(0.0001, max[2] - min[2]),
      // 渲染页签的色散光束需要同一份「归一化二维外轮廓」才能把白光打进当前用户模型。
      outline: beamOutline
    };
  }

  function publishMesh() {
    if (typeof onMesh !== "function") return;
    const snapshot = buildSnapshot();
    if (snapshot) onMesh(snapshot);
  }

  function rebuildCube() {
    const { depthUnits, radius, limited } = cubeShape();
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
    for (let i = 0; i < position.count; i += 1) {
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
    mesh.scale.setScalar(1);
    geometryRadius = Math.max(Math.sqrt(radiusSq), 0.05);
    setOutlineSquare(CUBE_MAX_EDGE / 2);

    state.shapeCount = 1;
    state.vertexCount = position.count;
    state.modelThickness = depthUnits;
    state.lastError = null;
    appliedSettings = {
      maxFlatDim: CUBE_MAX_EDGE,
      baseScale: 1,
      depthPercent: state.depth,
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
    publishMesh();
    markDirty();
    status(cubeStatusText());
  }

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
      status(`已拒绝当前 SVG（${guard.code}）· 画布保留上一次成功模型`);
      return;
    }
    let cache;
    try {
      cache = getShapes(state.svgText, { bevelEnabled: bevelIsActive() });
    } catch (error) {
      if (error && error.guard) {
        setError(error.guard.reason);
        status(`已拒绝当前 SVG（${error.guard.code}）· 画布保留上一次成功模型`);
      } else {
        setError(`SVG 解析失败：${error && error.message ? error.message : String(error)}`);
        status("解析失败 · 画布保留上一次成功模型");
      }
      return;
    }
    const shapeCount = cache.shapes.length;
    const { settings, meta } = computeExtrudeSettings(cache, shapeCount);
    const plan = planShapes(cache.shapes, {
      curveSegments: settings.curveSegments,
      bevelSegments: settings.bevelSegments,
      bevelEnabled: settings.bevelEnabled,
      vertexBudget: LIMITS.vertexBudget,
      samplePoints: (cs) => samplePointsFor(cache, cs)
    });
    if (!plan.ok) {
      setError(plan.reason);
      status(`已拒绝当前 SVG（${plan.code}）· 画布保留上一次成功模型`);
      return;
    }
    settings.curveSegments = plan.curveSegments;
    settings.bevelSegments = plan.bevelSegments;

    let merged = null;
    try {
      const geometries = cache.shapes.map((shape) => new THREE.ExtrudeGeometry(shape, settings));
      merged = BufferGeometryUtils.mergeGeometries(geometries, false);
      geometries.forEach((geo) => geo.dispose());
    } catch (error) {
      setError(`模型构建失败：${error && error.message ? error.message : String(error)}`);
      status("构建失败 · 画布保留上一次成功模型");
      return;
    }
    if (!merged) {
      setError("这个 SVG 生成立体模型失败：可能轮廓没有闭合，或图形无法三角化。");
      status("构建失败 · 画布保留上一次成功模型");
      return;
    }

    const smoothed = smoothCreaseNormals(merged, Math.PI / 6);
    merged.dispose();
    merged = smoothed;
    merged.computeBoundingBox();
    recomputeTriplanarUVs(merged, merged.boundingBox);

    const center = new THREE.Vector3();
    merged.boundingBox.getCenter(center);

    const actualVerts = merged.attributes.position ? merged.attributes.position.count : 0;
    if (actualVerts > LIMITS.vertexBudget) {
      merged.dispose();
      setError(
        `已拒绝导入：实际生成 ${actualVerts.toLocaleString("en-US")} 个顶点，超过上限 ` +
          `${LIMITS.vertexBudget.toLocaleString("en-US")}。请减少曲线或降低平滑度。`
      );
      status("已拒绝 · 画布保留上一次成功模型");
      return;
    }

    merged.translate(-center.x, -center.y, -center.z);
    merged.computeBoundingBox();

    let radiusSq = 0;
    const position = merged.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const d = x * x + y * y + z * z;
      if (d > radiusSq) radiusSq = d;
    }

    const baseScale = meta.maxFlatDim > 0 ? FLAT_NORMALIZED_SIZE / meta.maxFlatDim : 1;
    geometryRadius = Math.sqrt(radiusSq) * baseScale;

    const previous = mesh.geometry;
    mesh.geometry = merged;
    if (previous) previous.dispose();
    hasGeometry = true;
    mesh.scale.setScalar(baseScale);
    setOutlineFromShapes(cache.shapes, center, baseScale);

    state.shapeCount = shapeCount;
    state.vertexCount = actualVerts;
    state.lastError = null;
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
    publishMesh();
    markDirty();
    status(modelStatusText(plan));
  }

  let rebuildQueued = false;
  function requestRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
      rebuildQueued = false;
      rebuild();
    });
  }

  function enterSvgSource() {
    if (state.source === "svg") return;
    rememberGeometrySettings(state.source);
    state.source = "svg";
    restoreGeometrySettings("svg");
  }

  function setSourceCube({ resetView = false } = {}) {
    if (state.source !== CUBE_SAMPLE_ID) {
      rememberGeometrySettings(state.source);
      state.source = CUBE_SAMPLE_ID;
      restoreGeometrySettings(CUBE_SAMPLE_ID);
    }
    state.svgName = "立方体";
    if (els.name) {
      els.name.textContent = "立方体";
      els.name.title = "内置立方体（three 原生 BoxGeometry / RoundedBoxGeometry）";
    }
    rebuild();
    if (resetView) resetViewpoint();
  }

  function loadSvg(text, name, { resetView = false } = {}) {
    enterSvgSource();
    state.svgText = text;
    state.svgName = name;
    if (els.name) {
      els.name.textContent = name;
      els.name.title = name;
    }
    rebuild();
    if (resetView) resetViewpoint();
  }

  function resetViewpoint() {
    camera.position.copy(VIEW_DIR).multiplyScalar(VIEW_DISTANCE);
    controls.target.set(0, 0, 0);
    fittedDistance = 0;
    refitView();
  }

  function bindGeometrySlider(input, out, key) {
    if (!input) return;
    input.addEventListener("input", () => {
      state[key] = Number(input.value);
      if (out) out.textContent = DECIMALS[key](state[key]);
      requestRebuild();
    });
    if (out) out.textContent = DECIMALS[key](state[key]);
    input.value = String(state[key]);
  }

  function resize() {
    const width = Math.max(1, els.view.clientWidth);
    const height = Math.max(1, els.view.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (hasGeometry) refitView();
    markDirty();
    renderFrame();
  }

  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    const controlsChanged = controls.update();
    if (renderDirty || controlsChanged) renderFrame();
  }

  function init() {
    bindGeometrySlider(els.depth, els.depthOut, "depth");
    bindGeometrySlider(els.bevelThickness, els.bevelThicknessOut, "bevelThickness");
    bindGeometrySlider(els.bevelSize, els.bevelSizeOut, "bevelSize");
    bindGeometrySlider(els.smoothness, els.smoothnessOut, "smoothness");

    if (els.bevelEnabled) {
      els.bevelEnabled.addEventListener("change", () => {
        state.bevelEnabled = els.bevelEnabled.checked;
        requestRebuild();
      });
    }
    if (els.sample) {
      els.sample.addEventListener("change", () => {
        if (els.sample.value === CUBE_SAMPLE_ID) {
          setSourceCube({ resetView: true });
          return;
        }
        const sample = SAMPLES[els.sample.value];
        if (sample) loadSvg(sample.text, sample.name, { resetView: true });
      });
    }
    if (els.file) {
      els.file.addEventListener("change", async () => {
        const file = els.file.files && els.file.files[0];
        if (!file) return;
        if (file.size > LIMITS.maxBytes) {
          setError(
            `已拒绝导入：文件过大（${formatBytes(file.size)}，上限 ${formatBytes(LIMITS.maxBytes)}）。` +
              "请先在设计软件里合并图层、简化节点后再导出。"
          );
          status("已拒绝 · 画布保留上一次成功模型");
          els.file.value = "";
          return;
        }
        const text = await file.text();
        loadSvg(text, file.name);
        els.file.value = "";
      });
    }
    if (els.resetView) {
      els.resetView.addEventListener("click", () => {
        resetViewpoint();
        status("视角已重置");
      });
    }

    new ResizeObserver(() => resize()).observe(els.view);
    resize();
    if (els.sample && els.sample.value === CUBE_SAMPLE_ID) {
      setSourceCube();
    } else {
      const first = (els.sample && SAMPLES[els.sample.value]) || SAMPLES["square-ring"];
      loadSvg(first.text, first.name);
    }
    tick();
  }

  init();

  return {
    state,
    resetView() {
      resetViewpoint();
    },
    notifyVisible() {
      // 页签切回来时补一帧，避免隐藏期间布局变化留下空白。
      resize();
    },
    getInfo() {
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
        source: state.source,
        shapeCount: state.shapeCount,
        vertexCount: state.vertexCount,
        size,
        normalizedSize: {
          size: appliedSettings.baseScale ? size.map((v) => +(v * appliedSettings.baseScale).toFixed(4)) : size,
          baseScale: appliedSettings.baseScale
        },
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
          actualVerts: appliedSettings.actualVerts
        },
        materialType: mesh.material.type,
        materialColor: `#${mesh.material.color.getHexString()}`,
        cameraDistance: +camera.position.distanceTo(controls.target).toFixed(3),
        renders: renderCount,
        lastError: state.lastError,
        canvas: [els.canvas.width, els.canvas.height]
      };
    },
    getState() {
      return { ...state };
    },
    getMeshSummary() {
      const snapshot = buildSnapshot();
      if (!snapshot) return null;
      return {
        vertexCount: snapshot.vertexCount,
        indexCount: snapshot.indexCount,
        source: snapshot.source,
        name: snapshot.name,
        bounds: snapshot.bounds,
        thickness: snapshot.thickness
      };
    },
    getMeshSnapshot() {
      return buildSnapshot();
    },
    scene,
    camera,
    renderer,
    mesh
  };
}
