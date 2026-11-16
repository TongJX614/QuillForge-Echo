# -*- coding: utf-8 -*-
"""debate / minigame 路由从注册表映射里取 adapter 的兼容性回归。

uploaded_scripts 现在是 script_registry.registered_scripts 的别名，值仍是
{path, adapter, summary, status} 这种映射形态；两个路由必须照旧从中取出
同一个 adapter 实例交给生成器，不能因为换了存储实现而拿到副本或 None。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from dependencies import sessions, start_receipts, uploaded_scripts
from generic_adapter import GenericScriptAdapter
from script_registry import registered_scripts
from test_script_registry import write_generated_package

import harness.projects.echo.routes.debate as debate_route
import harness.projects.echo.routes.minigame as minigame_route


@pytest.fixture(autouse=True)
def clear_runtime_stores():
    sessions.clear()
    start_receipts.clear()
    registered_scripts.clear()
    yield
    sessions.clear()
    start_receipts.clear()
    registered_scripts.clear()


def make_legacy_record(tmp_path: Path, script_id: str) -> GenericScriptAdapter:
    script_dir = write_generated_package(tmp_path / "legacy")
    adapter = GenericScriptAdapter()
    adapter.load(str(script_dir))
    uploaded_scripts[script_id] = {
        "path": str(script_dir),
        "adapter": adapter,
        "summary": adapter.to_summary(),
        "status": "ready",
    }
    return adapter


def test_debate_and_minigame_routes_read_adapter_from_compatible_mapping(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = make_legacy_record(tmp_path, "legacy-tools")
    monkeypatch.setattr(
        debate_route,
        "generate_debate",
        lambda candidate: {"same_adapter": candidate is adapter},
    )
    monkeypatch.setattr(
        minigame_route,
        "generate_minigame",
        lambda candidate, kind: {"same_adapter": candidate is adapter, "kind": kind},
    )

    debate = debate_route.api_generate_debate("legacy-tools")
    minigame = minigame_route.api_generate_minigame("legacy-tools", "clue")

    assert debate == {"success": True, "data": {"same_adapter": True}}
    assert minigame == {
        "success": True,
        "data": {"same_adapter": True, "kind": "clue"},
    }
