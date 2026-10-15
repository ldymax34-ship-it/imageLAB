/**
 * SVG 转 3D 渲染页签 · vgpu API 合约自检（官方 mock adapter，纯 Node）
 *
 * 用 vgpu 官方 mock adapter 在 Node 里跑一遍 `render-vgpu.js` 的真实调用方式：
 * 解析 5 份 WGSL、上传 stride 32 的自定义网格、draw / effect 预编译、多趟 frame
 * （背景 effect → 玻璃背面预通道 → 模型写带深度目标 → present 合成）、导出目标 read，
 * 以及导出倍率时的 target resize + 重新绑定。
 *
 * 其中背景是 fragment-only shader，必须走 `effect()` 的内置全屏顶点通道；
 * `present` 额外绑定背景并把模型合成到背景之上（回归 vgpu `vs_main` 缺失与深度遮挡问题）。
 *
 * 它不验证视觉 / 像素，只拦住 API 用法错误（约束由官方实现给出）：
 *   - `indices` 存在时不能再传 `indexFormat`（由 TypedArray 推断）；
 *   - `set()` 必须提供 WGSL struct 的**全部**字段；
 *   - `clear: false` 与 `clearDepth` 不能同时出现；
 *   - 每个 draw 的 uniform 都必须真实 set。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SHADER_DIR = fileURLToPath(new URL("../tools/extrude3d/shaders/", import.meta.url));
const BEAM_SHADER_DIR = fileURLToPath(new URL("../tools/extrude3d/prism/", import.meta.url));

async function loadShaders() {
  const { resolveShader } = await import("@vgpu/wgsl/runtime");
  const { prepareShader } = await import("@vgpu/wgsl/prepare");
  const out = {};
  for (const name of ["pbr", "glass", "glass-back", "glass-back-info", "background", "present"]) {
    const resolved = await resolveShader({ entry: `${SHADER_DIR}${name}.wgsl`, validate: false });
    out[name] = prepareShader(resolved.wgsl);
  }
  return out;
}

async function loadBeamShaders() {
  const { resolveShader } = await import("@vgpu/wgsl/runtime");
  const { prepareShader } = await import("@vgpu/wgsl/prepare");
  const entries = {
    light: `${BEAM_SHADER_DIR}pipelines/light.wgsl`,
    bloomExtract: `${BEAM_SHADER_DIR}pipelines/bloom/bloom-extract.wgsl`,
    bloomBlur: `${BEAM_SHADER_DIR}pipelines/bloom/bloom-blur.wgsl`,
    bloomBlurPaired: `${BEAM_SHADER_DIR}pipelines/bloom/bloom-blur-paired.wgsl`,
    bloomComposite: `${BEAM_SHADER_DIR}pipelines/bloom/bloom-composite.wgsl`
  };
  const out = {};
  for (const [name, entry] of Object.entries(entries)) {
    const resolved = await resolveShader({ entry, validate: false });
    out[name] = prepareShader(resolved.wgsl);
  }
  return out;
}

test("vgpu mock：色散光束（凸多边形 + 上游 bloom）可构建、渲染、缩放并读回", async () => {
  const { init, target, draw, effect, frame, sampler } = await import("vgpu/mock");
  const shaders = await loadBeamShaders();
  const { buildLightMesh, lightMeshLayout, LIGHT_VERTEX_STRIDE } = await import(
    "../tools/extrude3d/prism/scene/light-mesh.js"
  );
  const { beamSceneUniforms, lampForPolygon } = await import("../tools/extrude3d/prism/scene/beam-scene.js");
  const { LIGHT_PLANE_Z, LIGHT_WALL_HALF_EXTENT, PRISM_DISPERSION, PRISM_LIGHT_FADE, PRISM_POSTPROCESS } =
    await import("../tools/extrude3d/prism/types.js");

  const gpu = await init();
  try {
    const size = [64, 48];
    const polygon = [
      [2, 0],
      [1, 1.732],
      [-1, 1.732],
      [-2, 0],
      [-1, -1.732],
      [1, -1.732]
    ];
    const layout = lightMeshLayout();
    const light3d = lampForPolygon(polygon, { angle: 0, position: 0, halfWidthRatio: 0.05 });
    const built = buildLightMesh({
      polygon,
      light: light3d,
      dispersion: PRISM_DISPERSION,
      wallHalfExtent: LIGHT_WALL_HALF_EXTENT,
      samples: layout.samples,
      beamSlices: layout.beamSlices,
      edgeFalloff: PRISM_LIGHT_FADE.edgeFalloff
    });
    assert.equal(built.stats.validBands, layout.samples);

    // 与生产 beam.js 相同的原生顶点布局：动态属性只有 position.xy 与 intensity。
    const lightBuffer = gpu.device.createBuffer({
      size: layout.vertexCount * LIGHT_VERTEX_STRIDE,
      usage: ["vertex", "copy_dst"],
      label: "test.beam-vertices"
    });
    lightBuffer.write(built.vertices);
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
    const light = draw(gpu, { shader: shaders.light, geometry: lightGeometry, blend: "additive", cull: "none", depth: false });
    const extract = effect(gpu, shaders.bloomExtract);
    const blurPaired = effect(gpu, shaders.bloomBlurPaired);
    const blurRaw = effect(gpu, shaders.bloomBlur);
    const composite = effect(gpu, shaders.bloomComposite);
    const beamTarget = target(gpu, { size, format: "rgba16float" });
    const levels = [2, 4, 8].map((divisor) => [
      target(gpu, { size: [Math.ceil(size[0] / divisor), Math.ceil(size[1] / divisor)], format: "rgba16float" }),
      target(gpu, { size: [Math.ceil(size[0] / divisor), Math.ceil(size[1] / divisor)], format: "rgba16float" })
    ]);
    const linear = sampler(gpu, { minFilter: "linear", magFilter: "linear" });

    const vp = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -3, 1]);
    const scene = beamSceneUniforms({
      layout,
      viewProjection: vp,
      light: light3d,
      intensity: 1,
      wallHalfExtent: LIGHT_WALL_HALF_EXTENT,
      planeZ: LIGHT_PLANE_Z,
      fade: PRISM_LIGHT_FADE
    });
    // set() 必须覆盖 scene.wgsl 的 Scene 全部字段（缺字段由 vgpu 直接报错）。
    light.set({ scene });
    extract.set({ sourceTexture: beamTarget, sourceSampler: linear, params: { threshold: PRISM_POSTPROCESS.bloomThreshold } });
    blurPaired.set({
      sourceTexture: levels[0][1],
      sourceSampler: linear,
      params: {
        direction: [1, 0],
        texelSize: [1 / levels[0][0].size[0], 1 / levels[0][0].size[1]],
        kernel: [0.4, 1, 0, 0],
        weights0: [0, 0, 0, 0],
        weights1: [0, 0, 0, 0],
        weights2: [0, 0, 0, 0],
        offsets0: [1, 0, 0, 0],
        offsets1: [0, 0, 0, 0],
        offsets2: [0, 0, 0, 0]
      }
    });
    blurRaw.set({
      sourceTexture: levels[0][0],
      sourceSampler: linear,
      params: {
        direction: [1, 0],
        texelSize: [1 / levels[1][0].size[0], 1 / levels[1][0].size[1]],
        tapCount: 1,
        coefficients0: [1, 0, 0, 0],
        coefficients1: [0, 0, 0, 0],
        coefficients2: [0, 0, 0, 0],
        coefficients3: [0, 0, 0, 0],
        coefficients4: [0, 0, 0, 0],
        coefficients5: [0, 0, 0, 0]
      }
    });
    composite.set({
      level0Texture: levels[0][1],
      level1Texture: levels[1][1],
      level2Texture: levels[2][1],
      levelSampler: linear,
      params: { radius: 0, factors: [1, 0.8, 0.55, 0] }
    });

    await Promise.all([
      light.compile(beamTarget),
      extract.compile(levels[0][1]),
      blurPaired.compile(levels[0][0]),
      blurRaw.compile(levels[1][0]),
      composite.compile(levels[0][0])
    ]);

    const render = () => {
      light.set({ scene });
      frame(gpu, (f) => {
        f.pass({ target: beamTarget, clear: [0, 0, 0, 0] }, (p) => {
          p.draw(light, { firstVertex: 0, vertices: layout.whiteVertices });
          p.draw(light, { firstVertex: layout.internalFirstVertex, vertices: layout.internalVertices });
          p.draw(light, { firstVertex: layout.outgoingFirstVertex, vertices: layout.outgoingVertices });
        });
        f.pass({ target: levels[0][1], clear: [0, 0, 0, 1] }, (p) => p.draw(extract));
        levels.forEach((pair, level) => {
          f.pass({ target: pair[0], clear: [0, 0, 0, 1] }, (p) => p.draw(level === 0 ? blurPaired : blurRaw));
          f.pass({ target: pair[1], clear: [0, 0, 0, 1] }, (p) => p.draw(level === 0 ? blurPaired : blurRaw));
        });
        f.pass({ target: levels[0][0], clear: [0, 0, 0, 1] }, (p) => p.draw(composite));
      });
    };

    render();
    // rgba16float 目标读回的是半浮点原始字节（每通道 2 字节）。
    const pixels = await beamTarget.color.read({ mipLevel: 0, region: "all" });
    assert.equal(pixels.length, size[0] * size[1] * 4 * 2);
    // mock 设备不真实光栅化（只校验 API 用法与结构），像素级判定由浏览器冒烟负责。

    // 导出倍率路径：目标尺寸变化后仍需可渲染。
    const big = [96, 72];
    beamTarget.resize(big);
    levels.forEach((pair, level) => {
      const divisor = [2, 4, 8][level];
      const levelSize = [Math.ceil(big[0] / divisor), Math.ceil(big[1] / divisor)];
      pair[0].resize(levelSize);
      pair[1].resize(levelSize);
    });
    render();
    const scaled = await beamTarget.color.read({ mipLevel: 0, region: "all" });
    assert.equal(scaled.length, big[0] * big[1] * 4 * 2);
    lightBuffer.destroy();
  } finally {
    gpu.dispose();
  }
});

test("vgpu mock：自定义网格 + 不透明 / 玻璃多趟管线可构建、渲染并读回", async () => {
  const { init, target, draw, effect, frame, sampler, texture, geometry } = await import("vgpu/mock");
  const shaders = await loadShaders();

  const gpu = await init();
  try {
    const size = [64, 48];
    const sceneTarget = target(gpu, { size, format: "rgba16float", depth: true });
    const backgroundTarget = target(gpu, { size, format: "rgba16float" });
    // 与生产一致：backTarget 双颜色附件（RGB 世界坐标 + RGB 世界法线）。
    const backTarget = target(gpu, { size, format: "rgba16float", depth: true, colors: [{ format: "rgba16float" }, { format: "rgba16float" }] });
    const exportTarget = target(gpu, { size, format: "rgba8unorm" });
    const linear = sampler(gpu, { minFilter: "linear", magFilter: "linear" });
    const nearest = sampler(gpu, { minFilter: "nearest", magFilter: "nearest" });
    const fallback = texture(gpu, {
      kind: "2d",
      size: [1, 1],
      format: "rgba8unorm",
      usage: ["texture_binding", "copy_dst", "render_attachment"]
    });

    // 与 render-vgpu.js 相同的 stride 32 交错布局。
    const verts = new Float32Array([
      0, 0, 0, 0, 0, 1, 0, 0,
      1, 0, 0, 0, 0, 1, 1, 0,
      0, 1, 0, 0, 0, 1, 0, 1,
      0, 0, 1, 0, 0, 1, 0.5, 0.5
    ]);
    const mesh = geometry(gpu, {
      buffers: [
        {
          data: verts,
          stride: 32,
          attributes: {
            position: { format: "float32x3", offset: 0 },
            normal: { format: "float32x3", offset: 12 },
            uv: { format: "float32x2", offset: 24 }
          }
        }
      ],
      indices: new Uint32Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3])
    });

    const pbrDraw = draw(gpu, { shader: shaders.pbr, geometry: mesh, cull: "back" });
    const glassBackDraw = draw(gpu, { shader: shaders["glass-back"], geometry: mesh, cull: "front" });
    const glassBackInfoDraw = draw(gpu, { shader: shaders["glass-back-info"], geometry: mesh, cull: "front", colors: [null, null] });
    const glassDraw = draw(gpu, { shader: shaders.glass, geometry: mesh, cull: "back" });
    // background.wgsl 只有 fs_main，必须走 effect() 的内置全屏顶点通道（不能再用 draw()）。
    const backgroundEffect = effect(gpu, shaders.background, {
      set: { bg_tex: fallback, bg_samp: linear }
    });
    const presentEffect = effect(gpu, shaders.present, {
      set: {
        color_tex: sceneTarget,
        color_samp: linear,
        bg_tex: backgroundTarget,
        bg_samp: linear,
        // 光束关闭时绑定黑色 1×1 贴图（这里复用同一张 fallback，编译期不校验内容）。
        beam_tex: fallback,
        bloom_tex: fallback
      }
    });

    const vp = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -3, 1]);
    const cameraPosition = [0, 0, 3];
    const glassUniforms = (resolution) => ({
      camera: { view_projection: vp, camera_position: cameraPosition, resolution },
      glass: {
        base_color: [1, 1, 1],
        ior: 1.5,
        roughness: 0.1,
        thickness_scale: 1,
        dispersion: 0.09,
        chroma: 1,
        refraction: 1,
        fallback_thickness: 0.4,
        absorption: [0.1, 0.05, 0.05],
        env_intensity: 1,
        key_intensity: 1,
        key_direction: [0.5, 0.7, 0.5],
        key_color: [1, 1, 1]
      },
      scene_tex: backgroundTarget,
      scene_samp: linear,
      back_tex: backTarget,
      back_samp: nearest,
      back_normal_tex: backTarget.colors[1],
      back_normal_samp: nearest
    });
    // 背面通道与生产代码一致：camera 多一个 camera_position，glass 只取背面着色需要的字段。
    const glassBackUniforms = () => ({
      camera: { view_projection: vp, camera_position: cameraPosition },
      glass: {
        base_color: [1, 1, 1],
        ior: 1.5,
        absorption: [0.1, 0.05, 0.05],
        env_intensity: 1,
        key_intensity: 1,
        key_direction: [0.5, 0.7, 0.5],
        key_color: [1, 1, 1],
        transparent: 0
      }
    });
    const refreshBindings = () => {
      backgroundEffect.set({
        background: { color: [1, 1, 1], mode: 2, repeat: [1, 1], offset: [0, 0], transparent: 0 },
        bg_tex: fallback,
        bg_samp: linear
      });
      presentEffect.set({
        present: { exposure: 1, bloom_strength: 0 },
        color_tex: sceneTarget,
        color_samp: linear,
        bg_tex: backgroundTarget,
        bg_samp: linear
      });
      pbrDraw.set({
        camera: { view_projection: vp, camera_position: cameraPosition },
        material: {
          base_color: [0.8, 0.5, 0.2],
          metallic: 0,
          roughness: 0.4,
          key_intensity: 1,
          env_intensity: 1,
          key_direction: [0.5, 0.7, 0.5],
          key_color: [1, 1, 1]
        }
      });
      glassBackDraw.set(glassBackUniforms());
      glassBackInfoDraw.set({ camera: { view_projection: vp, camera_position: cameraPosition } });
    };
    refreshBindings();

    // 与生产一致的预编译顺序：background 的 uniform 与各 draw 的 uniform 在首帧前才 set，
    // compile() 只预热管线，不应要求所有绑定已经 set（真正缺绑定在 encode 时才报错）。
    await backgroundEffect.compile(backgroundTarget);
    await Promise.all([
      presentEffect.compile(exportTarget),
      pbrDraw.compile(sceneTarget),
      glassDraw.compile(sceneTarget),
      glassBackDraw.compile(backTarget),
      glassBackInfoDraw.compile(backTarget)
    ]);

    const render = (glass, resolution) => {
      if (glass) glassDraw.set(glassUniforms(resolution));
      frame(gpu, (f) => {
        // 背景只写不带深度的 backgroundTarget；模型单独写带深度的 sceneTarget；
        // present 再把模型合成到背景之上（与 render-vgpu.js 的接线一致）。
        f.pass({ target: backgroundTarget, clear: [0, 0, 0, 0] }, (p) => p.draw(backgroundEffect));
        if (glass) {
          // 背面信息预通道（世界坐标 + 法线，双附件）供正面玻璃做第二次折射。
          f.pass({ target: backTarget, clear: [0, 0, 0, 0], clearDepth: 1 }, (p) => p.draw(glassBackInfoDraw));
        }
        f.pass({ target: sceneTarget, clear: [0, 0, 0, 0], clearDepth: 1 }, (p) => {
          if (glass) {
            // 玻璃：先背面（写后表面 + 深度）再正面，两个界面都进入最终合成。
            p.draw(glassBackDraw);
            p.draw(glassDraw);
          } else {
            p.draw(pbrDraw);
          }
        });
        f.pass(exportTarget, presentEffect);
      });
    };

    render(false, [...size]);
    const opaque = await exportTarget.color.read({ mipLevel: 0, region: "all" });
    assert.equal(opaque.length, size[0] * size[1] * 4);

    render(true, [...size]);
    const glass = await exportTarget.color.read({ mipLevel: 0, region: "all" });
    assert.equal(glass.length, size[0] * size[1] * 4);

    // 导出路径：放大所有 target、重设分辨率相关 uniform、重新渲染与读回。
    const big = [96, 72];
    sceneTarget.resize(big);
    backgroundTarget.resize(big);
    backTarget.resize(big);
    exportTarget.resize(big);
    refreshBindings();
    render(true, [...big]);
    const scaled = await exportTarget.color.read({ mipLevel: 0, region: "all" });
    assert.equal(scaled.length, big[0] * big[1] * 4);
  } finally {
    gpu.dispose();
  }
});
