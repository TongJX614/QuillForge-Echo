#!/bin/sh
# 公共环境准备。被 engine.sh / fusion.sh  sourced，不单独执行。
#
# 引擎的 config_manager 只从 engine/.env 与 engine/quillforge/.env 读取配置，
# 而融合部署的配置集中在仓库根 .env，所以这里把根 .env 导出到环境变量——
# 环境变量优先级高于 .env 文件，引擎无需为此改动一行代码。

set -eu

# 仓库根（本文件位于 <root>/scripts/）
ROOT=$(CDPATH= cd -- "$(dirname -- "${COMMON_SH_PATH:-$0}")/.." && pwd)

load_root_env() {
  if [ -f "$ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/.env"
    set +a
  else
    echo "[warn] 未找到 $ROOT/.env，将只用默认值与环境变量运行" >&2
    echo "[warn] 可先执行: cp .env.example .env 并填入 API Key" >&2
  fi
}

pick_python() {
  if [ -x "$ROOT/.venv/bin/python" ]; then
    echo "$ROOT/.venv/bin/python"
  elif command -v python3.11 >/dev/null 2>&1; then
    echo python3.11
  else
    echo python3
  fi
}

# 必须在 load_root_env 之后调用：根 .env 里的空值不应盖掉这里的默认值
apply_defaults() {
  # 运行期可写目录（上传、生成图片、生成音频）统一落在仓库根 var/，
  # 避免写进 engine/ 与 projects/
  if [ -z "${QUILLFORGE_VAR_DIR:-}" ]; then
    QUILLFORGE_VAR_DIR="$ROOT/var"
  fi
  export QUILLFORGE_VAR_DIR
  export PYTHONUTF8=1
}
