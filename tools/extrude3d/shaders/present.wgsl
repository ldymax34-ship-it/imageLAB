// 渲染页签的最终合成：把模型（color_tex / sceneTarget）合成到背景（bg_tex / backgroundTarget）之上，
// 再做线性 HDR → 曝光 → ACES → sRGB，并保留 alpha。
//
// 为什么在这里合成而不是把背景画进带深度的 sceneTarget：背景是 fragment-only 的 effect()，
// vgpu 官方内置全屏顶点输出 z=0；若写进 sceneTarget 的深度，会把之后绘制的模型挡在深度测试外。
// 因此背景单独渲染到不带深度的 backgroundTarget（同时作为玻璃折射环境），present 再按
// 「模型 over 背景」合成。sceneTarget 中模型片元是直通线性色、alpha=1；清屏处 alpha=0。
//
// 输出预乘 alpha（与 WebGPU canvas 的 premultiplied 约定一致）；
// 导出 PNG 时在 JS 侧反预乘回直通 alpha。

import { tonemap_aces, linear_to_srgb } from "./common.wgsl";

struct Present {
  exposure: f32,
};

@group(0) @binding(0) var<uniform> present: Present;
@group(0) @binding(1) var color_tex: texture_2d<f32>;
@group(0) @binding(2) var color_samp: sampler;
@group(0) @binding(3) var bg_tex: texture_2d<f32>;
@group(0) @binding(4) var bg_samp: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let scene = textureSampleLevel(color_tex, color_samp, uv, 0.0);
  let bg = textureSampleLevel(bg_tex, bg_samp, uv, 0.0);

  let scene_alpha = clamp(scene.a, 0.0, 1.0);
  let bg_alpha = clamp(bg.a, 0.0, 1.0);
  // 背景以直通 alpha 输出，「模型 over 背景」得到预乘结果与合成 alpha。
  let premultiplied = scene.rgb + bg.rgb * bg_alpha * (1.0 - scene_alpha);
  let alpha = clamp(scene_alpha + bg_alpha * (1.0 - scene_alpha), 0.0, 1.0);
  let straight = premultiplied / max(alpha, 0.0001);
  let mapped = linear_to_srgb(tonemap_aces(straight * present.exposure));
  return vec4f(mapped * alpha, alpha);
}
