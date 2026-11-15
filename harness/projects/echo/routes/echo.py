# -*- coding: utf-8 -*-
"""ECHO 宿主接入路由：/api/echo/*

引擎管内容、ECHO 管进度。本路由把 ECHO 的场景/触发器/阶段/flags/任务状态
转成 Harness 生成请求，返回 ECHO 可直接演出的 DialogueTree / SSE 对话 / 结局。
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .. import echo_host, echo_launcher
from logger import get_logger

logger = get_logger("routes.echo")

router = APIRouter(tags=["echo"])


@router.post("/api/echo/dialogue", summary="为 ECHO 触发生成对白树")
async def echo_dialogue(body: dict) -> dict:
    """body: {sessionId, dialogueId, scene, trigger, stage, flags, quests,
    npcId, npcName, npcProfile, eventType, cgUrl, playerChoice, history}
    返回 {tree: DialogueTree, beat, pack}。tree 可直接交给 ECHO DialogueSystem.start。
    """
    if not body.get("scene") and not body.get("trigger"):
        raise HTTPException(400, "缺少 scene/trigger")
    try:
        return await asyncio.to_thread(echo_host.generate_dialogue, body)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.exception("[echo] 对白生成失败")
        raise HTTPException(503, f"引擎生成失败: {e}")


@router.post("/api/echo/chat", summary="ECHO NPC 自由对话（SSE）")
async def echo_chat(body: dict):
    """沿用 ECHO /api/chat 协议：data:{chunk}… → data:{node,replyNodes} → data:[DONE]。"""
    if not body.get("npcId"):
        raise HTTPException(400, "缺少 npcId")

    def sse():
        try:
            for evt in echo_host.chat_stream(body):
                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.exception("[echo] chat 流异常")
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        sse(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/echo/ending", summary="按 flags/stats/选择历史匹配多结局")
async def echo_ending(body: dict) -> dict:
    """body: {sessionId, scene, pack, flags, eventType, cgUrl}
    返回 {tree: DialogueTree|null, ending: {id,title,type}|null}。
    """
    try:
        return await asyncio.to_thread(echo_host.match_ending, body)
    except Exception as e:
        logger.exception("[echo] 结局匹配失败")
        raise HTTPException(503, f"结局匹配失败: {e}")


@router.get("/api/echo/beats", summary="宿主节拍注册表（供 Quest Manager 查看）")
async def echo_beats() -> dict:
    cfg = echo_host._load_config()
    return {
        "packs": cfg.get("packs", {}),
        "characters": cfg.get("characters", {}),
        "beats": cfg.get("beats", []),
        "stages": echo_host.ECHO_STAGE_ORDER,
    }


@router.post("/api/echo/continue", summary="选项后续写（角色针对选择继续回应）")
async def echo_continue(body: dict) -> dict:
    """body: {sessionId, scene, trigger, stage, playerChoice, npcId, npcName, history, world}
    返回 {node: DialogueNode|null}。
    """
    if not body.get("playerChoice"):
        raise HTTPException(400, "缺少 playerChoice")
    try:
        return await asyncio.to_thread(echo_host.continue_dialogue, body)
    except Exception as e:
        logger.exception("[echo] 续写失败")
        raise HTTPException(503, f"续写失败: {e}")


@router.post("/api/echo/background", summary="为 ECHO 场景生成背景图")
async def echo_background(body: dict) -> dict:
    """body: {scene, atmosphere?, prompt?} → {url, enabled}。未配置生图时 url=null。"""
    if not body.get("scene"):
        raise HTTPException(400, "缺少 scene")
    try:
        return await asyncio.to_thread(echo_host.generate_background, body)
    except Exception as e:
        logger.exception("[echo] 背景生成失败")
        raise HTTPException(503, f"背景生成失败: {e}")


@router.post("/api/echo/tts", summary="为对白文本合成语音")
async def echo_tts(body: dict) -> dict:
    """body: {text, speaker, scene?} → {url, enabled}。未配置 TTS 时 url=null。"""
    if not body.get("text"):
        raise HTTPException(400, "缺少 text")
    try:
        return await asyncio.to_thread(echo_host.synthesize_voice, body)
    except Exception as e:
        logger.exception("[echo] 语音合成失败")
        raise HTTPException(503, f"语音合成失败: {e}")


@router.post("/api/echo/session/reset", summary="重置宿主会话（stats/选择历史）")
async def echo_reset(body: dict) -> dict:
    session_id = body.get("sessionId") or "echo-default"
    echo_host._sessions.pop(session_id, None)
    return {"ok": True, "sessionId": session_id}


@router.get("/api/echo/status", summary="ECHO 游戏入口状态")
def echo_status() -> dict:
    return echo_launcher.status()


@router.post("/api/echo/launch", summary="进入 ECHO 游戏（未启动时自动拉起）")
def echo_launch() -> dict:
    result = echo_launcher.wait_ready(timeout=60)
    if result.get("state") != "ready" or not result.get("url"):
        raise HTTPException(503, result.get("error") or "ECHO 尚未就绪")
    return {"url": result["url"], "port": result.get("port")}