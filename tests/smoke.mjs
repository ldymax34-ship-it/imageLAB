/**
 * 统一 smoke 运行器：npm run smoke [-- <id> ...]
 *
 * 每个规格文件 tests/specs/<id>.mjs 导出：
 *   export const id = "texture";
 *   export const title = "纹理间";
 *   export const gpu = "webgl2" | "webgpu" | null;
 *   export async function run({ page, base, browser, downloads, check }) { ... }
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireBrowserOptIn } from "./browser-policy.mjs";
import {
  ROOT,
  launchBrowser,
  newPage,
  startVite,
  checker,
  withDownloads,
  sleep
} from "./harness.mjs";

requireBrowserOptIn("tests/smoke.mjs");

const PORT = Number(process.env.SMOKE_PORT || 5199);
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const specDir = resolve(ROOT, "tests", "specs");
const files = (await readdir(specDir).catch(() => []))
  .filter((f) => f.endsWith(".mjs") && !f.startsWith("_"))
  .sort();

const specs = [];
for (const f of files) {
  const mod = await import(pathToFileURL(join(specDir, f)).href);
  if (!mod.id || typeof mod.run !== "function") {
    console.warn(`[smoke] 忽略无效规格: ${f}`);
    continue;
  }
  if (only.length && !only.includes(mod.id)) continue;
  specs.push(mod);
}

if (!specs.length) {
  console.error(`[smoke] 没有匹配的规格（${specDir}）`);
  process.exit(1);
}

const needWebgpu = specs.some((s) => s.gpu === "webgpu");
console.log(`[smoke] 启动 Vite dev server :${PORT}`);
const server = await startVite(PORT);

const summary = [];
let hardFail = 0;
let browser = null;

try {
  browser = await launchBrowser({ headless: process.env.SMOKE_HEADFUL !== "1", webgpu: needWebgpu });
  for (const spec of specs) {
    console.log(`\n=== ${spec.id} · ${spec.title || ""} ===`);
    const page = await newPage(browser);
    const downloads = await withDownloads(page);
    const check = checker(spec.id);
    const started = Date.now();
    let crashed = null;
    try {
      await spec.run({
        page,
        browser,
        base: server.url,
        downloads,
        check,
        sleep
      });
    } catch (e) {
      crashed = e;
      check.ok("规格执行未抛异常", false, String(e && e.stack ? e.stack.split("\n")[0] : e));
    }
    // console 错误只在规格没自己断言时作为补充信息输出
    if (page.errors.length) {
      console.log(`   · 页面错误 ${page.errors.length} 条：`);
      page.errors.slice(0, 6).forEach((e) => console.log(`     - ${e}`));
    }
    const failed = check.failed;
    if (failed.length) hardFail++;
    summary.push({
      id: spec.id,
      title: spec.title || "",
      ms: Date.now() - started,
      pass: check.results.filter((r) => r.pass).length,
      fail: failed.length,
      failedNames: failed.map((f) => f.name),
      pageErrors: page.errors.length,
      crashed: crashed ? String(crashed.message || crashed) : null
    });
    // 清理失败不得掩盖规格本身的主失败：只记录，不抛出。
    try {
      await downloads.cleanup();
    } catch (e) {
      console.warn(`[smoke] ${spec.id} 下载目录清理失败：${e.message}`);
    }
    try {
      await page.close();
    } catch (e) {
      console.warn(`[smoke] ${spec.id} 关闭页面失败：${e.message}`);
    }
  }
} finally {
  // 无论成功、失败还是中断，都关掉本次自己启动的 Chrome 与 Vite（各自独立捕获）。
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      console.error(`[smoke] 关闭 Chrome 失败：${e.message}`);
    }
  }
  try {
    server.close();
  } catch (e) {
    console.error(`[smoke] 关闭 Vite 失败：${e.message}`);
  }
}

console.log("\n================ SMOKE 汇总 ================");
for (const s of summary) {
  console.log(
    `${s.fail === 0 ? "PASS" : "FAIL"}  ${s.id.padEnd(18)} ${String(s.pass).padStart(2)} 通过 / ${s.fail} 失败` +
      `  页面错误 ${s.pageErrors}  ${(s.ms / 1000).toFixed(1)}s` +
      (s.failedNames.length ? `  失败项: ${s.failedNames.join(", ")}` : "")
  );
}
console.log(`共 ${summary.length} 个工具，${hardFail} 个未通过。`);
process.exit(hardFail ? 1 : 0);
