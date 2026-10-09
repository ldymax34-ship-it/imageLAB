# CHANGELOG

本文件只记录可核对的改动，不写规划。

## [未发布] integration/first-batch · 第一轮批量整合

### 第六轮：SVG立体背景图片、全站中性化与 3D 冻结（本批）
- extrude3d 新增背景图片（用户专项授权）：本地 PNG / JPEG / WebP（≤10 MiB、单边 ≤4096，白名单 + 实际解码）
  挂 three 原生 `scene.background`，用 `repeat` / `offset` 按视口做居中 cover，1×–3× 缩放；默认纯色改纯白 `#ffffff`。
- 背景与表面贴图独立；透明时抑制、关闭后恢复；移除回到所选纯色；失败 / 竞态保留原背景并释放 blob URL 与被替换贴图；导出 PNG 真实含背景。
- 九工具界面与共享返回链接统一白 / 黑 / 中性灰（含 favicon），保留布局、功能、画布 / 素材 / 材质调色板与 9 张真实封面。
- 封面：extrude3d 封面刷新为默认白背景的真实 PNG 导出（1280×935，约 169 KB），随本批提交。
- 字节校验：整合副本仅 `tools/texture/style.css` 改主题，7 份非样式源码逐字节一致；`_source_snapshot` 8 份根原件哈希未改动。
- 冻结：3D 保持可访问、不再新增 3D 功能；后续 UI 一律白 / 黑 / 中性灰。
- 验证：`npm run check`（42 项）/ `npm test` / `npm run build` 通过；Codex 独立复跑生产浏览器验收 **310/310 PASS**（SVG立体 81、home 63、ASCII 11、dither 34、pixelit 9、psychos 20、bg 37、half 29、logo 19、texture 7），另审计 9 页可见 UI 0 个非中性色，背景上传 / cover / 缩放 / 导出 PNG / 透明恢复 / 移除 / 竞态全过。

### 修复与第四 / 第五轮：中文名、基础色表面贴图与导出清屏（Codex 浏览器复验通过）
- 第四轮名称定稿：首页 12 个入口（9 内置 + 3 外链）用常用中文名，卡片不再拼英文副标题；
  `tools/extrude3d` 38 个材质预设全部中文名，`value`（上游 preset id）不变且无重复。
- 第五轮基础色表面贴图（用户专项授权）：材质区上传本地 PNG / JPEG / WebP，经白名单 + 实际解码 +
  ≤10 MiB / 单边 ≤4096 像素校验，用 three 自带 `TextureLoader`（blob URL）与上游三平面 UV 挂 `map`；
  未自定义颜色用纯白显示原色，勾选可染色，移除恢复预设颜色；素材只本地读取、不上传，无效文件给中文原因并保留当前贴图与模型。
- 修复：`renderer.setSize` 清屏后立即补绘一帧（导出回填预览尺寸、resize 均生效）；贴图加载序列号移到
  `loadTextureFile` 开头，最新一次选择即使会被拒也先作废更早的进行中加载。无新增依赖 / 后端 / CDN / 贴图素材。
- 验证：Codex 独立复跑 SVG立体 65/65 PASS（真实下载 PNG 解码比对、透明背景、贴图 / 材质 / 预设 / SVG 持久化、
  清除 / 重选、无效文件、异步最新-无效 / 取消竞态、拒绝复杂 SVG 后保留原模型）；PNG / JPEG / WebP 均可载入，
  >10 MiB 与 4097×1 被拒且保留原贴图；纯 Node `npm run check`（41 项）、`npm test`（35 项）、`npm run build` 全过。

### 第二轮：首页视觉调整（名称定为 ImageLAB）
- 名称统一为 **ImageLAB**（`I` 大写 / `mage` 小写 / `LAB` 大写）：首页标题、页脚、`package.json`、README 同步。
- 首页配色收敛为纯白 `#fff` + 纯黑 `#000`，次要信息只用中性灰；删除米色 / 暖白 / 棕灰变量、渐变、圆角与过渡动画。
- hero 直接复用已批准的 `public/brand/ImageLAB-logo-preview.png` 字标，CSS 按字形外框裁掉四周空白（不改图片字形、不重绘），
  桌面占 9/12 栏；顶部改为小字号 `INDEX` / `TOOLS` + 一行中文说明。
- 全部视图改为同一条连续 12 栏网格（桌面 3 列、≤1000px 2 列、≤660px 1 列），筛选与搜索仍有效，消除「某类别只剩 4 栏」空档。
- 卡片文案去掉实现术语（`image-to-pixel` 的「调色板用数组定义」改为设计师可读的用途）。
- 验证：`npm test`（纹理间 Node 测试 + `scripts/check.mjs` 静态自检）与 `npm run build` 通过；浏览器验收与封面生成仍由 Codex 执行，本记录不代表浏览器已验收。

### 第三轮：首页新增 3 个外部网站跳转入口（仅跳转，不接入）
- 首页登记 3 个已核实公开官网的外链卡片：`space-type-generator`（动态文字 / 字符与文字）、
  `shader-lab`（效果堆叠 / 着色器效果）、`tooooools`（图像网点 / 像素与点阵）；**入口总数为 12（9 内置 + 3 外部）**。
- 数据只用最小字段 `external: true` 区分：外部卡片封面区域渲染为明确文字入口「外部网站 · 跳转官网」+ 域名，
  按钮为「打开官网 ↗」；封面区与按钮均 `target="_blank" rel="noopener noreferrer"`。
- 只做跳转：不部署、不复制源码 / 字体 / 媒体、不下载封面、不 iframe、不引入运行时外部请求或依赖；
  第三方站点的 `free` 声明不当作代码授权。
- 首页标题 / description / tagline / lede 措辞收紧：只声明 **9 个内置工具**本地处理素材、不上传；
  外部网站入口只做跳转，页面与数据处理由对方负责，不作「已验证不上传 / PNG 通用保证」。
- 保持首页纯白黑、ImageLAB 字标与 9 个内置工具封面 / UI 源码不动；不新增 tab / filter 开关，搜索分类沿用现有系统。
- `scripts/check.mjs`：内置入口继续校验本地文件 / 封面 / spec / dist；外部入口只校验为合法 HTTPS 地址且不声明封面。
- `tests/specs/home.mjs`：新增少量外部卡片回归（标注 / 按钮文案 / 两处链接 target-rel / 准确网址 / 关键词搜索），
  不向外部 fetch（避免 CORS 假失败）；原 9 个内置封面与入口可达断言不降低（封面数量固定 9 且全为真实封面）。
- 验证：`npm run check` 与 `npm run build` 通过（纯 Node，未启动浏览器）。

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
