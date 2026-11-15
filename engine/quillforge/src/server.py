# -*- coding: utf-8 -*-
"""
QuillForge — 通用 FastAPI 后端
支持上传任意剧本文件，通用解析，交互式生成

状态机：
  IDLE → (generate) → GENERATED → (choose) → CHOSEN → (generate) → ...
"""

from __future__ import annotations

import io
import sys
import os
from contextlib import asynccontextmanager
from pathlib import Path

# ── Numba 线程安全：必须在 import rembg/numba 之前设置 ──
os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
os.environ["NUMBA_NUM_THREADS"] = "1"

if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, 'buffer') and hasattr(sys.stdout.buffer, 'raw'):
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    except Exception as e:
        # 此时 logger 尚未定义，不能用 logger.warning，否则 NameError 直接崩溃
        print(f"[server] stdout/stderr UTF-8 重编码失败: {e}", file=sys.__stderr__)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from logger import get_logger
from config_manager import get_settings
from registry import get_registry

logger = get_logger("server")


# ═══════════════════════════════════════════════════════
# 已接入项目的子进程（由注册表声明，引擎不认识任何具体项目）
# ═══════════════════════════════════════════════════════

# main() 在真正监听前写入，供项目进程拿到引擎的实际端口
_ACTUAL_PORT: int | None = None


def _start_project_processes() -> None:
    registry = get_registry()
    for name in registry.process_names():
        spec = registry.process(name)
        if spec is None or not spec.autostart or spec.start is None:
            continue
        try:
            spec.start(_ACTUAL_PORT)
            logger.info("[registry] 已触发项目进程自启动: %s", name)
        except Exception as exc:  # noqa: BLE001 - 项目进程失败不应拖垮引擎
            logger.warning("[registry] 项目进程 %s 自启动失败: %s", name, exc)


def _stop_project_processes() -> None:
    registry = get_registry()
    for name in registry.process_names():
        spec = registry.process(name)
        if spec is None or spec.stop is None:
            continue
        try:
            spec.stop()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[registry] 项目进程 %s 停止失败: %s", name, exc)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    _start_project_processes()
    try:
        yield
    finally:
        _stop_project_processes()


# ═══════════════════════════════════════════════════════
# FastAPI App
# ═══════════════════════════════════════════════════════

app = FastAPI(title="QuillForge API", version="3.0.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 限流（slowapi）──
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── 可选 API Key 认证中间件 ──
_API_KEY = get_settings().quillforge_api_key

if _API_KEY:
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request as StarletteRequest

    class APIKeyMiddleware(BaseHTTPMiddleware):
        """X-API-Key 头认证（仅当环境变量 QUILLFORGE_API_KEY 非空时启用）"""
        async def dispatch(self, request: StarletteRequest, call_next):
            if request.url.path.startswith("/api/"):
                if request.headers.get("X-API-Key") != _API_KEY:
                    return JSONResponse(status_code=401, content={"detail": "无效的 API Key"})
            return await call_next(request)

    app.add_middleware(APIKeyMiddleware)

# ── 注册所有路由 ──
from routes import (
    pages_router, script_gen_router, story_router,
    upload_router, auto_run_router, session_router,
    realtime_router, assets_router,
)
app.include_router(pages_router)
app.include_router(script_gen_router)
app.include_router(story_router)
app.include_router(upload_router)
app.include_router(auto_run_router)
app.include_router(session_router)
app.include_router(realtime_router)
app.include_router(assets_router)

# ── 引擎自带静态资源（前端按 /static/<file> 取用）──
from fastapi.staticfiles import StaticFiles

_STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="engine-static")


# ═══════════════════════════════════════════════════════
# 已接入项目（QUILLFORGE_PROJECTS）
#
# 引擎核心不认识任何具体项目：项目模块通过 registry 声明自己的路由、页面、
# 静态目录与首页卡片，在此统一挂载。未配置时下列循环都是空转，引擎行为
# 与上游一致。
# ═══════════════════════════════════════════════════════

from routes.pages import serve_page_file

_project_registry = get_registry()
for _project_router in _project_registry.routers():
    app.include_router(_project_router)

for _page in _project_registry.pages():
    # 默认参数绑定当前 _page，避免闭包捕获循环变量
    app.add_api_route(
        _page.path,
        lambda _p=_page: serve_page_file(_p.static_name, _p.directory),
        methods=["GET"],
        summary=_page.summary or f"{_page.path} 页面",
        include_in_schema=True,
    )

for _index, _mount in enumerate(_project_registry.static_dirs()):
    _mount_dir = Path(_mount.directory)
    if not _mount_dir.is_dir():
        logger.warning("[registry] 项目静态目录不存在，跳过挂载: %s", _mount_dir)
        continue
    app.mount(_mount.url_path, StaticFiles(directory=str(_mount_dir), html=_mount.html),
              name=f"project-static-{_index}")

if not _project_registry.empty:
    logger.info("[registry] 已接入项目: %s | 路由 %d 组 | 页面 %d 个 | 静态挂载 %d 处",
                ", ".join(p.name for p in _project_registry.projects()),
                len(_project_registry.routers()), len(_project_registry.pages()),
                len(_project_registry.static_dirs()))


# ═══════════════════════════════════════════════════════
# 启动
# ═══════════════════════════════════════════════════════

def main():
    import argparse
    import uvicorn

    global _ACTUAL_PORT

    settings = get_settings()

    parser = argparse.ArgumentParser(description="QuillForge Server")
    parser.add_argument("--host", default=settings.server_host)
    parser.add_argument("--port", type=int, default=settings.server_port)
    parser.add_argument("--api-key", default="")
    args = parser.parse_args()

    if args.api_key:
        os.environ["OPENAI_API_KEY"] = args.api_key

    if not (args.api_key or settings.openai_api_key):
        logger.warning("[WARNING] 未设置 API Key")

    # 项目进程的自启动钩子需要知道引擎实际监听的端口
    _ACTUAL_PORT = args.port

    logger.info("服务地址: http://%s:%d", args.host, args.port)
    logger.info("API 文档: http://%s:%d/docs", args.host, args.port)

    # 后台预热 rembg 模型（避免首次生成立绘时卡顿）
    def _warmup_rembg():
        try:
            from image_gen import _get_rembg_session, _REMOVE_BG_ENABLED
            if _REMOVE_BG_ENABLED:
                logger.info("[warmup] 正在预加载 rembg (isnet-anime) 模型...")
                _get_rembg_session()
                logger.info("[warmup] rembg 模型预加载完成")
        except Exception as e:
            logger.info("[warmup] rembg 预加载跳过: %s", e)

    import threading
    threading.Thread(target=_warmup_rembg, daemon=True).start()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
