// 透射材质的两用背面通道：剔除正面（`cull: "front"`），一次绘制同时产出
//   1. `backTarget`：背面片元世界坐标写进 RGB；正面通道按同一屏幕像素读回 `back_tex.a > 0.5`
//      作为命中标记，估算厚度与出射点；
//   2. `sceneTarget`：同一片元按背面着色写进场景，成为最终成像里可见的后表面 / 内部界面
//      （不透明材质不走这一趟）。
//
// 之前只有第 1 项：`backTarget` 是辅助纹理，最终画面只剩正面透射通道，闭合模型看上去是
// 只有前表面的空心壳、看不到背面。现在把同一趟背面片元也写进 `sceneTarget`，正面玻璃
// 再以官方 `transmission/glass.wgsl` 的 Fresnel 权重叠上去，前后两个界面都能辨认。
//
// 与官方示例对齐（vercel-labs/vgpu 0.6.0，MIT，见 third-party-licenses/vgpu-LICENSE.txt）：
//   - 法线朝向：`select(-geometric_normal, geometric_normal, dot(geometric_normal, view) > 0.0)`；
//   - 菲涅耳：背面用 Schlick 近似（见 `fresnel_scale`），正面用 `common.wgsl` 的 `dielectric_fresnel`；
//   - 环境反射：`studio_env(reflect(incident, normal), ...)`。
// 不引入 raymarch / SDF、第二个渲染引擎或新依赖。alpha 记录 (1 - Fresnel)，让正面透射在
// 正对相机的区域为主、掠射区域由反射接管，和官方 `mix(transmitted, reflection, fresnel)`
// 的能量关系一致。

import { studio_env } from "./common.wgsl";

struct BackCamera {
  view_projection: mat4x4f,
  camera_position: vec3f,
};

struct GlassBack {
  base_color: vec3f,
  ior: f32,
  absorption: vec3f,
  env_intensity: f32,
  key_intensity: f32,
  key_direction: vec3f,
  key_color: vec3f,
  transparent: f32,
};

@group(0) @binding(0) var<uniform> camera: BackCamera;
@group(0) @binding(1) var<uniform> glass: GlassBack;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world_position: vec3f,
  @location(1) world_normal: vec3f,
  @location(2) uv: vec2f,
};

@vertex
fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
) -> VertexOut {
  var out: VertexOut;
  out.position = camera.view_projection * vec4f(position, 1.0);
  out.world_position = position;
  out.world_normal = normal;
  out.uv = uv;
  return out;
}

// 背面界面的 Schlick 近似菲涅耳（掠射更强）。正面通道仍用 `dielectric_fresnel(ior, facing)`
// 这条更完整的官方公式；背面只承担「后表面 / 内部界面」的可见度与合成权重，用同形近似即可，
// 两种写法在 ior 1.5 附近的差异远小于可感知范围。
fn fresnel_scale(facing: f32) -> f32 {
  return 0.04 + 0.96 * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let geometric_normal = normalize(in.world_normal);
  let view = normalize(camera.camera_position - in.world_position);
  let normal = select(-geometric_normal, geometric_normal, dot(geometric_normal, view) > 0.0);
  let incident = -view;
  let facing = clamp(dot(view, normal), 0.0, 1.0);

  // 出射方向的环境辐射（反射锥 + 漫反射平均，取自 common.wgsl 的解析棚拍环境）。
  let reflected = reflect(incident, normal);
  let reflection = studio_env(
    reflected,
    glass.key_direction,
    glass.key_color,
    glass.key_intensity,
  );
  let average = studio_env(
    normal,
    glass.key_direction,
    glass.key_color,
    glass.key_intensity,
  ) * 0.35 + vec3f(0.22, 0.24, 0.28) * 0.65;
  let radiance = (reflection * fresnel_scale(facing) + average * 0.35) * glass.env_intensity;

  // 视线穿过闭合体的内部光程：只做吸收 / 色调，不做第二次折射（出射仍由正面通道负责）。
  let path = max(length(camera.camera_position - in.world_position), 0.0);
  let color = radiance * exp(-glass.absorption * path) * glass.base_color;

  // 一次输出同时满足两处读取：
  //   - backTarget：alpha = 1 是「命中标记」，正面通道用 .rgb 拿背面世界坐标估厚度，不读 alpha 之外的语义；
  //   - sceneTarget：alpha = (1 - Fresnel) 作为背景 / 正面玻璃之下的合成权重，正面透射在正对相机处为主、
  //     掠射处交给反射，和官方 `mix(transmitted, reflection, fresnel)` 的能量关系一致。
  //     透明背景模式整体清零，导出 PNG 不出现依赖背景的后表面。
  return vec4f(color, (1.0 - fresnel_scale(facing)) * (1.0 - clamp(glass.transparent, 0.0, 1.0)));
}
