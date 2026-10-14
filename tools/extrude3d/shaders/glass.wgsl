// 通用闭合网格的透射正面通道（最小通用方案）。
//
// 结构参考 vercel-labs/vgpu 官方 MIT 示例 `apps/docs/examples/transmission/glass.wgsl`
// （Fresnel、色散谱权重、粗糙度锥形采样、吸收），但把官方写死立方体的 `trace_cube_exit`
// 换成「背面世界坐标预通道 + 当前正面片元」估算厚度与出射点：
//   1. 背面预通道（`glass-back.wgsl`）把最近背面片元的世界坐标写进 back_tex（alpha=1 命中）；
//   2. 正面片元在同一屏幕像素取回背面世界坐标，厚度 = |back - front| × 光学厚度倍数；
//   3. 出射点 = 正面点 + 折射方向 × 厚度，投影回屏幕采样背景（可折射任意闭合挤出体）。
// 背面同一趟还会以 (1 - Fresnel) 的权重写进 sceneTarget，因此最终成像同时有前、后两个界面。
// 支持明显折射、Fresnel、有限色散与有限 TIR（refract 失败按反射处理）；
// 不承诺任意非流形 / 高度凹陷模型的多次内反射。
//
// 与官方对齐的参数（用于让色散肉眼可见）：
//   - 谱采样数 `TRANSMISSION_SAMPLES = 11`（官方同值，等比金色角分布，无时间噪声）；
//   - `spectral_weight` 用官方 (0.05 / 0.50 / 0.95)、宽度 (0.45 / 0.38 / 0.45)；
//   - `dispersion` 直接作为官方 `dispersion_spread`（谱折射率 `ior ± dispersion / 2`），
//     默认 0.09 与官方 `GLASS.dispersion_spread` 一致，不再额外乘增益。

import { saturate, dielectric_fresnel, studio_env } from "./common.wgsl";

const TRANSMISSION_SAMPLES: i32 = 11;
const GOLDEN_ANGLE: f32 = 2.39996323;

struct Camera {
  view_projection: mat4x4f,
  camera_position: vec3f,
  resolution: vec2f,
};

struct Glass {
  base_color: vec3f,
  ior: f32,
  roughness: f32,
  thickness_scale: f32,
  dispersion: f32,
  fallback_thickness: f32,
  absorption: vec3f,
  env_intensity: f32,
  key_intensity: f32,
  key_direction: vec3f,
  key_color: vec3f,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> glass: Glass;
@group(0) @binding(2) var scene_tex: texture_2d<f32>;
@group(0) @binding(3) var scene_samp: sampler;
@group(0) @binding(4) var back_tex: texture_2d<f32>;
@group(0) @binding(5) var back_samp: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world_position: vec3f,
  @location(1) world_normal: vec3f,
  @location(2) uv: vec2f,
};

struct FragIn {
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

fn project_to_uv(clip: vec4f) -> vec2f {
  let ndc = clip.xy / max(clip.w, 1e-4);
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

fn spectral_weight(t: f32) -> vec3f {
  return vec3f(
    exp(-pow((t - 0.05) / 0.45, 2.0)),
    exp(-pow((t - 0.50) / 0.38, 2.0)),
    exp(-pow((t - 0.95) / 0.45, 2.0)),
  );
}

fn cone_direction(direction: vec3f, sample_index: i32, radius: f32, rotation: f32, count: f32) -> vec3f {
  let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(direction.y) > 0.9);
  let tangent = normalize(cross(axis, direction));
  let bitangent = cross(direction, tangent);
  let disk_radius = sqrt((f32(sample_index) + 0.5) / count);
  let angle = f32(sample_index) * GOLDEN_ANGLE + rotation;
  let offset = (cos(angle) * tangent + sin(angle) * bitangent) * disk_radius * radius;
  return normalize(direction + offset);
}

@fragment
fn fs_main(in: FragIn, @builtin(position) frag_coord: vec4f) -> @location(0) vec4f {
  var normal = normalize(in.world_normal);
  let view = normalize(camera.camera_position - in.world_position);
  if (dot(normal, view) < 0.0) {
    normal = -normal;
  }
  let incident = -view;
  let facing = saturate(dot(view, normal));
  let screen_uv = frag_coord.xy / max(camera.resolution, vec2f(1.0));

  let back_sample = textureSampleLevel(back_tex, back_samp, screen_uv, 0.0);
  var thickness = glass.fallback_thickness * glass.thickness_scale;
  if (back_sample.a > 0.5) {
    thickness = max(length(back_sample.xyz - in.world_position), 1e-3) * glass.thickness_scale;
  }

  let reflected = reflect(incident, normal);
  let reflection = studio_env(
    reflected,
    glass.key_direction,
    glass.key_color,
    glass.key_intensity,
  ) * glass.env_intensity;

  let rotation = fract(sin(dot(floor(frag_coord.xy), vec2f(12.9898, 78.233))) * 43758.5453) *
    6.28318531;
  let sample_count = TRANSMISSION_SAMPLES;
  let cone_radius = glass.roughness * glass.roughness * 0.35;
  var spectrum = vec3f(0.0);
  var total = vec3f(0.0);
  for (var i = 0; i < sample_count; i = i + 1) {
    let t = (f32(i) + 0.5) / f32(sample_count);
    let spectral_ior = max(1.0, glass.ior + (t - 0.5) * glass.dispersion);
    let eta = 1.0 / spectral_ior;
    var inside = refract(incident, normal, eta);
    if (dot(inside, inside) < 1e-6) {
      inside = reflect(incident, normal);
    }
    inside = cone_direction(inside, i, cone_radius, rotation, f32(sample_count));
    let exit_world = in.world_position + inside * thickness;
    let exit_uv = clamp(
      project_to_uv(camera.view_projection * vec4f(exit_world, 1.0)),
      vec2f(0.0),
      vec2f(1.0),
    );
    // dispersion = 0 时权重恒为 1 / 1 / 1，11 个样本平均后就是无分色的普通折射。
    let weight = select(vec3f(1.0), spectral_weight(t), glass.dispersion > 0.001);
    spectrum += textureSampleLevel(scene_tex, scene_samp, exit_uv, 0.0).rgb * weight;
    total += weight;
  }
  var transmitted = spectrum / max(total, vec3f(1e-4));
  transmitted *= exp(-glass.absorption * thickness);
  transmitted *= glass.base_color;

  let fresnel = dielectric_fresnel(glass.ior, facing);
  return vec4f(mix(transmitted, reflection, fresnel), 1.0);
}
