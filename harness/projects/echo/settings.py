# -*- coding: utf-8 -*-
"""ECHO 项目配置。

引擎的 config_manager 只管引擎自己的事；ECHO 这个被驱动项目的地址、端口、
启动方式与玩法参数全部收敛在这里，只从环境变量与本项目 config 目录读取。
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
CONFIG_DIR = PROJECT_DIR / "config"
STATIC_DIR = PROJECT_DIR / "static"

# harness/projects/echo/settings.py → 上四级是仓库根
REPO_ROOT = PROJECT_DIR.parents[2]
DEFAULT_ECHO_HOME = REPO_ROOT / "projects" / "echo"
# 世界编织成品页：ECHO 的 iframe 打开 <引擎>/weave/，内容由这里静态服务
DEFAULT_WEAVE_HOME = DEFAULT_ECHO_HOME / "examples" / "narrative-demo"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("false", "0", "off", "no")


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    candidate = Path(raw).expanduser()
    return candidate if candidate.is_absolute() else (REPO_ROOT / candidate).resolve()


@dataclass(frozen=True)
class EchoSettings:
    """ECHO 宿主与启动参数。"""

    enabled: bool = True
    autostart: bool = True
    home: Path = DEFAULT_ECHO_HOME
    host: str = "127.0.0.1"
    port: int = 5173
    port_max_offset: int = 30
    node: str = ""
    launch_mode: str = "dev"
    launch_timeout: float = 120.0
    weave_game_home: Path = DEFAULT_WEAVE_HOME


@lru_cache()
def get_echo_settings() -> EchoSettings:
    return EchoSettings(
        enabled=_env_bool("ECHO_ENABLED", True),
        autostart=_env_bool("ECHO_AUTOSTART", True),
        home=_env_path("ECHO_HOME", DEFAULT_ECHO_HOME),
        host=os.environ.get("ECHO_HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=_env_int("ECHO_PORT", 5173),
        port_max_offset=_env_int("ECHO_PORT_MAX_OFFSET", 30),
        node=os.environ.get("ECHO_NODE", "").strip(),
        launch_mode=os.environ.get("ECHO_LAUNCH_MODE", "dev").strip() or "dev",
        launch_timeout=_env_float("ECHO_LAUNCH_TIMEOUT", 120.0),
        weave_game_home=_env_path("WEAVE_GAME_HOME", DEFAULT_WEAVE_HOME),
    )


@lru_cache()
def _echo_yaml() -> dict:
    """读取 config/echo.yaml；缺失或损坏时返回空 dict，各处按默认值走。"""
    path = CONFIG_DIR / "echo.yaml"
    if not path.is_file():
        return {}
    try:
        import yaml

        loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


@lru_cache()
def get_minigame_inject_config() -> dict:
    """选项随机挂载小游戏的运行参数。"""
    cfg = _echo_yaml().get("minigame", {}) or {}
    try:
        probability = max(0.0, min(1.0, float(cfg.get("choiceProbability", 0.8))))
    except (TypeError, ValueError):
        probability = 0.8
    return {
        "choiceProbability": probability,
        "avoidRecentKind": bool(cfg.get("avoidRecentKind", True)),
    }


def llm_model(env_var: str, default: str = "deepseek-v4.1-flash-1017") -> str:
    """玩法生成用的模型名，可被专用环境变量覆盖，默认跟随 DEEPSEEK_MODEL。"""
    for candidate in (os.environ.get(env_var), os.environ.get("DEEPSEEK_MODEL"), default):
        value = (candidate or "").strip()
        if value:
            return value
    return default
