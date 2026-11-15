#!/bin/sh
# 只启动引擎，不接入任何项目。用于验证 engine/ 能独立运行。
#
#   sh scripts/engine.sh
#
# 首页在 http://127.0.0.1:8050/ ，API 文档在 /docs 。

COMMON_SH_PATH="$0"
. "$(dirname "$0")/_common.sh"

load_root_env
apply_defaults

PYTHON=$(pick_python)
# 显式清空，确保引擎以「无项目」形态启动
QUILLFORGE_PROJECTS=
export QUILLFORGE_PROJECTS
export PYTHONPATH="$ROOT/engine/quillforge/src"

HOST="${SERVER_HOST:-127.0.0.1}"
PORT="${SERVER_PORT:-8050}"

echo "引擎独立模式"
echo "  python   : $PYTHON"
echo "  首页     : http://$HOST:$PORT/"
echo "  API 文档 : http://$HOST:$PORT/docs"
echo "  运行目录 : $QUILLFORGE_VAR_DIR"
echo

cd "$ROOT/engine/quillforge"
exec "$PYTHON" src/server.py --host "$HOST" --port "$PORT"
