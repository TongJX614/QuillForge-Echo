# -*- coding: utf-8 -*-
"""ECHO 游戏进程管理：随 QuillForge 启动、端口分配、就绪探测、退出清理。

由 server.py 在启动时调用 autostart()；routes/echo.py 通过 status()/wait_ready()
向首页提供入口状态。只管理本进程拉起的 ECHO，复用的外部实例不会在退出时被关闭。
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
from urllib.parse import urlparse
from pathlib import Path
from typing import Any

from config_manager import get_settings
from logger import get_logger

from .settings import get_echo_settings

logger = get_logger("echo_launcher")

_DEFAULT_ENGINE_PORT = 8050
_LOCK = threading.RLock()
_START_LOCK = threading.Lock()
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

_process: subprocess.Popen[bytes] | None = None
_log_handle: Any = None
_engine_port: int = _DEFAULT_ENGINE_PORT
_status: dict[str, Any] = {
    "enabled": True,
    "state": "stopped",  # stopped | starting | ready | failed | disabled
    "url": None,
    "port": None,
    "managed": False,
    "error": None,
    "log": None,
}


# ═══════════════════════════════════════════════════════
# 端口与探测
# ═══════════════════════════════════════════════════════

def _connect_host(host: str) -> str:
    return "127.0.0.1" if host in ("", "0.0.0.0", "::") else host


def _port_is_free(host: str, port: int) -> bool:
    bind_host = "0.0.0.0" if host in ("", "0.0.0.0") else host
    family = socket.AF_INET6 if ":" in bind_host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((bind_host, port))
        except OSError:
            return False
    return True


def find_free_port(host: str, preferred: int, attempts: int = 20) -> int:
    """从 preferred 起向后找一个可绑定的端口；全部占用时抛 RuntimeError。"""
    for port in range(preferred, min(preferred + max(1, attempts), 65536)):
        if _port_is_free(host, port):
            return port
    raise RuntimeError(f"{host}:{preferred} 起连续 {attempts} 个端口都被占用")


def _probe_health(host: str, port: int, timeout: float = 0.8) -> dict[str, Any] | None:
    url = f"http://{host}:{port}/api/health"
    try:
        with _OPENER.open(url, timeout=timeout) as resp:
            payload = json.loads(resp.read(8192).decode("utf-8"))
    except Exception:
        return None
    if isinstance(payload, dict) and payload.get("status") == "ok":
        return payload
    return None


def _health_compatible(health: dict[str, Any], engine_url: str) -> bool:
    reported = health.get("engineUrl")
    if reported:
        return str(reported).rstrip("/") == engine_url.rstrip("/")
    # 旧版 ECHO 健康接口没有 engineUrl，只在引擎仍是默认 8050 时复用。
    return engine_url.endswith(":8050")


# ═══════════════════════════════════════════════════════
# 配置解析
# ═══════════════════════════════════════════════════════

def _echo_home() -> Path:
    return get_echo_settings().home.resolve()


def _env_file(home: Path) -> Path | None:
    """ECHO 自己的 .env。

    只认 ECHO 目录下那一份：仓库根的 .env 属于引擎与 harness，里面没有
    ECHO_LLM_SOURCE 这类 ECHO 必需项，交给 ECHO 会让它的环境校验直接失败。
    找不到时返回 None，让 ECHO 按自己的根标记规则去解析。
    """
    candidate = home / ".env"
    return candidate.resolve() if candidate.is_file() else None


def _resolve_node(echo: Any) -> str | None:
    candidates = [
        echo.node,
        os.environ.get("ECHO_NODE"),
        shutil.which("node"),
        str(Path.home() / ".local" / "node24" / "bin" / "node"),
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    return None


def _build_env(home: Path, host: str, port: int, engine_url: str) -> dict[str, str]:
    settings = get_settings()
    env = os.environ.copy()
    engine_host = urlparse(engine_url).hostname or "127.0.0.1"
    env.update(
        {
            "ECHO_HOST": host,
            "ECHO_PORT": str(port),
            # 引擎地址由 harness 在启动时注入；echo 自己不写死任何引擎位置。
            # 变量名保持中性，echo 侧不认识具体引擎实现。
            "NARRATIVE_ENGINE_URL": engine_url,
            "NARRATIVE_ENGINE_HOST": engine_host,
            "NARRATIVE_ENGINE_PORT": str(_engine_port),
            "VITE_ENGINE_URL": engine_url,
            "COZE_PROJECT_ENV": "development",
            "PYTHONUTF8": "1",
        }
    )
    env_file = _env_file(home)
    if env_file is not None:
        env["GEWUZAOJING_ENV_FILE"] = str(env_file)

    api_key = settings.effective_api_key
    if api_key and api_key != "sk-placeholder":
        env.update(
            {
                "SHARED_LLM_PROVIDER": "openai-compatible",
                "SHARED_LLM_API_KEY": api_key,
                "SHARED_LLM_BASE_URL": settings.deepseek_base_url,
                "ECHO_LLM_SOURCE": "shared",
            }
        )
    return env


# ═══════════════════════════════════════════════════════
# 启动与状态
# ═══════════════════════════════════════════════════════

def _set(**changes: Any) -> None:
    with _LOCK:
        _status.update(changes)


def _refresh_process_state() -> None:
    if (
        _status["state"] == "ready"
        and _status["managed"]
        and _process is not None
        and _process.poll() is not None
    ):
        _status.update(state="failed", url=None, error="ECHO 进程已退出")


def status() -> dict[str, Any]:
    with _LOCK:
        _refresh_process_state()
        return dict(_status)


def autostart(engine_port: int | None = None) -> None:
    """供引擎启动事件调用：按配置在后台拉起 ECHO，不阻塞引擎启动。"""
    global _engine_port
    echo = get_echo_settings()
    if engine_port:
        _engine_port = engine_port
    if not echo.enabled:
        _set(enabled=False, state="disabled", url=None, port=None, error=None)
        return
    _set(enabled=True)
    if not echo.autostart:
        return
    start()


def start() -> None:
    with _LOCK:
        if _status["state"] in ("starting", "ready"):
            return
        _status.update(state="starting", url=None, port=None, error=None)
    threading.Thread(target=_start_worker, name="echo-start", daemon=True).start()


def _start_worker() -> None:
    global _process, _log_handle
    with _START_LOCK:
        try:
            echo = get_echo_settings()
            home = _echo_home()
            app_dir = home / "apps" / "echo"
            if not (app_dir / "package.json").is_file():
                raise RuntimeError(f"ECHO 目录不完整：{app_dir}")

            host = echo.host or "127.0.0.1"
            connect_host = _connect_host(host)
            preferred = int(echo.port)
            engine_url = f"http://{connect_host}:{_engine_port}"

            health = _probe_health(connect_host, preferred)
            if health and _health_compatible(health, engine_url):
                logger.info("[echo] 复用已运行的 ECHO: %s:%s", connect_host, preferred)
                _set(
                    state="ready",
                    url=f"http://{connect_host}:{preferred}",
                    port=preferred,
                    managed=False,
                    error=None,
                )
                return

            port = find_free_port(host, preferred, int(echo.port_max_offset))
            node = _resolve_node(echo)
            if node is None:
                raise RuntimeError("未找到 node，可用 ECHO_NODE 指定可执行文件路径")

            run_dir = home / ".run"
            run_dir.mkdir(parents=True, exist_ok=True)
            log_path = run_dir / "echo.log"
            log_handle = open(log_path, "ab", buffering=0)

            if echo.launch_mode == "prod":
                cmd = [node, str(app_dir / "dist-server" / "server.js")]
            else:
                cmd = [node, "--import", "tsx", "server/server.ts"]

            env = _build_env(home, host, port, engine_url)
            popen_kwargs: dict[str, Any] = {}
            if os.name == "nt":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                popen_kwargs["start_new_session"] = True

            logger.info("[echo] 启动 ECHO: %s (cwd=%s, port=%d)", cmd, app_dir, port)
            proc = subprocess.Popen(
                cmd,
                cwd=str(app_dir),
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                **popen_kwargs,
            )
            with _LOCK:
                _process = proc
                _log_handle = log_handle
            _set(port=port, managed=True, log=str(log_path))
            _wait_ready(proc, connect_host, port, float(echo.launch_timeout))
        except Exception as exc:
            logger.exception("[echo] 启动失败")
            _set(state="failed", url=None, error=str(exc))


def _wait_ready(proc: subprocess.Popen[bytes], host: str, port: int, timeout: float) -> None:
    deadline = time.time() + max(5.0, timeout)
    while time.time() < deadline:
        if proc.poll() is not None:
            detail = "查看日志 .run/echo.log"
            raise RuntimeError(f"ECHO 进程退出（code {proc.returncode}），{detail}")
        if _probe_health(host, port):
            url = f"http://{host}:{port}"
            _set(state="ready", url=url, error=None)
            logger.info("[echo] 已就绪: %s", url)
            return
        time.sleep(0.4)
    raise RuntimeError("ECHO 启动超时，查看 .run/echo.log")


def wait_ready(timeout: float = 60.0) -> dict[str, Any]:
    """入口点击时调用：必要时启动，并等待到 ready / failed。"""
    if not get_echo_settings().enabled:
        return status()
    if status()["state"] in ("stopped", "failed"):
        start()
    deadline = time.time() + timeout
    while time.time() < deadline:
        current = status()
        if current["state"] in ("ready", "failed", "disabled"):
            return current
        time.sleep(0.25)
    return status()


def shutdown() -> None:
    global _process, _log_handle
    with _LOCK:
        proc = _process
        managed = bool(_status.get("managed"))
        _status.update(state="stopped", url=None, port=None, managed=False, error=None)
        _process = None
    if proc is not None and managed and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    if _log_handle is not None:
        try:
            _log_handle.close()
        except Exception:
            pass
        _log_handle = None