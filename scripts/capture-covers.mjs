/**
 * 首页封面生成（**由执行浏览器验收的一方运行**）。
 *
 * 原则：封面必须是工具**真实跑出来的画面**——
 *   1) 优先使用工具自己导出的 PNG（真实导出结果）；
 *   2) 没有导出结果时，只截取**真实预览画布元素**，不做整页截图、也绝不截节点编辑器 UI。
 *
 * 下载隔离：每个工具都使用独立的临时下载目录（mkdtemp），只等待「这一次点击产生的新
 * PNG」，工具结束后清理。因此不会像共享 .tmp/cover-downloads 那样复用上一次运行的旧文件。
 *
 * 默认关闭，需显式开启：
 *   IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs [id ...]
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requireBrowserOptIn } from "../tests/browser-policy.mjs";
import { ROOT, launchBrowser, newPage, sleep, withDownloads, pngInfo } from "../tests/harness.mjs";
import {
  BOOT_DOC,
  PRESET_NAME,
  STORAGE_KEY,
  clickImageGridPreset,
  seedBootDocument,
  waitForCookDone
} from "../tests/specs/psychos.mjs";

requireBrowserOptIn("scripts/capture-covers.mjs");

const FIXTURE = resolve(ROOT, "tests/fixtures/test-photo.png");

/**
 * 服务的是**构建产物** dist/，而不是 Vite dev：
 * 这样抓到的就是用户真正打开的那一份，并且 tools/psychos（独立构建的子路径）
 * 也能一起抓。若 dist 不存在则自动先构建。
 */
function startStatic(port) {
  return new Promise((res, rej) => {
    const child = spawn(
      process.execPath,
      [resolve(ROOT, "scripts/serve.mjs"), "--root", "dist", "--port", String(port)],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    const onData = (b) => {
      out += String(b);
      if (/https?:\/\/127\.0\.0\.1/.test(out)) res({ child, url: `http://127.0.0.1:${port}` });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", rej);
    setTimeout(() => rej(new Error("静态服务器启动超时")), 15000);
  });
}

async function upload(page, selector, file) {
  const input = await page.$(selector);
  if (!input) throw new Error(`找不到上传控件 ${selector}`);
  await input.uploadFile(file);
}

/** 把导出的 PNG 缩到 <= maxW，减少仓库体积（内容仍是工具的真实导出结果）。 */
async function shrink(page, bytes, maxW = 1280) {
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

/**
 * 每个工具：
 *  - prepare: 导航前注入（psychos 需要先写 boot 文档）
 *  - setup:   让页面进入「有内容的默认状态」
 *  - export:  真实导出按钮选择器（首选）
 *  - canvas:  退路：只截真实预览画布，绝不截节点编辑器 UI
 */
const TARGETS = {
  texture: {
    path: "/tools/texture/index.html",
    async setup(page) {
      await page.waitForSelector("#canvas", { timeout: 30000 });
      if (await page.$("#scale")) await page.select("#scale", "1").catch(() => {});
      await sleep(1800);
    },
    export: "#export-png",
    canvas: "#canvas"
  },
  pixelit: {
    path: "/tools/pixelit/index.html",
    async setup(page) {
      await upload(page, "#pixlInput", FIXTURE);
      await sleep(2500);
    },
    export: "#downloadimage",
    canvas: "#pixelitcanvas"
  },
  "image-to-ascii": {
    path: "/tools/image-to-ascii/index.html",
    async setup(page) {
      await upload(page, "#file", FIXTURE);
      await sleep(3000);
    },
    export: "#export-png",
    canvas: "#ascii-canvas"
  },
  "image-to-pixel": {
    path: "/tools/image-to-pixel/index.html",
    async setup(page) {
      await upload(page, "input[type=file]", FIXTURE);
      await sleep(3000);
    },
    export: "#export-png",
    canvas: "#preview canvas"
  },
  "shaders-logo": {
    path: "/tools/shaders-logo/index.html",
    async setup(page) {
      // 不上传图片：先用页面内置示例 Logo，再暂停到确定单帧。
      await page.waitForSelector("#btn-sample-logo", { timeout: 30000 });
      await page.click("#btn-sample-logo");
      await page
        .waitForFunction(() => window.imagelab && window.imagelab.hasImage && window.imagelab.hasImage() === true, { timeout: 30000 })
        .catch(() => {});
      await sleep(1200);
      await page.click("#btn-pause").catch(() => {});
      await sleep(500);
    },
    export: "#btn-export",
    canvas: "canvas"
  },
  "shaders-bg": {
    path: "/tools/shaders-bg/index.html",
    async setup(page) {
      await sleep(3000);
      await page.click("#btn-pause").catch(() => {});
      await sleep(400);
    },
    export: "#btn-export",
    canvas: "canvas"
  },
  "shaders-halftone": {
    path: "/tools/shaders-halftone/index.html",
    async setup(page) {
      await upload(page, "#image-file", FIXTURE);
      await sleep(3000);
      await page.click("#btn-pause").catch(() => {});
      await sleep(400);
    },
    export: "#btn-export",
    canvas: "canvas"
  },
  extrude3d: {
    path: "/tools/extrude3d/index.html",
    async setup(page) {
      await page.waitForSelector("#view-canvas", { timeout: 30000 });
      await page
        .waitForFunction(
          () => {
            const el = document.getElementById("status");
            return el && el.textContent.includes("已建模");
          },
          { timeout: 30000 }
        )
        .catch(() => {});
      await sleep(1200);
    },
    export: "#export-png",
    canvas: "#view-canvas"
  },
  psychos: {
    path: "/tools/psychos/index.html",
    webgpu: true,
    async prepare(page) {
      // 与 tests/specs/psychos.mjs 完全同一套：先写 boot 文档，再用应用自己的预置按钮
      // 载入 image grid collage，并等待这次 cook 真正算完。
      await seedBootDocument(page);
    },
    async setup(page) {
      await page.waitForSelector(".palette", { timeout: 120000 });
      const clicked = await clickImageGridPreset(page);
      if (!clicked) throw new Error(`未找到预置按钮「${PRESET_NAME}」`);
      const log = await waitForCookDone(page);
      if (!log || log.error || !log.cooked.includes("Slice") || !log.cooked.includes("Shuffle")) {
        throw new Error(`image grid collage 未完成 cook：${log ? JSON.stringify(log) : "无日志"}`);
      }
      await page.waitForFunction(
        () => {
          const b = document.querySelector(".export-btn");
          return b && !b.disabled;
        },
        { timeout: 30000 }
      );
    },
    export: ".export-btn",
    // 输出是舞台画布；.react-flow__viewport 是节点编辑器 UI，绝不能当封面。
    canvas: ".stage canvas:not(.guide-overlay)"
  }
};

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const ids = Object.keys(TARGETS).filter((id) => !only.length || only.includes(id));

const outDir = resolve(ROOT, "public", "assets", "covers");
await mkdir(outDir, { recursive: true });

if (!existsSync(resolve(ROOT, "dist", "index.html"))) {
  console.error("[covers] 还没有 dist/，请先执行：npm run build");
  process.exit(1);
}

const PORT = Number(process.env.COVER_PORT || 5299);
const server = await startStatic(PORT);

let browser = null;
const done = [];
const failed = [];
try {
  browser = await launchBrowser({ headless: true, webgpu: true });
  for (const id of ids) {
    const target = TARGETS[id];
    // 抓的是构建产物：dist/<path>
    const htmlPath = resolve(ROOT, "dist", target.path.replace(/^\//, ""));
    if (!existsSync(htmlPath)) {
      failed.push(`${id}: dist${target.path} 不存在（先跑 npm run build）`);
      console.warn(`[covers] 失败 ${id}：dist${target.path} 不存在`);
      continue;
    }
    const page = await newPage(browser, { width: 1440, height: 900 });
    const dl = await withDownloads(page);
    try {
      if (target.prepare) await target.prepare(page);
      await page.goto(server.url + target.path, { waitUntil: "networkidle2", timeout: 60000 });
      await target.setup(page);

      let bytes = null;
      let how = "";
      if (target.export) {
        const btn = await page.$(target.export);
        if (!btn) throw new Error(`找不到导出控件 ${target.export}`);
        await btn.click();
        // 独立目录从空开始，等到的就一定是「这一次点击」产生的 PNG。
        const file = await dl.waitForFile({ ext: ".png", timeoutMs: 30000 });
        bytes = file.bytes;
        how = "export";
      }
      if (!bytes && target.canvas) {
        const el = await page.$(target.canvas);
        if (!el) throw new Error(`找不到预览画布 ${target.canvas}`);
        bytes = await el.screenshot({ type: "png" });
        how = "canvas-region";
      }
      if (!bytes) throw new Error("既没有导出结果，也找不到预览画布");

      const info = pngInfo(bytes);
      if (!(bytes.length > 1000 && info.width > 0 && info.height > 0)) {
        throw new Error(`PNG 无效：${bytes.length}B ${info.width}x${info.height}`);
      }

      const final = how === "export" ? await shrink(page, bytes) : bytes;
      const finalInfo = pngInfo(final);
      if (!(final.length > 1000 && finalInfo.width > 0 && finalInfo.height > 0)) {
        throw new Error(`缩图后 PNG 无效：${final.length}B ${finalInfo.width}x${finalInfo.height}`);
      }

      await writeFile(resolve(outDir, `${id}.png`), final);
      done.push(`${id}.png(${how},${finalInfo.width}x${finalInfo.height},${(final.length / 1024).toFixed(0)}KB)`);
      console.log(`[covers] ${id} -> ${how} ${finalInfo.width}x${finalInfo.height} ${(final.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      failed.push(`${id}: ${e.message}`);
      console.warn(`[covers] ${id} 失败：${e.message}`);
    } finally {
      await dl.cleanup().catch(() => {});
      await page.close().catch(() => {});
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server.child.kill("SIGTERM");
}

console.log(`\n[covers] 成功 ${done.length}：${done.join(", ") || "无"}`);
if (failed.length) console.log(`[covers] 失败 ${failed.length}：\n  - ${failed.join("\n  - ")}`);
process.exit(failed.length ? 1 : 0);
