# tests/ · 浏览器验收说明

## 分工

本批次约定：**浏览器验收统一由 Codex 执行**，实现侧（DSH）不再自行启动 Chrome / Puppeteer / 截图 / 封面抓取。
因此 `tests/smoke.mjs`、`tests/harness.mjs`、`scripts/capture-covers.mjs` 默认**关闭**，
未显式开启时会打印提示并以退出码 `2` 结束（不会被误判为「测试通过」）。

Node 单测与构建不受影响：

```bash
npm run build     # 正常
npm test          # 正常（纯 Node：纹理间 4 套测试共 34 项 + tests/serve.test.cjs 服务器自检 + scripts/check.mjs 静态自检）
```

## Codex 如何跑

```bash
IMAGELAB_BROWSER_TESTS=on npm run smoke              # 全部工具，顺序执行，只启动一个 Chrome
IMAGELAB_BROWSER_TESTS=on npm run smoke -- texture   # 只跑指定工具
IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs   # 生成首页封面

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

首页现有 12 个入口：9 个内置（封面 / 进入链接可达断言不变）+ 3 个外部网站（仅校验标注、两处链接
`target="_blank" rel="noopener noreferrer"`、准确网址与关键词搜索；**不向外部 fetch**，避免 CORS 假失败）。

`extrude3d` 背景图片（第六轮，用户专项授权）新增断言：上传真实 PNG 后 `scene.background` 是真实贴图且
按视口 / 原图宽高比居中 cover、背景缩放 1×→2×→1× 改变真实像素、导出 PNG 真实包含背景、
背景与表面贴图同时存在、切换材质 / SVG 后背景保留、透明背景抑制并恢复、移除后回到所选纯色、
最新无效选择保留原背景。默认纯色背景由米色改为纯白，规格里的背景像素基准同步改为 `#ffffff`。
**已由 Codex 在本轮 SVG立体 81/81 PASS 中独立复跑通过**；实现侧只跑
`npm run check` / `npm test` / `npm run build`。
九工具界面与共享返回链接已统一为白 / 黑 / 中性灰（本批起未来 UI 规则），
计算样式审计 9 页 0 个非中性 UI 色彩；画布 / 素材 / 材质调色板与 9 张真实封面保持原有彩色。
SVG立体保持可访问，但本批起 3D 扩展冻结、不再新增 3D 功能。
