/**
 * 构建 tools/psychos（第三方节点式工具，自带构建链）。
 * 该工具输出到仓库根的 dist/tools/psychos，与主站共用同一个 dist。
 *
 * 失败策略：
 *   - 首页 `assets/tools.js` 已登记 `tools/psychos/index.html` 时，它就是用户可见入口，
 *     源码缺失 / 依赖装不上 / 构建失败 / 没有产物都必须以非零退出码失败，
 *     不能静默发出一个首页有链接、dist 里却没有页面的构建。
 *   - 只有在「首页未登记」且源码也缺失时，才允许跳过并以 0 退出。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const toolDir = resolve(root, "tools", "psychos");
const outIndex = resolve(root, "dist", "tools", "psychos", "index.html");

/** 首页清单里是否登记了 psychos 入口。 */
function isRegistered() {
  try {
    return readFileSync(resolve(root, "assets", "tools.js"), "utf8").includes(
      "tools/psychos/index.html"
    );
  } catch {
    return false;
  }
}

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
  if (isRegistered()) {
    console.error(
      "[build-psychos] 失败：首页已登记 tools/psychos，但 tools/psychos/package.json 不存在，无法生成该入口页面。"
    );
    process.exit(1);
  }
  console.warn("[build-psychos] 跳过：tools/psychos 源码不存在，且首页未登记该入口。");
  process.exit(0);
}

if (!existsSync(resolve(toolDir, "node_modules"))) {
  console.log("[build-psychos] 安装 tools/psychos 依赖…");
  const code = await run("npm", ["install", "--no-audit", "--no-fund"], toolDir);
  if (code !== 0) {
    console.error(`[build-psychos] 失败：tools/psychos 依赖安装退出码 ${code}。`);
    process.exit(1);
  }
}

console.log("[build-psychos] 构建 tools/psychos …");
const code = await run("npm", ["run", "build"], toolDir);
if (code !== 0) {
  console.error(`[build-psychos] 失败：tools/psychos 构建命令退出码 ${code}。`);
  process.exit(1);
}
if (!existsSync(outIndex)) {
  console.error(`[build-psychos] 失败：构建结束但没有产出 ${outIndex}，首页登记会因此 404。`);
  process.exit(1);
}
console.log("[build-psychos] 完成 -> dist/tools/psychos");
