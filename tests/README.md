# tests/ · 浏览器验收说明

## 分工

本批次约定：**浏览器验收统一由 Codex 执行**，实现侧（DSH）不再自行启动 Chrome / Puppeteer / 截图 / 封面抓取。
因此 `tests/smoke.mjs`、`tests/harness.mjs`、`scripts/capture-covers.mjs` 默认**关闭**，
未显式开启时会打印提示并以退出码 `2` 结束（不会被误判为「测试通过」）。

Node 单测与构建不受影响：

```bash
npm run build     # 正常
npm test          # 正常（纯 Node：纹理间 4 套测试共 34 项 + tests/serve.test.cjs 服务器自检 + tests/extrude3d-tabs.test.cjs 双页签静态自检 + tests/extrude3d-color.test.cjs 颜色空间自检 + tests/extrude3d-pipeline.test.mjs（vgpu 官方 mock adapter 的 API 合约）+ tests/workspace-ui.test.cjs 工作台 UI 静态自检 + scripts/check.mjs 静态自检）
```

> 2026-10-14 工作台 UI 改版（DSH 执行；Codex 真实 Chrome 已验收通过）：
> 带播放控制的 5 个自建工具（`shaders-logo` / `shaders-bg` / `shaders-halftone` / `wave-grid` / `ascii-motion`）
> 与 `extrude3d` 改为紧凑顶栏 + 分类悬浮检查器 + 画布下方播放条（extrude3d 为检查器内分类 + 画布工具栏重置视图）。
> 新增 `tests/workspace-ui.test.cjs`（10 项纯 Node，内置最小 HTML 解析器）验证：6 个工具的分类导航
> `role="tab"` / `aria-selected` / `aria-controls` 与 `role="tabpanel"` 对应且初始选中态一致；分类面板
> 只含各自原有控件；5 个动画工具的播放控件只存在一份且都位于 `[data-playbar]`、播放条在画布之后；
> `assets/workspace.css` 的桌面 `100dvh` / `body overflow:hidden` / 检查器内部滚动 / 小屏
> `@media (max-width: 999.98px)` 自然文档流回退；`assets/workspace.js` 只切换 `hidden`、不重建或重置控件；
> `extrude3d` 主页签保留、`#render-reset-view` 位于 `#stage-render .il-canvas-toolbar` 且复用
> `render-vgpu.js` 的 `VIEW_DIR` / `VIEW_DISTANCE` / `controls.target` / `controls.update()` 与
> 「摄像机与模型构图已重置」反馈；并逐工具核对改版前全部控件 id 仍存在且唯一。
> 浏览器规格同步：需要点击隐藏分类里的控件（各工具导出、ascii 颜色 / 动效、extrude3d 背景 / 导出）前
> 先 `[data-cat="…"]` 切换分类；`tests/specs/extrude3d.mjs` 新增重置视图入口位置、中文反馈与默认机位断言。
> 实现侧只跑 `node --check`、`npm test`、`npm run check`、`npm run build`、`git diff --check`，**未启动浏览器**（历史事实）；
> Codex 随后已用真实 Chrome 完成浏览器验收并通过：`ascii-motion` **25/25**、`extrude3d` **79/79**、
> `shaders-bg` **37/37**、`shaders-halftone` **29/29**、`shaders-logo` **19/19**、`wave-grid` **51/51**，
> 全部 **0 页面错误**；1440×900 与 390×844 的六工具布局验收全部通过（桌面 body 不滚动、画布 / 播放条在
> 视口、检查器 overflow auto；窄屏自然滚动、画布在前、面板在后、无横向溢出）。
>

> 2026-10-14 首页封面批次（刷新全部缩略图 + 外链本地缩略图 + 品牌素材生成外链）：
> `assets/tools.js` 变为 16 入口（12 内置 + 4 外链，新增 `brand-assets-generator`「品牌素材生成」），
> 16 个入口统一换新 `coverQuery`；外链卡片改为显示本地官网缩略图 + 「外部网站 / 主机名」叠层，加载失败退回文字块。
> `tests/specs/home.mjs` 相应改为 16 入口，外链新增「本地 cover img 加载成功、cover URL 是站内
> `assets/covers`、不是远程 URL」断言（**不 fetch 外链官网**）；内置 12 张封面改为必须齐备。
> `scripts/check.mjs` 统一禁止 http(s) 封面，并要求 4 张外链封面文件位于 `public/assets/covers/`。
> `scripts/capture-covers.mjs` 更新为当前 DOM / 分类结构（`extrude3d` 切渲染页 + 输出分类 +
> `#render-export-png`；shader / wave-grid / ascii-motion 先切「输出」分类再导出）。
> 新增 `scripts/capture-external-covers.mjs`：默认关闭、仅固定 4 个 HTTPS 官网、独立 profile、
> 1440×900 当前视口截图、缩到 ≤1280px 后存 `public/assets/covers/<id>.png` 并记录来源 URL，
> 页面打不开即失败退出、不创建伪封面。**Codex 已在真实浏览器执行这两条抓取命令**：先
> `IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs`（刷新 12 张内置封面），再
> `IMAGELAB_BROWSER_TESTS=on node scripts/capture-external-covers.mjs`（抓取 4 张外链缩略图）
> （均需先 `npm run build`，因为首页封面脚本服务的是构建产物 `dist/`）。
> 结果：16 张封面全部存在并已目视确认（`shaders-logo.png` **1280×803**，4 张外链封面**均 1280×800**，
> 来源 URL 记入 `public/assets/covers/external-covers.json`）。最终验证：`npm run build` 通过、
> `npm test` **67/67**（含 **58 项**静态检查）、`node scripts/check.mjs` **58/58**、
> `IMAGELAB_BROWSER_TESTS=on npm run smoke -- home` **113/113**（**0 页面错误**）、`git diff --check` 通过。
>

> 2026-10-14 修复轮（背景发白 / 玻璃背面 / 色散 / 黑白预设）：
> `tools/extrude3d` 的四处根因与回归见根 `CHANGELOG.md`。新增 `tests/extrude3d-color.test.cjs`（3 项）：把
> `common.wgsl` 的 `srgb_to_linear` 数学在 Node 里逐位复现，与 IEC 61966-2-1 参考值和 three 0.186.1 的
> `Color.setStyle(hex, SRGBColorSpace)`（同一组 0.04045 / 12.92 / 1.055 / 0.055 / 2.4 常数）对照；
> `tests/extrude3d-tabs.test.cjs` 增加背景绑定不回退白色 fallback、图片 sRGB→线性、黑 / 白预设映射与默认白色、
> 玻璃背面写进 `sceneTarget`、背面 uniform 结构、色散默认值 / 映射对齐官方 `dispersion_spread` 的断言；
> `tests/extrude3d-pipeline.test.mjs` 的 mock 管线同步改成「背面 draw 同时进 backTarget 与 sceneTarget」。
> `tests/specs/extrude3d.mjs` 增加：默认白色 / 点击黑 · 白预设后的背景亮度、上传马赛克后外圈彩色与亮度、
> 色散默认值与 0 关闭、透明玻璃模型区域的前后界面亮度结构。实现侧本轮仍未运行浏览器；这些浏览器断言
> 待 Codex 用真实 Chrome WebGPU 复核。

> 2026-10-14：`tools/extrude3d` 改为「建模（Three）/ 渲染（vgpu + WebGPU）」双页签后，`tests/specs/extrude3d.mjs` 已按最终职责重写
> （`gpu: webgpu`，覆盖双页签、旧 Three 材质控件移除、7 个中文预设、网格交接、WebGPU 中文提示与 PNG 导出）。实现侧当时未运行浏览器
> （历史事实）；已由 Codex 用真实 Chrome WebGPU 复跑 `IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d`
> 验收 **68/68 PASS**、0 页面错误。旧规格里的表面贴图 / 38 预设 / Three 棚拍断言已随职责迁移删除。
>
> 2026-10-14 修复轮：`background.wgsl` 是 fragment-only，原先用 `draw()` 会找不存在的 `vs_main`；现背景改用 vgpu 官方
> `effect()` 的内置全屏顶点通道，`present.wgsl` 改为把模型（带深度 `sceneTarget`）合成到不带深度的 `backgroundTarget` 之上。
> `tests/specs/extrude3d.mjs` 的厚度断言改为比较 mesh bounds Z / `thickness`（不再用顶点数），并恢复适配后的关键回归：
> 普通 SVG / 未使用 defs·metadata / text·script·内部实体·外部资源·可见滤镜拒绝 / 1 MiB 上限 / 复杂曲线拒绝与平顺曲线自适应 /
> 厚度·倒角·比例归一化 / SVG 切换状态保持 / 背景校验·缩放·平移 / WebGPU 7 种材质 / 透明 PNG / 1×·2× 导出尺寸。
> `tests/extrude3d-tabs.test.cjs` 与 `tests/extrude3d-pipeline.test.mjs` 同步覆盖 `effect()` 背景与 present 合成。实现侧当时未运行浏览器（历史事实）；
> Codex 复跑 `IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d` 最终 **68/68 PASS**、0 页面错误、0 跨源请求。
>
> 2026-10-14 取样修正：`tests/specs/extrude3d.mjs` 的「拒绝后建模画布」「7 种材质非空 / 差异」「背景缩放 / 平移」
> 不再在页面内把 WebGPU / WebGL canvas `drawImage` 到 2D canvas（本机 Chrome 会得到透明位图），改为用
> `ElementHandle.screenshot({ type: "png" })` 捕获浏览器合成结果后回页面用 `Image` 解码到固定小尺寸；元素缺失、
> 不可见或截图失败即取样失败（不伪造非空像素），原有阈值含义不变。修正后 Codex 用真实 Chrome WebGPU 复跑
> **68/68 PASS**、0 页面错误；首次 7 项失败全部是 drawImage 取样误报，不是应用空白或渲染失败。

## Codex 如何跑

```bash
IMAGELAB_BROWSER_TESTS=on npm run smoke              # 全部工具，顺序执行，只启动一个 Chrome
IMAGELAB_BROWSER_TESTS=on npm run smoke -- texture   # 只跑指定工具
IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs   # 刷新 12 张内置工具封面（真实导出画面）
IMAGELAB_BROWSER_TESTS=on node scripts/capture-external-covers.mjs   # 抓取 4 张外链官网本地缩略图

SMOKE_HEADFUL=1        # 需要看到窗口时
SMOKE_PORT=5199        # dev server 端口（默认 5199）
COVER_PORT=5299        # 封面脚本端口（默认 5299）
CHROME_PATH=/path/to/chrome
```

用到的浏览器是**本机已安装的 Chrome**（puppeteer-core + executablePath），不下载浏览器。
每个测试实例都有独立的 `--user-data-dir`（位于 `.tmp/chrome-profile-<pid>`），
不读取也不修改用户自己的 Chrome 配置；进程结束（含异常与中断）时会在 `finally` 里关闭。

## 文件

| 文件 | 作用 |
| --- | --- |
| `harness.mjs` | 启动 Vite dev server、启动/清理 Chrome、下载捕获、PNG 校验、WebGL/WebGPU 探测 |
| `smoke.mjs` | 顺序跑 `tests/specs/*.mjs`，汇总 PASS/FAIL |
| `browser-policy.mjs` | 浏览器验收开关（默认关闭，需 `IMAGELAB_BROWSER_TESTS=on`） |
| `serve.test.cjs` | 纯 Node：本地静态服务器畸形 URL 回 400 后仍在运行（`npm test` 默认跑） |
| `specs/<id>.mjs` | 每个工具一份规格：进入 → 上传 → 调参 → 导出 → 断言 |
| `fixtures/test-photo.png` | 程序生成的 640×480 测试图（非私人素材、非 AI 图） |
| `fixtures/test-logo.svg` | 程序生成的几何 Logo |

测试素材可用 `node scripts/make-fixtures.mjs` 重新生成。

## 本轮状态（Codex 独立复跑：310/310 PASS · 0 失败）

在 `8d42fbd` 之后用真实 Chrome 复跑构建产物：extrude3d 81、home 63、image-to-ascii 11、
image-to-pixel 34、pixelit 9、psychos 20（WebGPU）、shaders-bg 37、shaders-halftone 29、
shaders-logo 19、texture 7，共 **310 项全部通过**；真实上传 / 调参 / 下载 PNG、GPU 探测均覆盖。
另做独立计算样式审计：9 个页面可见的 body / header / aside / 按钮 / select / h1 / h2 / 返回链接
**0 个非中性 UI 色彩**，画布 / 素材 / 材质调色板与 9 张真实封面仍为原有彩色。
此前的动态背景 HTTP 304 假失败已在 `harness.mjs` 关闭浏览器缓存修复。

本轮名称定稿：`extrude3d` 规格新增轻量断言——38 个材质预设全部有中文名、value（上游 preset id）
不变且无重复、常用材质（塑料 / 镜面金属 / 透明玻璃 / 黄金）可从下拉选中并生效。浏览器断言仍由
Codex 执行（`IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d`），实现侧不启动 Chrome。

`extrude3d` 表面贴图（第五轮，用户专项授权）新增断言：上传真实 PNG 后画布像素变化、材质绑定 sRGB map
且未自定义颜色时基色为白、自定义颜色可给贴图染色、切换材质预设 / 切换 SVG 重建几何后贴图保留、
伪 PNG（解码失败）与非白名单类型被拒且保留当前好贴图、移除后 `map` 为 `null` 且基色恢复预设颜色
（黄金 `#ffd891`）并且像素变化、重选同一文件可再次上传、贴图激活时导出 PNG 非空。
**已并入 Codex 本轮 SVG立体 81/81 PASS**（`IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d`）；
实现侧只跑 `npm run check` / `npm test` / `npm run build`。

首页现有 16 个入口：12 个内置（12 张真实封面齐备；进入链接可达断言不变）+ 4 个外部网站
（校验标注、两处链接 `target="_blank" rel="noopener noreferrer"`、准确网址、关键词搜索，以及
**本地加载成功的 cover img 且 cover URL 是站内 `assets/covers` 路径、不是远程 URL**；
**不向外部 fetch**，避免 CORS 假失败）。外链本地封面由
`IMAGELAB_BROWSER_TESTS=on node scripts/capture-external-covers.mjs` 从 4 个固定公开官网
当前视口截取，脚本不接受任意 URL、页面打不开即失败退出、不创建伪封面。

本批新增 3 份规格：`tests/specs/mixed-type.mjs`（默认可渲染 / 固定种子可复现 / 重新随机 / 描边 /
本地字体降级 / 空文本空态 / 导出 PNG）、`tests/specs/wave-grid.mjs`（固定字符网格 / 发光条带与字母图形 / 暂停帧 / 当前帧 PNG）、`tests/specs/ascii-motion.mjs`
（WebGL2 / Canvas 字符输出 / 自定义字素字符集 / 自定义文字与图片模式 / motion / 暂停与同画布 PNG）。三份规格都断言**0 外部网络请求**与无 console 错误。
`home.mjs` 当时同步为 12 内置 + 3 外部 = 15（2026-10-14 已更新为 12 + 4 = 16，见上）。以上浏览器断言与真实封面已由 Codex 执行通过（见文末「本批验收结果」），
实现侧不启动浏览器。

`extrude3d` 背景图片（第六轮，用户专项授权）新增断言：上传真实 PNG 后 `scene.background` 是真实贴图且
按视口 / 原图宽高比居中 cover、背景缩放 1×→2×→1× 改变真实像素、导出 PNG 真实包含背景、
背景与表面贴图同时存在、切换材质 / SVG 后背景保留、透明背景抑制并恢复、移除后回到所选纯色、
最新无效选择保留原背景。默认纯色背景由米色改为纯白，规格里的背景像素基准同步改为 `#ffffff`。
**已由 Codex 在本轮 SVG立体 81/81 PASS 中独立复跑通过**；实现侧只跑
`npm run check` / `npm test` / `npm run build`。
十二个工具界面与共享返回链接使用深色黑 / 白 / 中性灰；首页白色样式保持原样，预览画布与素材维持内容颜色。
此前 9 页的计算样式审计结果为 0 个非中性 UI 色彩；本轮覆盖全部 12 个工具页的外观与返回导航，已由 Codex 独立浏览器复核通过。画布 / 素材 / 材质调色板保持内容自身颜色。
SVG立体保持可访问；3D 扩展冻结仅针对当时批次，本轮用户专项授权批次已解冻，未引入高级 vgpu 引擎。


2026-10-13：`wave-grid` 覆盖固定字符格、迟滞预设、小写 a / 文字图形、暂停帧与当前帧 PNG；`ascii-motion` 覆盖四种场景与字符集预设、单 Canvas、自定义字素集 / 画面 / 动效、暂停 / 辉光及导出。psychos 规格通过 dist 根验证共享 CSS 路径。已由 Codex 独立运行浏览器规格、外观及性能验收通过（见文末「本批验收结果」）。

2026-10-13 补充：`wave-grid` 规格进一步断言清除图片后字母 mask 真实生效（小写 a 约占画面 15–20% 高），以及暂停下 `glow 0 / 1` 产生真实像素差异、远离色带的画面角落保持纯黑；`window.__waveNoGlow` 全局引用改为把两张快照显式传入 `page.evaluate`。实现侧实跑 `npm run check` 48/48、`npm test` 35/35 + 48 项静态检查、`npm run build` 通过，未启动浏览器；浏览器规格已由 Codex 独立复验通过（见文末「本批验收结果」）。

2026-10-13 辉光点阵改版：`tests/specs/wave-grid.mjs` 重写为像素级规格——桌面 1440 与移动 390 下密度低 / 中 / 高格数与间距严格单调、三张快照两两不同，粗 / 中 / 细预设与密度滑杆同一参数；`glow=0` 只有锐利字形（drawCalls=1），长度 0 保留圆形 bloom、0→120 纵向分布真实增大，方向 90° 与 0° 的纵 / 横铺展相反；默认帧黑留白与 40–55% 亮格、■/□/× 分档、四色出现；小写 a 高度 15–20%；非法类型 / 伪 PNG / 单边 >4096 均保留当前图片；暂停 / `document.hidden` / 缩放只重绘一次；导出 PNG 与当前 canvas 快照逐像素一致。**本轮浏览器验收已由 Codex 独立复跑通过**；实现侧只跑了 `npm run check`、`npm test`、`npm run build`、`git diff --check`，不启动浏览器。封面 `public/assets/covers/wave-grid.png` 由 Codex 用工具真实导出重新抓取，首页已用固定新 query 避免旧封面缓存。

2026-10-13 辉光点阵微调：原「方向 90° / 0°」用整幅斜向多色带比较全图 spread，受色带自身斜向协方差干扰得到错误结论；现改为载入程序生成的透明白点画幅（非用户素材）自动 alpha 取样，按光斑低亮 halo 的空间方差 `vx` / `vy` 与包围范围 `w` / `h` 验证「长度 0 → 120 纵向增大」「90° 纵向拉长、0° 横向铺开」，测后清除图片恢复色带再跑宽核 / 四色 / 后续上传。默认帧新增「默认辉光 vs 强度 0 的 halo 亮度 `mean` 与覆盖 `halo` 显著增加、且黑色留白仍 >20%」检查。**本轮浏览器验收与封面重抓已由 Codex 独立复跑通过**，不得据实现侧静态结果声称已通过。

2026-10-13 辉光强度高段死区修复：旧实现把 `GLOW_GAIN=3.6` 乘进最终合成 alpha 再 `clamp`，glow≥0.56 时三档全截到 1，暂停帧 0.6 / 0.8 / 1 逐像素相同。现把 3.6 移到低分辨率 bloom / 光丝缓存的 `brightness(3.6)` 曝光阶段，最终 alpha 改为 `glow^0.8`（严格递增、α(1)=1、无 clamp）；`wave-grid` 新增「暂停帧 0.6 / 0.8 / 1 两两不同且平均亮度严格递增」回归，其余强度 0 / 长度 0 圆形 bloom / 方向光斑 / 黑留白 / 密度 / PNG 断言保留。实现侧只跑 `npm run check`、`npm run build`、`git diff --check`，不启动浏览器；浏览器验收与封面重抓已由 Codex 独立复跑通过。

2026-10-13 辉光点阵发光缓存曝光顺序修复：上一版把 `brightness(3.6)` 放在**模糊前**的透明缓存上，Skia 会先解预乘，饱和主色每通道被截到 1，真实导出里彩色 bloom 被冲成灰白晕。现五个发光缓存（block / bloom / wide / streak / streakBlur）统一改为 `alpha:false` 黑底不透明 RGB：先把「饱和主色 × 字形 opacity」与黑底混合成真实 RGB 辐射量，再正常 blur / 降采样 / 8 方向平均 + 连续 blur；固定曝光只在模糊之后由最终 `ctx` 的宽柔光 / bloom / 光丝三个 `lighter` 整帧 `drawImage` 共享施加一次，缓存源 Alpha=1 让低亮 RGB 获得真实增益且色相保留、只有高亮核心饱和，black RGB0 在 lighter 中不抬黑、不盖画面；合成后 `ctx.filter='none'` 再叠透明 sharp。参数 / field / seed / 几何与其他测试功能不动，drawCalls 仍 ≤16。`wave-grid` 新增 6 项程序生成单色品红 / 红 / 绿青小光点的 glow-only halo 保色回归（共 **51 项**），原 45 项（含 `glow 0.6/0.8/1` 严格递增、方向光斑、黑留白 >20%）全部保留。实现侧只跑 `node --check`、`npm run check` 48/48、`npm run build`、`git diff --check`，**未启动浏览器**；浏览器 wave+home 复跑、最终颜色目视与封面重抓已由 Codex 独立复跑通过。

## 本批验收结果（Codex 独立复跑：全绿 · 0 失败）

- 其余 11 份规格合计 **365 项断言**通过，`wave-grid` **11/11**、`ascii-motion` **25/25**，0 浏览器错误；实际 PNG 下载通过。
- 首页白底、12 个工具黑色外壳与唯一左上返回在桌面 1440 / 390 宽通过；两个点阵 / 字符画工具的 opaque JPEG 自动明暗与无效文件保留当前帧通过。
- 性能（Chrome 同机 **浏览器主线程 TaskDuration**，非整机 CPU）：`ascii-motion` 1.3–1.6%、`wave-grid` **属旧实现的 1.2–1.4%**，30fps；暂停 renders 0，resize 只重绘一次，另开 tab `document.hidden=true` 后 renderCount 不变。当前 `wave-grid` 新实现见下方最新验收。
- `mixed-type` / `wave-grid` / `ascii-motion` 封面已抓取；`wave-grid` / `ascii-motion` 最新导出已复制到 `dist/assets/covers/`（sha256 与 `public/` 一致）。
- 本轮无功能代码变更；本地 demo **未提交、未推送**。

## 最新验收（首页 / SVG立体 / 辉光点阵 · Codex 独立复跑全绿）

- 首页 **86/86**（1440 / 1920 / 2560 / 390 宽，白底、全宽横线、搜索、15 条目）；SVG立体 **115/115**；辉光点阵 **51/51**（halo 颜色、glow 0/.6/.8/1、密度、方向长度、PNG）。
- 玻璃 ior 1→1.5 三区域位移约 (-6,+5)、1→2 约 (-8,+8)，0 错误；默认玻璃 16% 上传图片实测 transmission 1 / opacity 1 / IOR 1.5 / effectiveThickness .8，有效 alpha 中位 4824、部分 1576、四角 0（80×80 采样）。
- 辉光点阵新实现约 30fps、7821–11737 格 / 15 drawcalls，暂停 delta 0，浏览器主线程 TaskDuration 14.7–19.3%（非整机 CPU）。
- 无新增运行时依赖、无 vgpu 引擎；Three 0.186.1 支持背景折射，但不等同 vgpu raymarch / TIR。
