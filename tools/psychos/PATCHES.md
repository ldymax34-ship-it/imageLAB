# PATCHES — tools/psychos

这个目录是 **blakeshao/a-psychos-gd-tool** 的 vendor 副本（原样搬运 + 最小切除 + 静态子路径构建配置）。
下面逐条记录相对上游改了什么、为什么。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/blakeshao/a-psychos-gd-tool |
| commit | `bdc8808526681e4c16a8b9f2937dc571dc0dd1e7`（2026-08-07，*Add Slice & Shuffle: image mosaics that stay seamless on non-uniform grids (#16)*） |
| 许可 | MIT，Copyright (c) 2026 Blake Shao —— 原文见本目录 `LICENSE`（许可原文亦汇总在仓库 `third-party-licenses/` / `THIRD_PARTY.md`） |
| 字体 | `public/fonts/JetBrainsMono-Regular.ttf` 为 JetBrains Mono，SIL OFL 1.1，许可原文见 `public/fonts/OFL.txt` |
| 本地克隆 | `.tmp/upstream/a-psychos-gd-tool`（只读参考，未修改） |

vendor 方式：`rsync -a --exclude .git/ --exclude node_modules/ .tmp/upstream/a-psychos-gd-tool/ tools/psychos/`。
除下表列出的文件外，其余文件与上游逐字节一致。

## 1. 切除远程 AI 抠图（Remove Background）

上游的 `Remove Background` 节点在 cook 时由 `traceWorker.ts` 动态 `import('@huggingface/transformers')`，
从 HuggingFace hub 下载 **briaai/RMBG-1.4** 权重（`env.allowLocalModels = false`），并用 WebGPU/WASM 推理。
本批次要求**禁止任何运行时远程请求**，因此整条路径被移除。

| 文件 | 改动 |
| --- | --- |
| `src/nodes/removeBackground.ts` | **删除整个文件**（`RemoveBackgroundNode` 定义）。 |
| `src/nodes/index.ts` | 删除 `import { RemoveBackgroundNode } from './removeBackground'`，并把 `RemoveBackgroundNode` 从 `PALETTE` 的 `Conversion` 分类里移除（其余节点、分类顺序不变）。加注释说明原因。 |
| `src/nodes/traceWorker.ts` | `Req.op` 去掉 `'removebg'`；`self.onmessage` 里删掉 removebg 分支，只保留 trace；删除 `MODEL_ID`、`removeBackground()`、只被它使用的 `resizeMask()`；删除文件末尾整段 `---- model ----`（`loadModel()` / `MaskImage` / `RunFn` / `modelPromise`）。文件头注释改写。 |
| `src/nodes/traceClient.ts` | 删除 `runRemoveBg()` 与 `WorkerImage`，`TraceRequest.op` 去掉 `'removebg'`，`WorkerReply` 只留 `paths`/`error`。文件头注释改写。 |
| `package.json` | dependencies 里删掉 `"@huggingface/transformers": "^4.2.0"`。 |
| `package-lock.json` | 由 `npm install` 依据改动后的 package.json 重新生成（不再含任何 huggingface/transformers 条目）。 |
| `README.md` | 节点表里 `Remove Background` 一行改为「在本 vendor 构建中已移除」并注明原因；`Outline Image` 一行不再提「pairs with Remove Background」。 |

结果：UI 面板不再出现该节点，构建产物里没有 transformers.js、没有模型下载代码。
其它节点（Slice / Shuffle / Text / Grid / Image / Place / Trace / Outline Image / Output …）全部保持原样可用，
`Trace` 仍然走同一个 `traceWorker.ts`（只是不再有 removebg 分支）。

## 2. 其它运行时远程请求

| 文件 | 改动 | 为什么 |
| --- | --- | --- |
| `index.html` | 删掉 `<link rel="preconnect" href="https://fonts.googleapis.com">`、`.../fonts.gstatic.com` 和 Kulim Park 的 Google Fonts `<link rel="stylesheet">` | 这三条会让页面在加载时请求远程字体 CDN。`src/app.css` 本来就带 `'Helvetica Neue', Helvetica, Arial, sans-serif` 兜底，字体族不变、观感一致。 |

> 说明：`src/editor/NodeEditor.tsx` 里有一个指向上游 GitHub 仓库的 `<a href="https://github.com/...">`。
> 那是**用户点击才会跳转的超链接**，页面加载时不产生任何请求，因此按「最小改动」原则保留（构建产物里也搜不到任何对它的请求）。
> `app.css` 的注释里还留有上游「Kulim Park」字样，是注释，不产生请求。

## 3. 静态子路径构建配置

`vite.config.ts`（上游只有 `plugins` + `worker.format` + `test`）：

```ts
base: './',                                              // 所有产物用相对 URL，放任何子路径都能跑
build: {
  outDir: resolve(__dirname, '../../dist/tools/psychos'), // 落到仓库根的 dist/，与主站共用
  emptyOutDir: true,                                      // 只清它自己的 outDir（Vite 对 root 之外的 outDir 默认拒绝清空）
  target: 'es2022',
  chunkSizeWarningLimit: 4096,
}
```

`worker.format: 'es'` 保留（worker 以 `{ type: 'module' }` 创建）。
产出：`dist/tools/psychos/{index.html, assets/*.js, assets/*.css, factory-image.jpg, fonts/*}`。

因为 `base` 是 `./`，`public/` 里的资源必须用**文档相对路径**引用，否则部署到 `/tools/psychos/` 时会 404：

| 文件 | 改动 |
| --- | --- |
| `src/App.tsx` | `FONT_URLS` 原本是 `['/fonts/Inter-Regular.otf', '/fonts/JetBrainsMono-Regular.ttf', '/fonts/local-fallback.ttf']`：绝对路径在子路径下会 404，而且前两个候选**根本不在 `public/fonts/` 里**，每次启动都是两次 404。改成只列真正随包发布的 `['./fonts/JetBrainsMono-Regular.ttf']`。 |
| `src/factoryDoc.ts` | 3 处 `src: '/factory-image.jpg'` → `'./factory-image.jpg'`（`Image.cook` 里的 `fetch(src)` 按文档 URL 解析）。 |
| `src/presets.ts` | 1 处同上（`image grid collage` 预置文档）。 |

## 4. 返回首页链接

`index.html`：body 里加 `<a class="il-back" href="../../index.html">← imageLAB</a>`
（从 `/tools/psychos/index.html` 解析为 `/index.html`；相对写法在更深的子路径下也成立）。
`.il-back` 的样式**内联在 `<head>` 的 `<style>` 里**（声明逐条抄自仓库 `assets/backlink.css`），
不依赖外部样式表：1px 边框、`border-radius: 2px`、无彩色装饰。

## 5. 无远程请求

| 文件 | 改动 |
| --- | --- |
| `index.html` | 加 `<link rel="icon" href="data:image/svg+xml,...">`。否则 Chrome 会隐式请求 `/favicon.ico`，在静态托管下得到 404（页面本身没问题，但会污染「0 失败请求」验收）。用 `data:` 内联图标，不新增文件、不产生请求。 |

## 构建与验收

```bash
cd tools/psychos
export npm_config_cache="$PWD/../../.tmp/npm-cache"
npm install          # 158 packages
npm run build        # tsc -b && vite build  → ../../dist/tools/psychos
```

仓库根的 `npm run build` 会通过 `scripts/build-psychos.mjs` 调到这里，产物路径 `dist/tools/psychos/index.html` 与之一致
（该脚本自己会设 `npm_config_cache`）。

冒烟规格：`tests/specs/psychos.mjs`（`id = "psychos"`）。因为页面在 `dist/tools/psychos/` 而不在根 dev server 下，
规格自己用 `node:http` 起一个静态服务器（默认 `5261`，可用 `PSYCHOS_PORT` 覆盖）指向该目录，并在 `finally` 关闭。

```bash
IMAGELAB_BROWSER_TESTS=on SMOKE_PORT=5215 node tests/smoke.mjs psychos
```

规格覆盖：HTTP 200 / WebGPU adapter / 节点面板含 Slice、Shuffle 且**不含** Remove Background /
点击 `image grid collage` 预置（Slice → Shuffle → Place）并确认这些节点真的参与了 cook / 画布非空白 /
导出整幅 PNG（2048×2048）/ 返回首页链接 / 0 跨源请求 / 构建产物静态审查 / 0 console error。

> 采样舞台画布时注意：这个页面是 **WebGPU** canvas，实测本机 Chrome 把它 `drawImage` 到 2D canvas 得到的是
> 全透明位图（`opaqueRatio = 0`），而 `toDataURL()` / `toBlob()` 能拿到真实像素。规格因此先走 `drawImage`，
> 取不到内容再退回 `toDataURL → Image → 2D canvas`，并在 detail 里回报用了哪条路径。

## 已知缺口

- 上游 `scripts/` 与 `.github/workflows/ci.yml` 一并 vendor 进来了（属于源码）。其中
  `scripts/get-font.sh` / `scripts/setup.sh` 是**开发期**辅助脚本，会去 GitHub raw 拉字体；它们不参与
  `npm run build`，也不会进入 `dist/`，但若在离线环境执行会失败。上游自身需要的字体已随包发布在 `public/fonts/`。
- 上游 `README.md` 里仍有对官方在线 demo（vercel）的链接，是纯文本/超链接，不产生请求。
- 构建产物 `assets/index-*.js` 里含 `https://github.com/...`（节点面板的 GitHub 超链接）、
  `https://reactflow.dev` / `https://react.dev/errors/`（依赖自带的错误信息文案）等字符串，均为**文本**，
  页面加载时不会请求它们；实测加载期间的全部请求都命中本地静态服务器。
