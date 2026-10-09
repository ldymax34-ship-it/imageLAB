# 工具③ 像素化与抖动 · image-to-pixel

本地静态页面：把一张图片缩小到指定像素宽度，再用调色板量化，并可选多种抖动。
入口：`tools/image-to-pixel/index.html`（带 `<!-- imagelab:entry -->`，由 Vite 作为多页入口打包）。

## 上游来源与许可

| 项目 | 内容 |
| --- | --- |
| 上游仓库 | Tezumie / Image-to-Pixel |
| commit | `b0d5b7422db309dae22c2a69d4ebca0ce8c14b78` |
| 使用的文件 | `image-to-pixel.js`（算法库本体） |
| 许可 | **MIT**，原文见 [`LICENSE-library.txt`](./LICENSE-library.txt) |
| 上游瑕疵 | MIT 文件中的版权人字段仍是占位符 `[YEAR] [YOUR NAME]`，本工具不做改写 |
| 复制方式 | **逐字节原样复制**：`vendor/image-to-pixel.js`，19059 字节，sha256 `7f0952ba6ce608b5bffdf030ebb7a7e45782e5093c044da74ba20608400f22dd` |

**未搬运的部分**：上游应用本体（`index.html` / `css/` / `src/` / `LICENSE-app.txt`，Apache-2.0）一行都没有使用。
本目录的 `index.html` / `style.css` / `main.js` 是 imageLAB 自建的最小外壳。

## 为什么 vendor 文件是「原文」而不是 ES module

上游库是经典脚本，为了保持**逐字节不变**，没有给它加 `export`。
`main.js` 通过 `import vendorSource from "./vendor/image-to-pixel.js?raw"` 拿到原文，
再以 `Blob` + 经典 `<script>` 注入，函数声明进入全局作用域（`window.pixelate`）。
这样 dev 与 build 行为一致，且 vendor 文件可以被哈希校验。

## 远程请求：彻底切断

上游库在 `palette` 收到**字符串 slug** 时会 `fetch` Lospec 调色板 JSON。
本工具：

1. `PALETTES` 里全部是本地颜色数组常量（`#rrggbb`），界面上不存在 slug / URL 选项；
2. 调用库前有 `Array.isArray(palette)` 硬断言，字符串分支不可达；
3. `tests/specs/image-to-pixel.mjs` 会断言「调色板全部为数组」+「全程零非本机请求」+「零失败请求」。

> 说明：`vendor/image-to-pixel.js` 内部**保留了**上游的 `fetchPalette()`（含 lospec 地址），
> 因为要求逐字节复制、不允许改写；它是不可达的死代码，运行期不会产生任何请求。

## 参数（全部来自库的现成参数，未自研算法）

- `width`：8–512，输出像素宽度；输出高度按原图等比取整。
- `dither`：`none` / `Floyd-Steinberg` / `atkinson` / `2x2 Bayer` / `4x4 Bayer` / `ordered`(Ordered 8x8) / `Clustered 4x4`
  —— 取值与上游 `index.html` 的 `<select id="dithering">` 完全一致。
- `strength`：**0–100**（库内 `strength / 100` 归一化；上游滑块同样是 0–100，不是 0–1）。
- `palette`：6 组本地数组调色板（2 色黑白 / 4 色灰阶 / 8 色灰阶 / Game Boy DMG 4 色 / 复古暖褐 6 色 / PICO-8 16 色）。
- `resolution`：`pixel`（像素尺寸）或 `original`（把像素块放大回原图宽高），由「输出尺寸」下拉选择。

## 其他实现要点

- 上传走 `createObjectURL` + 内存解码，不上传、无后端；默认图是仓库内置的本地测试图
  `assets/sample.png`（复制自 `tests/fixtures/test-photo.png`，640×480）。
- 大图保护：任一边 > 4000px 先等比缩小再处理，界面给出一行提示。
- 导出：`canvas.toBlob()` → `image-to-pixel-<width>px.png`（失败时退回 `toDataURL`）。
- 源图统一归一化为一块源画布；若目标像素宽恰好等于源画布宽，会传一份拷贝给库，
  避免库「复用输入画布并就地写回」污染源图（`vendor/image-to-pixel.js` 50–65 行的分支）。

## 与仓库其它部分的接线（不在本工具的可写范围内）

本工具只允许写 `tools/image-to-pixel/**` 与 `tests/specs/image-to-pixel.mjs`，
因此以下**由仓库维护者另行接线**：

- `assets/tools.js` 的工具清单（首页卡片）——未加入，本页目前只能通过直达 URL 访问；
- 根目录 `THIRD_PARTY.md` 的第三方来源表——未加入。

## 测试

```bash
SMOKE_PORT=5212 node tests/smoke.mjs image-to-pixel
```
