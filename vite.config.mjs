import { defineConfig } from "vite";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = import.meta.dirname;

/**
 * 多页（MPA）入口自动发现：
 * 只把带 `<!-- imagelab:entry -->` 标记的 tools/<id>/index.html 交给 Vite 打包；
 * 其余 tools/<id>/ 是「原样搬运」的静态页面，由 scripts/copy-static.mjs 复制到 dist。
 */
function discoverEntries() {
  const entries = { home: resolve(root, "index.html") };
  const toolsDir = resolve(root, "tools");
  if (!existsSync(toolsDir)) return entries;
  for (const name of readdirSync(toolsDir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const file = join(toolsDir, name, "index.html");
    if (!existsSync(file)) continue;
    if (!readFileSync(file, "utf8").includes("imagelab:entry")) continue;
    entries[`tools-${name}`] = file;
  }
  return entries;
}

export default defineConfig({
  root,
  base: "./",
  publicDir: resolve(root, "public"),
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    open: false
  },
  preview: {
    host: "127.0.0.1",
    port: 4890,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    assetsDir: "build",
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: discoverEntries(),
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/@paper-design")) return "paper-shaders";
          if (id.includes("node_modules/@visant")) return "extrude3d";
          return undefined;
        }
      }
    }
  }
});
