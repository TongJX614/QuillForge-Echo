# -*- coding: utf-8 -*-
"""备选模型链：文本/流式自动切换、账号级错误不切换、生图失败原因回传"""
import base64
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

import image_gen
from llm_client import LLMClient, describe_llm_error
from image_gen import ImageGenerator


class _StatusError(Exception):
    def __init__(self, status_code: int, text: str = ""):
        super().__init__(text or f"HTTP {status_code}")
        self.status_code = status_code


def _reply(text: str):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


def _make_llm(monkeypatch, fallbacks=("backup-a", "backup-b")):
    client = LLMClient(
        model="primary",
        api_key="sk-test",
        api_base="http://127.0.0.1:1",
        fallback_models=list(fallbacks),
    )
    return client


def test_generate_switches_model_on_server_error(monkeypatch):
    client = _make_llm(monkeypatch)
    calls = []

    def fake_create(kwargs):
        calls.append(kwargs["model"])
        if kwargs["model"] == "primary":
            raise _StatusError(500)
        return _reply("来自备选模型的回答")

    monkeypatch.setattr(client, "_create_with_retry", fake_create)
    assert client.generate("sys", "user") == "来自备选模型的回答"
    assert calls == ["primary", "backup-a"]


def test_generate_does_not_switch_on_invalid_key(monkeypatch):
    client = _make_llm(monkeypatch)
    calls = []

    def fake_create(kwargs):
        calls.append(kwargs["model"])
        raise _StatusError(401)

    monkeypatch.setattr(client, "_create_with_retry", fake_create)
    with pytest.raises(_StatusError):
        client.generate("sys", "user")
    assert calls == ["primary"]


def test_explicit_model_disables_fallback(monkeypatch):
    client = _make_llm(monkeypatch)
    calls = []

    def fake_create(kwargs):
        calls.append(kwargs["model"])
        raise _StatusError(500)

    monkeypatch.setattr(client, "_create_with_retry", fake_create)
    with pytest.raises(_StatusError):
        client.generate("sys", "user", model="only-this")
    assert calls == ["only-this"]


def _stream_of(chunks, error=None):
    def gen():
        for c in chunks:
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=c))])
        if error is not None:
            raise error
    return gen()


def test_stream_switches_before_first_chunk(monkeypatch):
    client = _make_llm(monkeypatch)
    calls = []

    def fake_create(kwargs):
        calls.append(kwargs["model"])
        if kwargs["model"] == "primary":
            return _stream_of([], _StatusError(500))
        return _stream_of(["好", "的"])

    monkeypatch.setattr(client, "_create_with_retry", fake_create)
    assert "".join(client.generate_stream("sys", "user")) == "好的"
    assert calls == ["primary", "backup-a"]


def test_stream_stays_on_model_after_emitting(monkeypatch):
    client = _make_llm(monkeypatch)
    calls = []

    def fake_create(kwargs):
        calls.append(kwargs["model"])
        if kwargs["model"] == "primary":
            return _stream_of(["开头"], _StatusError(500))
        return _stream_of(["不该出现"])

    monkeypatch.setattr(client, "_create_with_retry", fake_create)
    out = []
    with pytest.raises(_StatusError):
        for chunk in client.generate_stream("sys", "user"):
            out.append(chunk)
    assert out == ["开头"]
    assert calls == ["primary"]


def test_stream_switches_on_empty_completion(monkeypatch):
    client = _make_llm(monkeypatch)
    calls = []

    def fake_create(kwargs):
        calls.append(kwargs["model"])
        if kwargs["model"] == "primary":
            return _stream_of([])
        return _stream_of(["备选内容"])

    monkeypatch.setattr(client, "_create_with_retry", fake_create)
    assert "".join(client.generate_stream("sys", "user")) == "备选内容"
    assert calls == ["primary", "backup-a"]


def test_describe_llm_error_is_readable():
    assert "API Key" in describe_llm_error(_StatusError(401))
    assert "余额" in describe_llm_error(_StatusError(402))
    assert "不存在" in describe_llm_error(_StatusError(404))


@pytest.fixture()
def img_env(tmp_path, monkeypatch):
    monkeypatch.setattr(image_gen, "IMAGES_DIR", tmp_path / "images")
    (tmp_path / "images").mkdir()
    gen = ImageGenerator(api_key="sk-test")
    gen.model = "primary-img"
    gen.fallback_models = ["backup-img"]
    gen._permanent_fail_until = 0.0
    gen._model_cooldown = {}
    return gen


def test_image_switches_to_fallback_and_clears_reason(img_env, monkeypatch):
    calls = []

    def fake(model, path, **kwargs):
        calls.append(model)
        if model == "primary-img":
            return _StatusError(404)
        path.write_bytes(b"fake-png")
        return None

    monkeypatch.setattr(img_env, "_generate_with_model", fake)
    url = img_env.generate("slug", "bg", "scene_1", "prompt", "768x768")
    assert url and url.startswith("/generated_images/slug/")
    assert calls == ["primary-img", "backup-img"]
    assert img_env.failure_reason("bg", "scene_1") == ""


def test_image_records_readable_reason_when_all_models_fail(img_env, monkeypatch):
    calls = []

    def fake(model, path, **kwargs):
        calls.append(model)
        return _StatusError(404 if model == "primary-img" else 500)

    monkeypatch.setattr(img_env, "_generate_with_model", fake)
    assert img_env.generate("slug", "bg", "scene_2", "prompt", "768x768") is None
    reason = img_env.failure_reason("bg", "scene_2")
    assert "primary-img" in reason and "不存在或未开通" in reason
    assert "backup-img" in reason
    assert calls == ["primary-img", "backup-img"]


def test_image_stops_chain_on_account_error(img_env, monkeypatch):
    calls = []

    def fake(model, path, **kwargs):
        calls.append(model)
        return _StatusError(401)

    monkeypatch.setattr(img_env, "_generate_with_model", fake)
    assert img_env.generate("slug", "char", "hero", "prompt", "768x768") is None
    assert calls == ["primary-img"]
    assert "API Key" in img_env.failure_reason("char", "hero")
    assert img_env._permanent_fail_until > 0


def test_image_no_key_records_reason(img_env):
    img_env.client = None
    assert img_env.generate("slug", "bg", "scene_3", "prompt", "768x768") is None
    assert "未配置生图 Key" in img_env.failure_reason("bg", "scene_3")


def test_image_dashscope_runs_up_to_configured_concurrency(tmp_path, monkeypatch):
    monkeypatch.setattr(image_gen, "IMAGES_DIR", tmp_path / "images")
    (tmp_path / "images").mkdir()
    monkeypatch.setattr(image_gen, "_img_inflight", threading.BoundedSemaphore(8))
    gen = ImageGenerator(api_key="sk-test")
    gen.model = "qwen-image-3.0"
    gen.fallback_models = []
    gen._dashscope_like = True

    active = 0
    peak = 0
    counter_lock = threading.Lock()

    class _Images:
        def generate(self, **kwargs):
            nonlocal active, peak
            with counter_lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.5)
            with counter_lock:
                active -= 1
            return SimpleNamespace(data=[SimpleNamespace(
                b64_json=base64.b64encode(b"fake-png").decode(),
            )])

    gen.client = SimpleNamespace(images=_Images())
    with ThreadPoolExecutor(max_workers=8) as pool:
        urls = list(pool.map(
            lambda i: gen.generate("slug", "bg", f"scene_{i}", f"prompt {i}", "768x768"),
            range(8),
        ))
    assert all(urls)
    assert peak == 8
