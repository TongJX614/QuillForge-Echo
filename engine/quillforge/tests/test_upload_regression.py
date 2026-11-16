# -*- coding: utf-8 -*-
"""上传/示例剧本的旧调用形态回归：不带幂等头时仍能正常开局。"""

from __future__ import annotations

from pathlib import Path

import pytest

from dependencies import sessions, start_receipts, uploaded_scripts
from generic_adapter import GenericScriptAdapter
from routes.upload import start_game
from script_registry import registered_scripts
from test_script_registry import write_generated_package


@pytest.fixture(autouse=True)
def clear_runtime_stores() -> None:
    sessions.clear()
    start_receipts.clear()
    registered_scripts.clear()
    yield
    sessions.clear()
    start_receipts.clear()
    registered_scripts.clear()


def make_legacy_record(tmp_path: Path, script_id: str = "legacy-upload") -> object:
    root = tmp_path / "legacy"
    script_dir = write_generated_package(root)
    adapter = GenericScriptAdapter()
    adapter.load(str(script_dir))
    uploaded_scripts[script_id] = {
        "path": str(script_dir),
        "adapter": adapter,
        "summary": adapter.to_summary(),
    }
    return adapter


def test_no_header_legacy_upload_folder_and_sample_shape_still_starts(
    tmp_path: Path,
) -> None:
    make_legacy_record(tmp_path)
    first = start_game(script_id="legacy-upload", idempotency_key=None)
    second = start_game(script_id="legacy-upload", idempotency_key=None)
    assert first["session_id"] != second["session_id"]
    assert len(sessions) == 2
    assert start_receipts == {}
