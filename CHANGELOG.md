# CHANGELOG

### 2026-10-15 · 色散光束作用于用户 SVG（替换固定「官方棱镜」场景）+ 三个设计师参数

范围（用户本轮明确授权）：`tools/extrude3d`（建模→渲染外轮廓交接、渲染页光束与玻璃参数、上游 optics
泛化、删除固定棱镜场景）、`tests/`（新增 `extrude3d-beam.test.mjs`、更新静态 / mock / 浏览器规格）、
`THIRD_PARTY.md`、`tests/README.md`。只做开源方案整合与最小适配；不新增依赖，不升级 vgpu（仍锁 0.6.0）。
DSH 桌面客户端不可用，本轮由 Codex 直接实施；不 push、不合并 main。**上一轮的「官方棱镜」固定场景已被本轮替换。**

- **需求纠正**：三角棱镜只作为 vgpu 官网效果与实现参考，不再是独立固定场景。渲染材质区的「场景」下拉已删除；
  改为「色散光束」开关 + 光束方向 / 位置 / 强度三个基础参数，白光打在**当前用户 SVG 挤出模型**上，
  显示内部折射与出射彩色色散。
- **建模→渲染交接外轮廓**：`modeling.js` 在 `buildSnapshot()` 里额外交接 `outline`——把解析后的
  `shape.getPoints()` 映射到渲染页同一套世界 XY（已居中 / 按 baseScale 缩放 / Y 轴翻转），
  `beam-outline.js` 负责去重、按弧长限到 64 点、统一逆时针、判凸（容差按尺寸归一化，近似凸形放行）。
  不满足时返回中文原因（多轮廓 / 孔洞 / 凹形 / 退化），渲染页只关闭可见光束，**玻璃的折射、色散、吸收、
  背景与透明 PNG 全部保留**。首版只支持单个闭合凸轮廓（含孔洞、明显凹形、自交不做）。
- **上游 optics 最小泛化**：`prism/scene/optics.js` 的三角形专用 `insideTriangle` / `intersectTriangle` /
  `tracePrismDetailed` 泛化为凸多边形版本（`insideConvexPolygon` / `intersectConvexPolygon` /
  `tracePolygonDetailed`），`prism/scene/light-mesh.js` 的 `beamIntersectsTriangle` 同名泛化；数学与上游逐字一致。
  同时**修掉上一轮抄写缺陷**：出射界面 Fresnel 必须传 `-exit.normal`，否则每个出射界面透过率恒为 0、
  出射光谱扇形全黑（上游原文见 `prism-background/scene/optics.ts`）。
- **继续复用上游**：光束网格 / D65 光谱采样 / 内部路径 / Fresnel / 上游三级 Bloom / `light.wgsl` /
  `present` 思路全部沿用官网实现；新增 `prism/beam.js` 只做接线（一条 HDR 光束目标 + 上游 bloom，
  由 `present.wgsl` 加法合成；光束关闭时绑定黑色 1×1 贴图与 0 强度，画面与未接入光束时逐像素一致）。
  **屏幕空间近似**已在 `prism/beam.js` 与 `glass.wgsl` 注释中写明：光束是二维截面光路、画在模型中间深度、
  不写深度，不是逐像素光线追踪。默认光束方向 30°（正对平面入射时各波长折射角相同，物理上不会有色散）。
- **三个设计师参数**（渲染 / 材质分类的玻璃区，0–200%，内部再映射到真实取值，不暴露 WGSL 数值）：
  **色散范围**（`dispersionRange`：100% = 官方 `dispersion_spread` 0.09，200% = 0.18，并同步放大光束
  Cauchy `strength`）、**色彩强度**（`chroma`：只调色度、保亮度，0% 灰度、200% 双倍色度，不再靠提亮 RGB）、
  **折射变形**（`refraction`：只按 `exit_uv = screen_uv + (exit_uv - screen_uv) × refraction` 放大屏幕空间
  折射位移，0% 即不发生位移 = 普通透明玻璃，不改模型几何）。材质预设的 `dispersion` 值按同一条映射同步回滑杆。
- **删除固定棱镜场景**：`prism/pipeline.js`、`prism/scene/prism-mesh.js`、`prism/scene/camera.js`、
  `prism/scene/scene-camera.js`、`prism/pipelines/glass/*`、`prism/pipelines/present.wgsl`、
  `prism/pipelines/presentation/*`、`prism/environment/*`（渲染页不再有 `renderPrismFrame` 分支）。
  保留仍被复用的 `scene/light-mesh.js`、`scene/optics.js`、`scene/scene.wgsl`、`pipelines/light.wgsl`、
  `pipelines/spectral/*`、`pipelines/bloom/*`、`types.js` 与 `prism/LICENSE.txt`（MIT 记录）。
- **回归修复（导出 / 布局竞态，与光束无关但本轮实测暴露）**：vgpu 会在**帧内同步回调** `surface.onResize`，
  原先直接在回调里 `resizeTargets()` 会销毁本帧已绑定的目标贴图（真机报
  `Binding 'back_normal_tex' … destroyed resource`）；现改为只置待处理标记、在下一帧开头统一 resize，
  并在导出期间冻结预览帧（导出尺寸下的目标不被预览 / resize 打断）。浏览器规格里 1× / 2× 导出尺寸改为与
  「点击导出那一刻」的画布比对（状态栏文案换行会让画布高度轻微变化，与导出行为无关）。
- **验证**：`npm run build` 通过；`npm test` **76/76**（含新增 `tests/extrude3d-beam.test.mjs` 7 项与
  mock 光束全链路 1 项，`node scripts/check.mjs` **61/61**）；`git diff --check` 通过。
  真实 Chrome（Apple M5 Pro）`IMAGELAB_BROWSER_TESTS=on npm run smoke -- home extrude3d pixelit
  shaders-halftone image-to-pixel image-to-ascii` **6/6 规格、287 项全过、0 页面错误**，其中 extrude3d
  **91/91**：方形（4 顶点）/ 六边形（6 顶点）/ 圆角徽章 Logo（64 顶点）三种 SVG 都确认白光穿过**当前
  SVG**（黑底上出现光谱彩色像素 160 / 276 / 251 个，光束开关前为 0），光束位置 ±200% 时轮廓外无光路
  （`validBands` 128→0），凹轮廓（十字）保留玻璃并给出中文原因；色散范围 0↔200%、色彩强度 0↔200%
  （模型区平均饱和度 6.3→139.4）、折射变形 0↔200%（1518 个像素变化）分别可见且互不替代；
  光束开启后 PNG 导出为 1070×793、不透明占比 1.000（非空图）。
- **人工抽查（Codex 在真实浏览器截图）**：真实马赛克背景下玻璃前后界面可见、背景图案弯曲错位、
  200% 色散范围出现明显红黄青蓝彩边；六边形模型上白光入射 → 内部折射 → 两处出射彩色扇形；
  光束与背景折射可同时存在。截图落在 `.tmp/beamshots/`（`.tmp/` 已在 `.gitignore`，临时产物不入库）。

本文件只记录可核对的改动，不写规划。

### 2026-10-15 · vgpu 玻璃 Double Refraction + 官方棱镜场景 + 封面刷新 + 像素画中文化（**固定「官方棱镜」场景已被下方同日条目替换**）

范围（用户本轮明确授权）：`tools/extrude3d` 玻璃/棱镜渲染、3 张首页封面、`tools/pixelit` 界面中文化；
只做开源方案整合与必要适配。未接入 vgpu `typegpu-liquid-glass`（评估记录见 `THIRD_PARTY.md`）。
DSH 桌面客户端不可用，本轮由 Codex 直接实施；不 push、不合并 main。

- **SVG 3D 玻璃 Double Refraction**：新增 `glass-back-info.wgsl`，用 vgpu 0.6.0 双颜色附件捕获背面
  世界坐标与世界法线；`glass.wgsl` 在光线离开玻璃时按背面法线执行第二次折射，TIR 回退原有限近似。
  保留任意闭合挤出网格、背面可见、背景上传/移动、黑白背景、色散、吸收与透明 PNG；无 Simple/Double
  切换控件，屏幕空间近似限制已在源码注释声明。
- **官方棱镜场景**：新增 `tools/extrude3d/prism/`，来自 vgpu 官网首页三角玻璃（上游 commit
  `81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5`，MIT），只保留运行时场景、Shader、烘焙环境与相机，
  排除 React 外壳、dust、wireframe、调试/性能面板与主题系统；渲染材质区新增「场景」入口，可在
  「SVG 模型」与「官方棱镜」间切换，切回后保留用户当前 SVG。
- **封面**：`shaders-halftone` / `pixelit` / `image-to-pixel` 改用对应上游仓库官方示意图（来源与
  许可见 `THIRD_PARTY.md`）；`image-to-ascii` 保持现状并标记「素材许可待确认」；
  `assets/tools.js` 16 个 `coverQuery` 统一改为 `20261015-upstream`。
- **像素画中文化**：`tools/pixelit/index.html` `lang=zh-CN` 并翻译操作界面；ID / class / DOM / 事件与
  `pixelit.min.js` 未改，API 方法名、代码示例和 Pixel It 来源名保留英文。

- **验证**：`npm test` **67/67**（含 58 项静态自检）；`node scripts/check.mjs` **58/58**；
  `npm run build` 通过；`git diff --check` 通过。棱镜管线先经 vgpu mock 全链路
  （create → compile → render → resize → render）验证为 `PIPELINE_OK`；真实 Chrome WebGPU 冒烟与
  视觉验收：真实 Chrome（Apple M5 Pro）`IMAGELAB_BROWSER_TESTS=on npm run smoke -- home extrude3d
  pixelit shaders-halftone image-to-pixel image-to-ascii` **6/6 规格、275 项全过、0 页面错误**，
  其中 extrude3d **79/79**（7 材质、透明 PNG 1×/2×、背景上传/缩放/平移、玻璃前后界面）。
  修复合入前曾出现的「玻璃背面信息预通道未随双附件目标编译」回归（单输出 shader 误编译到
  双颜色附件 target），根因修复后真机管线创建成功。另以临时 Playwright 脚本在真机切换
  `#render-scene`：官方棱镜编译渲染成功（截图确认为官方三角玻璃 + 白光入射 + 内部光谱色散 +
  出射光，非彩虹渐变贴图），切回 SVG 模型后渲染页签恢复就绪并保留当前网格。PNG 导出经
  smoke 实测四角 alpha=0、模型像素保留，非透明空图。

## [未发布] integration/first-batch · 第一轮批量整合

### 2026-10-14 · 刷新全部工具缩略图 + 外链本地缩略图 + 品牌素材生成外链入口（DSH 执行实现；Codex 已完成实际抓图与独立验收）

范围（用户本轮明确授权）：`assets/tools.js`、`assets/home.js`、`assets/home.css`、
`scripts/capture-covers.mjs`、新增 `scripts/capture-external-covers.mjs`、`tests/specs/home.mjs`、
`scripts/check.mjs`、`tests/harness.mjs`（新增可选 `profileDir`）、README / tests README / 变更日志。
**未改**任何内置工具的算法、UI、默认参数与导出结果。DSH 实现阶段**未启动浏览器、未生成任何 PNG**
（该阶段历史事实）；随后由 Codex 在真实浏览器完成 16 张封面的实际抓取与独立验收，本轮最终已本地
commit、**未 push / 未部署**。

- **首页清单（16 入口）**：新增外链入口 `brand-assets-generator`（中文「品牌素材生成」，英文来源名
  Brand Assets Generator，类别「版式与切片」，官网 `https://brand-generator.stoyanov.works/`，
  `external: true`，放在外链区末尾）；原来 3 个外链全部补上本地 cover。首页从 15（12 内置 + 3 外链）
  变为 **16（12 内置 + 4 外链）**。16 个入口统一使用 `coverQuery: "20261014-refresh1"`，避免命中旧封面缓存；
  工具排序逻辑不变。
- **外链封面渲染**：外链卡片在有本地 cover 时于封面区显示本地 `img`（`assets/covers/<id>.png`），
  右下角叠层保留「外部网站 · 跳转官网」标识与主机名；两处链接继续
  `target="_blank" rel="noopener noreferrer"`。`img` 加载失败时退回原有纯文字外链块，不显示破图；
  不新增远程请求、预取或 iframe，运行时首页只加载仓库本地图片。
- **Brand Assets Generator 只作外链**：官网 HTML / 打包 bundle 没有 GitHub 或许可证链接，GitHub 公共搜索
  没有对应仓库 → 未找到公开源码 / 许可证原文，**不能认定开源、不本地镜像源码 / 字体 / 素材**；
  外链封面是验收方从公开官网当前页面截取的本地 PNG，**截图许可不等于代码开源许可**。
- **内置封面刷新脚本**：`scripts/capture-covers.mjs` 更新为当前 12 个内置工具的真实 DOM / 分类结构：
  `extrude3d` 的旧 `#view-canvas` / `#export-png` 已失效，改为「切 `#tab-render` → 等
  `window.__extrude3d.getInfo().render.ready` 为真 → 切「输出」分类（`[data-cat="output"]`）→
  点 `#render-export-png`」，退路只截 `#render-canvas`，WebGPU 未就绪即失败而不是产出空白；
  shader 三工具 / `wave-grid` / `ascii-motion` 的导出按钮位于隐藏「输出」分类，点导出前先切该分类
  （只切换显示，不复制控件、不绕过应用状态）。仍保持「优先真实导出，退路只截真实预览画布」。
- **新增外链封面脚本** `scripts/capture-external-covers.mjs`：默认关闭，复用
  `tests/browser-policy.mjs` 的 `IMAGELAB_BROWSER_TESTS=on` 显式 opt-in；只处理 4 个固定 HTTPS 官网，
  **不接受任意 URL 参数**；使用独立 Chrome profile（`profileDir`，与工具 smoke 分开）、1440×900 视口、
  等待页面稳定后截**当前视口**（非整页长图），缩到 ≤1280px 后保存到 `public/assets/covers/<id>.png`；
  来源 URL 写入 `public/assets/covers/external-covers.json`；不抓源码、不下载站点资源进仓库、
  不使用远程图作为运行时依赖；页面打不开 / 截图失败即失败退出，**不创建伪封面**。
- **测试**：`tests/specs/home.mjs` 改为 16 入口（12 + 4），外链断言在标注 / target-rel / 网址 / 关键词之外，
  新增「本地 cover img 加载成功」与「cover URL 是站内 `assets/covers`、不是远程 URL」；内置 12 张封面
  改为必须齐备。`scripts/check.mjs` 改为 16 入口，所有入口统一禁止 http(s) 封面，外链封面路径必须位于
  `assets/covers` 且 4 张文件存在。两处都**不 fetch 外链官网**（避免 CORS 假失败）。`tests/harness.mjs`
  的 `launchBrowser` 新增可选 `profileDir`，默认行为不变。
- **抓图（Codex 在真实浏览器实际执行）**：先 `IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs`
  刷新 12 张内置封面，再 `IMAGELAB_BROWSER_TESTS=on node scripts/capture-external-covers.mjs` 抓取 4 张外链
  官网缩略图（均先 `npm run build`，脚本服务的是构建产物 `dist/`）。16 张封面全部存在并已目视确认：
  `shaders-logo.png` **1280×803**，4 张外链封面（`space-type-generator` / `shader-lab` / `tooooools` /
  `brand-assets-generator`）**均 1280×800**；来源 URL 记录在 `public/assets/covers/external-covers.json`。
  未使用占位图。
- **最终验收（Codex 独立执行）**：`npm run build` 通过；`npm test` **67/67**（含 **58 项**内部静态检查）；
  `node scripts/check.mjs` **58/58**（实现阶段的「4 张外链封面文件齐备」失败项已消失）；
  `IMAGELAB_BROWSER_TESTS=on npm run smoke -- home` **113/113**、**0 页面错误**；`git diff --check` 通过。
- **封面产物**：`public/assets/covers/` 下共 16 张 PNG（12 张内置刷新 + 4 张外链新增），
  以及新增 `public/assets/covers/external-covers.json`（4 条来源 URL）。
- **改动文件**：`assets/tools.js`、`assets/home.js`、`assets/home.css`、
  `scripts/capture-covers.mjs`、`scripts/capture-external-covers.mjs`（新增）、`tests/harness.mjs`、
  `tests/specs/home.mjs`、`scripts/check.mjs`、`README.md`、`CHANGELOG.md`、`tests/README.md`、
  `02_OUTPUT/docs/TOOL_INDEX.md`、`00_PROJECT_RULES/{TASKS.md,CHANGELOG.md}`、根 `README.md`。

### 2026-10-14 · 产品级工具工作台 UI 改版：紧凑顶栏 / 分类悬浮检查器 / 画布播放条 / 重置视图（DSH 执行；Codex 真实 Chrome 已验收通过）

范围（用户本轮明确授权）：`tools/shaders-logo`、`tools/shaders-bg`、`tools/shaders-halftone`
（带播放控制的 5 个自建工具）、`tools/wave-grid`、`tools/ascii-motion`，以及 `tools/extrude3d`
的工具工作台布局与渲染页「重置视图」入口；必要测试与状态文档。
**未改** shader、渲染算法、动画算法、现有参数默认值、上传校验、导出结果；未改
`tools/texture`、`tools/pixelit`、`tools/image-to-ascii`、`tools/psychos`、`tools/image-to-pixel`、
`tools/mixed-type` 与首页。

- **根因（为什么改）**：5 个动画工具把效果 / 参数 / 播放控件全部堆在一列侧栏里，桌面 1440×900
  下画布与播放控件会被长参数区挤出视口；播放 / 暂停 / 速度 / 帧散落在参数分组中，导出又埋在末尾；
  extrude3d 的「重置镜头」埋在渲染面板第 04 节长列表底部，用户找不到。本轮只做 UI 组织与
  已有控制能力重排，不新增任何算法或业务能力。
- **桌面工作台骨架（≥1000px）**：`body.il-workspace`（shader 三工具 / wave-grid / ascii-motion）
  与 `tools/extrude3d` 都改为 `100dvh` + `overflow:hidden`，body 不产生纵向页面滚动；紧凑顶栏放
  返回首页、工具名、必要状态（长说明单行省略，小屏恢复换行）；主画布用 `flex/min-height:0` 占据
  剩余工作区，shader / ascii 画布填满剩余区域，wave-grid 竖向画布按可用高度保持 4:5 且宽度 ≤720。
  `tools/extrude3d` 的建模 / 渲染两个主页签保留，改为悬浮检查器 + 视图网格。
- **分类悬浮检查器（300–330px，距工作区边缘 16px，仅内部滚动）**：新增共享组件
  `assets/workspace.css`（骨架 / 分类导航 / 播放条 / 画布工具栏）与 `assets/workspace.js`
  （`mountCategoryTabs`，只切换 `hidden`，不重建控件、不重置参数 / 素材 / 当前帧 / 相机）。
  分类按钮带 `role="tab"` / `aria-selected` / `aria-controls`，面板带 `role="tabpanel"`，
  支持 ←→↑↓ / Home / End 键盘导航。分类：
  shader 三工具统一「素材 / 效果 / 构图 / 输出」（动态背景无素材输入，运行时隐藏空的「素材」）；
  wave-grid「图形（密度 / 图形 / 文字 / 图片）/ 外观（辉光）/ 动效（亮度变化）/ 输出」；
  ascii-motion「图形（预设 / 字符 / 自定义画面）/ 外观（辉光 / 颜色）/ 动效（动作选择）/ 输出」；
  extrude3d 建模「导入 / 几何」、渲染「材质 / 灯光 / 背景 / 输出」。
  所有原有控件 id、值、事件与状态同步保持不变（含 `param-*` 动态容器）。
- **画布下方独立播放条**：shader 三工具把暂停 / 播放、速度、帧（毫秒）滑杆与数值、定格取帧移到
  播放条，PNG 导出仍在「输出」分类；wave-grid 把暂停 / 播放、速度与运行状态移到播放条；
  ascii-motion 把暂停 / 播放、速度与 `frame-info` 移到播放条。播放条在主画面正下方、桌面始终可见，
  一行紧凑布局、窄屏换行；无时间轴效果自动停更逻辑、暂停 / 播放 / 定格行为均未改。
- **extrude3d 重置视图**：`#render-reset-view` 从渲染面板第 04 节移到渲染画布右上角
  `#stage-render .il-canvas-toolbar`，中文名改为「重置视图」，`title` 写明恢复摄像机位置、
  观察中心与模型默认构图；仍复用同一 id 与 `render-vgpu.js` 的 `VIEW_DIR` / `VIEW_DISTANCE` /
  `controls.target` 逻辑，点击调用 `controls.update()`、置脏重绘并反馈「摄像机与模型构图已重置」。
  建模页 `#model-reset-view` 同样移到 `#stage-model` 画布工具栏，保留「重置视角」名称与行为。
  模型没有独立用户变换，未新增对象变换系统。
- **小屏回退（<1000px）**：回到自然文档流，允许页面纵向滚动，画布在前、面板在后，不横向溢出；
  长说明与状态恢复换行，播放条可换行。
- **测试**：新增 `tests/workspace-ui.test.cjs`（10 项纯 Node，内置最小 HTML 解析器）验证 6 个工具的
  分类导航语义与面板对应、分类面板只含各自原有控件、5 个动画工具播放控件只存在一份且都位于
  `[data-playbar]`、播放条在画布之后、`assets/workspace.css` 的 100dvh / 内部滚动 / 小屏回退、
  导航辅助模块不重建或重置控件、extrude3d 主页签与重置视图位置 / 复用 `render-reset-view` /
  桌面不产生页面滚动；并逐工具核对改版前后全部控件 id 仍存在且唯一。
  浏览器规格同步：需要点击隐藏分类里的控件（各工具导出、ascii 颜色 / 动效、extrude3d 背景 / 导出）
  前先切换到对应分类；`tests/specs/extrude3d.mjs` 新增渲染画布工具栏重置视图入口、中文反馈与
  默认机位断言。`package.json` 的 `npm test` 纳入新测试。
- **已跑检查**：`node --check`（改动 JS）、`npm test` **67 项通过 / 0 失败**（含 56 项静态自检）、
  `npm run check` **56/56**、`npm run build`、`git diff --check` 均通过。
  实现侧当时**未启动浏览器**（历史事实）；Codex 随后已完成真实 Chrome 浏览器验收并通过：
  `ascii-motion` **25/25**、`extrude3d` **79/79**、`shaders-bg` **37/37**、`shaders-halftone` **29/29**、
  `shaders-logo` **19/19**、`wave-grid` **51/51**，全部 **0 页面错误**；1440×900 与 390×844 的六工具布局
  验收全部通过（桌面 body 不滚动、画布 / 播放条在视口、检查器 overflow auto；窄屏自然滚动、画布在前、
  面板在后、无横向溢出）。
- **未做**：未改首页、未改未授权工具、未改任何算法或导出结果。**提交状态**：已本地提交
  （最终 SHA 由 amend 后生成）；未 push / 未部署。
- **阻塞（上层文档同步）**：本轮 ACP 工作区（session workspace）只允许写入本仓库
  `02_OUTPUT/code/imageLAB`；尝试同步 `00_PROJECT_RULES/TASKS.md` 时被沙箱以
  `[sandbox: file access denied under workspace-write mode]` 拒绝。按用户指令**不绕过权限、不提权**，
  故上层 `00_PROJECT_RULES/CHANGELOG.md` 与 `TASKS.md` 本轮未写入；待 Codex / 用户在有权限时同步。
  （后续修复轮工作区已可写，根 `00_PROJECT_RULES/CHANGELOG.md` 与 `TASKS.md` 已同步本轮摘要，见下方条目。）

### 2026-10-14 · 修复：统一工作台 UI 造成的 wave-grid 辉光 / 黑留白回归（DSH 执行；Codex 真实 Chrome 复验 51/51）

范围：只改 `tools/wave-grid/main.js` 的画布尺寸适配层与本文档；**未改**共享
`assets/workspace.css` / `assets/workspace.js`，未改其他工具、首页或任何算法。

- **根因（最小因果）**：`layoutCanvas()` 直接拿 `#stage.clientWidth` 当排点 / 渲染基准宽度。统一工作台把
  桌面画布从改版前的 720×900 改为按 `100dvh` 可用高度定宽，1440×960 下 `#stage` 只有约 580×725；
  而辉光长度是固定 72 CSS px，画布缩小时 72px 辉光相对占比变大，黑留白由 20.6% 降到 16.4%，
  旧断言「存在大块黑留白（黑占比 >20%）」与其后的「默认辉光下黑色留白仍 >20%」两项失败。
- **最小修正**：桌面（断点与 `assets/workspace.css` 的 1000px 一致，用 `matchMedia` 判定）固定按
  **720 宽内部渲染基准**排点 / 渲染（720×900），再由 workspace.css 的 ratio 模式等比缩到实际显示尺寸
  580×725，恢复改版前的辉光 / 黑留白比例；小屏（<1000px）仍按真实 `#stage.clientWidth` 渲染。
  即「桌面显示尺寸」与「内部渲染基准」解耦。未改效果算法、色带 / 辉光参数与默认值、用户控件值、
  导出流程、性能预算，也未放宽任何旧视觉断言。
- **验证**：`node --check tools/wave-grid/main.js`、`npm test` **67/67 + 56 静态项**、
  `node scripts/check.mjs` **56/56**、`npm run build`、`git diff --check` 通过；
  `IMAGELAB_BROWSER_TESTS=on npm run smoke -- wave-grid` **51/51 PASS**、0 页面错误
  （黑占比 16.4% → 20.8%，关辉光 90.0% → 开 20.8%；画布像素 720×900、显示 580×725，4:5 与
  播放条在画布下方 / body 不滚动均保持）。
- **未做**：未改其他工具与未授权范围。**提交状态**：已本地提交（最终 SHA 由 amend 后生成）；
  未 push / 未部署。

### 2026-10-14 · 修复：背景图片发白 / 玻璃背面 / 色散默认值 / 黑白纯色预设（DSH 执行；待 Codex 真实 Chrome WebGPU 验收）

范围：`tools/extrude3d`（渲染页签）、其已有测试与状态文档。保持「建模 / 渲染」双页签、7 个中文材质与
Three.js 只做几何 / 灰模诊断的架构，不引入 raymarch / SDF、Three 最终材质、第二套引擎或新依赖。

- **根因 1 · 背景上传后发白（颜色空间）**：本地 PNG / JPEG / WebP 经 `createImageBitmap` +
  `copyExternalImageToTexture` 进入 `rgba8unorm`，字节是 **sRGB 编码值**；整条 vgpu 管线按线性光运算，
  `present.wgsl` 最后才做 ACES + `linear_to_srgb`，于是图片被当成线性值再提亮一遍（128/255 灰 ≈ 显示成
  176/255），中间调与彩色整体发白。修复：`common.wgsl` 新增 `srgb_to_linear`（IEC 61966-2-1，常数与
  `linear_to_srgb` 互逆），**只**在 `background.wgsl` 的图片分支线性化；`render-vgpu.js` 的纯色背景 /
  玻璃 / PBR 基色改经 `Color.setStyle(hex, SRGBColorSpace)` 取线性值（不再用 `new THREE.Color(hex)` 裸值，
  也**不**二次 `convertSRGBToLinear()`）。上传 / 绑定链路复核后未发现第二处 root cause：`bindBackground(next)`
  之后 `bg_tex` 取 `bgTextureGpu || fallbackTexture`，图片模式不会落回 1×1 白色 fallback；移除图片才回退。
- **根因 2 · 透明玻璃「没有背面」**：`glassDraw` 用 `cull: "back"`，最终 `sceneTarget` 只有正面片元；
  `backTarget` 只是辅助纹理（世界坐标 + 命中标记），从不进入最终成像，闭合模型看起来是单层空心壳。
  修复：`glass-back.wgsl` 的同一趟背面片元既写 `backTarget`（正面通道仍按 `back_tex.a > 0.5` 估厚度 / 出射），
  又按背面着色写进 `sceneTarget`；渲染顺序为背（较远）→ 正面（较近，透过深度测试）。背面着色复用官方
  `transmission/glass.wgsl` 的同一套结构：法线朝向 `select(-geometric_normal, geometric_normal, dot(..., view) > 0)`、
  菲涅耳、`studio_env` 环境反射与 `exp(-absorption × path)` 吸收；alpha 记 `(1 - Fresnel)`，与官方的
  `mix(transmitted, reflection, fresnel)` 能量关系一致；透明背景模式整体清零。不引入 raymarch / SDF。
- **根因 3 · 色散几乎看不出**：默认 `dispersion: 0.015` 只有官方 `GLASS.dispersion_spread = 0.09` 的 1/6，
  且旧谱权重与采样数不同。修复：`glass.wgsl` 对齐官方——`TRANSMISSION_SAMPLES = 11`、`GOLDEN_ANGLE = 2.39996323`、
  谱权重 `(0.05 / 0.50 / 0.95)`、宽度 `(0.45 / 0.38 / 0.45)`，`dispersion` 直接作为 `dispersion_spread`
  （谱折射率 `ior ± dispersion / 2`），不加自造增益。预设默认：透明玻璃 `0.09`、彩色亚克力 `0.06`、
  磨砂玻璃 `0`；控件初始值 `0.090`，范围仍 `0–0.2`，`0` 仍表示关闭，整段滑杆连续。
- **根因 4 · 纯色缺少快速预设**：新增「黑色 / 白色」两个快速预设（`BACKGROUND_PRESETS`，中文名直接写
  「黑色」「白色」），默认白色；点击切回纯色并同步颜色输入与 `aria-pressed`，手动改色视为自定义不再点亮预设。
  保留自定义颜色输入与棚拍渐变 / 图片模式，不扩展更多预设。
- **测试**：新增 `tests/extrude3d-color.test.cjs`（3 项，纯 Node）把 `srgb_to_linear` 在 Node 复现，与
  IEC 61966-2-1 参考值及 three 0.186.1 的 `SRGBToLinear` 常数逐项对照；`tests/extrude3d-tabs.test.cjs`
  增加背景绑定不回退白色 fallback、图片线性化、黑白预设映射 / 默认白色、背面写进 `sceneTarget`、
  背面 uniform 结构、色散默认值与官方映射断言；`tests/extrude3d-pipeline.test.mjs` 改为背面 draw 同时
  进 `backTarget` 与 `sceneTarget`；`tests/specs/extrude3d.mjs` 增加默认白 / 黑预设亮度、上传马赛克外圈彩色、
  色散默认值与 0、玻璃前后界面亮度结构的浏览器断言。
- **已跑检查**：`npm test` **57 项通过 / 0 失败**（含 56 项静态自检）、`node scripts/check.mjs` **56/56**、
  `npm run build`、`git diff --check` 均通过。**未启动浏览器**；上传图片观感、玻璃前后界面、色散彩边、
  黑 / 白预设与透明 PNG 仍必须由 Codex 用真实 Chrome WebGPU 视觉验收，本轮不自行宣称视觉通过。

### 2026-10-14 · 修复：背景 `effect()` 全屏通道 / present 深度合成 / GPU 前网格状态同步（DSH 执行；Codex 真实 Chrome WebGPU 已验收 68/68）

- **根因**：`background.wgsl` 是 fragment-only，`render-vgpu.js` 却用 `draw(gpu, { vertices: 3, ... })` 创建背景；
  vgpu `draw()` 默认查找 `vs_main`，真实 Chrome WebGPU 报 `Entry point "vs_main" doesn't exist in shader module draw.shader`。
- **修复（vgpu 0.6.0 官方 API，最小接线）**：背景改用 `effect(gpu, backgroundWgsl)`，由库注入官方内置全屏顶点通道，
  **不自写顶点 shader**。`present.wgsl` 增加 `bg_tex` / `bg_samp`，把模型（带深度的 `sceneTarget`）合成到不带深度的
  `backgroundTarget` 之上；背景不再写入场景深度，模型自遮挡成立。present / PBR / glass / glass-back 的目标格式、
  深度与绑定已复核：`sceneTarget` / `backTarget` 保留深度，`backgroundTarget` / `exportTarget` 无深度。
- **状态同步**：`setMesh(snapshot)` 对合法 snapshot 先保存 `meshSummary`，再判断 GPU 是否可用；即使 WebGPU 尚未初始化
  或初始化失败也能验证建模结果已交接；实际 GPU 上传仍只在设备可用时进行。
- **测试**：`tests/specs/extrude3d.mjs` 厚度断言改为比较 mesh bounds Z / `thickness`，不再用顶点数判断；并恢复适配后的
  关键回归（普通 SVG 上传 / 未使用 defs·metadata 放行 / text·script·内部实体·外部资源·可见滤镜拒绝 / 1 MiB 上限 /
  复杂曲线拒绝与平顺曲线自适应 / 厚度·倒角·比例归一化 / SVG 切换状态保持 / 背景校验·缩放·平移 / WebGPU 7 种真实材质 /
  透明 PNG / 1×·2× 导出尺寸）。旧 Three 材质 / 表面贴图断言随职责迁移删除。新增 `tests/extrude3d-tabs.test.cjs`
  背景 `effect()` 回归与本轮状态同步断言，`tests/extrude3d-pipeline.test.mjs` 改为 `effect()` 背景 + present 合成接线。
- **验证**：`node --check`、`npm run check` **56/56**、`npm test` **47/47 + 56 静态项**、`npm run build`、`git diff --check`
  通过。**Codex 真实 Chrome WebGPU 验收**：`IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d` 最终
  **68/68 PASS**、0 页面错误、0 跨源请求。首次 smoke 为 61 通过 / 7 失败，7 项均因页面内
  `drawImage(WebGPU / WebGL canvas)` 在本机 Chrome 返回透明位图而误报；只修正 `tests/specs/extrude3d.mjs` 取样，
  改用 Puppeteer `ElementHandle.screenshot` 捕获浏览器合成结果，PNG 解码失败即判失败，功能阈值不放松。
  玻璃折射 / 7 材质观感 / 透明 alpha / 1×·2× 尺寸 / 真实 WebGPU 就绪均已真实覆盖。

### 2026-10-14 · SVG 转 3D 双页签：建模（Three）+ 渲染（vgpu / WebGPU）（DSH 执行；Codex 真实 Chrome WebGPU 已验收 68/68）

- **架构**：`tools/extrude3d` 分为「建模」「渲染」两个页签，切换不丢 SVG / 几何参数；建模页签每次几何变更把同一份
  in-memory `position / normal / uv / index` 网格交接给渲染页签。新增 `modeling.js` / `render-vgpu.js` 与
  `shaders/{common,pbr,glass,glass-back,background,present}.wgsl`；`main.js` 改为页签编排与只读调试快照。
- **建模页签（Three.js）**：只负责 SVG 导入与安全校验、`ExtrudeGeometry` / 原生圆角立方体、厚度 / 倒角 / 平滑度，
  预览固定中性灰 `MeshStandardMaterial` + 半球光 / 方向光；不再使用 `RoomEnvironment` / `PMREM` / `Reflector` /
  `RectAreaLight` / `MeshPhysicalMaterial`，也不承担产品材质、最终灯光、背景或导出。
- **渲染页签（vgpu 0.6.0，MIT）**：用 `geometry(gpu, ...)` 上传任意闭合挤出网格（非固定 cube）；首批 7 个中文预设
  （透明玻璃 / 磨砂玻璃 / 彩色亚克力 / 塑料 / 陶瓷 / 金属 / 镀铬）；不透明走官方 `hero-fractal-ceramic.wgsl` 的 GGX PBR
  最小扩展（metallic + 程序化棚拍环境）；玻璃走官方 `transmission/glass.wgsl` 结构，但把写死立方体的 `trace_cube_exit`
  换成「背面世界坐标预通道 + 正面透射通道」估算厚度 / 出射，支持明显折射、Fresnel、有限色散与有限 TIR。
- **移除**：38 个 Three.js 材质预设、表面贴图、Three 环境光 / 棚拍空间 / 主光 / 强色散示例控件与运行分支删除；
  构建产物确认不含 `materialPresets` / `MATERIAL_UI` / `MeshPhysicalMaterial` 运行分支。
- **背景 / 导出**：纯色 / 棚拍渐变 / 本地图片（居中 cover、1×–3× 缩放、横向 / 纵向平移、透明背景）迁移到渲染页签；
  导出按倍率重渲染 WebGPU 管线到 `rgba8unorm`，`color.read` 反预乘后编码 PNG，不读取建模画布。
  WebGPU 不可用时渲染页签显示中文提示，建模页签仍可用。
- **依赖 / 许可**：新增 `vgpu@0.6.0`（精确锁定，MIT，许可原文 `third-party-licenses/vgpu-LICENSE.txt`）；
  `vite.config.mjs` 接入 `wgslVitePlugin`（`vgpu/client`）；THIRD_PARTY / README / TASKS 同步。
- **验证**：`node --check`、`npm run check` **56/56**、`npm run build`、`git diff --check` 通过；
  新增 `tests/extrude3d-tabs.test.cjs`（9 项）与 `tests/extrude3d-pipeline.test.mjs`（1 项，vgpu 官方 mock adapter
  验证自定义网格 + 多趟管线 + 导出 target resize / read 的 API 合约，不验证像素）；
  `tests/specs/extrude3d.mjs` 按最终职责重写（`gpu: webgpu`）。
  实现侧本轮**未启动浏览器**（历史事实）；玻璃观感 / PNG 像素 / 透明 alpha / 导出分辨率已由 Codex 在后续修复轮
  用真实 Chrome WebGPU 验收 **68/68 PASS**（见上一条）。

### 首页收尾：去掉重复顶栏、成熟工具优先、直观命名
- 删除首页顶部小 logo 和「全部工具 / 使用说明」导航，清理对应样式与旧测试；仅保留主字标、筛选搜索、四列工具一览。
- 首页首行调整为「SVG 转 3D / 标志材质 / 动态背景 / 半调网点」，图片拼贴等内置工具随后展示，外部网站仍放在末尾。
- 「纹理间」更名为「纹理生成器」，「SVG立体」显示为「SVG 转 3D」，同步首页与工具页名称、浏览器测试标题断言；路径和工具逻辑不变。
- 新增首页排序、命名、重复顶栏缺席的浏览器回归断言。浏览器复验仍按项目约定交由 Codex 执行。

### 首页改版：大留白 + 细线切割 + 字号标 + 文案精简（DSH 执行 · 待 Codex 浏览器验收）
- `index.html` / `assets/home.css`：首屏字标从「铺满约 10/12 视口宽、约 160px 高」缩为 ≈ 33vw 宽的主字标
  （`clamp(270px, 33vw, 480px)` 宽、`clamp(64px, 6.6vw, 96px)` 高，1440 实测 475×95），顶栏另加 22px 高小字标；
  ImageLAB 图片与 `h1 img` / alt 结构不变，仍只做 CSS 裁空白，未新增 logo 素材。
- 版式改为参考图那种「大留白 + 细线切割」：贯穿整视口的 1px 横线分成顶栏 / 首屏 / 工具区标题 / 页脚四段；
  卡片行距 80–120px 收为 56–88px；不设 max-width、保持 12 栏网格，无渐变 / 圆角 / 阴影。
- 文案按用户手动验收意见再砍一轮：**首屏只剩一个字标**，删掉「生成纹理、处理图片、探索材质。」、
  「浏览工具 / 使用说明」按钮和「12 / 3 / 6 / 100%」四条数字徽标；顶栏去掉 tagline，只留小字标 + 两个导航链接。
  `assets/home.js` 同步删掉 `#meta-*` 统计渲染、搜索 haystack 不再引用 desc；
  `assets/tools.js` 删除全部 `desc` / `note` / `span` 字段（页面上已无位置，keywords 保留供搜索）。
- 工具一览改为**一行 4 个**（`.card { grid-column: span 3 }`，1440 实测每行 4 个、卡片 319×199），
  ≤1000px 一行 2 个、≤660px 一行 1 个；15 个入口排成 4 / 4 / 4 / 3。
- **首屏留白收回「定量」而不是撑满**（用户反馈顶部留白太大、不高级）：删掉
  `min-height: calc(100svh - 154px)` 的整屏撑高，改为固定节奏的上下边距
  `clamp(72px, 6.8vw, 116px)` / `clamp(64px, 6vw, 100px)`；1440 实测顶栏横线→字标 98px、
  字标→工具栏横线 87px、首屏整块 280px（此前是 746px，顶部约 225px 空白）。同时把首屏字标放大为
  **≈ 33vw 宽 / 64–96px 高**（`clamp(270px, 33vw, 480px)`，1440 实测 475×95），让它成为页面上最大的一处视觉锚点。
- 顺带做减法修排版层级：工具区标题从 15px/0.12em 改为 **12.5px + 0.2em 字距的标签**（压得住 19–24px 的卡片名），
  工具区上下留白 96–160px 收到 72–120px，工具栏行高 62 → 66px。
- 参考 <https://superopc.app/> 与用户提供的参考图（大留白 + 细线切割的观感），未复制其代码、素材或配色。
- `tests/specs/home.mjs` 布局断言同步到新设计：`layoutAt` 增测首屏字标尺寸、顶栏字标高、首屏上下实际间距；
  原「大字标跨约 10/12 宽」改为「首屏字标 ≤ 视口 36% 宽且 ≤ 100px 高」+「顶栏品牌字标存在且 ≤ 30px 高」，
  新增「首屏不再有说明文字 / 按钮 / 数字徽标，只有字标」（断言 `.hero` 内只有 h1 且可见文字为空）
  以及留白定量断言（顶栏→字标 96–150px、字标→工具栏 84–140px、首屏 240–420px，替代原来的 520–900px 撑高断言）；
  每行个数断言改为 4（1440 / 1920 / 2560）、2（900）、1（390）；外部入口不再断言已删除的 `.note`。
  本轮 `npm run check` 48/48、`npm test`、`npm run build` 通过；**未启动仓库的浏览器验收流程**，
  首页浏览器断言与真实封面仍待 Codex 复跑。

### SVG立体：原生真实立方体 + 总光量增益 + 强色散（DSH 执行 · 待 Codex 浏览器验收）
- `tools/extrude3d` 默认几何改为 three 原生真实立方体：内置样例首位新增「立方体」并设为默认，宽高固定 4、Z = 4 × 厚度%
  （默认 100% = 4×4×4），圆角走 addon `RoundedBoxGeometry`（由现有「边缘圆角宽度%」换算，关闭回落 `BoxGeometry`）；
  默认材质改「透明玻璃」。切到 / 切回 SVG 时各自记住上次的几何滑杆（SVG 首次深度 16%），不覆盖手动编辑，
  旧样例 / 上传 / 倒角预算 / 背景 / 贴图兼容不变，只加几何来源分支，没有自研建模。
- 「灯光强度」改为总光量增益（标称 1.2）：同时缩放原生 `DirectionalLight`、棚拍 `RectAreaLight`、可见发光柔光箱板与
  `scene.environmentIntensity`；「环境光」滑杆是叠加其上的独立倍数（envIntensity × gain），0 时主光 / 环境反射 / 面板光熄灭而背景保留。
  不每帧重烘 PMREM，只缩放静态环境强度。
- 修正棚拍地面 `Reflector` 朝向：几何不再 `rotateX`，改为物体 `rotation.x = -PI/2`，世界法线为 (0,1,0)（原生 Reflector 用
  `matrixWorld` 旋转本地 +Z）；中性灰地面层共用同一几何并同样转平，加径向 `alphaMap` 与雾 / 天幕调色消掉硬地平线。
- 「色散强度」扩到 0–20（默认 6，步进 0.25），仍用 three 原生 3 通道物理色散采样（halfSpread = (ior-1)×0.025×dispersion），
  未新增光谱着色器；新增「强色散示例」按钮一键填好立方体 + 玻璃 + ior 1.5 + 色散 10，并用页面内 canvas 现画白底黑字
  ImageLAB 背景走既有本地图片校验管线（不联网、不用任何用户素材）。
- `tests/specs/extrude3d.mjs` 首屏断言改为默认真实立方体 4×4×4 后切回 square-ring 跑旧回归；追加立方体厚度 / 圆角、
  SVG 来源恢复、总光量增益 0/1.2/3 在玻璃与镜面金属上的像素变化、色散 0→8→20 的彩色条纹覆盖与通道方差、示例导出与视图一致、
  Reflector 法线 (0,1,0) 等用例；`npm run check` / `npm run build` / `git diff --check` 通过，**未启动浏览器**，待 Codex 浏览器验收。
- 限制如实记录：three 原生透射是单次折射 + 屏幕空间色散，不等同 vgpu 的多次内反射（TIR）/ SDF 光线步进，不声称与参考图一致。

### SVG立体：棚拍空间背景 + 背景图片平移 + 玻璃双面 + 按需渲染（DSH 执行 · 待 Codex 验收）
- `tools/extrude3d` 背景新增第三种模式「棚拍空间」，纯色仍为默认：真实 `RectAreaLight` 主光 / 轮廓光（跟随现有主光强度与方向）、
  一次性 PMREM 棚拍环境、加法发光柔光箱、上亮下暗天幕、原生 `Reflector` 真实地面反射（512 × 512 上限）；地面跟随模型包围盒
  落在最低点下方小间隙，反射用原生中性灰 `MeshPhysicalMaterial` 薄层压低；透明背景隐藏全部棚拍可见几何、解除即恢复。
- `tools/extrude3d` 背景图片新增「横向位置 / 纵向位置（-100–100%）」+ 重置：映射到 `Texture.offset` 的合法裁切窗口内，
  无余量的轴只禁用该轴并提示；位置在材质 / SVG / resize / 透明开关间保持。上传自动切图片模式，移除回纯色。
- 所有透射材质改 `DoubleSide` + `forceSinglePass=false`（three 原生多趟背面透射），不透明材质保持 `FrontSide`，不新增重复网格。
- 渲染改按需：`OrbitControls` change / `update()` 驱动脏标记，空闲与隐藏时停帧，参数 / 上传 / resize / 导出恢复出图；
  环境贴图只生成一次。
- 只读参考官方 vgpu `glass-sculpture`（MIT）STUDIO 灯光取值校准观感，**未移植 WGSL / SDF 光线步进**，不等同多次弹射 TIR。
- `tests/specs/extrude3d.mjs` 追加棚拍对象 / 地面与淡反射 / 透明隐藏与导出 / 放大导出 / 平移 / 模式保持 / 双面透射 / 按需渲染等用例，
  115 → 134；`npm run check` 48/48、`npm run build`、`git diff --check` 通过，**未启动浏览器**，待 Codex 独立复验。

### 最新独立验收：首页 + SVG立体 + 辉光点阵（Codex 复跑全绿）
- 首页 **86/86**：1440 / 1920 / 2560 / 390 宽，白底、全宽横线、搜索、15 条目通过。
- SVG立体 **115/115**：塑料直接光照最终用例通过；玻璃 ior 1→1.5 三区域位移约 (-6,+5)、1→2 约 (-8,+8)，0 错误；默认玻璃 16% 上传图片实测 transmission 1 / opacity 1 / IOR 1.5 / effectiveThickness .8，玻璃有效 alpha 中位 4824、部分 1576、四角 0（80×80 采样）。
- 辉光点阵 **51/51**（halo 颜色、glow 0/.6/.8/1、密度、方向长度、PNG）；新实现约 30fps、7821–11737 格 / 15 drawcalls，暂停 delta 0，浏览器主线程 TaskDuration 14.7–19.3%（非整机 CPU）；旧 1.2–1.4% 属上一版实现，不再作为当前数据。
- `public/assets/covers/wave-grid.png` 与 `dist/` 副本 sha256 一致（`dd42c5cf...e481f5be`）；extrude3d 封面同步刷新并加首页 query `20261013-glass1`。
- 无新增运行时依赖、无 vgpu 引擎；Three 0.186.1 支持背景折射，但不等同 vgpu raymarch / TIR。本地 demo http://127.0.0.1:4890/，未提交、未推送。

### 首页宽排版重做 + SVG立体玻璃折射 / 主光 / 百分比几何 / 导入闸门（Codex 独立复跑通过）
- **首页**：去 1360px 上限，改全视口宽（左右 `clamp(24px,3vw,96px)`，移动 20px），保留 12 栏网格；
  桌面 2 列、`≥1800px` 3 列、中屏 2 列、小屏 1 列；顶栏 / hero / 工具区标题 / 页脚横线贯穿视口；
  工具区上下留白与卡片行距 80–120px；`wave-grid` 卡片简介缩短；仍用已批准的 ImageLAB 字标图片。
  `tests/specs/home.mjs` 旧 3 列断言改 2 / 3 列，并加 1920 / 2560 与移动端无横向溢出检查。
- **SVG立体 · 玻璃折射**：按 three 官方 `MeshPhysicalMaterial` 透射配置，玻璃改 `opacity 1 / transmission 1 /
  metalness 0 / low roughness / ior 1.5`；新增「透明玻璃」专属中文控件（折射率 1–2.4、光学厚度 0–2×、
  色散 0–1）。three 0.186.1 的 `getVolumeTransmissionRay` 按网格局部坐标处理 `thickness` 并乘 `modelScale`，
  因此材质 `thickness` 先由世界空间目标厚度除以等比缩放换算回局部坐标，避免 `mesh.scale` 二次缩放：
  透明玻璃世界空间有效厚度 = 归一化真实模型厚度 × 倍数，其他透射材质保留预设世界目标厚度，
  `getInfo().material.effectiveThickness` 只读可查；背景仍走 `scene.background`；
  界面写明纯色背景 / 透明背景看不到折射。不接 vgpu 运行时，不宣称等同。
- **SVG立体 · 主光**：新增 three 原生白色 `DirectionalLight`（强度 0–3、方向角 0–360°、不投影），
  与 `RoomEnvironment` + PMREM 同时作用，改参数即更新高光、不重建几何。
- **SVG立体 · 几何参数**：厚度改「最大平面边长」2–100%（默认 16%），边缘圆角 0–10%、倒角 0–10%（0 关闭）；
  复用上游深度 / 细分 / 预算裁剪，倒角按百分比换算并沿用「不超过厚度一半」上限（达到时状态栏写实际值）；
  只归一化一次到平面最大边 4 单位，20 / 200 / 2000 同比例结果一致。
- **SVG立体 · 导入闸门**：64 KiB → **1 MiB**；几何估算使用本次真实 `bevelEnabled` / `bevelSegments` /
  `curveSegments`，超预算先降到下限（曲线 8 段、倒角 2 段），仍超 600000 顶点才拒绝；解析后、
  `measureFlatMaxDim` 三角化**前**先按最低细分做下限估算，连下限都超预算即提前拒绝（倒角关闭时按 0 段下限），
  避免大 path 三角化卡住主线程。脚本 / 内联事件属性 / 内部 `ENTITY` / 外部 `href`·`src`·`url()`·`@import`
  按原始文本拒绝（`defs` / `metadata` 里也拒绝），放行命名空间 URL、metadata 正文、本地 `#fragment` 与
  普通 SVG 1.1 `DOCTYPE`；`defs` / `metadata` 未使用的普通定义不再误判；解析按 SVG 文本缓存、重建 RAF 合并。
- **测试**：`tests/specs/extrude3d.mjs` 新增同比例归一化 + 玻璃世界空间有效厚度一致、厚度 2/16/70、
  倒角 0/2/6、上限实际值反馈、100 / 400 段平顺闭合轮廓自适应接受（旧「400 曲线被拒」预期已废弃）、
  2200 条曲线硬上限在三角化前被拒并保留旧模型、普通导出可导入 / 脚本·实体·外部引用与可见滤镜仍拒绝、
  64 KiB–1 MiB 可导入 / >1 MiB 拒绝、玻璃 ior 1 / 1.5 / 2.0 多区域空间错位、主光方向移动高光、
  `getInfo()` 只读诊断。
- **文档 / 许可**：README 更新事实并追加本轮说明；THIRD_PARTY 注明几何 / 材质 / 灯光改用 three 原生
  `ExtrudeGeometry` / `BufferGeometryUtils` / `MeshPhysicalMaterial` / `DirectionalLight`，仍是 MIT 锁定版本、
  无新增许可；vgpu（MIT）仅只读参考。
- 验证：`npm run check` 48/48、`npm run build`、`git diff --check` 通过；**未启动浏览器**，浏览器验收待 Codex。

### 修正：辉光点阵发光缓存曝光顺序（unpremultiplied brightness，Codex 已独立复验）
- `tools/wave-grid`：旧实现对透明发光缓存做模糊前 `brightness(3.6)`，Skia 先解预乘使饱和主色每通道截到 1，
  真实导出里彩色 bloom 被冲成灰白晕。现 `blockCanvas / bloomCanvas / wideCanvas / streakCanvas /
  streakBlurCanvas` 一律 `alpha:false` 黑底不透明 RGB，先把「饱和主色 × 字形 opacity」与黑底混合成真实
  RGB 能量，再正常 blur / 降采样 / 8 方向平均 + 连续 blur；固定 `brightness(3.6)` 只在模糊之后由最终
  `ctx` 的宽柔光 / bloom / 光丝三个 `lighter` 整帧 `drawImage` 共享施加一次。缓存源 Alpha=1 使低亮 RGB
  获得真实增益且色相保留，只有高亮核心饱和；black RGB0 在 lighter 中不抬黑、不盖画面；合成后
  `ctx.filter='none'` 再叠透明 sharp，清晰层不受曝光。参数 / field / seed / 几何 / 测试功能不动，
  drawCalls 仍 ≤16，未新增缓存 / 依赖 / 逐像素代码。
- `tests/specs/wave-grid.mjs`：新增 6 项程序生成单色品红 / 红 / 绿青小光点的 glow-only halo 保色回归
  （同输入辉光 1 与 0 逐通道相减隔离发光能量），断言辉光真实增加亮度与覆盖、halo 主色通道关系保留且
  大多数像素不是 R≈G≈B 灰白；`glow 0.6/0.8/1` 严格递增、方向光斑、黑留白 >20% 等原 45 项全部保留。
- 验证：`node --check`、`npm run check` 48/48、`npm run build`、`git diff --check` 通过；**未启动浏览器**，
  浏览器 wave+home 复跑、最终颜色目视与 `public/assets/covers/wave-grid.png` 重抓由 Codex 执行。

### 修正：辉光点阵默认能量 / 构图 / 稳定种子（Codex 已独立复验，封面已重抓）
- `tools/wave-grid`：默认辉光能量在合成宽柔光 / 两级 bloom / 方向光丝时统一乘 `GLOW_GAIN=3.6`（不新增控件，
  `glow=0` 仍严格跳过整段辉光），辉光层改用四条色带的饱和主色、清晰层保留白 / 浅色实心核；默认长度 48 → 72px，
  上限仍 0–120。`BAND_SLOPE` 0.65 → 0.33、`BAND_CENTERS` → `[0.10, 0.34, 0.58, 0.82]`、`HALF_WIDTH` → 0.105，
  蓝从左上约 y=0.10 平缓斜向右下、品红中上、红中下、绿最下；Node 复算默认亮格约 48%、四色约 30/29/25/16%。
- `SimplexNoise` 改用内置 mulberry32（等价 three `seededRandom` 算法，不新增依赖）以 `state.seed` 固定初始化一次，
  每次 reload 构图一致，不逐帧 / 不逐布局重随机，不新增「重新随机」入口。
- `tests/specs/wave-grid.mjs`：方向判据改为程序生成的透明白点画幅自动 alpha 取样，按光斑 halo 的空间方差 / 范围
  验证长度 0 → 120、90° 纵向与 0° 横向，测后清除图片恢复色带；新增默认辉光 vs 强度 0 的 halo 亮度 / 覆盖显著增加
  且黑色留白仍 >20% 的检查。UI 文案改为「强度 0 关闭辉光，保留清晰点阵」，长度 / 方向数字控件标注 px / °。
- 验证：`npm run check` 48/48、`npm test` 35/35 + 48 项静态检查、`npm run build`、`git diff --check` 通过；
  **未启动浏览器**，浏览器规格与 `public/assets/covers/wave-grid.png` 重抓待 Codex 独立执行。

### 修正：辉光点阵强度高段 clamp 死区（Codex 已独立复验，封面已重抓）
- `tools/wave-grid`：旧实现把固定 `GLOW_GAIN=3.6` 乘进最终合成 alpha 再 `clamp(...,0,1)`，
  glow≥0.56 时宽柔光 / bloom / 光丝三档 alpha 全部截到 1，暂停帧 0.6 / 0.8 / 1 逐像素相同，
  复现「参数不能选」。现把 3.6 增益移到 1/8 bloom 与 1/4 光丝低分辨率缓存的曝光阶段，
  用一次原生 `brightness(3.6)` 抬升；最终合成 alpha 改为 `glow^0.8`（默认 0.55 → α≈0.62，
  α(1)=1），全程严格递增、无需 clamp。`brightness` 是颜色矩阵滤镜，Skia 会先解预乘、按通道
  乘并 clamp 到 1 再预乘，对饱和色带实际抬升约 1.6×，故用 `glow^0.8` 与旧 alpha≈1 的等效
  能量对齐，保持明亮默认与四条饱和主色发光。合成后 `ctx.filter='none'` 再叠透明清晰层；
  drawCalls 预算仍 ≤16，未新增依赖 / 逐像素扫描。
- `tests/specs/wave-grid.mjs`：新增暂停帧 `glow 0.6 / 0.8 / 1` 两两逐像素不同、且平均亮度
  严格递增的高段回归；强度 0 无辉光、长度 0 圆形 bloom、方向光斑、黑留白 >20%、密度与导出
  PNG 断言全部保留。验证：`npm run check` 48/48、`npm run build`、`git diff --check` 通过，
  **未启动浏览器**；浏览器规格与 `public/assets/covers/wave-grid.png` 重抓由 Codex 执行。

### 修复：动态字符画水母触手改用原生宽线（Codex 已独立复验）
- `tools/ascii-motion` 水母触手由 1 像素 `LineBasicMaterial` 换成 three 自带 `addons/lines` 的
  `Line2` + `LineGeometry` + `LineMaterial` 原生宽线（宽 6 逻辑像素），resize 时同步 `resolution`；
  每帧只原地改写 `instanceStart` / `instanceEnd` 共用缓冲区，不重建 / 不销毁几何体，不写自定义着色器、
  不加依赖；10 条触手的相位与路径曲线保持不变。
- 默认值同步：水母颜色改浅薰衣草 `#b8c6ff`（HTML 默认选中同步）、辉光 0.65、密度 0.55；水母镜头拉远到
  z≈6.5、看向 y≈-0.4，伞盖与最长触手完整入画；圆环 / 隧道 / 波形三组预设镜头不变。
- `tests/specs/ascii-motion.mjs` 扩展一条紧凑视觉信号（默认前景不止横线、下半部触手连续、底部不裁切）
  与一条导出画布底部触手像素断言；浏览器断言与真实封面仍由 Codex 执行。
- 限制：字符采样格约 13px，宽线仍可能被字符化成横线 / 等号；这是 AsciiEffect 按亮度取字的固有上限，
  本轮只保证「连续成束、不被裁切」，不改变字符映射规则。验证：`npm run check`（46 项）/ `npm test` /
  `npm run build` 通过，真实 Chrome 复验待 Codex。

### 修复：文字混排本机字体 API 路径订正（Codex 已独立复验）
- `tools/mixed-type` 的「读取本机字体」改按 MDN 主 API 调用 `window.queryLocalFonts`：原写成
  `navigator.queryLocalFonts`，而已安装 Chrome 只把该函数挂在 `window` 上（`navigator` 上为 `undefined`），
  会导致误报「不支持」。保留安全上下文校验、点击手势与权限拒绝（`NotAllowedError` / `SecurityError`）
  的中文回退；仍只在内存中登记去重后的字族名，不读取、不缓存、不上传、不打包任何字体文件。
- `tests/specs/mixed-type.mjs` 增加两段紧凑分支并补一条真「不支持」分支（新增 5 项断言、替换原 1 项）：

  仅在 `window` 上桩 `queryLocalFonts`（不动 `navigator`）返回含重复 family 的合成元数据，点击后断言
  去重、中文成功提示与「只登记字族名、不自动勾选」；再桩成抛 `NotAllowedError`，点击后断言权限回退、
  保留回退字族且无崩溃，并在 `finally` 按 `getOwnPropertyDescriptor` 现场精确还原（原生不存在时删除）；
  只有 `window` 上确实没有可调用函数时才断言「不支持」，避免假缺省顶替。
- 复核 `render()`：`await fontsReady()` 之后已有 `renderToken` 守卫，字体异步等待结束时若已触发更新的
  渲染会直接放弃，旧字体异步不会覆盖较新文字；现有守卫已覆盖，无额外改动。
- 验证：`npm run check`（46 项）/ `npm test`（35 项）/ `npm run build` 通过。真实 Chrome 的原生本机
  字体读取与权限流程仍待 Codex 独立复验，**本记录不声称已在真实浏览器通过**。

### 第七轮：新增 3 个独立可视化工具（文字混排 / 波动点阵 / 动态字符画）
- 新增 `tools/mixed-type`（文字混排）：Canvas 2D 中英文混排海报；字族池、字号 / 行高 / 字距、随机抖动与
  `strokeText` 描边比例；固定随机种子可复现（无逐帧重排），「重新随机」换版式；可选按钮调用原生
  `window.queryLocalFonts`（仅用户点击 + 安全上下文；拒绝 / 不支持时给中文提示并保留系统回退），不打包字体。
- 新增 `tools/wave-grid`（波动点阵）：原生 Canvas 2D 深底发光点阵，彩色波浪逐行流动；网格 ≤20000 单元、
  画布边长约 1600；文字 / 本地图片（≤10 MiB、单边 ≤4096、真实解码、失败保留上一张并 revoke URL）采样亮度颜色；
  形状 / 配色 / 密度 / 波幅 / 速度 / 辉光；暂停后导出当前帧 PNG（不放大）。
- 新增 `tools/ascii-motion`（动态字符画）：three 0.186.1 + 自带 `AsciiEffect`（MIT）真实字符化；水母（球面片段 +
  线段触手）/ 圆环 / 隧道 / 波形四组预设；密度 / 字符集 / 速度 / 颜色 / 辉光；暂停后从当前字符快照（真实字符 +
  行内颜色 + 背景）用 Canvas 2D 重绘导出 PNG，不截原始网格、不依赖 html2canvas。
- 集成：`assets/tools.js` 首页清单 12 内置 + 3 外部 = 15；`scripts/check.mjs` 入口 / 封面断言同步，
  新增 3 条封面登记为「待 Codex 抓取」（首页显示中性占位，不伪造）；`scripts/capture-covers.mjs` 增加 3 个目标；
  `tests/specs/` 新增 3 份规格（上传 / 调参 / 暂停像素 / 当前帧导出 PNG / 0 外部请求）。
- 许可：3 个工具为视频效果的新写独立实现，只用已锁定的 three 与浏览器 API；参考来源 Mixweight 网址不可达，
  以用户专项授权为前提；不打包 / 不分发任何字体，字体许可由使用者自担。`README` / `THIRD_PARTY` 已同步。
- 验证：`npm run check`（46 项）/ `npm test` / `npm run build` 通过；浏览器验收与真实封面待 Codex 执行。

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
