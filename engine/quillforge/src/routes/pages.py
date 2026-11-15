# -*- coding: utf-8 -*-
"""静态页面路由：/, /game，以及已注册项目的页面与卡片清单"""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from registry import get_registry

router = APIRouter(tags=["pages"])

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def serve_page_file(static_name: str, directory: Optional[Path] = None):
    """按名返回页面文件；不存在时 404。项目页面与引擎自带页面共用此逻辑。"""
    base = Path(directory) if directory is not None else _STATIC_DIR
    html_path = base / static_name
    if html_path.exists():
        return FileResponse(html_path, headers={"Cache-Control": "no-cache"})
    raise HTTPException(404, f"{static_name} 不存在")


@router.get("/")
def index():
    html_path = _STATIC_DIR / "index.html"
    if html_path.exists():
        return FileResponse(html_path, headers={"Cache-Control": "no-cache"})
    return {"message": "QuillForge API v3.0 - Visit /docs"}


@router.get("/game", summary="游戏页面（VN Galgame 引擎）")
def game_page():
    """返回 VN Galgame 游戏页面（打字机/立绘/TTS/结局），从首页跳转进入"""
    return serve_page_file("game.html")


@router.get("/api/projects", summary="已接入项目清单（首页卡片区数据源）")
def list_projects() -> dict:
    """返回通过注册表接入的项目及其首页卡片。

    引擎自身不认识任何具体项目；未配置 QUILLFORGE_PROJECTS 时返回空列表，
    首页卡片区随之隐藏。
    """
    registry = get_registry()
    return {
        "projects": [
            {
                "name": p.name,
                "label": p.label or p.name,
                "description": p.description,
            }
            for p in registry.projects()
        ],
        "cards": [
            {
                "project": c.project,
                "title": c.title,
                "kicker": c.kicker,
                "lead": c.lead,
                "entryPath": c.entry_path,
                "scripts": list(c.scripts),
            }
            for c in registry.cards()
        ],
        "interludes": registry.interlude_names(),
    }
