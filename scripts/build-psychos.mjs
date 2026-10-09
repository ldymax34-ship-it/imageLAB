/**
 * 构建 tools/psychos（第三方节点式工具，自带构建链）。
 * 该工具输出到仓库根的 dist/tools/psychos，与主站共用同一个 dist。
 * 若它尚未就绪（缺 package.json / 装不上依赖 / 构建失败），只警告并跳过，不阻断整站构建。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const toolDir = resolve(root, "tools", "psychos");

function run(cmd, cmdArgs, cwd) {
  return new Promise((res) => {
    const p = spawn(cmd, cmdArgs, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, npm_config_cache: resolve(root, ".tmp", "npm-cache") }
    });
    p.on("close", (code) => res(code ?? 1));
    p.on("error", () => res(1));
  });
}

if (!existsSync(resolve(toolDir, "package.json"))) {
  console.warn("[build-psychos] 跳过：tools/psychos/package.json 不存在。");
  process.exit(0);
}

if (!existsSync(resolve(toolDir, "node_modules"))) {
  console.log("[build-psychos] 安装 tools/psychos 依赖…");
  const code = await run("npm", ["install", "--no-audit", "--no-fund"], toolDir);
  if (code !== 0) {
    console.warn("[build-psychos] 跳过：依赖安装失败。");
    process.exit(0);
  }
}

console.log("[build-psychos] 构建 tools/psychos …");
const code = await run("npm", ["run", "build"], toolDir);
const out = resolve(root, "dist", "tools", "psychos", "index.html");
if (code !== 0 || !existsSync(out)) {
  console.warn(`[build-psychos] 构建未产出 ${out}，该工具本轮不挂到首页。`);
  process.exit(0);
}
console.log("[build-psychos] 完成 -> dist/tools/psychos");
