#!/bin/sh
# 融合模式：引擎驱动 ECHO。
#
#   sh scripts/fusion.sh
#
# 引擎起来后由 harness 的 echo_launcher 在后台拉起 ECHO，并把引擎地址通过
# NARRATIVE_ENGINE_URL / NARRATIVE_ENGINE_HOST / NARRATIVE_ENGINE_PORT 注入给它。
# ECHO 自己不知道引擎在哪，也不写死任何路径。
#
#   引擎     http://127.0.0.1:8050/
#   ECHO     http://127.0.0.1:5173/   （被占用时自动顺延）
#   引擎状态 http://127.0.0.1:8050/api/echo/status

COMMON_SH_PATH="$0"
. "$(dirname "$0")/_common.sh"

load_root_env
apply_defaults

PYTHON=$(pick_python)
QUILLFORGE_PROJECTS="${QUILLFORGE_PROJECTS:-harness.projects.echo}"
export QUILLFORGE_PROJECTS
# 仓库根也要进 PYTHONPATH，harness.projects.echo 才可导入
export PYTHONPATH="$ROOT/engine/quillforge/src:$ROOT"

HOST="${SERVER_HOST:-127.0.0.1}"
PORT="${SERVER_PORT:-8050}"
ECHO_DIR="${ECHO_HOME:-projects/echo}"
case "$ECHO_DIR" in
  /*) ECHO_ABS="$ECHO_DIR" ;;
  *)  ECHO_ABS="$ROOT/$ECHO_DIR" ;;
esac

echo "融合模式"
echo "  python   : $PYTHON"
echo "  项目模块 : $QUILLFORGE_PROJECTS"
echo "  引擎     : http://$HOST:$PORT/"
echo "  ECHO 目录: $ECHO_ABS"
echo "  运行目录 : $QUILLFORGE_VAR_DIR"

if [ ! -d "$ECHO_ABS/apps/echo/node_modules" ]; then
  echo
  echo "[warn] ECHO 依赖尚未安装，引擎能起但 ECHO 拉不起来。" >&2
  echo "[warn] 先执行: cd $ECHO_DIR && pnpm install" >&2
fi

echo

cd "$ROOT/engine/quillforge"
exec "$PYTHON" src/server.py --host "$HOST" --port "$PORT"
