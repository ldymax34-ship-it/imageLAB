#!/bin/zsh
# 图像实验室 imageLAB · macOS 一键启动
# 首次运行会自动安装依赖并构建，然后在本机 127.0.0.1 上打开浏览器。
set -eu

cd -- "${0:A:h}"

PORT="${IMAGELAB_PORT:-4890}"
IFS=' ' read -r NODE_BIN NPM_BIN <<< "$(command -v node) $(command -v npm)"

if [ -z "${NODE_BIN:-}" ] || [ -z "${NPM_BIN:-}" ]; then
  echo "找不到 node / npm。请先安装 Node.js 20 或更高版本（https://nodejs.org）。"
  read -r "?按回车键关闭…"
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "当前 Node 版本为 $("$NODE_BIN" -v)，需要 20 或更高版本。"
  read -r "?按回车键关闭…"
  exit 1
fi

# npm 缓存放进项目内，避免写到用户目录被系统策略拦截
export npm_config_cache="$PWD/.tmp/npm-cache"
mkdir -p "$PWD/.tmp"

echo ""
echo "  图像实验室 imageLAB"
echo "  ────────────────────────────────"

if [ ! -d node_modules ]; then
  echo "  首次运行：安装依赖…"
  "$NPM_BIN" install --no-audit --no-fund
fi

if [ ! -f dist/index.html ]; then
  echo "  构建静态产物…"
  "$NPM_BIN" run build
fi

echo "  启动本地服务器（绑定 127.0.0.1）…"
exec "$NODE_BIN" scripts/serve.mjs --root dist --port "$PORT" --open
