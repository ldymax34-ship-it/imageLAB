# ImageLAB

名称拼写固定为 **ImageLAB**（首字母 `I` 大写、`mage` 小写、`LAB` 大写）。

生成纹理、处理图片、探索材质。调好参数，直接出图。素材本地处理，不上传。

一个**纯静态、纯前端**的图像设计工具箱：首页 `index.html` + `tools/<id>/` 下的独立工具网页。
素材只在本地浏览器里处理，不上传；没有数据库、没有账号、没有服务端渲染、也没有运行时远程模型或 API。

## 快速开始

```bash
npm install          # 安装依赖（three / @visant/extrude3d / @paper-design/shaders / vite）
npm run dev          # 开发服务器 http://127.0.0.1:5177
npm run build        # 构建完整静态产物到 dist/
npm run serve        # 本地静态服务器打开 dist（http://127.0.0.1:4890）
npm test             # 纯 Node：纹理间 4 套测试（34 项）+ 本地服务器自检 + 静态自检
npm run check        # 纯 Node 静态自检（入口、远程资源、字节一致性、许可、清单对齐）
npm run fixtures     # 重新生成测试素材
```

macOS 用户可以直接双击 **`启动图像实验室.command`**：会自动安装依赖、构建、并在
`127.0.0.1` 上启动本地服务器后打开浏览器。

> 本轮首页视觉调整：配色收敛为纯白 + 纯黑 + 中性灰，hero 直接复用
> `public/brand/ImageLAB-logo-preview.png` 字标（CSS 裁空白），全部视图改为连续 12 栏网格。
> 并修复首页搜索对字符串关键词（`tools.js` 的 `keywords` 是字符串、不是数组）不生效的问题。
> 仅经 Node 侧验证，浏览器验收与封面生成仍由 Codex 执行。

## 工具清单与状态

| 入口 | 工具 | 页面地址（dev / dist 同为相对路径） | 主要能力 | 导出 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `tools/texture/` | 纹理间 | `tools/texture/index.html` | 点阵渐变与曲线纹理，参数化无缝图案 | PNG / SVG / 参数 JSON | 已通过 Codex 浏览器验收 |
| `tools/pixelit/` | 像素画 | `tools/pixelit/index.html` | 上传图片像素化，像素尺寸 / 调色板 / 灰度 | PNG | 已通过 Codex 浏览器验收 |
| `tools/image-to-ascii/` | 字符画 | `tools/image-to-ascii/index.html` | 图片转字符画，保留明暗关系 | PNG | 已通过 Codex 浏览器验收 |
| `tools/extrude3d/` | SVG 挤出三维 | `tools/extrude3d/index.html` | SVG 挤出、厚度 / 倒角 / 圆滑度 / 材质 / 环境与背景 | PNG（可选透明背景） | 已通过 Codex 浏览器验收 |
| `tools/image-to-pixel/` | 像素化与抖动 | `tools/image-to-pixel/index.html` | 像素化 + 7 种抖动 + 数组调色板 | PNG | 已通过 Codex 浏览器验收（34 项） |
| `tools/shaders-logo/` | 着色器 Logo | `tools/shaders-logo/index.html` | 液态金属等着色器 Logo / 图片遮罩 | PNG（单帧） | 已通过 Codex 浏览器验收（独立 19 项） |
| `tools/shaders-bg/` | 动态背景 | `tools/shaders-bg/index.html` | 动态背景效果集 | PNG（单帧） | 8 效果 / 参数 / 导出断言通过；此前的 304 假失败已修复 |
| `tools/shaders-halftone/` | 半调与抖动 | `tools/shaders-halftone/index.html` | CMYK 半调、网点半调、图片抖动 | PNG（单帧） | 已通过 Codex 浏览器验收（28 项） |
| `tools/psychos/` | 节点式版式 | `dist/tools/psychos/index.html` | 节点式生成式版式：Grid / Shuffle / Slice / Place | PNG 2048×2048 | 已通过 Codex 浏览器验收（20 项，需 WebGPU） |

首页按上表登记全部**实现完成**的入口（共 9 个，含 `tools/psychos`）。
本轮 Codex 验收结论：纹理间、像素画、字符画、SVG 挤出三维、像素化与抖动（34 项）、
Logo 材质（独立 19 项）、半调与网点（28 项）、节点式版式（20 项，WebGPU）均已通过；
动态背景的 8 个效果、参数像素差异与 PNG 导出也全部通过，当时的失败只是开发服务器
HTTP 304 造成的假失败，已在共享浏览器 harness 中关闭缓存修复。
首页新增「搜索 bayer 命中抖动工具」等搜索回归（`tests/specs/home.mjs`），**待 Codex 验证**——
本轮实现侧不启动浏览器，也不对首页下最终验收结论。

`tools/extrude3d` 的本地 SVG 导入上限为 64 KB；单个 `<path>` 曲线过多时，
会在挤出前按上游曲线细分采样轮廓点估算顶点数，超过顶点预算即拒绝并保留上一次成功模型
（不再只按图形元素个数粗判）。该负向回归已加到 `tests/specs/extrude3d.mjs`，由 Codex 跑浏览器验证。

封面由验收阶段用工具的真实导出画面生成：`IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs`
（先服务构建产物 `dist/`；优先取工具真实导出，退路只截真实预览画布，不截节点编辑器 UI；
每个工具使用独立临时下载目录，只等待本次导出结果，不再复用旧下载）。现有
`public/assets/covers/*.png` 是修复前的错误/不完整抓取，**不提交**，由 Codex 在脚本修复后重新生成。
封面尚未生成时首页显示中性文字占位，不会破图、也不会用 AI 图或整页截图冒充效果图。

`tools/psychos` 不参与主站 Vite 多页打包，由 `scripts/build-psychos.mjs` 单独构建到 `dist/tools/psychos`；
它需要 WebGPU 与安全上下文，因此请用 `npm run serve`（构建产物）打开，而不是 `npm run dev`。

### 未接入（如实说明）

| 候选 | 不接入的原因 |
| --- | --- |
| danielepiccone/ditherjs | 仓库无 LICENSE 原文，仅 `package.json` 自述 CC-BY-SA-4.0 → 许可证据不足 |
| lumamontes/app-asset-generator | README 称 MIT 但 LICENSE 404 → 许可不明 |
| fredeerock/imageCutter | README 称 MIT 但 LICENSE 原文 404 → 许可不明 |
| @visant/logo-trace | 依赖 `sharp` 原生模块，浏览器端可行性未证实 |
| vgpu | 示例为 React/TS + WGSL 工程，不能直接当 Three.js 材质使用（提取成本高） |
| danielpetho/cmyk-halftone-emulator | 派生 shader 的上游（Shadertoy `fdjyR1`）许可未证实 |

## 目录结构

```
index.html                 首页（工具导航：分类 / 搜索 / 卡片）
assets/                    首页样式、脚本与工具清单
tools/<id>/                每个工具的独立网页
  ├─ index.html
  ├─ main.js               入口（需要 Vite 打包的工具）
  └─ ...                   该工具自己的资源
public/                    原样复制到 dist 根目录的静态资源（封面、返回链接样式）
scripts/                   构建、静态复制、封面、许可汇总、静态自检等脚本
tests/                     浏览器验收规格（harness + 每个工具一份规格）
vendor-licenses/           上游仓库原始许可文件（供 collect-licenses 汇总；npm 包内无 LICENSE 时留档）
third-party-licenses/      汇总后的第三方许可原文
THIRD_PARTY.md             第三方来源、版本、许可与改动说明
CHANGELOG.md               变更记录
```

约定：`tools/<id>/index.html` 中带 `<!-- imagelab:entry -->` 标记的会被 Vite 当多页入口打包；
不带标记的（原样搬运的工具）由 `scripts/copy-static.mjs` 整体复制进 `dist/`，源码保持上游字节。
首页页脚引用的 `README.md` / `THIRD_PARTY.md` / `CHANGELOG.md` 也会一并复制进 `dist/`，不会 404。

## 浏览器要求

| 能力 | 要求 |
| --- | --- |
| 大部分工具 | 任意现代浏览器 |
| 着色器工具（WebGL2） | Chrome / Edge / Firefox / Safari 支持 WebGL2 的版本 |
| `tools/psychos`（节点式版式） | 需要 **WebGPU**，且必须在 `http://127.0.0.1` 或 HTTPS 这类安全上下文下打开 |

## 测试与验收

本批次的**浏览器验收由 Codex 执行**（用本机已安装的 Chrome 驱动真实交互：上传图片、调参、
点导出并校验下载到的 PNG 尺寸；GPU 工具断言 WebGL2 / WebGPU 真实可用）。

```bash
IMAGELAB_BROWSER_TESTS=on npm run smoke                      # 顺序跑全部工具，只启动一个 Chrome
IMAGELAB_BROWSER_TESTS=on npm run smoke -- texture home      # 只跑指定工具
IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs    # 生成首页封面（真实导出画面 / 画布区域）
IMAGELAB_BROWSER_TESTS=on SMOKE_HEADFUL=1 npm run smoke      # 需要看到窗口时
CHROME_PATH=/path/to/chrome npm run smoke
```

浏览器验收开关默认关闭，实现侧误跑会直接提示并以退出码 `2` 结束。
Node 侧不受影响：`npm run build`、`npm test`（纹理间 4 套 Node 测试共 34 项 + 本地服务器自检 + 静态自检）照常可跑。
详见 [tests/README.md](tests/README.md)。

> 说明：仓库根 `package.json` **不设** `"type": "module"`——`tools/texture` 的那份 Node 测试套件是
> 上游原样的 CommonJS（`require("./engine.js")`），设成 module 会让它全部失败。构建与脚本一律用 `.mjs`。

`npm run build` 会：Vite 打包多页入口 → 复制原样搬运的静态工具 → 构建 `tools/psychos`。

## 许可

第三方来源与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)，许可原文见 [`third-party-licenses/`](third-party-licenses/)。

`tools/texture` 为用户原创项目（含 `curve-fit.js`），已确认可公开，源码逐字节原样收录。
本项目整体尚未选定对外许可证，在以权利人的决定为准之前视为保留所有权利。
