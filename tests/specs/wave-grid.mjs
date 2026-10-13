/**
 * tools/wave-grid · smoke
 *
 * 覆盖：页面可进入 / 默认彩色波浪点阵真实绘制 / 网格单元数受限（≤20000）/
 * 运行中画面随时间变化 / 暂停后画面逐像素稳定（暂停帧 = 导出帧）/ 
 * 本地图片上传采样亮度颜色、无效图片保留上一张 / 文字点阵取样 /
 * 形状与配色切换 / 重新随机 / PNG 当前帧导出且不放大 / 无外部网络请求。
 */
import { pngInfo, ROOT } from "../harness.mjs";
import { resolve } from "node:path";

export const id = "wave-grid";
export const title = "波动点阵";
export const gpu = null;

const MAX_CELLS = 20000;
const FIXTURE = resolve(ROOT, "tests", "fixtures", "test-photo.png");

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

async function litRatio(page) {
  return page.evaluate(() => {
    const c = document.getElementById("wave-canvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    let total = 0;
    for (let i = 0; i < d.length; i += 4 * 9) {
      total++;
      if (d[i] + d[i + 1] + d[i + 2] > 90) lit++;
    }
    return +(lit / Math.max(1, total)).toFixed(4);
  });
}

export async function run({ page, base, downloads, check, sleep }) {
  const external = watchExternal(page, base);
  const res = await page.goto(`${base}/tools/wave-grid/index.html`, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("波动点阵"), await page.title());

  await page.waitForFunction(() => window.imagelab && window.imagelab.ready === true, { timeout: 30000 });
  await sleep(500);

  const lit = await litRatio(page);
  check.ok("默认彩色波浪点阵真实绘制（暗底上有发光单元）", lit > 0.002, `litRatio=${lit}`);
  const cells = await page.evaluate(() => window.imagelab.cells());
  check.ok("网格单元数受限", cells > 0 && cells <= MAX_CELLS, `${cells} 个单元`);

  /* ------------------------------------------------------------ 运行 / 暂停 */
  const moving1 = await page.evaluate(() => window.imagelab.snapshot());
  await sleep(500);
  const moving2 = await page.evaluate(() => window.imagelab.snapshot());
  check.ok("运行中画面随时间变化（真实动效）", moving1 !== moving2, moving1 === moving2 ? "两帧相同" : "已变化");

  await page.click("#btn-pause");
  await sleep(300);
  const paused1 = await page.evaluate(() => window.imagelab.snapshot());
  await sleep(600);
  const paused2 = await page.evaluate(() => window.imagelab.snapshot());
  check.ok("暂停后画面逐像素稳定（暂停帧即导出帧）", paused1 === paused2, paused1 === paused2 ? "稳定" : "仍在变化");
  check.ok("暂停状态可读", (await page.evaluate(() => window.imagelab.paused())) === true);

  /* ------------------------------------------------------------ 参数与随机 */
  const beforeAmp = await page.evaluate(() => window.imagelab.snapshot());
  await page.$eval("#p-amp", (n) => {
    n.value = "1";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(250);
  check.ok("改波幅后画面变化", (await page.evaluate(() => window.imagelab.snapshot())) !== beforeAmp);

  const seedBefore = await page.evaluate(() => window.imagelab.seed());
  await page.click("#btn-reroll");
  await sleep(250);
  const seedAfter = await page.evaluate(() => window.imagelab.seed());
  check.ok("重新随机更换种子", seedAfter !== seedBefore, `${seedBefore}→${seedAfter}`);

  await page.click("#shape-chars");
  await sleep(250);
  check.ok("切换到字符单元", (await page.evaluate(() => window.imagelab.shape())) === "chars");
  await page.click("#preset-cool");
  await sleep(250);
  check.ok("切换到冷色配色", (await page.evaluate(() => window.imagelab.preset())) === "cool");
  await page.click("#shape-squares");
  await page.click("#preset-multi");

  /* ------------------------------------------------------------ 文字点阵 */
  const beforeText = await page.evaluate(() => window.imagelab.snapshot());
  await page.$eval("#mask-text", (n) => {
    n.value = "imageLAB";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(350);
  check.ok("输入文字后按文字形状取样（画面变化）", (await page.evaluate(() => window.imagelab.snapshot())) !== beforeText);

  /* ---------------------------------------------------------- 图片上传 */
  const beforeImage = await page.evaluate(() => window.imagelab.snapshot());
  const input = await page.$("#image-file");
  await input.uploadFile(FIXTURE);
  await page.waitForFunction(() => window.imagelab.hasImage() === true, { timeout: 15000 });
  await sleep(400);
  check.ok("上传本地图片后点阵跟随图片采样", (await page.evaluate(() => window.imagelab.snapshot())) !== beforeImage);
  check.ok("上传后清除按钮出现", (await page.$eval("#image-clear", (n) => !n.hidden)) === true);

  // 无效图片：真实解码失败，必须保留上一张有效图片，不炸页面。
  await page.evaluate(() => {
    const el = document.getElementById("image-file");
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], "broken.png", { type: "image/png" }));
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(700);
  const brokenStatus = await page.$eval("#status", (n) => n.textContent);
  check.ok(
    "无效图片被拒绝且保留当前有效图片",
    /解码失败|保留/.test(brokenStatus) && (await page.evaluate(() => window.imagelab.hasImage())) === true,
    brokenStatus.slice(0, 48)
  );

  await page.click("#image-clear");
  await sleep(250);
  check.ok("清除图片后回到纯波浪", (await page.evaluate(() => window.imagelab.hasImage())) === false);

  /* -------------------------------------------------------------- 导出 */
  await page.click("#btn-pause");
  await sleep(250);
  const expected = await page.evaluate(() => {
    const c = document.getElementById("wave-canvas");
    return { width: c.width, height: c.height };
  });
  await page.click("#btn-export");
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "导出 PNG 非空且为当前画布分辨率（不放大）",
    file.size > 1000 && info.width === expected.width && info.height === expected.height,
    `${file.name} ${info.width}x${info.height}（画布 ${expected.width}x${expected.height}）`
  );

  check.ok("无外部网络请求（本地纯前端）", external.length === 0, external.slice(0, 3).join(" | ") || "0 条");
  check.ok("页面无 console 错误", page.errors.length === 0, `${page.errors.length} 条${page.errors.length ? "：" + page.errors.slice(0, 3).join(" | ") : ""}`);
}
