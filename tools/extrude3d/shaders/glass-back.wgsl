// 透射材质的背面（内侧）界面通道：剔除正面（`cull: "front"`），只画朝向相机的后表面，
// 写进独立的 `backShadeTarget`（自带深度，最近背面片元胜出）。正面通道把它与环境一起
// 合成，背面因此成为正面透射里可见的内侧界面，而不是被正面片元覆盖掉的另一层。
//
// 结构与语义对照 vercel-labs/vgpu 官方 MIT 仓库 prism-background 的
// `pipelines/shared/glass/glass-back.wgsl`（commit 81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5；
// 见 THIRD_PARTY.md 与 third-party-licenses/vgpu-LICENSE.txt）：官方背面层只做环境反射，
// 用 **premultiplied** 混合（rgb = 反射 × F，a = F），上一层已画的背景 / 外光保持为透射分量。
// 本文件输出同一语义，由正面通道按 `back.rgb + environment × (1 - back.a)` 的 premultiplied
// 形式合成（命中背面时正面会用内部折射方向重算反射，见文件末尾说明）。
//
// 最小适配范围（不宣称物理精确）：
//   - 法线朝向：`select(-geometric_normal, geometric_normal, dot(geometric_normal, view) > 0.0)`；
//   - 菲涅耳：Schlick，f0 由 ior 给出，与正面 `common.wgsl` 的 `dielectric_fresnel` 同形；
//   - 环境反射：`studio_env(reflect(incident, normal), ...)`。
// 不追踪玻璃→空气的后续路径 / 内部多次反射，也不在这里做吸收：光程由正面通道按预通道
// 估出的真实厚度统一计算。旧版把「相机到背面顶点的距离」当吸收光程，混进了玻璃外的空气段，
// 已删除。
//
// 本通道的入射方向是相机视线（背面片元自己的 `view`），不是玻璃内部的折射方向；正面通道
// 在命中背面时用「内部折射方向 + 预通道背面法线」重算真实的内侧界面反射（权重用该界面的
// Fresnel），因此这里的结果只作为「未命中背面 / 边缘」时的兜底，不再冒充真实背面朝向。

import { studio_env } from "./common.wgsl";

struct BackCamera {
  view_projection: mat4x4f,
  camera_position: vec3f,
};

/** 背面只保留界面反射需要的字段；吸收 / 基色 / 透明开关由正面通道统一负责。 */
struct GlassBack {
  ior: f32,
  env_intensity: f32,
  key_intensity: f32,
  key_direction: vec3f,
  key_color: vec3f,
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

/** 背面界面的 Schlick 菲涅耳反射率（与正面 `dielectric_fresnel` 同一形式）。 */
fn fresnel_scale(ior: f32, facing: f32) -> f32 {
  let f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  return f0 + (1.0 - f0) * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let geometric_normal = normalize(in.world_normal);
  let view = normalize(camera.camera_position - in.world_position);
  let normal = select(-geometric_normal, geometric_normal, dot(geometric_normal, view) > 0.0);
  let incident = -view;
  let facing = clamp(dot(view, normal), 0.0, 1.0);

  let reflection = studio_env(
    reflect(incident, normal),
    glass.key_direction,
    glass.key_color,
    glass.key_intensity,
  ) * glass.env_intensity;

  // premultiplied：rgb 已乘 F、a = F。正面通道用
  // `back.rgb + environment × (1 - back.a)` 还原「反射 + 透射」。
  let fresnel = fresnel_scale(glass.ior, facing);
  return vec4f(reflection * fresnel, fresnel);
}
