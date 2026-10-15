/**
 * SVG 转 3D 双页签 · 纯 Node / 静态自检（不操作浏览器）
 *
 * 覆盖：双页签结构、38 个 Three 材质预设与 Three 最终渲染控件已移除、7 个中文渲染预设、
 * WebGPU 不可用中文提示、建模→渲染网格交接结构、vgpu 精确版本与许可、构建产物不含旧材质库。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync, readdirSync } = require("node:fs");
const { resolve, join } = require("node:path");

const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");
const html = read("tools/extrude3d/index.html");
const mainJs = read("tools/extrude3d/main.js");
const modelingJs = read("tools/extrude3d/modeling.js");
const renderJs = read("tools/extrude3d/render-vgpu.js");
const pkg = JSON.parse(read("package.json"));

test("双页签：建模 / 渲染面板与画布都在同一页", () => {
  for (const id of ["tab-model", "tab-render", "panel-model", "panel-render", "stage-model", "stage-render", "model-canvas", "render-canvas"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html 缺少 #${id}`);
  }
  assert.match(mainJs, /switchTab/);
  assert.match(mainJs, /createModelingTab/);
  assert.match(mainJs, /createRenderTab/);
});

test("旧的 38 个 Three.js 材质预设与最终渲染控件已从 UI / 运行时移除", () => {
  for (const legacyId of ["id=\"material\"", "id=\"texture-file\"", "id=\"env-intensity\"", "id=\"light-intensity\"", "id=\"bg-mode\"", "id=\"glass-ior\""]) {
    assert.ok(!html.includes(legacyId), `index.html 仍残留旧控件 ${legacyId}`);
  }
  for (const source of [mainJs, modelingJs, renderJs]) {
    assert.ok(!/materialPresets|MATERIAL_UI|MATERIAL_LIB|resolveMaterial|getSimpleMaterialProps/.test(source), "仍有上游材质预设引用");
    assert.ok(!/MeshPhysicalMaterial/.test(source), "仍有 Three 物理材质运行分支");
  }
  // 材质预设相关能力不再从渲染模块引用上游材质子包
  assert.ok(!/from\s+["']@visant\/extrude3d\/materials["']/.test(renderJs));
});

test("渲染页签正好 7 个中文材质预设，不恢复 38 个", () => {
  const labels = ["透明玻璃", "磨砂玻璃", "彩色亚克力", "塑料", "陶瓷", "金属", "镀铬"];
  for (const label of labels) assert.ok(renderJs.includes(`label: "${label}"`), `缺少预设 ${label}`);
  const presetEntries = renderJs.match(/\{ id: "[^"]+", label: "[^"]+", kind: "/g) || [];
  assert.equal(presetEntries.length, 7, `材质预设数量应为 7，实际 ${presetEntries.length}`);
  assert.ok(!/diamond|pearl|obsidian|holographic|liquidChrome|soapBubble/.test(renderJs), "不应恢复旧预设");
});

test("WebGPU 不可用时渲染页签给出明确中文提示，建模页签仍可用", () => {
  assert.match(renderJs, /navigator\.gpu/);
  assert.match(renderJs, /不支持 WebGPU/);
  assert.match(renderJs, /建模页签仍可正常使用/);
  assert.ok(html.includes('id="render-hint"'));
  assert.match(mainJs, /render\.activate\(\)/);
  assert.match(mainJs, /render\.deactivate\(\)/);
});

test("建模→渲染网格交接结构为 position / normal / uv / index", () => {
  assert.match(modelingJs, /positions/);
  assert.match(modelingJs, /normals/);
  assert.match(modelingJs, /uvs/);
  assert.match(modelingJs, /indices/);
  assert.match(modelingJs, /onMesh/);
  assert.match(renderJs, /position: \{ format: "float32x3", offset: 0 \}/);
  assert.match(renderJs, /normal: \{ format: "float32x3", offset: 12, location: 1 \}/);
  assert.match(renderJs, /uv: \{ format: "float32x2", offset: 24, location: 2 \}/);
  assert.match(renderJs, /stride: 32/);
  assert.match(mainJs, /render\.setMesh\(snapshot\)|onMesh: \(snapshot\) => render\.setMesh\(snapshot\)/);
});

test("渲染页签使用通用上传网格而不是固定 cube", () => {
  assert.match(renderJs, /geometry\(gpu, \{/);
  assert.match(renderJs, /data: interleaved/);
  // 玻璃走背面世界坐标预通道 + 正面透射，不再有写死立方体的 trace_cube_exit 实现
  assert.ok(!/fn trace_cube_exit/.test(renderJs), "不应再使用写死立方体的官方 trace_cube_exit");
  const glassBack = read("tools/extrude3d/shaders/glass-back.wgsl");
  const glass = read("tools/extrude3d/shaders/glass.wgsl");
  const glassBackInfo = read("tools/extrude3d/shaders/glass-back-info.wgsl");
  assert.match(glassBack, /world_position/);
  assert.match(glass, /back_tex/);
  assert.match(glass, /refract\(/);
  // Double refraction：捕获背面位置 + 世界法线，出射时按背面法线再折一次。
  assert.match(glassBackInfo, /BackInfoOut \{[\s\S]*?@location\(1\) world_normal: vec4f/);
  assert.match(glass, /back_normal_tex/);
  assert.match(glass, /refract\(inside, -exit_normal, spectral_ior\)/);
  // 棱镜是 vgpu 官网三角玻璃的固定几何 / 管线，不套用任意 SVG 网格。
  assert.match(renderJs, /renderPrismFrame/);
  assert.ok(existsSync(resolve(ROOT, "tools/extrude3d/prism/pipeline.js")));
  assert.ok(existsSync(resolve(ROOT, "tools/extrude3d/prism/scene/prism-mesh.js")));
  assert.ok(existsSync(resolve(ROOT, "tools/extrude3d/prism/pipelines/glass/glass.wgsl")));
});

test("背景使用 effect() 内置全屏顶点通道（回归：不得再用 fragment-only draw）", () => {
  const backgroundWgsl = read("tools/extrude3d/shaders/background.wgsl");
  const presentWgsl = read("tools/extrude3d/shaders/present.wgsl");
  // 只做参数映射的 fragment shader，顶点通道必须来自 vgpu effect()，不自写 @vertex
  assert.ok(!/@vertex/.test(backgroundWgsl), "background.wgsl 不应自写顶点 shader");
  assert.ok(!/@vertex/.test(presentWgsl), "present.wgsl 不应自写顶点 shader");
  assert.match(renderJs, /effect\(gpu, backgroundWgsl/);
  assert.ok(
    !/draw\(gpu,\s*\{\s*shader:\s*backgroundWgsl/.test(renderJs),
    "background 不得再用 draw()（会去查找不存在的 vs_main）"
  );
  // present 把模型合成到背景之上：绑定 bg_tex，且 backgroundTarget 不带深度。
  assert.match(presentWgsl, /bg_tex/);
  assert.match(renderJs, /bg_tex: backgroundTarget/);
  assert.ok(
    /backgroundTarget = target\(gpu, \{ size: targetSize, format: "rgba16float" \}\);/.test(renderJs),
    "backgroundTarget 必须是不带深度的颜色目标"
  );
});

test("setMesh 在 GPU 就绪前也保存 meshSummary（真实建模到渲染的状态同步）", () => {
  const match = renderJs.match(/function uploadMesh\(snapshot\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(match, "找不到 uploadMesh 函数");
  const body = match[1];
  const summaryAt = body.indexOf("meshSummary = summarizeMesh(snapshot)");
  const gpuGuardAt = body.indexOf("if (!gpu) return;");
  assert.ok(summaryAt >= 0, "uploadMesh 未保存 meshSummary");
  assert.ok(gpuGuardAt >= 0, "uploadMesh 缺少 GPU 早退分支");
  assert.ok(summaryAt < gpuGuardAt, "meshSummary 必须在 !gpu 早退之前赋值");
});

/* ------------------------------------------------- 背景图片：上传 / 绑定 / 颜色空间 */

test("背景图片上传后绑定到 bg_tex，绝不落回白色 fallback", () => {
  // uploadMesh 之外的第二条状态同步：上传成功必须把新贴图交给 backgroundEffect，
  // 且生产代码里 bg_tex 只能是加载的贴图或 fallback，不能是写死的白色常量。
  assert.match(renderJs, /copyExternalImageToTexture/);
  assert.match(renderJs, /bindBackground\(next, bitmap\)/);
  // 绑定表达式按「取实际贴图，缺省才 fallback」写，不能是写死的 fallbackTexture。
  const binding = renderJs.match(/bg_tex: ([^\n]+)/);
  assert.ok(binding, "找不到 bg_tex 绑定");
  assert.match(binding[1], /^bgTextureGpu \|\| fallbackTexture,?$/);
  // 上传路径本身也要真的把 next 交给 bindBackground。
  assert.match(renderJs, /const previous = bgTextureGpu;\s*\n\s*bindBackground\(next, bitmap\);/);
  // 上传成功后落回 fallback 的写法必须不存在（这是「画面发白」的直接成因之一）。
  assert.ok(
    !/bgTextureGpu = fallbackTexture;[\s\S]{0,160}state\.bgMode = "image"/.test(renderJs),
    "图片模式不得回退到白色 fallback"
  );
  // 移除图片才允许回到 fallback。
  const removeBody = renderJs.match(/function removeBackground\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(removeBody, "找不到 removeBackground 函数");
  assert.match(removeBody[1], /bgTextureGpu = fallbackTexture;/);
});

test("图片素材按 sRGB → 线性采样（回归画面发白 / 颜色被二次提亮）", () => {
  const backgroundWgsl = read("tools/extrude3d/shaders/background.wgsl");
  const commonWgsl = read("tools/extrude3d/shaders/common.wgsl");
  const presentWgsl = read("tools/extrude3d/shaders/present.wgsl");
  // 逆函数存在且是 IEC 61966-2-1 的两段式，不是简单 pow 2.2。
  assert.match(commonWgsl, /export fn srgb_to_linear/);
  assert.match(commonWgsl, /12\.92/);
  assert.match(commonWgsl, /0\.04045/);
  assert.match(commonWgsl, /1\.055/);
  assert.match(commonWgsl, /2\.4/);
  // 图片分支采样后必须线性化；present 仍只做一次线性 → sRGB 输出。
  assert.match(backgroundWgsl, /import \{ srgb_to_linear \}/);
  assert.match(backgroundWgsl, /srgb_to_linear\(sampled\.rgb\)/);
  assert.match(presentWgsl, /linear_to_srgb\(tonemap_aces\(straight \* present\.exposure\)\)/);
  // 纯色 / 材质基色来自颜色选择器的 sRGB 十六进制，必须显式线性化后再进管线。
  assert.match(renderJs, /function srgbToLinear\(hex\)/);
  assert.match(renderJs, /setStyle\(hex, THREE\.SRGBColorSpace\)/);
  // 不允许再叠一次 convertSRGBToLinear（会二次转换，中间灰被压近黑）。
  assert.ok(!/\.convertSRGBToLinear\(\)/.test(renderJs), "不能二次调用 convertSRGBToLinear");
  const baseColorUses = renderJs.match(/base_color: (?:srgbToLinear\(state\.color\)|baseColor)/g) || [];
  assert.ok(baseColorUses.length >= 3, `玻璃正面 / 背面 / PBR 基色都应线性化，实际 ${baseColorUses.length} 处`);
  assert.match(renderJs, /const baseColor = srgbToLinear\(state\.color\);/);
  assert.match(renderJs, /color: srgbToLinear\(state\.bgColor\)/);
});

/* ------------------------------------------------- 纯色背景黑 / 白快速预设 */

test("纯色背景提供黑 / 白两个中文快速预设，默认白色", () => {
  assert.match(html, /id="render-bg-black"[^>]*>黑色</);
  assert.match(html, /id="render-bg-white"[^>]*>白色</);
  assert.match(renderJs, /\{ id: "black", label: "黑色", color: "#000000" \}/);
  assert.match(renderJs, /\{ id: "white", label: "白色", color: "#ffffff" \}/);
  assert.match(renderJs, /bgColor: "#ffffff",\s*\n\s*bgPreset: "white"/);
  assert.match(html, /id="render-bg" type="color" value="#ffffff"/);
  // 不扩展更多预设：预设表只有两条。
  const presetBlock = renderJs.match(/export const BACKGROUND_PRESETS = \[([\s\S]*?)\];/);
  assert.ok(presetBlock, "缺少 BACKGROUND_PRESETS 导出");
  assert.equal((presetBlock[1].match(/\{ id: "/g) || []).length, 2, "背景快速预设应为黑 / 白两个");
  // 保留自定义颜色输入与棚拍 / 图片模式。
  assert.match(html, /id="render-bg" type="color"/);
  assert.match(html, /<option value="studio">棚拍渐变<\/option>/);
  assert.match(html, /<option value="image">图片<\/option>/);
});

test("应用黑 / 白预设切回纯色并同步颜色输入与选中态", () => {
  const body = renderJs.match(/function applyBackgroundPreset\(id\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(body, "找不到 applyBackgroundPreset 函数");
  const src = body[1];
  assert.match(src, /state\.bgColor = item\.color;/);
  assert.match(src, /state\.bgPreset = item\.id;/);
  assert.match(src, /state\.bgMode = "pure";/);
  assert.match(src, /els\.bg\.value = item\.color;/);
  assert.match(src, /els\.bgMode\.value = "pure";/);
  assert.match(src, /syncBackgroundPreset\(\)/);
  // 手动改色视为自定义，不再点亮黑 / 白。
  assert.match(renderJs, /state\.bgPreset = null;\s*\n\s*syncBackgroundPreset\(\);/);
});

/* ------------------------------------------------- 玻璃前后界面：pass / cull / 管线 */

test("玻璃背面像写进 sceneTarget，最终画面同时有前、后两个界面", () => {
  // 背面通道剔除正面（cull: front），正面通道剔除背面（cull: back）。
  assert.match(renderJs, /glassBackDraw = draw\(gpu, \{ shader: glassBackWgsl, geometry: meshGeometry, cull: "front" \}\)/);
  assert.match(renderJs, /glassDraw = draw\(gpu, \{ shader: glassWgsl, geometry: meshGeometry, cull: "back" \}\)/);
  // sceneTarget 那一趟在玻璃材质下先背面、再正面（两个界面都参与最终合成）。
  const scenePass = renderJs.match(/currentFrame\.pass\(\{ target: sceneTarget[\s\S]*?\n      \}\);/);
  assert.ok(scenePass, "找不到 sceneTarget 绘制趟");
  assert.match(scenePass[0], /pass\.draw\(glassBackDraw\);\s*\n\s*pass\.draw\(glassDraw\);/);
  // backTarget 仍是独立的深度目标，供正面通道估厚度。
  assert.match(renderJs, /target: backTarget, clear: \[0, 0, 0, 0\], clearDepth: 1/);
  const glassBackWgsl = read("tools/extrude3d/shaders/glass-back.wgsl");
  // 背面着色复用官方逻辑：法线朝向 select、Schlick 菲涅耳、studio_env 反射、吸收。
  assert.match(glassBackWgsl, /select\(-geometric_normal, geometric_normal, dot\(geometric_normal, view\) > 0\.0\)/);
  assert.match(glassBackWgsl, /fn fresnel_scale\(facing: f32\) -> f32/);
  assert.match(glassBackWgsl, /studio_env\(/);
  assert.match(glassBackWgsl, /exp\(-glass\.absorption \* path\)/);
  // 正面通道仍读 back_tex 估厚度 / 出射。
  assert.match(read("tools/extrude3d/shaders/glass.wgsl"), /back_sample\.a > 0\.5/);
  // 不引入 raymarch / SDF / 第二套引擎（注释里的否定说明不算实现）。
  const glassCode = (glassBackWgsl + read("tools/extrude3d/shaders/glass.wgsl")).replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !/sculpture_distance|march_surface|ray_march|raymarch|sdf_distance/i.test(glassCode),
    "玻璃着色器不应引入 raymarch / SDF"
  );
});

test("背面通道的 uniform 与背面 WGSL 结构一致（camera_position + 玻璃字段）", () => {
  const glassBackWgsl = read("tools/extrude3d/shaders/glass-back.wgsl");
  assert.match(glassBackWgsl, /struct BackCamera \{[\s\S]*?camera_position: vec3f,[\s\S]*?\}/);
  assert.match(glassBackWgsl, /struct GlassBack \{[\s\S]*?base_color: vec3f,[\s\S]*?ior: f32,[\s\S]*?absorption: vec3f,[\s\S]*?env_intensity: f32,[\s\S]*?key_intensity: f32,[\s\S]*?key_direction: vec3f,[\s\S]*?key_color: vec3f,[\s\S]*?\}/);
  // 生产代码给背面 draw 的字段必须齐全（吸收按当前预设可直接用简写）。
  const setBlock = renderJs.match(/glassBackDraw\.set\(\{[\s\S]*?\n      \}\);/);
  assert.ok(setBlock, "找不到 glassBackDraw.set 调用");
  for (const field of ["view_projection", "camera_position", "base_color", "ior", "absorption", "env_intensity", "key_intensity", "key_direction", "key_color"]) {
    assert.ok(new RegExp(`\\b${field}\\b`).test(setBlock[0]), `背面 uniform 缺少 ${field}`);
  }
});

/* ------------------------------------------------- 色散默认值与映射 */

test("色散默认值与滑杆映射对齐官方 dispersion_spread（0 表示关闭）", () => {
  const glass = read("tools/extrude3d/shaders/glass.wgsl");
  // 官方 transmission 示例：谱采样 11、金色角、dispersion 直接作为谱折射率展宽。
  assert.match(glass, /const TRANSMISSION_SAMPLES: i32 = 11;/);
  assert.match(glass, /const GOLDEN_ANGLE: f32 = 2\.39996323;/);
  assert.match(glass, /glass\.ior \+ \(t - 0\.5\) \* glass\.dispersion/);
  assert.match(glass, /glass\.dispersion > 0\.001/);
  // 谱权重对齐官方 (0.05 / 0.50 / 0.95)。
  assert.match(glass, /\(t - 0\.05\) \/ 0\.45/);
  assert.match(glass, /\(t - 0\.50\) \/ 0\.38/);
  assert.match(glass, /\(t - 0\.95\) \/ 0\.45/);
  // 默认值与官方 GLASS.dispersion_spread = 0.09 一致，且明显强于旧值 0.015。
  assert.match(renderJs, /dispersion: 0\.09, absorption: \[0\.08/);
  assert.match(renderJs, /dispersion: 0\.06, absorption: \[0\.85/);
  assert.match(renderJs, /dispersion: 0, absorption: \[0\.1/);
  const stateBlock = renderJs.match(/const state = \{[\s\S]*?\n  \};/);
  assert.ok(stateBlock, "找不到渲染页签 state");
  const defaultDispersion = Number((stateBlock[0].match(/dispersion: ([\d.]+),/) || [])[1]);
  assert.ok(defaultDispersion >= 0.09, `默认色散应明显增强，实际 ${defaultDispersion}`);
  // 控件初始值与范围保留，「色散强度」控件不新增。
  assert.match(html, /id="render-dispersion"[^>]*min="0" max="0\.2" step="0\.001" value="0\.09"/);
  assert.match(html, /id="render-dispersion-out">0\.090</);
});

test("PNG 导出由 WebGPU 渲染结果编码，而不是建模预览截图", () => {
  assert.match(renderJs, /exportTarget\.color\.read/);
  assert.match(renderJs, /toBlob\(resolve, "image\/png"\)/);
  assert.ok(!/model-canvas/.test(renderJs), "导出不得读取建模画布");
});

test("vgpu 精确锁定 0.6.0 且许可文件齐备", () => {
  assert.equal(pkg.dependencies.vgpu, "0.6.0");
  const licensePath = resolve(ROOT, "third-party-licenses/vgpu-LICENSE.txt");
  assert.ok(existsSync(licensePath), "缺少 third-party-licenses/vgpu-LICENSE.txt");
  const license = readFileSync(licensePath, "utf8");
  assert.match(license, /MIT/i);
  assert.match(license, /vercel/i);
  assert.ok(existsSync(resolve(ROOT, "tools/extrude3d/shaders/pbr.wgsl")));
  assert.ok(existsSync(resolve(ROOT, "tools/extrude3d/shaders/glass.wgsl")));
  assert.ok(existsSync(resolve(ROOT, "tools/extrude3d/shaders/glass-back.wgsl")));
  assert.ok(existsSync(resolve(ROOT, "tools/extrude3d/shaders/background.wgsl")));
  assert.ok(existsSync(resolve(ROOT, "tools/extrude3d/shaders/present.wgsl")));
});

test("构建产物：extrude3d 分块含 WGSL 且不含旧材质预设库", () => {
  const distDir = resolve(ROOT, "dist/build");
  if (!existsSync(distDir)) return; // 未构建时跳过
  const files = readdirSync(distDir).filter((f) => /extrude3d.*\.js$/.test(f));
  assert.ok(files.length > 0, "dist/build 未找到 extrude3d 分块");
  const bundle = files.map((f) => readFileSync(join(distDir, f), "utf8")).join("\n");
  assert.ok(/fn fs_main/.test(bundle), "构建产物未包含 WGSL 着色器");
  assert.ok(!/materialPresets|MATERIAL_UI|MATERIAL_LIB/.test(bundle), "构建产物仍含旧材质预设库");
  assert.ok(!/fn trace_cube_exit/.test(bundle), "构建产物仍含写死立方体的透射实现");
});
