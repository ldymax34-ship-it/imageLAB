# 第三方来源与许可（THIRD_PARTY）

imageLAB 只做开源方案的整合：页面外壳、入口连接、参数映射与导出适配由本项目编写；
图像处理、着色器、三维渲染等能力全部来自下列第三方项目，**未自研渲染器、算法或 Shader**。

完整的许可原文存放在 [`third-party-licenses/`](third-party-licenses/)（可用 `node scripts/collect-licenses.mjs` 重新汇总）。

## 运行时依赖（npm）

| 包 | 版本 | 许可 | 用途 | 上游 |
| --- | --- | --- | --- | --- |
| `three` | 0.186.1（锁定） | MIT | 3D 诊断预览、SVG 加载、挤出几何、`OrbitControls`、`RoundedBoxGeometry`、`mergeGeometries`；以及 `addons/effects/AsciiEffect` 字符化 | https://github.com/mrdoob/three.js |
| `@visant/extrude3d` | 0.1.0（锁定） | MIT | SVG → 挤出几何（解析 / 尺寸 / 挤出参数 / 平滑法线 / 三平面 UV）；**不再使用其材质预设库** | https://github.com/pedrojaques99/visantlabs-os （子包 `packages/extrude3d`） |
| `@paper-design/shaders` | 0.0.81（锁定） | Apache-2.0 + NOTICE | WebGL2 着色器（液态金属、动态背景、半调等） | https://github.com/paper-design/shaders |
| `vgpu` | 0.6.0（锁定） | MIT | SVG 转 3D「渲染」页签的 WebGPU 渲染：`init` / `surface` / `target` / `draw` / `effect` / `frame` / `sampler` / `texture` / `geometry`；PBR 与透射 WGSL 由官方 MIT 示例最小改写 | https://github.com/vercel-labs/vgpu |

> `vgpu@0.6.0` 是官方 npm 主包（MIT），其 `@vgpu/adapter-node` 会传递引入 Node 端 Dawn 绑定
> `webgpu@0.4.0`（仅用于 `vgpu/node` 无头渲染）。本工具**只使用浏览器入口** `import ... from "vgpu"`，
> 该 Node 适配器不会被浏览器构建引用；许可原文见 [`third-party-licenses/vgpu-LICENSE.txt`](third-party-licenses/vgpu-LICENSE.txt)。

> `@paper-design/shaders` 要求保留 NOTICE，原文见 [`third-party-licenses/paper-design-shaders-NOTICE.txt`](third-party-licenses/paper-design-shaders-NOTICE.txt)。
> 该包处于 `0.0.x`，官方声明会有破坏性变更，因此**锁定 0.0.81**，不使用 `^` 范围。

## 搬运 / 引用的源代码（非 npm）

| 项目 | 版本或 commit | 许可 | 用途 | 本项目改动 |
| --- | --- | --- | --- | --- |
| 纹理间（本项目自有项目，来源副本 `_source_snapshot`） | 2026-09-29 快照 | **用户原创**（含 `curve-fit.js`，用户已确认可公开） | `tools/texture` 全部功能 | 整合副本仅 `style.css` 改界面主题；其余 7 份非样式源码逐字节原样，`_source_snapshot` 8 份根原件未改动 |
| giventofly/pixelit | commit `9c53dfa191fcb2f4a4507c21f40647c29e352939` | MIT | `tools/pixelit` 像素化网页与库 | 见下 |
| Tezumie/Image-to-Pixel | commit `b0d5b7422db309dae22c2a69d4ebca0ce8c14b78` | MIT（库）/ Apache-2.0（应用） | `tools/image-to-pixel` 像素化与抖动**库本体** | 见下 |
| nitch193/Image-to-Ascii | commit `71da7bcde48d48ada65d5ea507fce68331e8ba77` | MIT | `tools/image-to-ascii` 字符画网页 | 见下 |
| vercel-labs/vgpu 官网棱镜场景 | commit `81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5`（`vgpu@0.6.0` 同代 npm 发布） | MIT（[`tools/extrude3d/prism/LICENSE.txt`](tools/extrude3d/prism/LICENSE.txt)） | `tools/extrude3d` 渲染页「官方棱镜」固定场景 | 见下 |
| basementstudio/shader-lab | commit `6f39a889db74978d93d882643e3cd2073b3666d6`（pin） | Apache-2.0 | `tools/wave-grid` 的方向模糊（长度 / 角度分离）与多级 bloom 的**思路适配** | 见下 |
| blakeshao/a-psychos-gd-tool | commit `bdc8808526681e4c16a8b9f2937dc571dc0dd1e7` | MIT | `tools/psychos` 节点式版式工具（含 Slice / Shuffle / PNG 导出） | 见下 |
| JetBrains Mono（字体子集） | 随 a-psychos-gd-tool 分发 | SIL OFL 1.1 | psychos 界面字体 | 未改动 |

## 逐项改动说明

（本节在工具落地后按实际修改补全，只记录事实。）

### tools/texture · 纹理间
- `_source_snapshot/` 中的 8 份根原件 + 7 份测试文件保持原样，未被改动（`shasum -a 256` 逐一复核，
  16/16 一致；`_source_snapshot/` 已被 `.gitignore` 排除，不进仓库）。
- 整合副本 `tools/texture/` 仅 `style.css` 为本站界面主题改为白 / 黑 / 中性灰，
  其余 7 份非样式源码（含 `curve-fit.js`）与快照**逐字节一致**；该工具**不包含**任何「返回首页」注入。
- **许可状态：已澄清**。本工具为用户原创项目（含 `curve-fit.js`），用户已确认可以公开；
  此前 TOOL_INDEX 中记录的「`curve-fit.js` 许可未查清」为核查阶段的待确认项，现已由权利人澄清，**不再构成阻塞**。
  分发时以用户对整包许可的决定为准（见文末）。

### tools/pixelit
- 上游 `docs/` 网页 UI + 本地库文件；17 个文件里 13 个逐字节一致（全部 JS 库、图片、`slim.select.css`、`LICENSE`）。
- `index.html`：加入站内返回链接；删除 github / twitter / buymeacoffee 外链与远程图片（改为本地 `LICENSE` 与站内链接）；
  增加本地示例图说明。上游只用于开发自测的 `docs/tests.html`、`docs/js/tests.js`、`assets/tests*`（含外链与大图）未搬运。
- `assets/style.min.css`：仅替换文件首部的 `@import url(https://fonts.googleapis.com/…)` 为 4 条本地 `@font-face`
  （Open Sans 400/700，latin + latin-ext，`assets/fonts/open-sans-*.woff2`，约 147 KB，含 `OFL-OpenSans.txt`）。
  该行之后的正文校验为逐字节未改动。上游 CSS 里 VT323 / Megrim / Rajdhani 只被 `@import` 引用、页面并未实际使用，故未本地化。
- `assets/sample.png` 为程序生成的测试图（`tests/fixtures/test-photo.png` 的副本），非私人素材、非 AI 生成。

### tools/image-to-pixel
- 仅使用 **MIT 的库本体** `image-to-pixel.js`（上游 `LICENSE-library.txt`）；**未使用** Apache-2.0 的应用部分（上游 `index.html`/`css/`/`src/`）。
- 库文件与许可文件均逐字节复制（`image-to-pixel.js` sha256 `7f0952ba…`，`LICENSE-library.txt` sha256 `2ba6968f…`，`cmp` 一致）。
  载入方式为 `?raw` 原文 + Blob 经典脚本注入，因此库文件无需为 ESM 改写。
- 上游 MIT 文件的版权人字段仍是占位符 `[YEAR] [YOUR NAME]`，属上游瑕疵，此处如实记录。
- **切断上游远程分支**：上游在收到字符串调色板时会 `fetch` Lospec 接口；本项目只提供 6 组本地 `#rrggbb` 数组，
  代码里也加了 `Array.isArray` 硬断言，该远程路径不可达。
- `strength` 采用库内真实的 **0–100**（库第 85 行 `strength / 100`，上游界面滑块即 `min=0 max=100`）。

### tools/extrude3d

**双页签架构（2026-10-14，用户专项授权）**：工具分为「建模」与「渲染」两个页签，职责按 Blender 式分离但只做轻量工具。

- **建模页签（Three.js）**：只用官方现成件 `OrbitControls`、`ExtrudeGeometry`、`RoundedBoxGeometry`、
  `BufferGeometryUtils.mergeGeometries`、`MeshStandardMaterial`（固定中性灰诊断材质）、`HemisphereLight` /
  `DirectionalLight`。**不再**使用 `RoomEnvironment` / `PMREMGenerator` / `Reflector` / `RectAreaLight` /
  `MeshPhysicalMaterial`，也不承担产品材质、最终灯光、背景或最终导出。
- **渲染页签（vgpu 0.6.0 + WebGPU，MIT）**：接收建模页签在内存中交接的同一份 position / normal / uv / index 网格，
  用 `geometry(gpu, ...)` 上传任意闭合挤出网格（不是固定立方体），负责 7 个中文材质预设、灯光、背景、镜头与当前帧 PNG 导出。
- **不透明材质**：`tools/extrude3d/shaders/pbr.wgsl` 的 Cook-Torrance GGX 结构改写自 vgpu 官方 MIT 示例
  [`apps/docs/examples/glass-fractal/hero-fractal-ceramic.wgsl`](https://github.com/vercel-labs/vgpu/blob/main/apps/docs/examples/glass-fractal/hero-fractal-ceramic.wgsl)，
  最小增加 metallic（金属度）与程序化棚拍环境项，供塑料 / 陶瓷 / 金属 / 镀铬共用。
- **玻璃 / 透射**：`tools/extrude3d/shaders/glass.wgsl` 的 Fresnel、色散谱权重、粗糙度锥形采样、吸收结构参考官方
  [`apps/docs/examples/transmission/glass.wgsl`](https://github.com/vercel-labs/vgpu/blob/main/apps/docs/examples/transmission/glass.wgsl)（MIT）；
  官方 `trace_cube_exit` 写死立方体，不能用于任意 SVG，因此本工具改为
  [`glass-back.wgsl`](tools/extrude3d/shaders/glass-back.wgsl) 的**背面通道** + 正面透射通道：
  按同一屏幕像素取回背面世界坐标估算厚度与出射点，再投影回屏幕采样背景，支持明显折射、Fresnel、有限色散与
  有限 TIR（`refract` 失败按反射处理）。背面通道同一趟也把背面片元写进 `sceneTarget`（法线朝向、Schlick 菲涅耳、
  `studio_env` 环境反射、吸收），因此最终成像同时有前、后两个界面；`dispersion` 直接作为官方 `dispersion_spread`，
  谱采样 11 与谱权重按官方取值。**不承诺**任意非流形 / 高度凹陷模型的多次内反射，也不移植官方 SDF 光线步进。
- **背景 / 合成 / 导出**：`background.wgsl`（纯色 / 棚拍渐变 / 本地图片 cover + 缩放 + 平移）与 `present.wgsl`
  （线性 HDR → 曝光 → ACES → sRGB，输出预乘 alpha）为本项目按上述官方示例的最小接线；本地图片按
  `common.wgsl` 的 `srgb_to_linear`（IEC 61966-2-1，与 `linear_to_srgb` 互逆）在线性化后进入管线，纯色 / 基色
  经 `Color.setStyle(hex, SRGBColorSpace)` 取线性值，避免把 sRGB 当线性导致发白。导出走 `exportTarget.color.read`
  后由 2D canvas 编码 PNG，**不是** canvas 截图、也不读取建模画布。
- **移除旧材质库**：不再调用 `@visant/extrude3d` 的 `MATERIAL_UI` / `materialPresets` / `resolveMaterial` /
  `getSimpleMaterialProps`，也不再使用 `MeshPhysicalMaterial`；构建产物中已确认不含这些符号（`tests/extrude3d-tabs.test.cjs`）。
- **SVG 安全闸门**（`tools/extrude3d/svg-guard.js`，纯函数）：文本（`<text>`/`<tspan>`）、`<image>`、
  滤镜元素与属性、渐变描边、`<use>`、非 SVG、空文件、>1 MiB、>500 条图形，以及按真实细分估算仍超
  600000 顶点的密集曲线，一律拒绝并显示中文原因，同时保留上一次成功的模型。界面提示为「文字请先转曲」。
- **几何参数映射**：厚度 / 倒角按最大平面边长百分比换算；`buildExtrudeSettings` 与 `vertexBudget: 600000`
  仍直调上游，倒角尺寸单独按百分比换算并沿用「不超过厚度一半」保护。
- 渲染页签源码与着色器（`render-vgpu.js`、`shaders/*.wgsl`）为本项目的**最小整合适配**，许可随本体（尚未选定，见文末）。
- **玻璃 Double Refraction（2026-10-15）**：按官方
  [`apps/docs/examples/transmission/scene.ts` + `glass.wgsl`](https://github.com/vercel-labs/vgpu/tree/81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5/apps/docs/examples/transmission)
  的两次折射逻辑，新增 `glass-back-info.wgsl` 背面信息预通道，用 vgpu 0.6.0 多颜色附件同时记录
  出射面世界坐标与世界法线；正面玻璃按背面法线执行第二次 `refract`，TIR 回退原有限近似。
  任意闭合 SVG 挤出网格仍走该预通道，不使用官方写死立方体的解析求交；「最先命中的背面片元 +
  折射后出射点不一定逐像素对齐」这一屏幕空间近似限制已在 shader 注释中写明，不是完整光线追踪。
- **官方棱镜场景（2026-10-15）**：`tools/extrude3d/prism/` 来自 vgpu 官网首页
  `apps/docs/app/[lang]/(home)/components/prism-background/`（上游 commit
  `81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5`，MIT）：保留运行时必需的三角棱镜几何、确定性 CPU
  光束网格、光谱/玻璃/bloom/present shader、烘焙环境与相机结构，按本项目纯 JS + vgpu 0.6.0 做最小
  接线；排除官网 React 外壳、dust 粒子、wireframe、调试视图、性能面板与主题系统。棱镜使用自己的固定
  官方几何与视角，不套用任意 SVG 网格；切回 SVG 模型后原网格继续使用。

### tools/psychos
- 补丁清单见 `tools/psychos/PATCHES.md`。摘要：切除远程 AI 抠图节点（`removeBackground.ts` 及
  `@huggingface/transformers` + `briaai/RMBG-1.4` 的整段动态 import）、删除 Google Fonts 外链、
  `FONT_URLS` 改为本地 `./fonts/JetBrainsMono-Regular.ttf`、`/factory-image.jpg` 改为相对路径、
  `vite.config.ts` 设 `base: './'` 且 `outDir` 指向 `dist/tools/psychos`。
- `JetBrains Mono` 为 SIL OFL 1.1，随上游分发，未改动。

### tools/mixed-type · tools/ascii-motion（本批新增 · 独立实现）

- 这两个工具是依据用户提供的参考视频**新写的独立实现**：只调用仓库已锁定的 `three@0.186.1`（MIT）与
  浏览器原生能力（Canvas 2D、`Intl.Segmenter`、`FontFaceSet`、`window.queryLocalFonts`），
  **没有**复制任何商业站点的源码、品牌、素材或字体，也没有把参考页面当作模板。
- `tools/ascii-motion` 复用 three 自带的 `examples/jsm/effects/AsciiEffect.js`（MIT，随 `three@0.186.1`
  分发，许可原文见 [`third-party-licenses/three-LICENSE.txt`](third-party-licenses/three-LICENSE.txt)），
  未改写其中的字符转换算法，也没有引入自定义 Shader 或额外运行时依赖。
- 参考来源「Mixweight」的网址在本机**不可达**：未能逐条核对原始开源许可。本批以用户对「按视频效果实现」的
  专项授权为前提，许可登记以本文件与 `third-party-licenses/` 中已锁定的上游（three）为准。
- 字体：三个工具只使用访问者本机已安装的系统字体，仓库**不打包、不分发**任何字体文件；
  本机字体的许可由使用者在自己的机器上自行确认，不进入本项目的分发范围。
- 封面路径 `public/assets/covers/mixed-type.png`、`wave-grid.png`、`ascii-motion.png` 已登记；
  在 Codex 用真实导出抓取前，首页对这些入口显示中性文字占位（不伪造效果图）。

### tools/wave-grid · 方向模糊与 bloom（Shader Lab 适配）

- 上游：basementstudio/shader-lab，Apache-2.0，pin `6f39a889db74978d93d882643e3cd2073b3666d6`；
  全文见 [`third-party-licenses/basementstudio-shader-lab-LICENSE.txt`](third-party-licenses/basementstudio-shader-lab-LICENSE.txt)。
  该仓库是 Next/React + three/WebGPU（TSL）编辑器，本项目**未搬运编辑器、React 外壳、TSL/WGSL 源码**，
  只按官方 `src/renderer/` 的成熟做法做 Canvas 2D 等效适配：
  - `src/renderer/directional-blur-pass.ts`（`MAX_SAMPLES = 16`、沿角度做有限次偏移取样、长度与角度分离）
    → `tools/wave-grid/main.js` 在 1/4 分辨率透明块缓冲上做 **8 次**位移 `drawImage` 累加，方向由角度决定、
    延伸由辉光长度（0–120 CSS px）决定；未使用其 TSL uniform/node 结构。
  - `src/renderer/dual-filter-bloom.ts`（逐级缩小 / 放大的双滤波 bloom）
    → `tools/wave-grid/main.js` 用 **1/8 + 1/16** 两级低分辨率透明缓冲做圆形柔光，再以 `lighter` 叠回；
    未使用其 WebGLRenderTarget / TSL 节点实现。
  - `src/renderer/particle-grid-pass.ts`（按格采样、阈值字形、低分辨率缓冲复用）
    → 仅作为「按固定格采样 + 阈值字形 + 缓存整帧」的**结构参考**，未逐行移植。
  - `src/renderer/ascii-pass.ts` / `ascii-atlas.ts`（SDF 字形图集、网格折断）与 `src/renderer/grid-render-pass.ts`
    本工具**未使用**，只登记为参考来源，不声称集成整套 Shader Lab 引擎。
- 光带场的数值结构（斜向四分带、噪声分段、白核与亮簇）是 imageLAB 自有实现，见 `tools/wave-grid/field.js`；
  逐格噪声由 `three@0.186.1` 自带的 `examples/jsm/math/SimplexNoise.js`（MIT）在布局时预计算。

## 明确排除（未接入）

| 项目 | 原因 |
| --- | --- |
| danielepiccone/ditherjs | 仓库无 LICENSE 原文，仅 `package.json` 自述 CC-BY-SA-4.0 → 许可证据不足 |
| lumamontes/app-asset-generator | README 称 MIT 但 LICENSE 404 → 许可不明 |
| fredeerock/imageCutter | README 称 MIT 但 LICENSE 原文 404 → 许可不明 |
| @visant/logo-trace | 依赖 `sharp` 原生模块，浏览器端可行性未证实 |
| vgpu（旧的「不接入」结论已作废） | 2026-10-14 用户专项授权后接入 `vgpu@0.6.0`（MIT）：渲染页签只使用浏览器主入口，PBR / 透射 WGSL 由官方 MIT 示例最小改写；Node 端 Dawn 适配器不被浏览器构建引用 |
| danielpetho/cmyk-halftone-emulator | 派生 shader 的上游（Shadertoy `fdjyR1`）许可未证实 |
| vgpu `examples/typegpu-liquid-glass` | 固定 TypeGPU Logo 的二维 SDF 多通道效果，不是任意 SVG 3D 网格材质；需要 `typegpu` 依赖。可作为后续独立「液态玻璃」工具；支持上传自定义 SVG/Logo 需要新增遮罩或 SDF 生成能力，应另开任务。不与本轮 Transmission Double、棱镜场景强行合并 |

## 首页封面素材来源（2026-10-15 刷新）

封面只用于首页识别，不进入工具运行时；来源与许可逐张记录：

| 封面 | 上游仓库 | 文件路径 | 上游 commit | 许可 / 状态 |
| --- | --- | --- | --- | --- |
| `public/assets/covers/shaders-halftone.png` | paper-design/shaders | `docs/public/shaders/halftone-dots.webp` | `43cd68d` | Apache-2.0；NOTICE 已在 [`third-party-licenses/paper-design-shaders-NOTICE.txt`](third-party-licenses/paper-design-shaders-NOTICE.txt) 保留 |
| `public/assets/covers/pixelit.png` | giventofly/pixelit | `docs/assets/px-palette4c.jpg` | `9c53dfa` | MIT |
| `public/assets/covers/image-to-pixel.png` | Tezumie/Image-to-Pixel | `cover.png` | `46f80e2` | MIT |
| `public/assets/covers/image-to-ascii.png` | nitch193/Image-to-Ascii | README 内嵌 Tanjiro 示例 PNG | `71da7bc` | **素材许可待确认**；作者与再分发依据未核实，本轮保持现状、不复制替代图 |

## 本项目自身的代码

`index.html`、`assets/`、`scripts/`、`tests/`、`tools/shaders-*/`、`tools/extrude3d/`、`tools/mixed-type/`、
`tools/wave-grid/`、`tools/ascii-motion/` 等入口与适配代码为 imageLAB 自有代码。
`tools/texture/` 为用户原创项目源码（`curve-fit.js` 亦为用户本人所写，已确认可公开），按用户要求**逐字节原样收录**；
仅整合副本的 `style.css` 为本站界面主题改为白 / 黑 / 中性灰，`_source_snapshot/` 的 8 份根原件保持未改动。

**整包对外许可尚未选定**：本项目不擅自替权利人选择许可证（例如不默认套用 MIT）。
在权利人明确指定之前，请把本仓库视为「保留所有权利」。
