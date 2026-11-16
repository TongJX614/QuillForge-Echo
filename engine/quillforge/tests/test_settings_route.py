# -*- coding: utf-8 -*-
"""设置页回读接口：确认后端读到前端 Key，且任何情况下都不回传明文"""
from fastapi.testclient import TestClient

from server import app


def test_provider_key_status_reports_browser_key_masked():
    client = TestClient(app)
    r = client.get("/api/settings/provider-key", headers={"X-Provider-Key": "sk-user-1234567890abcd"})
    assert r.status_code == 200
    body = r.json()
    assert body["effective"] == "browser"
    assert body["browser_key"]["present"] is True
    masked = body["browser_key"]["masked"]
    assert masked.startswith("sk-use") and masked.endswith("abcd")
    assert "sk-user-1234567890abcd" not in r.text
    assert set(body["models"]) == {"text", "image", "tts"}
    assert isinstance(body["models"]["text"]["fallbacks"], list)


def test_provider_key_status_env_fallback_without_header():
    client = TestClient(app)
    r = client.get("/api/settings/provider-key")
    assert r.status_code == 200
    body = r.json()
    assert body["effective"] in ("env", "none")
    assert body["browser_key"]["present"] is False
    assert body["browser_key"]["masked"] == ""
    for key in body["env_keys"].values():
        assert "…" in key or not key
