#!/bin/sh
# 只启动 ECHO 游戏本体，不启动引擎。用于验证 projects/echo 能独立运行。
#
#   sh scripts/echo.sh
#
# ECHO 独立开发默认监听 5000（融合模式下由 harness 注入 5173，两者不同）。
# 未提供 NARRATIVE_ENGINE_HOST/PORT 时，世界编织入口会提示引擎未接入，
# 手工制作的索尔维 1927 路线照常可玩。
#
# 若要让独立跑的 ECHO 连上一个已在别处运行的引擎：
#   NARRATIVE_ENGINE_HOST=127.0.0.1 NARRATIVE_ENGINE_PORT=8050 sh scripts/echo.sh

COMMON_SH_PATH="$0"
. "$(dirname "$0")/_common.sh"

ECHO_DIR="${ECHO_HOME:-projects/echo}"
case "$ECHO_DIR" in
  /*) ECHO_ABS="$ECHO_DIR" ;;
  *)  ECHO_ABS="$ROOT/$ECHO_DIR" ;;
esac

if [ ! -f "$ECHO_ABS/package.json" ]; then
  echo "[error] 找不到 ECHO: $ECHO_ABS" >&2
  exit 1
fi

cd "$ECHO_ABS"

if [ ! -f .env ]; then
  echo "[warn] 未找到 $ECHO_ABS/.env，先复制模板：" >&2
  echo "[warn]   cp .env.example .env" >&2
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[error] 未找到 pnpm。请先安装（corepack enable 或 npm i -g pnpm）。" >&2
  exit 1
fi

echo "ECHO 独立模式"
echo "  目录 : $ECHO_ABS"
echo "  地址 : http://${ECHO_HOST:-127.0.0.1}:${ECHO_PORT:-5000}/"
if [ -n "${NARRATIVE_ENGINE_HOST:-}" ] && [ -n "${NARRATIVE_ENGINE_PORT:-}" ]; then
  echo "  引擎 : http://$NARRATIVE_ENGINE_HOST:$NARRATIVE_ENGINE_PORT/"
else
  echo "  引擎 : 未接入（世界编织入口将提示不可用）"
fi
echo

exec pnpm dev
