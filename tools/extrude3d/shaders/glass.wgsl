// 通用闭合网格的透射正面通道（最小通用方案，Double Refraction）。
//
// 结构参考 vercel-labs/vgpu 官方 MIT 仓库 `apps/docs/examples/transmission/glass.wgsl`
// （commit 81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5；Fresnel、色散谱权重、粗糙度锥形
// 采样、吸收、两次折射）与同仓 prism-background 的前 / 后界面拆分，把官方写死立方体的
// `trace_cube_exit` 换成「背面预通道 + 当前正面片元」：
//   1. `glass-back-info.wgsl` 把最近背面片元的世界坐标写进 back_tex（alpha=1 命中）、
//      世界法线写进 back_normal_tex；
//   2. `glass-back.wgsl` 把同一背面的界面反射以 premultiplied 形式写进 backShadeTarget
//      （rgb = 反射 × Fresnel，a = Fresnel），与官方 prism 背面层语义一致；
//   3. 正面片元先做空气→玻璃的第一次折射；
//   4. 命中背面时，用背面世界坐标 + 法线做一次射线-平面求交得到出射点（等价于官方的
//      平面追踪思路），再用背面法线做玻璃→空气的第二次折射，出射方向只用于把采样点
//      挪到背面外侧；未命中时退回「沿内部方向 × 厚度」的旧屏幕空间近似；
//   5. 背面（内侧）界面反射用「玻璃内部入射方向 + 背面法线」的真实反射方向重新求一次
//      （与正面视线反射不同），权重用该界面的 Fresnel；未命中背面时退回预通道结果。
//      再按 `back.rgb + 背板 × (1 - back.a)` 合成，这就是「背面贡献进入正面透射」的位置。
//      正面只把最终颜色写进 sceneTarget（alpha=1），不再让背面片元单独写在场景里被覆盖。
//
// 透射的背板辐亮度：官方 Transmission 把预渲染场景直接当作透射辐亮度。本工具的「纯色 /
// 棚拍 / 图片」背景是合成用背板，只有**纯色**背板按「被棚拍环境照亮的朗伯反照率」处理，
// 于是透射 = 背板颜色 × 内部折射方向的棚拍环境辐亮度（`pure_backdrop = 1`）。默认纯白
// 背景因此能透过玻璃看到棚拍环境的前后界面对比（不再是一层被白色淹没的淡灰实心壳）。
// 棚拍 / 图片背景已经是渲染好的辐亮度，直接保留原始值（`pure_backdrop = 0`），不再乘
// 环境调制——否则图片会被整体压暗，色散位移也会被调制放大成不真实的通道差。黑色背景
// （含色散光束验收：黑底玻璃自身不得产生彩色像素）无论哪种模式都保持逐像素一致。
// 法线约定：预通道写入的背面法线已朝向相机（玻璃内侧 = 玻璃→空气界面的入射侧），
// 因此第二次折射直接传 `exit_normal`；官方 `refract(inside, -exit.normal, ...)` 里的
// `exit.normal` 是背离玻璃的外向法线，两者等价。
// 这是对任意闭合挤出网格的屏幕空间近似（背面法线是最近背面片元，不逐像素追踪折射后
// 的射线交点），不是完整光线追踪；TIR 仍按反射处理。
// 支持明显折射、Fresnel、有限色散与有限 TIR（refract 失败按反射处理）；
// 不承诺任意非流形 / 高度凹陷模型的多次内反射。
//
// 与官方对齐的参数（用于让色散肉眼可见）：
//   - 谱采样数 `TRANSMISSION_SAMPLES = 11`（官方同值，等比金色角分布，无时间噪声）；
//   - `spectral_weight` 用官方 (0.05 / 0.50 / 0.95)、宽度 (0.45 / 0.38 / 0.45)；
//   - `dispersion` 直接作为官方 `dispersion_spread`（谱折射率 `ior ± dispersion / 2`），
//     默认 0.09 与官方 `GLASS.dispersion_spread` 一致，不再额外乘增益。
// 面向设计师的三个参数（界面 0–200%，内部映射后进入本 shader）：
//   - `dispersion`（色散范围）：谱折射率展宽，越大彩边越开；
//   - `chroma`（色彩强度）：只调色度、保亮度；
//   - `refraction`（折射变形）：屏幕空间折射位移的缩放，0 = 普通透明玻璃。

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
  chroma: f32,
  refraction: f32,
  fallback_thickness: f32,
  absorption: vec3f,
  env_intensity: f32,
  key_intensity: f32,
  // 1 = 纯色背板（背板颜色当作被棚拍环境照亮的朗伯反照率，透射再乘环境辐亮度）；
  // 0 = 棚拍 / 图片等已渲染背板（背板本身就是辐亮度，原样进入透射）。
  pure_backdrop: f32,
  key_direction: vec3f,
  key_color: vec3f,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> glass: Glass;
@group(0) @binding(2) var scene_tex: texture_2d<f32>;
@group(0) @binding(3) var scene_samp: sampler;
@group(0) @binding(4) var back_tex: texture_2d<f32>;
@group(0) @binding(5) var back_samp: sampler;
@group(0) @binding(6) var back_normal_tex: texture_2d<f32>;
@group(0) @binding(7) var back_normal_samp: sampler;
// 背面界面（premultiplied 反射，见 glass-back.wgsl）与色散光束（内部透射）。
@group(0) @binding(8) var back_shade_tex: texture_2d<f32>;
@group(0) @binding(9) var back_shade_samp: sampler;
@group(0) @binding(10) var beam_tex: texture_2d<f32>;
@group(0) @binding(11) var beam_samp: sampler;

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
  let back_normal_sample = textureSampleLevel(back_normal_tex, back_normal_samp, screen_uv, 0.0);
  // 光束已经按 CPU 的二维截面光路画好（入射 / 内部折射 / 出射扇形都在自己的平面上），
  // 这里在原始屏幕位置采样它，作为玻璃内部透射的一部分；模型轮廓之外由 present 叠加。
  let beam = max(textureSampleLevel(beam_tex, beam_samp, screen_uv, 0.0).rgb, vec3f(0.0));
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
    // 出射点：优先用背面预通道的位置 / 法线做一次射线-平面求交；未命中
    // （边缘 / 背面超出视口）退回「沿内部方向 × 厚度」的屏幕空间近似。
    var exit_world = in.world_position + inside * thickness;
    if (back_sample.a > 0.5 && back_normal_sample.a > 0.5) {
      let exit_normal = normalize(back_normal_sample.rgb);
      let denominator = dot(inside, exit_normal);
      if (abs(denominator) > 1e-4) {
        let plane_t = dot(back_sample.xyz - in.world_position, exit_normal) / denominator;
        if (plane_t > 0.0) {
          exit_world = in.world_position + inside * plane_t;
        }
      }
      // Double refraction：玻璃→空气的第二折。预通道法线朝向入射侧（玻璃内侧），
      // 与官方 `refract(inside, -exit.normal, ...)` 的外向法线取反等价；出射方向只用于
      // 把采样点挪到背面外侧，TIR（refract 返回零向量）时保留平面交点。
      let outgoing = refract(inside, exit_normal, spectral_ior);
      if (dot(outgoing, outgoing) > 1e-6) {
        exit_world = exit_world + outgoing * 0.02;
      }
    }
    var exit_uv = project_to_uv(camera.view_projection * vec4f(exit_world, 1.0));
    // 「折射变形」只放大屏幕空间里已有的折射位移（0% 即不发生位移 = 普通透明玻璃），
    // 不改模型几何、不改第一次 / 第二次折射的实际方向。
    exit_uv = screen_uv + (exit_uv - screen_uv) * glass.refraction;
    exit_uv = clamp(exit_uv, vec2f(0.0), vec2f(1.0));
    // dispersion = 0 时权重恒为 1 / 1 / 1，11 个样本平均后就是无分色的普通折射。
    let weight = select(vec3f(1.0), spectral_weight(t), glass.dispersion > 0.001);
    // 透过玻璃看到的背板辐亮度：只有纯色背板按「被棚拍环境照亮的朗伯反照率」处理，
    // transmitted = 背板颜色 × 内部折射方向的棚拍环境；棚拍 / 图片背景已是渲染好的
    // 辐亮度，原样保留。背板为黑时两种模式结果都为黑，因此黑色背景 / 色散光束验收与
    // 逐像素背景正确性不受影响。
    let backdrop = textureSampleLevel(scene_tex, scene_samp, exit_uv, 0.0).rgb;
    let env_radiance = studio_env(
      inside,
      glass.key_direction,
      glass.key_color,
      glass.key_intensity,
    ) * glass.env_intensity;
    let environment = select(
      backdrop,
      backdrop * env_radiance,
      glass.pure_backdrop > 0.5,
    ) + beam;

    // 背面（内侧）界面反射：用「玻璃内部入射方向 + 背面法线」求真实反射方向（与正面
    // 视线反射不同），权重用该界面的 Fresnel；未命中背面时退回预通道的界面反射。
    let back_shade = textureSampleLevel(back_shade_tex, back_shade_samp, exit_uv, 0.0);
    var back_reflection = back_shade.rgb;
    var back_transmission = 1.0 - clamp(back_shade.a, 0.0, 1.0);
    if (back_sample.a > 0.5 && back_normal_sample.a > 0.5) {
      let exit_normal = normalize(back_normal_sample.rgb);
      let back_facing = saturate(dot(-inside, exit_normal));
      let back_fresnel = dielectric_fresnel(glass.ior, back_facing);
      back_reflection = studio_env(
        reflect(inside, exit_normal),
        glass.key_direction,
        glass.key_color,
        glass.key_intensity,
      ) * glass.env_intensity * back_fresnel;
      back_transmission = 1.0 - back_fresnel;
    }
    // premultiplied：背面反射 + 背板 × 背面透射，进入正面透射。
    let through = back_reflection + environment * back_transmission;
    spectrum += through * weight;
    total += weight;
  }
  var transmitted = spectrum / max(total, vec3f(1e-4));
  // 「色彩强度」只调色度：取亮度后按比例向彩色插值，亮度基本不变（0% = 灰度，
  // 200% = 双倍色度）；不做整体提亮，避免过曝发白。
  let transmitted_luma = dot(transmitted, vec3f(0.2126, 0.7152, 0.0722));
  transmitted = max(mix(vec3f(transmitted_luma), transmitted, glass.chroma), vec3f(0.0));
  transmitted *= exp(-glass.absorption * thickness);
  transmitted *= glass.base_color;

  let fresnel = dielectric_fresnel(glass.ior, facing);
  return vec4f(mix(transmitted, reflection, fresnel), 1.0);
}
