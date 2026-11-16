# -*- coding: utf-8 -*-
"""ECHO → 引擎上下文契约：自由聊天/对白必须读到任务步骤与持有物。"""

from __future__ import annotations

import harness.projects.echo.echo_host as echo_host


STORY = {
    "title": "测试剧本",
    "worldbook": (
        "# 世界书\n\n"
        "## 世界背景\n1927 年索尔维会议，爱因斯坦与玻尔就量子力学展开论战。\n\n"
        "## 组织设定\n与当前任务无关的组织介绍。\n\n"
        "## 故事边界\n不得出现超自然元素，不得改变历史大事件。\n\n"
        "## 情感基调\n智识的激情与敬畏。\n"
    ),
    "stages": [
        {"name": "筹备日"}, {"name": "第一轮辩论"}, {"name": "会议讨论"},
        {"name": "第二轮辩论"}, {"name": "终幕"},
    ],
}

WORLD = {
    "sceneId": "solvay",
    "sceneName": "索尔维会议厅",
    "npcs": [
        {"id": "solvay_lorentz", "name": "亨德里克·洛伦兹"},
        {"id": "solvay_einstein", "name": "阿尔伯特·爱因斯坦"},
    ],
    "items": [{"id": "item_nameplate", "name": "桌牌"}],
    "quests": [{
        "id": "quest_lorentz_commission",
        "title": "洛伦兹的委托",
        "stepIndex": 1,
        "stepDesc": "收集会议座位安排表与桌牌，交给洛伦兹核对",
        "objectives": [
            {"type": "collect", "target": "item_seating", "count": 1},
            {"type": "collect", "target": "item_nameplate", "count": 1},
        ],
    }],
    "completedQuests": [],
    "flags": ["met_lorentz", "camp_de_broglie"],
    "inventory": [{"id": "item_seating", "name": "座位安排表", "qty": 1}],
    "history": [
        {"speaker": "洛伦兹", "text": "苏然，请把座位安排表和桌牌取来。", "sceneId": "solvay"},
        {"speaker": "苏然", "text": "好的。", "sceneId": "astro"},
    ],
    "choices": ["接受委托"],
}


def _prepare(monkeypatch):
    monkeypatch.setattr(echo_host, "_build_char_index", lambda: None)
    monkeypatch.setitem(echo_host._char_index, "solvay_einstein", {
        "card": {"personality": "幽默固执", "background": "相对论", "speakingStyle": "缓慢从容"},
    })
    monkeypatch.setattr(echo_host, "_get_pack", lambda name: STORY)


def test_chat_prompt_reads_world_snapshot(monkeypatch):
    _prepare(monkeypatch)
    prompt = echo_host._chat_system_prompt({
        "npcId": "solvay_einstein",
        "npcName": "阿尔伯特·爱因斯坦",
        "message": "我这会儿该先办哪件事？",
        "history": [],
        "context": {
            "sceneId": "solvay",
            "stage": "meeting",
            "flags": ["met_lorentz"],
            "questProgress": WORLD["quests"],
            "world": WORLD,
        },
    })

    assert "洛伦兹的委托（第2步）" in prompt
    assert "当前步骤：收集会议座位安排表与桌牌" in prompt
    assert "目标：收集:座位安排表、收集:桌牌" in prompt
    assert "持有物品：座位安排表×1" in prompt
    assert "〔天体物理实验室〕苏然：好的。" in prompt
    assert "剧情管线：" in prompt
    assert "故事边界" in prompt
    assert "不得说成尚未取得" in prompt


def test_chat_prompt_accepts_flat_echo_shape(monkeypatch):
    _prepare(monkeypatch)
    prompt = echo_host._chat_system_prompt({
        "npcId": "solvay_einstein",
        "npcName": "阿尔伯特·爱因斯坦",
        "message": "我该做什么？",
        "history": [],
        "scene": "solvay",
        "stage": "meeting",
        "flags": ["met_lorentz"],
        "quests": [{
            "id": "quest_lorentz_commission",
            "title": "洛伦兹的委托",
            "stepIndex": 1,
            "stepDesc": "收集会议座位安排表与桌牌",
        }],
    })

    assert "收集会议座位安排表与桌牌" in prompt
    assert "会议讨论" in prompt


def test_worldbook_selection_keeps_boundaries_and_budget(monkeypatch):
    _prepare(monkeypatch)
    excerpt = echo_host._select_worldbook(STORY["worldbook"], ["爱因斯坦"], 180)

    assert len(excerpt) <= 180
    assert "故事边界" in excerpt
    assert "不得出现超自然元素" in excerpt
    assert "组织设定" not in excerpt


def test_echo_state_lists_step_desc_and_objectives(monkeypatch):
    _prepare(monkeypatch)
    state = echo_host._format_echo_state({
        "stage": "meeting",
        "quests": {"active": WORLD["quests"], "completed": []},
        "flags": ["met_lorentz"],
        "world": WORLD,
    })

    assert "洛伦兹的委托（第2步）" in state
    assert "当前步骤：收集会议座位安排表与桌牌" in state
    assert "目标：收集:座位安排表、收集:桌牌" in state
