/**
 * 纹理间（原样搬运）smoke：确认页面可进入、点阵能生成、PNG 导出非空且尺寸正确。
 * 该目录源码与 _source_snapshot 逐字节一致，本文件是外部测试规格，不修改工具源码。
 */
import { pngInfo } from "../harness.mjs";

export const id = "texture";
export const title = "纹理间 · 点阵渐变 / 曲线纹理";
export const gpu = "webgl2";

export async function run({ page, base, downloads, check }) {
  const url = `${base}/tools/texture/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("纹理间"), await page.title());

  await page.waitForSelector("#tab-quick", { timeout: 20000 });
  check.ok("快速纹理标签存在", !!(await page.$("#tab-quick")));

  // 主画布应当已经渲染出非空内容
  await page.waitForSelector("canvas", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));
  const drawn = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return { ok: false, reason: "无 canvas" };
    const tmp = document.createElement("canvas");
    tmp.width = 120;
    tmp.height = 120;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0, 120, 120);
    const d = ctx.getImageData(0, 0, 120, 120).data;
    let opaque = 0;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 8) opaque++;
      seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    }
    return { ok: opaque / (120 * 120) > 0.2, opaque, colors: seen.size };
  });
  check.ok("主画布已渲染图案", drawn.ok, `opaque=${drawn.opaque} 色彩簇=${drawn.colors}`);

  // 调参：切换曲线纹理标签并回到快速纹理，确认 UI 可交互
  await page.click("#tab-curve");
  await new Promise((r) => setTimeout(r, 400));
  const curveSelected = await page.$eval("#tab-curve", (n) => n.getAttribute("aria-selected"));
  check.ok("可切换到曲线纹理", curveSelected === "true", `aria-selected=${curveSelected}`);
  await page.click("#tab-quick");
  await new Promise((r) => setTimeout(r, 300));

  // 导出 PNG：纹理间的 #export-top / #export-png 直接触发下载（无二级面板）
  const pngBtn = (await page.$("#export-png")) || (await page.$("#export-top"));
  check.ok("存在 PNG 导出按钮", !!pngBtn);
  await page.select("#scale", "1");
  await pngBtn.click();

  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok("PNG 下载非空且尺寸有效", file.size > 1000 && info.width > 0, `${file.name} ${file.size}B ${info.width}x${info.height}`);
}
