# -*- coding: utf-8 -*-
"""引擎设置回读：/api/settings/*

前端设置页保存 Key 后调用本接口，确认后端确实读到了请求头里的 Key，
并回显实际生效的模型与备选模型（Key 一律脱敏，不回传明文）。
"""

from __future__ import annotations

from fastapi import APIRouter

from config_manager import get_settings
from provider_key import current_provider_key

router = APIRouter(tags=["settings"])


def _mask(key: str) -> str:
    key = (key or "").strip()
    if not key:
        return ""
    if len(key) <= 10:
        return key[:2] + "****" + key[-2:]
    return f"{key[:6]}…{key[-4:]}"


def _split(raw: str) -> list[str]:
    return [m.strip() for m in (raw or "").split(",") if m.strip()]


@router.get("/api/settings/provider-key", summary="回读当前请求生效的服务商 Key 与模型")
def provider_key_status():
    s = get_settings()
    browser_key = current_provider_key()
    env_text = (s.deepseek_api_key or s.openai_api_key or "").strip()
    env_image = (s.image_api_key or "").strip()
    env_tts = (s.tts_api_key or "").strip()
    effective = "browser" if browser_key else ("env" if (env_text or env_image or env_tts) else "none")

    protocol = (s.tts_protocol or "openai-chat").strip().lower()
    tts_model = s.tts_model or (
        "qwen-audio-3.1-tts-flash" if protocol == "dashscope" else "mimo-v2.5-tts-voiceclone"
    )
    tts_fallbacks = _split(s.tts_fallback_model)
    if tts_fallbacks == [tts_model]:
        tts_fallbacks = []

    return {
        "effective": effective,
        "browser_key": {"present": bool(browser_key), "masked": _mask(browser_key)},
        "env_keys": {
            "text": _mask(env_text),
            "image": _mask(env_image),
            "tts": _mask(env_tts),
        },
        "models": {
            "text": {
                "primary": s.script_gen_model or s.deepseek_model,
                "fallbacks": _split(s.llm_fallback_models),
            },
            "image": {
                "primary": s.image_model,
                "fallbacks": _split(s.image_fallback_models),
            },
            "tts": {
                "primary": tts_model,
                "fallbacks": tts_fallbacks,
            },
        },
    }
