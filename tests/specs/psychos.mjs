/**
 * 生成式版式切片（a-psychos-gd-tool）smoke 规格。
 *
 * 这个工具的页面在 dist/tools/psychos/，不在根 Vite dev server 的 root 下，
 * 所以规格自己起一个极简 node:http 静态服务器指向 dist/tools/psychos，
 * 在 finally 里关闭。只用 http://127.0.0.1:<port>（secure context）打开，
 * 否则拿不到 WebGPU adapter。
 *
 * 覆盖：HTTP 200 / 0 console error / 0 失败请求 / 0 跨源请求 / WebGPU adapter /
 * 节点 UI 渲染 / 载入含 Slice+Shuffle 的预置文档 / 整幅 PNG 导出。
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pngInfo, ROOT, sleep } from "../harness.mjs";

export const id = "psychos";
export const title = "图片拼贴（节点式）";
export const gpu = "webgpu";

const SITE_DIR = resolve(ROOT, "dist", "tools", "psychos");
const PORT = Number(process.env.PSYCHOS_PORT || 5261);
const FRAME = 2048; // presets.ts collageDoc frame — the exported PNG must match

/** 预置文档名（应用自己的预置按钮文案）。封面脚本复用同一常量。 */
export const PRESET_NAME = "image grid collage";

// localStorage key + a deliberately tiny first-run document: the app reads it at
// boot instead of cooking the heavy factory poster, so the first cook is instant.
// The Slice + Shuffle document is then loaded through the app's own preset
// button (no document definition is duplicated in this spec).
export const STORAGE_KEY = "gfx.document.v2";
export const BOOT_DOC = {
  frame: { width: 32, height: 32 },
  layers: [
    {
      id: "layer_1",
      name: "Layer 1",
      visible: true,
      opacity: 1,
      blendMode: "normal",
      graph: {
        nodes: { out: { id: "out", type: "Output", params: { transparent: true }, position: { x: 0, y: 0 } } },
        edges: []
      }
    }
  ]
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8"
};

/** 极简静态文件服务器（无 fallback：这个站点是纯静态多文件，不需要 SPA 重写）。 */
function serveSite(rootDir, port) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      const file = resolve(rootDir, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
      if (file !== rootDir && !file.startsWith(rootDir + "/")) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-store"
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () =>
      ok({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            // Chrome keeps keep-alive sockets open; without this, close() waits on them
            server.closeAllConnections?.();
          })
      })
    );
  });
}

/** 读 cook log：哪些节点参与了这次 cook、是否还在算、有没有报错。 */
function readCookLog(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".cook-log li .ev-node")].map((n) => n.textContent.trim());
    const err = document.querySelector(".cook-error");
    return {
      cooked: nodes,
      pending: !!document.querySelector(".cook-pending"),
      error: err ? err.textContent.trim() : null
    };
  });
}

/**
 * 导航前把 boot 文档写进 localStorage。
 * psychos 启动时会读取它，从而跳过一次重型 factory poster 的 cook。
 */
export async function seedBootDocument(page) {
  await page.evaluateOnNewDocument(
    (key, doc) => {
      try {
        localStorage.setItem(key, JSON.stringify(doc));
      } catch {
        /* about:blank has no storage */
      }
    },
    STORAGE_KEY,
    BOOT_DOC
  );
}

/** 点击应用自己的「image grid collage」预置按钮（不用自造文档定义）。 */
export function clickImageGridPreset(page) {
  return page.evaluate((name) => {
    const b = [...document.querySelectorAll(".presets-list .preset-btn")].find(
      (x) => x.textContent.trim() === name
    );
    if (!b) return false;
    b.click();
    return true;
  }, PRESET_NAME);
}

/**
 * 等这次 cook 算完：返回 cook log（{ cooked, pending, error }）。
 * 调用方自行决定「超时/报错」算硬失败还是软断言。
 */
export async function waitForCookDone(page) {
  let log = null;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    log = await readCookLog(page);
    if (log.error) break;
    if (!log.pending && log.cooked.includes("Slice") && log.cooked.includes("Shuffle") && log.cooked.includes("Output")) {
      await sleep(300); // 确认不是中间态
      const again = await readCookLog(page);
      if (!again.pending && !again.error) return again;
      log = again;
    }
    await sleep(200);
  }
  return log;
}

/**
 * 采样舞台画布（WebGPU canvas）。
 *
 * 这个页面的 canvas 来自 `gpu.present()`（WebGPU 上下文）。实测本机 Chrome：
 * 把 WebGPU canvas 直接 drawImage 到 2D canvas 得到的是全透明位图，而
 * `toDataURL()` / `toBlob()` 能拿到真实像素。所以先走 harness 同款 drawImage
 * 路径，取不到内容时退回 toDataURL → Image → 2D canvas，并回报用了哪条路径。
 * 两条都拿不到内容才算画布空白。
 */
function sampleStageCanvas(page) {
  return page.evaluate(async () => {
    const c = document.querySelector(".stage canvas:not(.guide-overlay)");
    if (!c || !c.width || !c.height) return { drawn: false, reason: "canvas 缺失或尺寸为 0" };

    const measure = (src, size) => {
      const t = document.createElement("canvas");
      t.width = size;
      t.height = size;
      const ctx = t.getContext("2d");
      ctx.drawImage(src, 0, 0, size, size);
      const d = ctx.getImageData(0, 0, size, size).data;
      let opaque = 0;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8) opaque++;
        sum += d[i] + d[i + 1] + d[i + 2];
      }
      const px = size * size;
      return { opaqueRatio: +(opaque / px).toFixed(3), meanLuma: +(sum / (px * 3)).toFixed(1) };
    };

    const size = 200;
    let method = "drawImage";
    let stats;
    try {
      stats = measure(c, size);
    } catch (e) {
      stats = { opaqueRatio: 0, meanLuma: 0, note: `drawImage: ${e}` };
    }
    if (!(stats.opaqueRatio > 0.02)) {
      try {
        const url = c.toDataURL("image/png");
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = () => rej(new Error("data url decode failed"));
          img.src = url;
        });
        const alt = measure(img, size);
        if (alt.opaqueRatio > stats.opaqueRatio) {
          stats = alt;
          method = "toDataURL";
        }
      } catch (e) {
        stats.note = `${stats.note || ""} toDataURL: ${e}`;
      }
    }
    return { ...stats, method, size: [c.width, c.height], drawn: stats.opaqueRatio > 0.02 };
  });
}

/** 递归扫构建产物里的文本文件，找远程模型 / CDN / 远程字体的痕迹。 */
async function scanBuiltAssets(dir) {
  const bad = /huggingface|from_pretrained|allowRemoteModels|RMBG|fonts\.googleapis|fonts\.gstatic|jsdelivr|unpkg\.com|cdnjs\.cloudflare/i;
  const textExt = new Set([".html", ".js", ".mjs", ".css", ".json", ".txt", ".svg", ".map"]);
  const hits = [];
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else if (textExt.has(extname(entry.name).toLowerCase()) && (await stat(p)).size < 8 * 1024 * 1024) {
        const text = await readFile(p, "utf8");
        for (const line of text.split("\n")) if (bad.test(line)) hits.push(`${p.slice(dir.length + 1)}: ${line.trim().slice(0, 120)}`);
      }
    }
  };
  await walk(dir);
  return hits;
}

export async function run({ page, downloads, check }) {
  const server = await serveSite(SITE_DIR, PORT);
  // every request the page makes, so cross-origin traffic can be asserted away
  const requests = [];
  page.on("request", (req) => {
    const u = req.url();
    if (!u.startsWith("data:") && !u.startsWith("blob:")) requests.push(u);
  });

  try {
    await seedBootDocument(page);
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

    // 1) 页面可进入
    const res = await page.goto(`${server.url}/index.html`, { waitUntil: "load", timeout: 60000 });
    check.ok("页面可进入（HTTP 200）", !!res && res.status() === 200, `status=${res && res.status()} url=${server.url}/index.html`);

    // 2) WebGPU adapter（真实断言，headless 下走本机 Metal）
    const adapter = await page.evaluate(async () => {
      if (!navigator.gpu) return null;
      const a = await navigator.gpu.requestAdapter();
      if (!a) return null;
      return a.info?.architecture || a.info?.vendor || "adapter";
    });
    check.ok("WebGPU adapter 可用", !!adapter, String(adapter));

    // 3) 应用启动到 ready（palette 只在 ready 后渲染）
    await page.waitForSelector(".palette", { timeout: 120000 });
    check.ok("编辑器 UI 已渲染（节点面板出现）", true);

    const palette = await page.$$eval(".palette-buttons button", (bs) => bs.map((b) => b.textContent.trim()));
    check.ok("节点面板含 Slice / Shuffle 节点", palette.some((t) => t.includes("Slice")) && palette.some((t) => t.includes("Shuffle")), palette.join(", "));
    check.ok(
      "节点面板不含 Remove Background（远程模型已切除）",
      !palette.some((t) => /remove\s*background/i.test(t)),
      palette.filter((t) => /background/i.test(t)).join(", ") || "none"
    );

    // 4) 预置文档按钮存在，点击载入含 Slice + Shuffle 的整幅文档
    const presets = await page.$$eval(".presets-list .preset-btn", (bs) => bs.map((b) => b.textContent.trim()));
    check.ok("预置文档面板列出 image grid collage", presets.includes("image grid collage"), presets.join(", "));

    const clicked = await clickImageGridPreset(page);
    check.ok("已点击 image grid collage 预置（Slice → Shuffle → Place）", clicked);

    // 5) 等这次 cook 算完：cook log 里出现 Slice + Shuffle，且没有 pending / error
    const log = await waitForCookDone(page);
    check.ok("Slice / Shuffle / Output 参与 cook", !!log && log.cooked.includes("Slice") && log.cooked.includes("Shuffle"), log && log.cooked.join(" → "));
    check.ok("cook 无错误", !!log && !log.error, (log && log.error) || "no .cook-error");

    // 6) 节点图 UI 真的渲染了内容
    const nodeCards = await page.$$eval(".react-flow__node", (ns) => ns.length);
    check.ok("节点图渲染出节点卡片", nodeCards >= 6, `react-flow__node=${nodeCards}`);

    const drawn = await sampleStageCanvas(page);
    check.ok(
      "画布已渲染出内容（非空白）",
      drawn.drawn && drawn.opaqueRatio > 0.5,
      `drawn=${drawn.drawn} method=${drawn.method} opaqueRatio=${drawn.opaqueRatio} meanLuma=${drawn.meanLuma} size=${JSON.stringify(drawn.size)}`
    );

    // 7) 导出整幅 PNG
    await page.waitForFunction(
      () => {
        const b = document.querySelector(".export-btn");
        return b && !b.disabled;
      },
      { timeout: 30000 }
    );
    await page.click(".export-btn");
    const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 120000 });
    const info = pngInfo(file.bytes);
    check.ok(
      "导出整幅 PNG（size>0 且宽高>0）",
      file.size > 1000 && info.width > 0 && info.height > 0,
      `${file.name} ${file.size}B ${info.width}x${info.height}`
    );
    check.ok(
      `导出尺寸等于文档画幅 ${FRAME}×${FRAME}`,
      info.width === FRAME && info.height === FRAME,
      `${info.width}x${info.height}`
    );

    // 8) 返回首页链接（内联样式，不依赖外部 css）
    const back = await page.evaluate(() => {
      const a = document.querySelector("a.il-back");
      if (!a) return null;
      const cs = getComputedStyle(a);
      return {
        href: a.getAttribute("href"),
        text: a.textContent.trim(),
        border: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
        radius: cs.borderTopLeftRadius,
        resolved: new URL(a.getAttribute("href"), location.href).pathname
      };
    });
    check.ok("存在返回首页链接 .il-back", !!back, back ? `${back.text} → ${back.href} (${back.resolved})` : "missing");
    check.ok(
      "返回链接指向仓库首页 ../../index.html",
      !!back && back.href === "../../index.html" && back.resolved === "/index.html",
      back && `href=${back.href} resolved=${back.resolved}`
    );
    check.ok("返回链接样式极简（1px 边框 / 小圆角）", !!back && back.border === "1px solid" && parseFloat(back.radius) <= 2, back && `border=${back.border} radius=${back.radius}`);

    // 9) 这个站点的每个静态请求都命中本地服务器（无跨源、无远程）
    const crossOrigin = requests.filter((u) => !u.startsWith(server.url));
    check.ok("没有任何跨源 / 远程请求", crossOrigin.length === 0, crossOrigin.slice(0, 5).join(", ") || `${requests.length} requests, all same-origin`);
    const failed = requests.filter((u) => /fonts\.googleapis|fonts\.gstatic|huggingface|jsdelivr|unpkg|cdnjs/i.test(u));
    check.ok("请求里没有字体 CDN / 模型 hub", failed.length === 0, failed.join(", ") || "none");

    // 10) 构建产物静态审查：没有远程模型 / CDN / 远程字体
    const hits = await scanBuiltAssets(SITE_DIR);
    check.ok("构建产物不含远程模型 / CDN / 远程字体字符串", hits.length === 0, hits.slice(0, 3).join(" | ") || "clean");

    // 11) 0 console error / pageerror / 失败请求
    check.ok("0 console error / pageerror / 失败请求", page.errors.length === 0, page.errors.slice(0, 4).join(" | ") || `requests=${requests.length}`);
  } finally {
    await server.close();
  }
}
