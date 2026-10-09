/**
 * 汇总第三方许可文件到 third-party-licenses/。
 * 依赖已就位的 node_modules 与 .tmp/upstream 克隆；缺失的项会明确报错而不是静默跳过。
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dest = resolve(root, "third-party-licenses");
await mkdir(dest, { recursive: true });

const items = [
  ["node_modules/three/LICENSE", "three-LICENSE.txt"],
  ["node_modules/@paper-design/shaders/LICENSE", "paper-design-shaders-LICENSE.txt"],
  ["node_modules/@paper-design/shaders/NOTICE", "paper-design-shaders-NOTICE.txt"],
  ["vendor-licenses/visantlabs-os-LICENSE.txt", "visant-extrude3d-LICENSE.txt"],
  [".tmp/upstream/pixelit/LICENSE", "pixelit-LICENSE.txt"],
  [".tmp/upstream/Image-to-Pixel/LICENSE-library.txt", "tezumie-image-to-pixel-LICENSE-library.txt"],
  [".tmp/upstream/Image-to-Ascii/LICENSE", "nitch193-image-to-ascii-LICENSE.txt"],
  [".tmp/upstream/a-psychos-gd-tool/LICENSE", "blakeshao-a-psychos-gd-tool-LICENSE.txt"],
  [".tmp/upstream/a-psychos-gd-tool/public/fonts/OFL.txt", "JetBrainsMono-OFL-1.1.txt"]
];

let ok = 0;
const missing = [];
for (const [from, to] of items) {
  const src = resolve(root, from);
  if (!existsSync(src)) {
    missing.push(from);
    continue;
  }
  await copyFile(src, resolve(dest, to));
  console.log(`[licenses] ${from} -> third-party-licenses/${to}`);
  ok++;
}

if (missing.length) {
  console.error(
    `[licenses] 缺少 ${missing.length} 个来源文件（.tmp/upstream 是临时克隆，克隆后可重跑本脚本）：\n  ` +
      missing.join("\n  ")
  );
  process.exit(1);
}
console.log(`[licenses] 完成，共 ${ok} 个文件。`);
