/**
 * SVG 转 3D · 颜色空间纯 Node 自检（不启动浏览器、不加载 three 渲染器）
 *
 * 背景上传图片「发白」的根因是颜色空间：`createImageBitmap` + `copyExternalImageToTexture`
 * 进入 `rgba8unorm` 的字节是 sRGB 编码值，而整条 vgpu 管线按线性光运算、由 `present.wgsl`
 * 统一做 ACES + `linear_to_srgb` 输出。本文件把 `common.wgsl` 的 `srgb_to_linear` 数学
 * 在 Node 里逐位复现，并与
 *   (a) IEC 61966-2-1 参考值，
 *   (b) three 0.186.1 的 `new THREE.Color("#rrggbb").toArray()`（ColorManagement 的
 *       SRGBToLinear，同样用 0.04045 / 12.92 / 1.055 / 0.055 常数）
 * 对照，锁住「图片线性化」与「纯色 / 材质基色线性化」用同一条转换。
 *
 * 浏览器像素 / 观感仍必须由 Codex 用真实 Chrome WebGPU 验收，本文件只验证数学一致。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

/** common.wgsl `srgb_to_linear` 的逐元素复现（WGSL select(hi, lo, c <= 0.04045)）。 */
function srgbToLinearChannel(c) {
  const clamped = Math.min(1, Math.max(0, c));
  const lo = clamped / 12.92;
  const hi = Math.pow((clamped + 0.055) / 1.055, 2.4);
  return clamped <= 0.04045 ? lo : hi;
}

test("srgb_to_linear 与 IEC 61966-2-1 参考值一致（端点 / 线性段 / 幂段）", () => {
  assert.equal(srgbToLinearChannel(0), 0);
  assert.equal(srgbToLinearChannel(1), 1);
  // 线性段端点：0.04045 → 0.04045 / 12.92 = 0.0031308…
  assert.ok(Math.abs(srgbToLinearChannel(0.04045) - 0.0031308) < 1e-6, String(srgbToLinearChannel(0.04045)));
  // 8bit 参考值：128/255 ≈ 0.502 → 0.2159（不是 0.502，这是「发白」的核心）。
  const mid = srgbToLinearChannel(128 / 255);
  assert.ok(Math.abs(mid - 0.215861) < 1e-5, `128/255 → ${mid}`);
  // 64/255（暗部）与 192/255（亮部）也逐项对照。
  assert.ok(Math.abs(srgbToLinearChannel(64 / 255) - 0.051269) < 1e-5, String(srgbToLinearChannel(64 / 255)));
  assert.ok(Math.abs(srgbToLinearChannel(192 / 255) - 0.527115) < 1e-5, String(srgbToLinearChannel(192 / 255)));
  // 转换必须单调递增。
  let previous = -1;
  for (let i = 0; i <= 255; i += 1) {
    const value = srgbToLinearChannel(i / 255);
    assert.ok(value > previous, `i=${i} 非单调`);
    previous = value;
  }
});

test("common.wgsl 的 sRGB 常数与 three 0.186.1 的 SRGBToLinear 常数同源", async () => {
  const common = read("tools/extrude3d/shaders/common.wgsl");
  // 两段式常数：线性段 12.92 / 0.04045，幂段 1.055 / 0.055 / 2.4。
  for (const token of ["12.92", "0.04045", "1.055", "0.055", "2.4"]) {
    assert.ok(common.includes(token), `common.wgsl 缺少 sRGB 常数 ${token}`);
  }
  // three 的 ColorManagement 使用等价形式 c * 0.9478672986 + 0.0521327014（= (c+0.055)/1.055）。
  assert.ok(Math.abs(1 / 1.055 - 0.9478672986) < 1e-9);
  assert.ok(Math.abs(0.055 / 1.055 - 0.0521327014) < 1e-9);

  const THREE = await import("three");
  const samples = ["#000000", "#ffffff", "#808080", "#404040", "#c0c0c0", "#e53935", "#1e88e5"];
  for (const hex of samples) {
    // 与生产 render-vgpu.js 的 srgbToLinear 完全同一调用。
    const threeLinear = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace).toArray();
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const mine = [r, g, b].map(srgbToLinearChannel);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(
        Math.abs(threeLinear[i] - mine[i]) < 1e-6,
        `${hex} 通道 ${i}：three=${threeLinear[i]} wgsl复现=${mine[i]}`
      );
    }
  }
  // 生产代码必须用显式 sRGB 色彩空间，且不得二次转换。
  const renderJs = read("tools/extrude3d/render-vgpu.js");
  assert.match(renderJs, /setStyle\(hex, THREE\.SRGBColorSpace\)/);
  assert.ok(!/\.convertSRGBToLinear\(\)/.test(renderJs), "不应二次调用 convertSRGBToLinear");
});

test("present 只做一次线性 → sRGB 输出，不再叠加第二次转换", () => {
  const present = read("tools/extrude3d/shaders/present.wgsl");
  assert.match(present, /linear_to_srgb\(tonemap_aces\(/);
  // 不应在 present 里再做 sRGB → 线性（输入已经是线性光）。
  assert.ok(!/srgb_to_linear/.test(present), "present.wgsl 不应再线性化一次");
  // 背景图片分支必须线性化，纯色 / 棚拍分支保持程序化取值。
  const background = read("tools/extrude3d/shaders/background.wgsl");
  assert.match(background, /srgb_to_linear\(sampled\.rgb\)/);
  // 线性化只发生在图片模式那一段（mode >= 1.5），纯色 / 棚拍分支不加转换。
  // 只看函数体：文件顶部的 `import { srgb_to_linear }` 不算分支。
  const fsMain = background.slice(background.indexOf("fn fs_main"));
  assert.ok(fsMain.length > 0, "找不到 background fs_main");
  const imageBranch = fsMain.slice(fsMain.indexOf("background.mode < 1.5"));
  assert.ok(imageBranch.includes("srgb_to_linear(sampled.rgb)"), "图片模式分支缺少线性化");
  const solidBranch = fsMain.slice(0, fsMain.indexOf("background.mode < 1.5"));
  assert.ok(!solidBranch.includes("srgb_to_linear"), "纯色分支不应线性化");
});
