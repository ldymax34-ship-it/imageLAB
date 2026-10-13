/**
 * tools/ascii-motion · smoke
 *
 * 覆盖：页面可进入 / WebGL2 真实渲染 / 4 组预设与 4 组字符集 /
 * 默认水母是真实字符画（多字符、多颜色）/ 紧凑视觉信号（前景不止横线、触手连续、整体不被底部裁切）/
 * 运行中字符快照持续变化 / 切预设、改密度、换字符集、换颜色都引起真实变化 / 暂停后字符快照稳定 /
 * 导出 PNG 是从当前字符快照重绘的字符画（真实字符 + 颜色 + 底部触手像素，非原始网格）/ 无外部网络请求。
 */
import { pngInfo, webglReport } from "../harness.mjs";

export const id = "ascii-motion";
export const title = "动态字符画";
export const gpu = "webgl2";

function watchExternal(page, base) {
  const host = new URL(base).host;
  const external = [];
  page.on("request", (req) => {
    let url;
    try {
      url = new URL(req.url());
    } catch {
      return;
    }
    if (url.protocol.startsWith("http") && url.host !== host) external.push(req.url());
  });
  return external;
}

async function setRange(page, selector, value) {
  await page.$eval(
    selector,
    (n, v) => {
      n.value = String(v);
      n.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
}

export async function run({ page, base, downloads, check, sleep }) {
  const external = watchExternal(page, base);
  const res = await page.goto(`${base}/tools/ascii-motion/index.html`, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("动态字符画"), await page.title());

  await page.waitForFunction(() => window.imagelab && window.imagelab.ready === true, { timeout: 60000 });
  await sleep(1500);

  const report = await webglReport(page);
  check.ok("拿到 WebGL2 上下文（three 真实渲染）", report.webgl2 === true, `renderer=${report.renderer || "n/a"}`);

  const offered = await page.evaluate(() => ({
    presets: window.imagelab.presetCount(),
    charsets: window.imagelab.charsets()
  }));
  check.ok("提供 4 组预设", offered.presets === 4, String(offered.presets));
  check.ok("提供 4 组字符集", offered.charsets.length === 4, offered.charsets.join(","));
  check.ok("默认预设是水母", (await page.evaluate(() => window.imagelab.preset())) === "jellyfish");

  const stats = await page.evaluate(() => window.imagelab.stats());
  check.ok(
    "默认水母是真实字符画（多字符 + 多颜色）",
    stats.rows > 5 && stats.count > 200 && stats.chars >= 3 && stats.colored > 0,
    `${stats.rows} 行 × ${stats.cols} 列，字符类 ${stats.chars}，着色 ${stats.colored}`
  );

  /* ------------------------------------------------ 紧凑视觉信号（默认水母） */
  // 一次采样同时约束：前景不止是横线、触手在下半部仍连续成束、整体未被底部裁切。
  const signal = await page.evaluate(() => window.imagelab.visualSignal());
  check.ok(
    "默认水母前景不止是孤立横线且未被底部裁切（触手连续、整体入画）",
    !!signal &&
      signal.fg > 200 &&
      signal.varied >= 2 &&
      signal.lowerCells >= 12 &&
      signal.lowerRows >= 8 &&
      signal.lowerCols >= 5 &&
      signal.bottomMargin >= 2,
    signal
      ? `前景格=${signal.fg} 非横线类=${signal.varied} 下半格=${signal.lowerCells} 下半行=${signal.lowerRows}/占列=${signal.lowerCols} 底部留白=${signal.bottomMargin} 横线占比=${signal.dashRatio}`
      : "无信号"
  );

  /* ------------------------------------------------------------ 真实动效 */
  const sig1 = await page.evaluate(() => window.imagelab.signature());
  await sleep(900);
  const sig2 = await page.evaluate(() => window.imagelab.signature());
  check.ok("运行中字符快照随时间变化（真实动效）", sig1 !== sig2, sig1 === sig2 ? "两次相同" : "已变化");

  /* ------------------------------------------------------------ 预设切换 */
  await page.click("#preset-tunnel");
  await sleep(700);
  const tunnel = await page.evaluate(() => ({ preset: window.imagelab.preset(), sig: window.imagelab.signature(), stats: window.imagelab.stats() }));
  check.ok("切到隧道预设并继续渲染", tunnel.preset === "tunnel" && tunnel.stats.count > 200, `${tunnel.stats.count} 个字符单元`);

  await page.click("#preset-ring");
  await sleep(600);
  check.ok("切到圆环预设", (await page.evaluate(() => window.imagelab.preset())) === "ring");
  await page.click("#preset-wave");
  await sleep(600);
  check.ok("切到波形预设", (await page.evaluate(() => window.imagelab.preset())) === "wave");

  /* --------------------------------------------------------------- 密度 */
  const beforeDensity = await page.evaluate(() => window.imagelab.stats());
  await setRange(page, "#p-density", 0.9);
  await sleep(800);
  const afterDensity = await page.evaluate(() => window.imagelab.stats());
  check.ok(
    "提高密度后字符网格变密",
    afterDensity.rows > beforeDensity.rows && afterDensity.cols >= beforeDensity.cols,
    `${beforeDensity.rows}×${beforeDensity.cols} → ${afterDensity.rows}×${afterDensity.cols}`
  );
  await setRange(page, "#p-density", 0.55);
  await sleep(600);

  /* ------------------------------------------------------------- 字符集 */
  const beforeChars = await page.evaluate(() => window.imagelab.signature());
  await page.select("#char-pattern", "blocks");
  await sleep(700);
  const afterChars = await page.evaluate(() => window.imagelab.signature());
  check.ok("切换字符集后字符快照变化", beforeChars !== afterChars, `${beforeChars}→${afterChars}`);
  await page.select("#char-pattern", "standard");
  await sleep(500);

  /* --------------------------------------------------------------- 颜色 */
  const beforeColor = (await page.evaluate(() => window.imagelab.stats())).avgColor;
  await page.click("#color-blue");
  await sleep(700);
  const afterColor = (await page.evaluate(() => window.imagelab.stats())).avgColor;
  check.ok(
    "切换颜色后字符平均颜色变化",
    beforeColor.join(",") !== afterColor.join(","),
    `rgb(${beforeColor.join(",")}) → rgb(${afterColor.join(",")})`
  );

  /* --------------------------------------------------------- 暂停 / 导出 */
  await page.click("#btn-pause");
  await sleep(400);
  const pausedFrame = await page.evaluate(() => window.imagelab.frame());
  const pausedSig = await page.evaluate(() => window.imagelab.signature());
  await sleep(700);
  const pausedFrame2 = await page.evaluate(() => window.imagelab.frame());
  const pausedSig2 = await page.evaluate(() => window.imagelab.signature());
  check.ok(
    "暂停后时间与字符快照都稳定",
    pausedFrame === pausedFrame2 && pausedSig === pausedSig2,
    `frame ${pausedFrame.toFixed(3)}→${pausedFrame2.toFixed(3)}`
  );

  const expected = await page.evaluate(() => window.imagelab.exportSize());
  check.ok("导出尺寸可读", !!expected && expected.width > 0 && expected.height > 0, JSON.stringify(expected));

  const rendered = await page.evaluate(async () => {
    const url = window.imagelab.exportDataURL();
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const W = c.width;
    const H = c.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;
    let fg = 0;
    let total = 0;
    let top = H;
    let bottom = -1;
    const colors = new Set();
    for (let y = 0; y < H; y++) {
      for (let px = 0; px < W; px++) {
        const i = (y * W + px) * 4;
        total++;
        const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (lum > 24) {
          fg++;
          colors.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`);
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    // 前景包围盒底部 40% 内的前景像素与覆盖列数：触手若断成零星短划，这里会明显稀疏。
    const bandTop = bottom >= 0 ? Math.max(0, Math.floor(bottom - (bottom - top) * 0.4)) : 0;
    let strandFg = 0;
    const strandCols = new Set();
    for (let y = bandTop; y <= bottom; y++) {
      for (let px = 0; px < W; px++) {
        const i = (y * W + px) * 4;
        if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 24) {
          strandFg++;
          strandCols.add(px);
        }
      }
    }
    return { fgRatio: +(fg / total).toFixed(4), colors: colors.size, size: [W, H], strandFg, strandCols: strandCols.size };
  });
  check.ok(
    "导出画布是真实字符画（有字符像素且多色，不是原始网格）",
    rendered.fgRatio > 0.01 && rendered.colors >= 3,
    `前景占比=${rendered.fgRatio} 色彩簇=${rendered.colors} ${rendered.size.join("×")}`
  );
  check.ok(
    "导出画布包含触手像素（底部区域仍有横向铺开的字符像素）",
    rendered.strandFg > 20 && rendered.strandCols >= 5,
    `底部区域前景=${rendered.strandFg} 占列=${rendered.strandCols}`
  );

  await page.click("#btn-export");
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "导出 PNG 非空且尺寸与字符快照一致",
    file.size > 1000 && info.width === expected.width && info.height === expected.height,
    `${file.name} ${info.width}x${info.height}`
  );
  check.ok("导出文件名含工具 id", file.name.includes("ascii-motion"), file.name);

  check.ok("无外部网络请求（three 走本地打包，无 CDN）", external.length === 0, external.slice(0, 3).join(" | ") || "0 条");
  check.ok("页面无 console 错误", page.errors.length === 0, `${page.errors.length} 条${page.errors.length ? "：" + page.errors.slice(0, 3).join(" | ") : ""}`);
}
