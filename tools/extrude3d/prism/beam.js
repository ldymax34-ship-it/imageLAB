/**
 * 「色散光束」：白光穿过**当前用户 SVG 挤出模型**的确定性光路。
 *
 * 上游：vercel-labs/vgpu，commit `81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5`（MIT），
 * 原始目录 `apps/docs/app/[lang]/(home)/components/prism-background/`：
 *   - `scene/light-mesh.ts`：CPU 求交 + 光谱条带网格（本项目把三角形泛化为凸多边形）；
 *   - `pipelines/light.wgsl` + `pipelines/spectral/*`：把 XY 平面的光谱带抬到玻璃中间深度、
 *     D65 光谱 LUT 着色、有限宽度光束衰减；
 *   - `pipelines/bloom/*`：提取、三级高斯模糊、合成。
 * 官网的 React 外壳、调试视图、性能面板、dust 粒子、wireframe、主题系统与写死的三角棱镜
 * 几何都不在这里。玻璃实体始终是 render-vgpu.js 里的用户网格，本模块只负责光束本身。
 *
 * 屏幕空间近似（不得当成完整光线追踪）：光束是**二维截面**的光路，绘制在模型中间深度
 * （z = 0）上并加法合成到最终画面，不写深度、逐步遮挡；每帧不做逐像素光线求交。
 */

import { draw, effect, sampler, target } from "vgpu";

import lightWgsl from "./pipelines/light.wgsl";
import bloomExtractWgsl from "./pipelines/bloom/bloom-extract.wgsl";
import bloomBlurWgsl from "./pipelines/bloom/bloom-blur.wgsl";
import bloomBlurPairedWgsl from "./pipelines/bloom/bloom-blur-paired.wgsl";
import bloomCompositeWgsl from "./pipelines/bloom/bloom-composite.wgsl";
import { buildLightMesh, lightMeshLayout, LIGHT_VERTEX_STRIDE } from "./scene/light-mesh.js";
import { beamSceneUniforms, lampForPolygon, toPolygonPoints } from "./scene/beam-scene.js";
import {
  BEAM_HALF_WIDTH_RATIO,
  LIGHT_PLANE_Z,
  LIGHT_WALL_HALF_EXTENT,
  PRISM_DISPERSION,
  PRISM_LIGHT_FADE,
  PRISM_POSTPROCESS
} from "./types.js";

const BLOOM_LEVEL_DIVISORS = [2, 4, 8];
const BLOOM_LEVEL_FACTORS = [1, 0.8, 0.55];
const BLOOM_BLUR_SAMPLING = [
  { horizontal: "paired", vertical: "paired" },
  { horizontal: "raw", vertical: "paired" },
  { horizontal: "raw", vertical: "paired" }
];
const BLOOM_KERNEL_TAPS = [6, 10, 14];
const BLOOM_PAIRED_KERNEL_CAPACITY = 12;

/** 与上游相同的能量归一化高斯核权重。 */
function bloomKernelWeights(tapCount, capacity = 24) {
  const count = Math.min(capacity, Math.max(1, Math.floor(tapCount)));
  const sigma = count / 3;
  const weights = Array.from({ length: capacity }, (_, index) =>
    index < count ? Math.exp((-0.5 * index * index) / (sigma * sigma)) : 0
  );
  const total = weights[0] + 2 * weights.slice(1, count).reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

/** 相邻正负采样点按双线性过滤配对，用更少的采样重建同一条离散核。 */
function bloomPairedKernel(weights, tapCount, capacity = BLOOM_PAIRED_KERNEL_CAPACITY) {
  const count = Math.min(weights.length, Math.max(1, Math.floor(tapCount)));
  const pairCount = Math.ceil((count - 1) / 2);
  const pairedWeights = Array(capacity).fill(0);
  const pairedOffsets = Array(capacity).fill(0);
  for (let pair = 0; pair < pairCount; pair++) {
    const first = 1 + pair * 2;
    const second = first + 1;
    const firstWeight = weights[first] ?? 0;
    const secondWeight = second < count ? weights[second] ?? 0 : 0;
    const combined = firstWeight + secondWeight;
    pairedWeights[pair] = combined;
    pairedOffsets[pair] = combined > 0 ? (first * firstWeight + second * secondWeight) / combined : first;
  }
  return { centerWeight: weights[0] ?? 0, pairCount, weights: pairedWeights, offsets: pairedOffsets };
}

function bloomBlurUniforms(level, axis, size) {
  const kernelWeights = bloomKernelWeights(BLOOM_KERNEL_TAPS[level]);
  const direction = axis === "horizontal" ? [1, 0] : [0, 1];
  const common = { direction, texelSize: [1 / size[0], 1 / size[1]] };
  if (BLOOM_BLUR_SAMPLING[level][axis] === "paired") {
    const paired = bloomPairedKernel(kernelWeights, BLOOM_KERNEL_TAPS[level]);
    return {
      ...common,
      kernel: [paired.centerWeight, paired.pairCount, 0, 0],
      weights0: paired.weights.slice(0, 4),
      weights1: paired.weights.slice(4, 8),
      weights2: paired.weights.slice(8, 12),
      offsets0: paired.offsets.slice(0, 4),
      offsets1: paired.offsets.slice(4, 8),
      offsets2: paired.offsets.slice(8, 12)
    };
  }
  return {
    ...common,
    tapCount: BLOOM_KERNEL_TAPS[level],
    coefficients0: kernelWeights.slice(0, 4),
    coefficients1: kernelWeights.slice(4, 8),
    coefficients2: kernelWeights.slice(8, 12),
    coefficients3: kernelWeights.slice(12, 16),
    coefficients4: kernelWeights.slice(16, 20),
    coefficients5: kernelWeights.slice(20, 24)
  };
}

function bloomLevelSize(size, index) {
  const divisor = BLOOM_LEVEL_DIVISORS[index];
  return [Math.max(1, Math.ceil(size[0] / divisor)), Math.max(1, Math.ceil(size[1] / divisor))];
}

/**
 * 光束通道：一个 HDR 光束目标 + 上游三级 bloom，最终由 render-vgpu.js 的 present 加法合成。
 *
 * 用法：`update()` 传入新的凸多边形与光束参数（CPU 重新求交并写顶点缓冲），`render()` 每帧绘制。
 */
export function createBeamPass(gpu, label, size, options = {}) {
  const layout = lightMeshLayout(
    options.samples ?? undefined,
    options.beamSlices ?? undefined
  );
  const sceneSampler = sampler(gpu, {
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge"
  });
  const lightBuffer = gpu.device.createBuffer({
    size: layout.vertexCount * LIGHT_VERTEX_STRIDE,
    usage: ["vertex", "copy_dst"],
    label: `${label}.vertices`
  });
  // 动态属性只有 position.xy 与 intensity；其余从 vertex_index 解码（上游做法）。
  const lightGeometry = {
    vertexBuffers: [lightBuffer.gpu],
    vertexBufferLayouts: [
      {
        arrayStride: LIGHT_VERTEX_STRIDE,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 3, offset: 8, format: "float32" }
        ]
      }
    ],
    vertexCount: layout.vertexCount
  };
  const light = draw(gpu, {
    shader: lightWgsl,
    geometry: lightGeometry,
    blend: "additive",
    cull: "none",
    depth: false,
    label: `${label}.light`
  });
  const bloomExtract = effect(gpu, bloomExtractWgsl, { label: `${label}.bloom-extract` });
  const bloomBlur = BLOOM_BLUR_SAMPLING.map((sampling, level) => ({
    horizontal: effect(gpu, sampling.horizontal === "paired" ? bloomBlurPairedWgsl : bloomBlurWgsl, { label: `${label}.bloom-${level}-h` }),
    vertical: effect(gpu, sampling.vertical === "paired" ? bloomBlurPairedWgsl : bloomBlurWgsl, { label: `${label}.bloom-${level}-v` })
  }));
  const bloomComposite = effect(gpu, bloomCompositeWgsl, { label: `${label}.bloom-composite` });

  const beamTarget = target(gpu, { size, format: "rgba16float", label: `${label}.beam` });
  const bloomTargets = BLOOM_LEVEL_DIVISORS.map((_, level) => {
    const levelSize = bloomLevelSize(size, level);
    return {
      horizontal: target(gpu, { size: levelSize, format: "rgba16float", label: `${label}.bloom-${level}-h` }),
      vertical: target(gpu, { size: levelSize, format: "rgba16float", label: `${label}.bloom-${level}-v` })
    };
  });

  let viewProjection = new Float32Array(16);
  let sceneUniform = sceneUniforms({ direction: [1, 0], beamHalfWidth: 0.05 }, 1);
  let stats = null;
  let polygon = null;
  let scratch = [];
  const meshBuffer = { vertices: new Float32Array(layout.vertexCount * 3) };

  function sceneUniforms(light, opacity) {
    return beamSceneUniforms({
      layout,
      viewProjection,
      light,
      intensity: opacity,
      wallHalfExtent: LIGHT_WALL_HALF_EXTENT,
      planeZ: LIGHT_PLANE_Z,
      fade: PRISM_LIGHT_FADE
    });
  }

  function bindGraph() {
    const bloomRadius = Math.min(
      1,
      Math.max(0, (PRISM_POSTPROCESS.bloomRadius - 0.25) / (3 - 0.25))
    );
    light.set({ scene: sceneUniform });
    bloomExtract.set({
      sourceTexture: beamTarget,
      sourceSampler: sceneSampler,
      params: { threshold: PRISM_POSTPROCESS.bloomThreshold }
    });
    bloomBlur.forEach((blur, level) => {
      const targets = bloomTargets[level];
      blur.horizontal.set({
        sourceTexture: level === 0 ? targets.vertical : bloomTargets[level - 1].vertical,
        sourceSampler: sceneSampler,
        params: bloomBlurUniforms(level, "horizontal", targets.horizontal.size)
      });
      blur.vertical.set({
        sourceTexture: targets.horizontal,
        sourceSampler: sceneSampler,
        params: bloomBlurUniforms(level, "vertical", targets.vertical.size)
      });
    });
    bloomComposite.set({
      level0Texture: bloomTargets[0].vertical,
      level1Texture: bloomTargets[1].vertical,
      level2Texture: bloomTargets[2].vertical,
      levelSampler: sceneSampler,
      params: { radius: bloomRadius, factors: [...BLOOM_LEVEL_FACTORS, 0] }
    });
  }

  /** 重新求交并写顶点缓冲：多边形或光束参数变化时调用（不是每帧）。 */
  function update(next) {
    polygon = toPolygonPoints(next.polygon);
    const light3d = lampForPolygon(polygon, {
      angle: next.angle,
      position: next.position,
      halfWidthRatio: BEAM_HALF_WIDTH_RATIO
    });
    const dispersion = {
      base: PRISM_DISPERSION.base,
      strength: PRISM_DISPERSION.strength * (next.dispersion / 100)
    };
    const built = buildLightMesh(
      {
        polygon,
        light: light3d,
        dispersion,
        wallHalfExtent: LIGHT_WALL_HALF_EXTENT,
        samples: layout.samples,
        beamSlices: layout.beamSlices,
        edgeFalloff: PRISM_LIGHT_FADE.edgeFalloff
      },
      meshBuffer.vertices,
      scratch
    );
    lightBuffer.write(built.vertices);
    stats = built.stats;
    sceneUniform = sceneUniforms(light3d, next.intensity);
    sceneUniform.viewProjection = viewProjection;
    return stats;
  }

  function resize(nextSize) {
    size = [Math.max(1, Math.floor(nextSize[0])), Math.max(1, Math.floor(nextSize[1]))];
    beamTarget.resize(size);
    bloomTargets.forEach((targets, level) => {
      const levelSize = bloomLevelSize(size, level);
      targets.horizontal.resize(levelSize);
      targets.vertical.resize(levelSize);
    });
    bindGraph();
  }

  async function compile() {
    bindGraph();
    await Promise.all([
      light.compile(beamTarget),
      bloomExtract.compile(bloomTargets[0].vertical),
      ...bloomBlur.flatMap((blur, level) => [
        blur.horizontal.compile(bloomTargets[level].horizontal),
        blur.vertical.compile(bloomTargets[level].vertical)
      ]),
      bloomComposite.compile(bloomTargets[0].horizontal)
    ]);
  }

  function render(currentFrame) {
    bindGraph();
    currentFrame.pass({ target: beamTarget, clear: [0, 0, 0, 0] }, (pass) => {
      pass.draw(light, { firstVertex: 0, vertices: layout.whiteVertices });
      pass.draw(light, { firstVertex: layout.internalFirstVertex, vertices: layout.internalVertices });
      pass.draw(light, { firstVertex: layout.outgoingFirstVertex, vertices: layout.outgoingVertices });
    });
    currentFrame.pass({ target: bloomTargets[0].vertical, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bloomExtract));
    bloomTargets.forEach((targets, level) => {
      currentFrame.pass({ target: targets.horizontal, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bloomBlur[level].horizontal));
      currentFrame.pass({ target: targets.vertical, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bloomBlur[level].vertical));
    });
    currentFrame.pass({ target: bloomTargets[0].horizontal, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bloomComposite));
  }

  function dispose() {
    lightBuffer.destroy();
    for (const item of [beamTarget, ...bloomTargets.flatMap((targets) => [targets.horizontal, targets.vertical])]) {
      item.destroy?.();
    }
    for (const item of [light, bloomExtract, bloomComposite, ...bloomBlur.flatMap((blur) => [blur.horizontal, blur.vertical])]) {
      item.dispose?.();
    }
  }

  bindGraph();

  return {
    layout,
    update,
    resize,
    compile,
    render,
    dispose,
    get beamTarget() {
      return beamTarget;
    },
    get bloomTarget() {
      return bloomTargets[0].horizontal;
    },
    get polygon() {
      return polygon;
    },
    get stats() {
      return stats;
    },
    setViewProjection(next) {
      viewProjection = next;
      sceneUniform.viewProjection = next;
    },
    /** 强度只是 uniform（`lightOpacity`），不必重算光路。 */
    setIntensity(next) {
      sceneUniform.lightOpacity = next;
    }
  };
}
