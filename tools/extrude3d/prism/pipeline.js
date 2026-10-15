/**
 * vgpu 官网三角棱镜场景的最小整合适配。
 *
 * 上游：vercel-labs/vgpu，commit 81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5（MIT），
 * 原始目录 apps/docs/app/[lang]/(home)/components/prism-background/。
 * 这里保留官网 dark 主题的 light / glass / bloom / present 管线，去掉官网的
 * React 外壳、调试视图、性能面板、粒子 dust、wireframe 与主题切换。
 */
import { draw, effect, sampler, target } from "vgpu";

import lightWgsl from "./pipelines/light.wgsl";
import copyLinearWgsl from "./pipelines/presentation/copy-linear.wgsl";
import copyPresentationWgsl from "./pipelines/presentation/copy-presentation.wgsl";
import glassBackWgsl from "./pipelines/glass/glass-back.wgsl";
import glassWgsl from "./pipelines/glass/glass.wgsl";
import bloomExtractWgsl from "./pipelines/bloom/bloom-extract.wgsl";
import bloomBlurWgsl from "./pipelines/bloom/bloom-blur.wgsl";
import bloomBlurPairedWgsl from "./pipelines/bloom/bloom-blur-paired.wgsl";
import bloomCompositeWgsl from "./pipelines/bloom/bloom-composite.wgsl";
import presentWgsl from "./pipelines/present.wgsl";
import { cameraView, lightWallExtent, rotationMatrix, wallExtent } from "./scene/camera.js";
import { buildLightMesh, lightMeshLayout, LIGHT_VERTEX_STRIDE, LIGHT_INTERNAL_SEGMENTS } from "./scene/light-mesh.js";
import { prismGeometry, prismPlanes, prismMeshData } from "./scene/prism-mesh.js";
import {
  createEnvironmentSampler,
  setPrismEnvironmentShaderOverride,
  createEnvironmentTexture,
  prepareEnvironmentTexture,
  ENVIRONMENT_SIZE,
  ENVIRONMENT_TEXEL_ANGLE,
} from "./environment/texture.js";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEGREES,
  PRISM_BACK_Z,
  PRISM_DISPERSION,
  PRISM_FRONT_Z,
  PRISM_GLASS,
  PRISM_LIGHT_FADE,
  PRISM_LIGHT_PLANE_Z,
  PRISM_POSTPROCESS,
  PRISM_TRIANGLE,
  lampForIncidence,
} from "./types.js";

const BLOOM_LEVELS = [0, 1, 2];
const BLOOM_LEVEL_DIVISORS = [2, 4, 8];

const BLOOM_LEVEL_FACTORS = [1, 0.8, 0.55];
const BLOOM_BLUR_SAMPLING = [
  { horizontal: "paired", vertical: "paired" },
  { horizontal: "raw", vertical: "paired" },
  { horizontal: "raw", vertical: "paired" },
];
const BLOOM_KERNEL_TAPS = [6, 10, 14];
const BLOOM_PAIRED_KERNEL_CAPACITY = 12;

let shaderOverrides = null;
export function setPrismShaderOverride(shaders) {
  shaderOverrides = shaders;
  setPrismEnvironmentShaderOverride(shaders);
}
function prismShader(name, fallback) {
  return (shaderOverrides && shaderOverrides[name]) || fallback;
}


export function schlickFresnelF0(ior) {
  const shaderIor = Math.fround(ior);
  const ratio = Math.fround(Math.fround(shaderIor - 1) / Math.fround(shaderIor + 1));
  return Math.fround(ratio * ratio);
}

export function bloomKernelWeights(tapCount, capacity = 24) {
  const count = Math.min(capacity, Math.max(1, Math.floor(tapCount)));
  const sigma = count / 3;
  const weights = Array.from({ length: capacity }, (_, index) =>
    index < count ? Math.exp((-0.5 * index * index) / (sigma * sigma)) : 0
  );
  const total = weights[0] + 2 * weights.slice(1, count).reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

export function bloomPairedKernel(weights, tapCount, capacity = BLOOM_PAIRED_KERNEL_CAPACITY) {
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

function bloomSpread(radius, minimum, maximum) {
  if (!Number.isFinite(radius) || !(maximum > minimum)) return 0;
  return Math.min(1, Math.max(0, (radius - minimum) / (maximum - minimum)));
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
      offsets2: paired.offsets.slice(8, 12),
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
    coefficients5: kernelWeights.slice(20, 24),
  };
}

function bloomLevelSize(size, level) {
  const divisor = BLOOM_LEVEL_DIVISORS[level];
  return [Math.max(1, Math.ceil(size[0] / divisor)), Math.max(1, Math.ceil(size[1] / divisor))];
}

export async function createPrismPipeline(gpu, label, size) {
  const aspect = size[0] / Math.max(1, size[1]);
  const camera = cameraView(aspect);
  const sceneSampler = sampler(gpu, {
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
  const environmentSampler = createEnvironmentSampler(gpu);
  const layout = lightMeshLayout();
  const lightData = buildLightMesh({
    light: lampForIncidence(60),
    dispersion: PRISM_DISPERSION,
    wallHalfExtent: lightWallExtent(aspect),
    samples: layout.samples,
    beamSlices: layout.beamSlices,
    edgeFalloff: PRISM_LIGHT_FADE.edgeFalloff,
  });
  const lightBuffer = gpu.device.createBuffer({
    size: layout.vertexCount * LIGHT_VERTEX_STRIDE,
    usage: ["vertex", "copy_dst"],
    label: `${label}.light-vertices`,
  });
  lightBuffer.write(lightData.vertices);
  const lightGeometry = {
    vertexBuffers: [lightBuffer.gpu],
    vertexBufferLayouts: [
      {
        arrayStride: LIGHT_VERTEX_STRIDE,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 3, offset: 8, format: "float32" },
        ],
      },
    ],
    vertexCount: layout.vertexCount,
  };
  const prism = prismGeometry(gpu, `${label}.prism`);
  const light = draw(gpu, { shader: prismShader("light", lightWgsl), geometry: lightGeometry, blend: "additive", cull: "none", depth: false, label: `${label}.light` });
  const copyBackground = effect(gpu, prismShader("copyLinear", copyLinearWgsl), { label: `${label}.copy-background` });
  const glassBack = draw(gpu, { shader: prismShader("glassBack", glassBackWgsl), geometry: prism, cull: "front", depth: false, blend: "premultiplied", label: `${label}.glass-back` });
  const glassFront = draw(gpu, { shader: prismShader("glass", glassWgsl), geometry: prism, cull: "back", depth: false, label: `${label}.glass-front` });
  const bloomExtract = effect(gpu, prismShader("bloomExtract", bloomExtractWgsl), { label: `${label}.bloom-extract` });
  const bloomBlur = BLOOM_BLUR_SAMPLING.map((sampling, level) => ({
    horizontal: effect(gpu, sampling.horizontal === "paired" ? prismShader("bloomBlurPaired", bloomBlurPairedWgsl) : prismShader("bloomBlur", bloomBlurWgsl), { label: `${label}.bloom-${level}-h` }),
    vertical: effect(gpu, sampling.vertical === "paired" ? prismShader("bloomBlurPaired", bloomBlurPairedWgsl) : prismShader("bloomBlur", bloomBlurWgsl), { label: `${label}.bloom-${level}-v` }),
  }));
  const bloomComposite = effect(gpu, prismShader("bloomComposite", bloomCompositeWgsl), { label: `${label}.bloom-composite` });
  const present = effect(gpu, prismShader("present", presentWgsl), { label: `${label}.present` });
  const copyPresentation = effect(gpu, prismShader("copyPresentation", copyPresentationWgsl), { label: `${label}.copy-presentation` });

  const backgroundTarget = target(gpu, { size, format: "rgba16float", label: `${label}.backdrop` });
  const sceneTarget = target(gpu, { size, format: "rgba16float", msaa: true, label: `${label}.scene` });
  const bloomTargets = BLOOM_LEVELS.map((_, level) => {
    const levelSize = bloomLevelSize(size, level);
    return {
      horizontal: target(gpu, { size: levelSize, format: "rgba16float", label: `${label}.bloom-${level}-h` }),
      vertical: target(gpu, { size: levelSize, format: "rgba16float", label: `${label}.bloom-${level}-v` }),
    };
  });
  const presentationTarget = target(gpu, { size, format: "rgba8unorm", label: `${label}.presentation` });
  const studioEnvironment = createEnvironmentTexture(gpu, `${label}.environment`, false);
  const environmentReady = prepareEnvironmentTexture(gpu, studioEnvironment, environmentSampler);
  const uniforms = prismUniforms(camera, aspect);
  const sceneUniformsValue = sceneUniforms(layout, aspect);

  function bindGraph() {
    const bloomRadius = bloomSpread(PRISM_POSTPROCESS.bloomRadius, 0, 1);
    light.set({ scene: sceneUniformsValue });
    copyBackground.set({ sceneTexture: backgroundTarget });
    glassBack.set({
      params: uniforms,
      studioEnvironment: studioEnvironment.texture,
      debugEnvironment: studioEnvironment.texture,
      environmentSampler,
    });
    glassFront.set({
      params: uniforms,
      sceneTexture: backgroundTarget,
      sceneSampler,
      studioEnvironment: studioEnvironment.texture,
      debugEnvironment: studioEnvironment.texture,
      environmentSampler,
    });
    bloomExtract.set({
      sourceTexture: sceneTarget,
      sourceSampler: sceneSampler,
      params: { threshold: PRISM_POSTPROCESS.bloomThreshold },
    });
    bloomBlur.forEach((bloom, level) => {
      const targets = bloomTargets[level];
      bloom.horizontal.set({
        sourceTexture: level === 0 ? targets.vertical : bloomTargets[level - 1].vertical,
        sourceSampler: sceneSampler,
        params: bloomBlurUniforms(level, "horizontal", targets.horizontal.size),
      });
      bloom.vertical.set({
        sourceTexture: targets.horizontal,
        sourceSampler: sceneSampler,
        params: bloomBlurUniforms(level, "vertical", targets.vertical.size),
      });
    });
    bloomComposite.set({
      level0Texture: bloomTargets[0].vertical,
      level1Texture: bloomTargets[1].vertical,
      level2Texture: bloomTargets[2].vertical,
      levelSampler: sceneSampler,
      params: { radius: bloomRadius, factors: [...BLOOM_LEVEL_FACTORS, 0] },
    });
    present.set({
      sceneTexture: sceneTarget,
      bloomTexture: bloomTargets[0].horizontal,
      bloomSampler: sceneSampler,
      params: { bloomStrength: PRISM_POSTPROCESS.bloomStrength },
    });
    copyPresentation.set({
      sourceTexture: presentationTarget,
      params: { backgroundColor: [0, 0, 0], revealProgress: 1 },
    });
  }

  function sceneUniforms(layoutValue, aspectValue) {
    const wall = wallExtent(aspectValue);
    return {
      viewProjection: camera.viewProjection,
      wallHalfExtent: wall,
      inputBeamDirection: lampForIncidence(60).direction,
      wallColor: [0, 0, 0],
      causticOnly: 0,
      lightPlaneZ: PRISM_LIGHT_PLANE_Z,
      lightWhiteQuads: layoutValue.whiteQuads,
      lightBeamSlices: layoutValue.beamSlices,
      lightSpectralSamples: layoutValue.samples,
      lightInternalQuads: layoutValue.internalQuads,
      lightInternalSegments: LIGHT_INTERNAL_SEGMENTS,
      lightOpacity: PRISM_LIGHT_FADE.beamOpacity,
      lightEdgeFalloff: PRISM_LIGHT_FADE.edgeFalloff,
      rainbowFalloffRate: PRISM_LIGHT_FADE.rainbowFalloffRate,
      rainbowFalloffPower: PRISM_LIGHT_FADE.rainbowFalloffPower,
      beamWidthReveal: 1,
    };
  }

  function prismUniforms(cameraView, aspectValue) {
    void aspectValue;
    return {
      viewProjection: cameraView.viewProjection,
      environmentRotation: rotationMatrix(PRISM_GLASS.environmentRotation),
      cameraPosition: cameraView.position,
      absorption: PRISM_GLASS.absorption,
      prismA: PRISM_TRIANGLE.a,
      prismB: PRISM_TRIANGLE.b,
      prismC: PRISM_TRIANGLE.c,
      environmentSize: ENVIRONMENT_SIZE,
      frontZ: PRISM_FRONT_Z,
      backZ: PRISM_BACK_Z,
      ior: PRISM_GLASS.ior,
      reflectionStrength: PRISM_GLASS.reflectionStrength,
      environmentExposure: PRISM_GLASS.environmentExposure,
      environmentDebug: 0,
      environmentTexelAngle: ENVIRONMENT_TEXEL_ANGLE,
      fresnelF0: schlickFresnelF0(PRISM_GLASS.ior),
      prismPlanes: prismPlanes(),
    };
  }

  async function compile(output) {
    await environmentReady;
    bindGraph();
    await Promise.all([
      light.compile(backgroundTarget),
      glassBack.compile(backgroundTarget),
      copyBackground.compile(sceneTarget),
      glassFront.compile(sceneTarget),
      bloomExtract.compile(bloomTargets[0].vertical),
      ...bloomBlur.flatMap((level, index) => [
        level.horizontal.compile(bloomTargets[index].horizontal),
        level.vertical.compile(bloomTargets[index].vertical),
      ]),
      bloomComposite.compile(bloomTargets[0].horizontal),
      present.compile(presentationTarget),
      copyPresentation.compile(output),
    ]);
  }

  function resize(nextSize) {
    const next = [Math.max(1, Math.floor(nextSize[0])), Math.max(1, Math.floor(nextSize[1]))];
    if (next[0] === size[0] && next[1] === size[1]) return;
    size = next;
    const aspect = size[0] / Math.max(1, size[1]);
    const updatedCamera = cameraView(aspect);
    backgroundTarget.resize(size);
    sceneTarget.resize(size);
    presentationTarget.resize(size);
    bloomTargets.forEach((targets, level) => {
      const levelSize = bloomLevelSize(size, level);
      targets.horizontal.resize(levelSize);
      targets.vertical.resize(levelSize);
    });
    const cameraViewValue = updatedCamera;
    camera.position = cameraViewValue.position;
    camera.viewProjection = cameraViewValue.viewProjection;
    uniforms.viewProjection = cameraViewValue.viewProjection;
    uniforms.cameraPosition = cameraViewValue.position;
    const wall = wallExtent(aspect);
    sceneUniformsValue.wallHalfExtent = wall;
    sceneUniformsValue.viewProjection = cameraViewValue.viewProjection;
    bindGraph();
  }

  function render(currentFrame, output) {
    bindGraph();
    currentFrame.pass({ target: backgroundTarget, clear: [0, 0, 0, 1] }, (pass) => {
      pass.draw(light, { firstVertex: 0, vertices: layout.whiteVertices });
      pass.draw(light, { firstVertex: layout.outgoingFirstVertex, vertices: layout.outgoingVertices });
      pass.draw(glassBack);
      pass.draw(light, { firstVertex: layout.internalFirstVertex, vertices: layout.internalVertices });
    });
    currentFrame.pass({ target: sceneTarget, clear: [0, 0, 0, 1] }, (pass) => {
      pass.draw(copyBackground);
      pass.draw(glassFront);
    });
    currentFrame.pass({ target: bloomTargets[0].vertical, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bloomExtract));
    bloomTargets.forEach((targets, level) => {
      currentFrame.pass({ target: targets.horizontal, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bloomBlur[level].horizontal));
      currentFrame.pass({ target: targets.vertical, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bloomBlur[level].vertical));
    });
    currentFrame.pass({ target: bloomTargets[0].horizontal, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bloomComposite));
    currentFrame.pass({ target: presentationTarget, clear: [0, 0, 0, 1] }, (pass) => pass.draw(present));
    currentFrame.pass({ target: output }, (pass) => pass.draw(copyPresentation));
  }

  function dispose() {
    lightBuffer.destroy();
    prism.destroy();
    studioEnvironment.texture.destroy();
    for (const item of [backgroundTarget, sceneTarget, presentationTarget, ...bloomTargets.flatMap((targets) => [targets.horizontal, targets.vertical])]) {
      item.destroy?.();
    }
    for (const item of [light, copyBackground, glassBack, glassFront, bloomExtract, bloomComposite, present, copyPresentation, ...bloomBlur.flatMap((level) => [level.horizontal, level.vertical])]) {
      item.dispose?.();
    }
  }

  return { layout, compile, resize, render, dispose, stats: lightData.stats };
}
