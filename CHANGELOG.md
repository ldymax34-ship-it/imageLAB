# CHANGELOG

本文件只记录可核对的改动，不写规划。

## [未发布] integration/first-batch · 第一轮批量整合

### 第二轮：首页视觉调整（名称定为 ImageLAB）
- 名称统一为 **ImageLAB**（`I` 大写 / `mage` 小写 / `LAB` 大写）：首页标题、页脚、`package.json`、README 同步。
- 首页配色收敛为纯白 `#fff` + 纯黑 `#000`，次要信息只用中性灰；删除米色 / 暖白 / 棕灰变量、渐变、圆角与过渡动画。
- hero 直接复用已批准的 `public/brand/ImageLAB-logo-preview.png` 字标，CSS 按字形外框裁掉四周空白（不改图片字形、不重绘），
  桌面占 9/12 栏；顶部改为小字号 `INDEX` / `TOOLS` + 一行中文说明。
- 全部视图改为同一条连续 12 栏网格（桌面 3 列、≤1000px 2 列、≤660px 1 列），筛选与搜索仍有效，消除「某类别只剩 4 栏」空档。
- 卡片文案去掉实现术语（`image-to-pixel` 的「调色板用数组定义」改为设计师可读的用途）。
- 验证：`npm test`（纹理间 Node 测试 + `scripts/check.mjs` 静态自检）与 `npm run build` 通过；浏览器验收与封面生成仍由 Codex 执行，本记录不代表浏览器已验收。

### 新增：仓库骨架
- 建立单仓库多页结构：首页 `index.html` + `tools/<id>/` 独立工具网页。
- `vite.config.mjs`：多页入口自动发现（只认带 `<!-- imagelab:entry -->` 标记的 `tools/<id>/index.html`），
  `base: "./"`、`assetsDir: "build"`、公共资源走 `publicDir`。
- `scripts/copy-static.mjs` + `scripts/static-tools.json`：把「原样搬运」的静态工具目录与
  `README.md` / `THIRD_PARTY.md` / `CHANGELOG.md` 复制进 `dist`（保证首页页脚链接不 404）。
- `scripts/build-psychos.mjs`：`tools/psychos` 自带构建链，输出到 `dist/tools/psychos`；失败只警告不阻断整站。
- `scripts/serve.mjs`：绑定 `127.0.0.1` 的极简静态服务器。
- `启动图像实验室.command`：macOS 一键启动（自动装依赖 → 构建 → 起服务 → 开浏览器）。
- `scripts/make-fixtures.mjs`：程序生成测试素材（不是私人素材、不是 AI 图）。

### 新增：首页
- 12 栏网格、微暖白 `#f6f4f1` + 近黑 `#14120f`、浅灰分割线、无圆角胶囊 / 无彩色装饰 / 无玻璃拟态。
- 大标题 + 一行介绍 + 分类筛选 + 关键词搜索 + 工具卡片（中文名 / 短描述 / 类别 / 进入链接 / 真实封面）。
- 封面缺失时退化为中性文字占位，不显示破图，也不伪造效果图。
- 文案按 Codex 验收意见收敛：去掉「无后端 / API / CDN / 模型」术语堆叠，
  改为「生成纹理、处理图片、探索材质。调好参数，直接出图。素材本地处理，不上传。」

### 新增：工具 ① 纹理间（`tools/texture`）
- 从用户的只读副本逐字节复制 8 份源码 + 7 份测试文件，**未改一行**（`shasum` 16/16 一致）。
- `curve-fit.js` 为用户本人原创，用户已确认可公开，此前 TOOL_INDEX 中的「许可待查」撤销。

### 新增：工具 ② pixelit（`tools/pixelit`）
- 搬运上游 `docs/` 网页 UI + 本地 MIT 库（`dist/pixelit.min.js`）。
- 远程依赖清理：删除 github / twitter / buymeacoffee 外链与远程图片；
  `style.min.css` 首部 Google Fonts `@import` 换成本地 Open Sans 400/700（含 OFL 正文）。
- 本地示例图 `assets/sample.png`（程序生成测试图）。

### 新增：工具 ③ Image-to-Pixel（`tools/image-to-pixel`）
- 只使用上游 **MIT 的库本体** `image-to-pixel.js`（逐字节），未使用 Apache-2.0 的应用部分。
- 自建最小外壳：上传、输出宽度、抖动方式、强度、**数组调色板**、PNG 导出。
- 调色板只走数组，彻底切断上游「传 Lospec slug 会 fetch 远程 JSON」这条路径。

### 新增：工具 ④ Image-to-Ascii（`tools/image-to-ascii`）
- 搬运上游网页 UI；把外链占位图本地化为 `assets/sample.png`（`index.js` 仅改这一行）。
- 补最小 PNG 导出 `export-png.js`：复用上游已画好的 `#ascii-canvas` + `toBlob()`，不重写算法。

### 新增：工具 ⑤⑥⑦ Paper Shaders 三入口
- `tools/shaders-logo`：Logo / 图片遮罩（液态金属、gem-smoke），复用官方 `toProcessed*` 预处理。
- `tools/shaders-bg`：动态背景效果集。
- `tools/shaders-halftone`：CMYK 半调、网点半调、图片抖动。
- 只用包内导出的 fragment shader 常量 + 官方 `ShaderMount`，不自研 Shader；锁定 `0.0.81`，保留 NOTICE。

### 新增：工具 ⑧ SVG 挤出三维（`tools/extrude3d`）
- `three@0.186.1` + `@visant/extrude3d@0.1.0`：SVG 导入、厚度/倒角/圆滑度、OrbitControls、材质预设、
  环境光与背景、PNG 导出（支持透明背景）。
- 危险/复杂 SVG（`<text>` / `<image>` / 滤镜 / 渐变描边 / 超大文件 / 超量路径）明确拒绝并给出中文原因。
- 界面文案按要求去术语化（不暴露 `MATERIAL_UI` / `resolveMaterial` / `RoomEnvironment` / `PMREM` / 顶点预算细节）；
  库来源与「上游 0.1.0 精选列表无陶瓷预设」的说明只写在 `THIRD_PARTY.md`。

### 新增：工具 ⑨ psychos 生成式版式（`tools/psychos`）
- vendor 上游节点式工具并独立构建到静态子路径 `dist/tools/psychos`，保留原节点 UI。
- 切除 `Remove Background` 节点及其远程模型下载（Transformers.js），补丁记于 `tools/psychos/PATCHES.md`。

### 文案与呈现
- 自建外壳的界面文案统一去掉开发术语（不出现包名、函数名、`uniform`、preset id、顶点预算等实现细节）；
  参数名用中文（厚度 / 倒角 / 圆滑度 / 材质 / 环境光 / 背景），材质下拉显示中文短名且不重复 id；
  库来源与「上游界面精选里没有陶瓷」这类说明只写在 `THIRD_PARTY.md`。
- 首页与工具页不再堆叠「无后端 / API / CDN / 模型」式表述。
- 首页封面一律要求是工具**真实导出画面或画布区域**；封面尚未生成时显示中性文字占位，
  不显示破图、也不摆伪造的效果图。

### 测试与验收
- `tests/harness.mjs`：Puppeteer Core + 本机 Chrome；独立 `--user-data-dir`（不碰用户 Chrome）；
  成功 / 失败 / 中断都在 `finally` 与信号处理里关闭浏览器与 dev server。
- `tests/specs/<id>.mjs`：每个工具一份规格（进入 → 上传 → 调参 → 导出 → 断言 PNG 尺寸 / WebGL / WebGPU）。
- `tests/browser-policy.mjs`：**浏览器验收默认关闭**，统一由 Codex 显式 `IMAGELAB_BROWSER_TESTS=on` 执行；
  实现侧误跑直接退出码 2，避免误启动浏览器。
- `scripts/check.mjs`（`npm run check`）：纯 Node 静态自检——目录约定、入口标记、远程资源、
  **界面术语**、**JS 查询的 id 与 HTML 是否一致**、**规格引用的控件是否存在**、纹理字节一致性、
  许可齐备、版本锁定、首页清单与规格对齐、dist 产物与**页脚文档链接不 404**。
- `scripts/capture-covers.mjs`：服务构建产物 `dist/`，按「真实导出优先、否则只截画布区域」生成封面；
  封面缺失属于「待生成」，不会被当成通过。

### 文档
- `README.md`、`THIRD_PARTY.md`、`third-party-licenses/`（含 Paper Shaders NOTICE 原文）、`tests/README.md`。

### 明确跳过
- 无有效 LICENSE 原文的候选（ditherjs、app-asset-generator、imageCutter 等）一律不接入。
- `@visant/logo-trace` 浏览器可行性未证实、`vgpu` 提取成本过高，本轮不接入。
