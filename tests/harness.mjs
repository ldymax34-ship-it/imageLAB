/**
 * 浏览器 smoke 测试基础设施。
 *
 * 设计约束：
 * - 使用本机已安装的 Chrome（puppeteer-core + executablePath），不下载浏览器。
 * - 用 Vite dev server 提供页面（与 `npm run dev` 完全同一条路径）。
 * - 每个工具的 smoke 规格放在 tools/<id>/smoke.mjs，导出 { id, path, gpu, run(ctx) }。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { browserTestsEnabled, DISABLED_MESSAGE, OPT_IN_ENV } from "./browser-policy.mjs";

export const ROOT = resolve(import.meta.dirname, "..");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
].filter(Boolean);

export function findChrome() {
  for (const p of CHROME_CANDIDATES) if (p && existsSync(p)) return p;
  throw new Error("找不到本机 Chrome，请设置 CHROME_PATH");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 启动一个 Vite dev server，返回 { url, proc, close }。 */
export async function startVite(port = 5199, { timeoutMs = 60000 } = {}) {
  const proc = spawn(
    process.execPath,
    [resolve(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
  );
  trackServer(proc);
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (out += d));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`vite 提前退出:\n${out}`);
    try {
      const res = await fetch(url + "/index.html");
      if (res.ok) return { url, proc, out: () => out, close: () => proc.kill("SIGTERM") };
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  proc.kill("SIGTERM");
  throw new Error(`vite 启动超时:\n${out}`);
}

const LIVE_SERVERS = new Set();

function trackServer(proc) {
  LIVE_SERVERS.add(proc);
  proc.once("exit", () => LIVE_SERVERS.delete(proc));
  process.once("exit", () => {
    for (const p of LIVE_SERVERS) {
      try {
        p.kill("SIGKILL");
      } catch {
        /* 忽略 */
      }
    }
  });
}

export async function launchBrowser({ headless = true, webgpu = false, gpu = false } = {}) {
  if (!browserTestsEnabled()) {
    throw new Error(
      `${DISABLED_MESSAGE}\n（在 harness.launchBrowser 处被拦截；设置 ${OPT_IN_ENV}=on 才会真正启动浏览器）`
    );
  }
  const args = [
    // DSH 沙箱下 Chrome 自带的 seatbelt 沙箱无法初始化，必须显式关闭（仅本地测试进程）。
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--allow-file-access-from-files"
  ];
  if (webgpu) {
    // localhost 属于 secure context，WebGPU 可用；headless 下实测可拿到 Apple Metal adapter。
    args.push("--enable-unsafe-webgpu");
  }
  if (gpu) args.push("--ignore-gpu-blocklist", "--enable-gpu-rasterization");

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless,
    // 独立 profile，绝不使用用户自己的 Chrome 配置
    userDataDir: resolve(ROOT, ".tmp", `chrome-profile-${process.pid}`),
    args,
    protocolTimeout: 180000
  });
  trackBrowser(browser);
  return browser;
}

/* ------------------------------------------------------------------ *
 * 进程清理：无论成功、失败还是被中断，都必须关掉自己启动的 Chrome。
 * 只处理本进程启动的实例，不触碰用户自己的 Chrome。
 * ------------------------------------------------------------------ */
const LIVE_BROWSERS = new Set();
let cleanupRegistered = false;

function trackBrowser(browser) {
  LIVE_BROWSERS.add(browser);
  browser.once("disconnected", () => LIVE_BROWSERS.delete(browser));
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const shutdown = async () => {
    const all = [...LIVE_BROWSERS];
    LIVE_BROWSERS.clear();
    await Promise.all(
      all.map((b) => b.close().catch(() => b.process()?.kill("SIGKILL")))
    );
  };

  process.once("exit", () => {
    for (const b of LIVE_BROWSERS) {
      try {
        b.process()?.kill("SIGKILL");
      } catch {
        /* 忽略 */
      }
    }
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(sig, async () => {
      await shutdown();
      process.exit(130);
    });
  }
  process.once("uncaughtException", async (err) => {
    console.error("[harness] 未捕获异常，正在关闭 Chrome：", err);
    await shutdown();
    process.exit(1);
  });
  process.once("unhandledRejection", async (err) => {
    console.error("[harness] 未处理的 Promise 拒绝，正在关闭 Chrome：", err);
    await shutdown();
    process.exit(1);
  });
}

/** 打开页面并收集 console 错误 / 页面异常 / 失败请求。 */
export async function newPage(browser, { width = 1440, height = 960 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors = [];
  const warnings = [];
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error") errors.push(`console.error: ${msg.text()}`);
    else if (t === "warning") warnings.push(`console.warn: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    const u = req.url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return;
    errors.push(`requestfailed: ${u} (${req.failure()?.errorText})`);
  });
  page.errors = errors;
  page.warnings = warnings;
  return page;
}

/** 设置下载目录并返回读取结果的方法。 */
export async function withDownloads(page) {
  const dir = await mkdtemp(join(tmpdir(), "imagelab-dl-"));
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
  return {
    dir,
    async waitForFile({ timeoutMs = 30000, ext = null } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const names = (await readdir(dir)).filter((n) => !n.endsWith(".crdownload"));
        const hit = ext ? names.find((n) => n.toLowerCase().endsWith(ext)) : names[0];
        if (hit) {
          const p = join(dir, hit);
          const st = await stat(p).catch(() => null);
          if (st && st.size > 0) return { name: hit, path: p, size: st.size, bytes: await readFile(p) };
        }
        await sleep(250);
      }
      throw new Error(`等待下载超时（${ext || "任意文件"}）: ${dir}`);
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/** 校验 PNG 头并读取宽高。 */
export function pngInfo(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error("不是 PNG（签名不符）");
  const be = (o) => (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];
  const width = be(16);
  const height = be(20);
  if (!(width > 0 && height > 0)) throw new Error(`PNG 尺寸非法: ${width}x${height}`);
  return { width, height };
}

/** 检查页面是否真的拿到了可用的 WebGL2 上下文。 */
export async function webglReport(page) {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return { webgl2: false };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      webgl2: true,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    };
  });
}

/** 页面是否绘制了非空白内容（抽样 canvas 像素）。 */
export async function canvasLooksDrawn(page, selector = "canvas") {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel);
    if (!c || !c.width || !c.height) return { drawn: false, reason: "canvas 缺失或尺寸为 0" };
    try {
      const tmp = document.createElement("canvas");
      tmp.width = Math.min(c.width, 200);
      tmp.height = Math.min(c.height, 200);
      const ctx = tmp.getContext("2d");
      ctx.drawImage(c, 0, 0, tmp.width, tmp.height);
      const d = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
      let nonEmpty = 0;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8) nonEmpty++;
        sum += d[i] + d[i + 1] + d[i + 2];
      }
      const px = d.length / 4;
      return {
        drawn: nonEmpty / px > 0.02,
        opaqueRatio: +(nonEmpty / px).toFixed(3),
        meanLuma: +(sum / (px * 3)).toFixed(1),
        size: [c.width, c.height]
      };
    } catch (e) {
      return { drawn: false, reason: String(e) };
    }
  }, selector);
}

/** 简单断言收集器。 */
export function checker(id) {
  const results = [];
  return {
    ok(name, cond, detail = "") {
      results.push({ name, pass: !!cond, detail });
      console.log(`   ${cond ? "PASS" : "FAIL"} ${id} · ${name}${detail ? " — " + detail : ""}`);
      return !!cond;
    },
    results,
    get failed() {
      return results.filter((r) => !r.pass);
    }
  };
}
