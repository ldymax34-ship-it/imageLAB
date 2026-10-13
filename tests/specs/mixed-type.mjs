/**
 * tools/mixed-type · smoke
 *
 * 覆盖：页面可进入 / 默认文字即可渲染（黑字白底）/ 混排文字输入 /
 * 同一随机种子重复渲染得到同一张图（无逐帧重排）/ 重新随机换版式 /
 * 描边比例影响像素 / 空文本有中性空态 / window.queryLocalFonts 成功去重与
 * 权限拒绝 / 不支持的降级提示 / 单张 PNG 导出 / 无外部网络请求 / 无 console 错误。
 */
import { pngInfo } from "../harness.mjs";

export const id = "mixed-type";
export const title = "文字混排";
export const gpu = null;

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

async function inkRatio(page) {
  return page.evaluate(() => {
    const c = document.getElementById("mix-canvas");
    const x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    let total = 0;
    for (let i = 0; i < d.length; i += 4 * 16) {
      total++;
      if (d[i] < 140) ink++;
    }
    return +(ink / Math.max(1, total)).toFixed(4);
  });
}

async function setText(page, value) {
  await page.$eval(
    "#text-input",
    (n, v) => {
      n.value = v;
      n.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
  await page.evaluate(() => window.imagelab.render());
  await new Promise((r) => setTimeout(r, 120));
}

export async function run({ page, base, downloads, check, sleep }) {
  const external = watchExternal(page, base);
  const url = `${base}/tools/mixed-type/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("文字混排"), await page.title());

  await page.waitForFunction(() => window.imagelab && window.imagelab.ready === true, { timeout: 30000 });
  await sleep(300);

  const ink = await inkRatio(page);
  check.ok("默认文字渲染出黑字（画布有深色像素）", ink > 0.005, `inkRatio=${ink}`);
  const fonts = await page.evaluate(() => window.imagelab.fonts());
  check.ok(
    "默认字族池可用系统回退（无衬线 / 衬线 / 等宽）",
    ["sans-serif", "serif", "monospace"].every((f) => fonts.includes(f)),
    fonts.join(", ")
  );

  /* ------------------------------------------------- 混排输入 + 可复现性 */
  const before = await page.evaluate(() => window.imagelab.snapshot());
  await setText(page, "混排 Mixed 测试\nLine 2 & 汉字 42");
  const after = await page.evaluate(() => window.imagelab.snapshot());
  check.ok("输入中英文混排文字后画布变化", before !== after, after.length > 1000 ? "已重排" : "快照异常");

  await page.evaluate(() => window.imagelab.render());
  await sleep(120);
  const again = await page.evaluate(() => window.imagelab.snapshot());
  check.ok("同一随机种子重复渲染得到同一张图（不逐帧重排）", again === after, again === after ? "一致" : "两次渲染不一致");

  const seedBefore = await page.evaluate(() => window.imagelab.seed());
  await page.click("#btn-reroll");
  await sleep(200);
  const seedAfter = await page.evaluate(() => window.imagelab.seed());
  const rerolled = await page.evaluate(() => window.imagelab.snapshot());
  check.ok("重新随机更换种子并换一版版式", seedAfter !== seedBefore && rerolled !== again, `seed ${seedBefore}→${seedAfter}`);

  /* ------------------------------------------------------------ 描边比例 */
  const beforeOutline = await page.evaluate(() => window.imagelab.snapshot());
  await page.$eval("#p-outline", (n) => {
    n.value = "1";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => window.imagelab.render());
  await sleep(150);
  const afterOutline = await page.evaluate(() => window.imagelab.snapshot());
  check.ok("描边比例改为 1 后画布像素变化（strokeText 生效）", beforeOutline !== afterOutline, "已变化");
  await page.$eval("#p-outline", (n) => {
    n.value = "0.22";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });

  /* ------------------------------------- 本地字体：成功 / 权限拒绝 / 不支持 */
  // 只桩 window.queryLocalFonts（MDN 主 API），不碰 navigator：Chrome 把该函数挂在
  // window 上，若沿用 navigator.queryLocalFonts 会永远落到「不支持」，那是假通过。
  // 用 getOwnPropertyDescriptor 记录现场，并在 finally 精确还原（原生不存在时删除）。
  const SYNTHETIC_FONT_META = [
    { family: "ImageLAB Synthetic Sans", fullName: "ImageLAB Synthetic Sans Regular", postscriptName: "ImageLABSyntheticSans-Regular", style: "Regular" },
    { family: "ImageLAB Synthetic Sans", fullName: "ImageLAB Synthetic Sans Bold", postscriptName: "ImageLABSyntheticSans-Bold", style: "Bold" },
    { family: "ImageLAB Synthetic Sans", fullName: "ImageLAB Synthetic Sans Italic", postscriptName: "ImageLABSyntheticSans-Italic", style: "Italic" },
    { family: "ImageLAB Synthetic Serif", fullName: "ImageLAB Synthetic Serif Regular", postscriptName: "ImageLABSyntheticSerif-Regular", style: "Regular" },
    { family: "ImageLAB Synthetic Serif", fullName: "ImageLAB Synthetic Serif Bold", postscriptName: "ImageLABSyntheticSerif-Bold", style: "Bold" }
  ];
  const stubLocalFonts = (kind, fonts) =>
    page.evaluate(
      (mode, list) => {
        const desc = Object.getOwnPropertyDescriptor(window, "queryLocalFonts");
        window.__ilFontApi = { desc: desc || null };
        const impl =
          mode === "success"
            ? () => Promise.resolve((list || []).map((f) => ({ ...f })))
            : mode === "denied"
              ? () => Promise.reject(Object.assign(new Error("local font access denied"), { name: "NotAllowedError" }))
              : undefined; // 不支持：window 上没有可调用函数
        Object.defineProperty(window, "queryLocalFonts", { value: impl, configurable: true, writable: true });
      },
      kind,
      fonts || null
    );
  const restoreLocalFonts = () =>
    page.evaluate(() => {
      const saved = window.__ilFontApi;
      if (!saved) return;
      if (saved.desc) Object.defineProperty(window, "queryLocalFonts", saved.desc);
      else delete window.queryLocalFonts;
      delete window.__ilFontApi;
    });
  const clickLocalFonts = async () => {
    await page.click("#btn-local-fonts");
    await sleep(300);
    return page.$eval("#font-status", (n) => n.textContent.trim());
  };
  const toolFamilies = () => page.evaluate(() => window.imagelab.families());
  const toolPool = () => page.evaluate(() => window.imagelab.fonts());

  try {
    /* 成功：合成元数据里同一 family 出现多次，断言按 family 去重并给出成功提示 */
    await stubLocalFonts("success", SYNTHETIC_FONT_META);
    const successStatus = await clickLocalFonts();
    const families = await toolFamilies();
    const uniqFamilies = [...new Set(SYNTHETIC_FONT_META.map((f) => f.family))];
    check.ok(
      "window.queryLocalFonts 成功：重复 family 去重后每个只登记一次",
      new Set(families).size === families.length && uniqFamilies.every((f) => families.filter((x) => x === f).length === 1),
      `${SYNTHETIC_FONT_META.length} 条元数据 → ${uniqFamilies.length} 个唯一字族`
    );
    check.ok(
      "window.queryLocalFonts 成功：给出中文成功提示",
      successStatus.includes("已读取") && successStatus.includes("去重"),
      successStatus.slice(0, 46)
    );
    const poolAfterSuccess = await toolPool();
    check.ok(
      "本机字体只登记字族名，不自动勾选、不携带字体文件",
      uniqFamilies.every((f) => !poolAfterSuccess.includes(f)) && poolAfterSuccess.length >= 1,
      `渲染字族池 ${poolAfterSuccess.length} 个未受影响`
    );

    /* 权限拒绝：抛 NotAllowedError，断言中文回退且不崩溃 */
    await stubLocalFonts("denied");
    const deniedStatus = await clickLocalFonts();
    const poolAfterDenied = await toolPool();
    check.ok(
      "NotAllowedError：给出中文权限回退提示、保留回退字族且不崩溃",
      deniedStatus.includes("未获得读取本机字体的权限") && poolAfterDenied.length >= 1 && page.errors.length === 0,
      `${deniedStatus.slice(0, 46)} · 字族 ${poolAfterDenied.length}`
    );

    /* 真不支持：window 上没有可调用函数时才走「不支持」分支，不拿假缺失去顶替 */
    await stubLocalFonts("unsupported");
    const unsupportedStatus = await clickLocalFonts();
    const poolAfterUnsupported = await toolPool();
    check.ok(
      "window 无 queryLocalFonts：给出不支持提示并保留系统回退",
      unsupportedStatus.includes("不支持") && poolAfterUnsupported.length >= 1,
      unsupportedStatus.slice(0, 46)
    );
  } finally {
    await restoreLocalFonts();
  }

  /* ---------------------------------------------------------- 空文本空态 */
  await setText(page, "");
  const emptyShown = await page.$eval("#empty", (n) => !n.hidden);
  check.ok("空文本显示中性空态（不报错、不伪造内容）", emptyShown === true, emptyShown ? "已显示" : "未显示");
  await setText(page, "混排 Mixed 测试\nLine 2 & 汉字 42");

  /* -------------------------------------------------------------- 导出 */
  const exportBtn = await page.$("#btn-export");
  check.ok("导出按钮存在", !!exportBtn);
  await exportBtn.click();
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "导出 PNG 非空且尺寸有效",
    file.size > 1000 && info.width > 0 && info.height > 0,
    `${file.name} ${file.size}B ${info.width}x${info.height}`
  );
  check.ok("导出文件名含工具 id", file.name.includes("mixed-type"), file.name);

  check.ok("无外部网络请求（本地纯前端）", external.length === 0, external.slice(0, 3).join(" | ") || "0 条");
  check.ok("页面无 console 错误", page.errors.length === 0, `${page.errors.length} 条${page.errors.length ? "：" + page.errors.slice(0, 3).join(" | ") : ""}`);
}
