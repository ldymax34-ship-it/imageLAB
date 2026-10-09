/**
 * tools/shaders-logo · smoke
 *
 * 覆盖：页面可进入 / WebGL2 / 真实渲染 / 参数改动引起像素变化 /
 * 上传图片后遮罩链路生效 / 效果切换 / PNG 导出。
 *
 * 像素对比用「画布降采样快照 + 逐通道绝对差」，避免只看 canvas 非空这种弱断言。
 */
import { webglReport, canvasLooksDrawn, pngInfo } from "../harness.mjs";
import { fileURLToPath } from "node:url";

export const id = "shaders-logo";
export const title = "标志材质（液态金属 / 宝石烟雾）";
export const gpu = "webgl2";

/** 工作区路径含空格，必须走 fileURLToPath 解码，不能直接用 URL.pathname */
const PHOTO = fileURLToPath(new URL("../fixtures/test-photo.png", import.meta.url));

const W = 128;
const H = 80;

/** 画布降采样快照：返回长度为 W*H*3 的 RGB 数组 */
async function snapshot(page) {
  return page.evaluate(
    ({ w, h }) => {
      const c = document.querySelector("canvas");
      if (!c || !c.width || !c.height) return null;
      const t = document.createElement("canvas");
      t.width = w;
      t.height = h;
      const x = t.getContext("2d", { willReadFrequently: true });
      x.drawImage(c, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data;
      const out = new Array(w * h * 3);
      for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
        out[j] = d[i];
        out[j + 1] = d[i + 1];
        out[j + 2] = d[i + 2];
      }
      return out;
    },
    { w: W, h: H }
  );
}

/** 两个快照的差异统计：变化像素比例 + 平均绝对差 */
function compare(a, b) {
  if (!a || !b) return { ratio: 0, meanAbs: 0 };
  let changed = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > 2) changed++;
  }
  return { ratio: +(changed / a.length).toFixed(4), meanAbs: +(sum / a.length).toFixed(2) };
}

/** 往 range/number/select/checkbox 上派发真实 input 事件 */
async function setControl(page, selector, value) {
  return page.evaluate(
    ({ selector, value }) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      if (node.type === "checkbox") {
        node.checked = Boolean(value);
        node.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      node.value = String(value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { selector, value }
  );
}

export async function run({ page, base, downloads, check, sleep }) {
  const url = `${base}/tools/shaders-logo/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("标志材质"), await page.title());

  // Vite 首次依赖预打包可能触发一次 reload，等模块真正挂载完成
  await page.waitForFunction(() => window.imagelab && window.imagelab.shader, { timeout: 60000 });
  await sleep(1500);
  await page.waitForFunction(() => window.imagelab && window.imagelab.shader, { timeout: 60000 });

  const report = await webglReport(page);
  check.ok("拿到 WebGL2 上下文", report.webgl2 === true, `renderer=${report.renderer || "n/a"}`);

  const shaders = await page.evaluate(() => window.imagelab.shaders);
  check.ok("提供液态金属与宝石烟雾两个效果", shaders.includes("liquid-metal") && shaders.includes("gem-smoke"), shaders.join(","));

  await page.waitForSelector("canvas", { timeout: 20000 });
  await sleep(900);
  const drawn = await canvasLooksDrawn(page, "canvas");
  check.ok("预览画布已真实渲染（非空白）", drawn.drawn === true, `opaqueRatio=${drawn.opaqueRatio} meanLuma=${drawn.meanLuma} size=${drawn.size}`);

  /* ------------------------------------------------ 暂停 + 参数改动生效 */
  await page.click("#btn-pause");
  await sleep(250);
  const pausedSpeed = await page.evaluate(() => window.imagelab.param("speed"));
  check.ok("暂停按钮把速度置 0（setSpeed(0)）", pausedSpeed === 0, `speed=${pausedSpeed}`);

  const before = await snapshot(page);
  const changed = await setControl(page, "#p-distortion", 1);
  check.ok("参数面板存在 distortion 控件", changed === true);
  await sleep(400);
  const after = await snapshot(page);
  const distortionDiff = compare(before, after);
  check.ok(
    "改 distortion(0.07→1) 后画布像素确实变化",
    distortionDiff.ratio > 0.02,
    `变化像素比例=${distortionDiff.ratio} 平均绝对差=${distortionDiff.meanAbs}`
  );

  const beforeSoft = await snapshot(page);
  await setControl(page, "#p-softness", 1);
  await sleep(400);
  const softDiff = compare(beforeSoft, await snapshot(page));
  check.ok(
    "改 softness 后画布像素确实变化",
    softDiff.ratio > 0.002,
    `变化像素比例=${softDiff.ratio} 平均绝对差=${softDiff.meanAbs}`
  );

  /* ---------------------------------------------------------- 定格取帧 */
  await setControl(page, "#p-frame", 3000);
  await sleep(350);
  const frame = await page.evaluate(() => Math.round(window.imagelab.frame()));
  check.ok("定格控件把帧推到指定毫秒（setFrame）", frame >= 2900 && frame <= 3200, `frame=${frame}ms`);

  /* ------------------------------------------------------ 上传图片遮罩 */
  const beforeUpload = await snapshot(page);
  const input = await page.$("input[type=file]");
  check.ok("存在文件上传控件", !!input);
  await input.uploadFile(PHOTO);
  await page.waitForFunction(() => window.imagelab.hasImage() === true, { timeout: 60000 });
  await sleep(900);
  const afterUpload = await snapshot(page);
  const uploadDiff = compare(beforeUpload, afterUpload);
  check.ok(
    "上传 test-photo.png 后遮罩确实生效（像素变化）",
    uploadDiff.ratio > 0.02,
    `变化像素比例=${uploadDiff.ratio} 平均绝对差=${uploadDiff.meanAbs}`
  );
  const isImageFlag = await page.evaluate(() => {
    const m = window.imagelab.mount();
    return Boolean(m && m.providedUniforms && m.providedUniforms.u_isImage);
  });
  check.ok("u_isImage 已置真（走图片遮罩分支）", isImageFlag === true, `u_isImage=${isImageFlag}`);

  /* ---------------------------------------------------------- 切换效果 */
  await page.click("#effect-gem-smoke");
  await page.waitForFunction(() => window.imagelab.shader === "gem-smoke", { timeout: 30000 });
  await page.waitForFunction(() => window.imagelab.hasImage() === true, { timeout: 60000 });
  await sleep(1200);
  const gemDrawn = await canvasLooksDrawn(page, "canvas");
  check.ok(
    "切到 gem-smoke 后画布仍然真实渲染",
    gemDrawn.drawn === true,
    `opaqueRatio=${gemDrawn.opaqueRatio} meanLuma=${gemDrawn.meanLuma}`
  );
  const gemUniforms = await page.evaluate(() => {
    const m = window.imagelab.mount();
    return m ? Object.keys(m.providedUniforms).sort() : [];
  });
  check.ok(
    "gem-smoke 的 uniform 接线正确（含 u_colors / u_colorsCount / u_innerGlow）",
    gemUniforms.includes("u_colors") && gemUniforms.includes("u_colorsCount") && gemUniforms.includes("u_innerGlow"),
    gemUniforms.join(" ")
  );

  /* ------------------------------------------------------------ 导出 PNG */
  const exportBtn = await page.$("#btn-export");
  const exportText = exportBtn ? await page.evaluate((n) => n.textContent, exportBtn) : "";
  check.ok("导出按钮文字含 PNG", /PNG/.test(exportText), exportText);
  await exportBtn.click();
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "导出 PNG 非空且尺寸有效",
    file.size > 1000 && info.width > 0 && info.height > 0,
    `${file.name} ${file.size}B ${info.width}x${info.height}`
  );
  check.ok(
    "导出文件名包含工具 id 与效果名",
    file.name.includes("shaders-logo") && file.name.includes("gem-smoke"),
    file.name
  );

  check.ok("页面无 console 错误", page.errors.length === 0, `${page.errors.length} 条${page.errors.length ? "：" + page.errors.slice(0, 3).join(" | ") : ""}`);
}
