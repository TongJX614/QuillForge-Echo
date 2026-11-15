# -*- coding: utf-8 -*-
"""ECHO（回响）项目接入。

引擎通过 QUILLFORGE_PROJECTS=harness.projects.echo 导入本模块并调用 register()，
把 ECHO 的路由、页面、静态资源、首页卡片、会话中断态与子进程启停挂进注册表。
引擎核心不含任何 ECHO 逻辑；不配置该环境变量时引擎行为与上游一致。
"""

from __future__ import annotations

from registry import InterludeSpec, PageSpec, ProcessSpec, ProjectCard, ProjectDescriptor, StaticDirSpec

from . import echo_launcher, interlude
from .routes import debate as debate_routes
from .routes import echo as echo_routes
from .routes import minigame as minigame_routes
from .settings import STATIC_DIR, get_echo_settings

PROJECT_NAME = "echo"
PROJECT_LABEL = "回响 ECHO"

# 引擎首页静态目录挂载在此前缀下，项目脚本按 /echo/static/<file> 取用
STATIC_URL_PREFIX = "/echo/static"


def register(registry) -> None:
    """把 ECHO 挂进引擎注册表。只登记，不产生副作用。"""
    echo = get_echo_settings()

    registry.register_project(ProjectDescriptor(
        name=PROJECT_NAME,
        label=PROJECT_LABEL,
        description="像素 RPG 宿主：任务发布、NPC 对话与进度回写由 ECHO 负责，"
                    "叙事生成由引擎承担。",
        home=echo.home,
        settings={
            "host": echo.host,
            "port": echo.port,
            "launchMode": echo.launch_mode,
            "enabled": echo.enabled,
        },
    ))

    registry.register_router(PROJECT_NAME, debate_routes.router)
    registry.register_router(PROJECT_NAME, minigame_routes.router)
    registry.register_router(PROJECT_NAME, echo_routes.router)

    registry.register_page(PROJECT_NAME, PageSpec(
        path="/debate",
        static_name="debate.html",
        summary="辩论小游戏页面（言弹击破玩法）",
        directory=STATIC_DIR,
    ))
    registry.register_page(PROJECT_NAME, PageSpec(
        path="/minigame",
        static_name="minigame.html",
        summary="小游戏页（言弹辩驳 + 线索/解密/排序/连线/归类/解锁/巡航）",
        directory=STATIC_DIR,
    ))

    registry.register_static_dir(PROJECT_NAME, StaticDirSpec(
        url_path=STATIC_URL_PREFIX,
        directory=STATIC_DIR,
    ))

    # 世界编织成品页：ECHO 的 VR 入口用 iframe 打开 <引擎>/weave/
    registry.register_static_dir(PROJECT_NAME, StaticDirSpec(
        url_path="/weave",
        directory=echo.weave_game_home,
        html=True,
    ))

    # embed-bridge 在被 iframe 嵌入时负责与宿主游戏通信；
    # project-two-entry 承载「世界编织」的主题/角色选择与世界书审阅入口。
    registry.register_card(PROJECT_NAME, ProjectCard(
        project=PROJECT_NAME,
        title="项目二 · 世界编织",
        kicker="ECHO PROJECT 02 // WORLD WEAVING",
        lead="这是一项生成式体验。请先核对科学母题、身份与真实世界书节选，再决定是否进入故事。",
        entry_path="/api/echo/launch",
        scripts=(
            f"{STATIC_URL_PREFIX}/echo-embed-bridge.js",
            f"{STATIC_URL_PREFIX}/echo-project-two-entry.js",
        ),
    ))

    registry.register_interlude(PROJECT_NAME, InterludeSpec(
        name=interlude.NAME,
        prepare_choices=interlude.prepare_choices,
        build_context=interlude.build_context,
        start=interlude.start,
        resolve=interlude.resolve,
        cancel=interlude.cancel,
        on_scene_advance=interlude.on_scene_advance,
    ))

    registry.register_process(PROJECT_NAME, ProcessSpec(
        name=PROJECT_NAME,
        start=echo_launcher.autostart,
        stop=echo_launcher.shutdown,
        status=echo_launcher.status,
        autostart=echo.enabled and echo.autostart,
    ))
