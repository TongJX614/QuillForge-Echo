#!/bin/sh
# 一键跑全部测试套件。
#
#   sh scripts/test-all.sh
#
# 依赖：仓库根 .venv（引擎依赖 + pytest）、node 24。
# ECHO 的 app 级测试需要 projects/echo/apps/echo/node_modules（含 tsx），
# 缺失时该段报 SKIP 而不是假装通过。

COMMON_SH_PATH="$0"
. "$(dirname "$0")/_common.sh"

PYTHON=$(pick_python)
if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x "$HOME/.local/node24/bin/node" ]; then
  NODE="$HOME/.local/node24/bin/node"
else
  NODE=""
fi

FAIL=0
section() { printf '\n════════ %s ════════\n' "$1"; }

section "1/5 引擎 pytest（engine/quillforge/tests）"
(cd "$ROOT/engine" && "$PYTHON" -m pytest quillforge/tests -q -m "not live" 2>&1 | tail -3) || FAIL=1

section "2/5 接入层 pytest（harness/projects/echo/tests）"
if [ -n "$PYTHON" ]; then
  (cd "$ROOT" && "$PYTHON" -m pytest harness/projects/echo/tests -q 2>&1 | tail -3) || FAIL=1
else
  echo "  SKIP 未找到 python"
fi

section "3/5 接入层 JS 测试（harness/projects/echo/tests_js）"
if [ -n "$NODE" ]; then
  (cd "$ROOT" && "$NODE" --test harness/projects/echo/tests_js/*.cjs 2>&1 | grep -E "^ℹ (tests|pass|fail)") || FAIL=1
else
  echo "  SKIP 未找到 node"
fi

section "4/5 ECHO 仓库级测试（projects/echo/tests）"
if [ -n "$NODE" ]; then
  (cd "$ROOT/projects/echo" && "$NODE" --test tests/*.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ ") || FAIL=1
else
  echo "  SKIP 未找到 node"
fi

section "5/5 ECHO app 级测试（projects/echo/apps/echo/scripts）"
if [ -z "$NODE" ]; then
  echo "  SKIP 未找到 node"
elif [ ! -d "$ROOT/projects/echo/apps/echo/node_modules" ]; then
  echo "  SKIP 未安装依赖：cd projects/echo && pnpm install"
else
  (
    cd "$ROOT/projects/echo/apps/echo" || exit 1
    pass=0; fail=0
    for t in scripts/test-*.ts; do
      if "$NODE" --import tsx "$t" >/dev/null 2>&1; then
        pass=$((pass + 1))
      else
        fail=$((fail + 1)); echo "  FAIL $t"
      fi
    done
    echo "  通过 $pass / 失败 $fail"
    [ "$fail" -eq 0 ] || exit 1
  ) || FAIL=1
fi

printf '\n════════ 跨模块集成冒烟 ════════\n'
if [ -n "$NODE" ]; then
  (cd "$ROOT" && "$NODE" scripts/integration-smoke.mjs 2>&1 | tail -6) || FAIL=1
  rm -rf "$ROOT/var-smoke"
else
  echo "  SKIP 未找到 node"
fi

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  echo "TEST_ALL=PASS"
else
  echo "TEST_ALL=FAIL"
fi
exit "$FAIL"
