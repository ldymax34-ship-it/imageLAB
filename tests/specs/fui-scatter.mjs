/**
 * 矢量图层散布 FUI Scatter（sashamartinsen/fui-scatter · MIT 代码 + CC BY 4.0 素材）smoke：
 * 页面可进入 → 统一左上返回首页 → 上游素材库（shape-library/manifest.json）与内置构图预设加载
 * → 图层渲染到预览画布 → Export PNG 得到真实 PNG（默认 1×，即 1200×1200）。
 *
 * 该工具是整合的静态页面：入口页仅注入共享返回外壳，并在上游 commit
 * bd940620806bedfb3350fec042ab2b37a4076af2 的 dist/ 基础上做界面文案汉化——保留品牌
 * FUI SCATTER、作者署名、上游素材库名（b1 / y2k / fui / uav）、枚举值、DOM id、持久化键与用户预设名；
 * 无后端、无远程运行时依赖。封面为已登记的「待生成」缺口（上游不含成品预览图），首页在补齐前显示中性文字占位。
 */
import { canvasLooksDrawn, pngInfo } from "../harness.mjs";

export const id = "fui-scatter";
export const title = "矢量图层散布 FUI Scatter";
export const gpu = null;

export async function run({ page, base, downloads, check, sleep }) {
  const url = `${base}/tools/fui-scatter/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  const pageTitle = await page.title();
  check.ok(
    "标题为中文并保留品牌 FUI SCATTER",
    pageTitle.includes("FUI SCATTER") && pageTitle.includes("矢量构图生成器"),
    pageTitle
  );

  const back = await page.$eval("a.il-back", (n) => ({ text: n.textContent.trim(), href: n.getAttribute("href") }));
  check.ok(
    "唯一左上返回首页入口指向 ../../index.html",
    back.href === "../../index.html",
    `${back.text} → ${back.href}`
  );

  // 上游素材库：paintLibrary() 完成后 shape-set 才含内置分组 b1 / y2k / fui / uav
  await page.waitForFunction(
    () => {
      const s = document.getElementById("shape-set");
      return !!s && [...s.options].some((o) => o.value === "b1");
    },
    { timeout: 30000 }
  );
  const sets = await page.$$eval("#shape-set option", (ns) => ns.map((n) => n.value));
  check.ok(
    "上游素材库加载成功（b1 / y2k / fui / uav）",
    ["b1", "y2k", "fui", "uav"].every((v) => sets.includes(v)),
    sets.join(",")
  );

  // 内置构图预设：presets/manifest.json 在 initializePresets() 里先于 paintLibrary() 载入，
  // 因此素材库就绪后预设也一定在；默认 B1 预设会生成图层，等图层真正出现再断言，避免抓到异步时序。
  await page.waitForFunction(() => document.querySelectorAll(".layer").length >= 1, { timeout: 45000 });
  const presetOptions = await page.$$eval("#composition-preset option", (ns) => ns.length);
  check.ok("内置构图预设已加载", presetOptions > 1, `${presetOptions} 个选项`);

  const layers = await page.$$eval(".layer", (ns) => ns.length);
  check.ok("默认构图含图层", layers >= 1, `${layers} 个图层`);

  // 动态汉化：默认构图的图层由 createLayer() 生成，新建 / 复制图层与操作按钮都不得回到英文。
  const defaultLayerName = await page.$eval(".layer strong", (n) => n.textContent.trim());
  check.ok("图层默认名为中文「图层 N」", /^图层 \d+$/.test(defaultLayerName), defaultLayerName);
  const actionLabels = await page.$$eval(".layer .layer-actions button", (ns) => ns.map((n) => n.textContent.trim()));
  check.ok(
    "图层操作按钮为中文（复制 / 删除）",
    actionLabels.includes("复制") && actionLabels.includes("删除"),
    actionLabels.join(",")
  );
  const objectCount = await page.$eval("#object-count", (n) => n.textContent.trim());
  check.ok("对象计数为中文", /个对象$/.test(objectCount), objectCount);
  const inspectorTitle = await page.$eval("#inspector-title", (n) => n.textContent.trim());
  check.ok("检查器标题为中文「图层设置」", inspectorTitle === "图层设置", inspectorTitle);

  // libraryBusy 结束时 shape-set 才会重新启用：此时默认构图已完全恢复，再取预览与导出。
  await page.waitForFunction(
    () => {
      const s = document.getElementById("shape-set");
      return !!s && !s.disabled;
    },
    { timeout: 45000 }
  );

  await sleep(1500);
  const drawn = await canvasLooksDrawn(page, "#raster-preview");
  check.ok("构图已渲染到预览画布", drawn.drawn, JSON.stringify(drawn));

  // 动态汉化：后期效果页签切换后的检查器标题。
  await page.click("#effects-tab");
  const fxTitle = await page.$eval("#inspector-title", (n) => n.textContent.trim());
  check.ok("后期效果面板标题为中文「后期处理」", fxTitle === "后期处理", fxTitle);
  await page.click("#vector-tab");

  // 上游 exportPNG()：从矢量源重新渲染并下载 scatter-<w>x<h>.png
  await page.click("#export");
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 60000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "导出得到非空 PNG 且尺寸为 1200×1200",
    file.size > 1000 && info.width === 1200 && info.height === 1200,
    `${file.name} ${file.size}B ${info.width}x${info.height}`
  );

  // 动态汉化：新增 / 复制图层不得回到英文（导出已完成，此处的构图改动不影响上面的 PNG 断言）。
  const beforeAdd = await page.$$eval(".layer", (ns) => ns.length);
  await page.click("#add-layer-bottom");
  await sleep(150);
  const afterAdd = await page.$$eval(".layer", (ns) => ns.length);
  const addedName = await page.$eval(".layer strong", (n) => n.textContent.trim());
  check.ok(
    "新增图层默认名为中文「图层 N」",
    afterAdd === beforeAdd + 1 && /^图层 \d+$/.test(addedName),
    `${afterAdd} 个图层 · ${addedName}`
  );

  await page.click(".layer .layer-actions button[data-action='duplicate']");
  await sleep(150);
  const afterCopy = await page.$$eval(".layer", (ns) => ns.length);
  const copiedName = await page.$eval(".layer strong", (n) => n.textContent.trim());
  check.ok(
    "复制图层默认名为中文「图层 N」",
    afterCopy === afterAdd + 1 && /^图层 \d+$/.test(copiedName),
    `${afterCopy} 个图层 · ${copiedName}`
  );

  check.ok("页面无 console error 与失败请求", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
}
