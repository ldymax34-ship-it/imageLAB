/**
 * 工具③「像素化与抖动」smoke 规格。
 *
 * 覆盖：
 *  - 页面 HTTP 200 / 标题 / MIT 库以原文载入（字节数自检 + window.pixelate 可用）
 *  - 调色板注册表全部是本地数组（不存在 Lospec slug / URL 分支）
 *  - 上传 tests/fixtures/test-photo.png 后画布出现输出
 *  - 改 width / 换 dither / 改 strength 后 **canvas 像素数据确实变化**（page.evaluate 采样对比）
 *  - 导出 PNG 非空且宽高 > 0
 *  - 大图（> 4000px）等比缩小保护
 *  - 全程零失败请求、零 console 错误、零非本机请求
 *
 * 本文件为外部测试，不修改工具源码。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pngInfo, ROOT } from "../harness.mjs";

export const id = "image-to-pixel";
export const title = "像素化与抖动";
export const gpu = null;

const TOOL_DIR = join(ROOT, "tools", "image-to-pixel");
const FIXTURE = join(ROOT, "tests", "fixtures", "test-photo.png");

/** 把 #preview canvas 的像素快照存到页面侧，避免整块像素数据来回过 CDP。 */
async function capture(page, slot) {
  return page.evaluate((s) => {
    const c = document.querySelector("#preview canvas");
    if (!c) {
      window[s] = null;
      return null;
    }
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i++) {
      h ^= d[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    window[s] = { w: c.width, h: c.height, data: new Uint8ClampedArray(d) };
    let sum = 0;
    let opaque = 0;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2];
      if (d[i + 3] > 8) opaque++;
      colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    const px = d.length / 4;
    return {
      w: c.width,
      h: c.height,
      bytes: d.length,
      hash: h.toString(16),
      opaqueRatio: +(opaque / px).toFixed(3),
      colors: colors.size,
      meanLuma: +(sum / (px * 3)).toFixed(1)
    };
  }, slot);
}

/** 对比两个页面侧快照：等尺寸时给出逐像素差异；另给左上角原始像素块与归一化网格两个指标。 */
async function compare(page, a, b) {
  return page.evaluate(([sa, sb]) => {
    const A = window[sa];
    const B = window[sb];
    if (!A || !B) return null;
    const out = {
      sizeA: [A.w, A.h],
      sizeB: [B.w, B.h],
      sameSize: A.w === B.w && A.h === B.h,
      exact: null,
      corner: null,
      norm: null
    };

    if (out.sameSize) {
      let sum = 0;
      let changed = 0;
      for (let i = 0; i < A.data.length; i += 4) {
        const dr = Math.abs(A.data[i] - B.data[i]);
        const dg = Math.abs(A.data[i + 1] - B.data[i + 1]);
        const db = Math.abs(A.data[i + 2] - B.data[i + 2]);
        if (Math.max(dr, dg, db) > 8) changed++;
        sum += (dr + dg + db) / 3;
      }
      const px = A.data.length / 4;
      out.exact = {
        pixels: px,
        changed,
        changedRatio: +(changed / px).toFixed(4),
        meanAbsDiff: +(sum / px).toFixed(2)
      };
    }

    // 左上角 n×n 原始像素（绝对坐标）
    const n = Math.min(24, A.w, A.h, B.w, B.h);
    if (n > 0) {
      let sum = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const ia = (y * A.w + x) * 4;
          const ib = (y * B.w + x) * 4;
          sum +=
            (Math.abs(A.data[ia] - B.data[ib]) +
              Math.abs(A.data[ia + 1] - B.data[ib + 1]) +
              Math.abs(A.data[ia + 2] - B.data[ib + 2])) /
            3;
        }
      }
      out.corner = { n, meanAbsDiff: +(sum / (n * n)).toFixed(2) };
    }

    // 归一化 24×24 最近邻采样（尺寸不同也能比）
    const G = 24;
    const at = (S, gx, gy) => {
      const x = Math.min(S.w - 1, Math.floor((gx * S.w) / G));
      const y = Math.min(S.h - 1, Math.floor((gy * S.h) / G));
      const i = (y * S.w + x) * 4;
      return [S.data[i], S.data[i + 1], S.data[i + 2]];
    };
    let nsum = 0;
    let nchanged = 0;
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const p = at(A, gx, gy);
        const q = at(B, gx, gy);
        const d = (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3;
        if (d > 8) nchanged++;
        nsum += d;
      }
    }
    out.norm = {
      grid: G,
      changedRatio: +(nchanged / (G * G)).toFixed(4),
      meanAbsDiff: +(nsum / (G * G)).toFixed(2)
    };
    return out;
  }, [a, b]);
}

async function settle(page) {
  await page.waitForFunction(() => window.__imageToPixel && typeof window.__imageToPixel.settled === "function", {
    timeout: 20000
  });
  await page.evaluate(() => window.__imageToPixel.settled());
}

async function setWidth(page, v) {
  await page.$eval(
    "#width",
    (el, val) => {
      el.value = String(val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    v
  );
  await settle(page);
}

async function pick(page, sel, value) {
  await page.select(sel, value);
  await settle(page);
}

/** 去掉注释后的可执行代码（用于静态排查运行期远程调用）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export async function run({ page, base, downloads, check }) {
  const url = `${base}/tools/image-to-pixel/index.html`;

  // 记录任何非本机请求（含 ws），最后统一断言
  const remote = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return;
    let host = null;
    try {
      host = new URL(u).hostname;
    } catch {
      host = null;
    }
    if (host && (host === "127.0.0.1" || host === "localhost" || host === "::1")) return;
    remote.push(`${req.method()} ${u}`);
  });

  // ── 1. 页面与库加载 ────────────────────────────────────────────────
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", !!res && res.status() === 200, `status=${res && res.status()}`);
  const pageTitle = await page.title();
  check.ok("标题正确", pageTitle.includes("像素化") && pageTitle.includes("imageLAB"), pageTitle);

  // 初始化等待：`window.__imageToPixel` 在库载入之前就已挂载（好让载入失败也能被读到），
  // 所以「只等它存在」会踩到竞态（isVendorReady 仍为 false、last 仍为 null）。
  // 必须等页面显式落地就绪信号：<html data-imagelab-ready> + __imageToPixel.ready。
  await page.waitForFunction(
    () =>
      document.documentElement.getAttribute("data-imagelab-ready") !== null &&
      !!(window.__imageToPixel && window.__imageToPixel.ready),
    { timeout: 30000 }
  );
  const bootResult = await page.evaluate(() => window.__imageToPixel.ready);
  check.ok("页面给出明确的初始化完成信号", !!bootResult && bootResult.ok === true, JSON.stringify(bootResult));

  const bootInfo = await page.evaluate(() => ({
    vendorReady: window.__imageToPixel.isVendorReady(),
    hasPixelate: typeof window.pixelate === "function",
    vendorBytes: window.__imageToPixel.vendorBytes,
    loadedVendorBytes: window.__imageToPixel.loadedVendorBytes,
    maxSide: window.__imageToPixel.maxSide,
    dithers: window.__imageToPixel.dithers,
    palettes: Object.fromEntries(
      Object.entries(window.__imageToPixel.palettes).map(([k, v]) => [k, { isArray: Array.isArray(v), len: v.length }])
    ),
    paletteLabels: window.__imageToPixel.paletteLabels
  }));
  check.ok("MIT 库以原文注入且 window.pixelate 可用", bootInfo.vendorReady && bootInfo.hasPixelate, `vendorReady=${bootInfo.vendorReady} typeof pixelate=${bootInfo.hasPixelate}`);
  check.ok(
    "vendor 原文字节数与磁盘一致（19059，未改写）",
    bootInfo.loadedVendorBytes === 19059 && bootInfo.vendorBytes === 19059,
    `loaded=${bootInfo.loadedVendorBytes} expected=${bootInfo.vendorBytes}`
  );

  // 调色板注册表：全部是本地数组 —— 库内字符串（Lospec slug）分支不可达
  const pal = await page.evaluate(() => {
    const P = window.__imageToPixel.palettes;
    const keys = Object.keys(P);
    const badShape = keys.filter((k) => !Array.isArray(P[k]) || !P[k].length || P[k].some((c) => !/^#[0-9a-f]{6}$/i.test(c)));
    const anyStringValue = keys.filter((k) => typeof P[k] === "string");
    return { keys, badShape, anyStringValue, total: keys.length };
  });
  check.ok(
    "调色板全部为本地数组（无 slug / URL）",
    pal.total >= 5 && pal.badShape.length === 0 && pal.anyStringValue.length === 0,
    `${pal.total} 组：[${pal.keys.join(", ")}]；异常=${pal.badShape.concat(pal.anyStringValue).join(",") || "无"}`
  );
  check.ok(
    "抖动枚举与库内取值一致（7 种）",
    ["none", "Floyd-Steinberg", "atkinson", "2x2 Bayer", "4x4 Bayer", "ordered", "Clustered 4x4"].every((d) =>
      bootInfo.dithers.includes(d)
    ),
    bootInfo.dithers.join(" | ")
  );

  // 静态排查：自建文件的可执行代码里没有 fetch / 远程 URL 依赖
  const own = ["index.html", "style.css", "main.js"].map((f) => ({ f, code: stripComments(readFileSync(join(TOOL_DIR, f), "utf8")) }));
  const offenders = own.filter(({ code }) =>
    /(?:\bfetch\s*\(|new\s+WebSocket|importScripts\s*\(|src\s*=\s*["']https?:|url\(\s*["']?https?:|from\s+["']https?:)/.test(code)
  );
  check.ok(
    "自建文件无可执行远程调用（去注释后静态扫描）",
    offenders.length === 0,
    offenders.map((o) => o.f).join(",") || `已扫描 ${own.map((o) => o.f).join(", ")}`
  );

  // ── 2. 默认示例图应当已经渲染出结果 ────────────────────────────────
  await settle(page);
  await page.waitForSelector("#preview canvas", { timeout: 20000 });
  const sampleInfo = await page.evaluate(() => window.__imageToPixel.source());
  check.ok(
    "默认载入本地示例图（640×480）",
    sampleInfo.width === 640 && sampleInfo.height === 480 && sampleInfo.scaled === false,
    JSON.stringify(sampleInfo)
  );
  const s0 = await capture(page, "__snapDefault");
  check.ok(
    "默认输出画布非空白",
    !!s0 && s0.w > 0 && s0.h > 0 && s0.opaqueRatio > 0.9 && s0.colors > 1,
    s0 ? `${s0.w}x${s0.h} opaque=${s0.opaqueRatio} 颜色数=${s0.colors} 均值亮度=${s0.meanLuma} hash=${s0.hash}` : "无 canvas"
  );
  const sampleNote = await page.$eval("#file", (el) => el.closest(".il-field").querySelector(".il-note").textContent);
  check.ok(
    "界面注明默认示例为仓库内置本地测试图",
    /本地测试图/.test(sampleNote) && /tests\/fixtures\/test-photo\.png/.test(sampleNote),
    sampleNote.replace(/\s+/g, " ").trim().slice(0, 110)
  );

  // ── 3. 上传 tests/fixtures/test-photo.png 后出现输出 ────────────────
  const input = await page.$("input[type=file]");
  await input.uploadFile(FIXTURE);
  await settle(page);
  await page.waitForSelector("#preview canvas", { timeout: 20000 });
  const sUpload = await capture(page, "__snapUpload");
  check.ok(
    "上传 fixture 后画布出现输出且尺寸 = width×等比高（160×120）",
    !!sUpload && sUpload.w === 160 && sUpload.h === 120 && sUpload.opaqueRatio > 0.9,
    sUpload ? `${sUpload.w}x${sUpload.h} opaque=${sUpload.opaqueRatio} 颜色数=${sUpload.colors}` : "无 canvas"
  );

  // ── 4. 改 width：输出像素数据确实变化 ─────────────────────────────
  await setWidth(page, 320);
  const s320 = await capture(page, "__snap320");
  check.ok("width=320 → 输出画布 320×240", !!s320 && s320.w === 320 && s320.h === 240, s320 ? `${s320.w}x${s320.h}` : "无 canvas");

  await setWidth(page, 64);
  const s64 = await capture(page, "__snap64");
  check.ok("width=64 → 输出画布 64×48", !!s64 && s64.w === 64 && s64.h === 48, s64 ? `${s64.w}x${s64.h}` : "无 canvas");

  const dWidth = await compare(page, "__snap320", "__snap64");
  check.ok(
    "width 320→64：画布像素数据确实变化",
    !!dWidth &&
      !dWidth.sameSize &&
      dWidth.sizeA.join("x") === "320x240" &&
      dWidth.sizeB.join("x") === "64x48" &&
      s320.hash !== s64.hash &&
      s320.bytes !== s64.bytes &&
      dWidth.norm.meanAbsDiff > 5 &&
      dWidth.norm.changedRatio > 0.05,
    dWidth
      ? `尺寸 ${dWidth.sizeA.join("x")}→${dWidth.sizeB.join("x")}；字节 ${s320.bytes}→${s64.bytes}；hash ${s320.hash}→${s64.hash}；归一化24×24 采样平均绝对差=${dWidth.norm.meanAbsDiff}/255（差异格子比 ${(dWidth.norm.changedRatio * 100).toFixed(1)}%）；左上24×24（绝对坐标）=${dWidth.corner.meanAbsDiff}`
      : "无法比较"
  );

  // ── 5. 换 dither：同尺寸下逐像素对比 ──────────────────────────────
  await setWidth(page, 160);
  await pick(page, "#palette", "bw-2");
  await pick(page, "#dither", "none");
  const sNone = await capture(page, "__snapNone");

  await pick(page, "#dither", "Floyd-Steinberg");
  const sFs = await capture(page, "__snapFs");

  await pick(page, "#dither", "4x4 Bayer");
  const sBayer = await capture(page, "__snapBayer");

  await pick(page, "#dither", "atkinson");
  const sAtk = await capture(page, "__snapAtk");

  const dNoneFs = await compare(page, "__snapNone", "__snapFs");
  check.ok(
    "dither none → Floyd-Steinberg：像素数据变化",
    !!dNoneFs && dNoneFs.sameSize && sNone.hash !== sFs.hash && dNoneFs.exact.meanAbsDiff > 5 && dNoneFs.exact.changedRatio > 0.05,
    dNoneFs
      ? `${dNoneFs.sizeA.join("x")}；hash ${sNone.hash}→${sFs.hash}；差异像素 ${dNoneFs.exact.changed}/${dNoneFs.exact.pixels}（${(dNoneFs.exact.changedRatio * 100).toFixed(1)}%）；平均绝对差=${dNoneFs.exact.meanAbsDiff}/255`
      : "无法比较"
  );

  const dFsBayer = await compare(page, "__snapFs", "__snapBayer");
  check.ok(
    "Floyd-Steinberg → 4x4 Bayer：像素数据变化",
    !!dFsBayer && dFsBayer.sameSize && sFs.hash !== sBayer.hash && dFsBayer.exact.meanAbsDiff > 5 && dFsBayer.exact.changedRatio > 0.05,
    dFsBayer
      ? `${dFsBayer.sizeA.join("x")}；hash ${sFs.hash}→${sBayer.hash}；差异像素 ${dFsBayer.exact.changed}/${dFsBayer.exact.pixels}（${(dFsBayer.exact.changedRatio * 100).toFixed(1)}%）；平均绝对差=${dFsBayer.exact.meanAbsDiff}/255`
      : "无法比较"
  );

  const dBayerAtk = await compare(page, "__snapBayer", "__snapAtk");
  check.ok(
    "4x4 Bayer → Atkinson：像素数据变化",
    !!dBayerAtk && dBayerAtk.sameSize && sBayer.hash !== sAtk.hash && dBayerAtk.exact.meanAbsDiff > 5,
    dBayerAtk
      ? `差异像素比 ${(dBayerAtk.exact.changedRatio * 100).toFixed(1)}%；平均绝对差=${dBayerAtk.exact.meanAbsDiff}/255`
      : "无法比较"
  );

  // ── 6. 改 strength：像素数据确实变化 ──────────────────────────────
  await pick(page, "#dither", "Floyd-Steinberg");
  await page.$eval("#strength", (el) => {
    el.value = "0";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(page);
  const sStr0 = await capture(page, "__snapStr0");
  await page.$eval("#strength", (el) => {
    el.value = "100";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(page);
  const sStr100 = await capture(page, "__snapStr100");
  const dStr = await compare(page, "__snapStr0", "__snapStr100");
  check.ok(
    "strength 0 → 100（Floyd-Steinberg）：像素数据变化",
    !!dStr && dStr.sameSize && sStr0.hash !== sStr100.hash && dStr.exact.meanAbsDiff > 5 && dStr.exact.changedRatio > 0.05,
    dStr
      ? `差异像素 ${dStr.exact.changed}/${dStr.exact.pixels}（${(dStr.exact.changedRatio * 100).toFixed(1)}%）；平均绝对差=${dStr.exact.meanAbsDiff}/255`
      : "无法比较"
  );

  // 参数板检查：界面上确实读到了最后一次渲染的真实参数
  const last = await page.evaluate(() => window.__imageToPixel.last);
  check.ok(
    "库调用参数与界面一致（palette 为数组）",
    !!last && last.width === 160 && last.dither === "Floyd-Steinberg" && last.strength === 100 && last.paletteIsArray === true,
    JSON.stringify(last)
  );

  // ── 6b. 7 种抖动全部可用（库对未知方法会抛 Unknown dithering method） ──
  await pick(page, "#palette", "gray-8");
  await page.evaluate(() => {
    window.__imageToPixel.error = null;
  });
  const ditherHashes = {};
  for (const d of ["none", "Floyd-Steinberg", "atkinson", "2x2 Bayer", "4x4 Bayer", "ordered", "Clustered 4x4"]) {
    await pick(page, "#dither", d);
    const s = await capture(page, `__snapD_${d.replace(/\W+/g, "_")}`);
    ditherHashes[d] = s ? s.hash : null;
  }
  const ditherErr = await page.evaluate(() => window.__imageToPixel.error);
  check.ok(
    "7 种抖动全部可渲染（无 Unknown dithering method）",
    Object.values(ditherHashes).every((h) => !!h) && !ditherErr,
    `${Object.entries(ditherHashes).map(([k, v]) => `${k}=${v}`).join(" ")} · error=${ditherErr || "无"}`
  );
  const distinct = new Set(Object.values(ditherHashes)).size;
  check.ok("7 种抖动的输出互不相同", distinct === 7, `不同 hash 数 = ${distinct}/7`);

  // ── 6c. resolution=original 分支 ─────────────────────────────────
  await pick(page, "#dither", "Floyd-Steinberg");
  await pick(page, "#resolution", "original");
  const sOrig = await capture(page, "__snapResOriginal");
  check.ok(
    "输出尺寸=原图尺寸时画布放回 640×480",
    !!sOrig && sOrig.w === 640 && sOrig.h === 480,
    sOrig ? `${sOrig.w}x${sOrig.h}（像素宽仍为 160，${sOrig.colors} 色）` : "无 canvas"
  );
  await pick(page, "#resolution", "pixel");

  // ── 7. 源画布复用保护 + 导出 PNG ─────────────────────────────────
  await pick(page, "#palette", "gameboy-4");
  await setWidth(page, 160);
  const ref160 = await capture(page, "__snapRef160");

  // 目标像素宽恰好等于源画布宽：库会「复用输入画布并就地写回」，
  // 本工具传拷贝规避，因此回到 160px 后结果必须与首次逐字节一致。
  // （width 上限 512，故用一张 480×360 的诊断源图触发这个巧合。）
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = 360;
    const ctx = c.getContext("2d");
    for (let y = 0; y < 360; y += 8) {
      for (let x = 0; x < 480; x += 8) {
        ctx.fillStyle = (x / 8 + y / 8) % 2 ? "#203040" : "#d0b090";
        ctx.fillRect(x, y, 8, 8);
      }
    }
    await window.__imageToPixel.setSource(c, "diagnostic-480x360");
  });
  await setWidth(page, 160);
  const diag160 = await capture(page, "__snapDiag160");
  await setWidth(page, 480);
  const aliasShot = await capture(page, "__snapAlias480");
  check.ok(
    "width=480（恰等于源图宽）时输出 480×360",
    !!aliasShot && aliasShot.w === 480 && aliasShot.h === 360,
    aliasShot ? `${aliasShot.w}x${aliasShot.h}（源画布 480×360，${aliasShot.colors} 色）` : "无 canvas"
  );
  await setWidth(page, 160);
  const diagBack160 = await capture(page, "__snapDiagBack160");
  check.ok(
    "回到 160px 后输出与首次逐字节一致（库未就地改写源画布）",
    !!diagBack160 && diagBack160.hash === diag160.hash,
    `hash ${diag160.hash} → ${diagBack160.hash}`
  );

  // 换回本地示例图，准备导出
  await page.click("#use-sample");
  await page.waitForFunction(() => window.__imageToPixel.source().width === 640, { timeout: 20000 });
  await setWidth(page, 160);
  const beforeExport = await capture(page, "__snapBeforeExport");
  check.ok(
    "换回示例图后同参数输出与最初逐字节一致（渲染可复现）",
    !!beforeExport && beforeExport.hash === ref160.hash,
    `hash ${ref160.hash} → ${beforeExport.hash}`
  );
  const exportBtn = await page.$("#export-png");
  check.ok("存在「导出 PNG」按钮", !!exportBtn);
  await exportBtn.click();
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "导出 PNG 非空、宽高 > 0 且与输出画布一致",
    file.size > 1000 && info.width > 0 && info.height > 0 && info.width === beforeExport.w && info.height === beforeExport.h,
    `${file.name} ${file.size}B ${info.width}x${info.height}（画布 ${beforeExport.w}x${beforeExport.h}）`
  );
  check.ok("导出文件名符合 image-to-pixel-<width>px.png", /^image-to-pixel-\d+px\.png$/.test(file.name), file.name);

  // ── 8. 大图保护：> 4000px 先等比缩小 ─────────────────────────────
  const big = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 4400;
    c.height = 3300;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 4400, 3300);
    g.addColorStop(0, "#101820");
    g.addColorStop(0.5, "#8a6a44");
    g.addColorStop(1, "#e8dcc0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4400, 3300);
    const info = await window.__imageToPixel.setSource(c, "diagnostic-4400x3300");
    return { info, hint: document.getElementById("hint").textContent };
  });
  check.ok(
    "大图保护：4400×3300 → 等比缩小到 4000×3000 再处理",
    big.info.origWidth === 4400 && big.info.canvasWidth === 4000 && big.info.height === 3000 && big.info.scaled === true,
    JSON.stringify(big.info)
  );
  check.ok("大图保护在界面上有提示", /4000/.test(big.hint) && /缩小/.test(big.hint), big.hint.slice(0, 90));

  // 回到本地示例图
  await page.click("#use-sample");
  await page.waitForFunction(() => window.__imageToPixel.source().width === 640, { timeout: 20000 });
  await settle(page);
  const backInfo = await page.evaluate(() => window.__imageToPixel.source());
  check.ok("可切回本地示例图", backInfo.width === 640 && backInfo.height === 480, JSON.stringify(backInfo));

  // ── 9. 零失败请求 / 零 console 错误 / 零远程请求 ──────────────────
  check.ok("页面零 console 错误 / 零失败请求", page.errors.length === 0, page.errors.slice(0, 4).join(" | ") || "无");
  check.ok(
    "全程零远程请求（仅 127.0.0.1 / data: / blob:）",
    remote.length === 0,
    remote.slice(0, 4).join(" | ") || `已观察 ${base} 本地请求`
  );
}
