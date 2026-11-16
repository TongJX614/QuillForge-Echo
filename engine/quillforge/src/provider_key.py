# -*- coding: utf-8 -*-
"""
按请求透传的服务商 API Key（前端设置页"用自己的 Key"）。

前端把 Key 存各自浏览器的 localStorage，请求带 X-Provider-Key 头；
中间件把它写入 context 变量，请求线程内（含 Starlette 派发到线程池的同步端点）
可直接读取。手动 spawn 的后台线程不继承 context 变量，需在创建处显式捕获
（如把 Key 存进会话对象）。
未带头时返回空串，各调用方自行回退 .env 配置。
"""
from __future__ import annotations

import contextvars

HEADER_NAME = "x-provider-key"

_provider_key: contextvars.ContextVar[str] = contextvars.ContextVar("provider_key", default="")


def set_provider_key(key: str) -> None:
    _provider_key.set((key or "").strip())


def current_provider_key() -> str:
    return _provider_key.get()
