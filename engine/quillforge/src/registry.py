# -*- coding: utf-8 -*-
"""通用项目注册表。

引擎核心不认识任何具体项目。外部项目（如 ECHO）通过实现 ``register(registry)``
把自己挂载进来：路由、页面、静态目录、首页卡片、会话中断态、子进程启停、
附加配置项。

启用方式：环境变量 ``QUILLFORGE_PROJECTS`` 给出逗号分隔的可导入模块名，例如
``QUILLFORGE_PROJECTS=harness.projects.echo``。未设置时注册表为空，引擎行为与
上游完全一致。
"""

from __future__ import annotations

import importlib
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from logger import get_logger

logger = get_logger("registry")

PROJECTS_ENV = "QUILLFORGE_PROJECTS"


@dataclass(frozen=True)
class PageSpec:
    """一个由项目提供的 HTML 页面。

    directory 为 None 时在引擎自带的 static 目录下查找 static_name。
    """

    path: str
    static_name: str
    summary: str = ""
    directory: Optional[Path] = None


@dataclass(frozen=True)
class StaticDirSpec:
    """一个需要挂载的项目静态目录。html=True 时按静态站点服务（目录默认取 index.html）。"""

    url_path: str
    directory: Path
    html: bool = False


@dataclass(frozen=True)
class ProjectCard:
    """引擎首页「已接入项目」区的一张卡片。

    scripts 是随卡片一起注入首页的脚本 URL 列表（按顺序加载），用于承载
    项目自己的入口逻辑；引擎只负责插入 script 标签，不理解其内容。
    """

    project: str
    title: str
    kicker: str = ""
    lead: str = ""
    entry_path: str = ""
    scripts: tuple = ()


@dataclass(frozen=True)
class PageAssets:
    """项目要为引擎某个自带页面注入的样式与脚本（按序加载）。"""

    styles: tuple = ()
    scripts: tuple = ()


@dataclass(frozen=True)
class InterludeSpec:
    """会话中断态。

    引擎只提供一个通用的 INTERLUDE 状态与一块 per-session 暂存区，具体玩法
    （例如剧情内嵌小游戏）由项目实现。``name`` 同时作为对外 ``session_state``
    的取值，以保持既有前端契约。
    """

    name: str
    prepare_choices: Optional[Callable] = None
    build_context: Optional[Callable] = None
    start: Optional[Callable] = None
    resolve: Optional[Callable] = None
    cancel: Optional[Callable] = None
    on_scene_advance: Optional[Callable] = None


@dataclass(frozen=True)
class ProcessSpec:
    """项目自带子进程（例如宿游戏的 node 服务）的启停钩子。

    autostart 为真时，引擎在应用启动事件里调用 start（传入引擎实际端口），
    失败只记录日志，不影响引擎自身可用。
    """

    name: str
    start: Optional[Callable] = None
    stop: Optional[Callable] = None
    status: Optional[Callable] = None
    autostart: bool = False


@dataclass(frozen=True)
class ProjectDescriptor:
    """一个已注册项目的元信息。"""

    name: str
    label: str = ""
    description: str = ""
    home: Optional[Path] = None
    settings: Mapping[str, Any] = field(default_factory=dict)


class ProjectRegistry:
    """收集所有项目挂载点。注册阶段只收集，不产生副作用。"""

    def __init__(self) -> None:
        self._projects: dict[str, ProjectDescriptor] = {}
        self._routers: list[tuple[str, Any]] = []
        self._pages: list[PageSpec] = []
        self._static_dirs: list[StaticDirSpec] = []
        self._cards: list[ProjectCard] = []
        self._page_assets: dict[str, PageAssets] = {}
        self._interludes: dict[str, InterludeSpec] = {}
        self._processes: dict[str, ProcessSpec] = {}

    # ── 注册接口 ──────────────────────────────────────

    def register_project(self, descriptor: ProjectDescriptor) -> None:
        if descriptor.name in self._projects:
            raise ValueError(f"PROJECT_ALREADY_REGISTERED:{descriptor.name}")
        self._projects[descriptor.name] = descriptor

    def register_router(self, project: str, router: Any) -> None:
        self._routers.append((project, router))

    def register_page(self, project: str, page: PageSpec) -> None:
        if any(p.path == page.path for p in self._pages):
            raise ValueError(f"PAGE_PATH_CONFLICT:{page.path}")
        self._pages.append(page)

    def register_static_dir(self, project: str, spec: StaticDirSpec) -> None:
        self._static_dirs.append(spec)

    def register_card(self, project: str, card: ProjectCard) -> None:
        self._cards.append(card)

    def register_page_assets(self, project: str, page_path: str, assets: PageAssets) -> None:
        existing = self._page_assets.get(page_path)
        if existing is None:
            self._page_assets[page_path] = assets
        else:
            self._page_assets[page_path] = PageAssets(
                styles=tuple(existing.styles) + tuple(assets.styles),
                scripts=tuple(existing.scripts) + tuple(assets.scripts),
            )

    def register_interlude(self, project: str, spec: InterludeSpec) -> None:
        if spec.name in self._interludes:
            raise ValueError(f"INTERLUDE_NAME_CONFLICT:{spec.name}")
        self._interludes[spec.name] = spec

    def register_process(self, project: str, spec: ProcessSpec) -> None:
        if spec.name in self._processes:
            raise ValueError(f"PROCESS_NAME_CONFLICT:{spec.name}")
        self._processes[spec.name] = spec

    # ── 读取接口 ──────────────────────────────────────

    @property
    def empty(self) -> bool:
        return not self._projects

    def projects(self) -> list[ProjectDescriptor]:
        return list(self._projects.values())

    def project(self, name: str) -> Optional[ProjectDescriptor]:
        return self._projects.get(name)

    def routers(self) -> list[Any]:
        return [router for _, router in self._routers]

    def pages(self) -> list[PageSpec]:
        return list(self._pages)

    def static_dirs(self) -> list[StaticDirSpec]:
        return list(self._static_dirs)

    def cards(self) -> list[ProjectCard]:
        return list(self._cards)

    def page_assets(self) -> dict[str, PageAssets]:
        return dict(self._page_assets)

    def interlude(self, name: str) -> Optional[InterludeSpec]:
        return self._interludes.get(name)

    def sole_interlude(self) -> Optional[InterludeSpec]:
        """只有一个中断态时的快捷取用；多个时返回 None，调用方须显式指名。"""
        if len(self._interludes) == 1:
            return next(iter(self._interludes.values()))
        return None

    def interlude_names(self) -> list[str]:
        return list(self._interludes)

    def process(self, name: str) -> Optional[ProcessSpec]:
        return self._processes.get(name)

    def process_names(self) -> list[str]:
        return list(self._processes)

    def settings_for(self, project: str) -> dict[str, Any]:
        descriptor = self._projects.get(project)
        return dict(descriptor.settings) if descriptor else {}


_registry: Optional[ProjectRegistry] = None


def _import_and_register(module_name: str, registry: ProjectRegistry) -> None:
    module = importlib.import_module(module_name)
    register = getattr(module, "register", None)
    if not callable(register):
        raise AttributeError(f"PROJECT_MODULE_MISSING_REGISTER:{module_name}")
    register(registry)


def build_registry(environ: Optional[Mapping[str, str]] = None) -> ProjectRegistry:
    """按 ``QUILLFORGE_PROJECTS`` 构建注册表。

    单个项目模块导入失败不应拖垮整个引擎：记录错误并继续，引擎以降级形态
    （缺少该项目）启动。
    """
    environment = os.environ if environ is None else environ
    registry = ProjectRegistry()
    raw = environment.get(PROJECTS_ENV, "") or ""
    for module_name in (part.strip() for part in raw.split(",")):
        if not module_name:
            continue
        try:
            _import_and_register(module_name, registry)
            logger.info("[registry] 已接入项目模块: %s", module_name)
        except Exception as exc:  # noqa: BLE001 - 降级启动优于整体崩溃
            logger.error("[registry] 项目模块 %s 接入失败: %s", module_name, exc)
    return registry


def get_registry() -> ProjectRegistry:
    """进程内单例。首次调用时构建。"""
    global _registry
    if _registry is None:
        _registry = build_registry()
    return _registry


def set_registry(registry: ProjectRegistry) -> None:
    """供测试与应用启动流程显式注入。"""
    global _registry
    _registry = registry


def reset_registry() -> None:
    global _registry
    _registry = None
