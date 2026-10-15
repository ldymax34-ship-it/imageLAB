import { effect, frame, sampler, target } from "vgpu";

import environmentBakeWgsl from "./environment-bake.wgsl";
import environmentBlurWgsl from "./environment-blur.wgsl";

/** 2:1 HDR layout sized for the hero's small on-screen reflection footprint. */
export const ENVIRONMENT_SIZE = [1024, 512];
export const ENVIRONMENT_LEVELS = 8;
export const ENVIRONMENT_TEXEL_ANGLE =
  (2 * Math.PI) / ENVIRONMENT_SIZE[0];
const ENVIRONMENT_BLUR_RADIUS = 1.15;

let shaderOverrides = null;
export function setPrismEnvironmentShaderOverride(shaders) {
  shaderOverrides = shaders;
}
function prismShader(name, fallback) {
  return (shaderOverrides && shaderOverrides[name]) || fallback;
}

export function createEnvironmentSampler(gpu) {
  return sampler(gpu, {
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "clamp-to-edge",
  });
}

export function createEnvironmentTexture(gpu, label, debug) {
  const texture = gpu.device.createTexture({
    kind: "2d",
    size: [...ENVIRONMENT_SIZE],
    format: "rgba16float",
    mipLevelCount: ENVIRONMENT_LEVELS,
    usage: ["texture_binding", "copy_dst"],
    label: `${label}.texture`,
  });
  const bake = effect(gpu, prismShader("environmentBake", environmentBakeWgsl), { label: `${label}.bake` });
  const blur = effect(gpu, prismShader("environmentBlur", environmentBlurWgsl), { label: `${label}.blur` });
  bake.set({ params: { debug: debug ? 1 : 0 } });
  return { texture, bake, blur, prepared: false };
}

export async function prepareEnvironmentTexture(gpu, environment, samplerState) {
  if (environment.prepared) return;
  let source = target(gpu, {
    size: ENVIRONMENT_SIZE,
    format: "rgba16float",
    label: `${environment.texture.label}.level0`,
  });
  await Promise.all([
    environment.bake.compile(source),
    environment.blur.compile(source),
  ]);
  frame(gpu, (currentFrame) => {
    currentFrame.pass(
      { target: source, clear: [0, 0, 0, 1] },
      (pass) => pass.draw(environment.bake)
    );
  });
  copyIntoLevel(gpu, source, environment.texture, 0);

  for (let level = 1; level < ENVIRONMENT_LEVELS; level++) {
    const size = [
      Math.max(1, ENVIRONMENT_SIZE[0] >> level),
      Math.max(1, ENVIRONMENT_SIZE[1] >> level),
    ];
    const horizontal = target(gpu, {
      size,
      format: "rgba16float",
      label: `${environment.texture.label}.blur-h${level}`,
    });
    const vertical = target(gpu, {
      size,
      format: "rgba16float",
      label: `${environment.texture.label}.level${level}`,
    });
    const texel = [1 / size[0], 1 / size[1]];

    environment.blur.set({
      src: source,
      src_samp: samplerState,
      blur: {
        texel,
        direction: [1, 0],
        radius: ENVIRONMENT_BLUR_RADIUS,
        equirect_compensation: 1,
      },
    });
    frame(gpu, (currentFrame) => {
      currentFrame.pass({ target: horizontal }, (pass) =>
        pass.draw(environment.blur)
      );
    });
    environment.blur.set({
      src: horizontal,
      src_samp: samplerState,
      blur: {
        texel,
        direction: [0, 1],
        radius: ENVIRONMENT_BLUR_RADIUS,
        equirect_compensation: 0,
      },
    });
    frame(gpu, (currentFrame) => {
      currentFrame.pass({ target: vertical }, (pass) =>
        pass.draw(environment.blur)
      );
    });

    copyIntoLevel(gpu, vertical, environment.texture, level);
    destroyTarget(horizontal);
    destroyTarget(source);
    source = vertical;
  }
  destroyTarget(source);
  environment.prepared = true;
}

function copyIntoLevel(gpu, source, environment, level) {
  const encoder = gpu.gpu.createCommandEncoder({
    label: `${environment.label}.copy-level${level}`,
  });
  encoder.copyTextureToTexture(
    { texture: source.color.gpu },
    { texture: environment.gpu, mipLevel: level },
    [source.size[0], source.size[1], 1]
  );
  gpu.gpu.queue.submit([encoder.finish()]);
}

function destroyTarget(colorTarget) {
  colorTarget.destroy?.();
}

export function destroyEnvironmentTexture(environment) {
  environment?.texture.destroy();
}
