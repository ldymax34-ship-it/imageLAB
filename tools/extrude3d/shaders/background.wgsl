// 渲染页签的背景全屏效果：纯色 / 棚拍渐变 / 本地图片（居中 cover + 缩放 + 平移）。
// 只做参数映射（uv × repeat + offset），不写自定义背景算法；透明背景输出 alpha=0。
//
// 颜色空间（修复上传图片发白）：上传的 PNG / JPEG / WebP 经 `createImageBitmap` +
// `copyExternalImageToTexture` 进入 `rgba8unorm`，字节是 **sRGB 编码值**；本管线按线性光
// 运算，`present.wgsl` 最后才做 ACES + sRGB 输出。因此这里必须把图片采样结果线性化一次，
// 否则中间调与彩色会被当成线性值二次提亮（典型「发白」）。纯色与棚拍模式是程序化颜色，
// 保持原有线性取值，只让真实图片素材走转换。

import { srgb_to_linear } from "./common.wgsl";

struct Background {
  color: vec3f,
  mode: f32,
  repeat: vec2f,
  offset: vec2f,
  transparent: f32,
};

@group(0) @binding(0) var<uniform> background: Background;
@group(0) @binding(1) var bg_tex: texture_2d<f32>;
@group(0) @binding(2) var bg_samp: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  if (background.transparent > 0.5) {
    return vec4f(0.0);
  }
  if (background.mode < 0.5) {
    return vec4f(background.color, 1.0);
  }
  if (background.mode < 1.5) {
    let y = clamp(uv.y, 0.0, 1.0);
    let top = vec3f(0.30, 0.33, 0.38);
    let bottom = vec3f(0.055, 0.06, 0.075);
    var color = mix(top, bottom, smoothstep(0.28, 0.94, y));
    let centered = uv - vec2f(0.5, 0.62);
    let glow = exp(-dot(centered, centered) * 6.0);
    color += vec3f(0.34, 0.37, 0.43) * glow;
    return vec4f(color, 1.0);
  }
  let sample_uv = uv * background.repeat + background.offset;
  let sampled = textureSample(bg_tex, bg_samp, sample_uv);
  // 图片素材：sRGB 编码 → 线性；alpha 本身已是线性量，保持原样。
  return vec4f(srgb_to_linear(sampled.rgb), sampled.a);
}
