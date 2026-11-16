# -*- coding: utf-8 -*-
"""前端设置页"用自己的 Key"链路：X-Provider-Key 头 → context 变量 → 按 Key 缓存生成器"""
from fastapi.testclient import TestClient

from dependencies import get_harness, get_image_generator, get_tts_generator
from provider_key import current_provider_key, set_provider_key
from server import app


@app.get("/__provider_key_probe")
def _probe():
    return {"key": current_provider_key()}


def test_provider_key_header_reaches_context():
    client = TestClient(app)
    r = client.get("/__provider_key_probe", headers={"X-Provider-Key": "sk-test-123"})
    assert r.status_code == 200
    assert r.json()["key"] == "sk-test-123"
    r = client.get("/__provider_key_probe")
    assert r.json()["key"] == ""


def test_generators_cached_per_key():
    set_provider_key("")
    g_env = get_image_generator()
    set_provider_key("sk-user-a")
    g_a = get_image_generator()
    t_a = get_tts_generator()
    set_provider_key("sk-user-b")
    g_b = get_image_generator()
    set_provider_key("sk-user-a")
    assert get_image_generator() is g_a
    assert g_a is not g_b and g_a is not g_env
    assert g_a.api_key == "sk-user-a" and t_a.api_key == "sk-user-a"
    assert g_b.api_key == "sk-user-b"
    assert g_env.api_key not in ("sk-user-a", "sk-user-b")
    set_provider_key("")


def test_harness_cached_per_key():
    try:
        set_provider_key("")
        h_env = get_harness()
        set_provider_key("sk-user-a")
        h_a = get_harness()
        set_provider_key("sk-user-b")
        h_b = get_harness()
        set_provider_key("sk-user-a")
        assert get_harness() is h_a
        assert h_a is not h_b and h_a is not h_env
        assert h_a.sut.llm.client.api_key == "sk-user-a"
        assert h_b.sut.llm.client.api_key == "sk-user-b"
    finally:
        set_provider_key("")
