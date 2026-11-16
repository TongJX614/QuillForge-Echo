# -*- coding: utf-8 -*-
"""harness 测试的路径准备。

harness 里的 ECHO 模块用包内相对导入，同时又要扁平导入引擎模块
（llm_client / dependencies / logger 等），因此这里把仓库根与引擎 src
一并加入 sys.path。
"""

from __future__ import annotations

import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = TESTS_DIR.parent
HARNESS_DIR = PROJECT_DIR.parent.parent
REPO_ROOT = HARNESS_DIR.parent
ENGINE_SRC = REPO_ROOT / "engine" / "quillforge" / "src"
ENGINE_TESTS = REPO_ROOT / "engine" / "quillforge" / "tests"

for path in (str(REPO_ROOT), str(ENGINE_SRC), str(ENGINE_TESTS)):
    if path not in sys.path:
        sys.path.insert(0, path)
