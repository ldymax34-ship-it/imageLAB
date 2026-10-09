/**
 * 像素化 pixelit（giventofly/pixelit，MIT）smoke：
 * 页面可进入 → 默认图渲染 → 上传 tests/fixtures/test-photo.png → 改 scale 后输出变化
 * → 点 Download Image 拿到非空 PNG（pngInfo 宽高 > 0）。
 *
 * 说明：上游 saveImage() 用 canvas.toDataURL("image/png") 生成下载，
 * 只是把 MIME 串替换成 image/octet-stream，落盘字节仍是 PNG，故用 pngInfo 断言。
 */
import { resolve } from "node:path";
import { ROOT, canvasLooksDrawn, pngInfo } from "../harness.mjs";

export const id = "pixelit";
export const title = "像素化 pixelit";
export const gpu = null;

const FIXTURE = resolve(ROOT, "tests", "fixtures", "test-photo.png");

/** 对画布做 64x64 采样并算一个稳定签名，用来判断「参数变化后输出是否变化」。 */
function canvasSignature(page, selector) {
  return page.$eval(selector, (c) => {
    const t = document.createElement("canvas");
    t.width = 64;
    t.height = 64;
    const x = t.getContext("2d", { willReadFrequently: true });
    x.drawImage(c, 0, 0, 64, 64);
    const d = x.getImageData(0, 0, 64, 64).data;
    let sig = 0;
    let luma = 0;
    for (let i = 0; i < d.length; i += 4) {
      sig = (sig * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) >>> 0;
      luma += d[i] + d[i + 1] + d[i + 2];
    }
    return { sig, meanLuma: +(luma / (64 * 64 * 3)).toFixed(1) };
  });
}

function setBlocksize(page, value) {
  return page.$eval(
    "#blocksize",
    (el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    },
    value
  );
}

export async function run({ page, base, downloads, check, sleep }) {
  const url = `${base}/tools/pixelit/index.html`;
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("页面可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  const title = await page.title();
  check.ok("标题正确", title.includes("Pixel It"), title);

  await page.waitForSelector("#pixelitcanvas", { timeout: 20000 });
  await sleep(1500); // 等默认图（assets/sky.jpg）+ loader 动画结束

  // 1) 默认图应当已经画到画布上
  const initial = await canvasLooksDrawn(page, "#pixelitcanvas");
  check.ok("默认图已渲染到画布", initial.drawn, JSON.stringify(initial));
  const bootShot = await canvasSignature(page, "#pixelitcanvas");

  // 2) 上传本地测试图
  const input = await page.$("#pixlInput");
  check.ok("存在上传控件 #pixlInput", !!input);
  await input.uploadFile(FIXTURE);

  // 3) 改 scale（blocksize）触发一次转换：上游 main.js 的 change 监听会重画并重采样
  await setBlocksize(page, 12);
  await page.waitForFunction(
    () => {
      const c = document.getElementById("pixelitcanvas");
      return c && c.width === 640 && c.height === 480;
    },
    { timeout: 20000 }
  );
  const uploaded = await page.$eval("#pixelitcanvas", (c) => ({ w: c.width, h: c.height }));
  check.ok(
    "上传后画布尺寸等于上传图（640x480）",
    uploaded.w === 640 && uploaded.h === 480,
    `canvas=${uploaded.w}x${uploaded.h}`
  );
  await sleep(600);
  const shot12 = await canvasSignature(page, "#pixelitcanvas");
  check.ok(
    "上传后输出与默认图不同",
    shot12.sig !== bootShot.sig,
    `boot.sig=${bootShot.sig} upload.sig=${shot12.sig}`
  );

  // 4) 再改一次 scale，输出必须变化
  await setBlocksize(page, 30);
  await sleep(900);
  const shot30 = await canvasSignature(page, "#pixelitcanvas");
  check.ok(
    "改 scale 后输出发生变化",
    shot30.sig !== shot12.sig,
    `scale12.sig=${shot12.sig} scale30.sig=${shot30.sig}`
  );

  // 5) 下载：上游 saveImage() 落盘 pxArt.png
  await page.click("#downloadimage");
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok(
    "下载得到非空 PNG 且宽高 > 0",
    file.size > 1000 && info.width > 0 && info.height > 0,
    `${file.name} ${file.size}B ${info.width}x${info.height}`
  );

  // 6) 全程 0 条 console error / 请求失败
  check.ok(
    "页面无 console error 与失败请求",
    page.errors.length === 0,
    page.errors.slice(0, 3).join(" | ")
  );
}
