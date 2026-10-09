# ImageLAB

名称拼写固定为 **ImageLAB**（首字母 `I` 大写、`mage` 小写、`LAB` 大写）。

生成纹理、处理图片、探索材质。调好参数，直接出图。9 个内置工具在本地处理素材、不上传。

一个**纯静态、纯前端**的图像设计工具箱：首页 `index.html` + `tools/<id>/` 下的独立工具网页。
内置工具只在本地浏览器里处理素材，不上传；没有数据库、没有账号、没有服务端渲染、也没有运行时远程模型或 API。
首页另登记 **3 个外部网站入口，只做跳转**（外部网站内容由对方提供，本项目不部署、不复制源码、不下载封面、不 iframe、
不引入运行时外部请求），因此「素材不上传」只适用于 9 个内置工具，不构成对第三方网站的保证。

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

> 首页视觉：纯白 + 纯黑 + 中性灰，hero 复用 `public/brand/ImageLAB-logo-preview.png` 字标（CSS 裁空白），
> 全部视图为连续 12 栏网格。首页回归：9/9 内置真实封面、9 个内置入口 HTTP 200、bayer 搜索、
> 分类、1440 与 390 宽无横向溢出、body 纯白；外部入口只断言标注 / target-rel / 网址 / 关键词，不向外部发请求。

## 工具清单与状态

| 入口 | 工具 | 站点内页面地址 | 主要能力 | 导出 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `tools/texture/` | 纹理间 | `tools/texture/index.html` | 点阵渐变与曲线纹理，参数化无缝图案 | PNG / SVG / 参数 JSON | 已通过浏览器验收 |
| `tools/pixelit/` | 像素画 | `tools/pixelit/index.html` | 上传图片像素化，像素尺寸 / 调色板 / 灰度 | PNG | 已通过浏览器验收 |
| `tools/image-to-ascii/` | 字符画 | `tools/image-to-ascii/index.html` | 图片转字符画，保留明暗关系 | PNG | 已通过浏览器验收 |
| `tools/extrude3d/` | SVG立体 | `tools/extrude3d/index.html` | SVG 挤出、厚度 / 倒角 / 平滑度 / 材质 / 基础色表面贴图 / 环境与背景 | PNG（可选透明背景） | 已通过浏览器验收（29 项）；表面贴图新增断言待 Codex 复验 |
| `tools/image-to-pixel/` | 图片抖动 | `tools/image-to-pixel/index.html` | 像素化 + 7 种抖动 + 数组调色板 | PNG | 已通过浏览器验收（34 项） |
| `tools/shaders-logo/` | 标志材质 | `tools/shaders-logo/index.html` | 液态金属等着色器 Logo / 图片遮罩 | PNG（单帧） | 已通过浏览器验收（19 项） |
| `tools/shaders-bg/` | 动态背景 | `tools/shaders-bg/index.html` | 动态背景效果集 | PNG（单帧） | 已通过浏览器验收（8 效果 / 参数 / 单帧 PNG） |
| `tools/shaders-halftone/` | 半调网点 | `tools/shaders-halftone/index.html` | CMYK 半调、网点半调、图片抖动 | PNG（单帧） | 已通过浏览器验收（28 项） |
| `tools/psychos/` | 图片拼贴 | `tools/psychos/index.html`（需先 `npm run build` 再 `npm run serve` 打开） | 节点式生成式版式：Grid / Shuffle / Slice / Place | PNG 2048×2048 | 已通过浏览器验收（20 项，需 WebGPU） |

首页按上表登记全部 9 个内置入口（含 `tools/psychos`）；浏览器验收此前已全部完成（真实上传、调参、
下载 PNG；GPU 工具断言 WebGL2 / WebGPU 真实可用）；第五轮新增的 SVG立体表面贴图断言待 Codex 复验
（见下方 `tools/extrude3d` 说明）。首页回归：9/9 内置真实封面、9 个内置入口 HTTP 200、
bayer 搜索、分类、1440 与 390 宽无横向溢出、body 纯白，全部通过。

> 上一轮为**轻量名称 / 提示文案调整**：不新增渲染或业务功能，只保留现有 SVG 立体工具（`tools/extrude3d`），
> 不建高级入口、不接 vgpu / 路径追踪，不新增依赖、后端、材质算法或纹理库。首页卡片类别行只显示现有中文分类
> （`en` 英文副标题仅保留在数据字段里，供来源记录与搜索）。`tools/extrude3d` 的 38 个材质预设统一显示中文名
> （如镜面金属 / 透明玻璃 / 水晶效果 / 亮面 / 糖果塑料）；石材、木材等预设只提供**基础光泽**，
> 如需表面图案可在材质区**上传本地图片**作为基础色贴图（素材只在本地读取，不上传）；
> 未翻译第三方 psychos 节点编辑器与 pixelit / ascii 原 UI，未改动纹理原 8 份源码。

### 外部网站入口（仅跳转，不接入）

首页另有 3 个已核实公开官网的外链卡片（`external: true`）：封面区域是明确的文字入口「外部网站 · 跳转官网」，
按钮为「打开官网 ↗」，封面区与按钮均 `target="_blank" rel="noopener noreferrer"`。它们不是内置开源接入：
不部署、不复制源码 / 字体 / 媒体、不下载封面、不 iframe、不引入运行时外部请求或依赖；第三方站点的 `free`
声明不当作代码授权。

| 入口 id | 名称 | 类别 | 官网地址 |
| --- | --- | --- | --- |
| `space-type-generator` | 动态文字（Space Type Generator） | 字符与文字 | https://spacetypegenerator.com/ |
| `shader-lab` | 图片特效（Shader Lab） | 着色器效果 | https://eng.basement.studio/tools/shader-lab |
| `tooooools` | 图像网点（Tooooools） | 像素与点阵 | https://www.tooooools.app/ |

搜索分类沿用现有系统（不新增 tab / filter 开关）。`scripts/check.mjs` 对内置入口校验本地文件 / spec / dist，
外部入口只校验是合法的 HTTPS 地址且不声明封面；`tests/specs/home.mjs` 只对外部卡片断言标注 / target-rel /
准确网址 / 关键词搜索，不向外部 fetch（避免 CORS 假失败）。

`tools/extrude3d` 的本地 SVG 导入上限为 64 KB；单个 `<path>` 曲线过多时，会在挤出前按上游曲线细分
采样轮廓点估算顶点数，超过顶点预算即拒绝并保留上一次成功模型（已由浏览器验收断言：复杂单 path
400 曲线被拒绝且原模型保留）。

`tools/extrude3d` 新增**基础色表面贴图**（用户专项授权）：在材质区上传本地 PNG / JPEG / WebP，
经白名单 + 实际解码 + 体积 / 尺寸校验（≤10 MiB、单边 ≤4096 像素）后，用 three 自带的 `TextureLoader`
（blob URL）与上游已生成的三平面 UV 接到 `MeshPhysicalMaterial.map`；未自定义颜色时基色用纯白让贴图原色显示，
勾选自定义颜色可用颜色给贴图染色，移除后恢复材质预设颜色。不打包任何贴图素材，不加法线 / 粗糙度 / 置换编辑器，
不新增着色器 / UV 算法 / 依赖 / 后端 / CDN；无效文件给出中文原因并保留当前贴图与模型。
对应的浏览器断言（`tests/specs/extrude3d.mjs`：真实贴图改变像素与导出 PNG、随材质 / 几何保留、
移除恢复无贴图、无效文件保留好贴图）**待 Codex 复验**，本仓库不自行启动浏览器。

`public/assets/covers/*.png` 是 9 张真实工具 PNG 导出（互不相同，实际内容已核验），由
`IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs` 生成（先服务构建产物 `dist/`；
优先取工具真实导出，退路只截真实预览画布，不截节点编辑器 UI；每个工具使用独立临时下载目录，
只等待本次导出结果）。封面缺失时首页显示中性文字占位，不会破图、也不会用 AI 图或整页截图冒充效果图。

`tools/psychos` 不参与主站 Vite 多页打包，由 `scripts/build-psychos.mjs` 单独构建；它需要 WebGPU
与安全上下文，因此请先 `npm run build`、再用 `npm run serve`（构建产物）打开，而不是 `npm run dev`。

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
| `tools/psychos`（图片拼贴） | 需要 **WebGPU**，且必须在 `http://127.0.0.1` 或 HTTPS 这类安全上下文下打开 |

## 测试与验收

本批次的**浏览器验收此前已完成**（用真实 Chrome 驱动交互：上传图片、调参、点导出并校验下载到的
PNG 尺寸；GPU 工具断言 WebGL2 / WebGPU 真实可用）；第五轮新增的表面贴图断言待 Codex 复验。需要复跑时：

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
