# CHANGELOG

本文件只记录可核对的改动，不写规划。

## [未发布] integration/first-batch · 第一轮批量整合

### 修复：SVG立体导出预览清屏 + 表面贴图选择竞态（Codex 浏览器回归后修复）
- 导出 PNG 的 `toBlob` 回调恢复预览渲染尺寸后立即 `renderer.render(scene, camera)` 重绘一次：
  `renderer.setSize` 会清空画布，此前要等下一帧 RAF 才恢复，导致 Codex 复验时「曲线超限拒绝后
  `canvasLooksDrawn`」偶发 `opaqueRatio=0`。导出语义（倍率 / 透明背景 / 文件名）不变。
- 表面贴图加载序列号 `++textureSeq` 移到 `loadTextureFile` 开头（非空文件之后、MIME / 体积校验之前）：
  最新一次选择即使是会被拒的非白名单 / 超大文件，也会先作废更早的「进行中」加载，不再让过期回调
  `acceptTexture` 顶替 baseline 贴图并清掉 `setError` 的拒绝原因；原有回调 seq 守卫与
  「加载中点移除贴图 → 保持为空」行为不变。
- `tests/specs/extrude3d.mjs`：导出 PNG 断言改为真正解码下载到的字节（data URL → `Image`），在
  40×40 下与预览画布比对（覆盖像素数 / 模型内部差异允许抗锯齿容差），并要求存在带 alpha 的彩色模型
  像素——不再只看 map 标志或 IHDR 头，且复用同一次导出、不重复导出。
- 新增紧凑浏览器回归：页内用 `canvas.toBlob` 生成 PNG `File` + `DataTransfer`，同一 tick 内
  pending.png → invalid.txt，断言 baseline（test-photo.png）保留且拒绝原因不被清掉；再加
  「加载中点移除贴图」断言贴图保持 `null`。全部使用浏览器内建能力，不写自定义图像算法。
- Codex 已在 a5fc0c0 独立跑过主要操作（SVG立体既有规格 59/60 PASS，唯一失败即上述偶发清屏）；
  本轮新增 / 加强的浏览器断言待 Codex 复跑（`IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d`）。
  实现侧只跑纯 Node：`npm run check`（41 项）、`npm test`（5 套 Node 测试共 35 项）、`npm run build` 全过。
- 未改纹理间原 8 份源码，未新增依赖 / 后端 / CDN，未启动浏览器 / Chrome。

### 第五轮：SVG立体新增基础色表面贴图（用户专项授权）
- `tools/extrude3d` 材质区新增可访问中文 UI「上传表面贴图」（`#texture-file`，accept PNG / JPEG / WebP）
  与「移除贴图」（`#texture-remove`），文件名与状态显示在 `#texture-name`（`aria-live="polite"`）。
- 接线只用现成件：three 0.186.1 自带 `TextureLoader` + blob URL（本地读取，零网络请求）载入图片，
  设 `SRGBColorSpace`，挂到 `MeshPhysicalMaterial.map`；UV 直接用上游 `@visant/extrude3d` 0.1.0
  `buildExtrudedGeometry` 已生成的三平面 UV，不写自定义着色器 / UV 算法，不打包贴图素材，
  不做法线 / 粗糙度 / 置换编辑器。
- 校验：MIME 白名单（`image/png`、`image/jpeg`、`image/webp`）→ 体积 ≤10 MiB → 实际解码成功 →
  单边 ≤4096 像素；不通过时给出中文原因（「贴图未更换」）并保留当前贴图与模型。
- 颜色语义：未勾选「自定义颜色」且贴图激活时基色用 `#ffffff`（贴图按原色显示）；勾选后可用颜色给贴图染色；
  「移除贴图」释放贴图并恢复材质预设颜色。切换材质预设、重建几何、导出 PNG 都保留贴图。
- 资源生命周期：成功 / 失败 / 过期均 `URL.revokeObjectURL`；替换 / 移除 / 过期回调都 `texture.dispose()`；
  加载序列号丢弃过期回调（含「加载中点移除贴图」与「连续换图」）；file input 每次处理完即重置，可重复选同一文件。
- 调试钩子只在既有 `window.__extrude3d.getInfo()` 增加最小只读字段 `texture`（`{name,width,height}` 或 `null`），
  不新增测试专用 API。
- 测试：`tests/specs/extrude3d.mjs` 新增表面贴图断言——真实 PNG 改变画布像素、材质绑定 sRGB map 且基色为白、
  自定义颜色可染色、切换材质 / 切换 SVG 后贴图保留、伪 PNG（解码失败）与非白名单类型被拒且保留好贴图、
  移除后 `map` 为 `null` 且基色恢复预设颜色（黄金 `#ffd891`）且像素变化、重选同一文件可再次上传、
  贴图激活时导出 PNG 非空。浏览器验收仍由 Codex 执行（`IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d`），
  实现侧不启动 Chrome。
- 文案：材质帮助改为「预设提供基础光泽，上传图片提供表面图案」；README 同步；不改纹理间原 8 份源码，
  不新增依赖 / 后端 / CDN / 规划文档。
- 验证：`npm run check`（41 项全过）、`npm test`（5 套 Node 测试共 35 项 + 静态自检全过）、`npm run build` 通过；
  浏览器断言待 Codex 复验。

### 第四轮：名称定稿与轻量提示文案（不新增渲染 / 业务功能）
- 首页 12 个入口名称定稿：`texture` 纹理间（保护原 8 份源码）、`pixelit` 像素画、`image-to-pixel` 图片抖动、
  `image-to-ascii` 字符画、`shaders-logo` 标志材质、`shaders-bg` 动态背景、`shaders-halftone` 半调网点、
  `extrude3d` SVG立体、`psychos` 图片拼贴、`space-type-generator` 动态文字、`shader-lab` 图片特效、`tooooools` 图像网点。
- 首页卡片类别行不再拼接英文副标题；`tools.js` 的 `en` 字段保留，仅用于来源记录与关键词搜索，类别仍用现有中文分类。
- `tools/extrude3d`：页面标题 / 窗口标题 / 画布 `aria-label` 改「SVG立体」；「挤出参数」改「立体设置」、
  「圆滑度」改「平滑度」、「PNG 倍率」改「导出尺寸」、「覆盖预设颜色 / 粗糙度」改「自定义颜色 / 自定义粗糙度」；
  材质帮助改成可读操作提示，并如实说明「石材、木材等为基础光泽效果，暂不含纹理」；
  去掉「本工具不另写材质参数」「程序化环境反射」「文件名形如 extrude3d-*.png」等实现说明。
- 材质中文名复核 38 项全部为中文：`chrome` 镜面金属、`glass` 透明玻璃、`diamond` 水晶效果、
  `y2kGloss` 亮面、`candyInflate` 糖果塑料；其余保留常用中文；`value`（上游 preset id）与实际参数一律未改。
- 其他自建适配页只改常用中文标题 / 去掉英文装饰副标题（`shaders-logo` / `shaders-bg` / `shaders-halftone` /
  `image-to-pixel` / `psychos`）；未翻译第三方 psychos 节点编辑器与 pixelit / ascii 原 UI，未改动纹理间原 8 份源码，
  未修改外部网站。
- 测试同步：`home` / `image-to-pixel` / `shaders-logo` / `extrude3d` 的名称断言改为新名称；
  `tests/specs/extrude3d.mjs` 新增轻量浏览器断言——38 个材质预设全部有中文名、`value` 不变且无重复、
  常用材质（塑料 / 镜面金属 / 透明玻璃 / 黄金）可从下拉选中并生效。浏览器仍由 Codex 执行，实现侧不启动 Chrome。
- 边界（本轮不变）：只保留现有 SVG 立体工具，不建高级入口、不接 vgpu / 路径追踪，不新增依赖 / 后端 /
  材质算法或纹理库，不新建规划文档。
- 验证：`npm run check` 与 `npm run build` 通过（纯 Node，未启动浏览器）。

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
