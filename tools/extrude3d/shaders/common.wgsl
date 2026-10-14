// 渲染页签共享 WGSL 小工具。
//
// 来源与许可：Cook-Torrance GGX / Fresnel / ACES / sRGB 函数改写自 vercel-labs/vgpu
// 官方示例 `apps/docs/examples/glass-fractal/hero-fractal-ceramic.wgsl` 与
// `apps/docs/examples/transmission/env-common.wgsl`（MIT，见 third-party-licenses/vgpu-LICENSE.txt）。
// 本工具只做参数映射与最小接线，不新增大型材质系统。

export const PI: f32 = 3.14159265359;

export fn saturate(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

export fn distribution_ggx(normal: vec3f, halfway: vec3f, roughness: f32) -> f32 {
  let alpha = roughness * roughness;
  let alpha2 = alpha * alpha;
  let n_dot_h = saturate(dot(normal, halfway));
  let denominator = n_dot_h * n_dot_h * (alpha2 - 1.0) + 1.0;
  return alpha2 / max(PI * denominator * denominator, 0.00001);
}

export fn geometry_schlick_ggx(n_dot_direction: f32, roughness: f32) -> f32 {
  let radius = roughness + 1.0;
  let k = radius * radius / 8.0;
  return n_dot_direction / max(n_dot_direction * (1.0 - k) + k, 0.00001);
}

export fn geometry_smith(normal: vec3f, view: vec3f, light: vec3f, roughness: f32) -> f32 {
  return geometry_schlick_ggx(saturate(dot(normal, view)), roughness) *
    geometry_schlick_ggx(saturate(dot(normal, light)), roughness);
}

export fn fresnel_schlick(cosine: f32, f0: vec3f) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(1.0 - saturate(cosine), 5.0);
}

/** 电介质（空气→玻璃）单界面的 Schlick 近似，供透射材质算菲涅耳反射量。 */
export fn dielectric_fresnel(ior: f32, facing: f32) -> f32 {
  let f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  return f0 + (1.0 - f0) * pow(1.0 - facing, 5.0);
}

/**
 * 程序化棚拍环境（解析式，不加载 HDRI / 不联网、不打包贴图素材）：
 * 上亮下暗的中性墙面 + 一盏暖主光柔光箱 + 一盏冷补光柔光箱。
 * 在 PBR 里用作环境反射与漫反射环境项，在玻璃里用作反射项。
 */
export fn studio_env(
  direction: vec3f,
  key_direction: vec3f,
  key_color: vec3f,
  key_intensity: f32,
) -> vec3f {
  let d = normalize(direction);
  let up = saturate(d.y * 0.5 + 0.5);
  var color = mix(
    vec3f(0.085, 0.092, 0.11),
    vec3f(0.66, 0.70, 0.78),
    smoothstep(0.30, 1.0, up),
  );
  let key = pow(saturate(dot(d, normalize(key_direction))), 22.0);
  color += key_color * key * (2.2 * max(key_intensity, 0.0));
  let fill_direction = normalize(vec3f(-key_direction.x, 0.42, -key_direction.z));
  let fill = pow(saturate(dot(d, fill_direction)), 16.0);
  color += vec3f(0.42, 0.50, 0.68) * fill * 0.85;
  return color;
}

export fn tonemap_aces(color: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  let x = max(color, vec3f(0.0));
  return clamp(
    (x * (a * x + vec3f(b))) / (x * (c * x + vec3f(d)) + vec3f(e)),
    vec3f(0.0),
    vec3f(1.0),
  );
}

export fn linear_to_srgb(color: vec3f) -> vec3f {
  let x = max(color, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

/**
 * sRGB 编码值 → 线性值（IEC 61966-2-1，`linear_to_srgb` 的逆函数）。
 *
 * 用途：本地 PNG / JPEG / WebP 解码后由 `copyExternalImageToTexture` 写进 `rgba8unorm`
 * 的字节就是 sRGB 编码值；本工具整条 vgpu 管线按线性光运算，最后由 `present.wgsl` 统一做
 * ACES + `linear_to_srgb` 输出。不先线性化会让中间调与彩色明显发白。
 * 这里只做颜色空间转换，不改任何背景 / 材质算法。
 */
export fn srgb_to_linear(color: vec3f) -> vec3f {
  let c = clamp(color, vec3f(0.0), vec3f(1.0));
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}
