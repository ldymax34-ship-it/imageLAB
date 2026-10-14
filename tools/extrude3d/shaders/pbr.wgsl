// 不透明材质：单方向主光 + 程序化棚拍环境的金属度 PBR。
//
// 直接光照的 Cook-Torrance GGX 结构来自 vercel-labs/vgpu 官方 MIT 示例
// `apps/docs/examples/glass-fractal/hero-fractal-ceramic.wgsl`；这里只做最小参数映射：
// 增加 metallic（金属度）与程序化棚拍环境反射，供「塑料 / 陶瓷 / 金属 / 镀铬」预设共用。
// 网格顶点已是世界坐标（建模页签交接时已烘焙归一化与旋转），因此没有 model 矩阵。

import {
  PI,
  saturate,
  distribution_ggx,
  geometry_smith,
  fresnel_schlick,
  studio_env,
} from "./common.wgsl";

struct Camera {
  view_projection: mat4x4f,
  camera_position: vec3f,
};

struct Material {
  base_color: vec3f,
  metallic: f32,
  roughness: f32,
  key_intensity: f32,
  env_intensity: f32,
  key_direction: vec3f,
  key_color: vec3f,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> material: Material;

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

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let normal = normalize(in.world_normal);
  let view = normalize(camera.camera_position - in.world_position);
  let light = normalize(material.key_direction);
  let halfway = normalize(view + light);
  let n_dot_l = saturate(dot(normal, light));
  let n_dot_v = saturate(dot(normal, view));
  let roughness = clamp(material.roughness, 0.045, 1.0);
  let f0 = mix(vec3f(0.04), material.base_color, material.metallic);
  let fresnel = fresnel_schlick(saturate(dot(halfway, view)), f0);
  let distribution = distribution_ggx(normal, halfway, roughness);
  let geometry = geometry_smith(normal, view, light, roughness);
  let specular = distribution * geometry * fresnel / max(4.0 * n_dot_v * n_dot_l, 0.0001);
  let diffuse_weight = (vec3f(1.0) - fresnel) * (1.0 - material.metallic);
  let radiance = material.key_color * material.key_intensity;
  let direct = (diffuse_weight * material.base_color / PI + specular) * radiance * n_dot_l;

  let reflected = reflect(-view, normal);
  let sharp = studio_env(
    reflected,
    material.key_direction,
    material.key_color,
    material.key_intensity,
  );
  let average = studio_env(
    normal,
    material.key_direction,
    material.key_color,
    material.key_intensity,
  ) * 0.35 + vec3f(0.22, 0.24, 0.28) * 0.65;
  let environment = mix(sharp, average, roughness * roughness) * material.env_intensity;
  let environment_fresnel = fresnel_schlick(n_dot_v, f0);
  let ambient = material.base_color * (1.0 - material.metallic) * average * 0.5 *
    material.env_intensity;

  let color = direct + ambient + environment * environment_fresnel;
  return vec4f(color, 1.0);
}
