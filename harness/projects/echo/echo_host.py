# -*- coding: utf-8 -*-
"""
echo_host — ECHO 开放世界宿主接入层

把 QuillForge 引擎（Harness 五阶段管线 + 双剧本包世界书）接到 ECHO 宿主：
  - /api/echo/dialogue：按 (scene, trigger, stage) 生成 ECHO DialogueTree（旁白+对白+分支选项+动作）
  - /api/echo/chat：NPC 自由对话（SSE，沿用 ECHO /api/chat 协议）
  - /api/echo/ending：按 flags/stats/选择历史匹配多结局

设计原则：
  - 引擎管"内容"（世界书 → 对白/旁白/选项/结局），ECHO 管"进度"（任务/阶段/flag/门控）。
  - 主线节拍由 config/echo_beats.yaml 注册（手写骨架：节拍方向 + 选项 + 动作 + 属性变化），
    对白文本由引擎按世界书实时生成；未注册的触发器走自由生成。
  - 选项分支通过 flag（echo_choice:<beat>:<id>）回写 ECHO，引擎据此累计 stats/选择历史，
    使后续节拍与结局随分支变化。flags 由 ECHO 持久化，存档安全。
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Optional

import yaml
from cachetools import TTLCache

from adapter.loader import load_story
from formatters import build_harness_input_from_story
from dependencies import get_harness, get_image_generator, get_tts_generator
from llm_client import LLMClient
from logger import get_logger
from config_manager import PROJECT_ROOT, get_settings

from .settings import CONFIG_DIR

logger = get_logger("echo_host")

# ═══════════════════════════════════════════════════════
# 路径与常量
# ═══════════════════════════════════════════════════════

_BEATS_PATH = CONFIG_DIR / "echo_beats.yaml"
# echo_beats.yaml 里 packs 的相对路径以引擎根（quillforge/）为基准，
# 剧本包与引擎自带的 samples/ 共用同一套目录。
_PACKS_ROOT = PROJECT_ROOT

# ECHO 场景 id → 展示名（用于自由生成时组装场景上下文）
ECHO_SCENE_NAMES = {
    "office": "苏然的办公室",
    "astro": "天体物理实验室",
    "arpes": "ARPES 实验室",
    "vr": "VR 实验室",
    "solvay": "索尔维会议厅",
}

# ECHO 阶段顺序（与 apps/echo stage-manager STAGE_ORDER 对齐）
ECHO_STAGE_ORDER = ["prep", "debate1", "meeting", "debate2", "finale"]
ECHO_STAGE_NAMES = {
    "prep": "筹备日", "debate1": "第一轮辩论", "meeting": "会议讨论",
    "debate2": "第二轮辩论", "finale": "终幕",
}

# 引擎情绪 → ECHO Emotion（idle/happy/angry/sad/surprise）
_EMOTION_MAP = {
    "idle": "idle", "neutral": "idle", "平静": "idle", "中性": "idle",
    "happy": "happy", "高兴": "happy", "开心": "happy", "微笑": "happy", "喜悦": "happy",
    "angry": "angry", "愤怒": "angry", "生气": "angry", "恼怒": "angry",
    "sad": "sad", "悲伤": "sad", "难过": "sad", "低落": "sad", "沮丧": "sad",
    "surprise": "surprise", "惊讶": "surprise", "震惊": "surprise", "意外": "surprise",
    "serious": "idle", "思考": "idle", "困惑": "surprise", "坚定": "idle",
}


def _map_emotion(raw: str) -> str:
    if not raw:
        return "idle"
    key = str(raw).strip().lower()
    return _EMOTION_MAP.get(key, _EMOTION_MAP.get(str(raw).strip(), "idle"))


# ═══════════════════════════════════════════════════════
# 剧本包与节拍注册表（懒加载单例）
# ═══════════════════════════════════════════════════════

_packs: dict[str, dict] = {}
_beats_cfg: dict = {}
_char_index: dict[str, dict] = {}     # echo_id -> {pack, pack_id, name, card}
_name_to_echo: dict[str, str] = {}    # 角色名/别名 -> echo_id


def _load_config() -> dict:
    global _beats_cfg
    if not _beats_cfg:
        if _BEATS_PATH.exists():
            with open(_BEATS_PATH, "r", encoding="utf-8") as f:
                _beats_cfg = yaml.safe_load(f) or {}
        else:
            logger.warning("[echo_host] 节拍注册表不存在: %s", _BEATS_PATH)
            _beats_cfg = {}
    return _beats_cfg


def _get_pack(name: str) -> dict:
    """按注册表中的 pack 名加载剧本包（load_story 结果）。"""
    if name in _packs:
        return _packs[name]
    cfg = _load_config()
    rel = (cfg.get("packs", {}) or {}).get(name, "")
    if not rel:
        raise ValueError(f"未知剧本包: {name}")
    path = (_PACKS_ROOT / rel).resolve()
    story = load_story(str(path))
    _packs[name] = story
    logger.info("[echo_host] 加载剧本包 %s: %s（%d 角色 / %d 场景 / %d 结局）",
                name, story.get("title", ""), len(story.get("characters", [])),
                len(story.get("scenes", [])), len(story.get("endings", [])))
    return story


def _build_char_index() -> None:
    global _char_index, _name_to_echo
    if _char_index:
        return
    cfg = _load_config()
    for echo_id, spec in (cfg.get("characters", {}) or {}).items():
        pack_name = spec.get("pack", "frame")
        pack_id = spec.get("pack_id", echo_id)
        name = spec.get("name", "")
        card = None
        try:
            story = _get_pack(pack_name)
            for c in story.get("characters", []):
                if c.get("id") == pack_id or c.get("name") == name:
                    card = c
                    name = name or c.get("name", "")
                    break
        except Exception as e:
            logger.warning("[echo_host] 角色 %s 剧本包加载失败: %s", echo_id, e)
        _char_index[echo_id] = {"pack": pack_name, "pack_id": pack_id, "name": name, "card": card}
        if name:
            _name_to_echo.setdefault(name, echo_id)
        for alias in spec.get("aliases", []) or []:
            _name_to_echo.setdefault(alias, echo_id)
    # 剧本包内角色名也建立反查（便于 harness 输出 speaker 归一化）
    for pack_name in (cfg.get("packs", {}) or {}):
        try:
            story = _get_pack(pack_name)
        except Exception:
            continue
        for c in story.get("characters", []):
            cname = c.get("name", "")
            cid = c.get("id", "")
            if cname and cname not in _name_to_echo:
                # 找是否有 echo_id 指向该 pack_id
                for eid, info in _char_index.items():
                    if info["pack"] == pack_name and info["pack_id"] == cid:
                        _name_to_echo[cname] = eid
                        break


def _speaker_to_echo(speaker: str, default_npc: str = "") -> str:
    """把 harness 输出的 speaker（角色名）映射回 ECHO 角色 id。"""
    if not speaker:
        return "narrator"
    s = str(speaker).strip()
    if s in ("narrator", "旁白", " narration"):
        return "narrator"
    if s in _name_to_echo:
        return _name_to_echo[s]
    if s in _char_index:
        return s
    # 子串兜底（如"爱因斯坦" → solvay_einstein）
    for name, eid in _name_to_echo.items():
        if name and (name in s or s in name):
            return eid
    return default_npc or "narrator"


# ═══════════════════════════════════════════════════════
# 宿主会话（stats / 选择历史，TTL 自动过期）
# ═══════════════════════════════════════════════════════

_sessions: TTLCache = TTLCache(maxsize=200, ttl=3600)


def _get_session(session_id: str) -> dict:
    if session_id not in _sessions:
        _sessions[session_id] = {
            "stats": {}, "choices": [], "beats": [], "last_output": None,
            "created": time.time(),
        }
    return _sessions[session_id]


def _record_choice_flags(session: dict, flags: list[str]) -> None:
    """从 ECHO flags 中解析 echo_choice:<beat>:<choice_id>，重算 stats 与选择历史。

    ECHO 每次请求都携带完整 flags，因此这里按全集重算而非累加：
    既保证幂等（同一存档反复请求不会重复计分），也让 stats 可随存档恢复。
    """
    cfg = _load_config()
    beats = {b.get("id"): b for b in (cfg.get("beats", []) or [])}
    stats: dict = {}
    choices: list = []
    seen: set = set()
    for flag in flags or []:
        if not isinstance(flag, str) or not flag.startswith("echo_choice:"):
            continue
        if flag in seen:
            continue
        parts = flag.split(":")
        if len(parts) < 3:
            continue
        beat_id, choice_id = parts[1], parts[2]
        beat = beats.get(beat_id, {})
        choice = next((c for c in (beat.get("choices", []) or []) if c.get("id") == choice_id), {})
        for stat, delta in (choice.get("stats", {}) or {}).items():
            try:
                stats[stat] = stats.get(stat, 0) + int(delta)
            except (TypeError, ValueError):
                pass
        choices.append({
            "flag": flag, "beat": beat_id, "choice": choice_id,
            "text": choice.get("text", ""), "scene": beat.get("scene", ""),
        })
        seen.add(flag)
    session["stats"] = stats
    session["choices"] = choices


# ═══════════════════════════════════════════════════════
# 节拍解析
# ═══════════════════════════════════════════════════════

def _resolve_beat(scene: str, trigger: str, stage: str, dialogue_id: str,
                  flags: Optional[set] = None) -> Optional[dict]:
    """解析节拍。支持 requires_flags / excludes_flags 以实现分支变体。

    优先级：dialogue_id 精确 > (scene,trigger,stage) 且满足旗标 > 舞台通配。
    同层内：stage 限定优先，其次 requires_flags 更多的（更具体）优先。
    """
    cfg = _load_config()
    beats = cfg.get("beats", []) or []
    flags = flags or set()

    def flag_ok(b: dict) -> bool:
        requires = b.get("requires_flags") or []
        excludes = b.get("excludes_flags") or []
        if any(f not in flags for f in requires):
            return False
        if any(f in flags for f in excludes):
            return False
        return True

    # 优先 dialogue_id 精确匹配（同样遵守 requires/excludes，便于同 id 的完成态变体）
    if dialogue_id:
        for b in beats:
            if b.get("id") == dialogue_id and flag_ok(b):
                return b
    # (scene, trigger, stage) 匹配，stage 缺省视为通配，并按旗标过滤
    matched = [
        b for b in beats
        if b.get("scene") == scene and b.get("trigger") == trigger
        and (not b.get("stage") or b.get("stage") == stage)
        and flag_ok(b)
    ]
    if matched:
        matched.sort(key=lambda b: (0 if b.get("stage") else 1, -len(b.get("requires_flags") or [])))
        return matched[0]
    # (scene, trigger) 通配
    for b in beats:
        if b.get("scene") == scene and b.get("trigger") == trigger and not b.get("stage") and flag_ok(b):
            return b
    return None


def _pack_for_scene(scene: str, beat: Optional[dict]) -> str:
    if beat and beat.get("pack"):
        return beat["pack"]
    return "solvay" if scene == "solvay" else "frame"


def _stage_index(pack_name: str, stage: str) -> int:
    """ECHO 阶段 → 剧本包阶段索引（用于 worldline 标注）。"""
    try:
        story = _get_pack(pack_name)
    except Exception:
        return 0
    stages = story.get("stages", [])
    if not stages:
        return 0
    if stage in ECHO_STAGE_ORDER:
        idx = ECHO_STAGE_ORDER.index(stage)
        return min(idx, len(stages) - 1)
    return 0


def _build_worldline(pack_name: str, stage: str) -> str:
    story = _get_pack(pack_name)
    stages = story.get("stages", [])
    if not stages:
        return f"【{ECHO_STAGE_NAMES.get(stage, stage)}】"
    idx = _stage_index(pack_name, stage)
    names = [s.get("name", f"阶段{i+1}") for i, s in enumerate(stages)]
    return "→".join(f"{'【' + n + '】' if i == idx else n}" for i, n in enumerate(names))


# ═══════════════════════════════════════════════════════
# 场景上下文组装
# ═══════════════════════════════════════════════════════

def _format_echo_state(req: dict) -> str:
    parts = []
    stage = req.get("stage", "")
    if stage:
        parts.append(f"当前剧情阶段：{ECHO_STAGE_NAMES.get(stage, stage)}（{stage}）")
    # quests 兼容两种形状：ECHO 发送活跃任务列表，也兼容 {active, completed} 字典
    quests = req.get("quests") or []
    if isinstance(quests, dict):
        active = quests.get("active", []) or []
        completed = quests.get("completed", []) or []
    elif isinstance(quests, list):
        active, completed = quests, []
    else:
        active, completed = [], []
    if active:
        titles = []
        for q in active:
            if isinstance(q, dict):
                titles.append(str(q.get("title") or q.get("id") or ""))
            elif isinstance(q, str):
                titles.append(q)
        joined = "；".join(t for t in titles if t)
        if joined:
            parts.append("进行中的任务：" + joined)
    if completed:
        parts.append("已完成的任务：" + "、".join(str(c) for c in completed[:12]))
    flags = [f for f in (req.get("flags", []) or [])
             if isinstance(f, str) and not f.startswith(("visited:", "talked:", "stage_", "echo_choice:"))]
    if flags:
        parts.append("已发生的关键事件：" + "、".join(flags[:20]))
    return "\n".join(parts)


# ═══════════════════════════════════════════════════════
# ECHO 世界状态 → Prompt 上下文（保证续写贴合宿主世界）
# ═══════════════════════════════════════════════════════

_WORLD_ADHERENCE_NOTE = (
    "【最高优先级约束】以下为宿主 ECHO 世界的真实状态。生成内容必须与此严格一致："
    "不得虚构世界状态之外的角色、道具、地点或已发生事件；不得与【最近剧情】矛盾；"
    "对白与旁白必须服务于【进行中的任务】的当前步骤，只推进下一步，不擅自跳阶段。"
)


def _world_name(item: dict, key: str = "name") -> str:
    return str(item.get(key) or "") if isinstance(item, dict) else ""


def _format_world_scene(world: dict) -> str:
    if not isinstance(world, dict):
        return ""
    name = str(world.get("sceneName") or "")
    npcs = [_world_name(n) for n in (world.get("npcs") or []) if isinstance(n, dict)]
    npcs = [n for n in npcs if n]
    if not name and not npcs:
        return ""
    seg = f"（ECHO 实际场景）{name}"
    if npcs:
        seg += "；在场角色：" + "、".join(npcs[:16])
    return seg


def _format_world_state(world: dict) -> str:
    if not isinstance(world, dict) or not world:
        return ""
    lines = []
    scene = _format_world_scene(world)
    if scene:
        lines.append(scene)
    items = [_world_name(i) for i in (world.get("items") or []) if isinstance(i, dict)]
    items = [i for i in items if i]
    if items:
        lines.append("场景内可交互物件：" + "、".join(items[:15]))
    quests = [q for q in (world.get("quests") or []) if isinstance(q, dict)]
    if quests:
        lines.append("【进行中的任务】")
        for q in quests[:8]:
            seg = f"- {q.get('title') or q.get('id')}"
            if q.get("stepDesc"):
                seg += f"｜当前步骤：{q['stepDesc']}"
            objs = [o for o in (q.get("objectives") or []) if isinstance(o, dict)]
            if objs:
                seg += "｜目标：" + "、".join(f"{o.get('type')}:{o.get('target')}" for o in objs)
            lines.append(seg)
    completed = [str(c) for c in (world.get("completedQuests") or [])]
    if completed:
        lines.append("已完成任务：" + "、".join(completed[:12]))
    flags = [f for f in (world.get("flags") or []) if isinstance(f, str)]
    if flags:
        lines.append("关键状态/已发生事件：" + "、".join(flags[:24]))
    inv = [f"{_world_name(i)}×{i.get('qty')}" for i in (world.get("inventory") or [])
           if isinstance(i, dict) and _world_name(i)]
    if inv:
        lines.append("持有物品：" + "、".join(inv[:15]))
    hist = [h for h in (world.get("history") or []) if isinstance(h, dict) and h.get("text")]
    if hist:
        lines.append("【最近剧情】")
        for h in hist[-10:]:
            lines.append(f"- {h.get('speaker', '')}：{str(h.get('text', '')).strip()[:120]}")
    choices = [c for c in (world.get("choices") or []) if isinstance(c, str)]
    if choices:
        lines.append("玩家近期选择：" + " / ".join(choices[-6:]))
    return "\n".join(lines)


def _format_choice_history(world: dict, session: dict) -> str:
    parts = []
    if isinstance(world, dict):
        choices = [c for c in (world.get("choices") or []) if isinstance(c, str)]
        if choices:
            parts.append("玩家近期选择：" + " / ".join(choices[-8:]))
    recorded = session.get("choices") or []
    texts = [str(c.get("text") or c.get("choice") or "") for c in recorded[-6:]]
    texts = [t for t in texts if t]
    if texts:
        parts.append("已记录的关键抉择：" + " / ".join(texts))
    return "\n".join(parts)


_BRANCH_LABELS = {
    "camp_copenhagen": "哥本哈根阵营（玻尔/海森堡）",
    "camp_realism": "实在论阵营（爱因斯坦/薛定谔）",
    "camp_de_broglie": "德布罗意的第三条道路（导航波）",
}


def _format_branch_context(world: dict) -> str:
    flags = {f for f in (world.get("flags") or []) if isinstance(f, str)} if isinstance(world, dict) else set()
    camps = [f for f in flags if f.startswith("camp_")]
    if camps:
        readable = "、".join(_BRANCH_LABELS.get(c, c) for c in camps)
        return f"玩家已站定立场：{readable}。后续对白应体现该阵营视角的立场与关系，并延续由此产生的任务线。"
    return "玩家尚未在阵营间明确站队。"


def _compose_plot(world: dict, story: dict) -> str:
    pack_summary = str(story.get("plot_summary", "") or "").strip()
    if not isinstance(world, dict) or not world:
        return pack_summary
    seg = ["【ECHO 当前主线走向（最高优先级，必须严格遵循）】"]
    quests = [q for q in (world.get("quests") or []) if isinstance(q, dict)]
    if quests:
        q = quests[0]
        line = f"当前主任务：{q.get('title') or q.get('id')}"
        if q.get("stepDesc"):
            line += f"｜当前步骤：{q['stepDesc']}"
        seg.append(line)
    completed = [str(c) for c in (world.get("completedQuests") or [])]
    if completed:
        seg.append("已完成里程碑：" + "、".join(completed[:10]))
    seg.append("续写要求：只推进当前场景与当前任务相关的下一步，不跳阶段、不虚构未发生的事件或角色；"
               "若剧本包设定与宿主状态冲突，以宿主状态为准。")
    if pack_summary:
        seg.append("（剧本包背景参考：" + pack_summary[:500] + "）")
    return "\n".join(seg)


def _apply_world_context(harness_input: dict, req: dict, story: dict, session: dict) -> None:
    """把 ECHO 世界状态注入 harness_input 的 extra 字段与场景描述。"""
    world = req.get("world") or {}
    if not isinstance(world, dict) or not world:
        return
    state = _format_world_state(world)
    if state:
        harness_input["_playerState"] = state
        existing = harness_input.get("_narrativeNotes", "") or ""
        harness_input["_narrativeNotes"] = (existing + "\n" + _WORLD_ADHERENCE_NOTE).strip()
    history = _format_choice_history(world, session)
    if history:
        harness_input["_choiceHistory"] = history
    harness_input["_activeBranchContext"] = _format_branch_context(world)
    plot = _compose_plot(world, story)
    if plot:
        harness_input["_plotSummary"] = plot
    scene = _format_world_scene(world)
    if scene:
        harness_input["currentScene"] = scene + "\n" + (harness_input.get("currentScene", "") or "")


def _resolve_characters(req: dict, beat: Optional[dict], pack_name: str) -> list[dict]:
    """组装在场角色卡（pack 角色 + ECHO 传入的 npcProfile 兜底）。"""
    story = _get_pack(pack_name)
    pack_chars = {c.get("id"): c for c in story.get("characters", [])}
    echo_ids: list[str] = []
    if beat and beat.get("characters"):
        echo_ids = list(beat["characters"])
    else:
        npc = req.get("npcId") or req.get("trigger") or ""
        if npc and npc != "auto":
            echo_ids.append(npc)
        echo_ids.append("su_ran")
    cards = []
    seen = set()
    for eid in echo_ids:
        if eid in seen:
            continue
        seen.add(eid)
        info = _char_index.get(eid)
        if info and info.get("card"):
            cards.append(info["card"])
        elif eid in pack_chars:
            cards.append(pack_chars[eid])
    # ECHO 传入的 NPC profile（剧本包没有该角色卡时兜底，如 astro_scientist_back）
    profile_text = str(req.get("npcProfile") or "").strip()
    npc_id = str(req.get("npcId") or req.get("trigger") or "").strip()
    npc_name = str(req.get("npcName") or npc_id).strip()
    info = _char_index.get(npc_id)
    has_pack_card = bool(info and info.get("card"))
    if npc_id and not has_pack_card and not any(str(c.get("id")) == npc_id for c in cards):
        cards.append({
            "id": npc_id,
            "name": npc_name or npc_id,
            "role": "ECHO 场景 NPC",
            "personality": profile_text[:300],
            "speakingStyle": profile_text[:200],
            "background": "",
            "motivation": "",
            "appearance": "",
        })
    if not cards:
        cards = story.get("characters", [])[:2]
    return cards


def _build_synthetic_scene(req: dict, beat: Optional[dict], pack_name: str,
                           characters: list[dict]) -> dict:
    scene_id = req.get("scene", "office")
    trigger = req.get("trigger", "")
    npc_name = req.get("npcName", "")
    state_text = _format_echo_state(req)
    if beat:
        name = beat.get("title", npc_name or "对话")
        desc = beat.get("description", "")
        choices = beat.get("choices", []) or []
        if choices:
            prompt = beat.get("prompt", "请做出选择")
            opts = "\n".join(f"  - {c.get('text', '')}" for c in choices)
            desc = f"{desc}\n\n本场对白应自然推进到以下抉择（{prompt}）：\n{opts}"
    else:
        name = f"{ECHO_SCENE_NAMES.get(scene_id, scene_id)}·与{npc_name or trigger}交谈"
        desc = (
            f"玩家苏然在{ECHO_SCENE_NAMES.get(scene_id, scene_id)}与{npc_name or trigger}交谈。"
            f"请根据世界书与角色性格生成符合当前剧情阶段的对话。"
        )
    full_desc = desc
    if state_text:
        full_desc = f"{desc}\n\n【ECHO 实时游戏状态】\n{state_text}"
    return {
        "id": f"echo_{scene_id}_{trigger}",
        "name": name,
        "location": ECHO_SCENE_NAMES.get(scene_id, scene_id),
        "time": "",
        "atmosphere": beat.get("atmosphere", "") if beat else "",
        "description": full_desc,
        "characters_present": [c.get("id", "") for c in characters],
    }


# ═══════════════════════════════════════════════════════
# 对白生成（核心）
# ═══════════════════════════════════════════════════════

def _parse_json_block(raw: str):
    cleaned = re.sub(r"^```(?:json)?\s*", "", (raw or "").strip())
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


def _is_known_character(echo_id: str) -> bool:
    """判断 id 是否为真实角色（有角色卡/立绘），而非设备/物品/环境触发器。"""
    if not echo_id:
        return False
    if echo_id == "su_ran":
        return True
    return echo_id in _char_index


def _validate_suggestion(suggestion, world_npcs: list[dict], dialogues: list[dict]) -> Optional[dict]:
    """校验模型给出的“去问某人”建议：目标必须在场、且台词里确实有明确建议。"""
    if not isinstance(suggestion, dict):
        return None
    raw = suggestion.get("targets") or []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return None

    by_id = {n["id"]: n["name"] for n in world_npcs}
    by_name = {n["name"]: n["id"] for n in world_npcs}
    targets: list[dict] = []
    for item in raw:
        key = str(item).strip()
        tid = key if key in by_id else by_name.get(key)
        if not tid or any(t["id"] == tid for t in targets):
            continue
        targets.append({"id": tid, "name": by_id[tid]})
        if len(targets) >= 2:
            break
    if not targets:
        return None

    cues = ("去问", "去找", "去和", "问问", "请教", "拜访", "聊聊", "交谈", "确认", "打听")
    lines = [str(d.get("text", "")) for d in (dialogues or []) if isinstance(d, dict)]
    grounded = []
    for t in targets:
        if any(t["name"] in line and any(cue in line for cue in cues) for line in lines):
            grounded.append(t)
    if not grounded:
        return None

    reason = str(suggestion.get("reason") or "").strip()[:120]
    if not reason:
        names = "、".join(t["name"] for t in grounded)
        reason = f"对方建议你去和{names}聊聊，确认当前线索。"
    return {"targets": grounded, "reason": reason}


def _synthesize_suggestion(dialogues: list[dict], world_npcs: list[dict], speaker: str) -> Optional[dict]:
    """模型没主动给建议时：若当前角色在台词里提到某位在场角色，就补一句“去问问他”。"""
    if not dialogues or not world_npcs or not speaker:
        return None
    for idx in range(len(dialogues) - 1, -1, -1):
        line = dialogues[idx]
        if line.get("speaker") != speaker:
            continue
        text = str(line.get("text") or "")
        for target in world_npcs:
            name = target["name"]
            if len(name) < 2 or name not in text:
                continue
            dialogues.insert(idx + 1, {
                "speaker": speaker,
                "text": f"对了，关于这件事，您不妨去问问{name}——他那边或许有更直接的看法。",
                "emotion": "idle",
            })
            return {
                "targets": [target],
                "reason": f"{name}对当前线索或许更清楚，去和他聊聊。",
            }
    return None


def _generate_talk_single(req: dict, beat: Optional[dict], pack_name: str,
                          characters: list[dict], repeat: bool = False
                          ) -> tuple[list, list, Optional[dict]]:
    """闲聊快路径：单次模型调用生成 3-6 句对白 + 2-3 个选项，严格贴合 ECHO 世界状态。"""
    story = _get_pack(pack_name)
    world = req.get("world") or {}
    world_state = _format_world_state(world) if isinstance(world, dict) else ""
    npc_id = str(req.get("npcId") or req.get("trigger") or "")
    npc_name = str(req.get("npcName") or npc_id)
    # 场景内的真实 NPC（即使未在引擎角色表中登记）也应作为角色演绎，而不是设备独白
    world_npc_ids = set()
    world_npcs: list[dict] = []
    if isinstance(world, dict):
        for n in world.get("npcs") or []:
            if not isinstance(n, dict) or not n.get("id"):
                continue
            if n.get("talkable") is False:
                continue
            nid = str(n["id"]).strip()
            name = str(n.get("name") or nid).strip()
            world_npc_ids.add(nid)
            if nid not in ("su_ran", "narrator", npc_id) and not any(t["id"] == nid for t in world_npcs):
                world_npcs.append({"id": nid, "name": name})
    talked_ids = {
        str(f).split(":", 1)[1] for f in (req.get("flags") or [])
        if isinstance(f, str) and f.startswith("talked:") and ":" in f
    }
    world_npcs = [n for n in world_npcs if n["id"] not in talked_ids]
    npc_is_character = _is_known_character(npc_id) or npc_id in world_npc_ids
    info = _char_index.get(npc_id)
    card = {}
    if info and info.get("card"):
        card = info["card"]
    else:
        card = next((c for c in characters if str(c.get("id")) == npc_id), {})
    stage = str(req.get("stage") or "")
    stage_name = ECHO_STAGE_NAMES.get(stage, stage)
    worldbook = str(story.get("worldbook", "") or "")[:1200]
    recent_text = ""
    if isinstance(world, dict) and isinstance(world.get("history"), list):
        recent_text = "\n".join(
            f"- {h.get('speaker', '')}：{str(h.get('text', '')).strip()[:90]}"
            for h in world["history"][-8:] if isinstance(h, dict)
        )
    present = "、".join(str(c.get("name", "")) for c in characters if c.get("name"))
    targets_hint = "、".join(f"{n['id']}={n['name']}" for n in world_npcs) if npc_is_character else ""
    personality = str(card.get("personality", "") or "")[:300]
    speaking = str(card.get("speakingStyle", "") or "")[:200]
    role = str(card.get("role", "") or "")
    atmosphere = str(beat.get("atmosphere", "") or "") if beat else ""
    beat_desc = str(beat.get("description", "") or "")[:600] if beat else ""
    npc_profile = str(req.get("npcProfile", "") or "")[:300]
    authored = (beat.get("choices", []) or []) if beat else []
    choices_hint = ""
    if authored:
        choices_hint = ("\n本场对白必须自然导向以下既定选项（按原意保留，不要另编选项）：\n"
                        + "\n".join(f"- {c.get('text', '')}" for c in authored if c.get("text")))
    if npc_is_character:
        npc_line = f"【当前角色】{npc_name}（{role}）；性格：{personality}；说话风格：{speaking}；补充：{npc_profile}"
    else:
        npc_line = ("【当前角色】本场景由设备/环境触发，没有具体 NPC。请用主角苏然(su_ran)的第一人称独白/科普呈现，"
                    "或至多 1 句极短旁白(narrator)；不要创造不存在的角色。")
    system = (
        "你是互动叙事引擎，为玩家与角色的即时对话生成内容。必须严格贴合给定的 ECHO 世界状态与当前任务步骤："
        "只谈当前场景、当前步骤直接相关的事；禁止提及尚未发生的事件、后续节点或世界状态之外的人、物；"
        "不得与【最近剧情】矛盾。"
    )
    repeat_note = ""
    if repeat:
        repeat_note = (
            "【本次是再次对话】玩家此前已经做过本场抉择，相关选择与后果已经出现在上方世界状态与最近剧情中。\n"
            "不要重复首次见面的选项；请依据当前剧情阶段、任务步骤、旗标与最近剧情，\n"
            "生成 2-3 个与当前进度相符的新选项，对白也要体现出这些已经发生的事。\n\n"
        )
    user = (
        f"【世界观摘要】{worldbook}\n\n"
        f"【当前阶段】{stage_name}（{stage}）\n"
        f"【场景氛围】{atmosphere}\n"
        f"【本场节拍】{beat_desc}\n"
        f"【在场角色】{present}\n"
        f"【可建议拜访的在场角色ID】{targets_hint or '（无）'}\n"
        f"{npc_line}\n\n"
        f"【ECHO 世界真实状态（最高优先级，必须严格遵守）】\n{world_state}\n\n"
        f"【最近剧情（务必不矛盾）】\n{recent_text or '（暂无）'}\n\n"
        f"{repeat_note}"
        "【输出要求】\n"
        "1. 只生成与当前场景、当前任务步骤直接相关的内容；玩家当前处在哪一步就只谈这一步，不要跳到后面的事。\n"
        "2. 3-6 句对白；其中至多 1 句极短旁白（speaker=narrator），其余为角色或玩家(su_ran)台词。\n"
        "3. 若未给定既定选项，则生成 2-3 个符合当前情境的下一步选项（每个一句话）。\n"
        "4. 只有当当前角色在台词中明确建议玩家“去找/问问/请教/拜访”某位在场角色时，才填写 suggestion；"
        "targets 只能取【可建议拜访的在场角色ID】中的 id，最多 2 个；只是提到名字、转述观点或没有明确建议时，suggestion 必须为 null。\n"
        "5. suggestion.reason 用一句与当前任务步骤相关的话说明去找他们确认什么。\n"
        + ("本场没有可建议拜访的角色，suggestion 必须为 null。\n" if not targets_hint else "")
        + f"{choices_hint}\n\n"
        "只输出严格 JSON：\n"
        '{"lines":[{"speaker":"角色id或su_ran或narrator","text":"...","emotion":"idle|happy|angry|sad|surprise"}],'
        '"choices":[{"text":"选项","impact":"advance"}],'
        '"suggestion":{"targets":["角色id"],"reason":"..."} 或 null}'
    )
    parsed = None
    for attempt in range(2):
        try:
            client = LLMClient(model=get_settings().deepseek_model)
            raw = client.generate(
                system, user,
                temperature=0.75 if attempt == 0 else 0.55,
                max_tokens=900 if attempt == 0 else 1100,
            )
        except Exception as e:
            logger.warning("[echo_host] 闲聊生成失败: %s", e)
            return [], [], None
        parsed = _parse_json_block(raw)
        if isinstance(parsed, dict) and parsed.get("lines"):
            break
        logger.warning("[echo_host] 闲聊输出无法解析，重试一次")
        parsed = None
    if not isinstance(parsed, dict):
        return [], [], None
    dialogues: list = []
    choices: list = []
    default_npc = npc_id if npc_is_character else "su_ran"
    if not default_npc:
        default_npc = str(characters[0].get("id", "")) if characters else "su_ran"
    if isinstance(parsed, dict):
        for l in parsed.get("lines", []):
            if not isinstance(l, dict):
                continue
            text = str(l.get("text", "")).strip()
            if not text:
                continue
            raw_spk = str(l.get("speaker") or default_npc)
            if raw_spk in ("narrator", "旁白", "系统通知", ""):
                spk = "narrator"
            else:
                spk = _speaker_to_echo(raw_spk, default_npc)
                # 非真实角色（设备/物品/幻觉 id）一律归到主角，避免无立绘的裸 id
                if spk != "narrator" and not _is_known_character(spk):
                    spk = default_npc
            dialogues.append({"speaker": spk, "text": text,
                              "emotion": _map_emotion(l.get("emotion", "idle"))})
        for c in parsed.get("choices", [])[:4]:
            if isinstance(c, dict):
                t = str(c.get("text", "")).strip()
                if t:
                    choices.append({"text": t, "impact": str(c.get("impact", "advance"))})
            elif isinstance(c, str) and c.strip():
                choices.append({"text": c.strip(), "impact": "advance"})
    suggestion = _validate_suggestion(parsed.get("suggestion"), world_npcs, dialogues)
    if suggestion is None and npc_is_character:
        suggestion = _synthesize_suggestion(dialogues, world_npcs, default_npc)
    return dialogues, choices, suggestion


def generate_dialogue(req: dict) -> dict:
    """生成 ECHO DialogueTree。req 字段见 routes/echo.py。"""
    _build_char_index()
    session_id = req.get("sessionId") or "echo-default"
    session = _get_session(session_id)
    _record_choice_flags(session, req.get("flags", []))

    scene = req.get("scene", "office")
    trigger = req.get("trigger", "")
    stage = req.get("stage", "prep")
    dialogue_id = req.get("dialogueId", "")
    flags = set(req.get("flags") or [])
    beat = _resolve_beat(scene, trigger, stage, dialogue_id, flags)
    pack_name = _pack_for_scene(scene, beat)
    story = _get_pack(pack_name)

    characters = _resolve_characters(req, beat, pack_name)
    # speaker 反查需要这些角色名 → echo_id
    for c in characters:
        cname = c.get("name", "")
        cid = c.get("id", "")
        if cname:
            for eid, info in _char_index.items():
                if info["pack_id"] == cid and info["pack"] == pack_name:
                    _name_to_echo.setdefault(cname, eid)

    synth_scene = _build_synthetic_scene(req, beat, pack_name, characters)
    idx = _stage_index(pack_name, stage)
    player_choice = req.get("playerChoice", "")
    if not player_choice and session["choices"]:
        player_choice = session["choices"][-1].get("text", "")

    previous_data = None
    if session.get("last_output"):
        previous_data = session["last_output"]

    beat_id = (beat.get("id") if beat else f"{scene}_{trigger}") or "free"
    # 重复对话：本 beat 的抉择已经发生过，则不再沿用首次见面的固定选项，
    # 由模型按当前世界线/任务步骤/旗标生成新的上下文选项。
    repeat_beat = False
    if beat:
        choice_prefix = f"echo_choice:{beat.get('id') or ''}:"
        repeat_beat = any(str(f).startswith(choice_prefix) for f in flags)
    effective_beat = {**beat, "choices": []} if (beat and repeat_beat) else beat
    if req.get("mode") == "rich":
        # 重型五阶段流水线（需要完整旁白/强校验时使用）
        harness_input = build_harness_input_from_story(
            story, synth_scene, idx,
            player_choice=player_choice,
            previous_data=previous_data,
        )
        harness_input["worldline"] = _build_worldline(pack_name, stage)
        _apply_world_context(harness_input, req, story, session)
        result = get_harness().run(harness_input)
        data = result.get("data", {})
        narration = data.get("narration", "")
        dialogues = data.get("dialogues", []) or []
        llm_choices = data.get("nextChoices", []) or []
        suggestion = None
        session["last_output"] = {
            "narration": narration, "dialogues": dialogues,
            "nextChoices": llm_choices, "worldlineState": data.get("worldlineState", {}),
        }
    else:
        # 闲聊快路径：单次模型调用（约 3-5s），3-6 句 + 2-3 选项，严格贴合世界状态
        dialogues, llm_choices, suggestion = _generate_talk_single(
            req, effective_beat, pack_name, characters, repeat=repeat_beat
        )
        if not dialogues:
            raise ValueError("引擎未生成对白，请重试")
        narration = ""
        session["last_output"] = {
            "narration": "", "dialogues": dialogues,
            "nextChoices": llm_choices, "worldlineState": {},
        }
    session["beats"].append({"beat": beat_id, "scene": scene, "stage": stage, "ts": time.time()})

    # 支线派发目标：在场角色（beat 角色 + world 场景 NPC）
    dispatch_chars = list(characters)
    _world = req.get("world") or {}
    if isinstance(_world, dict) and isinstance(_world.get("npcs"), list):
        dispatch_chars.extend(n for n in _world["npcs"] if isinstance(n, dict))
    tree = _convert_to_tree(req, effective_beat, beat_id, narration, dialogues, llm_choices, dispatch_chars)
    # 插曲式小游戏：关键词优先（识别范围放宽到本轮生成的对白正文），否则按场景轮换未用过的类型
    minigame = None
    mg_type, keyword_text = _select_minigame_type(beat, tree, narration, flags, scene, trigger, str(req.get("eventType") or ""))
    if mg_type:
        mg_cfg = _build_minigame_config(mg_type, keyword_text, req.get("scene", ""), "")
        mg_cfg["type"] = mg_type
        # 由引擎判断插入时机：至少先看三句，最多插到第五句之后
        start_lines = tree.get("nodes", {}).get(tree.get("startNode", ""), {}).get("lines", [])
        kws = dict(_MINIGAME_RULES).get(mg_type, [])
        mg_cfg["afterLine"] = _minigame_after_line(start_lines, kws)
        minigame = mg_cfg
    finale = bool(beat and beat.get("final"))
    return {
        "tree": tree, "beat": beat_id, "pack": pack_name,
        "finale": finale, "minigame": minigame, "repeat": repeat_beat,
        "suggestion": suggestion,
    }


# 关键词 → 小游戏适配（放宽词表：覆盖同义表达与场景术语）
_MINIGAME_RULES = [
    ("seating", ["座位", "桌牌", "席位", "座次", "排座", "就座", "名牌", "姓名牌", "会议桌", "主席"]),
    ("archive-sort", ["档案", "卷宗", "归档", "整理", "分类", "名录", "名册", "文件", "文档", "记录", "报告", "手稿", "书页", "目录", "摘要", "批注"]),
    ("connect", ["连线", "配对", "对应", "关联", "关系", "谁和谁", "师承", "搭档", "观点", "理论", "阵营", "匹配"]),
    ("route", ["链路", "路由", "路径", "节点", "中继", "跳转", "追踪", "通道", "线路", "传输", "信号链", "接口"]),
    ("memory-match", ["记忆碎片", "闪回", "回忆", "重现", "重温", "往事", "旧照片", "影像", "记忆"]),
    ("signal", ["降噪", "波形", "频率", "相位", "频谱", "光谱", "信号", "干涉", "校准", "读数", "振荡", "噪声", "干扰"]),
    ("cleanup", ["清洗", "损坏", "残留", "杂质", "清除", "污染", "故障", "病毒", "异常", "错误", "修复", "破损"]),
    ("find-clue", ["线索", "寻找", "查找", "搜寻", "检索", "痕迹", "调查", "证据", "日志", "监控", "指纹", "脚印", "现场"]),
]
_MINIGAME_TITLES = {
    "archive-sort": "档案整理", "connect": "线索连线", "find-clue": "寻找线索",
    "seating": "座位图复原", "route": "链路追踪", "memory-match": "记忆配对",
    "signal": "信号降噪", "cleanup": "数据清洗",
}
_MINIGAME_HINTS = {
    "archive-sort": "把散落的条目点击选中，再点入正确的分类框；全部归位即可继续。",
    "connect": "把左右两列相互对应的条目连起来；全部连对即可继续。",
    "find-clue": "画面被迷雾遮蔽：移动鼠标靠近微光点，点击即可发现线索。",
    "seating": "把桌牌摆到对应的席位；席位上有提示。",
    "route": "按顺序接通链路节点；下一个会发光提示。",
    "memory-match": "翻开两张相同的卡片，把它们一一配对。",
    "signal": "调节频率与相位，让当前波形与目标波形重合。",
    "cleanup": "找出闪烁的损坏数据块并点击清除。",
}
_SEATING_PEOPLE = {
    "solvay": [
        {"title": "洛伦兹", "snippet": "会议主席"},
        {"title": "爱因斯坦", "snippet": "实在论阵营"},
        {"title": "玻尔", "snippet": "哥本哈根阵营"},
        {"title": "居里夫人", "snippet": "实验物理"},
        {"title": "海森堡", "snippet": "年轻报告人"},
        {"title": "德布罗意", "snippet": "导航波"},
    ],
    "frame": [
        {"title": "苏然", "snippet": "记忆修复工程师"},
        {"title": "林晓", "snippet": "技术支援"},
        {"title": "杜维明", "snippet": "研究所负责人"},
    ],
}

# 各场景的连线/链路/记忆配对/找线索素材，避免通用文本乱拼
_CONNECT_PAIRS = {
    "solvay": [("爱因斯坦", "实在论"), ("玻尔", "互补原理"), ("德布罗意", "导航波"), ("薛定谔", "波动力学")],
    "frame": [("林晓", "记忆修复"), ("杜维明", "织星科技"), ("苏然", "神经接口"), ("织女号", "匿名委托")],
    "vr": [("记忆织机", "量子回溯"), ("世界编织", "新世界"), ("神经连接", "意识沉浸"), ("旁观者", "不可改变")],
}
_ROUTE_NODES = {
    "solvay": ["会场入口", "签到台", "报告厅", "档案室", "休息室", "主会场", "主席台"],
    "frame": ["入口", "旧终端", "加密层", "织星塔", "中继", "织女号阵列"],
    "vr": ["实验室入口", "神经连接舱", "记忆织机", "量子回溯层", "索尔维场景", "观测者层"],
}
_MEMORY_PAIRS = {
    "solvay": ["黑体辐射", "量子假设", "光子箱", "互补原理"],
    "frame": ["织女号", "记忆裂痕", "神经接口", "旧照片"],
    "vr": ["记忆织机", "量子回溯", "世界编织", "意识沉浸"],
}
_FIND_CLUES_BY_SCENE = {
    "office": ["匿名邮件的发件人栏", "工作台上的旧照片", "神经接口的磨损触点", "被擦掉的日志时间戳", "桌角的灰尘痕迹", "加密数据的残留片段"],
    "astro": ["干涉臂的校准刻度", "控制台右侧的读数灯", "底片边缘的淡青标记", "观测台地面的拖痕", "被翻乱的会议记录", "隔离柜的封条"],
    "arpes": ["样品杆的指纹", "门禁读卡器的日志", "密封容器的冷凝水", "设备背后的划痕"],
    "vr": ["记忆织机的接缝", "舱门内侧的划痕", "中继节点的闪烁灯", "世界编织的残留参数"],
    "solvay": ["会议桌的座次签", "签到册的空白栏", "被撕掉的手稿页", "茶渍下的名字", "走廊的脚步声", "休息室的烟灰"],
}


def _scene_pool(scene: str, pools: dict) -> list:
    """按场景取素材；非专属场景回落到 frame/solvay 剧本包。"""
    s = str(scene or "")
    if s in pools:
        return pools[s]
    pack = _pack_for_scene(s, None)
    return pools.get(pack) or pools.get("frame") or []


def _score_minigames(text: str) -> list[tuple[str, int]]:
    """按关键词命中次数与词长打分，取最贴合的类型。"""
    t = text or ""
    scored: list[tuple[str, int]] = []
    for mid, kws in _MINIGAME_RULES:
        score = sum(t.count(k) * max(2, len(k)) for k in kws if k in t)
        if score > 0:
            scored.append((mid, score))
    scored.sort(key=lambda item: -item[1])
    return scored


def _detect_minigame(text: str) -> Optional[str]:
    ranked = _score_minigames(text)
    return ranked[0][0] if ranked else None


def _minigame_used(mid: str, flags) -> bool:
    """本局是否已经玩过该类型（兼容 minigame_solvay_archive_done 等命名）。"""
    token = mid.split("-")[0].replace("_", "")
    for f in flags or []:
        s = str(f)
        if not s.startswith("minigame_"):
            continue
        if s == f"minigame_{mid}_done" or token in s.replace("-", "_"):
            return True
    return False


_MINIGAME_DUE_PREFIX = "mg_due:"
# 研究员类闲聊没有内容关键词时，优先按角色补一个贴合场景的小游戏
_CADENCE_MINIGAME_BY_TRIGGER = {
    "astro_scientist": "signal",
    "astro_scientist_back": "archive-sort",
    "astro_scientist_side": "route",
    "researcher": "memory-match",
}

# 没有关键词命中时按场景轮换，优先选择本局尚未出现过的类型
_CADENCE_POOL_BY_SCENE = {
    "office": ["archive-sort", "find-clue", "cleanup", "memory-match"],
    "arpes": ["find-clue", "cleanup", "signal", "route"],
    "astro": ["signal", "route", "find-clue", "memory-match", "connect", "archive-sort"],
    "vr": ["memory-match", "route", "connect", "find-clue", "signal"],
    "solvay": ["seating", "connect", "archive-sort", "find-clue"],
}


def _cadence_minigame_type(trigger: str, scene: str = "", flags=None) -> Optional[str]:
    t = str(trigger or "")
    preferred = None
    for key, mid in _CADENCE_MINIGAME_BY_TRIGGER.items():
        if t == key or t.startswith(key):
            preferred = mid
            break
    if preferred is None and ("scientist" in t or "researcher" in t):
        preferred = "find-clue"
    pool = _CADENCE_POOL_BY_SCENE.get(str(scene or "")) or [
        "signal", "route", "find-clue", "memory-match", "connect", "archive-sort", "cleanup", "seating",
    ]
    ordered: list[str] = []
    if preferred:
        ordered.append(preferred)
    for mid in pool:
        if mid not in ordered:
            ordered.append(mid)
    for mid in ordered:
        if not _minigame_used(mid, flags):
            return mid
    return ordered[0] if ordered else None


def _select_minigame_type(beat: Optional[dict], tree: dict, narration: str,
                          flags, scene: str, trigger: str, event_type: str = "") -> tuple[Optional[str], str]:
    """关键词识别（含生成的对白正文）→ 场景轮换兜底；返回类型与素材文本。"""
    explicit = str((beat or {}).get("minigame") or "").strip()
    if not explicit and str(event_type) == "event_type2":
        return None, ""
    src_text = " ".join(str((beat or {}).get(k, "")) for k in ("title", "prompt", "atmosphere", "description"))
    tree_texts: list[str] = []
    for node in (tree.get("nodes") or {}).values():
        for line in node.get("lines") or []:
            tree_texts.append(str(line.get("text", "")))
        for choice in node.get("choices") or []:
            tree_texts.append(str(choice.get("text", "")))
    keyword_text = " ".join([src_text, str(narration or ""), " ".join(tree_texts)])
    if explicit in _MINIGAME_TITLES:
        return explicit, keyword_text
    if str(scene or "") == "solvay":
        # 索尔维主线的小游戏由本地剧情节点固定控制，避免自动插入覆盖“公式填空/最终引语”等编排
        return None, keyword_text
    ranked = _score_minigames(keyword_text)
    detected = ranked[0][0] if ranked and ranked[0][1] > 0 else None
    detected_used = bool(detected) and _minigame_used(detected, flags)
    # 首次命中优先按关键词；同一类型已玩过则交给轮换，保证其他小游戏也能出现
    if detected and not detected_used:
        return detected, keyword_text
    if f"{_MINIGAME_DUE_PREFIX}{scene}" in (flags or set()):
        return _cadence_minigame_type(trigger, scene, flags), keyword_text
    if detected:
        return detected, keyword_text
    return None, keyword_text


def _minigame_after_line(lines: list, kws: list[str]) -> int:
    """小游戏插入点：至少先看三句，最多插到第五句之后（afterLine 为行下标）。"""
    n = len(lines)
    if n <= 0:
        return 0
    kw_idx = -1
    for i, line in enumerate(lines):
        text = str((line or {}).get("text", ""))
        if any(k in text for k in kws):
            kw_idx = i
            break
    if kw_idx < 0:
        kw_idx = int(n * 0.6)
    return min(n - 1, max(kw_idx, 2), 4)


_ARCHIVE_CARDS = {
    "solvay": {
        "items": [
            {"title": "座位安排表", "snippet": "三十二位学者的席位次序，边角有洛伦兹的手写批注。"},
            {"title": "科学家桌牌", "snippet": "铜版刻字，名字被茶渍晕开了一角。"},
            {"title": "会议议程", "snippet": "上午联合报告，下午自由辩论，附休息时段。"},
            {"title": "签到名册", "snippet": "签名与抵达时间；居里夫人一栏还空着。"},
        ],
        "distractors": [
            {"title": "空白便笺", "snippet": "没有字，纸角卷起，像是随手撕下的。"},
            {"title": "私人信件", "snippet": "未署名的问候，与会议议程无关。"},
            {"title": "旧报纸剪报", "snippet": "关于天气与赛马的旧闻。"},
        ],
    },
    "frame": {
        "items": [
            {"title": "记忆修复日志", "snippet": "损坏率 87% 的修复记录，标注了七层跳转。"},
            {"title": "匿名委托邮件", "snippet": "来源擦除，条件：不备份、不外传。"},
            {"title": "神经接口校准单", "snippet": "接口固件最后一次维护的时间与签名。"},
            {"title": "织女号档案索引", "snippet": "退役空间站的加密索引残页。"},
        ],
        "distractors": [
            {"title": "外卖小票", "snippet": "两份合成咖啡，与委托无关。"},
            {"title": "旧照片", "snippet": "一张模糊的工坊合影。"},
            {"title": "便签涂鸦", "snippet": "随手画的电路草图。"},
        ],
    },
}


def _build_minigame_config(mid: str, text: str, scene: str = "", quest_id: str = "") -> dict:
    if mid == "archive-sort":
        pack = _pack_for_scene(scene or "", None)
        cards = _ARCHIVE_CARDS.get(pack) or _ARCHIVE_CARDS.get("frame")
        return {
            "title": _MINIGAME_TITLES.get(mid, mid),
            "instructions": _MINIGAME_HINTS.get(mid, ""),
            "items": cards["items"],
            "distractors": cards["distractors"],
            "flag": f"minigame_{mid}_done",
            "questId": quest_id,
        }
    if mid == "seating":
        pack = _pack_for_scene(scene or "", None)
        people = _SEATING_PEOPLE.get(pack) or _SEATING_PEOPLE["solvay"]
        return {
            "title": _MINIGAME_TITLES.get(mid, mid),
            "instructions": _MINIGAME_HINTS.get(mid, ""),
            "items": people,
            "distractors": [],
            "flag": f"minigame_{mid}_done",
            "questId": quest_id,
        }
    if mid == "route":
        return {
            "title": _MINIGAME_TITLES.get(mid, mid),
            "instructions": _MINIGAME_HINTS.get(mid, ""),
            "items": [],
            "clues": _scene_pool(scene, _ROUTE_NODES) or ["入口", "中转 1", "废弃节点 2", "织星塔 3", "加密层 4", "中继 5", "织女号阵列 6"],
            "distractors": [],
            "flag": f"minigame_{mid}_done",
            "questId": quest_id,
        }
    if mid == "memory-match":
        return {
            "title": _MINIGAME_TITLES.get(mid, mid),
            "instructions": _MINIGAME_HINTS.get(mid, ""),
            "items": [],
            "clues": _scene_pool(scene, _MEMORY_PAIRS) or ["织女号", "记忆裂痕", "神经接口", "旧照片"],
            "distractors": [],
            "flag": f"minigame_{mid}_done",
            "questId": quest_id,
        }
    if mid == "connect":
        pairs = _scene_pool(scene, _CONNECT_PAIRS) or [("爱因斯坦", "实在论"), ("玻尔", "互补原理"), ("德布罗意", "导航波"), ("薛定谔", "波动力学")]
        return {
            "title": _MINIGAME_TITLES.get(mid, mid),
            "instructions": _MINIGAME_HINTS.get(mid, ""),
            "items": [left for left, _ in pairs],
            "clues": [right for _, right in pairs],
            "distractors": [],
            "flag": f"minigame_{mid}_done",
            "questId": quest_id,
        }
    if mid == "find-clue":
        clues = _FIND_CLUES_BY_SCENE.get(str(scene or "")) or ["模糊的字迹", "被撕掉的一角", "一串坐标", "半枚指纹"]
        return {
            "title": _MINIGAME_TITLES.get(mid, mid),
            "instructions": _MINIGAME_HINTS.get(mid, ""),
            "items": [],
            "clues": clues,
            "distractors": [],
            "flag": f"minigame_{mid}_done",
            "questId": quest_id,
        }
    if mid in ("signal", "cleanup"):
        return {
            "title": _MINIGAME_TITLES.get(mid, mid),
            "instructions": _MINIGAME_HINTS.get(mid, ""),
            "items": [],
            "clues": [],
            "distractors": [],
            "flag": f"minigame_{mid}_done",
            "questId": quest_id,
        }
    frags = [s.strip(" ，,。.;；、：:") for s in re.split(r"[。；;\n，,]", text or "")
             if 2 <= len(s.strip(" ，,。.;；、：:")) <= 18]
    uniq: list[str] = []
    for f in frags:
        if f and f not in uniq:
            uniq.append(f)
    items = uniq[:6] or ["档案甲", "档案乙", "档案丙", "档案丁"]
    clues = uniq[:6] or items
    return {
        "title": _MINIGAME_TITLES.get(mid, mid),
        "instructions": _MINIGAME_HINTS.get(mid, ""),
        "items": items,
        "clues": clues,
        "distractors": [],
        "flag": f"minigame_{mid}_done",
        "questId": quest_id,
    }


def _convert_to_tree(req: dict, beat: Optional[dict], beat_id: str,
                     narration: str, dialogues: list, llm_choices: list,
                     characters: Optional[list] = None) -> dict:
    """Harness 输出 → ECHO DialogueTree（含分支选项与动作）。"""
    default_npc = req.get("npcId") or req.get("trigger") or ""
    # 本场合法说话人：用于消解"研究员"这类跨角色重名（astro_scientist / researcher）
    expected = set((beat or {}).get("characters") or [])
    if req.get("npcId"):
        expected.add(str(req["npcId"]))
    expected.add("su_ran")
    # 本场角色卡名 → echo id 候选（含 ECHO 世界里的在场 NPC）
    name_pool: list[tuple[str, str]] = []
    for c in (characters or []):
        if not isinstance(c, dict):
            continue
        cid = str(c.get("id", "")).strip()
        cname = str(c.get("name", "")).strip()
        if cid and cname and cid in expected:
            name_pool.append((cname, cid))

    def _resolve_speaker(raw: str, fallback: str = "") -> str:
        mapped = _speaker_to_echo(raw, fallback)
        if mapped in expected or mapped == "narrator":
            return mapped
        s = str(raw).strip()
        # 精确名优先，其次最长子串（如"天体物理实验室研究员"优先于"研究员"）
        exact = next((cid for cname, cid in name_pool if cname == s), "")
        if exact:
            return exact
        matches = [(len(cname), cid) for cname, cid in name_pool if cname in s or s in cname]
        if matches:
            return max(matches)[1]
        return fallback if fallback in expected else mapped

    lines = []
    for d in dialogues:
        text = str(d.get("text", "")).strip()
        if not text:
            continue
        speaker = _resolve_speaker(d.get("speaker", ""), default_npc)
        lines.append({"speaker": speaker, "text": text, "emotion": _map_emotion(d.get("emotion", ""))})
    # 场景已有背景与立绘呈现，正常对话不再显示整段旁白；
    # 仅在没有任何对白时用旁白兜底，避免空树。
    if not lines and narration:
        lines.append({"speaker": "narrator", "text": narration, "emotion": "idle"})
    if not lines:
        lines.append({"speaker": "narrator", "text": "（一阵沉默。）", "emotion": "idle"})

    start_node = {"id": "node_01", "lines": lines}
    nodes = {"node_01": start_node}

    authored = (beat.get("choices", []) or []) if beat else []
    if authored:
        choices = []
        for i, c in enumerate(authored):
            cid = c.get("id", f"c{i}")
            outcome_id = f"node_{cid}"
            flag = f"echo_choice:{beat_id}:{cid}"
            actions = list(c.get("actions", []) or [])
            actions.append({"type": "flag.set", "flag": flag})
            choices.append({
                "text": c.get("text", f"选项{i+1}"),
                "next": outcome_id,
                "actions": actions,
            })
            outcome_text = c.get("outcome", "")
            outcome_lines = []
            if outcome_text:
                outcome_lines.append({
                    "speaker": c.get("outcome_speaker", default_npc or "narrator"),
                    "text": outcome_text, "emotion": "idle",
                })
            nodes[outcome_id] = {"id": outcome_id, "lines": outcome_lines}
        start_node["choices"] = choices
    elif llm_choices:
        choices = []
        for i, c in enumerate(llm_choices[:4]):
            text = str(c.get("text", "")).strip()
            if not text:
                continue
            slug = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "_", text)[:24] or f"c{i}"
            flag = f"echo_choice:{beat_id}:{slug}"
            actions = [{"type": "flag.set", "flag": flag}]
            choices.append({
                "text": text, "next": "",
                "actions": actions,
            })
        if choices:
            start_node["choices"] = choices

    return {
        "id": req.get("dialogueId") or f"dlg_echo_{beat_id}",
        "scene": req.get("scene", "office"),
        "trigger": req.get("trigger", ""),
        "eventType": req.get("eventType", "event_type1"),
        "cgUrl": req.get("cgUrl", ""),
        "startNode": "node_01",
        "nodes": nodes,
    }


# ═══════════════════════════════════════════════════════
# NPC 自由对话（SSE，沿用 ECHO /api/chat 协议）
# ═══════════════════════════════════════════════════════

def _chat_system_prompt(req: dict) -> str:
    _build_char_index()
    npc_id = req.get("npcId", "")
    npc_name = req.get("npcName", npc_id)
    scene = req.get("context", {}).get("sceneId", req.get("scene", ""))
    pack_name = _pack_for_scene(scene, None)
    try:
        story = _get_pack(pack_name)
        worldbook = story.get("worldbook", "")
    except Exception:
        worldbook = ""
    info = _char_index.get(npc_id)
    card = (info or {}).get("card") or {}
    profile = req.get("npcProfile") or {}
    personality = card.get("personality") or profile.get("personality", "")
    background = card.get("background") or profile.get("background", "")
    speaking = card.get("speakingStyle") or profile.get("voiceTone", "")

    ctx = req.get("context", {}) or {}
    state_lines = []
    if ctx.get("stage"):
        state_lines.append(f"当前剧情阶段：{ECHO_STAGE_NAMES.get(ctx['stage'], ctx['stage'])}")
    if ctx.get("sceneId"):
        state_lines.append(f"当前场景：{ECHO_SCENE_NAMES.get(ctx['sceneId'], ctx['sceneId'])}")
    flags = [f for f in (ctx.get("flags", []) or [])
             if isinstance(f, str) and not f.startswith(("visited:", "talked:", "stage_", "echo_choice:"))]
    if flags:
        state_lines.append("已发生事件：" + "、".join(flags[:15]))
    history = req.get("history", []) or []
    hist_text = "\n".join(
        f"{'苏然' if h.get('role') == 'user' else npc_name}: {h.get('content', '')}"
        for h in history[-6:]
    ) or "（无）"

    wb_excerpt = worldbook[:1500] if worldbook else ""
    return f"""你是互动叙事游戏《回响》中的角色 {npc_name}。

## 世界书（最高优先级约束）
{wb_excerpt}

## 角色设定
- 性格：{personality}
- 背景：{background}
- 说话风格：{speaking}

## 当前游戏状态
{chr(10).join(state_lines)}

## 对话历史
{hist_text}

## 任务
玩家苏然对你说："{req.get('message', '')}"
请以 {npc_name} 的身份回应。回复必须是严格 JSON：
{{"lines": [{{"speaker": "{npc_id}", "text": "...", "emotion": "idle"}}, {{"speaker": "su_ran", "text": "...", "emotion": "idle"}}]}}

## 规则
- 共 7-9 行。{npc_name} 说 5-6 句，苏然只说 1-2 句（15-30字，追问/感叹）。
- {npc_name} 台词 40-100 字，体现专业知识与个性，可连续 2-3 句再让苏然插话。
- emotion 从 idle/happy/angry/sad/surprise 中选。
- speaker 只能是 "{npc_id}" 或 "su_ran"。
- 符合世界书与角色身份，不要提及扮演，直接进入对话。"""


def chat_stream(req: dict):
    """yield ECHO /api/chat SSE 协议事件：{chunk}… → {node, replyNodes} → [DONE]。"""
    npc_id = req.get("npcId", "")
    system_prompt = _chat_system_prompt(req)
    user_prompt = req.get("message", "")
    client = LLMClient(model=get_settings().deepseek_model)
    full = ""
    try:
        for delta in client.generate_stream(system_prompt, user_prompt,
                                            temperature=0.7, max_tokens=2048):
            full += delta
            yield {"chunk": delta}
    except Exception as e:
        logger.error("[echo_host] chat LLM 失败: %s", e)
        yield {"error": f"模型服务调用失败: {e}"}
        return

    node = _parse_chat_node(full, npc_id)
    yield {"node": node, "replyNodes": []}


def _parse_chat_node(raw: str, npc_id: str) -> dict:
    cleaned = raw.strip().replace("\\n", "\n")
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    lines = []
    try:
        parsed = json.loads(cleaned)
        for l in parsed.get("lines", []):
            text = str(l.get("text", "")).strip()
            if not text:
                continue
            speaker = "su_ran" if l.get("speaker") == "su_ran" else (l.get("speaker") or npc_id)
            lines.append({"speaker": speaker, "text": text,
                          "emotion": _map_emotion(l.get("emotion", "idle"))})
    except (json.JSONDecodeError, AttributeError):
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            try:
                parsed = json.loads(m.group(0))
                for l in parsed.get("lines", []):
                    if l.get("text"):
                        lines.append({"speaker": l.get("speaker") or npc_id,
                                      "text": str(l["text"]).strip(),
                                      "emotion": _map_emotion(l.get("emotion", "idle"))})
            except json.JSONDecodeError:
                pass
    if not lines:
        lines.append({"speaker": npc_id, "text": cleaned[:200] or "……", "emotion": "idle"})
    return {
        "id": f"ai_reply_{int(time.time()*1000)}",
        "lines": lines,
        "choices": [
            {"text": "继续提问", "next": "__ai_chat__"},
            {"text": "再见", "next": "__end__"},
        ],
    }


# ═══════════════════════════════════════════════════════
# 选项后续写（玩家选择后，角色继续回应/解释）
# ═══════════════════════════════════════════════════════

def continue_dialogue(req: dict) -> dict:
    """玩家做出选择后，让角色针对该选择继续回应/解释，返回 {node}。"""
    _build_char_index()
    scene = str(req.get("scene") or "")
    pack_name = _pack_for_scene(scene, None)
    story = _get_pack(pack_name)
    player_choice = str(req.get("playerChoice") or "").strip()
    npc_id = str(req.get("npcId") or req.get("trigger") or "")
    npc_name = str(req.get("npcName") or npc_id)
    info = _char_index.get(npc_id)
    card = info["card"] if info and info.get("card") else {}
    npc_profile = str(req.get("npcProfile") or "").strip()[:300]
    world = req.get("world") or {}
    world_state = _format_world_state(world) if isinstance(world, dict) else ""
    worldbook = str(story.get("worldbook", "") or "")[:800]
    recent = [h for h in (req.get("history") or []) if isinstance(h, dict)]
    recent_text = "\n".join(
        f"- {h.get('speaker', '')}：{str(h.get('text', '')).strip()[:80]}" for h in recent[-6:]
    )
    role = str(card.get("role") or "")
    personality = str(card.get("personality") or "")[:300]
    system = (
        "你是互动叙事引擎。请让指定角色针对玩家刚才的选择继续回应或解释，"
        "严格遵循世界观与角色设定，不得虚构当前世界状态之外的内容。"
    )
    user = (
        f"【世界观】{worldbook}\n"
        f"【角色】{npc_name}（{role}）。性格：{personality}。{npc_profile}\n"
        f"【当前世界状态】\n{world_state}\n"
        f"【最近剧情】\n{recent_text}\n"
        f"【玩家刚刚选择】{player_choice}\n\n"
        "请让该角色就这个选择继续回应/解释，2-4 句，口吻符合角色；可含 1 句旁白(speaker=narrator)。"
        '只输出严格 JSON：{"lines":[{"speaker":"角色id或narrator","text":"...","emotion":"idle"}]}'
    )
    try:
        client = LLMClient(model=get_settings().deepseek_model)
        raw = client.generate(system, user, temperature=0.7, max_tokens=900)
    except Exception as e:
        logger.warning("[echo_host] 续写生成失败: %s", e)
        return {"node": None}

    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    parsed = None
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except json.JSONDecodeError:
                parsed = None

    lines = []
    if isinstance(parsed, dict):
        for l in parsed.get("lines", []):
            if not isinstance(l, dict):
                continue
            text = str(l.get("text", "")).strip()
            if not text:
                continue
            default_spk = npc_id if npc_id else "su_ran"
            raw_spk = str(l.get("speaker") or default_spk).strip()
            if raw_spk in ("narrator", "旁白", "系统通知", ""):
                spk = "narrator"
            elif raw_spk in ("su_ran", "苏然", "玩家"):
                spk = "su_ran"
            else:
                # 续写只可能是当前对话对象的回应，避免“研究员”等重名映射到其他角色
                spk = default_spk
            lines.append({"speaker": spk, "text": text,
                          "emotion": _map_emotion(l.get("emotion", "idle"))})
    if not lines:
        return {"node": None}
    return {"node": {"id": f"cont_{int(time.time() * 1000)}", "lines": lines}}


# ═══════════════════════════════════════════════════════
# 背景图 / 语音合成（让融合不止于文字）
# ═══════════════════════════════════════════════════════

def generate_background(req: dict) -> dict:
    """为 ECHO 场景生成背景图（无人物、可叠加 UI），返回 {url, enabled}。"""
    scene = str(req.get("scene") or "").strip()
    if not scene:
        return {"url": None, "enabled": False}
    pack_name = _pack_for_scene(scene, None)
    story = _get_pack(pack_name)
    scene_name = ECHO_SCENE_NAMES.get(scene, scene)
    worldbook = str(story.get("worldbook", "") or "").strip()[:600]
    atmosphere = str(req.get("atmosphere") or "").strip()
    override = str(req.get("prompt") or "").strip()
    prompt = override or (
        f"视觉小说对话背景（人物不在画面中）：{scene_name}。{atmosphere}。"
        f"世界观参考：{worldbook}。"
        "电影级构图，平视/略带景深的室内场景，氛围光影，画面下三分之一留出较暗区域便于叠加对话框，"
        "写实与科幻/历史质感；满幅构图；不要人物、不要文字、不要水印、不要上下黑边、不要 UI。"
    )
    gen = get_image_generator()
    if not gen.enabled:
        return {"url": None, "enabled": False}
    # 每轮游戏一个 runId：把它并入 asset_id，使同一场景在不同轮次生成不同文件（不复用旧图）
    run_tag = re.sub(r"[^\w]+", "", str(req.get("runId") or ""))[-12:]
    asset_id = f"scene_{scene}_{run_tag}" if run_tag else f"scene_{scene}"
    try:
        url = gen.generate(pack_name, "background", asset_id, prompt,
                           get_settings().image_size_bg)
    except Exception as e:
        logger.warning("[echo_host] 背景生成失败: %s", e)
        url = None
    return {"url": url, "enabled": True, "prompt": prompt}


# 角色 → 性别音色池与稳定索引（角色卡归一化后无 gender/age，这里显式分配以保证不同角色不同音色）
_FEMALE_CHARS = {"su_ran", "solvay_curie"}
_MALE_CHARS = {
    "lin_xiao", "du_weiming", "astro_scientist", "researcher",
    "solvay_einstein", "solvay_bohr", "solvay_heisenberg", "solvay_schrodinger",
    "solvay_pauli", "solvay_born", "solvay_lorentz", "solvay_de_broglie",
}
_VOICE_INDEX = {
    "su_ran": 0, "solvay_curie": 2,
    "lin_xiao": 1, "du_weiming": 1, "astro_scientist": 2, "researcher": 3,
    "solvay_heisenberg": 0, "solvay_de_broglie": 0,
    "solvay_pauli": 1, "solvay_schrodinger": 1,
    "solvay_einstein": 2, "solvay_born": 2,
    "solvay_bohr": 3, "solvay_lorentz": 3,
}


def _pick_voice(gen, speaker: str) -> str:
    """为角色挑选音色：显式 voice 字段 > 性别音色池按索引 > 默认。"""
    info = _char_index.get(speaker)
    card = info["card"] if info else {}
    for key in ("voiceSample", "voice_sample", "voiceId", "voice_id"):
        value = str(card.get(key, "") or "").strip()
        if value:
            return value
    if speaker in _FEMALE_CHARS:
        pool = list(getattr(gen, "voice_female_by_age", []) or [])
    elif speaker in _MALE_CHARS:
        pool = list(getattr(gen, "voice_male_by_age", []) or [])
    else:
        pool = []
    if pool:
        idx = _VOICE_INDEX.get(speaker, abs(hash(speaker)) % len(pool))
        return pool[idx % len(pool)]
    return gen.default_voice


def synthesize_voice(req: dict) -> dict:
    """为对白文本合成语音，返回 {url, enabled}。"""
    text = str(req.get("text") or "").strip()
    if not text:
        return {"url": None, "enabled": False}
    speaker = str(req.get("speaker") or req.get("npcId") or "narrator")
    pack_name = _pack_for_scene(str(req.get("scene") or ""), None)
    gen = get_tts_generator()
    if not gen.enabled:
        return {"url": None, "enabled": False}
    _build_char_index()
    try:
        voice_id = _pick_voice(gen, speaker)
    except Exception:
        voice_id = ""
    try:
        url = gen.generate(pack_name, speaker, text[:300], voice_id)
    except Exception as e:
        logger.warning("[echo_host] 语音合成失败: %s", e)
        url = None
    return {"url": url, "enabled": True}


# ═══════════════════════════════════════════════════════
# 结局匹配
# ═══════════════════════════════════════════════════════

_STAT_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_一-鿿]*)\s*(>=|<=|>|<|≥|≤|=)\s*(-?\d+)")
_CMP = {
    ">=": lambda a, b: a >= b, "≥": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b, "≤": lambda a, b: a <= b,
    ">": lambda a, b: a > b, "<": lambda a, b: a < b,
    "=": lambda a, b: a == b,
}


def _match_single_stat(value: str, stats: dict) -> bool:
    m = _STAT_RE.search(value)
    if not m:
        return False
    name, op, num = m.group(1), m.group(2), int(m.group(3))
    return _CMP.get(op, lambda a, b: False)(stats.get(name, 0), num)


def _match_stat_condition(value: str, stats: dict) -> bool:
    """支持单条数值比较、'且' 复合条件，以及自然语言聚合条件。

    聚合：'所有属性值均<30' → 全部属性满足；'至少与5个角色好感度≥60' → 计数。
    """
    v = value.strip()
    if "所有" in v:
        m_all = re.search(r"(>=|<=|>|<|≥|≤|=)\s*(-?\d+)", v)
        if m_all:
            cmp = _CMP.get(m_all.group(1), lambda a, b: False)
            num = int(m_all.group(2))
            return all(cmp(s, num) for s in stats.values()) if stats else cmp(0, num)
    m_cnt = re.search(r"至少.*?(\d+)\s*个.*?(?:好感度|affinity).*?(>=|≥|>)\s*(-?\d+)", v)
    if m_cnt:
        need, num = int(m_cnt.group(1)), int(m_cnt.group(3))
        cmp = _CMP.get(m_cnt.group(2), lambda a, b: False)
        count = sum(1 for k, s in stats.items()
                    if ("好感度" in k or "affinity" in k) and cmp(s, num))
        return count >= need
    parts = [p.strip() for p in re.split(r"且|并且|而且|and|、", v) if p.strip()]
    if len(parts) > 1:
        return all(_match_single_stat(p, stats) for p in parts)
    return _match_single_stat(v, stats)


def _text_similar(a: str, b: str) -> bool:
    """中文二元组重叠率 ≥ 0.5 视为同一选项（用于叙事引用的模糊匹配）。"""
    if not a or not b:
        return False
    ga = {a[i:i + 2] for i in range(len(a) - 1)}
    gb = {b[i:i + 2] for i in range(len(b) - 1)}
    if not ga or not gb:
        return False
    return len(ga & gb) / min(len(ga), len(gb)) >= 0.5


def _choice_hit(c: dict, target: str) -> bool:
    cid, text = c.get("choice", ""), c.get("text", "")
    if target == cid or target in cid or target in text:
        return True
    return _text_similar(target, text)


def _match_choice_condition(value: str, choices: list) -> bool:
    """支持 'choice_final选择cf_a' / '在scene_XX选择YY' / 直接选项 id/文本。

    剧本包用 choice_final/scene_05 等叙事引用，与宿主节拍 id 不同名；
    先按节拍/场景限定匹配，再回退到按选项 id/文本全局匹配。
    """
    m = re.search(r"(?:在)?\s*([A-Za-z0-9_]+).{0,6}(?:选择|选)\s*([\w一-鿿（）()]+)", value)
    if m:
        target_beat, target_choice = m.group(1), m.group(2).strip()
        for c in choices:
            if target_beat in (c.get("beat", ""), c.get("scene", "")) and _choice_hit(c, target_choice):
                return True
        for c in choices:
            if _choice_hit(c, target_choice):
                return True
        return False
    return any(value in c.get("text", "") or value in c.get("choice", "") for c in choices)


def match_ending(req: dict) -> dict:
    _build_char_index()
    session_id = req.get("sessionId") or "echo-default"
    session = _get_session(session_id)
    _record_choice_flags(session, req.get("flags", []))
    flags = set(req.get("flags", []) or [])
    scene = req.get("scene", "solvay")
    pack_name = req.get("pack") or _pack_for_scene(scene, None)
    story = _get_pack(pack_name)
    endings = story.get("endings", []) or []
    stats = session["stats"]
    choices = session["choices"]

    scored = []
    for ending in endings:
        if not isinstance(ending, dict):
            continue
        score, total = 0, 0
        choice_match = False
        threshold_ok = True
        flag_ok = True
        for cond in ending.get("trigger_conditions", []) or []:
            if not isinstance(cond, dict):
                continue
            ctype = str(cond.get("type", "")).strip()
            value = str(cond.get("value", ""))
            total += 1
            if ctype == "stats_threshold":
                ok = _match_stat_condition(value, stats)
            elif ctype in ("choice_made", "hidden_choices"):
                ok = _match_choice_condition(value, choices)
            elif ctype == "flag":
                ok = value in flags
            else:
                ok = False
            if ok:
                score += 2
                if ctype in ("choice_made", "hidden_choices"):
                    choice_match = True
            elif ctype == "stats_threshold":
                threshold_ok = False
            elif ctype == "flag":
                flag_ok = False
        scored.append({
            "ending": ending,
            "norm": score / max(total, 1),
            "choice_match": choice_match,
            "strict": threshold_ok and flag_ok,
        })

    def pick(tier) -> Optional[dict]:
        pool = [s for s in scored if tier(s)]
        return max(pool, key=lambda s: s["norm"])["ending"] if pool else None

    # 优先级：终局/隐藏选择命中 > 纯阈值型（如沉默结局）> 部分命中兜底。
    # 这样 cf_a/b/c/d 的立场选择始终能决定走向，属性阈值只用于解锁隐藏结局。
    best = None
    for tier in (
        lambda s: s["choice_match"] and s["strict"],
        lambda s: s["choice_match"],
        lambda s: s["strict"],
        lambda s: s["norm"] > 0,
    ):
        best = pick(tier)
        if best is not None:
            break
    if best is None:
        best = endings[0] if endings else None
    if best is None:
        return {"tree": None, "ending": None}

    tree = _ending_to_tree(req, best)
    return {
        "tree": tree,
        "ending": {"id": best.get("id", ""), "title": best.get("title", ""),
                   "type": best.get("type", "normal")},
    }


def _ending_to_tree(req: dict, ending: dict) -> dict:
    narrative = str(ending.get("narrative", "")).strip()
    epilogue = str(ending.get("epilogue", "")).strip()
    lines = []
    title = ending.get("title", "结局")
    lines.append({"speaker": "narrator", "text": f"—— {title} ——", "emotion": "idle"})
    for para in [p.strip() for p in narrative.split("\n") if p.strip()]:
        lines.append({"speaker": "narrator", "text": para, "emotion": "idle"})
    if epilogue:
        lines.append({"speaker": "narrator", "text": "【尾声】", "emotion": "idle"})
        for para in [p.strip() for p in epilogue.split("\n") if p.strip()]:
            lines.append({"speaker": "narrator", "text": para, "emotion": "idle"})
    return {
        "id": f"dlg_ending_{ending.get('id', 'final')}",
        "scene": req.get("scene", "solvay"),
        "trigger": "auto",
        "eventType": req.get("eventType", "event_type2"),
        "cgUrl": req.get("cgUrl", ""),
        "startNode": "node_01",
        "nodes": {"node_01": {"id": "node_01", "lines": lines}},
    }