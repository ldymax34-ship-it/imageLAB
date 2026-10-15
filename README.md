# ImageLAB

名称拼写固定为 **ImageLAB**（首字母 `I` 大写、`mage` 小写、`LAB` 大写）。

生成纹理、处理图片、探索材质。调好参数，直接出图。12 个内置工具在本地处理素材、不上传。

一个**纯静态、纯前端**的图像设计工具箱：首页 `index.html` + `tools/<id>/` 下的独立工具网页。
内置工具只在本地浏览器里处理素材，不上传；没有数据库、没有账号、没有服务端渲染、也没有运行时远程模型或 API。
首页另登记 **4 个外部网站入口，只做跳转**（外部网站内容由对方提供，本项目不部署、不复制源码 / 字体 / 素材、
不 iframe、不引入运行时外部请求；外链卡片上的缩略图是验收方从公开官网当前页面截取、保存进本仓库的本地 PNG，
运行时只从 `assets/covers/` 加载），因此「素材不上传」只适用于 12 个内置工具，不构成对第三方网站的保证。

## 快速开始

```bash
npm install          # 安装依赖（three / @visant/extrude3d / @paper-design/shaders / vgpu / vite）
npm run dev          # 开发服务器 http://127.0.0.1:5177
npm run build        # 构建完整静态产物到 dist/
npm run serve        # 本地静态服务器打开 dist（http://127.0.0.1:4890）
npm test             # 纯 Node：纹理间 4 套测试（34 项）+ 本地服务器自检 + 双页签静态自检 + scripts/check.mjs + tests/workspace-ui.test.cjs（工作台 UI 静态自检 10 项）
npm run check        # 纯 Node 静态自检（入口、远程资源、字节一致性、许可、清单对齐）
npm run fixtures     # 重新生成测试素材
```

macOS 用户可以直接双击 **`启动图像实验室.command`**：会自动安装依赖、构建、并在
`127.0.0.1` 上启动本地服务器后打开浏览器。

> 首页视觉：纯白 + 纯黑 + 中性灰，只保留一处 `public/brand/ImageLAB-logo-preview.png` 主字标（CSS 裁空白），
> 宽约 33vw、高 64–96px；顶部小 logo、说明导航均已删除。
> 工具按陈列顺序展示：首行是 SVG 转 3D、标志材质、动态背景、半调网点；「纹理间」更名为「纹理生成器」。
> 版式是「大留白 + 细线切割」：贯穿整视口的 1px 横线分段（顶栏 / 首屏 / 工具区标题 / 页脚）。
> **首屏只有一个字标**，不放说明文字、按钮或数字徽标；留白是定量的——
> 顶栏横线 → 字标 ≈ 96–120px，字标 → 工具栏横线 ≈ 84–100px，首屏整块 240–420px（不撑满视口、不空掉半个屏幕）。
> 工具一览为连续 12 栏网格：**桌面一行 4 个**（各占 3 栏）→ 中屏（≤1000px）2 个 → 小屏（≤660px）1 个；
> 卡片行距 56–88px，工具区上下留白 72–120px，区块标题是小字号 + 0.2em 字距的标签（压得住卡片名）。
> 页面文案只保留必要信息：卡片只有「封面 / 名称 / 分类 / 入口」四段，
> `assets/tools.js` 也据此不再登记 desc / note / span（keywords 只服务搜索）。
> 首页回归：16 个入口（12 个内置 + 4 个外部）、12 张内置真实封面、全部内置入口 HTTP 200、
> 4 个外链卡片都有本地加载成功的官网缩略图（cover URL 必须是站内 `assets/covers`，不是远程 URL）、
> bayer 搜索、分类、1440 与 390 宽无横向溢出、body 纯白、1440/1920/2560/390 四档每行个数、
> 首屏「只有字标」+ 字标尺寸 + 上下留白定量（96–150 / 84–140px，首屏 240–420px）；
> 外部入口只断言标注 / target-rel / 网址 / 关键词 / 本地封面，不向外部发请求。

## 工具清单与状态

| 入口 | 工具 | 站点内页面地址 | 主要能力 | 导出 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `tools/texture/` | 纹理生成器 | `tools/texture/index.html` | 点阵渐变与曲线纹理，参数化无缝图案 | PNG / SVG / 参数 JSON | 已通过浏览器验收 |
| `tools/pixelit/` | 像素画 | `tools/pixelit/index.html` | 上传图片像素化，像素尺寸 / 调色板 / 灰度 | PNG | 已通过浏览器验收 |
| `tools/image-to-ascii/` | 字符画 | `tools/image-to-ascii/index.html` | 图片转字符画，保留明暗关系 | PNG | 已通过浏览器验收 |
| `tools/extrude3d/` | SVG 转 3D | `tools/extrude3d/index.html` | **建模 / 渲染双页签**：建模页签用 Three.js 做 SVG 挤出（厚度 / 倒角按最大平面边长百分比、平滑度、原生圆角立方体默认）与中性灰诊断预览；渲染页签用 vgpu / WebGPU 接收同一份 position / normal / uv / index 网格与**归一化二维外轮廓**，提供 7 个中文材质预设（透明玻璃 / 磨砂玻璃 / 彩色亚克力 / 塑料 / 陶瓷 / 金属 / 镀铬）、**色散范围 / 色彩强度 / 折射变形三个设计师参数（0–200%）**、**「色散光束」开关（白光穿过当前 SVG 模型，含光束方向 / 位置 / 强度）**、棚拍灯光与环境、纯色（黑 / 白快速预设 + 自定义颜色，默认白）/ 棚拍渐变 / 背景图片（居中 cover、1×–3× 缩放、横向 / 纵向平移）、独立镜头 | PNG（渲染页签当前帧，可选透明背景） | 本轮 91/91 已由 Codex 真实 Chrome WebGPU 验收（0 页面错误） |
| `tools/image-to-pixel/` | 图片抖动 | `tools/image-to-pixel/index.html` | 像素化 + 7 种抖动 + 数组调色板 | PNG | 已通过浏览器验收（34 项） |
| `tools/shaders-logo/` | 标志材质 | `tools/shaders-logo/index.html` | 液态金属等着色器 Logo / 图片遮罩 | PNG（单帧） | 已通过浏览器验收（19 项） |
| `tools/shaders-bg/` | 动态背景 | `tools/shaders-bg/index.html` | 动态背景效果集 | PNG（单帧） | 已通过浏览器验收（8 效果 / 参数 / 单帧 PNG） |
| `tools/shaders-halftone/` | 半调网点 | `tools/shaders-halftone/index.html` | CMYK 半调、网点半调、图片抖动 | PNG（单帧） | 已通过浏览器验收（28 项） |
| `tools/psychos/` | 图片拼贴 | `tools/psychos/index.html`（需先 `npm run build` 再 `npm run serve` 打开） | 节点式生成式版式：Grid / Shuffle / Slice / Place | PNG 2048×2048 | 已通过浏览器验收（20 项，需 WebGPU） |
| `tools/mixed-type/` | 文字混排 | `tools/mixed-type/index.html` | 中英文混排文字海报：字族池 / 字号 / 行高 / 字距 / 随机抖动 / 描边比例，固定种子可复现 | PNG | 已通过浏览器验收 |
| `tools/wave-grid/` | 辉光点阵 | `tools/wave-grid/index.html` | 竖幅 4:5 宽厚分段色带（固定种子稳定构图）：密度真值 + 粗/中/细预设、辉光强度 / 长度（0–120px，默认 72px）/ 方向 / 色带宽度；字母与本地图片取样 | PNG（当前帧） | 已通过浏览器验收（51/51）；封面已随本批 `coverQuery=20261014-refresh1` 重抓（720×900，已目视确认） |
| `tools/ascii-motion/` | 动态字符画 | `tools/ascii-motion/index.html` | Three 预设 / 本地文字 / 图片以复用 Canvas 字符渲染；自定义字符集与动效 | PNG（当前帧） | 已通过浏览器验收（25 项） |

首页登记全部 12 个内置入口（含 `tools/psychos`）。此前的 **310/310 浏览器验收** 与 9 页主题审计是本轮改动前的历史基线；本批已由 Codex 独立复验通过：其余 11 份规格合计 **365 项断言**通过，`wave-grid` **11/11**、`ascii-motion` **25/25**，0 浏览器错误；首页白底、12 个工具黑色外壳与唯一左上返回在桌面 1440 / 390 宽通过。画布、源图片、纹理图案、材质与封面保留各自的颜色。静态检查、单元测试与构建以本轮实际结果为准。

### 工具工作台 UI（2026-10-14，用户专项授权；Codex 真实 Chrome 已验收通过）

带播放控制的 5 个自建工具（`shaders-logo` / `shaders-bg` / `shaders-halftone` / `wave-grid` /
`ascii-motion`）与 `extrude3d` 共用一套工作台骨架：**桌面 ≥1000px 用 `100dvh` 工作区，body 不产生
页面纵向滚动**；紧凑顶栏放返回首页、工具名与必要状态；主画布占据剩余工作区并始终可见；参数区改为
**300–330px 悬浮检查器**（距工作区边缘 16px、只有检查器内部滚动），用**分类标签页**只显示当前分类；
播放 / 暂停、速度、帧与定格等已有播放控件集中到**主画面正下方的播放条**，桌面始终可见。
**小屏 <1000px 回退自然文档流**，允许纵向滚动，画布在前、面板在后，不横向溢出。

- 共享文件：`assets/workspace.css`（骨架 / 分类导航 / 播放条 / 画布工具栏）与
  `assets/workspace.js`（`mountCategoryTabs`，只切换 `hidden`，不重建控件、不重置参数 / 素材 / 当前帧 / 相机）。
- 分类：shader 三工具「素材 / 效果 / 构图 / 输出」（动态背景无素材输入，运行时隐藏空分类）；
  `wave-grid`「图形 / 外观 / 动效 / 输出」；`ascii-motion`「图形 / 外观 / 动效 / 输出」；
  `extrude3d` 保留顶部「建模 / 渲染」主页签，建模内「导入 / 几何」、渲染内「材质 / 灯光 / 背景 / 输出」。
- `extrude3d` 渲染画布右上角新增「重置视图」入口（复用原 `render-reset-view`，恢复摄像机位置、
  观察中心与模型默认构图，点击后 `controls.update()` 并提示「摄像机与模型构图已重置」）；建模画布
  工具栏同样放置原有「重置视角」。
- 所有原有控件 ID、值、事件与状态同步保持不变；未改 shader、渲染算法、动画算法、现有参数默认值、
  上传校验与导出结果，也未改首页与未授权工具。
- 静态自检：`tests/workspace-ui.test.cjs`（10 项纯 Node）验证分类导航语义、播放控件唯一且位于播放条、
  桌面 `100dvh` / 内部滚动、小屏回退、重置视图位置与全部原有控件 id 保留。
  实现侧当时**未启动浏览器**（历史事实）；**真实 1440×900（桌面）与 390×844（窄屏）浏览器验收已由 Codex
  用真实 Chrome 完成并通过**：六工具布局全部通过（桌面 body 不滚动、画布 / 播放条在视口、检查器
  overflow auto；窄屏自然滚动、画布在前、面板在后、无横向溢出），六份规格 `ascii-motion` **25/25**、
  `extrude3d` **79/79**、`shaders-bg` **37/37**、`shaders-halftone` **29/29**、`shaders-logo` **19/19**、
  `wave-grid` **51/51**，全部 0 页面错误。


> **SVG 转 3D 双页签（2026-10-14，用户专项授权）**：`tools/extrude3d` 分为「建模」与「渲染」两个页签。
> 建模页签用 Three.js 只做 SVG 导入与安全校验、`ExtrudeGeometry` / 原生圆角立方体、厚度 / 倒角 / 平滑度，
> 以及**固定中性灰**诊断预览；它把同一份 `position / normal / uv / index` 网格在内存中交给渲染页签。
> 渲染页签用 `vgpu@0.6.0`（MIT，WebGPU）负责材质、灯光、背景、镜头与当前帧 PNG 导出，首批只有
> **7 个中文材质预设**（透明玻璃 / 磨砂玻璃 / 彩色亚克力 / 塑料 / 陶瓷 / 金属 / 镀铬），不再有 38 个
> Three.js 材质预设、表面贴图或 Three 棚拍 / 环境光控件。WebGPU 不可用时渲染页签显示中文提示，建模页签仍可用。
> 玻璃按「背面世界坐标预通道 + 正面透射通道」估算任意闭合挤出网格的厚度与出射，支持明显折射、Fresnel、
> 有限色散与有限 TIR；不承诺复杂非流形模型的多次内反射。依赖精确锁定、许可见 `THIRD_PARTY.md`；
> 浏览器视觉 / 像素 / 导出已由 Codex 用真实 Chrome WebGPU 验收 **68/68**。
>
> **2026-10-14 首轮阻塞修复（DSH 执行；Codex 真实 Chrome WebGPU 已验收 68/68）**：`background.wgsl` 是 fragment-only，
> 原先却用 `draw()`（默认查找 `vs_main`）创建背景，真实 Chrome WebGPU 报入口点缺失。现背景改用 vgpu 0.6.0
> 官方 `effect()`，由库注入内置全屏顶点通道（不自写顶点 shader）；`present.wgsl` 把模型合成到不带深度的
> 背景之上，背景不再写入 `sceneTarget` 深度，模型自遮挡成立。`setMesh(snapshot)` 收到合法快照即保存
> `meshSummary`，即使 WebGPU 尚未初始化或失败，实际 GPU 上传仍只在设备可用时进行。厚度测试改为比较
> mesh bounds Z / `thickness`，不再用顶点数判断。Codex 最终复跑 `IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d`
> 得 **68/68 PASS**、0 页面错误、0 跨源请求；首次 7 项失败是页面内 `drawImage(WebGPU / WebGL canvas)` 取样
> 得到透明位图的误报，改用 `ElementHandle.screenshot` 捕获浏览器合成结果后全部通过，功能阈值不放松。
>
> **2026-10-14 第二轮修复（DSH 执行；待 Codex 真实 Chrome WebGPU 视觉验收）**：
> ① **背景图片发白**：图片经 `copyExternalImageToTexture` 进 `rgba8unorm` 的字节是 sRGB 编码值，而管线按线性光
> 运算、最后由 `present.wgsl` 做 ACES + sRGB，等于把图片二次提亮。现 `common.wgsl` 提供 `srgb_to_linear`
> （与 `linear_to_srgb` 互逆），只在 `background.wgsl` 的图片分支线性化；纯色 / 基色经
> `Color.setStyle(hex, SRGBColorSpace)` 取线性值。上传后的 `bg_tex` 绑定不会回退到 1×1 白色 fallback。
> ② **玻璃没有背面**：`glassDraw` 原本 `cull: "back"`，最终画面只有正面片元、`backTarget` 只作厚度辅助纹理。
> 现背面同一趟既写 `backTarget`（仍供正面估厚度 / 出射）又按背面着色写进 `sceneTarget`（法线朝向、菲涅耳、
> 棚拍环境反射与吸收都复用官方 `transmission/glass.wgsl` 结构，不引入 raymarch / SDF），闭合模型的前后两个
> 界面都能辨认。③ **色散默认增强**：`dispersion` 直接作为官方 `dispersion_spread`，谱采样 11、金色角、
> 官方谱权重；默认值 0.09（透明玻璃）、0.06（彩色亚克力）、0（磨砂玻璃），滑杆仍 0–0.2、0 表示关闭。
> ④ **纯色黑白预设**：新增「黑色 / 白色」两个快速预设（默认白色），保留自定义颜色与棚拍渐变 / 图片模式。
> 新增 `tests/extrude3d-color.test.cjs`；`npm test` **57 项通过**、`npm run check` **56/56**、`npm run build`、
> `git diff --check` 通过；浏览器观感仍待 Codex 独立验收。

### 外部网站入口（仅跳转，不接入）

首页另有 4 个已核实公开官网的外链卡片（`external: true`）：封面区显示**本仓库本地**的官网页面缩略图
（右下角叠层保留「外部网站 · 跳转官网」标识与主机名），按钮为「打开官网 ↗」，封面区与按钮均
`target="_blank" rel="noopener noreferrer"`。缩略图缺失 / 加载失败时退回纯文字外链块，不显示破图。
它们不是内置开源接入：不部署、不复制源码 / 字体 / 媒体、不 iframe、不引入运行时外部请求或依赖；
外链缩略图只是导航预览，运行时首页只从 `assets/covers/` 加载本地图片；第三方站点的 `free`
声明不当作代码授权。

| 入口 id | 名称 | 类别 | 官网地址 | 本地缩略图 |
| --- | --- | --- | --- | --- |
| `space-type-generator` | 动态文字（Space Type Generator） | 字符与文字 | https://spacetypegenerator.com/ | `assets/covers/space-type-generator.png` |
| `shader-lab` | 图片特效（Shader Lab） | 着色器效果 | https://eng.basement.studio/tools/shader-lab | `assets/covers/shader-lab.png` |
| `tooooools` | 图像网点（Tooooools） | 像素与点阵 | https://www.tooooools.app/ | `assets/covers/tooooools.png` |
| `brand-assets-generator` | 品牌素材生成（Brand Assets Generator） | 版式与切片 | https://brand-generator.stoyanov.works/ | `assets/covers/brand-assets-generator.png` |

**Brand Assets Generator 未找到公开源码 / 许可证**：官网 HTML 与打包 bundle 没有 GitHub 或许可证链接，
GitHub 公共搜索也没有对应仓库 → 不能认定开源，**不本地镜像源码 / 字体 / 素材**，只登记为外链入口；
外链封面是验收方从公开官网当前页面截取的本地 PNG，**截图许可不等于代码开源许可**，也不代表获得再分发授权。

搜索分类沿用现有系统（不新增 tab / filter 开关）。`scripts/check.mjs` 对内置入口校验本地文件 / spec / dist，
并统一要求所有入口（含外链）的 cover 是本地相对路径、禁止 http(s) 封面；外链额外校验 4 张封面文件位于
`public/assets/covers/`；`tests/specs/home.mjs` 对外链卡片断言标注 / target-rel / 准确网址 / 关键词搜索 /
本地缩略图加载成功且 URL 是站内 `assets/covers`，不向外部 fetch（避免 CORS 假失败）。

`tools/extrude3d` 的本地 SVG 导入上限为 **1 MiB**；单个 `<path>` 曲线过多时，会按**本次真实使用的**
`curveSegments` / `bevelSegments` / `bevelEnabled` 采样轮廓点估算挤出顶点数：超预算先按采样数把
曲线 / 倒角细分降到合理下限（曲线 8 段、倒角 2 段），仍超出硬上限才拒绝并保留上一次成功模型。
只数「图形元素个数」拦不住的单条超密集 path 由这条几何闸门兜住；`defs` / `metadata` 里未使用的
普通定义不再被正则误判（可见元素上的 `filter=` / 文本 / 位图 / `<use>` 等仍明确拒绝）。

`tools/extrude3d` 的**基础色表面贴图**与 Three 棚拍 / 环境光 / 主光控件已在双页签迁移中移除；
材质与灯光改由渲染页签的 vgpu 管线负责（首批 7 个中文预设，不含贴图）。背景图片能力保留并迁移到渲染页签：
上传本地 PNG / JPEG / WebP（≤10 MiB、单边 ≤4096 像素）后由 WebGPU 背景全屏效果按「居中 cover + 缩放 + 平移」采样，
透明背景时预览与导出都不显示背景，移除后回到所选纯色；同样的校验与「无效选择保留原背景」规则不变。
不打包贴图素材，不加法线 / 粗糙度 / 置换编辑器，不新增后端 / CDN。对应浏览器断言由 Codex 独立复验。

> 工具页界面与共享返回入口使用**黑 / 白 / 中性灰**；首页维持原白色样式。画布 / 素材 / 算法输出 / 材质调色板与真实封面保留原有色彩。
> `tools/texture` 只允许整合页 `index.html` 与 `style.css` 有 UI 差异；六份 JS 与 `_source_snapshot` 的 8 份原件继续逐字节 / 哈希校验。

### 本批新增的 3 个工具（视频效果复刻 · 独立实现）

`tools/mixed-type` / `tools/wave-grid` / `tools/ascii-motion` 是依据用户提供的参考视频**新写的独立实现**：
只使用仓库已锁定的 three 0.186.1（MIT）与浏览器原生
Canvas 2D / `Intl.Segmenter` / `FontFaceSet` / `window.queryLocalFonts`，不复制任何商业站点源码、品牌、
素材或字体，也不把这些页面当作模板。参考来源「Mixweight」的网址在本机**不可达**，未能逐条核对原始开源许可；
本批按用户对「按视频效果实现」的专项授权执行，实现与许可登记以本仓库（`THIRD_PARTY.md`）自身为准。
字体一律使用访问者本机已安装的系统字体，仓库**不打包、不分发**任何字体文件；本机字体的许可由使用者在
自己的机器上自行确认。三条封面路径已登记，并已由 Codex 用真实导出入库，占位图不伪造效果图。

`public/assets/covers/*.png` 是首页运行时唯一加载的封面来源（**全部为仓库本地图片**，共 16 张，
已全部由 Codex 在真实浏览器抓取完成并目视确认）：

- **12 张内置工具封面**：真实工具 PNG 导出（互不相同，实际内容已核验），由
  `IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs` 生成（先服务构建产物 `dist/`；
  优先取工具真实导出，退路只截真实预览画布，不截节点编辑器 UI；每个工具使用独立临时下载目录，
  只等待本次导出结果）。本批已按当前 DOM / 分类结构刷新全部 12 张（含双页签 `extrude3d` 的
  渲染页导出，以及导出按钮位于隐藏「输出」分类的 shader / wave-grid / ascii-motion）。
- **4 张外链官网缩略图**：由
  `IMAGELAB_BROWSER_TESTS=on node scripts/capture-external-covers.mjs` 从 4 个固定公开官网的
  当前视口截取（1440×900 视口、非整页长图，缩到 ≤1280px 宽），保存为
  `assets/covers/<id>.png`，来源 URL 记录在 `public/assets/covers/external-covers.json`；
  4 张均为 **1280×800**。
  该脚本默认关闭、只接受固定 id（不接受任意 URL），页面打不开即失败退出、不创建伪封面。

`assets/tools.js` 中 16 个入口统一使用 `coverQuery: "20261014-refresh1"`，强制换新缓存、避免首页命中旧封面。
封面缺失时首页显示中性文字占位（内置）或退回纯文字外链块（外链），不会破图、也不会用 AI 图或整页截图冒充效果图。
`public/` 会在 `npm run build` 时复制进 `dist/`，供首页直接使用。

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
assets/                    首页样式、脚本与工具清单；workspace.css / workspace.js 为六个自建工具共享的工作台骨架与分类导航
tools/<id>/                每个工具的独立网页
  ├─ index.html
  ├─ main.js               入口（需要 Vite 打包的工具）
  └─ ...                   该工具自己的资源
public/                    原样复制到 dist 根目录的静态资源（封面、返回链接样式）
scripts/                   构建、静态复制、封面、许可汇总、静态自检等脚本
tests/                     浏览器验收规格（harness + 每个工具一份规格）与 Node 静态自检（含 workspace-ui.test.cjs）
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
| `tools/extrude3d`（SVG 转 3D） | 建模页签任意现代浏览器；**渲染页签**需要 **WebGPU** 与安全上下文（`http://127.0.0.1` / HTTPS）。WebGPU 不可用时渲染页签显示中文提示，建模页签仍可用 |

## 测试与验收

本批次的**浏览器验收已完成**（用真实 Chrome 驱动交互：上传图片、调参、点导出并校验下载到的
PNG 尺寸；GPU 工具断言 WebGL2 / WebGPU 真实可用）；SVG立体由 Codex 独立复跑 **81/81 PASS**（全套 310/310 为改动前基线，本批结果见文末「本批验收结果」）。需要复跑时：

```bash
IMAGELAB_BROWSER_TESTS=on npm run smoke                      # 顺序跑全部工具，只启动一个 Chrome
IMAGELAB_BROWSER_TESTS=on npm run smoke -- texture home      # 只跑指定工具
IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs             # 刷新 12 张内置工具封面（真实导出画面 / 画布区域）
IMAGELAB_BROWSER_TESTS=on node scripts/capture-external-covers.mjs    # 抓取 4 张外链官网本地缩略图（固定官网、当前视口）
IMAGELAB_BROWSER_TESTS=on SMOKE_HEADFUL=1 npm run smoke      # 需要看到窗口时
CHROME_PATH=/path/to/chrome npm run smoke
```

浏览器验收开关默认关闭，实现侧误跑会直接提示并以退出码 `2` 结束。
Node 侧不受影响：`npm run build`、`npm test`（纹理间 4 套 Node 测试共 34 项 + 本地服务器自检 + 双页签 / 颜色空间 / vgpu 管线 / 工作台 UI 静态自检 + `scripts/check.mjs`）照常可跑。
详见 [tests/README.md](tests/README.md)。

> 说明：仓库根 `package.json` **不设** `"type": "module"`——`tools/texture` 的那份 Node 测试套件是
> 上游原样的 CommonJS（`require("./engine.js")`），设成 module 会让它全部失败。构建与脚本一律用 `.mjs`。

`npm run build` 会：Vite 打包多页入口 → 复制原样搬运的静态工具 → 构建 `tools/psychos`。

## 许可

第三方来源与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)，许可原文见 [`third-party-licenses/`](third-party-licenses/)。

`tools/texture` 为用户原创项目（含 `curve-fit.js`），已确认可公开；整合副本允许 `index.html` / `style.css` 的 UI 更新，
六份 JS 仍应与上游逐字节一致，`_source_snapshot/` 的 8 份根原件哈希未改动、原样保留。
本项目整体尚未选定对外许可证，在以权利人的决定为准之前视为保留所有权利。


### 2026-10-13 · 首页宽排版重做 + SVG立体玻璃折射 / 主光 / 百分比几何（本轮）

- **首页**（`index.html` / `assets/home.css` / `assets/home.js`）：纯白 / 黑 / 中性灰；去掉 1360px 上限改为全视口宽排版（左右 padding `clamp(24px,3vw,96px)`，移动 20px），保留 12 栏网格：桌面默认 2 列、`≥1800px` 3 列、中屏 2 列、小屏 1 列；顶栏 / hero / 工具区标题 / 页脚用贯穿整视口的横线切开大区块，工具区上下留白与卡片行距 80–120px，字标仍用已批准的 ImageLAB 图片（未新增 logo）。参考了 <https://superopc.app/> 的宽排版观感，未复制其代码 / 素材；`tests/specs/home.mjs` 把旧的 3 列断言改为 2 / 3 列，并新增 1920 / 2560 宽度与移动端无横向溢出检查。
- **SVG立体 · 玻璃折射**：上游 `materialPresets.glass` 只有 `opacity=.35/transparent`、没有 `transmission`，因此此前看不到折射。本轮按 three 官方 `MeshPhysicalMaterial` 透射配置改为 `opacity 1 / transmission 1 / metalness 0 / 低 roughness / ior 1.5`，并新增「透明玻璃」专属的中文控件：折射率 1–2.4（默认 1.5）、光学厚度 0–2×（默认 1）、色散 0–1（默认 0.15）。three 0.186.1 的 `getVolumeTransmissionRay` 明确按**网格局部坐标**处理 `thickness` 并在着色器里乘 `modelScale`，所以材质 `thickness` 必须先由世界空间目标厚度除以等比缩放换算回局部坐标，避免被 `mesh.scale` 二次缩放：透明玻璃世界空间有效厚度 = 归一化后真实模型厚度 × 光学厚度倍数，其他透射材质保留各自预设的世界空间目标厚度；`getInfo().material.effectiveThickness`（= `thickness × scale`）只读可查。磨砂玻璃 / 钻石 / 树脂等其他透射材质保持各自预设，不用低 opacity 稀释折射；背景仍是 `scene.background`（不改成平面）。纯色背景没有可折射的细节，界面已如实写明「折射需要背景有细节，请上传背景图片；透明背景导出时没有可折射的背景」。不引入 vgpu 运行时，也不宣称与之等同。
- **SVG立体 · 基础主光**：新增一盏 three 原生白色 `DirectionalLight`（强度 0–3、方向角 0–360°，固定仰角、不投影），与现有 `RoomEnvironment` + PMREM 环境反射同时作用；只暴露两个控件，改参数即时更新真实高光、不重建几何。
- **SVG立体 · 几何参数**：厚度改为「最大平面边长」的 2–100%（默认 16%），边缘圆角 0–10%、倒角深度 0–10%（0 完全关闭）；复用上游 `buildExtrudeSettings` 的深度 / 细分 / 预算裁剪，倒角尺寸按百分比单独换算并沿用「不超过厚度一半」的保护上限，达到限制时状态栏写出实际值而不是静默钳制。只归一化一次到「平面最大边长 = 4 单位」（不再用 3D 最大边），厚度 / 倒角改动不会被缩放抵消；20 / 200 / 2000 同比例 SVG 归一化结果一致。
- **SVG立体 · 导入闸门**：上限 64 KiB → **1 MiB**；几何估算改为使用本次真实的 `bevelEnabled` / `bevelSegments` / `curveSegments`，超预算先按采样数降低细分（曲线 8 段、倒角 2 段），仍超 600000 顶点才拒绝；解析后、`measureFlatMaxDim` 的 `ShapeGeometry` 三角化**之前**先按最低细分做下限估算，连下限都超预算的密集 path 直接拒绝（倒角关闭时按 0 段下限，避免误伤「关掉倒角才装得下」的输入），防止大 path 三角化卡住主线程。脚本 / 内联事件属性 / 内部 `ENTITY` / 外部 `href`·`src`·`url()`·`@import` 引用按**原始文本**拒绝（连 `defs` / `metadata` 里也拒绝），同时放行命名空间 URL、metadata 正文、本地 `#fragment` 引用与不含内部实体的普通 SVG 1.1 `DOCTYPE`。`defs` / `metadata` 里未使用的普通定义不再被正则误判，可见元素上的滤镜 / 文本 / 位图 / `<use>` 等仍明确拒绝。解析结果按 SVG 文本缓存、重建用 RAF 合并，拖动滑块不做逐帧 `parseSVG`；失败时保留上一次成功模型 / 贴图 / 背景 / 相机。
- **测试与文档**：`tests/specs/extrude3d.mjs` 新增同比例归一化与玻璃世界空间有效厚度一致（20 / 200 / 2000）、厚度 2/16/70、倒角 0/2/6 的真实 bounds 与像素变化、达到上限时的实际值反馈、100 / 400 段平顺闭合轮廓自适应接受（原「400 曲线被拒」预期已废弃，实际顶点 ≤ 600000）、2200 条曲线的真正硬上限在三角化前被拒并保留旧模型、普通导出（DOCTYPE / 命名空间 / metadata 正文 / 未使用 defs / 本地 #fragment）可导入、脚本 / 内部实体 / 外部资源引用与可见滤镜仍拒绝、64 KiB–1 MiB 可导入 / >1 MiB 拒绝、玻璃 ior 1 / 1.5 / 2.0 在非周期背景下的多区域空间错位（不只是明暗或属性变化）、主光方向移动高光，以及 `getInfo()` 只读几何 / 材质 / 灯光诊断。本仓库不启动浏览器，以上待 Codex 独立复验。
- **vgpu 只读参考**：官方 `transmission` 示例是屏幕空间做法（整帧 → 金字塔模糊 → Snell 折射 + 色散 + Fresnel 环境反射，`glass.wgsl` / `blur.wgs`），`glass-sculpture` 是程序化 SDF 光线步进，`tsl-exports` 是 WGSL → Three TSL；许可为 MIT（<https://github.com/vercel-labs/vgpu>）。本轮只参考思路，未移植代码、未引入运行时依赖，THIRD_PARTY 无需新增许可。
- 验证：`npm run check` 48/48、`npm run build`、`git diff --check` 通过；**未启动浏览器**，Codex 浏览器验收待执行。

### 2026-10-13 · 辉光点阵微调（默认辉光能量 / 构图 / 稳定种子）

- **默认辉光能量**：`GLOW_GAIN=3.6` 在 1/8 bloom 与 1/4 光丝缓存的曝光阶段用原生 `brightness(3.6)` 施加一次（不新增控件，强度 0 仍严格跳过整段辉光）；最终合成 alpha 为 `glow^0.8`（默认 0.55 → α≈0.62、α(1)=1，严格递增无 clamp，修复旧 `clamp(glow*3.6*系数,0,1)` 在 glow≥0.56 的高段死区）；辉光层改用四条色带的**饱和主色**发光，清晰层继续保留白 / 浅色实心核；默认长度 48 → **72px**，控件上限仍 0–120。
- **构图**：`BAND_SLOPE` 0.65 → 0.33、`BAND_CENTERS` 改 `[0.10, 0.34, 0.58, 0.82]`、`HALF_WIDTH` 0.125 → 0.105；蓝从左上约 y=0.10 平缓斜向右下，品红中上、红中下、绿最下（右端自然裁切），Node 复算默认亮格约 48%（40–55% 带内）、四色占比约 30 / 29 / 25 / 16%。
- **稳定构图**：`SimplexNoise` 不再用默认 `Math.random` 建置换表，改用内置 mulberry32（等价 three `seededRandom` 的算法，不新增依赖）以 `state.seed` 固定初始化一次；每次 reload 构图一致，且不逐帧 / 不逐布局重随机，也不新增「重新随机」入口。
- **测试**：`tests/specs/wave-grid.mjs` 的方向判据改为载入程序生成的透明白点画幅（非用户素材）自动 alpha 取样，按光斑 halo 的空间方差 / 范围验证长度 0 → 120、90° 纵向与 0° 横向；新增默认辉光 vs 强度 0 的 halo 亮度 / 覆盖显著增加、且黑色留白仍 >20% 的检查。UI 文案改为「强度 0 关闭辉光，保留清晰点阵」，长度 / 方向数字控件标注 px / °。
- 验证：`npm run check` 48/48、`npm test` 35/35 + 48 项静态检查、`npm run build`、`git diff --check` 通过；**未启动浏览器**，wave-grid 浏览器规格与 `public/assets/covers/wave-grid.png` 重抓待 Codex 执行。

### 2026-10-13 · 辉光点阵改版（密度真值 + 宽厚色带 + 方向辉光）

- **密度 bug 修复**：不再用 `9-(density-.55)*2` 再靠 `while` 压到同一格数；改为 density → CSS 网格间距的单调映射（0 粗 ≈13.5px、1 细 ≈7.4px、默认 0.55 ≈9px），格数 / 间距与控件同步，粗 / 中 / 细三个预设共用同一密度参数。
- **画面形态**：竖幅 4:5、最大 720 居中；四个斜向宽厚色带用 `three` 自带 SimplexNoise（布局时按格预计算）做不规则分段，亮核为连排实心 ■、过渡 □、边缘 × 与稀疏白色亮簇，保留大块黑留白。
- **辉光**：强度与长度（0–120px）、方向（默认 90° 纵向）、色带宽度独立可调；按 shader-lab 的 `directional-blur-pass`（有限方向取样）与 `dual-filter-bloom`（多级缩放）做 Canvas 等效适配，1/4 块缓冲 8 次位移 + 1/8、1/16 两级柔光，整帧 `drawImage` ≤16 次，无逐格 filter。
- **接口与测试**：PNG 仍是当前 canvas 帧；`tests/specs/wave-grid.mjs` 覆盖 1440 / 390 密度低中高、预设、glow0 / 长度 0–120 / 方向、黑留白与宽亮核、四色、暂停 / 隐藏 / 缩放、非法上传保留与导出 PNG 逐像素一致。
- `npm run check` 48/48、`npm test` 35/35 + 48 项静态检查、`npm run build`、`git diff --check` 通过；视觉与性能已由 Codex 独立验收通过（见文末最新验收）。

### 2026-10-13 · 字符点阵与工具界面更新

- `wave-grid` 改为固定约 9 CSS px 字符格，默认四条窄色带，含填充 / 空心 / 叉号迟滞状态与全画面缓存辉光；增加字母图形与透明 PNG 轮廓取样。
- `ascii-motion` 使用单张 Canvas 输出预览与 PNG，Three 采样上限 160×100 格、DPR 上限 1.5、30fps；增加自定义字素字符集、本地图片 / 文字平面与波动 / 呼吸 / 旋转。透明 PNG 默认按 alpha 轮廓显示。
- 12 个工具页面统一使用深色中性色界面与左上返回首页链接；首页本身不变，纹理间只调整入口 / 主题文件，原始 8 文件快照保留。
- 静态检查、测试与构建状态以本次实际运行结果为准；浏览器效果和性能已由 Codex 独立验收通过（见文末「本批验收结果」）。

### 2026-10-13 · 点阵辉光合成修正

- `wave-grid`：字形先绘到每帧清空的透明缓冲，主画布纯黑底；复用 1/4 分辨率透明 bloom 绘小点块提高光能，两档柔光以 `lighter` 叠加后再用 `source-over` 叠回锐利字形，修复此前用不透明黑底覆盖柔光的问题。`glow=0` 完全跳过柔光，`glow=0.55` 为宽柔光且字形锐利、远处黑底不抬亮。
- 保持固定约 9 CSS px 格点、≤12000 格、画布边长 ≤1600、30fps；暂停与页面隐藏停止连续 RAF，暂停下改参数 / 缩放只重绘一次。字母 `a` 的字形高度调到约画面的 15–20%。
- `tests/specs/wave-grid.mjs`：清除图片后断言字母 mask 真实生效（小写 a 约占画面 15–20% 高）；暂停下 `glow 0 / 1` 产生真实像素差异，且远离色带的画面角落仍为纯黑。
- 本轮 `npm run check` 48/48、`npm test` 35/35 + 48 项静态检查、`npm run build` 通过；实现侧未启动浏览器，浏览器外观、上传、动效与性能已由 Codex 独立复验通过（见文末「本批验收结果」）。本轮为本地 demo，未提交、未推送。

### 2026-10-13 · 本批验收结果（Codex 独立复验）

- 浏览器规格全绿：其余 11 份规格合计 **365 项断言**通过，`wave-grid` **11/11**、`ascii-motion` **25/25**，0 浏览器错误；实际 PNG 下载通过。
- 首页白底、12 个工具黑色外壳与唯一左上返回在桌面 1440 / 390 宽通过；两个点阵 / 字符画工具的 opaque JPEG 自动明暗与无效文件保留当前帧通过。
- 性能（Chrome 同机 **浏览器主线程 TaskDuration**，非整机 CPU）：`ascii-motion` 1.3–1.6%、`wave-grid` **属旧实现的 1.2–1.4%**，30fps；暂停 renders 0，resize 只重绘一次，另开 tab `document.hidden=true` 后 renderCount 不变。当前 `wave-grid` 的新实现性能见下方最新验收。
- `mixed-type` / `wave-grid` / `ascii-motion` 封面已抓取；`wave-grid` / `ascii-motion` 的最新导出已复制到 `dist/assets/covers/`（sha256 与 `public/` 一致）。
- 本轮无功能代码变更；本地 demo **未提交、未推送**。

### 2026-10-13 · 最新验收（首页 / SVG立体 / 辉光点阵 · Codex 独立复跑全绿）

- 首页 **86/86**：1440 / 1920 / 2560 / 390 宽，白底、全宽横线、搜索、15 条目全部通过。
- SVG立体 **115/115**：塑料直接光照最终用例通过；玻璃 ior 1→1.5 三区域位移约 (-6,+5)、1→2 约 (-8,+8)，0 错误。
  默认玻璃 16% 配合上传图片实测 transmission 1 / opacity 1 / IOR 1.5 / effectiveThickness .8，玻璃有效 alpha 中位 4824、部分 1576、四角 0（80×80 采样）。
- 辉光点阵 **51/51**：halo 颜色、glow 0 / .6 / .8 / 1、密度、方向长度与 PNG 通过；新实现约 30fps、7821–11737 格 / 15 drawcalls，暂停 delta 0，浏览器主线程 TaskDuration 14.7–19.3%（非整机 CPU）。
  封面 `public/assets/covers/wave-grid.png` 与 `dist/` 副本 sha256 一致（`dd42c5cf...e481f5be`）。
- 无新增运行时依赖、无 vgpu 引擎；当前 Three 0.186.1 支持背景折射，但不等同 vgpu raymarch / TIR。本地 demo：http://127.0.0.1:4890/（未提交、未推送）。

### 2026-10-13 · SVG立体：棚拍空间背景 + 背景图片平移 + 玻璃双面 + 按需渲染（DSH 执行 · 待 Codex 浏览器验收）

- **棚拍空间背景（第三种背景模式）**：`背景模式：纯色 / 棚拍空间 / 图片`，纯色仍为默认、旧行为不变。棚拍空间是真实 WebGL 场景：
  一次性 PMREM 环境 + `three` 原生 `RectAreaLight`（暖主光 / 冷轮廓光，跟随现有主光强度与方向）+ 柔光箱加法发光板 +
  上亮下暗天幕 + `three` 原生 `Reflector` 真实地面反射（目标上限 512×512）。地面跟随模型真实包围盒落在最低点下方小间隙，
  地面反射用原生中性灰 `MeshPhysicalMaterial` 薄层压低，避免变成镜子。透明背景时棚拍可见几何全部隐藏、解除勾选恢复；
  相机与 userZoom 不受切换影响。只读参考官方 vgpu `glass-sculpture` 的 STUDIO 灯光取值，**未移植 WGSL / SDF 光线步进**。
- **背景图片平移**：新增「横向位置 / 纵向位置（-100–100%）」与「重置位置」；映射到 `Texture.offset`，始终落在 cover+缩放后的
  剩余裁切窗口内（不会拉伸 / 平铺 / 露白边）。某轴没有裁切余量时只禁用该轴滑杆并提示「放大背景后可移动裁切位置」；
  位置在材质 / SVG / resize / 透明开关间保持，重置或重新上传图片才回到 1× 居中。
- **玻璃真实双面**：所有透射材质统一 `DoubleSide` + `forceSinglePass=false`，走 three 原生多趟背面透射，隔玻璃可见背面表面；
  不透明材质仍 `FrontSide`，不新增重复半透明替身，局部厚度换算随几何变化保持不变。这是原生两趟透射，**不是** vgpu 多次弹射 TIR。
- **性能**：改为按需渲染 —— `OrbitControls` 的 change 事件与 `update()` 返回值驱动脏标记，空闲 / 标签页隐藏时不再出图，
  参数、上传、resize、导出都会重新出图；PMREM 与环境贴图只在进入棚拍时生成一次，镜像目标固定 512。
- 验证：`node --check`、`npm run check` 48/48、`npm run build`、`git diff --check` 通过；**未启动浏览器**，新增规格
  `tests/specs/extrude3d.mjs` 115 → 134 项待 Codex 独立浏览器复验。

### 2026-10-13 · SVG立体：原生真实立方体默认 + 总光量增益 + 强色散（DSH 执行 · 待 Codex 浏览器验收）

- **默认真实立方体**：内置样例首位新增「立方体」并设为默认，几何由 three 原生 `BoxGeometry` / addon `RoundedBoxGeometry`
  生成（4×4×4，Z = 4 × 厚度%，圆角由现有「边缘圆角宽度%」换算），默认「透明玻璃」；没有 SVG 近似或自研建模。
  切到 / 切回 SVG 时各自记住上次的几何滑杆（SVG 首次深度 16%），旧样例 / 上传 / 倒角预算 / 背景 / 贴图兼容不变。
- **总光量增益**：「灯光强度」同时缩放原生主平行光、棚拍面光源、可见发光柔光箱与 `scene.environmentIntensity`；
  「环境光」是叠加其上的独立倍数，0 时主光 / 环境反射 / 面板光熄灭而背景色 / 图片保留；不每帧重烘 PMREM。
- **棚拍反射修正**：地面 `Reflector` 不再旋转几何数据，改为物体 `rotation.x = -PI/2`，世界法线回到 (0,1,0)；
  中性灰地面层共用同一几何并同样转平，加径向 `alphaMap` 与雾 / 天幕调色，消掉斜切灰带与硬地平线。
- **强色散**：色散强度 0–20（默认 6，步进 0.25），仍为 three 原生 3 通道物理色散；新增「强色散示例」一键填参数并用页面内
  canvas 现画白底黑字 ImageLAB 背景（走既有本地图片校验管线，不联网、不用任何用户素材）。
- 验证：`node --check`（main.js / 规格）、`npm run check`、`npm run build`、`git diff --check` 通过；**未启动浏览器**，
  新用例待 Codex 独立复验。限制：原生透射是单次折射 + 屏幕空间色散，不等同多次内反射（TIR），不声称与参考图一致。

### 2026-10-15 · SVG 转 3D：色散光束作用于用户 SVG + 三个设计师参数（Codex 实施；真实 Chrome WebGPU 已验收 91/91）

- **需求纠正**：上一轮的「官方棱镜」固定场景已删除——三角棱镜只作为 vgpu 官网效果与实现参考。
  渲染材质区改为「**色散光束**」开关：白光穿过**当前用户上传并挤出的 SVG 模型**，显示内部折射与出射彩色色散，
  另有光束方向 / 位置 / 强度三个基础参数。玻璃实体始终是用户网格，不再有第二套场景。
- **建模→渲染交接外轮廓**：`modeling.js` 除网格外额外交接归一化二维外轮廓（世界 XY、已居中 / 缩放 / Y 轴翻转），
  `beam-outline.js` 去重、限 64 点、统一逆时针并判凸。首版只支持**单个闭合凸轮廓（含近似凸）**；
  多轮廓 / 孔洞 / 凹形时保留普通玻璃与背景折射，只关闭可见光束并给出中文原因。
- **上游最小泛化**：`prism/scene/optics.js` 与 `prism/scene/light-mesh.js` 里三角形专用的求交 / 追踪
  （`insideTriangle` / `intersectTriangle` / `tracePrismDetailed` / `beamIntersectsTriangle`）泛化为**凸多边形**版本，
  数学与上游逐字一致；光束网格、D65 光谱采样、Fresnel、内部路径、上游三级 Bloom 与渲染管线继续复用官网实现
  （上游 commit `81c4a27`，MIT）。屏幕空间近似限制已写在源码注释中，不声称是完整光线追踪。
- **三个设计师参数**（渲染 / 玻璃区，界面 0–200%，内部映射真实取值）：**色散范围**（100% = 官方
  `dispersion_spread` 0.09）、**色彩强度**（只调色度、保亮度）、**折射变形**（只放大屏幕空间折射位移，
  0% 即普通透明玻璃，不改几何）。参数归零可退回普通透明玻璃；切换光束开关不丢 SVG / 厚度 / 倒角 / 材质 / 相机。
- **删除**：固定棱镜几何与专用文件（`prism/pipeline.js`、`prism/scene/prism-mesh.js`、相机、棱镜玻璃 /
  present / presentation shader、环境烘焙）；保留光谱、Bloom、`light.wgsl`、许可记录与被复用的 `types.js` 默认值。
- **验证**：`npm run build`、`npm test` 76/76、`node scripts/check.mjs` 61/61、`git diff --check` 通过；
  真实 Chrome WebGPU `IMAGELAB_BROWSER_TESTS=on npm run smoke -- home extrude3d pixelit shaders-halftone
  image-to-pixel image-to-ascii` **6/6 规格 287 项全过、0 页面错误**（extrude3d 91/91）。方形 / 六边形 /
  圆角 Logo 三种 SVG 均确认白光穿过当前 SVG；凹轮廓给出中文原因；三项参数分别可见。

### 2026-10-14 · SVG 转 3D 双页签（建模 Three / 渲染 vgpu，DSH 执行；Codex 真实 Chrome WebGPU 已验收 68/68）

- **双页签**：同一 `tools/extrude3d/index.html` 分为「建模」「渲染」两个页签，切换不丢 SVG / 几何参数；
  建模参数变更会把同一份内存网格同步给渲染页签。新增 `modeling.js`（Three 几何 + 中性灰诊断预览）与
  `render-vgpu.js`（vgpu 渲染）；`main.js` 只做页签编排与调试快照。
- **建模页签**：保留 SVG 样例 / 上传、1 MiB 闸门、曲线自适应细分与 600000 顶点硬上限、厚度 / 倒角 / 平滑度、
  原生圆角立方体默认；材质固定为中性灰 `MeshStandardMaterial` + 半球光 / 方向光诊断。**不再**承担产品材质、
  最终灯光、背景与导出。
- **渲染页签（vgpu 0.6.0，MIT）**：`geometry(gpu, ...)` 上传交接网格（position / normal / uv / index，stride 32），
  7 个中文材质预设（透明玻璃 / 磨砂玻璃 / 彩色亚克力 / 塑料 / 陶瓷 / 金属 / 镀铬）；不透明走官方
  `hero-fractal-ceramic.wgsl` 的 GGX PBR 最小扩展（metallic + 程序化棚拍环境），玻璃走官方
  `transmission/glass.wgsl` 的结构，但把写死立方体的 `trace_cube_exit` 换成**背面世界坐标预通道 + 正面透射通道**，
  按同一屏幕像素估算厚度与出射，支持明显折射、Fresnel、有限色散与有限 TIR。背景支持纯色 / 棚拍渐变 /
  本地图片（居中 cover、1×–3×、横向 / 纵向平移），透明背景输出 alpha。
- **移除旧材质**：38 个 Three.js 材质预设、表面贴图、Three 环境光 / 棚拍空间 / 主光 / 强色散示例控件与运行分支已删除；
  构建产物确认不含 `materialPresets` / `MATERIAL_UI` / `MeshPhysicalMaterial` 运行分支。
- **导出**：渲染页签按导出倍率重渲染整条 WebGPU 管线到 `rgba8unorm` 目标，`color.read` 后反预乘并由 2D canvas 编码 PNG，
  不读取建模画布。WebGPU 不可用时渲染页签显示中文提示、建模页签仍可用。
- **依赖与许可**：新增 `vgpu@0.6.0`（MIT，精确锁定），许可原文 `third-party-licenses/vgpu-LICENSE.txt`；
  Vite 接入 `wgslVitePlugin`（`vgpu/client`）；Node 端 Dawn 适配器不被浏览器构建引用。
- **验证**：`node --check`、`npm run check` **56/56**、`npm run build`、`git diff --check` 通过；
  新增 `tests/extrude3d-tabs.test.cjs`（9 项）覆盖双页签、旧材质移除、7 预设、WebGPU 中文提示、网格交接、
  依赖 / 许可与构建产物，并用 vgpu 官方 mock adapter 新增 `tests/extrude3d-pipeline.test.mjs`（1 项）在 Node 里
  跑通自定义网格 + 不透明 / 玻璃多趟管线与导出目标 resize / read 的 API 合约（不验证像素）。实现侧本轮**未启动浏览器**：
  `tests/specs/extrude3d.mjs` 已按最终职责重写（`gpu: webgpu`）。后续修复轮由 Codex 用真实 Chrome WebGPU 复跑
  `IMAGELAB_BROWSER_TESTS=on npm run smoke -- extrude3d` 得 **68/68 PASS**、0 页面错误；首次 7 项失败为
  `drawImage(WebGPU / WebGL canvas)` 取样透明位图误报，改用 `ElementHandle.screenshot` 后全部通过。

### 2026-10-14 · 刷新全部工具缩略图 + 外链本地缩略图 + 品牌素材生成外链入口（DSH 执行实现；Codex 已完成抓图与独立验收）

- **首页清单**：`assets/tools.js` 新增外链入口 `brand-assets-generator`（中文「品牌素材生成」，
  英文来源名 Brand Assets Generator，类别「版式与切片」，官网 `https://brand-generator.stoyanov.works/`，
  `external: true`，放入外链区末尾）。首页入口从 15（12 内置 + 3 外链）变为 **16（12 内置 + 4 外链）**。
  16 个入口统一使用新的 `coverQuery: "20261014-refresh1"`；4 个外链都登记本地 cover。
- **外链卡片**：`assets/home.js` / `home.css` 让外链卡片在封面区显示**本地**官网缩略图
  （`assets/covers/<id>.png`），右下角叠层保留「外部网站 · 跳转官网」标识与主机名；两处链接仍
  `target="_blank" rel="noopener noreferrer"`。缩略图加载失败时退回原有纯文字外链块，不显示破图；
  不新增远程请求、预取或 iframe。
- **品牌素材生成不本地镜像**：官网 HTML / 打包 bundle 没有 GitHub 或许可证链接，GitHub 公共搜索没有
  对应仓库 → 未找到公开源码 / 许可证原文，不能认定开源；只作外链跳转，不复制代码 / 字体 / 素材。
  外链封面是验收方从公开官网当前页面截取的本地 PNG，**截图许可不是代码开源许可**。
- **抓封面脚本**：`scripts/capture-covers.mjs` 更新为当前 12 个内置工具的真实 DOM / 分类结构
  （`extrude3d` 改用「切渲染页签 → 等 WebGPU ready → 切输出分类 → `#render-export-png`」，
  退路只截 `#render-canvas`；shader / wave-grid / ascii-motion 点导出前先切「输出」分类）。
  新增 `scripts/capture-external-covers.mjs`：默认关闭、复用 `tests/browser-policy.mjs` 的显式 opt-in，
  只处理 4 个固定 HTTPS 官网、不接受任意 URL，使用独立 Chrome profile、1440×900 当前视口截图、
  缩到 ≤1280px 后保存到 `public/assets/covers/<id>.png`，并把来源 URL 记录到
  `public/assets/covers/external-covers.json`；页面打不开即失败退出、不创建伪封面。
- **测试**：`tests/specs/home.mjs` 改为 16 入口（12 + 4），外链除标注 / target-rel / 网址 / 关键词外，
  新增「本地 cover img 加载成功且 cover URL 是站内 `assets/covers`」断言，不 fetch 外链官网；
  `scripts/check.mjs` 改为 16 入口，统一禁止 http(s) 封面，要求 4 张外链封面文件存在于
  `public/assets/covers/`。内置 12 张封面改为必须齐备（不再有「待生成占位」豁免）。
- **实际抓图与最终验收（Codex 在真实浏览器执行）**：先
  `IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs` 刷新 12 张内置封面，再
  `IMAGELAB_BROWSER_TESTS=on node scripts/capture-external-covers.mjs` 抓取 4 张外链缩略图
  （均先 `npm run build`）。16 张封面全部存在并已目视确认：`shaders-logo.png` **1280×803**，
  4 张外链封面**均 1280×800**，来源见 `public/assets/covers/external-covers.json`；未用占位图绕过。
  最终验证：`npm run build` 通过；`npm test` **67/67**（含 **58 项**内部静态检查）；
  `node scripts/check.mjs` **58/58**（原先「4 张外链封面文件齐备」失败项已消失）；
  `IMAGELAB_BROWSER_TESTS=on npm run smoke -- home` **113/113**、**0 页面错误**；`git diff --check` 通过。
  DSH 实现阶段未启动浏览器、未生成 PNG、未用占位图绕过（历史事实），以上数字为抓图后的最终结果；
  本轮已本地 commit，未 push / 未部署。
