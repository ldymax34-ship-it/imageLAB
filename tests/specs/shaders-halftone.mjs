/**
 * tools/shaders-halftone · smoke
 *
 * 覆盖：页面可进入 / WebGL2 / 三个效果 / 「无图片」空态 /
 * 上传后图片真的进入渲染 / 调参与换类型引起像素变化 / 切换效果后图片仍生效 / PNG 导出。
 */
import { webglReport, canvasLooksDrawn, pngInfo } from "../harness.mjs";
import { fileURLToPath } from "node:url";

export const id = "shaders-halftone";
export const title = "CMYK 半调 / 网点 / 抖动";
export const gpu = "webgl2";

/** 工作区路径含空格，必须走 fileURLToPath 解码 */
const PHOTO = fileURLToPath(new URL("../fixtures/test-photo.png", import.meta.url));

const W = 128;
const H = 80;

/** 每个效果的关键 uniform（验证接线）
   注意：不含 u_imageAspectRatio —— 那一项由 ShaderMount 在收到图片元素时自己推导，
   不会出现在 providedUniforms 里。 */
const EXPECTED = {
  "halftone-cmyk": ["u_image", "u_colorC", "u_colorM", "u_colorY", "u_colorK", "u_size", "u_contrast", "u_gridNoise", "u_softness", "u_type", "u_noiseTexture"],
  "halftone-dots": ["u_image", "u_colorFront", "u_colorBack", "u_size", "u_radius", "u_contrast", "u_grid", "u_type", "u_originalColors", "u_inverted"],
  "image-dithering": ["u_image", "u_colorFront", "u_colorBack", "u_colorHighlight", "u_type", "u_pxSize", "u_colorSteps", "u_originalColors", "u_inverted"]
};

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

async function setControl(page, selector, value) {
  return page.evaluate(
    ({ selector, value }) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      node.value = String(value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { selector, value }
  );
}

export async function run({ page, base, downloads, check, sleep }) {
  const url = `${base}/tools/shaders-halftone/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("半调"), await page.title());

  await page.waitForFunction(() => window.imagelab && window.imagelab.shader, { timeout: 60000 });
  await sleep(1500);
  await page.waitForFunction(() => window.imagelab && window.imagelab.shader, { timeout: 60000 });

  const report = await webglReport(page);
  check.ok("拿到 WebGL2 上下文", report.webgl2 === true, `renderer=${report.renderer || "n/a"}`);

  const offered = await page.evaluate(() => window.imagelab.shaders);
  check.ok(
    "提供 CMYK 半调 / 网点半调 / 图片抖动三个效果",
    offered.length === 3 && ["halftone-cmyk", "halftone-dots", "image-dithering"].every((k) => offered.includes(k)),
    offered.join(",")
  );

  /* -------------------------------------------------------- 「无图片」空态 */
  const emptyVisible = await page.evaluate(() => {
    const node = document.getElementById("empty");
    return Boolean(node) && !node.hidden && node.offsetParent !== null;
  });
  check.ok("未上传时显示「无图片」空态提示", emptyVisible === true);
  check.ok("未上传时状态为「没有图片」", (await page.evaluate(() => window.imagelab.hasImage())) === false);

  const emptyText = await page.evaluate(() => (document.getElementById("empty") || {}).textContent || "");
  check.ok("空态文案明确说明没有图片", /还没有图片/.test(emptyText), emptyText.trim().slice(0, 40));

  await page.waitForSelector("canvas", { timeout: 20000 });
  await sleep(700);

  /* ------------------------------------------------------------ 上传图片 */
  const beforeUpload = await snapshot(page);
  const input = await page.$("input[type=file]");
  check.ok("存在文件上传控件", !!input);
  await input.uploadFile(PHOTO);
  await page.waitForFunction(() => window.imagelab.hasImage() === true, { timeout: 60000 });
  await sleep(900);

  const emptyAfter = await page.evaluate(() => document.getElementById("empty").hidden);
  check.ok("上传后「无图片」空态隐藏", emptyAfter === true);

  const drawn = await canvasLooksDrawn(page, "canvas");
  check.ok("上传后画布真实渲染（非空白）", drawn.drawn === true, `opaqueRatio=${drawn.opaqueRatio} meanLuma=${drawn.meanLuma} size=${drawn.size}`);

  const afterUpload = await snapshot(page);
  const uploadDiff = compare(beforeUpload, afterUpload);
  check.ok(
    "上传 test-photo.png 后图片确实进入渲染（像素变化）",
    uploadDiff.ratio > 0.05,
    `变化像素比例=${uploadDiff.ratio} 平均绝对差=${uploadDiff.meanAbs}`
  );

  const cmykUniforms = await page.evaluate(() => Object.keys(window.imagelab.mount().providedUniforms));
  const cmykMissing = EXPECTED["halftone-cmyk"].filter((u) => !cmykUniforms.includes(u));
  check.ok(
    "效果 halftone-cmyk 的 uniform 接线齐全",
    cmykMissing.length === 0,
    cmykMissing.length ? `缺少 ${cmykMissing.join(",")}` : `${cmykUniforms.length} 个 uniform`
  );

  /* --------------------------------------------------- 调参 / 换类型生效 */
  const beforeSize = await snapshot(page);
  const hasSize = await setControl(page, "#p-size", 1);
  check.ok("CMYK 半调存在 size 控件", hasSize === true);
  await sleep(450);
  const sizeDiff = compare(beforeSize, await snapshot(page));
  check.ok(
    "改 size(0.2→1) 后画布像素确实变化",
    sizeDiff.ratio > 0.05,
    `变化像素比例=${sizeDiff.ratio} 平均绝对差=${sizeDiff.meanAbs}`
  );

  const beforeType = await snapshot(page);
  const hasType = await setControl(page, "#p-type", "sharp");
  check.ok("CMYK 半调存在 type 控件", hasType === true);
  await sleep(450);
  const typeDiff = compare(beforeType, await snapshot(page));
  check.ok(
    "切换 type(ink→sharp) 后画布像素确实变化",
    typeDiff.ratio > 0.02,
    `变化像素比例=${typeDiff.ratio} 平均绝对差=${typeDiff.meanAbs}`
  );

  /* ------------------------------------------- 三个效果的接线 + 切换行为 */
  let last = await snapshot(page);
  for (const key of ["halftone-dots", "image-dithering"]) {
    await page.click(`#effect-${key}`);
    await page.waitForFunction((k) => window.imagelab.shader === k, { timeout: 30000 }, key);
    await page.waitForFunction(() => window.imagelab.hasImage() === true, { timeout: 30000 });
    await sleep(900);

    const d = await canvasLooksDrawn(page, "canvas");
    check.ok(`效果 ${key} 真实渲染（非空白）`, d.drawn === true, `opaqueRatio=${d.opaqueRatio} meanLuma=${d.meanLuma}`);

    const uniforms = await page.evaluate(() => Object.keys(window.imagelab.mount().providedUniforms));
    const missing = EXPECTED[key].filter((u) => !uniforms.includes(u));
    check.ok(`效果 ${key} 的 uniform 接线齐全`, missing.length === 0, missing.length ? `缺少 ${missing.join(",")}` : `${uniforms.length} 个 uniform`);

    const diff = compare(last, await snapshot(page));
    check.ok(`切换到 ${key} 后画面明显改变`, diff.ratio > 0.05, `变化像素比例=${diff.ratio}`);
    last = await snapshot(page);
  }

  /* ------------------------------------------------- 暂停 / 定格 控件可用 */
  check.ok("存在暂停控件", !!(await page.$("#btn-pause")));
  await page.click("#btn-pause");
  await sleep(250);
  check.ok("暂停把速度置 0", (await page.evaluate(() => window.imagelab.param("speed"))) === 0);
  await setControl(page, "#p-frame", 1500);
  await sleep(300);
  const frame = await page.evaluate(() => Math.round(window.imagelab.frame()));
  check.ok("定格控件可设置帧位置", frame >= 1400 && frame <= 1700, `frame=${frame}ms`);

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
    file.name.includes("shaders-halftone") && file.name.includes("image-dithering"),
    file.name
  );

  check.ok("页面无 console 错误", page.errors.length === 0, `${page.errors.length} 条${page.errors.length ? "：" + page.errors.slice(0, 3).join(" | ") : ""}`);
}
