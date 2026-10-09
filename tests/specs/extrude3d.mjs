/**
 * SVG立体（tools/extrude3d）外部 smoke 规格。
 *
 * 覆盖：页面可进入 / WebGL2 可用 / 真实渲染出 3D 内容 / 参数与材质变化真的改变像素 /
 * 上传样例成功建模 / 危险 SVG 被明确拒绝且不崩 / 导出 PNG 非空且尺寸正确 / 透明导出带 alpha /
 * 上传本地 PNG 作为基础色表面贴图（真实改变像素、随材质与几何保留、移除恢复预设颜色、
 * 无效文件不丢当前贴图）。
 */
import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ROOT, canvasLooksDrawn, pngInfo, webglReport } from "../harness.mjs";

export const id = "extrude3d";
export const title = "SVG立体";
export const gpu = "webgl2";

const SAMPLE = resolve(ROOT, "tools/extrude3d/samples/square-ring.svg");
const TEXTURE_PHOTO = resolve(ROOT, "tests/fixtures/test-photo.png");
const TMP_DIR = resolve(ROOT, ".tmp");
const TEXT_SVG = resolve(TMP_DIR, "extrude3d-reject-text.svg");
const MANY_CURVES_SVG = resolve(TMP_DIR, "extrude3d-reject-many-curves.svg");
const FAKE_PNG = resolve(TMP_DIR, "extrude3d-fake-texture.png");
const TEXT_PLAIN = resolve(TMP_DIR, "extrude3d-texture.txt");

/**
 * 生成「单条 path 含大量曲线」的 SVG：图形元素只有 1 条、字符串远小于 64 KB，
 * 但采样轮廓点估算出的挤出顶点会超预算——只数图形元素是拦不住的。
 */
function manyCurveSvg(count = 400) {
  const d = ["M 10 100"];
  for (let i = 0; i < count; i++) {
    const x = 20 + ((i * 7) % 160);
    const y = 20 + ((i * 13) % 160);
    d.push(`C ${x} ${y} ${x + 3} ${y + 4} ${x + 6} ${y + 2}`);
  }
  d.push("Z");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="${d.join(" ")}" fill="#000000"/>
</svg>
`;
}

/** 采样画布像素（40×40 网格，RGBA 平铺数组）。 */
function sampleCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const w = 40;
    const h = 40;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    return Array.from(ctx.getImageData(0, 0, w, h).data);
  });
}

/** 背景色（#ffffff）下两份采样的差异：只在「模型区域」内统计，避免被大片背景稀释。 */
function pixelDiff(a, b) {
  const BG = [255, 255, 255];
  if (!a || !b || a.length !== b.length) return { changed: 0, model: 0, ratio: 0 };
  const near = (d, i) =>
    Math.abs(d[i] - BG[0]) + Math.abs(d[i + 1] - BG[1]) + Math.abs(d[i + 2] - BG[2]) > 14;
  let changed = 0;
  let model = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!near(a, i) && !near(b, i)) continue; // 两帧都是背景 → 不计
    model++;
    const d =
      Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 12) changed++;
  }
  return { changed, model, ratio: model ? +(changed / model).toFixed(4) : 0 };
}

/**
 * 两份 40×40 RGBA 采样在「模型区域」（任一帧 alpha>8）内的差异。
 * 用于把「真正解码出来的导出 PNG」和「预览画布」放在同一分辨率下比较：
 * 覆盖像素数应接近，模型内部（两帧都 alpha>200）的差异应极小；
 * 边缘允许少量抗锯齿差异，因此每像素差异要足够大才计入 changed。
 */
function modelSampleDiff(a, b) {
  if (!a || !b || a.length !== b.length) {
    return {
      model: 0,
      changed: 0,
      ratio: 1,
      modelA: 0,
      modelB: 0,
      core: 0,
      coreChanged: 0,
      coreRatio: 1,
      meanA: [0, 0, 0],
      meanB: [0, 0, 0],
      meanDelta: 255
    };
  }
  let model = 0;
  let changed = 0;
  let modelA = 0;
  let modelB = 0;
  let core = 0;
  let coreChanged = 0;
  const sumA = [0, 0, 0];
  const sumB = [0, 0, 0];
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3];
    const ba = b[i + 3];
    if (aa > 8) {
      modelA++;
      sumA[0] += a[i];
      sumA[1] += a[i + 1];
      sumA[2] += a[i + 2];
    }
    if (ba > 8) {
      modelB++;
      sumB[0] += b[i];
      sumB[1] += b[i + 1];
      sumB[2] += b[i + 2];
    }
    const delta =
      Math.abs(a[i] - b[i]) +
      Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]) +
      Math.abs(aa - ba);
    if (aa > 8 || ba > 8) {
      model++;
      if (delta > 100) changed++;
    }
    if (aa > 200 && ba > 200) {
      core++;
      const rgb =
        Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (rgb > 60) coreChanged++;
    }
  }
  const meanA = sumA.map((s) => s / Math.max(modelA, 1));
  const meanB = sumB.map((s) => s / Math.max(modelB, 1));
  const meanDelta =
    Math.abs(meanA[0] - meanB[0]) + Math.abs(meanA[1] - meanB[1]) + Math.abs(meanA[2] - meanB[2]);
  return {
    model,
    changed,
    ratio: model ? +(changed / model).toFixed(4) : 1,
    modelA,
    modelB,
    core,
    coreChanged,
    coreRatio: core ? +(coreChanged / core).toFixed(4) : 1,
    meanA,
    meanB,
    meanDelta: +meanDelta.toFixed(1)
  };
}

/** 设置 input/select 的值并派发原生事件，等价于用户操作。 */
function setControl(page, id, value, type = "input") {
  return page.evaluate(
    (sel, val, evt) => {
      const el = document.getElementById(sel);
      if (!el) throw new Error(`缺少控件 #${sel}`);
      if (el.type === "checkbox") el.checked = !!val;
      else el.value = String(val);
      el.dispatchEvent(new Event(evt, { bubbles: true }));
      return el.value;
    },
    id,
    value,
    type
  );
}

const waitModelled = (page, timeout = 25000) =>
  page.waitForFunction(
    () => {
      const el = document.getElementById("status");
      return el && el.textContent.includes("已建模");
    },
    { timeout, polling: 120 }
  );

export async function run({ page, base, downloads, check, sleep }) {
  const url = `${base}/tools/extrude3d/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);

  const pageTitle = await page.title();
  check.ok("标题正确", pageTitle.includes("SVG立体"), pageTitle);

  const webgl = await webglReport(page);
  check.ok("WebGL2 可用", webgl.webgl2 === true, `renderer=${webgl.renderer || "n/a"}`);

  // 首次加载即展示 samples/square-ring.svg
  await page.waitForSelector("canvas", { timeout: 20000 });
  await waitModelled(page).catch(() => {});
  const firstName = await page.$eval("#svg-name", (n) => n.textContent.trim());
  check.ok("首次加载展示内置样例", firstName.includes("square-ring.svg"), `当前=${firstName}`);

  await sleep(900);
  const initial = await sampleCanvas(page);
  const drawn = await canvasLooksDrawn(page);
  check.ok(
    "画布真实渲染出 3D 内容",
    drawn.drawn === true,
    `drawn=${drawn.drawn} opaqueRatio=${drawn.opaqueRatio} meanLuma=${drawn.meanLuma} size=${drawn.size}`
  );

  // 材质下拉必须能给出关键预设
  const presetIds = await page.$$eval("#material option", (nodes) => nodes.map((n) => n.value));
  for (const required of ["chrome", "glass", "frostedGlass", "plastic"]) {
    check.ok(`材质预设含 ${required}`, presetIds.includes(required), `共 ${presetIds.length} 项`);
  }

  // 轻量名称断言：38 个材质预设全部有中文名，value（上游 preset id）不变，
  // 常用材质仍然可从下拉里选中并生效。
  const materialOptions = await page.$$eval("#material option", (nodes) =>
    nodes.map((n) => ({ value: n.value, label: (n.textContent || "").trim() }))
  );
  check.ok("材质预设共 38 个", materialOptions.length === 38, `共 ${materialOptions.length} 项`);
  const noChinese = materialOptions.filter((o) => !/[\u4e00-\u9fff]/.test(o.label));
  check.ok(
    "38 个材质中文名齐全",
    noChinese.length === 0,
    noChinese.length ? noChinese.map((o) => `${o.value}=${o.label}`).join("、") : "全部含中文"
  );
  check.ok(
    "材质 value（上游 preset id）无重复",
    new Set(presetIds).size === presetIds.length,
    `${new Set(presetIds).size}/${presetIds.length}`
  );
  const MATERIAL_ZH = {
    chrome: "镜面金属",
    glass: "透明玻璃",
    diamond: "水晶效果",
    y2kGloss: "亮面",
    candyInflate: "糖果塑料",
    plastic: "塑料",
    gold: "黄金",
    frostedGlass: "磨砂玻璃"
  };
  for (const [value, label] of Object.entries(MATERIAL_ZH)) {
    const option = materialOptions.find((o) => o.value === value);
    check.ok(`材质 ${value} 中文名为「${label}」`, !!option && option.label === label, option ? option.label : "缺失");
  }
  // 常用材质：通过界面 change 事件选一遍，value 未改、状态跟随。
  const commonPicked = await page.evaluate(() => {
    const select = document.getElementById("material");
    const wanted = ["plastic", "chrome", "glass", "gold"];
    return wanted.map((id) => {
      const exists = Array.from(select.options).some((o) => o.value === id);
      if (!exists) return { id, exists, active: null };
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return { id, exists, active: window.__extrude3d.getState().preset };
    });
  });
  for (const item of commonPicked) {
    check.ok(
      `常用材质「${item.id}」可选且生效`,
      item.exists && item.active === item.id,
      item.exists ? `当前=${item.active}` : "下拉里没有"
    );
  }
  // 恢复默认材质，后续「改材质像素变化」从 chrome 起算。
  await setControl(page, "material", "chrome", "change");
  await sleep(300);

  // 参数变化 → 几何重建 → 几何厚度真的变了，并且画面像素变化
  const beforeDepth = await page.evaluate(() => window.__extrude3d.getInfo());
  await setControl(page, "depth", "5.5", "input");
  await sleep(800);
  const afterDepthInfo = await page.evaluate(() => window.__extrude3d.getInfo());
  const afterDepth = await sampleCanvas(page);
  const depthDiff = pixelDiff(initial, afterDepth);
  check.ok(
    "改厚度后几何 z 尺寸真的增大",
    afterDepthInfo.size[2] > beforeDepth.size[2] * 1.5,
    `几何局部尺寸 z: ${beforeDepth.size[2]} → ${afterDepthInfo.size[2]}`
  );
  check.ok(
    "改厚度后画面像素变化",
    depthDiff.ratio > 0.03,
    `模型区域内变化像素 ${depthDiff.changed}/${depthDiff.model}（${(depthDiff.ratio * 100).toFixed(1)}%）`
  );

  // 取景：厚度拉满时模型仍完整落在视图内（自适应取景，不裁切）
  await setControl(page, "depth", "10", "input");
  await sleep(900);
  const framing = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const w = 140;
    const h = 140;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const diff = Math.abs(d[i] - 255) + Math.abs(d[i + 1] - 255) + Math.abs(d[i + 2] - 255);
        if (diff > 14) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      coverage: +(count / (w * h)).toFixed(3),
      bbox: [minX, minY, maxX, maxY],
      touchesEdge: minX <= 0 || minY <= 0 || maxX >= w - 1 || maxY >= h - 1
    };
  });
  check.ok(
    "厚度拉满时模型完整落在视图内",
    framing.touchesEdge === false && framing.coverage > 0.05,
    `bbox=${framing.bbox.join(",")} coverage=${framing.coverage}`
  );

  // 材质变化 → 像素变化（镀铬 → 玻璃），厚度先回到 5.5 保持单一变量
  await setControl(page, "depth", "5.5", "input");
  await sleep(700);
  const beforeMaterial = await sampleCanvas(page);
  await setControl(page, "material", "glass", "change");
  await sleep(800);
  const afterMaterial = await sampleCanvas(page);
  const materialDiff = pixelDiff(beforeMaterial, afterMaterial);
  check.ok(
    "改材质预设后画面像素变化",
    materialDiff.ratio > 0.1,
    `模型区域内变化像素 ${materialDiff.changed}/${materialDiff.model}（${(materialDiff.ratio * 100).toFixed(1)}%）`
  );

  // 上传内置样例 SVG 成功建模
  const input = await page.$("input[type=file]");
  check.ok("存在文件上传控件", !!input);
  await input.uploadFile(SAMPLE);
  await waitModelled(page);
  await sleep(600);
  const uploaded = await page.evaluate(() => ({
    name: document.getElementById("svg-name").textContent.trim(),
    info: window.__extrude3d.getInfo()
  }));
  check.ok(
    "上传 square-ring.svg 成功建模",
    uploaded.name.includes("square-ring.svg") &&
      uploaded.info.shapeCount > 0 &&
      uploaded.info.vertexCount > 0,
    `name=${uploaded.name} shapeCount=${uploaded.info.shapeCount} verts=${uploaded.info.vertexCount}`
  );
  const afterUpload = await canvasLooksDrawn(page);
  check.ok("上传后画布仍有内容", afterUpload.drawn === true, `opaqueRatio=${afterUpload.opaqueRatio}`);

  /* ---------- 表面贴图：本地 PNG → 上游 UV → MeshPhysicalMaterial.map ---------- */
  // 贴图在非透射材质上最直观：先切到塑料（当前是透明玻璃）
  await setControl(page, "material", "plastic", "change");
  await sleep(500);
  const beforeTexture = await sampleCanvas(page);
  const textureInput = await page.$("#texture-file");
  check.ok("存在「上传表面贴图」控件", !!textureInput);
  await textureInput.uploadFile(TEXTURE_PHOTO);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("texture-name");
      return el && el.textContent.includes("test-photo");
    },
    { timeout: 20000, polling: 100 }
  );
  await sleep(800);
  const textured = await page.evaluate(() => {
    const material = window.__extrude3d.mesh.material;
    const map = material.map;
    return {
      hasMap: !!map,
      colorSpace: map ? map.colorSpace : null,
      baseColor: material.color.getHexString(),
      mapSize: map && map.image ? [map.image.width, map.image.height] : null,
      name: document.getElementById("texture-name").textContent.trim(),
      info: window.__extrude3d.getInfo()
    };
  });
  check.ok(
    "上传 PNG 后材质绑定基础色贴图",
    textured.hasMap &&
      textured.info.texture !== null &&
      textured.info.texture.name.includes("test-photo") &&
      !!textured.mapSize &&
      textured.mapSize[0] === 640 &&
      textured.mapSize[1] === 480,
    `map=${textured.hasMap} size=${textured.mapSize} name=${textured.name}`
  );
  check.ok("贴图使用 sRGB 色彩空间", textured.colorSpace === "srgb", String(textured.colorSpace));
  check.ok("未自定义颜色时基色为纯白", textured.baseColor === "ffffff", `color=#${textured.baseColor}`);
  const afterTexture = await sampleCanvas(page);
  const textureDiff = pixelDiff(beforeTexture, afterTexture);
  check.ok(
    "上传真实贴图后画布像素变化",
    textureDiff.ratio > 0.12,
    `模型区域内变化像素 ${textureDiff.changed}/${textureDiff.model}（${(textureDiff.ratio * 100).toFixed(1)}%）`
  );

  // 自定义颜色可以给贴图染色
  await setControl(page, "color-override", true, "change");
  await setControl(page, "color", "#c81e1e", "input");
  await sleep(400);
  const tintedColor = await page.evaluate(() => window.__extrude3d.mesh.material.color.getHexString());
  check.ok("自定义颜色可给贴图染色", tintedColor === "c81e1e", `当前基色=#${tintedColor}`);
  await setControl(page, "color-override", false, "change");
  await sleep(300);

  // 切换材质预设后贴图仍在（map 不因材质重建而丢失）
  await setControl(page, "material", "gold", "change");
  await sleep(500);
  const afterPreset = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "切换材质预设后贴图保留",
    afterPreset.hasMap && !!afterPreset.texture && afterPreset.texture.name.includes("test-photo"),
    `map=${afterPreset.hasMap} texture=${afterPreset.texture ? afterPreset.texture.name : "null"}`
  );

  // 切换 SVG 重建几何后贴图仍在（继续使用上游三平面 UV）
  await setControl(page, "sample", "hex-nest", "change");
  await waitModelled(page);
  await sleep(700);
  const afterSvgSwap = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "切换 SVG 重建几何后贴图保留",
    afterSvgSwap.hasMap && !!afterSvgSwap.texture && afterSvgSwap.texture.name.includes("test-photo"),
    `map=${afterSvgSwap.hasMap} texture=${afterSvgSwap.texture ? afterSvgSwap.texture.name : "null"}`
  );

  // 无效贴图：伪 PNG（解码失败）与非白名单类型都不得丢掉当前有效贴图
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(FAKE_PNG, "这不是一张真正的 PNG 图片\n", "utf8");
  await writeFile(TEXT_PLAIN, "not an image at all\n", "utf8");
  const beforeFake = await page.evaluate(() => document.getElementById("error").textContent.trim());
  const fakeInput = await page.$("#texture-file");
  await fakeInput.uploadFile(FAKE_PNG);
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim() !== prev && /贴图/.test(el.textContent);
    },
    { timeout: 15000, polling: 100 },
    beforeFake
  );
  const fakeReject = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "伪 PNG 被拒并给出中文原因",
    fakeReject.text.includes("贴图") && /PNG|JPEG|WebP|解码/.test(fakeReject.text),
    fakeReject.text.slice(0, 120)
  );
  check.ok(
    "无效贴图后保留当前有效贴图",
    fakeReject.hasMap && !!fakeReject.texture && fakeReject.texture.name.includes("test-photo"),
    `map=${fakeReject.hasMap} texture=${fakeReject.texture ? fakeReject.texture.name : "null"}`
  );

  const beforeMime = await page.evaluate(() => document.getElementById("error").textContent.trim());
  const mimeInput = await page.$("#texture-file");
  await mimeInput.uploadFile(TEXT_PLAIN);
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim() !== prev && /仅支持|文件类型/.test(el.textContent);
    },
    { timeout: 15000, polling: 100 },
    beforeMime
  );
  const mimeReject = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "非白名单类型被拒并保留贴图",
    /PNG|JPEG|WebP/.test(mimeReject.text) &&
      mimeReject.hasMap &&
      !!mimeReject.texture &&
      mimeReject.texture.name.includes("test-photo"),
    mimeReject.text.slice(0, 120)
  );

  // 移除贴图：材质不再绑定 map，基色恢复材质预设颜色
  const beforeClear = await sampleCanvas(page);
  await page.click("#texture-remove");
  await page.waitForFunction(
    () => {
      const el = document.getElementById("texture-name");
      return el && el.textContent.includes("未使用贴图");
    },
    { timeout: 10000, polling: 100 }
  );
  await sleep(500);
  const cleared = await page.evaluate(() => {
    const material = window.__extrude3d.mesh.material;
    return {
      hasMap: !!material.map,
      baseColor: material.color.getHexString(),
      texture: window.__extrude3d.getInfo().texture,
      name: document.getElementById("texture-name").textContent.trim()
    };
  });
  check.ok(
    "移除贴图后材质不再绑定 map 且调试信息为 null",
    !cleared.hasMap && cleared.texture === null && cleared.name.includes("未使用"),
    `map=${cleared.hasMap} texture=${cleared.texture} name=${cleared.name}`
  );
  check.ok(
    "移除贴图后基色恢复预设颜色（黄金 #ffd891）",
    cleared.baseColor === "ffd891",
    `当前基色=#${cleared.baseColor}`
  );
  const afterClear = await sampleCanvas(page);
  const clearDiff = pixelDiff(beforeClear, afterClear);
  check.ok(
    "移除贴图后画面像素变化",
    clearDiff.ratio > 0.1,
    `模型区域内变化像素 ${clearDiff.changed}/${clearDiff.model}（${(clearDiff.ratio * 100).toFixed(1)}%）`
  );

  // 再次选择同一文件（验证 file input 已重置，可重复上传）
  const reselectInput = await page.$("#texture-file");
  await reselectInput.uploadFile(TEXTURE_PHOTO);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("texture-name");
      return el && el.textContent.includes("test-photo");
    },
    { timeout: 20000, polling: 100 }
  );
  await sleep(600);
  const reselected = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  check.ok(
    "重选同一文件可再次上传贴图",
    reselected.hasMap && !!reselected.texture && reselected.texture.name.includes("test-photo"),
    `map=${reselected.hasMap} texture=${reselected.texture ? reselected.texture.name : "null"}`
  );

  /* ---------- 背景图片（第六轮，用户专项授权）：真实 scene.background + 居中 cover + 基础缩放 ---------- */
  // 上传前先记录四角（纯白背景），用于确认背景图片真的改变了画布像素。
  const bgBeforePixel = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const tmp = document.createElement("canvas");
    tmp.width = 4;
    tmp.height = 4;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    return [d[0], d[1], d[2], d[3]];
  });

  const bgInput = await page.$("#bg-file");
  await bgInput.uploadFile(TEXTURE_PHOTO);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("bg-name");
      return el && el.textContent.includes("test-photo");
    },
    { timeout: 20000, polling: 100 }
  );
  await sleep(700);
  const bgApplied = await page.evaluate(() => {
    const api = window.__extrude3d;
    const tex = api.scene.background;
    const view = document.getElementById("view");
    const img = tex && tex.image;
    const viewAspect = view.clientWidth / view.clientHeight;
    const imgAspect = img ? img.width / img.height : 1;
    return {
      isTexture: !!(tex && tex.isTexture),
      info: api.getInfo().background,
      hasMap: !!api.mesh.material.map,
      name: document.getElementById("bg-name").textContent.trim(),
      expectedRepeat: [Math.min(1, viewAspect / imgAspect), Math.min(1, imgAspect / viewAspect)],
      repeat: tex ? [tex.repeat.x, tex.repeat.y] : null,
      offset: tex ? [tex.offset.x, tex.offset.y] : null
    };
  });
  check.ok(
    "背景图片载入并挂到真实 scene.background 贴图",
    bgApplied.isTexture && !!bgApplied.info && bgApplied.name.includes("test-photo"),
    `isTexture=${bgApplied.isTexture} name=${bgApplied.name}`
  );
  check.ok(
    "背景按视口与原图宽高比居中 cover（repeat / offset 符合公式）",
    !!bgApplied.repeat &&
      Math.abs(bgApplied.repeat[0] - bgApplied.expectedRepeat[0]) < 0.01 &&
      Math.abs(bgApplied.repeat[1] - bgApplied.expectedRepeat[1]) < 0.01 &&
      Math.abs(bgApplied.offset[0] - (1 - bgApplied.repeat[0]) / 2) < 0.005 &&
      Math.abs(bgApplied.offset[1] - (1 - bgApplied.repeat[1]) / 2) < 0.005,
    `repeat=${JSON.stringify(bgApplied.repeat)} 期望=${JSON.stringify(bgApplied.expectedRepeat)} offset=${JSON.stringify(bgApplied.offset)}`
  );
  const bgPixels = await sampleCanvas(page);
  const bgDelta =
    Math.abs(bgPixels[0] - bgBeforePixel[0]) +
    Math.abs(bgPixels[1] - bgBeforePixel[1]) +
    Math.abs(bgPixels[2] - bgBeforePixel[2]);
  check.ok(
    "背景图片真实改变画布像素（不是 CSS 背景）",
    bgPixels[3] === 255 && bgPixels[0] + bgPixels[1] + bgPixels[2] < 740 && bgDelta > 12,
    `上传前=${bgBeforePixel.slice(0, 3).join(",")} 上传后=${bgPixels.slice(0, 4).join(",")}`
  );
  check.ok(
    "背景图片与表面贴图互不影响（同时存在）",
    bgApplied.hasMap && bgApplied.isTexture,
    `map=${bgApplied.hasMap} background=${bgApplied.isTexture}`
  );

  // 背景在材质 / SVG 变化后仍然保留。
  await setControl(page, "material", "plastic", "change");
  await setControl(page, "sample", "letter-a-star", "change");
  await waitModelled(page).catch(() => {});
  await sleep(700);
  const bgPersisted = await page.evaluate(() => ({
    isTexture: !!(window.__extrude3d.scene.background && window.__extrude3d.scene.background.isTexture),
    name: (window.__extrude3d.getInfo().background || {}).name || ""
  }));
  check.ok(
    "切换材质 / SVG 后背景图片保留",
    bgPersisted.isTexture && bgPersisted.name.includes("test-photo"),
    `isTexture=${bgPersisted.isTexture} name=${bgPersisted.name}`
  );

  // 缩放：1× → 2×（repeat 减半、仍居中、像素变化）→ 1×（可缩回）。
  const bgZoomBase = await sampleCanvas(page);
  await setControl(page, "bg-zoom", "2", "input");
  await sleep(500);
  const bgZoomed = await page.evaluate(() => {
    const tex = window.__extrude3d.scene.background;
    return {
      zoom: window.__extrude3d.getState().bgZoom,
      repeat: [tex.repeat.x, tex.repeat.y],
      offset: [tex.offset.x, tex.offset.y],
      out: document.getElementById("bg-zoom-out").textContent.trim()
    };
  });
  check.ok(
    "背景缩放 2× 时贴图重复比例减半且仍居中",
    Math.abs(bgZoomed.repeat[0] - bgApplied.repeat[0] / 2) < 0.005 &&
      Math.abs(bgZoomed.repeat[1] - bgApplied.repeat[1] / 2) < 0.005 &&
      Math.abs(bgZoomed.offset[0] - (1 - bgZoomed.repeat[0]) / 2) < 0.005 &&
      Math.abs(bgZoomed.offset[1] - (1 - bgZoomed.repeat[1]) / 2) < 0.005,
    `zoom=${bgZoomed.zoom} repeat=${JSON.stringify(bgZoomed.repeat)} offset=${JSON.stringify(bgZoomed.offset)} 输出=${bgZoomed.out}`
  );
  const bgZoomPixels = await sampleCanvas(page);
  const bgZoomDiff = pixelDiff(bgZoomBase, bgZoomPixels);
  check.ok(
    "背景缩放改变真实像素",
    bgZoomDiff.ratio > 0.2,
    `变化 ${bgZoomDiff.changed}/${bgZoomDiff.model}（${(bgZoomDiff.ratio * 100).toFixed(1)}%）`
  );
  await setControl(page, "bg-zoom", "1", "input");
  await sleep(400);
  const bgBackToOne = await page.evaluate(() => {
    const tex = window.__extrude3d.scene.background;
    return { repeat: [tex.repeat.x, tex.repeat.y], zoom: window.__extrude3d.getState().bgZoom };
  });
  check.ok(
    "背景缩放可回到 1×（repeat 恢复 cover 基准）",
    bgBackToOne.zoom === 1 &&
      Math.abs(bgBackToOne.repeat[0] - bgApplied.repeat[0]) < 0.005 &&
      Math.abs(bgBackToOne.repeat[1] - bgApplied.repeat[1]) < 0.005,
    `zoom=${bgBackToOne.zoom} repeat=${JSON.stringify(bgBackToOne.repeat)}`
  );

  // 背景参与真实 PNG 导出：透明关闭时，导出的四角应是背景图片像素（不透明）。
  const bgPreview = await sampleCanvas(page);
  await setControl(page, "export-scale", "1", "change");
  await page.click("#export-png");
  const bgFile = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const bgPng = pngInfo(bgFile.bytes);
  const bgExportPixel = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const tmp = document.createElement("canvas");
    tmp.width = 40;
    tmp.height = 40;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 40, 40);
    ctx.drawImage(img, 0, 0, 40, 40);
    const d = ctx.getImageData(0, 0, 40, 40).data;
    return [d[0], d[1], d[2], d[3]];
  }, bgFile.bytes.toString("base64"));
  const bgExportDelta =
    Math.abs(bgExportPixel[0] - bgPreview[0]) +
    Math.abs(bgExportPixel[1] - bgPreview[1]) +
    Math.abs(bgExportPixel[2] - bgPreview[2]);
  check.ok(
    "含背景图的导出 PNG 非空且尺寸为 1× 视图",
    bgFile.size > 1000 && bgPng.width > 0 && bgPng.height > 0,
    `${bgPng.width}x${bgPng.height} ${bgFile.size}B`
  );
  check.ok(
    "导出的 PNG 真实包含背景图片（边角与预览一致、不透明且非纯白）",
    bgExportPixel[3] === 255 &&
      bgExportPixel[0] + bgExportPixel[1] + bgExportPixel[2] < 740 &&
      bgExportDelta < 90,
    `PNG 边角=${bgExportPixel.join(",")} 预览=${bgPreview.slice(0, 4).join(",")} 差=${bgExportDelta}`
  );
  // 清掉这次导出的文件，避免影响后面「透明导出」的下载选取。
  for (const n of await readdir(downloads.dir)) {
    if (n.toLowerCase().endsWith(".png")) await rm(join(downloads.dir, n), { force: true });
  }

  /* ---------- 背景选择竞态：最新一次无效选择不得顶替已生效背景 ---------- */
  await page.evaluate(async () => {
    const input = document.getElementById("bg-file");
    const makePng = async (name, color) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      return new File([blob], name, { type: "image/png" });
    };
    const setFile = (file) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setFile(await makePng("bg-pending.png", "#1e88e5")); // 开始异步解码
    setFile(new File(["not an image at all\n"], "bg-invalid.txt", { type: "text/plain" })); // 同一 tick 立刻拒绝
  });
  await sleep(900);
  const bgRace = await page.evaluate(() => ({
    isTexture: !!(window.__extrude3d.scene.background && window.__extrude3d.scene.background.isTexture),
    name: (window.__extrude3d.getInfo().background || {}).name || "",
    errorHidden: document.getElementById("error").hidden,
    errorText: document.getElementById("error").textContent.trim()
  }));
  check.ok(
    "最新无效背景选择后保留原背景（过期 pending 不顶替）",
    bgRace.isTexture && bgRace.name.includes("test-photo"),
    `isTexture=${bgRace.isTexture} name=${bgRace.name}`
  );
  check.ok(
    "无效背景选择给出中文原因且不被过期加载清掉",
    bgRace.errorHidden === false && /背景图片/.test(bgRace.errorText) && /仅支持|文件类型/.test(bgRace.errorText),
    bgRace.errorText.slice(0, 100)
  );

  // 透明背景抑制背景图片，但图片仍保留；关闭后恢复同一张贴图。
  await setControl(page, "transparent-bg", true, "change");
  await sleep(400);
  const bgSuppressed = await page.evaluate(() => ({
    background: window.__extrude3d.scene.background,
    info: window.__extrude3d.getInfo().background
  }));
  check.ok(
    "透明背景时 scene.background 被抑制但图片仍保留",
    bgSuppressed.background === null && !!bgSuppressed.info && bgSuppressed.info.name.includes("test-photo"),
    `scene.background=${bgSuppressed.background} 保留=${bgSuppressed.info ? bgSuppressed.info.name : "null"}`
  );
  await setControl(page, "transparent-bg", false, "change");
  await sleep(400);
  const bgRestored = await page.evaluate(() => ({
    isTexture: !!(window.__extrude3d.scene.background && window.__extrude3d.scene.background.isTexture),
    name: (window.__extrude3d.getInfo().background || {}).name || ""
  }));
  check.ok(
    "关闭透明背景后恢复保留的背景图片",
    bgRestored.isTexture && bgRestored.name.includes("test-photo"),
    `isTexture=${bgRestored.isTexture} name=${bgRestored.name}`
  );

  // 移除背景：回到所选纯色背景（这里先选 #dddddd 以便用像素确认），表面贴图不受影响。
  await setControl(page, "bg", "#dddddd", "input");
  await page.click("#bg-remove");
  await sleep(500);
  const bgRemoved = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const tmp = document.createElement("canvas");
    tmp.width = 4;
    tmp.height = 4;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    return {
      background: window.__extrude3d.scene.background,
      info: window.__extrude3d.getInfo().background,
      hasMap: !!window.__extrude3d.mesh.material.map,
      pixel: [d[0], d[1], d[2], d[3]]
    };
  });
  check.ok(
    "移除背景后 scene.background 归零并恢复所选纯色背景",
    bgRemoved.background === null &&
      bgRemoved.info === null &&
      Math.abs(bgRemoved.pixel[0] - 221) < 12 &&
      Math.abs(bgRemoved.pixel[1] - 221) < 12 &&
      Math.abs(bgRemoved.pixel[2] - 221) < 12,
    `background=${bgRemoved.background} info=${bgRemoved.info} 像素=${bgRemoved.pixel.join(",")}`
  );
  check.ok(
    "移除背景不影响表面贴图",
    bgRemoved.hasMap,
    `map=${bgRemoved.hasMap}`
  );
  await setControl(page, "bg", "#ffffff", "input"); // 恢复纯白，供后续断言使用

  // 透明背景：画布alpha生效（导出 PNG 走 alpha:true 的渲染器）
  await setControl(page, "transparent-bg", true, "change");
  await sleep(500);
  const alphaProbe = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const tmp = document.createElement("canvas");
    tmp.width = 30;
    tmp.height = 30;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 30, 30);
    ctx.drawImage(canvas, 0, 0, 30, 30);
    const d = ctx.getImageData(0, 0, 30, 30).data;
    const a = (x, y) => d[(y * 30 + x) * 4 + 3];
    let maxAlpha = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > maxAlpha) maxAlpha = d[i];
    return { corner: a(0, 0), corner2: a(29, 0), maxAlpha };
  });
  check.ok(
    "透明背景开关生效（边角 alpha=0 且模型处有内容）",
    alphaProbe.corner === 0 && alphaProbe.corner2 === 0 && alphaProbe.maxAlpha > 0,
    `corner=${alphaProbe.corner} corner2=${alphaProbe.corner2} maxAlpha=${alphaProbe.maxAlpha}`
  );

  // 导出 PNG（贴图仍激活：导出画面应包含贴图）
  const viewWidth = await page.$eval("#view", (n) => Math.round(n.clientWidth));
  const exportMap = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture
  }));
  await setControl(page, "export-scale", "2", "change");
  await page.click("#export-png");
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "PNG 下载非空且尺寸有效",
    file.size > 1000 && info.width > 0 && info.height > 0,
    `${file.name} ${file.size}B ${info.width}x${info.height}`
  );
  check.ok("导出文件名含 extrude3d", /extrude3d/i.test(file.name), file.name);
  check.ok(
    "导出尺寸生效（2× 视图宽度）",
    Math.abs(info.width - viewWidth * 2) <= 10,
    `png=${info.width}px 视图=${viewWidth}px`
  );
  check.ok("透明模式导出的 PNG 带 alpha 通道", file.bytes[25] === 6, `IHDR colorType=${file.bytes[25]}`);
  check.ok(
    "贴图激活时导出 PNG 非空",
    exportMap.hasMap && !!exportMap.texture && file.size > 1000,
    `map=${exportMap.hasMap} texture=${exportMap.texture ? exportMap.texture.name : "null"} ${file.size}B`
  );

  // 强化：不看「map 标志 / IHDR 头」就下结论，而是把下载到的 PNG 字节真正解码成
  // 图像（data URL → Image），和预览画布放在同一 40×40 分辨率下比较；
  // 并确认导出像素里确实有「带 alpha 的彩色模型像素」。复用上面这一次导出，不重复导出。
  const exportedSample = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const w = 40;
    const h = 40;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let solid = 0;
    let colored = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 200) {
        solid++;
        const spread = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        if (spread > 18) colored++;
      }
    }
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      solid,
      colored,
      data: Array.from(d)
    };
  }, file.bytes.toString("base64"));
  const previewSample = await sampleCanvas(page);
  const exportDiff = modelSampleDiff(exportedSample.data, previewSample);
  const coverageDelta =
    Math.abs(exportDiff.modelA - exportDiff.modelB) / Math.max(exportDiff.modelA, exportDiff.modelB, 1);
  check.ok(
    "导出 PNG 真实解码后有带 alpha 的彩色模型像素",
    exportedSample.solid > 20 && exportedSample.colored > 20,
    `解码=${exportedSample.width}x${exportedSample.height} 实心像素=${exportedSample.solid} 彩色像素=${exportedSample.colored}`
  );
  check.ok(
    "导出 PNG 与预览画布同分辨率下画面一致（允许抗锯齿差异）",
    coverageDelta < 0.25 && exportDiff.meanDelta < 45 && exportDiff.coreRatio < 0.25 && exportDiff.ratio < 0.5,
    `模型像素 ${exportDiff.modelA}(PNG)/${exportDiff.modelB}(预览) 覆盖差=${(coverageDelta * 100).toFixed(1)}% ` +
      `均值差=${exportDiff.meanDelta} 核心差异 ${exportDiff.coreChanged}/${exportDiff.core} ` +
      `明显差异 ${exportDiff.changed}/${exportDiff.model}（${(exportDiff.ratio * 100).toFixed(1)}%）`
  );

  /* ---------- 贴图选择竞态：最新一次选择（哪怕被拒）必须作废更早的进行中加载 ---------- */
  // 当前 baseline 贴图是 test-photo.png。同一 tick 里先选一张有效 PNG（异步解码，处于
  //「进行中」），紧接着选一个非白名单 .txt；后者被拒后，前一张的解码回调不得再顶替
  // baseline，也不得把这条错误提示清掉。
  await page.evaluate(async () => {
    const input = document.getElementById("texture-file");
    const makePng = async (name, color) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
      return new File([blob], name, { type: "image/png" });
    };
    const setFile = (file) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const pending = await makePng("pending.png", "#1e88e5");
    setFile(pending); // 开始异步解码
    setFile(new File(["not an image at all\n"], "invalid.txt", { type: "text/plain" })); // 同一 tick 立刻拒绝
  });
  await sleep(900);
  const raceAfterInvalid = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture,
    name: document.getElementById("texture-name").textContent.trim(),
    errorHidden: document.getElementById("error").hidden,
    errorText: document.getElementById("error").textContent.trim()
  }));
  check.ok(
    "最新无效选择后保留 baseline 贴图（过期 pending 不顶替）",
    raceAfterInvalid.hasMap &&
      !!raceAfterInvalid.texture &&
      raceAfterInvalid.texture.name.includes("test-photo") &&
      raceAfterInvalid.name.includes("test-photo"),
    `map=${raceAfterInvalid.hasMap} texture=${raceAfterInvalid.texture ? raceAfterInvalid.texture.name : "null"} name=${raceAfterInvalid.name}`
  );
  check.ok(
    "最新无效选择的中文原因不会被过期加载清掉",
    raceAfterInvalid.errorHidden === false && /仅支持|文件类型/.test(raceAfterInvalid.errorText),
    raceAfterInvalid.errorText.slice(0, 100)
  );

  // 加载中点「移除贴图」：进行中的加载必须过期，回调不得复活贴图。
  await page.evaluate(async () => {
    const input = document.getElementById("texture-file");
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#43a047";
    ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "pending2.png", { type: "image/png" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("texture-remove").click();
  });
  await sleep(900);
  const clearedDuringPending = await page.evaluate(() => ({
    hasMap: !!window.__extrude3d.mesh.material.map,
    texture: window.__extrude3d.getInfo().texture,
    name: document.getElementById("texture-name").textContent.trim()
  }));
  check.ok(
    "加载中点「移除贴图」后保持为空（过期回调不复活贴图）",
    !clearedDuringPending.hasMap &&
      clearedDuringPending.texture === null &&
      clearedDuringPending.name.includes("未使用"),
    `map=${clearedDuringPending.hasMap} texture=${clearedDuringPending.texture} name=${clearedDuringPending.name}`
  );

  check.ok("页面无未捕获异常", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));

  // 危险 SVG：含 <text> 必须被明确拒绝
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(
    TEXT_SVG,
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <text x="20" y="120" font-size="72" font-family="sans-serif">Hi</text>
</svg>
`,
    "utf8"
  );
  const fileInput = await page.$("input[type=file]");
  await fileInput.uploadFile(TEXT_SVG);
  await page.waitForFunction(
    () => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim().length > 0;
    },
    { timeout: 15000, polling: 100 }
  );
  const rejection = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    hidden: document.getElementById("error").hidden,
    info: window.__extrude3d.getInfo(),
    canvasCount: document.querySelectorAll("canvas").length
  }));
  check.ok(
    "含 <text> 的 SVG 被明确拒绝并给出中文原因",
    rejection.hidden === false &&
      rejection.text.includes("拒绝") &&
      /text|tspan/i.test(rejection.text),
    rejection.text.slice(0, 120)
  );
  check.ok(
    "拒绝后不崩溃且保留上一次成功模型",
    rejection.canvasCount === 1 &&
      rejection.info.shapeCount > 0 &&
      rejection.info.lastError !== null,
    `shapeCount=${rejection.info.shapeCount} lastError=${String(rejection.info.lastError).slice(0, 60)}`
  );
  const afterReject = await canvasLooksDrawn(page);
  check.ok("拒绝后画布仍可渲染", afterReject.drawn === true, `opaqueRatio=${afterReject.opaqueRatio}`);

  // 单条 path 内塞入大量曲线：图形元素只有 1 条，字符串很小，
  // 但采样轮廓点估算的挤出顶点超预算，必须在挤出前被拒绝，并保留上一次成功模型。
  const beforeMany = await page.evaluate(() => document.getElementById("error").textContent.trim());
  await writeFile(MANY_CURVES_SVG, manyCurveSvg(400), "utf8");
  const manyInput = await page.$("input[type=file]");
  await manyInput.uploadFile(MANY_CURVES_SVG);
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById("error");
      return el && !el.hidden && el.textContent.trim() !== prev && /曲线|顶点/.test(el.textContent);
    },
    { timeout: 20000, polling: 100 },
    beforeMany
  );
  const manyReject = await page.evaluate(() => ({
    text: document.getElementById("error").textContent.trim(),
    info: window.__extrude3d.getInfo(),
    canvasCount: document.querySelectorAll("canvas").length
  }));
  check.ok(
    "单条 path 含大量曲线被拒绝并给出中文原因",
    manyReject.text.includes("拒绝") && /曲线|顶点/.test(manyReject.text),
    manyReject.text.slice(0, 140)
  );
  check.ok(
    "曲线超限后保留上一次成功模型",
    manyReject.canvasCount === 1 &&
      manyReject.info.shapeCount > 0 &&
      manyReject.info.lastError !== null,
    `shapeCount=${manyReject.info.shapeCount} lastError=${String(manyReject.info.lastError).slice(0, 60)}`
  );
  const afterManyReject = await canvasLooksDrawn(page);
  check.ok("曲线超限后画布仍可渲染", afterManyReject.drawn === true, `opaqueRatio=${afterManyReject.opaqueRatio}`);
  check.ok("曲线超限后页面无未捕获异常", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
}
