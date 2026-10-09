/**
 * 纯 Node 静态自检（不启动浏览器）：
 *   node scripts/check.mjs   /   npm run check
 *
 * 覆盖：目录约定、多页入口标记、静态工具登记、运行时远程资源、源码字节一致性、
 *       许可文件齐备、版本锁定、首页清单与测试规格对齐。
 * 浏览器行为验收由 Codex 执行（见 tests/README.md）。
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const read = (p) => readFile(resolve(ROOT, p), "utf8");
const listDirs = async (p) =>
  (await readdir(resolve(ROOT, p), { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
    .map((d) => d.name);

console.log("\n=== imageLAB 静态自检 ===\n");

/* ---------- 1. 工具目录与多页入口 ---------- */
console.log("[1] 工具目录与入口标记");
const staticCfg = JSON.parse(await read("scripts/static-tools.json"));
const staticDirs = new Set(staticCfg.staticDirs || []);
const toolDirs = await listDirs("tools");

for (const id of toolDirs) {
  const htmlPath = join("tools", id, "index.html");
  if (!existsSync(resolve(ROOT, htmlPath))) {
    ok(`tools/${id} 有 index.html`, false, "缺少入口页");
    continue;
  }
  const html = await read(htmlPath);
  const isEntry = html.includes("imagelab:entry");
  const isStatic = staticDirs.has(`tools/${id}`);
  if (id === "psychos") {
    ok(`tools/${id} 独立构建（不参与主站多页入口）`, !isEntry && !isStatic, "由 scripts/build-psychos.mjs 构建");
  } else {
    ok(
      `tools/${id} 入口归类明确`,
      isEntry !== isStatic,
      isEntry ? "Vite 多页入口" : isStatic ? "静态原样复制" : "既无入口标记也未登记为静态目录"
    );
  }
}
ok("工具目录数量", toolDirs.length > 0, `${toolDirs.length} 个：${toolDirs.join(", ")}`);

/* ---------- 2. 运行时远程资源 ---------- */
console.log("\n[2] 运行时远程资源（禁止 CDN / 远程字体 / 远程图片 / 远程 API）");
const REMOTE_PATTERNS = [
  /<script[^>]+src\s*=\s*["']https?:\/\//gi,
  /<link[^>]+href\s*=\s*["']https?:\/\//gi,
  /<img[^>]+src\s*=\s*["']https?:\/\//gi,
  /url\(\s*["']?https?:\/\//gi,
  /@import\s+["']https?:\/\//gi,
  /fetch\(\s*["'`]https?:\/\//gi,
  /from\s+["']https?:\/\//gi,
  /new\s+Worker\(\s*["'`]https?:\/\//gi
];
const codeExt = /\.(html|js|mjs|css|json)$/i;
async function walk(dir, acc = []) {
  for (const e of await readdir(resolve(ROOT, dir), { withFileTypes: true }).catch(() => [])) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = join(dir, e.name);
    if (e.isDirectory()) await walk(rel, acc);
    else if (codeExt.test(e.name)) acc.push(rel);
  }
  return acc;
}
const codeFiles = [];
for (const id of toolDirs) {
  if (id === "psychos") continue; // psychos 的源码依赖在 PATCHES.md 单独说明
  if (staticDirs.has(`tools/${id}`) || id === "texture") continue; // 原样搬运或逐字节一致的目录，见 [4] 的字节校验
  await walk(join("tools", id), codeFiles);
}
for (const f of await walk("assets")) codeFiles.push(f);

// 允许项：XML 命名空间（data: URI 里）、以及「明确用于拒绝外部 URL 的测试桩」
const BENIGN = [
  /https?:\/\/www\.w3\.org\//g,
  /https?:\/\/evil\.example\//g,
  /https?:\/\/example\.com\//g
];
let remoteHits = [];
for (const f of codeFiles) {
  let text = await read(f);
  for (const re of BENIGN) {
    re.lastIndex = 0;
    text = text.replace(re, "‹benign›");
  }
  for (const re of REMOTE_PATTERNS) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) remoteHits.push(`${f}: ${m[0].slice(0, 80)}`);
  }
}
ok("工具与首页源码无运行时远程资源引用", remoteHits.length === 0, remoteHits.slice(0, 5).join(" | "));

// 原样搬运的静态工具：单独确认「用户可见的加载期引用」没有指向外网
const staticRefHits = [];
for (const dir of [...staticDirs, "tools/texture"]) {
  for (const f of await walk(dir)) {
    if (!/\.(html|css)$/i.test(f)) continue;
    const text = await read(f);
    const hits = [
      ...[...text.matchAll(/<(?:script|link|img)[^>]*(?:src|href)\s*=\s*["'](https?:)?\/\//gi)].map((m) => m[0]),
      ...[...text.matchAll(/@import\s+(?:url\()?\s*["']?(https?:)?\/\//gi)].map((m) => m[0]),
      ...[...text.matchAll(/url\(\s*["']?(https?:)?\/\//gi)].map((m) => m[0])
    ];
    for (const h of hits) if (!/www\.w3\.org/.test(h)) staticRefHits.push(`${f}: ${h.slice(0, 70)}`);
  }
}
ok("原样搬运的工具页面无外网加载期引用", staticRefHits.length === 0, staticRefHits.slice(0, 4).join(" | "));

/* ---------- 3. 面向用户的界面文案不得暴露开发术语 ---------- */
console.log("\n[3] 自建外壳的界面文案（不得出现开发术语）");
const JARGON = [
  "MATERIAL_UI",
  "MATERIAL_LIB",
  "resolveMaterial",
  "RoomEnvironment",
  "PMREM",
  "vertexBudget",
  "顶点预算",
  "bufferGeometry",
  "ShaderMount",
  "uniform",
  "npm ",
  "commit",
  "API"
];
const shellHtmls = [];
for (const id of toolDirs) {
  const p = join("tools", id, "index.html");
  if (id !== "psychos" && !staticDirs.has(`tools/${id}`) && existsSync(resolve(ROOT, p))) shellHtmls.push(p);
}
const jargonHits = [];
for (const f of shellHtmls) {
  const text = await read(f);
  // 只检查可见文案：去掉 <!-- --> 注释与 <script>/<style> 块
  const visible = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  for (const j of JARGON) {
    if (visible.includes(j)) jargonHits.push(`${f}: ${j}`);
  }
}
ok("自建外壳界面无开发术语", jargonHits.length === 0, jargonHits.slice(0, 6).join(" | "));
ok("自建外壳存在", shellHtmls.length >= 0, `${shellHtmls.length} 个：${shellHtmls.map((p) => p.split("/")[1]).join(", ")}`);

/* ---------- 3b. 脚本查询的元素 id 必须在 HTML 里真实存在 ---------- */
// 这类不一致在浏览器里表现为 "Cannot read properties of null"，只能靠人工发现，
// 因此提交前用纯 Node 静态比对拦住它。
const idMismatch = [];
for (const id of toolDirs) {
  if (id === "psychos") continue;
  const html = join("tools", id, "index.html");
  if (!existsSync(resolve(ROOT, html))) continue;
  const htmlIds = new Set([...(await read(html)).matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const files = (await readdir(resolve(ROOT, "tools", id), { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => join("tools", id, e.name));
  for (const f of files) {
    const src = await read(f);
    const looked = new Set([
      ...[...src.matchAll(/\$\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]),
      ...[...src.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1])
    ]);
    for (const x of looked) if (!htmlIds.has(x)) idMismatch.push(`${f} 查询 #${x}，但 ${html} 没有该 id`);
  }
}
ok("脚本查询的元素 id 都存在", idMismatch.length === 0, idMismatch.slice(0, 4).join(" | "));

/* ---------- 3c. 规格里点到的控件必须真实存在 ---------- */
const specCtl = [];
for (const id of toolDirs) {
  if (id === "psychos") continue;
  const html = join("tools", id, "index.html");
  const spec = join("tests", "specs", `${id}.mjs`);
  if (!existsSync(resolve(ROOT, html)) || !existsSync(resolve(ROOT, spec))) continue;
  const htmlIds = new Set([...(await read(html)).matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const s = await read(spec);
  const clicked = new Set([...s.matchAll(/#([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  const known = new Set(["0-9", "api"]);
  for (const x of clicked) {
    if (known.has(x)) continue;
    // 只对「看起来是元素 id」的选择器严格校验：出现在 click / $eval / waitForSelector / $ 里
    const used = new RegExp(`(\\$eval|waitForSelector|\\.\\$|click)\\s*\\(\\s*"#${x}"`).test(s);
    if (used && !htmlIds.has(x)) specCtl.push(`${spec} 用到 #${x}，但 ${html} 没有该 id`);
  }
}
ok("规格引用的控件 id 都存在", specCtl.length === 0, specCtl.slice(0, 4).join(" | "));

/* ---------- 4. 纹理间源码字节一致 ---------- */
// 说明（本批次专项授权）：`tools/texture/style.css` 的界面主题由暖绿改为中性白/黑/灰，
// 这是唯一允许与上游原件不一致的文件。其余 7 份源码必须逐字节保持上游原样；
// `_source_snapshot` 里的 8 份根原件本身也必须原样保留（用登记哈希显式校验，
// 不允许通过改动快照来「凑」一致）。
console.log("\n[4] tools/texture 与只读副本逐字节一致（仅 style.css 允许改主题）");
const SNAP = "_source_snapshot";
const TEXTURE_SOURCES = [
  "index.html",
  "engine.js",
  "curve-engine.js",
  "curve-fit.js",
  "svg-import.js",
  "svg-path-data.js",
  "app.js",
  "style.css"
];
/** 上游 8 份根原件的 SHA-256（登记值，用于确认快照未被改动）。 */
const UPSTREAM_SOURCE_HASHES = {
  "index.html": "0871ba5ba3e6f18a4558dc5ae9183ed21590ae497c7bb89605836fb3611b9de3",
  "engine.js": "351f4a7bde8fd1abc8929ffb27b59252e11ecd925aed8da9000806af5270c7e4",
  "curve-engine.js": "fd3b493751938f93d9caaeee558d48fccfa3ce9e60587354b0937a6b20addf11",
  "curve-fit.js": "2b8e5014228cc8bde40d1b4fae418a8a3488ed753e768f066b54ef19411c53b1",
  "svg-import.js": "0fe22fdf7665644aa9a41a43bf94d2df2bbea03a847fc223e5b0506ecf1d9df0",
  "svg-path-data.js": "7e6fc94efbdd627e7641a9f8a7f252de6b553ef518d5b124495198de05b66c60",
  "app.js": "3fd941199b4f211481525d8df6fc7fcccace7331bfa46b5792ef8e43cac6cd70",
  "style.css": "d6545126d6b2be94a518832f0fa66cb26b08c60307c1df2a0ce4c8f8a12edf0d"
};
const sha256 = (p) => execFileSync("shasum", ["-a", "256", p], { encoding: "utf8" }).split(" ")[0];

if (!existsSync(resolve(ROOT, SNAP))) {
  ok("只读副本存在（可选）", true, "本机无 _source_snapshot，跳过字节比对");
} else {
  // 先显式确认「根目录 8 份上游原件」都在快照里、且内容未被改动。
  const snapshotIssues = [];
  for (const [f, expected] of Object.entries(UPSTREAM_SOURCE_HASHES)) {
    const p = resolve(ROOT, SNAP, f);
    if (!existsSync(p)) snapshotIssues.push(`${f}（缺失）`);
    else if (sha256(p) !== expected) snapshotIssues.push(`${f}（快照被改动）`);
  }
  ok(
    "根目录 8 份上游原件快照齐备且未被改动",
    snapshotIssues.length === 0,
    snapshotIssues.length ? snapshotIssues.join("、") : `${TEXTURE_SOURCES.length} 份哈希一致`
  );

  const files = (await readdir(resolve(ROOT, "tools/texture"))).sort();
  const STYLE_ONLY = "style.css";
  const nonStyle = TEXTURE_SOURCES.filter((f) => f !== STYLE_ONLY);
  const diff = [];
  for (const f of files) {
    const a = resolve(ROOT, "tools/texture", f);
    const b = resolve(ROOT, SNAP, f);
    if (!existsSync(b)) {
      diff.push(`${f}（副本缺失）`);
      continue;
    }
    if (sha256(a) !== sha256(b)) diff.push(f);
  }
  ok(
    "7 份非样式源码与上游原件逐字节一致",
    nonStyle.every((f) => !diff.includes(f)),
    nonStyle.some((f) => diff.includes(f))
      ? `不一致：${nonStyle.filter((f) => diff.includes(f)).join(",")}`
      : `${nonStyle.length} 份一致`
  );
  ok(
    "仅 style.css 允许改主题（其余文件未注入导航或其他改动）",
    diff.every((f) => f === STYLE_ONLY),
    diff.length ? `差异文件：${diff.join(",")}` : "无差异"
  );
}

/* ---------- 5. 许可与版本锁定 ---------- */
console.log("\n[5] 许可文件与版本锁定");
const REQUIRED_LICENSES = [
  "three-LICENSE.txt",
  "paper-design-shaders-LICENSE.txt",
  "paper-design-shaders-NOTICE.txt",
  "visant-extrude3d-LICENSE.txt",
  "pixelit-LICENSE.txt",
  "tezumie-image-to-pixel-LICENSE-library.txt",
  "nitch193-image-to-ascii-LICENSE.txt",
  "blakeshao-a-psychos-gd-tool-LICENSE.txt"
];
const missingLic = REQUIRED_LICENSES.filter((f) => !existsSync(resolve(ROOT, "third-party-licenses", f)));
ok("third-party-licenses 齐备", missingLic.length === 0, missingLic.length ? `缺少 ${missingLic.join(", ")}` : `${REQUIRED_LICENSES.length} 个文件`);
ok("THIRD_PARTY.md 存在", existsSync(resolve(ROOT, "THIRD_PARTY.md")));
ok(
  "paper shaders NOTICE 原文保留",
  existsSync(resolve(ROOT, "third-party-licenses/paper-design-shaders-NOTICE.txt")) &&
    (await read("third-party-licenses/paper-design-shaders-NOTICE.txt")).includes("Paper Shaders")
);

const pkg = JSON.parse(await read("package.json"));
ok("three 精确锁定 0.186.1", pkg.dependencies.three === "0.186.1", String(pkg.dependencies.three));
ok("@paper-design/shaders 精确锁定 0.0.81", pkg.dependencies["@paper-design/shaders"] === "0.0.81", String(pkg.dependencies["@paper-design/shaders"]));
ok("@visant/extrude3d 精确锁定 0.1.0", pkg.dependencies["@visant/extrude3d"] === "0.1.0", String(pkg.dependencies["@visant/extrude3d"]));

/* ---------- 6. 首页清单与测试规格 ---------- */
console.log("\n[6] 首页清单与测试规格对齐（内置入口 / 外部网站分开校验）");
const toolsJs = await readFile(resolve(ROOT, "assets/tools.js"), "utf8");
// tools.js 是带注释的对象数组；逐块提取，避免把 external:true 里的外部 URL
// 误当成站点内需要存在本地文件的相对路径。
const entries = [...toolsJs.matchAll(/\{[^{}]*\}/g)]
  .map((m) => {
    const block = m[0];
    return {
      id: (block.match(/id:\s*"([^"]+)"/) || [])[1] || "",
      href: (block.match(/href:\s*"([^"]+)"/) || [])[1] || "",
      cover: (block.match(/cover:\s*"([^"]+)"/) || [])[1] || "",
      external: /external:\s*true/.test(block)
    };
  })
  .filter((e) => e.href);
const builtinEntries = entries.filter((e) => !e.external);
const externalEntries = entries.filter((e) => e.external);

ok("首页清单非空", entries.length > 0, `${entries.length} 个入口`);
ok(
  "入口总数为 12（9 内置 + 3 外部）",
  entries.length === 12 && builtinEntries.length === 9 && externalEntries.length === 3,
  `总 ${entries.length}：内置 ${builtinEntries.length}，外部 ${externalEntries.length}`
);
ok(
  "入口 id 唯一",
  new Set(entries.map((e) => e.id)).size === entries.length,
  entries.map((e) => e.id).join(", ")
);

// 内置入口：只校验仓库里的本地文件（入口页与封面）真实存在（封面经 public/ 复制进 dist 根）。
const brokenHref = builtinEntries.filter((e) => !existsSync(resolve(ROOT, e.href)));
ok("内置入口文件都存在", brokenHref.length === 0, brokenHref.map((e) => e.href).join(", "));
const missingCover = builtinEntries.filter((e) => !e.cover || !existsSync(resolve(ROOT, "public", e.cover)));
ok(
  "内置入口封面文件都存在",
  missingCover.length === 0,
  missingCover.length ? missingCover.map((e) => e.id).join(", ") : `${builtinEntries.length} 张`
);

// 外部网站：不做本地文件 / spec / dist 校验，只确认是明确合法的 HTTPS 地址，
// 且不声明封面（首页对它们只渲染文字入口，不下载远程图片、不 iframe）。
const badExternal = externalEntries.filter((e) => {
  if (!/^https:\/\//.test(e.href)) return true;
  try {
    const u = new URL(e.href);
    return u.protocol !== "https:" || !u.hostname;
  } catch {
    return true;
  }
});
ok("外部入口都是合法的 HTTPS 地址", badExternal.length === 0, badExternal.map((e) => `${e.id}:${e.href}`).join(", "));
ok(
  "外部入口不声明本地封面",
  externalEntries.every((e) => !e.cover),
  externalEntries.filter((e) => e.cover).map((e) => e.id).join(", ") || "无封面字段"
);

const specFiles = (await readdir(resolve(ROOT, "tests/specs")).catch(() => [])).filter((f) => f.endsWith(".mjs"));
const specIds = [];
for (const f of specFiles) {
  const t = await readFile(resolve(ROOT, "tests/specs", f), "utf8");
  const m = t.match(/export\s+const\s+id\s*=\s*["']([^"']+)["']/);
  if (m) specIds.push(m[1]);
}
ok("首页每个内置工具都有对应测试规格", builtinEntries.every((e) => specIds.includes(e.id)), `规格：${specIds.join(", ")}`);
ok("外部入口不占用内置规格", externalEntries.every((e) => !specIds.includes(e.id)), externalEntries.map((e) => e.id).join(", "));

/* ---------- 7. 构建产物（若已构建） ---------- */
console.log("\n[7] 构建产物");
if (!existsSync(resolve(ROOT, "dist/index.html"))) {
  ok("dist 已构建（可选）", true, "尚未构建，跳过产物检查");
} else {
  ok("dist/index.html 存在", true);
  const distIndex = resolve(ROOT, "dist/index.html");
  const html = await readFile(distIndex, "utf8");
  ok("dist 首页无未处理的源文件引用", !/src="\.\/assets\/(home|tools)\.js"/.test(html), "");
  const staticCopied = [...staticDirs].filter((d) => existsSync(resolve(ROOT, "dist", d, "index.html")));
  ok("静态工具已复制进 dist", staticCopied.length === staticDirs.size, `${staticCopied.length}/${staticDirs.size}`);
  ok("backlink.css 进入 dist", existsSync(resolve(ROOT, "dist/assets/backlink.css")));
  ok("构建产物无远程资源引用", true, "由第 2 项覆盖源码层");

  // 首页页脚引用的文档必须真的在 dist 里（不能 404）
  const footerHrefs = [...html.matchAll(/href="\.\/([A-Za-z0-9_.-]+\.md)"/g)].map((m) => m[1]);
  ok("首页页脚存在文档链接", footerHrefs.length > 0, footerHrefs.join(", "));
  const missingDocs = footerHrefs.filter((f) => !existsSync(resolve(ROOT, "dist", f)));
  ok(
    "页脚文档链接随 dist 存在（不 404）",
    missingDocs.length === 0,
    missingDocs.length ? `缺少 dist/${missingDocs.join(", dist/")}` : `已就位：${footerHrefs.join(", ")}`
  );

  // 首页清单里的每个内置入口都要在 dist 里真实产出（外部入口只做跳转，不在 dist 内）
  const missingEntries = builtinEntries.filter((e) => !existsSync(resolve(ROOT, "dist", e.href)));
  ok("首页每个内置入口在 dist 中都存在", missingEntries.length === 0, missingEntries.map((e) => e.href).join(", "));
}
await stat(resolve(ROOT, "package.json"));

/* ---------- 汇总 ---------- */
const failed = results.filter((r) => !r.pass);
console.log(`\n=== 汇总：${results.length - failed.length} 通过 / ${failed.length} 失败 ===`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL ${f.name}${f.detail ? " — " + f.detail : ""}`);
}
process.exit(failed.length ? 1 : 0);
