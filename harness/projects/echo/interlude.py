# -*- coding: utf-8 -*-
"""ECHO 剧情内嵌小游戏：作为引擎「会话中断态」扩展注册进去。

引擎只提供 INTERLUDE 状态、per-session scratch 暂存区与委托入口；玩法声明的
随机注入、内容生成、作答判定与成败回写全在这里。

状态与数据都挂在 session 上：
  session.scratch["injected"]   当前场景随机注入的 {选项下标: minigame 声明}
  session.scratch["last_kind"]  上一场景实际玩过的玩法，用于避免连续同类型
  session.scratch["pending"]    进行中的小游戏 {choice_index, chosen, game_id, kind}
"""

from __future__ import annotations

from fastapi import HTTPException

from logger import get_logger

from .minigame_generator import (
    VALID_KINDS,
    generate_minigame,
    inject_choice_minigames,
    judge_minigame,
    normalize_kind,
)

logger = get_logger("echo.interlude")

NAME = "minigame"


def _scratch(session) -> dict:
    return session.scratch


def _injected(session) -> dict:
    return _scratch(session).get("injected") or {}


def prepare_choices(session, script_choices: list[dict]) -> list[dict]:
    """为当前场景的剧本选项随机注入小游戏声明（同一场景只掷一次骰子）。

    注入结果记在 session.scratch，返回带 minigame 标记的新列表供前端渲染徽章，
    不修改 adapter 的原始数据。
    """
    scratch = _scratch(session)
    if scratch.get("injected") is None:
        prepared, injected = inject_choice_minigames(
            script_choices,
            last_kind=scratch.get("last_kind") or None,
            scene_index=session.current_scene_index,
        )
        scratch["injected"] = injected
        if injected:
            kinds = [injected[i].get("type") for i in sorted(injected)]
            logger.info("[echo] 场景 %s 随机注入小游戏: %s", session.current_scene_index, kinds)
        return prepared

    merged = []
    for i, choice in enumerate(script_choices):
        decl = _injected(session).get(i)
        if decl and not choice.get("minigame"):
            choice = {**choice, "minigame": decl}
        merged.append(choice)
    return merged


def on_scene_advance(session) -> None:
    """场景推进后作废上一场景的注入记录；last_kind 需跨场景保留。"""
    _scratch(session)["injected"] = None


def build_context(session, chosen: dict, mg_decl: dict) -> dict:
    """组装「已揭示视野」上下文（选项/旁白/对话/历史/登场角色/走过场景）。

    生成器据此只使用已揭示内容创作，不透出整本剧本的梗概与后续场景。
    """
    data = session.current_result.get("data", {}) if session.current_result else {}

    appeared: list[str] = []
    seen: set[str] = set()
    for dlg_source in ([h.get("dialogues") or [] for h in session.history]
                       + [data.get("dialogues") or []]):
        for d in dlg_source:
            if not isinstance(d, dict):
                continue
            sp = str(d.get("speaker", "")).strip()
            if sp and sp not in seen:
                seen.add(sp)
                appeared.append(sp)

    visited: list[str] = []
    for h in session.history:
        name = str(h.get("scene_name", "")).strip()
        if name and name not in visited:
            visited.append(name)
    scene = (session.adapter.scenes[session.current_scene_index]
             if session.current_scene_index < len(session.adapter.scenes) else {})
    cur_name = str(scene.get("name", "")).strip()
    if cur_name and cur_name not in visited:
        visited.append(cur_name)

    return {
        "choice_text": chosen.get("text", ""),
        "hint": mg_decl.get("hint", "") if isinstance(mg_decl, dict) else "",
        "narration": data.get("narration", ""),
        "dialogues": data.get("dialogues", []),
        "appeared_characters": appeared,
        "visited_scenes": visited,
        "history": [
            {"scene_name": h.get("scene_name", ""), "player_choice": h.get("player_choice", "")}
            for h in session.history
        ],
    }


def start(session, choice_index: int) -> dict:
    """玩家点击带 minigame 声明的选项：生成小游戏内容。

    引擎在返回后负责把会话切到 INTERLUDE 状态。

    Raises:
        HTTPException: 选项越界、选项未声明小游戏或生成失败
    """
    script_choices = session.adapter.get_scene_choices(
        session.current_scene_index, choice_history=session.history or None)
    if not 0 <= choice_index < len(script_choices):
        raise HTTPException(400, "无效的选项")
    chosen = script_choices[choice_index]

    mg_decl = chosen.get("minigame") or {}
    kind = normalize_kind(mg_decl.get("type", "")) if isinstance(mg_decl, dict) else ""
    if kind not in VALID_KINDS:
        # 剧本未声明时回退到后端随机注入的声明
        injected_decl = _injected(session).get(choice_index)
        if injected_decl:
            chosen = {**chosen, "minigame": injected_decl}
            mg_decl = injected_decl
            kind = normalize_kind(mg_decl.get("type", ""))
    if kind not in VALID_KINDS:
        raise HTTPException(400, "该选项未配置小游戏（minigame 字段缺失或类型非法）")

    scene_context = build_context(session, chosen, mg_decl)
    try:
        game_data = generate_minigame(session.adapter, kind, scene_context=scene_context)
    except ValueError as e:
        raise HTTPException(400, str(e))

    _scratch(session)["pending"] = {
        "choice_index": choice_index,
        "chosen": chosen,
        "game_id": game_data.get("gameId", ""),
        "kind": kind,
    }
    logger.info("[echo] 小游戏开始: kind=%s game_id=%s", kind, game_data.get("gameId", ""))
    return game_data


def resolve(session, answer) -> dict:
    """玩家作答：后端判定成败。

    支持有限次重试：非终局结果（仍有重试机会）不推进剧情，会话保持 INTERLUDE；
    终局成功/重试耗尽才作为选择写入历史并推进场景。

    Returns:
        终局：{success, successText, failureText, correctAnswer, final,
              chosen, session_state, progress, message, [ending]}
        非终局：{success: False, final: False, attemptsLeft, revealHint,
                failureText, session_state: "minigame"}
    """
    pending = _scratch(session).get("pending")
    if not pending:
        raise HTTPException(400, "无待结算的小游戏")

    try:
        result = judge_minigame(pending["game_id"], answer)
    except KeyError as e:
        raise HTTPException(400, str(e))

    if not result.get("final", True):
        logger.info("[echo] 小游戏答错，剩余 %s 次机会", result.get("attemptsLeft"))
        return {**result, "session_state": session.state_label}

    chosen = dict(pending["chosen"])
    _scratch(session)["last_kind"] = pending.get("kind", "")
    _scratch(session)["pending"] = None

    suffix = "_mg_success" if result["success"] else "_mg_failure"
    chosen["id"] = f"{chosen.get('id', '')}{suffix}"
    consequences_text = result["successText"] if result["success"] else result["failureText"]

    apply_result = session._apply_choice_locked(chosen, consequences_override=consequences_text)
    logger.info("[echo] 小游戏结算: success=%s -> state=%s", result["success"], session.state_label)
    return {**result, **apply_result}


def cancel(session) -> dict:
    """放弃小游戏，回到 GENERATED 状态重新选择（答案键留存服务端直至淘汰）。"""
    _scratch(session)["pending"] = None
    return {"ok": True, "message": "已返回选项"}
