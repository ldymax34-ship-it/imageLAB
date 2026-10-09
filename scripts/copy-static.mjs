/**
 * 把「原样搬运」的静态工具目录复制进 dist。
 * 这些目录不经过 Vite 打包（不需要模块转换），保持与上游一致的字节。
 */
import { cp, mkdir, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

const root = import.meta.dirname ? resolve(import.meta.dirname, "..") : process.cwd();
const dist = resolve(root, "dist");

const cfgPath = resolve(root, "scripts", "static-tools.json");
if (!existsSync(cfgPath)) {
  console.error("[copy-static] 缺少 scripts/static-tools.json");
  process.exit(1);
}
const cfg = JSON.parse(await readFile(cfgPath, "utf8"));

let copied = 0;
for (const rel of cfg.staticDirs || []) {
  const src = resolve(root, rel);
  const dest = join(dist, rel);
  if (!existsSync(src)) {
    console.warn(`[copy-static] 跳过（不存在）: ${rel}`);
    continue;
  }
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  console.log(`[copy-static] ${rel} -> dist/${rel}`);
  copied++;
}

for (const rel of cfg.extraDirs || []) {
  const src = resolve(root, rel);
  const dest = join(dist, rel);
  if (!existsSync(src)) {
    console.warn(`[copy-static] 跳过（不存在）: ${rel}`);
    continue;
  }
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  console.log(`[copy-static] ${rel} -> dist/${rel}`);
  copied++;
}

// 首页页脚引用 README / THIRD_PARTY，必须随 dist 一起存在，不能 404
for (const rel of cfg.extraFiles || []) {
  const src = resolve(root, rel);
  const dest = join(dist, rel);
  if (!existsSync(src)) {
    console.warn(`[copy-static] 跳过（不存在）: ${rel}`);
    continue;
  }
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`[copy-static] ${rel} -> dist/${rel}`);
  copied++;
}

console.log(`[copy-static] 完成，共 ${copied} 个条目`);
