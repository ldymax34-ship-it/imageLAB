/**
 * ASCII 字符画 Image-to-Ascii（nitch193/Image-to-Ascii，MIT）smoke：
 * 页面可进入（默认加载本地示例图 assets/sample.png）→ 上传 tests/fixtures/test-photo.png
 * → 字符画出现（黑底白字）→ 点「导出 PNG」→ 下载的 PNG size > 0 且 pngInfo 宽高 > 0。
 */
import { resolve } from "node:path";
import { ROOT, pngInfo } from "../harness.mjs";

export const id = "image-to-ascii";
export const title = "ASCII 字符画 Image-to-Ascii";
export const gpu = null;

const FIXTURE = resolve(ROOT, "tests", "fixtures", "test-photo.png");

/** 统计黑底/白字像素：证明字符画确实被画进 #ascii-canvas（上游 drawText 先填黑底再写白字）。 */
function asciiStats(page) {
  return page.evaluate(() => {
    const c = document.getElementById("ascii-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    let black = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 200) white++;
      else if (d[i] < 20) black++;
    }
    return { w: c.width, h: c.height, white, black };
  });
}

export async function run({ page, base, downloads, check, sleep }) {
  const url = `${base}/tools/image-to-ascii/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  const title = await page.title();
  check.ok("标题正确", title.includes("Image-to-Ascii"), title);

  // 默认的本地示例图应当已经画出字符画
  await page.waitForFunction(
    () => {
      const a = document.getElementById("ascii-canvas");
      return !!a && a.width > 0 && a.height > 0;
    },
    { timeout: 20000 }
  );
  await sleep(600);
  const defaultSize = await page.$eval("#ascii-canvas", (c) => [c.width, c.height]);
  check.ok("默认本地示例图已渲染字符画", defaultSize[0] > 0 && defaultSize[1] > 0, `${defaultSize[0]}x${defaultSize[1]}`);

  // 上传本地测试图（640x480）
  const input = await page.$("#file");
  check.ok("存在上传控件 #file", !!input);
  await input.uploadFile(FIXTURE);
  await page.waitForFunction(
    () => {
      const a = document.getElementById("ascii-canvas");
      return !!a && a.width === 640 && a.height === 480;
    },
    { timeout: 20000 }
  );
  await sleep(800);

  // 字符画确实画出内容：上游 drawText() 先填黑底再写白字
  const stats = await asciiStats(page);
  check.ok(
    "字符画已绘制（黑底 + 白色字符像素）",
    stats.white > 100 && stats.black > 1000,
    JSON.stringify(stats)
  );

  // 默认示例图必须是本地相对路径（上游此处是外链图，已本地化）
  const urlValue = await page.$eval("#imgurl", (el) => el.value);
  check.ok(
    "默认示例图是本地相对路径",
    !!urlValue && !/^[a-z][a-z0-9+.-]*:/i.test(urlValue) && !urlValue.startsWith("//"),
    urlValue
  );

  // 「Change image」用本地相对路径重画一次，确认该路径真的可加载
  await page.$eval("#imgurl", (el) => {
    el.value = "./assets/sample.png";
  });
  await page.click("#change-img-button");
  await sleep(900);
  const again = await asciiStats(page);
  check.ok("用本地相对路径可重新生成字符画", again.w === 640 && again.white > 100, JSON.stringify(again));

  // 导出 PNG（新增的最小导出适配：复用上游 #ascii-canvas + toBlob）
  const button = await page.$("#export-png");
  check.ok("存在「导出 PNG」按钮 #export-png", !!button);
  await button.click();

  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "导出 PNG 非空且宽高 > 0",
    file.size > 0 && info.width > 0 && info.height > 0,
    `${file.name} ${file.size}B ${info.width}x${info.height}`
  );
  check.ok(
    "导出尺寸与字符画布一致（640x480）",
    info.width === again.w && info.height === again.h,
    `png=${info.width}x${info.height} canvas=${again.w}x${again.h}`
  );

  check.ok(
    "页面无 console error 与失败请求",
    page.errors.length === 0,
    page.errors.slice(0, 3).join(" | ")
  );
}
