/**
 * 首页**外链工具**封面抓取（**由执行浏览器验收的一方运行**，例如 Codex）。
 *
 * 与 `scripts/capture-covers.mjs` 的区别：
 *   - 内置工具封面优先取工具的真实导出 PNG；本脚本只抓 4 个固定外部官网的**当前视口**截图，
 *     作为导航用的页面缩略图。外链站点内容由对方提供，本项目不部署、不复制源码 / 字体 / 素材、
 *     不 iframe、不把站点资源下载进仓库。
 *
 * 安全边界：
 *   - 只接受下面 `EXTERNAL_TARGETS` 里的 4 个固定 HTTPS 官网；**不接受任意 URL 参数**，
 *     也没有「传一个网址就截图」的能力。
 *   - 用独立的 Chrome profile（`.tmp/chrome-profile-external-<pid>`），截图只写
 *     `public/assets/covers/<id>.png`；不抓源码、不下载站点资源、不使用远程图作为运行时依赖。
 *   - 某个官网打不开 / 截图失败 → 该项失败、进程以退出码 1 结束，**不创建伪封面**。
 *
 * 默认关闭，需显式开启：
 *   IMAGELAB_BROWSER_TESTS=on node scripts/capture-external-covers.mjs [id ...]
 * 可选 id 只能是固定清单里的值（用于单独重抓一张）。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requireBrowserOptIn } from "../tests/browser-policy.mjs";
import { ROOT, launchBrowser, newPage, sleep, pngInfo } from "../tests/harness.mjs";

requireBrowserOptIn("scripts/capture-external-covers.mjs");

/** 首页外链入口的固定官网清单（与 assets/tools.js 的 external 条目一一对应）。 */
const EXTERNAL_TARGETS = [
  { id: "space-type-generator", url: "https://spacetypegenerator.com/" },
  { id: "shader-lab", url: "https://eng.basement.studio/tools/shader-lab" },
  { id: "tooooools", url: "https://www.tooooools.app/" },
  { id: "brand-assets-generator", url: "https://brand-generator.stoyanov.works/" }
];

const VIEWPORT = { width: 1440, height: 900 };
const MAX_WIDTH = 1280;
const SETTLE_MS = 3500;
const GOTO_TIMEOUT_MS = 60000;
const IDLE_MS = 15000;

// 只按固定 id 过滤；任何 URL 或未知参数都拒绝，避免脚本被当成任意站点截图器。
const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const knownIds = new Set(EXTERNAL_TARGETS.map((t) => t.id));
for (const arg of requested) {
  if (/^https?:\/\//i.test(arg) || !knownIds.has(arg)) {
    console.error(
      `[external-covers] 只允许固定外链 id：${EXTERNAL_TARGETS.map((t) => t.id).join(", ")}；拒绝参数：${arg}`
    );
    process.exit(2);
  }
}
const targets = EXTERNAL_TARGETS.filter((t) => !requested.length || requested.includes(t.id));

/** 把视口截图缩到 <= maxW，减小仓库体积（内容仍是官网当前页面的真实截图）。 */
async function shrink(page, bytes, maxW) {
  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = await page.evaluate(
    async ({ b64, maxW }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d");
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = "high";
      x.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/png");
    },
    { b64, maxW }
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

const outDir = resolve(ROOT, "public", "assets", "covers");
await mkdir(outDir, { recursive: true });
const manifestPath = resolve(outDir, "external-covers.json");

let browser = null;
const done = [];
const failed = [];
const sources = {};
try {
  browser = await launchBrowser({
    headless: true,
    // 外链抓取与工具 smoke 使用不同 profile，互不共享缓存 / 登录态。
    profileDir: resolve(ROOT, ".tmp", `chrome-profile-external-${process.pid}`)
  });
  // 只用于缩图的空白页，不访问任何站点。
  const shaper = await browser.newPage();

  for (const target of targets) {
    const page = await newPage(browser, VIEWPORT);
    try {
      const res = await page.goto(target.url, { waitUntil: "load", timeout: GOTO_TIMEOUT_MS });
      if (!res || !res.ok()) throw new Error(`页面返回 HTTP ${res ? res.status() : "无响应"}`);
      // 等待网络空闲（有长连接 / 分析脚本时超时不算失败）与字体就绪（最多等 3s），再截当前视口。
      await page.waitForNetworkIdle({ idleTime: 800, timeout: IDLE_MS }).catch(() => {});
      await page
        .evaluate(() =>
          document.fonts
            ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))])
            : true
        )
        .catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await sleep(SETTLE_MS);

      // 只截当前视口（不是整页长图）。
      const shot = await page.screenshot({ type: "png", fullPage: false });
      const info = pngInfo(shot);
      if (!(shot.length > 1000 && info.width > 0 && info.height > 0)) {
        throw new Error(`视口截图无效：${shot.length}B ${info.width}x${info.height}`);
      }

      const final = await shrink(shaper, shot, MAX_WIDTH);
      const finalInfo = pngInfo(final);
      if (!(final.length > 1000 && finalInfo.width > 0 && finalInfo.height > 0)) {
        throw new Error(`缩图后 PNG 无效：${final.length}B ${finalInfo.width}x${finalInfo.height}`);
      }

      const rel = `public/assets/covers/${target.id}.png`;
      await writeFile(resolve(ROOT, rel), final);
      sources[target.id] = { source: target.url, file: rel };
      done.push(`${target.id}.png(${finalInfo.width}x${finalInfo.height},${(final.length / 1024).toFixed(0)}KB)`);
      console.log(
        `[external-covers] ${target.id} <- ${target.url} → ${rel} (${finalInfo.width}x${finalInfo.height}, ${(final.length / 1024).toFixed(0)}KB)`
      );
    } catch (e) {
      failed.push(`${target.id}: ${e.message}`);
      console.warn(`[external-covers] ${target.id} 失败：${e.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  await shaper.close().catch(() => {});

  // 记录每张成功封面的来源 URL（provenance，仅审计用，不在首页运行时加载）。
  if (done.length) {
    let manifest = {};
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      /* 首次运行或旧文件不可读，从空开始 */
    }
    Object.assign(manifest, sources);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
} finally {
  if (browser) await browser.close().catch(() => {});
}

console.log(`\n[external-covers] 成功 ${done.length}：${done.join(", ") || "无"}`);
if (failed.length) console.log(`[external-covers] 失败 ${failed.length}：\n  - ${failed.join("\n  - ")}`);
// 页面打不开 / 截图失败都必须失败退出，不留下伪封面。
process.exit(failed.length ? 1 : 0);
