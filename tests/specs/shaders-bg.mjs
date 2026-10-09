/**
 * tools/shaders-bg · smoke
 *
 * 覆盖：页面可进入 / WebGL2 / 八个效果逐一真实渲染 + uniform 接线 /
 * 参数改动引起像素变化 / 预设切换 / 暂停与定格 / PNG 导出。
 *
 * 逐效果断言「画布真的画出了东西」是这里最有价值的一条：
 * 任何一个效果的 uniform 接错（例如枚举没翻成数字、色数组越界）都会让画布变成空白。
 */
import { webglReport, canvasLooksDrawn, pngInfo } from "../harness.mjs";

export const id = "shaders-bg";
export const title = "动态背景";
export const gpu = "webgl2";

const W = 128;
const H = 80;

/** 每个效果必须出现在 uniform 表里的关键项（用来验证接线，而不是只看画布非空） */
const EXPECTED = {
  "mesh-gradient": ["u_colors", "u_colorsCount", "u_distortion", "u_swirl", "u_grainMixer", "u_grainOverlay"],
  "grain-gradient": ["u_noiseTexture", "u_colorBack", "u_colors", "u_colorsCount", "u_softness", "u_intensity", "u_noise", "u_shape"],
  "smoke-ring": ["u_noiseTexture", "u_colors", "u_colorsCount", "u_thickness", "u_radius", "u_innerShape", "u_noiseScale", "u_noiseIterations"],
  warp: ["u_noiseTexture", "u_colors", "u_colorsCount", "u_proportion", "u_softness", "u_shape", "u_shapeScale", "u_swirlIterations"],
  "dot-grid": ["u_colorFill", "u_colorStroke", "u_dotSize", "u_gapX", "u_gapY", "u_strokeWidth", "u_sizeRange", "u_opacityRange", "u_shape"],
  "god-rays": ["u_noiseTexture", "u_colorBloom", "u_colors", "u_density", "u_spotty", "u_midSize", "u_midIntensity", "u_intensity", "u_bloom"],
  metaballs: ["u_colors", "u_colorsCount", "u_count", "u_size"],
  "neuro-noise": ["u_colorFront", "u_colorMid", "u_colorBack", "u_brightness", "u_contrast"]
};

const ORDER = Object.keys(EXPECTED);

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
  const url = `${base}/tools/shaders-bg/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("动态背景"), await page.title());

  await page.waitForFunction(() => window.imagelab && window.imagelab.shader, { timeout: 60000 });
  await sleep(1500);
  await page.waitForFunction(() => window.imagelab && window.imagelab.shader, { timeout: 60000 });

  const report = await webglReport(page);
  check.ok("拿到 WebGL2 上下文", report.webgl2 === true, `renderer=${report.renderer || "n/a"}`);

  const offered = await page.evaluate(() => window.imagelab.shaders);
  check.ok(
    "提供 8 个动态背景效果",
    offered.length === 8 && ORDER.every((k) => offered.includes(k)),
    offered.join(",")
  );

  /* ------------------------------------- 逐效果：切换 → 画布真的画出来了 → 接线齐全 */
  for (const key of ORDER) {
    await page.click(`#effect-${key}`);
    await page.waitForFunction((k) => window.imagelab.shader === k, { timeout: 30000 }, key);
    await sleep(800);

    const drawn = await canvasLooksDrawn(page, "canvas");
    check.ok(
      `效果 ${key} 真实渲染（非空白）`,
      drawn.drawn === true,
      `opaqueRatio=${drawn.opaqueRatio} meanLuma=${drawn.meanLuma} size=${drawn.size}`
    );

    const uniforms = await page.evaluate(() => Object.keys(window.imagelab.mount().providedUniforms));
    const missing = EXPECTED[key].filter((u) => !uniforms.includes(u));
    check.ok(`效果 ${key} 的 uniform 接线齐全`, missing.length === 0, missing.length ? `缺少 ${missing.join(",")}` : `${uniforms.length} 个 uniform`);

    // 每个效果都配了预设
    const presetCount = await page.evaluate(() => document.querySelectorAll("#preset-chips button").length);
    check.ok(`效果 ${key} 提供了预设`, presetCount >= 3, `${presetCount} 组`);
  }

  /* -------------------------------------------------- 暂停 + 改参 → 像素变化 */
  await page.click("#effect-mesh-gradient");
  await page.waitForFunction(() => window.imagelab.shader === "mesh-gradient", { timeout: 30000 });
  await sleep(800);

  await page.click("#btn-pause");
  await sleep(300);
  const speed = await page.evaluate(() => window.imagelab.param("speed"));
  check.ok("暂停按钮把速度置 0", speed === 0, `speed=${speed}`);

  const beforeParam = await snapshot(page);
  const hasDistortion = await setControl(page, "#p-distortion", 0);
  check.ok("参数面板存在 distortion 控件", hasDistortion === true);
  await sleep(400);
  const distortionDiff = compare(beforeParam, await snapshot(page));
  check.ok(
    "改 distortion(0.8→0) 后画布像素确实变化",
    distortionDiff.ratio > 0.02,
    `变化像素比例=${distortionDiff.ratio} 平均绝对差=${distortionDiff.meanAbs}`
  );

  /* ------------------------------------------------------------ 预设切换 */
  const beforePreset = await snapshot(page);
  await page.click("#preset-chips button:nth-child(4)");
  await sleep(500);
  const presetDiff = compare(beforePreset, await snapshot(page));
  check.ok(
    "切换预设后画布像素确实变化",
    presetDiff.ratio > 0.05,
    `变化像素比例=${presetDiff.ratio} 平均绝对差=${presetDiff.meanAbs}`
  );

  /* ------------------------------------------------------------ 定格取帧 */
  await setControl(page, "#p-frame", 4200);
  await sleep(400);
  const frame = await page.evaluate(() => Math.round(window.imagelab.frame()));
  check.ok("定格控件把帧推到指定毫秒", frame >= 4100 && frame <= 4400, `frame=${frame}ms`);

  /* ------------------------------------------------------------ 导出 PNG */
  await page.click("#effect-metaballs");
  await page.waitForFunction(() => window.imagelab.shader === "metaballs", { timeout: 30000 });
  await sleep(800);

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
    file.name.includes("shaders-bg") && file.name.includes("metaballs"),
    file.name
  );

  check.ok("页面无 console 错误", page.errors.length === 0, `${page.errors.length} 条${page.errors.length ? "：" + page.errors.slice(0, 3).join(" | ") : ""}`);
}
