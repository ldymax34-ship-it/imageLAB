/**
 * 首页封面生成（**由执行浏览器验收的一方运行**）。
 *
 * 原则：封面必须是工具**真实跑出来的画面**——
 *   1) 优先使用工具自己导出的 PNG（真实导出结果）；
 *   2) 没有导出能力时，只截取**画布/预览区域元素**，不做整页截图（避免把侧栏小字当视觉素材）。
 *
 * 默认关闭，需显式开启：
 *   IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs [id ...]
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requireBrowserOptIn } from "../tests/browser-policy.mjs";
import { ROOT, launchBrowser, newPage, sleep } from "../tests/harness.mjs";

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
 *  - setup: 让页面进入「有内容的默认状态」
 *  - export: 若工具真有导出按钮，点它并取下载到的 PNG（首选）
 *  - canvas: 退路：只截这个元素（画布 / 预览区），绝不做整页截图
 */
const TARGETS = {
  texture: {
    path: "/tools/texture/index.html",
    async setup(page) {
      await page.waitForSelector("canvas", { timeout: 30000 });
      await sleep(1800);
    },
    export: "#export-png",
    canvas: "canvas"
  },
  pixelit: {
    path: "/tools/pixelit/index.html",
    async setup(page) {
      await upload(page, "input[type=file]", FIXTURE);
      await sleep(2500);
    },
    export: "#downloadBtn, .dothings button",
    canvas: "canvas"
  },
  "image-to-ascii": {
    path: "/tools/image-to-ascii/index.html",
    async setup(page) {
      await upload(page, "input[type=file]", FIXTURE);
      await sleep(3000);
    },
    export: "#export-png",
    canvas: "canvas"
  },
  "image-to-pixel": {
    path: "/tools/image-to-pixel/index.html",
    async setup(page) {
      await upload(page, "input[type=file]", FIXTURE);
      await sleep(2500);
    },
    export: "#export-png",
    canvas: "canvas"
  },
  "shaders-logo": {
    path: "/tools/shaders-logo/index.html",
    async setup(page) {
      await sleep(3000);
    },
    export: "#export-png",
    canvas: "canvas"
  },
  "shaders-bg": {
    path: "/tools/shaders-bg/index.html",
    async setup(page) {
      await sleep(3000);
    },
    export: "#export-png",
    canvas: "canvas"
  },
  "shaders-halftone": {
    path: "/tools/shaders-halftone/index.html",
    async setup(page) {
      await upload(page, "input[type=file]", FIXTURE).catch(() => {});
      await sleep(3000);
    },
    export: "#export-png",
    canvas: "canvas"
  },
  extrude3d: {
    path: "/tools/extrude3d/index.html",
    async setup(page) {
      await page.waitForSelector("canvas", { timeout: 30000 });
      await sleep(3000);
    },
    export: "#export-png",
    canvas: "canvas"
  },
  psychos: {
    path: "/tools/psychos/index.html",
    webgpu: true,
    async setup(page) {
      // 先套一个预置把画布填满，再等一帧算完
      const preset = await page.$("text=image grid collage");
      if (preset) await preset.click().catch(() => {});
      await page.waitForSelector("canvas", { timeout: 30000 }).catch(() => {});
      await sleep(4000);
    },
    export: null,
    canvas: ".react-flow__viewport, canvas"
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
const browser = await launchBrowser({ headless: true, webgpu: true });

const done = [];
const failed = [];
try {
  for (const id of ids) {
    const target = TARGETS[id];
    // 抓的是构建产物：dist/<path>
    const htmlPath = resolve(ROOT, "dist", target.path.replace(/^\//, ""));
    if (!existsSync(htmlPath)) {
      console.warn(`[covers] 跳过 ${id}：dist${target.path} 不存在（先跑 npm run build）`);
      continue;
    }
    const page = await newPage(browser, { width: 1440, height: 900 });
    try {
      await page.goto(server.url + target.path, { waitUntil: "networkidle2", timeout: 60000 });
      await target.setup(page);

      let bytes = null;
      let how = "";
      if (target.export) {
        try {
          const cdp = await page.createCDPSession();
          const dlDir = resolve(ROOT, ".tmp", "cover-downloads");
          await mkdir(dlDir, { recursive: true });
          await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
          const btn = await page.$(target.export);
          if (btn) {
            await btn.click();
            const deadline = Date.now() + 25000;
            const { readdir } = await import("node:fs/promises");
            while (Date.now() < deadline) {
              const files = (await readdir(dlDir)).filter((f) => f.endsWith(".png"));
              if (files.length) {
                const { readFile } = await import("node:fs/promises");
                bytes = await readFile(resolve(dlDir, files[files.length - 1]));
                how = "export";
                break;
              }
              await sleep(250);
            }
          }
        } catch (e) {
          console.warn(`[covers] ${id} 导出取图失败，改用画布区域：${e.message}`);
        }
      }

      if (!bytes && target.canvas) {
        const el = await page.$(target.canvas);
        if (el) {
          bytes = await el.screenshot({ type: "png" });
          how = "canvas-region";
        }
      }
      if (!bytes) throw new Error("既没有导出结果，也找不到画布元素");

      const final = how === "export" ? await shrink(page, bytes) : bytes;
      const out = resolve(outDir, `${id}.png`);
      await writeFile(out, final);
      done.push(`${id}.png(${how},${(final.length / 1024).toFixed(0)}KB)`);
      console.log(`[covers] ${id} -> ${how} ${(final.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      failed.push(`${id}: ${e.message}`);
      console.warn(`[covers] ${id} 失败：${e.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close().catch(() => {});
  server.child.kill("SIGTERM");
}

console.log(`\n[covers] 成功 ${done.length}：${done.join(", ") || "无"}`);
if (failed.length) console.log(`[covers] 失败 ${failed.length}：\n  - ${failed.join("\n  - ")}`);
process.exit(failed.length ? 1 : 0);
