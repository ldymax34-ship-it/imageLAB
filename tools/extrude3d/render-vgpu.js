/**
 * SVG 转 3D · 渲染页签（vgpu / WebGPU）
 *
 * 职责：接收建模页签交接的同一份 position / normal / uv / index 网格，负责材质、灯光、
 * 背景、镜头与 PNG 当前帧导出。Three.js 不参与这里的最终渲染。
 *
 * 官方来源（固定 vgpu 0.6.0，MIT）：
 *   - 公共 API：`init` / `surface` / `target` / `draw` / `effect` / `frame` / `sampler` / `texture` / `geometry`
 *   - PBR：改写自 `apps/docs/examples/glass-fractal/hero-fractal-ceramic.wgsl`
 *   - 透射：改写自 `apps/docs/examples/transmission/glass.wgsl`（官方 Double refraction），
 *     把写死立方体的 `trace_cube_exit` 换成「背面世界坐标 + 世界法线预通道 + 正面片元」：
 *     空气→玻璃、玻璃→空气各折一次，支持任意闭合挤出网格。
 *   - 光束：`prism/` 来自 `apps/docs/app/[lang]/(home)/components/prism-background/`，
 *     三角形求交泛化为**当前 SVG 外轮廓的凸多边形**（见 `prism/beam.js`）。
 * 详见 THIRD_PARTY.md 与 third-party-licenses/vgpu-LICENSE.txt。
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { init, surface, target, draw, effect, frame, sampler, texture, geometry } from "vgpu";

import pbrWgsl from "./shaders/pbr.wgsl";
import glassWgsl from "./shaders/glass.wgsl";
import glassBackWgsl from "./shaders/glass-back.wgsl";
import glassBackInfoWgsl from "./shaders/glass-back-info.wgsl";
import backgroundWgsl from "./shaders/background.wgsl";
import presentWgsl from "./shaders/present.wgsl";
import { createBeamPass } from "./prism/beam.js";
import { PRISM_POSTPROCESS } from "./prism/types.js";

/** 渲染页签首批 7 个常用中文材质预设（不恢复 38 个预设，不做节点编辑器）。 */
export const MATERIAL_PRESETS = [
  { id: "glass", label: "透明玻璃", kind: "glass", color: "#ffffff", roughness: 0.03, metallic: 0, ior: 1.5, optical: 1, dispersion: 0.09, absorption: [0.08, 0.03, 0.05], env: 1.0 },
  { id: "frosted-glass", label: "磨砂玻璃", kind: "glass", color: "#f2f5f8", roughness: 0.5, metallic: 0, ior: 1.5, optical: 1, dispersion: 0, absorption: [0.1, 0.095, 0.1], env: 1.0 },
  { id: "acrylic", label: "彩色亚克力", kind: "glass", color: "#ff6a3d", roughness: 0.12, metallic: 0, ior: 1.49, optical: 1, dispersion: 0.06, absorption: [0.85, 0.32, 0.22], env: 1.0 },
  { id: "plastic", label: "塑料", kind: "opaque", color: "#e7e0d5", roughness: 0.42, metallic: 0, env: 0.9 },
  { id: "ceramic", label: "陶瓷", kind: "opaque", color: "#f3f0ea", roughness: 0.2, metallic: 0, env: 1.1 },
  { id: "metal", label: "金属", kind: "opaque", color: "#b7bac0", roughness: 0.3, metallic: 1, env: 1.2 },
  { id: "chrome", label: "镀铬", kind: "opaque", color: "#f5f7fa", roughness: 0.05, metallic: 1, env: 1.35 }
];

/** 纯色背景的黑 / 白快速预设：中文名称直接写「黑色」「白色」，默认白色。 */
export const BACKGROUND_PRESETS = [
  { id: "black", label: "黑色", color: "#000000" },
  { id: "white", label: "白色", color: "#ffffff" }
];

const PRESET_BY_ID = new Map(MATERIAL_PRESETS.map((p) => [p.id, p]));
const IMAGE_LIMITS = { maxBytes: 10 * 1024 * 1024, maxSide: 4096, mimeTypes: ["image/png", "image/jpeg", "image/webp"] };
const VIEW_DISTANCE = 8.6;
const VIEW_DIR = new THREE.Vector3(3.0, 2.2, 6.0).normalize();
/** 「色散范围」滑杆 100% 对应的官方 `dispersion_spread`（vgpu transmission 示例同值）。 */
const DISPERSION_UNIT = 0.09;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * 颜色选择器 / CSS 十六进制值是 sRGB 编码；vgpu 管线按线性光运算、由 present 统一做
 * ACES + sRGB 输出。three 0.186.1 的 ColorManagement 工作色彩空间是 Linear-sRGB，
 * `Color.setStyle(hex, SRGBColorSpace)` 会按 sRGB 传输函数显式转成线性（等价于 three 内部
 * 的 SRGBToLinear：c ≤ 0.04045 时 c/12.92，否则 ((c+0.055)/1.055)^2.4，与 common.wgsl 的
 * `srgb_to_linear` 同一条公式）。**不能**再叠一次 `convertSRGBToLinear()`，那会把中间灰压到近黑。
 */
function srgbToLinear(hex) {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace).toArray();
}

export function createRenderTab({ canvas, els, onStatus }) {
  const state = {
    preset: "glass",
    color: "#ffffff",
    roughness: 0.03,
    metallic: 0,
    ior: 1.5,
    optical: 1,
    // 面向设计师的三个玻璃参数：色散范围 / 色彩强度 / 折射变形（都用 0–200% 表达，
    // 内部再映射到真实 WebGPU 取值；不把 WGSL 原始数值暴露给用户）。
    dispersionRange: 100,
    chroma: 100,
    refraction: 100,
    // 「色散光束」：白光穿过当前 SVG 挤出模型（位置 / 方向 / 强度三个基础参数）。
    // 默认 30° 斜入射：正对平面入射时各波长折射角相同（物理上就不会有色散）。
    beam: false,
    beamAngle: 30,
    beamPosition: 0,
    beamIntensity: 1,
    lightIntensity: 1.2,
    lightAngle: 40,
    envIntensity: 1,
    exposure: 1,
    bgColor: "#ffffff",
    bgPreset: "white",
    bgMode: "pure",
    bgName: "",
    bgZoom: 1,
    bgPanX: 0,
    bgPanY: 0,
    transparent: false,
    exportScale: 2,
    renders: 0
  };

  let gpu = null;
  let ready = false;
  let failed = null;
  let active = false;
  let disposed = false;
  let raf = 0;
  let dirty = true;
  let canvasSurface = null;
  let sceneTarget = null;
  let backgroundTarget = null;
  let backTarget = null;
  let exportTarget = null;
  let backgroundEffect = null;
  let presentEffect = null;
  let pbrDraw = null;
  let glassDraw = null;
  let glassBackDraw = null;
  let glassBackInfoDraw = null;
  let meshGeometry = null;
  let pendingMesh = null;
  let meshSummary = null;
  let bgImage = null;
  let bgTextureGpu = null;
  let fallbackTexture = null;
  let blackTexture = null;
  let pendingBackgroundFile = null;
  let bgSampler = null;
  let nearestSampler = null;
  let targetSize = [1, 1];
  let exports = 0;
  let beam = null;
  let beamDirty = true;
  /** 画布尺寸变化待处理（在下一帧开头、绘制之前统一 resize 目标）。 */
  let pendingSurfaceResize = false;
  /** 导出进行中：预览帧会占用 / 打断导出尺寸下的目标，必须冻结。 */
  let exporting = false;
  /** 建模页签交接的归一化二维外轮廓（色散光束的折射体截面）。 */
  let outline = null;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  camera.position.copy(VIEW_DIR).multiplyScalar(VIEW_DISTANCE);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.5;
  controls.maxDistance = 32;
  controls.target.set(0, 0, 0);
  controls.addEventListener("change", () => {
    dirty = true;
  });
  controls.update();

  const viewProjection = new Float32Array(16);

  function preset() {
    return PRESET_BY_ID.get(state.preset) || MATERIAL_PRESETS[0];
  }

  function status(text) {
    if (typeof onStatus === "function") onStatus(text);
  }

  function showUnavailable(detail) {
    failed = detail;
    if (els.hint) {
      els.hint.hidden = false;
      els.hint.textContent = detail;
    }
    status(detail);
  }

  /* ------------------------------------------------------------ 背景图片 */

  function backgroundRepeat() {
    const [w, h] = targetSize;
    const viewAspect = w / Math.max(1, h);
    const imageAspect = bgImage ? bgImage.width / Math.max(1, bgImage.height) : 1;
    const zoom = clamp(Number(state.bgZoom) || 1, 1, 3);
    return [Math.min(1, viewAspect / imageAspect) / zoom, Math.min(1, imageAspect / viewAspect) / zoom];
  }

  function backgroundOffset() {
    const [repeatX, repeatY] = backgroundRepeat();
    const roomX = Math.max(0, 1 - repeatX);
    const roomY = Math.max(0, 1 - repeatY);
    const panToOffset = (pan, room) => clamp(room * (0.5 + clamp(pan, -100, 100) / 200), 0, room);
    return [panToOffset(state.bgPanX, roomX), panToOffset(state.bgPanY, roomY)];
  }

  function updatePanControls() {
    const [repeatX, repeatY] = backgroundRepeat();
    const hasImage = !!bgImage;
    const entries = [
      [els.bgPanX, els.bgPanXOut, state.bgPanX, 1 - repeatX],
      [els.bgPanY, els.bgPanYOut, state.bgPanY, 1 - repeatY]
    ];
    for (const [input, out, value, room] of entries) {
      if (input) input.disabled = !hasImage || room <= 1e-4;
      if (out) out.textContent = `${Number(value).toFixed(0)}%`;
    }
    if (els.bgPanNote) {
      if (!hasImage) els.bgPanNote.textContent = "上传背景图片后可移动裁切位置。";
      else if (1 - repeatX <= 1e-4 || 1 - repeatY <= 1e-4) els.bgPanNote.textContent = "放大背景后可移动裁切位置（当前有一个方向没有裁切余量）。";
      else els.bgPanNote.textContent = "在图片范围内移动裁切位置，不会拉伸、平铺或露出空白边。";
    }
  }

  function bindBackground(textureGpu, image) {
    bgImage = image;
    bgTextureGpu = textureGpu;
    dirty = true;
    updatePanControls();
  }

  /** 纯色快速预设的选中态：图片模式或自定义颜色时两个预设都不选中。 */
  function syncBackgroundPreset() {
    const entries = [
      [els.bgBlack, "black"],
      [els.bgWhite, "white"]
    ];
    for (const [button, id] of entries) {
      if (button) button.setAttribute("aria-pressed", String(state.bgPreset === id));
    }
  }

  /** 应用黑 / 白快速预设：切回纯色模式并同步颜色输入，不扩展更多预设。 */
  function applyBackgroundPreset(id) {
    const item = BACKGROUND_PRESETS.find((entry) => entry.id === id);
    if (!item) return;
    state.bgColor = item.color;
    state.bgPreset = item.id;
    state.bgMode = "pure";
    if (els.bg) els.bg.value = item.color;
    if (els.bgMode) els.bgMode.value = "pure";
    dirty = true;
    syncBackgroundPreset();
    status(`背景色已切换为${item.label}（纯色）。`);
  }

  async function loadBackgroundFile(file) {
    if (!file) return;
    if (!IMAGE_LIMITS.mimeTypes.includes(file.type)) {
      status(`已拒绝背景图片：仅支持 PNG / JPEG / WebP，当前类型「${file.type || "未知"}」。`);
      return;
    }
    if (file.size > IMAGE_LIMITS.maxBytes) {
      status(`已拒绝背景图片：文件过大（${formatBytes(file.size)}，上限 ${formatBytes(IMAGE_LIMITS.maxBytes)}）。`);
      return;
    }
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      status("已拒绝背景图片：文件无法解码，请换一张有效的 PNG / JPEG / WebP。");
      return;
    }
    if (bitmap.width > IMAGE_LIMITS.maxSide || bitmap.height > IMAGE_LIMITS.maxSide) {
      bitmap.close();
      status(`已拒绝背景图片：单边 ${bitmap.width}×${bitmap.height} 超过上限 ${IMAGE_LIMITS.maxSide} 像素。`);
      return;
    }
    if (!gpu) {
      bitmap.close();
      pendingBackgroundFile = file;
      status("背景图片已选择，等待 WebGPU 就绪后自动载入。");
      return;
    }
    const next = texture(gpu, {
      kind: "2d",
      size: [bitmap.width, bitmap.height],
      format: "rgba8unorm",
      usage: ["texture_binding", "copy_dst", "render_attachment"]
    });
    gpu.gpu.queue.copyExternalImageToTexture({ source: bitmap }, { texture: next.gpu }, [bitmap.width, bitmap.height]);
    const previous = bgTextureGpu;
    bindBackground(next, bitmap);
    if (previous && previous !== fallbackTexture) {
      try {
        previous.destroy();
      } catch {
        /* 旧贴图释放失败不影响新背景 */
      }
    }
    state.bgName = file.name;
    state.bgMode = "image";
    state.bgPreset = null;
    if (els.bgName) els.bgName.textContent = file.name;
    if (els.bgMode) els.bgMode.value = "image";
    syncBackgroundPreset();
    status(`背景图片已载入：${file.name}（${bitmap.width}×${bitmap.height}）`);
  }

  function removeBackground() {
    if (bgTextureGpu && bgTextureGpu !== fallbackTexture) {
      try {
        bgTextureGpu.destroy();
      } catch {
        /* 释放失败不阻塞状态更新 */
      }
    }
    bgTextureGpu = fallbackTexture;
    bgImage = null;
    state.bgName = "";
    if (els.bgName) els.bgName.textContent = "未使用背景图片";
    if (state.bgMode === "image") state.bgMode = "pure";
    // 移除图片后回到纯色：默认与初始值一致（白色），并同步预设选中态。
    state.bgPreset = "white";
    state.bgColor = "#ffffff";
    if (els.bg) els.bg.value = "#ffffff";
    if (els.bgMode) els.bgMode.value = state.bgMode;
    syncBackgroundPreset();
    state.bgZoom = 1;
    state.bgPanX = 0;
    state.bgPanY = 0;
    if (els.bgZoom) els.bgZoom.value = "1";
    if (els.bgPanX) els.bgPanX.value = "0";
    if (els.bgPanY) els.bgPanY.value = "0";
    dirty = true;
    updatePanControls();
    status("已移除背景图片，回到纯色背景。");
  }

  /* ------------------------------------------------------------ 网格交接 */

  function interleave(snapshot) {
    const count = snapshot.vertexCount;
    const out = new Float32Array(count * 8);
    const positions = snapshot.positions;
    const normals = snapshot.normals;
    const uvs = snapshot.uvs;
    for (let i = 0; i < count; i += 1) {
      const dst = i * 8;
      out[dst + 0] = positions[i * 3 + 0];
      out[dst + 1] = positions[i * 3 + 1];
      out[dst + 2] = positions[i * 3 + 2];
      out[dst + 3] = normals[i * 3 + 0];
      out[dst + 4] = normals[i * 3 + 1];
      out[dst + 5] = normals[i * 3 + 2];
      out[dst + 6] = uvs[i * 2 + 0];
      out[dst + 7] = uvs[i * 2 + 1];
    }
    return out;
  }

  function rebuildModelDraws() {
    if (pbrDraw) pbrDraw.dispose();
    if (glassDraw) glassDraw.dispose();
    if (glassBackDraw) glassBackDraw.dispose();
    if (glassBackInfoDraw) glassBackInfoDraw.dispose();
    pbrDraw = null;
    glassDraw = null;
    glassBackDraw = null;
    glassBackInfoDraw = null;
    if (!meshGeometry) return;
    pbrDraw = draw(gpu, { shader: pbrWgsl, geometry: meshGeometry, cull: "back" });
    glassBackDraw = draw(gpu, { shader: glassBackWgsl, geometry: meshGeometry, cull: "front" });
    // backTarget 的第二张颜色附件存背面世界法线，专供正面通道做第二次折射；
    // sceneTarget 的可见背面仍用原单输出着色通道，行为不变。
    glassBackInfoDraw = draw(gpu, { shader: glassBackInfoWgsl, geometry: meshGeometry, cull: "front", colors: [null, null] });
    glassDraw = draw(gpu, { shader: glassWgsl, geometry: meshGeometry, cull: "back" });
  }

  function summarizeMesh(snapshot) {
    return {
      vertexCount: snapshot.vertexCount,
      indexCount: snapshot.indexCount,
      source: snapshot.source,
      name: snapshot.name,
      bounds: snapshot.bounds,
      thickness: snapshot.thickness
    };
  }

  function uploadMesh(snapshot) {
    pendingMesh = snapshot;
    if (!snapshot || !snapshot.vertexCount) return;
    // 建模→渲染状态同步先于 GPU：即使 WebGPU 尚未初始化或初始化失败，
    // 也保存最近一次合法网格摘要，便于验证真实建模结果已交接。
    // 实际 GPU 上传（geometry / draw）仍只在设备可用时进行。
    meshSummary = summarizeMesh(snapshot);
    outline = snapshot.outline || null;
    beamDirty = true;
    dirty = true;
    if (els.beamNote) els.beamNote.textContent = beamNote();
    if (!gpu) return;
    if (meshGeometry) {
      meshGeometry.destroy();
      meshGeometry = null;
    }
    const interleaved = interleave(snapshot);
    meshGeometry = geometry(gpu, {
      label: "extrude3d-handoff-mesh",
      buffers: [
        {
          data: interleaved,
          stride: 32,
          attributes: {
            position: { format: "float32x3", offset: 0 },
            normal: { format: "float32x3", offset: 12, location: 1 },
            uv: { format: "float32x2", offset: 24, location: 2 }
          }
        }
      ],
      // vgpu 由 Uint32Array 推断 indexFormat，传入 indices 时不能再显式给 indexFormat。
      indices: snapshot.indices
    });
    rebuildModelDraws();
  }

  /* ------------------------------------------------------------ GPU 初始化 */

  function resizeTargets(size) {
    if (!sceneTarget) return;
    const next = [Math.max(1, Math.floor(size[0])), Math.max(1, Math.floor(size[1]))];
    targetSize = next;
    sceneTarget.resize(next);
    backgroundTarget.resize(next);
    backTarget.resize(next);
    exportTarget.resize(next);
    beam?.resize(next);
    updatePanControls();
  }

  function geometryReady() {
    return !!meshGeometry && !!pbrDraw && !!glassDraw && !!glassBackDraw && !!glassBackInfoDraw;
  }

  /**
   * 色散光束可用性：需要玻璃材质 + 建模页签交接的单个闭合凸轮廓 + GPU 就绪。
   * 不满足时只关闭可见光束，玻璃的折射 / 色散 / 背景全部保留，原因写在 `beamNote()`。
   */
  function beamActive() {
    return !!(
      beam &&
      ready &&
      state.beam &&
      preset().kind === "glass" &&
      outline &&
      outline.ok
    );
  }

  function beamNote() {
    if (!outline) return "色散光束需要建模页签的二维外轮廓：先在建模页签导入或选择一个 SVG。";
    if (!outline.ok) return outline.reason;
    if (preset().kind !== "glass") return "色散光束只在玻璃材质下可用：当前是非透射材质，白光不会进入模型。";
    if (!state.beam) {
      return `已就绪：勾选后白光会穿过当前 SVG 轮廓（${outline.count} 个顶点的凸多边形），显示内部折射与出射色散。`;
    }
    return `光束正在穿过当前 SVG 轮廓（${outline.count} 个顶点）：入 / 出射界面各折射一次，出射端按 D65 光谱散开。`;
  }

  function keyLightDirection() {
    const azimuth = THREE.MathUtils.degToRad(state.lightAngle);
    const elevation = THREE.MathUtils.degToRad(42);
    return [Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth)];
  }

  function updateCameraUniforms(width, height) {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    viewProjection.set(matrix.elements);
  }

  function renderFrame(targetToPresent) {
    if (!ready || !canvasSurface) return;
    const [width, height] = targetSize;
    updateCameraUniforms(width, height);
    const current = preset();
    const keyDirection = keyLightDirection();
    const cameraPosition = [camera.position.x, camera.position.y, camera.position.z];
    const beamOn = beamActive();

    if (beamOn) {
      beam.setViewProjection(viewProjection);
      if (beamDirty) {
        // 求交只在外轮廓或光束参数变化时重算，不进入每帧循环。
        beam.update({
          polygon: outline.points,
          angle: state.beamAngle,
          position: state.beamPosition,
          dispersion: state.dispersionRange,
          intensity: state.beamIntensity
        });
        beamDirty = false;
      }
    }

    const [repeatX, repeatY] = backgroundRepeat();
    const [offsetX, offsetY] = backgroundOffset();
    const modeValue = state.bgMode === "studio" ? 1 : state.bgMode === "image" && bgImage ? 2 : 0;
    if (backgroundEffect) {
      backgroundEffect.set({
        background: {
          mode: modeValue,
          transparent: state.transparent ? 1 : 0,
          color: srgbToLinear(state.bgColor),
          repeat: [repeatX, repeatY],
          offset: [offsetX, offsetY]
        },
        bg_tex: bgTextureGpu || fallbackTexture,
        bg_samp: bgSampler
      });
    }
    if (presentEffect) {
      // present 把「模型（sceneTarget）合成到背景（backgroundTarget）之上」：
      // background 是不带深度的全屏 effect，绝不写 sceneTarget 的深度，模型自遮挡才成立。
      // 光束（含上游 bloom）在这里加法合成：关闭时绑定黑色 1×1 贴图与 0 强度，画面与旧版一致。
      presentEffect.set({
        present: {
          exposure: state.exposure,
          bloom_strength: beamOn ? PRISM_POSTPROCESS.bloomStrength : 0
        },
        color_tex: sceneTarget,
        color_samp: bgSampler,
        bg_tex: backgroundTarget,
        bg_samp: bgSampler,
        beam_tex: beamOn ? beam.beamTarget : blackTexture,
        bloom_tex: beamOn ? beam.bloomTarget : blackTexture
      });
    }

    const modelReady = geometryReady();
    if (modelReady && current.kind === "glass") {
      const baseColor = srgbToLinear(state.color);
      const keyColor = [1.0, 0.97, 0.93];
      const absorption = current.absorption || [0.05, 0.05, 0.05];
      glassBackInfoDraw.set({
        camera: { view_projection: viewProjection, camera_position: cameraPosition }
      });
      // 背面通道与正面通道共用相机 / 玻璃参数：背面同一趟写进 sceneTarget，
      // 先在最终画面里形成可见的后表面 / 内部界面（正面玻璃随后以 Fresnel 权重叠上去）。
      glassBackDraw.set({
        camera: { view_projection: viewProjection, camera_position: cameraPosition },
        glass: {
          base_color: baseColor,
          ior: state.ior,
          absorption,
          env_intensity: state.envIntensity,
          key_intensity: state.lightIntensity,
          key_direction: keyDirection,
          key_color: keyColor,
          transparent: state.transparent ? 1 : 0
        }
      });
      glassDraw.set({
        camera: { view_projection: viewProjection, camera_position: cameraPosition, resolution: [width, height] },
        glass: {
          base_color: baseColor,
          ior: state.ior,
          roughness: state.roughness,
          thickness_scale: state.optical,
          dispersion: (state.dispersionRange / 100) * DISPERSION_UNIT,
          chroma: state.chroma / 100,
          refraction: state.refraction / 100,
          fallback_thickness: Math.max((meshSummary && meshSummary.thickness) || 1, 0.05),
          absorption,
          env_intensity: state.envIntensity,
          key_intensity: state.lightIntensity,
          key_direction: keyDirection,
          key_color: keyColor
        },
        scene_tex: backgroundTarget,
        scene_samp: bgSampler,
        back_tex: backTarget,
        back_samp: nearestSampler,
        back_normal_tex: backTarget.colors[1],
        back_normal_samp: nearestSampler
      });
    } else if (modelReady) {
      pbrDraw.set({
        camera: { view_projection: viewProjection, camera_position: cameraPosition },
        material: {
          base_color: srgbToLinear(state.color),
          metallic: state.metallic,
          roughness: state.roughness,
          key_intensity: state.lightIntensity,
          env_intensity: state.envIntensity,
          key_direction: keyDirection,
          key_color: [1.0, 0.97, 0.93]
        }
      });
    }

    frame(gpu, (currentFrame) => {
      // 1) 背景只写不带深度的 backgroundTarget；它同时是玻璃的折射环境。
      currentFrame.pass({ target: backgroundTarget, clear: [0, 0, 0, 0] }, (pass) => pass.draw(backgroundEffect));
      // 1b) 色散光束写进自己的 HDR 目标（含上游三级 bloom），由 present 加法合成。
      if (beamOn) beam.render(currentFrame);
      // 2) 玻璃的背面通道（独立深度）：既产出 backTarget 的世界坐标供正面估厚度，
      //    又把背面片元写进 sceneTarget，成为最终成像里可见的后表面 / 内部界面。
      if (modelReady && current.kind === "glass") {
        currentFrame.pass({ target: backTarget, clear: [0, 0, 0, 0], clearDepth: 1 }, (pass) =>
          pass.draw(glassBackInfoDraw)
        );
      }
      // 3) 模型写入带深度的 sceneTarget：背景不参与这一趟，深度只由模型自己决定。
      //    玻璃先画背面（较远），再画正面（较近，透过深度测试），前后两个界面都能辨认。
      currentFrame.pass({ target: sceneTarget, clear: [0, 0, 0, 0], clearDepth: 1 }, (pass) => {
        if (!modelReady) return;
        if (current.kind === "glass") {
          pass.draw(glassBackDraw);
          pass.draw(glassDraw);
        } else {
          pass.draw(pbrDraw);
        }
      });
      // 4) present 把模型合成到背景之上，再曝光 / 色调映射 / sRGB 输出。
      currentFrame.pass(targetToPresent, presentEffect);
    });
    state.renders += 1;
  }

  async function ensureGpu() {
    if (ready || failed || gpu) return;
    if (!navigator.gpu) {
      showUnavailable("当前浏览器不支持 WebGPU：渲染页签需要支持 WebGPU 的浏览器（如较新的 Chrome / Edge），并在 http://127.0.0.1 或 HTTPS 安全上下文下打开。建模页签仍可正常使用。");
      return;
    }
    let context = null;
    try {
      context = await init();
    } catch (error) {
      showUnavailable(`WebGPU 初始化失败：${error && error.message ? error.message : String(error)}。建模页签仍可正常使用。`);
      return;
    }
    if (disposed) {
      context.dispose();
      return;
    }
    gpu = context;
    try {
      canvasSurface = surface(gpu, canvas, { dpr: [1, 2], alphaMode: "premultiplied" });
      bgSampler = sampler(gpu, { minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
      nearestSampler = sampler(gpu, { minFilter: "nearest", magFilter: "nearest" });
      fallbackTexture = texture(gpu, { kind: "2d", size: [1, 1], format: "rgba8unorm", usage: ["texture_binding", "copy_dst", "render_attachment"] });
      gpu.gpu.queue.writeTexture({ texture: fallbackTexture.gpu }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
      // 光束关闭时 present 绑定这张黑色 1×1 贴图：加法项恒为 0，画面与未接入光束时完全一致。
      blackTexture = texture(gpu, { kind: "2d", size: [1, 1], format: "rgba8unorm", usage: ["texture_binding", "copy_dst", "render_attachment"] });
      gpu.gpu.queue.writeTexture({ texture: blackTexture.gpu }, new Uint8Array([0, 0, 0, 0]), { bytesPerRow: 4 }, [1, 1]);
      bgTextureGpu = fallbackTexture;

      const size = canvasSurface.size;
      targetSize = [Math.max(1, size[0]), Math.max(1, size[1])];
      sceneTarget = target(gpu, { size: targetSize, format: "rgba16float", depth: true });
      backgroundTarget = target(gpu, { size: targetSize, format: "rgba16float" });
      backTarget = target(gpu, { size: targetSize, format: "rgba16float", depth: true, colors: [{ format: "rgba16float" }, { format: "rgba16float" }] });
      exportTarget = target(gpu, { size: targetSize, format: "rgba8unorm" });

      // background.wgsl 只有 fs_main：必须用 effect()，由 vgpu 注入官方内置全屏顶点通道
      // （vs_main 由库生成，不自写顶点 shader）。effect 只写颜色，不写场景深度。
      backgroundEffect = effect(gpu, backgroundWgsl, {
        label: "extrude3d-background",
        set: { bg_tex: fallbackTexture, bg_samp: bgSampler }
      });
      presentEffect = effect(gpu, presentWgsl, {
        label: "extrude3d-present",
        set: {
          color_tex: sceneTarget,
          color_samp: bgSampler,
          bg_tex: backgroundTarget,
          bg_samp: bgSampler,
          beam_tex: blackTexture,
          bloom_tex: blackTexture
        }
      });
      // 色散光束通道：上游 prism-background 的确定性光束 + 三级 bloom，作用在当前 SVG 轮廓上。
      beam = createBeamPass(gpu, "extrude3d-beam", targetSize);

      // vgpu 会在帧内同步通知画布尺寸变化（onResize）；若在帧中途 resize 目标，
      // 本帧已绑定的目标贴图会被销毁 → 下一趟 draw 报「destroyed resource」。
      // 因此只记录待处理标记，真正的 resize 放到下一帧开头、任何绘制之前执行。
      canvasSurface.onResize(() => {
        pendingSurfaceResize = true;
        dirty = true;
      });

      if (pendingMesh) uploadMesh(pendingMesh);
      // 预编译管线：着色器 / 绑定错误在这里就变成明确中文提示，而不是首帧崩溃。
      await Promise.all([
        backgroundEffect.compile(backgroundTarget),
        presentEffect.compile(canvasSurface),
        beam.compile(),
        ...(geometryReady()
          ? [pbrDraw.compile(sceneTarget), glassDraw.compile(sceneTarget), glassBackDraw.compile(sceneTarget), glassBackInfoDraw.compile(backTarget)]
          : [])
      ]);
      ready = true;
      dirty = true;
      status("渲染页签已就绪（WebGPU）。拖拽旋转 · 滚轮缩放 · 右键平移。");
      if (pendingBackgroundFile) {
        const file = pendingBackgroundFile;
        pendingBackgroundFile = null;
        void loadBackgroundFile(file);
      }
    } catch (error) {
      showUnavailable(`WebGPU 渲染管线创建失败：${error && error.message ? error.message : String(error)}。建模页签仍可正常使用。`);
    }
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (disposed || !active || !ready || document.hidden) return;
    // 导出期间冻结预览：此时所有目标是导出尺寸，预览帧与画布 resize 都会打断 / 破坏导出。
    if (exporting) return;
    if (pendingSurfaceResize) {
      pendingSurfaceResize = false;
      if (sceneTarget) resizeTargets(canvasSurface.size);
    }
    const controlsChanged = controls.update();
    if (dirty || controlsChanged) {
      try {
        renderFrame(canvasSurface);
        dirty = false;
      } catch (error) {
        showUnavailable(`渲染失败：${error && error.message ? error.message : String(error)}。建模页签仍可正常使用。`);
        ready = false;
      }
    }
  }

  /* ------------------------------------------------------------ 导出 */

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  async function exportPng() {
    if (!ready || !canvasSurface) {
      status("导出失败：WebGPU 尚未就绪。");
      return;
    }
    if (els.exportPng) els.exportPng.disabled = true;
    exporting = true;
    try {
      const scale = Math.max(1, Number(state.exportScale) || 1);
      const [viewWidth, viewHeight] = canvasSurface.size;
      const width = Math.max(1, Math.round(viewWidth * scale));
      const height = Math.max(1, Math.round(viewHeight * scale));
      resizeTargets([width, height]);
      await renderFrame(exportTarget);
      const pixels = await exportTarget.color.read({ mipLevel: 0, region: "all" });
      // 反预乘：present 输出 premultiplied，PNG 用直通 alpha。
      const straight = new Uint8ClampedArray(pixels.length);
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3];
        if (alpha > 0 && alpha < 255) {
          const inv = 255 / alpha;
          straight[i] = pixels[i] * inv;
          straight[i + 1] = pixels[i + 1] * inv;
          straight[i + 2] = pixels[i + 2] * inv;
          straight[i + 3] = alpha;
        } else {
          straight[i] = pixels[i];
          straight[i + 1] = pixels[i + 1];
          straight[i + 2] = pixels[i + 2];
          straight[i + 3] = alpha;
        }
      }
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      const ctx = scratch.getContext("2d");
      const image = ctx.createImageData(width, height);
      image.data.set(straight);
      ctx.putImageData(image, 0, 0);
      const blob = await new Promise((resolve) => scratch.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG 编码失败");
      const filename = `svg3d-${state.preset}-${timestamp()}.png`;
      download(blob, filename);
      exports += 1;
      status(`已导出 ${width}×${height} PNG${state.transparent ? "（透明背景）" : ""} · ${filename}`);
    } catch (error) {
      status(`导出失败：${error && error.message ? error.message : String(error)}`);
    } finally {
      const [viewWidth, viewHeight] = canvasSurface.size;
      resizeTargets([viewWidth, viewHeight]);
      exporting = false;
      dirty = true;
      if (els.exportPng) els.exportPng.disabled = false;
    }
  }

  /* ------------------------------------------------------------ 事件与生命周期 */

  function syncPresetControls() {
    const current = preset();
    if (els.material) els.material.value = current.id;
    state.color = current.color;
    state.roughness = current.roughness;
    state.metallic = current.metallic;
    if (els.color) els.color.value = current.color;
    if (els.roughness) els.roughness.value = String(current.roughness);
    if (els.roughnessOut) els.roughnessOut.textContent = current.roughness.toFixed(2);
    if (els.metallic) els.metallic.value = String(current.metallic);
    if (els.metallicOut) els.metallicOut.textContent = current.metallic.toFixed(2);
    state.ior = current.ior ?? 1.5;
    state.optical = current.optical ?? 1;
    // 预设里的 dispersion 是 WGSL 取值；界面只显示 0–200% 的「色散范围」。
    state.dispersionRange = Math.round(((current.dispersion ?? 0) / DISPERSION_UNIT) * 100);
    if (els.ior) els.ior.value = String(state.ior);
    if (els.iorOut) els.iorOut.textContent = state.ior.toFixed(2);
    if (els.optical) els.optical.value = String(state.optical);
    if (els.opticalOut) els.opticalOut.textContent = `×${state.optical.toFixed(2)}`;
    if (els.dispersion) els.dispersion.value = String(state.dispersionRange);
    if (els.dispersionOut) els.dispersionOut.textContent = `${state.dispersionRange}%`;
    if (els.chroma) els.chroma.value = String(state.chroma);
    if (els.chromaOut) els.chromaOut.textContent = `${state.chroma}%`;
    if (els.refraction) els.refraction.value = String(state.refraction);
    if (els.refractionOut) els.refractionOut.textContent = `${state.refraction}%`;
    const isGlass = current.kind === "glass";
    for (const input of [els.ior, els.optical, els.dispersion, els.chroma, els.refraction, els.beam, els.beamAngle, els.beamPosition, els.beamIntensity]) {
      if (input) input.disabled = !isGlass;
    }
    if (els.beamNote) els.beamNote.textContent = beamNote();
    if (els.glassNote) {
      els.glassNote.textContent = isGlass
        ? "透明玻璃按背面世界坐标预通道估算真实厚度，支持折射、菲涅耳、色散与有限全反射；折射需要背景有细节（纯色背景看不出变形）。"
        : "当前是非透射材质，折射 / 色散参数不参与计算。";
    }
    dirty = true;
  }

  function bindControls() {
    if (els.material) {
      els.material.innerHTML = "";
      for (const item of MATERIAL_PRESETS) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.label;
        els.material.appendChild(option);
      }
      els.material.value = state.preset;
      els.material.addEventListener("change", () => {
        state.preset = els.material.value;
        syncPresetControls();
        status(`材质已切换到 ${preset().label}`);
      });
    }
    if (els.color) {
      els.color.addEventListener("input", () => {
        state.color = els.color.value;
        dirty = true;
      });
    }
    const bindRange = (input, out, key, format) => {
      if (!input) return;
      input.addEventListener("input", () => {
        state[key] = Number(input.value);
        if (out) out.textContent = format ? format(state[key]) : state[key].toFixed(2);
        dirty = true;
      });
    };
    bindRange(els.roughness, els.roughnessOut, "roughness");
    bindRange(els.metallic, els.metallicOut, "metallic");
    bindRange(els.ior, els.iorOut, "ior");
    bindRange(els.optical, els.opticalOut, "optical", (v) => `×${v.toFixed(2)}`);
    bindRange(els.dispersion, els.dispersionOut, "dispersionRange", (v) => `${v.toFixed(0)}%`);
    bindRange(els.chroma, els.chromaOut, "chroma", (v) => `${v.toFixed(0)}%`);
    bindRange(els.refraction, els.refractionOut, "refraction", (v) => `${v.toFixed(0)}%`);
    // 光束位置 / 方向会改变求交结果，必须标记重算；强度只是 uniform（跟随滑杆即时生效）。
    const bindBeamGeometry = (input, out, key, format) => {
      if (!input) return;
      input.addEventListener("input", () => {
        state[key] = Number(input.value);
        if (out) out.textContent = format(state[key]);
        beamDirty = true;
        dirty = true;
      });
    };
    bindBeamGeometry(els.beamAngle, els.beamAngleOut, "beamAngle", (v) => `${v.toFixed(0)}°`);
    bindBeamGeometry(els.beamPosition, els.beamPositionOut, "beamPosition", (v) => `${v.toFixed(0)}%`);
    if (els.beamIntensity) {
      els.beamIntensity.addEventListener("input", () => {
        state.beamIntensity = Number(els.beamIntensity.value);
        if (els.beamIntensityOut) els.beamIntensityOut.textContent = state.beamIntensity.toFixed(2);
        if (beam) beam.setIntensity?.(state.beamIntensity);
        beamDirty = true;
        dirty = true;
      });
    }
    if (els.beam) {
      els.beam.addEventListener("change", () => {
        // 开关只改光束可见性：不重建网格、不重置 SVG / 厚度 / 倒角 / 材质 / 摄像机。
        state.beam = els.beam.checked;
        beamDirty = true;
        dirty = true;
        if (els.beamNote) els.beamNote.textContent = beamNote();
        status(
          !state.beam
            ? "色散光束已关闭，回到普通玻璃。"
            : beamActive()
              ? "色散光束已开启：白光正在穿过当前 SVG 模型。"
              : `色散光束已开启但没有可见光路：${beamNote()}`
        );
      });
    }
    bindRange(els.lightIntensity, els.lightIntensityOut, "lightIntensity");
    bindRange(els.lightAngle, els.lightAngleOut, "lightAngle", (v) => `${v.toFixed(0)}°`);
    bindRange(els.envIntensity, els.envIntensityOut, "envIntensity");
    bindRange(els.exposure, els.exposureOut, "exposure");
    if (els.bg) {
      els.bg.addEventListener("input", () => {
        state.bgColor = els.bg.value;
        // 手动改色即自定义：不再点亮黑 / 白预设。
        state.bgPreset = null;
        syncBackgroundPreset();
        dirty = true;
      });
    }
    for (const item of BACKGROUND_PRESETS) {
      const button = item.id === "black" ? els.bgBlack : item.id === "white" ? els.bgWhite : null;
      if (button) button.addEventListener("click", () => applyBackgroundPreset(item.id));
    }
    if (els.bgMode) {
      els.bgMode.addEventListener("change", () => {
        state.bgMode = els.bgMode.value;
        // 只有仍然停在纯色时才保留黑 / 白预设的选中态；切到棚拍 / 图片即视为离开纯色。
        if (state.bgMode !== "pure") state.bgPreset = null;
        syncBackgroundPreset();
        dirty = true;
      });
    }
    if (els.bgFile) {
      els.bgFile.addEventListener("change", () => {
        const file = els.bgFile.files && els.bgFile.files[0];
        if (file) loadBackgroundFile(file);
        els.bgFile.value = "";
      });
    }
    if (els.bgRemove) els.bgRemove.addEventListener("click", removeBackground);
    const bindPan = (input, out, key) => {
      if (!input) return;
      input.addEventListener("input", () => {
        state[key] = Number(input.value);
        if (out) out.textContent = `${state[key].toFixed(0)}%`;
        dirty = true;
        updatePanControls();
      });
    };
    bindPan(els.bgPanX, els.bgPanXOut, "bgPanX");
    bindPan(els.bgPanY, els.bgPanYOut, "bgPanY");
    if (els.bgZoom) {
      els.bgZoom.addEventListener("input", () => {
        state.bgZoom = Number(els.bgZoom.value);
        if (els.bgZoomOut) els.bgZoomOut.textContent = state.bgZoom.toFixed(2);
        dirty = true;
        updatePanControls();
      });
    }
    if (els.bgPanReset) {
      els.bgPanReset.addEventListener("click", () => {
        state.bgPanX = 0;
        state.bgPanY = 0;
        if (els.bgPanX) els.bgPanX.value = "0";
        if (els.bgPanY) els.bgPanY.value = "0";
        dirty = true;
        updatePanControls();
        status("背景位置已重置（居中）。");
      });
    }
    if (els.transparent) {
      els.transparent.addEventListener("change", () => {
        state.transparent = els.transparent.checked;
        dirty = true;
      });
    }
    if (els.resetView) {
      els.resetView.addEventListener("click", () => {
        // 只恢复摄像机位置与观察中心；模型没有独立的用户变换，不新增对象变换系统。
        camera.position.copy(VIEW_DIR).multiplyScalar(VIEW_DISTANCE);
        controls.target.set(0, 0, 0);
        controls.update();
        dirty = true;
        status("摄像机与模型构图已重置。");
      });
    }
    if (els.exportScale) {
      els.exportScale.addEventListener("change", () => {
        state.exportScale = Math.max(1, Number(els.exportScale.value) || 1);
      });
    }
    if (els.exportPng) els.exportPng.addEventListener("click", () => exportPng());
  }

  bindControls();
  if (els.bgName) els.bgName.textContent = "未使用背景图片";
  syncBackgroundPreset();
  updatePanControls();

  return {
    activate() {
      active = true;
      dirty = true;
      if (!raf) raf = requestAnimationFrame(tick);
      void ensureGpu();
    },
    deactivate() {
      active = false;
    },
    setMesh(snapshot) {
      uploadMesh(snapshot);
    },
    exportPng,
    getInfo() {
      return {
        ready,
        failed,
        webgpu: typeof navigator !== "undefined" && !!navigator.gpu,
        preset: state.preset,
        presets: MATERIAL_PRESETS.map((p) => ({ id: p.id, label: p.label, kind: p.kind })),
        state: { ...state },
        mesh: meshSummary,
        // 色散光束：是否可用 / 光路统计；外轮廓不满足条件时给出中文原因。
        beam: {
          enabled: state.beam,
          active: beamActive(),
          outline: outline ? (outline.ok ? { ok: true, count: outline.count } : { ok: false, reason: outline.reason }) : null,
          stats: beam ? beam.stats : null
        },
        hasGpuGeometry: !!meshGeometry,
        targetSize: [...targetSize],
        cameraDistance: +camera.position.distanceTo(controls.target).toFixed(3),
        renders: state.renders,
        exports,
        canvas: [canvas.width, canvas.height]
      };
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try {
        if (gpu) gpu.dispose();
      } catch {
        /* 释放失败不抛给页面 */
      }
      gpu = null;
      ready = false;
    }
  };
}
