# tests/ · 浏览器验收说明

## 分工

本批次约定：**浏览器验收统一由 Codex 执行**，实现侧（DSH）不再自行启动 Chrome / Puppeteer / 截图 / 封面抓取。
因此 `tests/smoke.mjs`、`tests/harness.mjs`、`scripts/capture-covers.mjs` 默认**关闭**，
未显式开启时会打印提示并以退出码 `2` 结束（不会被误判为「测试通过」）。

Node 单测与构建不受影响：

```bash
npm run build     # 正常
npm test          # 正常（纯 Node：纹理间自带 25 项测试 + scripts/check.mjs 静态自检）
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
| `specs/<id>.mjs` | 每个工具一份规格：进入 → 上传 → 调参 → 导出 → 断言 |
| `fixtures/test-photo.png` | 程序生成的 640×480 测试图（非私人素材、非 AI 图） |
| `fixtures/test-logo.svg` | 程序生成的几何 Logo |

测试素材可用 `node scripts/make-fixtures.mjs` 重新生成。

## 本轮状态

规格均由 Codex 执行浏览器验收：纹理间、像素画、字符画、SVG 挤出三维、像素化与抖动（34 项）、
Logo 材质（独立 19 项）、半调与网点（28 项）、节点式版式（20 项，WebGPU）已通过；
动态背景的渲染/参数/导出断言全部通过，此前的失败是开发服务器 HTTP 304 假失败，
已在 `harness.mjs` 关闭浏览器缓存修复。首页新增 bayer 搜索回归，待 Codex 验证。
