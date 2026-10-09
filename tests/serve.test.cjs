/**
 * 本地静态服务器 scripts/serve.mjs 的纯 Node 自检（不启动浏览器）。
 *
 * 回归：畸形百分号转义的 URL 曾让 decodeURIComponent 抛错并杀掉整个服务器。
 * 现在必须先回 400，然后服务器仍能继续正常服务后续请求。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const net = require("node:net");

const ROOT = resolve(__dirname, "..");
const SERVE = join(ROOT, "scripts", "serve.mjs");

function freePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

function waitForServer(child, timeoutMs = 15000) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("服务器未在超时内启动")), timeoutMs);
    let out = "";
    const onData = (chunk) => {
      out += String(chunk);
      if (out.includes("正在运行")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        res();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      rej(new Error(`服务器提前退出，退出码 ${code}`));
    });
  });
}

test("畸形 URL 回 400，且服务器继续服务有效页面", async () => {
  const dir = mkdtempSync(join(tmpdir(), "imagelab-serve-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>ok</title><p>hello-imagelab</p>");
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [SERVE, "--root", dir, "--port", String(port), "--host", "127.0.0.1"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
  );

  try {
    await waitForServer(child);

    const bad = await fetch(`http://127.0.0.1:${port}/%E0%A4%A`);
    assert.equal(bad.status, 400, "畸形 URL 必须回 400 而不是把服务器打崩");

    const good = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(good.status, 200, "畸形请求之后服务器仍正常服务");
    assert.match(await good.text(), /hello-imagelab/);
    assert.equal(child.exitCode, null, "服务器进程必须仍然存活");
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
