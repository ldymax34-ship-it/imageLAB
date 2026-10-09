/**
 * 极简静态服务器：只服务一个目录，绑定 127.0.0.1，用于本地运行构建产物。
 * 用法：node scripts/serve.mjs [--root dist] [--port 4890] [--open]
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(`--${name}`);

const root = resolve(process.cwd(), getArg("root", "dist"));
const port = Number(getArg("port", "4890"));
const host = getArg("host", "127.0.0.1");

if (!existsSync(root)) {
  console.error(`[serve] 目录不存在: ${root}\n先运行 npm run build。`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream"
};

/**
 * 解析请求路径并拼到 root 下。
 * 返回 { path } / { forbidden } / { malformed }：
 *   - 非法百分号转义（decodeURIComponent 抛错）→ malformed，交给调用方回 400；
 *   - 越出 root → forbidden；
 *   - 其余 → path。
 * 这样任何畸形 URL 都不会把本地服务器整个打崩。
 */
function safeJoin(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return { malformed: true };
  }
  const p = normalize(join(base, decoded));
  if (p !== base && !p.startsWith(base + sep)) return { forbidden: true };
  return { path: p };
}

const server = createServer((req, res) => {
  const target = safeJoin(root, req.url || "/");
  if (target.malformed) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("400 Bad Request");
    return;
  }
  if (target.forbidden) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden");
    return;
  }
  let filePath = target.path;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // 目录形式（/tools/texture/）已在上一步处理；其余真的找不到
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 Not Found");
    return;
  }
  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff"
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/`;
  console.log(`\n  图像实验室 imageLAB 正在运行：${url}\n  目录：${root}\n  按 Control-C 停止。\n`);
  if (hasFlag("open")) {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`[serve] 端口 ${port} 已被占用。用 --port 换一个，或关掉已运行的服务。`);
  } else {
    console.error("[serve]", e.message);
  }
  process.exit(1);
});
