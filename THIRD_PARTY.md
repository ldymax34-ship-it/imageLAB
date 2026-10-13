# 第三方来源与许可（THIRD_PARTY）

imageLAB 只做开源方案的整合：页面外壳、入口连接、参数映射与导出适配由本项目编写；
图像处理、着色器、三维渲染等能力全部来自下列第三方项目，**未自研渲染器、算法或 Shader**。

完整的许可原文存放在 [`third-party-licenses/`](third-party-licenses/)（可用 `node scripts/collect-licenses.mjs` 重新汇总）。

## 运行时依赖（npm）

| 包 | 版本 | 许可 | 用途 | 上游 |
| --- | --- | --- | --- | --- |
| `three` | 0.186.1（锁定） | MIT | 3D 渲染、SVG 加载、挤出几何、OrbitControls、RoomEnvironment、`addons/effects/AsciiEffect` 字符化 | https://github.com/mrdoob/three.js |
| `@visant/extrude3d` | 0.1.0（锁定） | MIT | SVG → 挤出几何、材质预设库 | https://github.com/pedrojaques99/visantlabs-os （子包 `packages/extrude3d`） |
| `@paper-design/shaders` | 0.0.81（锁定） | Apache-2.0 + NOTICE | WebGL2 着色器（液态金属、动态背景、半调等） | https://github.com/paper-design/shaders |

> `@paper-design/shaders` 要求保留 NOTICE，原文见 [`third-party-licenses/paper-design-shaders-NOTICE.txt`](third-party-licenses/paper-design-shaders-NOTICE.txt)。
> 该包处于 `0.0.x`，官方声明会有破坏性变更，因此**锁定 0.0.81**，不使用 `^` 范围。

## 搬运 / 引用的源代码（非 npm）

| 项目 | 版本或 commit | 许可 | 用途 | 本项目改动 |
| --- | --- | --- | --- | --- |
| 纹理间（本项目自有项目，来源副本 `_source_snapshot`） | 2026-09-29 快照 | **用户原创**（含 `curve-fit.js`，用户已确认可公开） | `tools/texture` 全部功能 | 整合副本仅 `style.css` 改界面主题；其余 7 份非样式源码逐字节原样，`_source_snapshot` 8 份根原件未改动 |
| giventofly/pixelit | commit `9c53dfa191fcb2f4a4507c21f40647c29e352939` | MIT | `tools/pixelit` 像素化网页与库 | 见下 |
| Tezumie/Image-to-Pixel | commit `b0d5b7422db309dae22c2a69d4ebca0ce8c14b78` | MIT（库）/ Apache-2.0（应用） | `tools/image-to-pixel` 像素化与抖动**库本体** | 见下 |
| nitch193/Image-to-Ascii | commit `71da7bcde48d48ada65d5ea507fce68331e8ba77` | MIT | `tools/image-to-ascii` 字符画网页 | 见下 |
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
- `three@0.186.1`（MIT）只用官方现成件：`OrbitControls`、`RoomEnvironment` + `PMREMGenerator`（程序化环境，无远程 HDRI）、
  `MeshPhysicalMaterial`、`ACESFilmicToneMapping`、`RectAreaLight` + `RectAreaLightUniformsLib`（面光源）、
  `Reflector`（`objects/Reflector.js`，真实单趟平面反射）、`Fog`。均为随 `three@0.186.1` 分发的 MIT 官方 addon，
  不新增依赖、不写自定义着色器。
- `@visant/extrude3d@0.1.0`（MIT）：`parseShapesFromSVG` / `buildExtrudeSettings` / `measureFlatMaxDim` /
  `smoothCreaseNormals` / `recomputeTriplanarUVs` / `MATERIAL_UI` / `materialPresets` / `resolveMaterial` /
  `getSimpleMaterialProps` 全部直调上游；`vertexBudget: 600000` 也传给上游做细分裁剪。
  几何构建改为 three 原生 `ExtrudeGeometry` + `BufferGeometryUtils.mergeGeometries`（MIT），
  玻璃 / 主光的材质与灯光同样只用 three 原生 `MeshPhysicalMaterial` / `DirectionalLight`。
  **本工具不写任何 PBR 公式、不自研几何算法、不新增许可。**
- **棚拍空间（背景模式之一）的观感对齐**：只读观察官方 vgpu `glass-sculpture` 示例
  （MIT，<https://github.com/vercel-labs/vgpu>，`apps/docs/examples/glass-sculpture/scene.ts` + `sculpture.wgsl`）
  的 STUDIO 灯光取值（暖色主光、冷色轮廓光、上亮下暗天幕），用 `three` 原生 `RectAreaLight` + 一次性 PMREM
  环境 + `Reflector` 地面在真实 WebGL 场景里尽力还原；**未移植**其 WGSL / SDF 光线步进，也不声称能复现多次弹射的
  全内反射。逐帧观感（地面亮度 / 反射强度）待 Codex 浏览器复核。
- 危险 / 复杂 SVG 在解析前被拒绝（`tools/extrude3d/svg-guard.js`，纯函数）：文本（`<text>`/`<tspan>`）、
  `<image>`、滤镜元素与属性、渐变描边、`<use>`、非 SVG、空文件、>1 MiB、>500 条图形，
  以及按真实细分估算仍超 600000 顶点的密集曲线，一律拒绝并显示中文原因，
  同时保留上一次成功的模型，不渲染半成品。界面提示为「文字请先转曲」。
- **关于陶瓷（ceramic）**：上游 0.1.0 的界面精选列表 `MATERIAL_UI`（28 项）里**没有** `ceramic`，
  但完整预设表 `materialPresets`（38 项）中**确实存在**。本工具的处理是：
  - 主下拉按 `MATERIAL_UI` 分 5 组列出 28 项；
  - 其余 10 项（含 `ceramic`）归入单独的「更多材质」分组，不隐藏、不编造；
  - 下拉里显示中文短名（如 铬 / 玻璃 / 拉丝钢 / 陶瓷），`value` 始终是上游 preset id，原样交给材质库。
  这一段说明只写在本文件，工具页面不再展开。

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
| vgpu | 示例是 React/TS + WGSL 工程，不能直接当 Three.js 材质使用（提取成本高）；官方 `transmission` / `glass-sculpture` / `tsl-exports`（MIT，<https://github.com/vercel-labs/vgpu>）只做只读思路参考，未搬运 WGSL / TSL 源码、未接入运行时。`glass-sculpture` 的 STUDIO 灯光取值仅用于校准本工具「棚拍空间」的原生 `RectAreaLight` / PMREM 环境 / `Reflector` 地面（见上），属观感参考不构成代码移植 |
| danielpetho/cmyk-halftone-emulator | 派生 shader 的上游（Shadertoy `fdjyR1`）许可未证实 |

## 本项目自身的代码

`index.html`、`assets/`、`scripts/`、`tests/`、`tools/shaders-*/`、`tools/extrude3d/`、`tools/mixed-type/`、
`tools/wave-grid/`、`tools/ascii-motion/` 等入口与适配代码为 imageLAB 自有代码。
`tools/texture/` 为用户原创项目源码（`curve-fit.js` 亦为用户本人所写，已确认可公开），按用户要求**逐字节原样收录**；
仅整合副本的 `style.css` 为本站界面主题改为白 / 黑 / 中性灰，`_source_snapshot/` 的 8 份根原件保持未改动。

**整包对外许可尚未选定**：本项目不擅自替权利人选择许可证（例如不默认套用 MIT）。
在权利人明确指定之前，请把本仓库视为「保留所有权利」。
