/**
 * 生成测试用素材（全部程序生成，不是私人素材、不是 AI 图）。
 * - tests/fixtures/test-photo.png ：640×480 的彩色测试图，用于像素化 / 抖动 / ASCII / 半调
 * - tests/fixtures/test-logo.svg   ：几何 Logo（path），用于液态金属遮罩
 * - tools/extrude3d/samples/*.svg  ：挤出三维用的样例（简单 / 中等）
 */
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
}

function buildTestPhoto(w = 640, h = 480) {
  const buf = Buffer.alloc(w * h * 4);
  const cx = w * 0.62;
  const cy = h * 0.42;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      // 底色：暖冷对角渐变
      let r = mix(240, 28, u);
      let g = mix(226, 92, (u + v) / 2);
      let b = mix(208, 168, v);
      // 同心环（频率适中，抖动/半调能看出差别）
      const d = Math.hypot(x - cx, y - cy);
      const ring = Math.sin(d / 9) * 0.5 + 0.5;
      r = mix(r, 246, ring * 0.55);
      g = mix(g, 60, ring * 0.42);
      b = mix(b, 40, ring * 0.5);
      // 棋盘 + 圆（局部细节）
      const cell = ((x / 26) | 0) + ((y / 26) | 0);
      if (cell % 2 === 1 && x > w * 0.05 && x < w * 0.4 && y > h * 0.55 && y < h * 0.95) {
        r = mix(r, 20, 0.5);
        g = mix(g, 22, 0.5);
        b = mix(b, 26, 0.5);
      }
      if (Math.hypot(x - w * 0.26, y - h * 0.3) < 62) {
        r = mix(r, 250, 0.8);
        g = mix(g, 214, 0.8);
        b = mix(b, 58, 0.8);
      }
      // 亮暗阶梯条，方便检查阈值/抖动
      if (x > w * 0.86) {
        const step = (y / (h / 8)) | 0;
        const tone = Math.round((step / 7) * 255);
        r = g = b = tone;
      }
      const o = (y * w + x) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = 255;
    }
  }
  return encodePNG(w, h, buf);
}

const LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>imageLAB 测试 Logo（程序生成的几何图形）</title>
  <g fill="#000000">
    <path d="M256 40 L296 176 L440 176 L324 262 L368 400 L256 314 L144 400 L188 262 L72 176 L216 176 Z"/>
    <circle cx="256" cy="256" r="42" fill="#ffffff"/>
  </g>
</svg>
`;

const SAMPLE_SIMPLE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <title>样例：方块 + 圆孔</title>
  <path fill="#111111" fill-rule="evenodd"
    d="M20 20 H180 V180 H20 Z M100 60 A40 40 0 1 0 100 140 A40 40 0 1 0 100 60 Z"/>
</svg>
`;

const SAMPLE_MEDIUM_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <title>样例：字母 A + 星形</title>
  <path fill="#111111" fill-rule="evenodd"
    d="M20 220 L86 20 L154 220 L126 220 L108 160 L72 160 L54 220 Z M80 132 L100 132 L90 96 Z"/>
  <path fill="#111111"
    d="M180 40 L192 78 L232 78 L200 102 L212 140 L180 116 L148 140 L160 102 L128 78 L168 78 Z"/>
</svg>
`;

const out = [];
async function put(rel, data) {
  const p = resolve(ROOT, rel);
  await mkdir(resolve(p, ".."), { recursive: true });
  await writeFile(p, data);
  out.push(`${rel} (${Buffer.isBuffer(data) ? data.length + "B" : "文本"})`);
}

await put("tests/fixtures/test-photo.png", buildTestPhoto());
await put("tests/fixtures/test-logo.svg", LOGO_SVG);
await put("tools/extrude3d/samples/square-ring.svg", SAMPLE_SIMPLE_SVG);
await put("tools/extrude3d/samples/letter-a-star.svg", SAMPLE_MEDIUM_SVG);

console.log("[fixtures] 已生成：");
for (const l of out) console.log("  - " + l);
