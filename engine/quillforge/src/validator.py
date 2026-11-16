# -*- coding: utf-8 -*-
"""
Narrative Generation Harness — 验证器
实现 Stage 5 Validation Gate 的所有校验逻辑

实现 Validator 协议接口，支持可插拔替换。
"""

from __future__ import annotations
import re
from abc import ABC, abstractmethod
from schemas import (
    Dialogue, Choice, AssembledContext, HarnessOutput,
    ValidationCheck, ValidationResult,
)


def _load_validation_thresholds() -> dict:
    """从 config 读取 validationGate.thresholds；读取失败时返回空 dict 交由默认值兜底。"""
    try:
        from config_manager import load_config
        thresholds = (load_config().get("quillforge", {}).get("stages", {})
                      .get("validationGate", {}).get("thresholds", {}))
        return thresholds if isinstance(thresholds, dict) else {}
    except Exception:
        return {}


# ═══════════════════════════════════════════════════════
# Validator 协议接口
# ═══════════════════════════════════════════════════════

class Validator(ABC):
    """验证器协议接口：所有验证器必须实现此接口"""

    @abstractmethod
    def validate_all(
        self,
        narration: str,
        dialogues: list[Dialogue],
        choices: list[Choice],
        retry_count: int = 0,
    ) -> ValidationResult:
        """执行全部验证，返回汇总结果"""
        ...


# ═══════════════════════════════════════════════════════
# 默认验证器实现
# ═══════════════════════════════════════════════════════

class NarrativeValidator(Validator):
    """叙事内容验证器（实现 Validator 协议）"""

    VALID_EMOTIONS = {
        # 中文
        "平静", "急切", "分析", "果断", "担忧",
        "愤怒", "希望", "好奇", "沉着", "讽刺",
        "恐惧", "坚定", "紧张", "释然", "中性",
        # 英文（兼容）
        "calm", "urgent", "analytical", "decisive", "worried",
        "angry", "hopeful", "curious", "composed", "sarcastic",
        "fearful", "excited", "neutral", "tense", "relieved",
        "determined",
    }

    VALID_IMPACTS = {"advance", "advance_risky", "stay_current", "side_branch"}

    def __init__(self, context: AssembledContext, min_dialogues: int = 3, max_dialogues: int = 5,
                 thresholds: dict | None = None, judge=None,
                 allowed_entities: str = "", script_scene_raw: str = "",
                 script_global_raw: str = ""):
        """
        Args:
            thresholds: 验证阈值，来自 config/quillforge_config.yaml
                quillforge.stages.validationGate.thresholds，支持键：
                personalityMatchScore / worldlineAdherenceScore / worldlineAdherenceScoreFinal
                / personalitySeverity / personalityJudge
                未显式注入时自行从 config 读取。
            judge: 可选的性格 LLM 评审回调 `judge(char, lines) -> float | None`，
                由 Stage 5 注入（实现见 NarrativeSUT.judge_personality）。
                关键词词表完全未命中时用它兜底，避免恒定中性分导致检查失效。
            allowed_entities / script_scene_raw / script_global_raw: 剧本事实基准，
                供 check_script_entity_fidelity 判定「剧本外实体」。默认空字符串，
                未注入时该检查自动跳过，保持既有调用方向后兼容。
        """
        self.context = context
        self.min_dialogues = min_dialogues
        self.max_dialogues = max_dialogues
        _t = thresholds if thresholds is not None else _load_validation_thresholds()
        self.thresholds = _t
        self.personality_threshold = float(_t.get("personalityMatchScore", 0.5))
        self.personality_severity = str(_t.get("personalitySeverity", "high"))
        self.personality_judge_enabled = bool(_t.get("personalityJudge", True))
        self.worldline_threshold = float(_t.get("worldlineAdherenceScore", 0.12))
        self.worldline_threshold_final = float(_t.get("worldlineAdherenceScoreFinal", 0.08))
        self.character_names = {c.name for c in context.active_characters}
        self.allowed_entities = allowed_entities or ""
        self.script_scene_raw = script_scene_raw or ""
        self.script_global_raw = script_global_raw or ""
        self._judge = judge

    def validate_all(
        self,
        narration: str,
        dialogues: list[Dialogue],
        choices: list[Choice],
        retry_count: int = 0,
    ) -> ValidationResult:
        """执行全部验证，返回汇总结果"""
        checks = [
            self.check_schema(narration, dialogues, choices),
            self.check_dialogue_count(dialogues),
            self.check_character_consistency(dialogues),
            self.check_consecutive_speaker(dialogues),
            self.check_personality_match(dialogues),
            self.check_worldline_adherence(narration, dialogues),
            self.check_choice_diversity(choices),
            self.check_choice_validity(choices),
        ]

        # 判断总体是否通过
        # Critical 或 High 级别的失败 = 总体不通过
        passed = all(
            c.passed for c in checks if c.severity in ("critical", "high")
        )

        return ValidationResult(
            passed=passed,
            checks=checks,
            retry_count=retry_count,
        )

    # ═══════════════════════════════════════════════════════
    # 剧本贴合度：剧本外实体检测（由 Stage 5 追加调用）
    # ═══════════════════════════════════════════════════════

    ENTITY_SUFFIXES = (
        "公司", "集团", "组织", "协会", "研究所", "学院", "大学", "医院", "酒店",
        "实验室", "工坊", "基地", "空间站", "会议室", "大厅", "塔", "舰", "城",
        "局", "站", "系统", "计划", "事件", "案",
    )
    PERSON_TITLES = ("先生", "女士", "小姐", "博士", "教授", "警官", "队长", "老板", "经理")
    GENERIC_PREFIXES = ("这", "那", "某", "一", "整个", "所有", "我们", "他们",
                        "自己", "新的", "旧的", "一座", "一家", "我", "你", "他",
                        "她", "它", "谁", "有", "没", "个", "位", "名")
    # 专有实体里不该出现的虚词、代词和动作词。命中即视为句子碎片，
    # 避免把「越过你的肩膀望向酒店」「像一根钉进这座城」当成剧本外实体。
    ENTITY_NOISE_MARKERS = (
        "的", "了", "着", "过", "是", "我", "你", "他", "她", "它",
        "这", "那", "就", "像", "又", "还", "也", "都", "把", "被",
        "让", "使", "望", "看见", "看到", "发现", "走进", "走入",
        "来到", "站在", "坐在", "越过", "经过", "早就", "早已",
        "退役", "封锁", "说道", "觉得",
    )
    ENTITY_LEADING_NOISE = (
        "这是", "那是", "还有", "以及", "来到", "走进", "走入", "进入",
        "抵达", "穿过", "站在", "坐在", "望向", "看向", "发现", "看到",
        "看见", "越过", "经过", "回到", "前往", "离开", "靠近", "推开",
        "打开", "是", "像", "在", "从", "向", "到", "了", "着", "过",
        "又", "还", "也", "都", "就",
    )

    def _extract_entity_candidates(self, text: str) -> list[str]:
        """抽取高置信度的专有实体候选。宁可漏判，不可误判。"""
        cands: list[str] = []
        for m in re.findall(r'[「《“『]([^」》”』\n]{2,12})[」》”』]', text):
            cands.append(m.strip())
        for m in re.finditer(
            r'([\u4e00-\u9fff]{1,4})(' + "|".join(self.PERSON_TITLES) + r')', text
        ):
            cands.append(m.group(0))
        for m in re.finditer(
            r'([\u4e00-\u9fff]{2,8})(' + "|".join(self.ENTITY_SUFFIXES) + r')', text
        ):
            cands.append(m.group(0))
        return cands

    @classmethod
    def _split_entity_candidate(cls, cand: str) -> tuple[str, str]:
        """把候选拆成核心词与实体后缀；无后缀时核心即候选本身。"""
        # 「空间站」「酒店」本身就是裸后缀，不能再拆成「空间」+「站」，
        # 否则它会变成放行所有同类专名的白名单。
        if cand in cls.ENTITY_SUFFIXES or cand in cls.PERSON_TITLES:
            return cand, ""
        for suffix in cls.ENTITY_SUFFIXES + cls.PERSON_TITLES:
            if cand.endswith(suffix) and len(cand) > len(suffix):
                return cand[: -len(suffix)], suffix
        return cand, ""

    @classmethod
    def _clean_entity_core(cls, core: str) -> str:
        """剥掉候选核心上的标点、前置动词和尾部的「的 / 之」。"""
        core = core.strip(" \t\n，。！？、；：,.!?;:…—-")
        changed = True
        while changed and core:
            changed = False
            for prefix in cls.ENTITY_LEADING_NOISE:
                if core.startswith(prefix) and len(core) > len(prefix) + 1:
                    core = core[len(prefix):]
                    changed = True
                    break
        while len(core) > 2 and core.endswith(("的", "之")):
            core = core[:-1]
        return core

    @classmethod
    def _has_entity_noise(cls, core: str) -> bool:
        return any(marker in core for marker in cls.ENTITY_NOISE_MARKERS)

    @staticmethod
    def _is_corpus_grounded(core: str, corpus: str) -> bool:
        """核心词能否完全由剧本原文中的连续片段拼出。

        「旧城区顶层工坊」可由「旧城区」「顶层」拼成，属于复述剧本；
        「天网空间站」的「天网」在原文中不存在，仍应拦截。
        """
        if not core or not corpus:
            return False
        pos = 0
        while pos < len(core):
            matched = 0
            for end in range(len(core), pos + 1, -1):
                if core[pos:end] in corpus:
                    matched = end - pos
                    break
            if matched < 2:
                return False
            pos += matched
        return True

    def check_script_entity_fidelity(self, narration: str, dialogues: list[Dialogue],
                                     choices: list[Choice]) -> ValidationCheck:
        """检查生成内容是否出现剧本之外的人 / 地 / 事件 / 道具。

        独立于 validate_all 的 8 项检查，由 Stage 5 追加调用，避免破坏
        既有「八项校验」契约。severity=high，未通过会真正阻断重试。
        """
        if not (self.allowed_entities or self.script_scene_raw):
            return ValidationCheck(
                name="script_entity_fidelity", passed=True, severity="high",
                detail="未注入剧本实体清单，跳过检查", score=1.0,
            )

        parts = [narration or ""]
        parts.extend(getattr(d, "text", "") or "" for d in (dialogues or []))
        for c in (choices or []):
            parts.append(getattr(c, "text", "") or "")
            parts.append(getattr(c, "effect", "") or "")
        generated = "\n".join(parts)
        corpus = "\n".join(filter(None, (
            self.allowed_entities, self.script_scene_raw, self.script_global_raw,
        )))
        allowed_names = [n.strip() for n in self.allowed_entities.splitlines() if n.strip()]
        # 领属写法「苏然的记忆工坊」等价于实体本身「记忆工坊」，一并纳入，
        # 否则「退回记忆工坊」这类正常表达会被误判成剧本外实体。
        expanded = set(allowed_names)
        for n in allowed_names:
            if "的" in n:
                tail = n.split("的", 1)[1].strip()
                if len(tail) >= 2:
                    expanded.add(tail)
        allowed_names = sorted(expanded, key=len, reverse=True)

        # 剧本原文里出现过的“核心 + 实体后缀”组合也算已知实体。
        # 例如世界书写了「织女号空间站」，生成文里的「来源标注是织女号空间站」
        # 应视为复述剧本，而不是另造实体。只收完整名称，避免把「空间站」
        # 这种裸后缀当成放行所有空间站的白名单。
        bare_suffixes = set(self.ENTITY_SUFFIXES) | set(self.PERSON_TITLES)
        known_names = {n for n in allowed_names if n not in bare_suffixes}
        for name in self._extract_entity_candidates(corpus):
            core, suffix = self._split_entity_candidate(name)
            core = self._clean_entity_core(core)
            if not suffix or not core or len(core) < 2:
                continue
            if self._has_entity_noise(core):
                continue
            known_names.add(core + suffix)
        known_names = sorted(known_names, key=len, reverse=True)

        bad: list[str] = []
        for cand in self._extract_entity_candidates(generated):
            core, suffix = self._split_entity_candidate(cand)
            core = self._clean_entity_core(core)
            display = (core + suffix) if suffix else core
            min_core_len = 1 if suffix in self.PERSON_TITLES else 2
            if len(core) < min_core_len or any(core.startswith(p) for p in self.GENERIC_PREFIXES):
                continue
            if cand in corpus or core in corpus:
                continue
            # 正则会把动词一起吞进来（如「你走进记忆工坊」），只要候选里
            # 嵌着剧本已知实体，就说明是在复述剧本而非另造实体。
            if any(n in cand or core in n or n in core for n in known_names):
                continue
            if any(n in cand for n in self.character_names):
                continue
            if core in self.character_names:
                continue
            # 剥掉前缀后仍含虚词、代词或动作词，说明是句子碎片，不是专名。
            if self._has_entity_noise(core):
                continue
            # 核心词完全由剧本原文片段拼成，属于对已有地点的复述，
            # 例如「旧城区顶层工坊」；只有真正新造的专名才拦截。
            if self._is_corpus_grounded(core, corpus):
                continue
            bad.append(display)

        bad = list(dict.fromkeys(bad))
        return ValidationCheck(
            name="script_entity_fidelity",
            passed=not bad,
            severity="high",
            detail=("检测到剧本外实体：" + "、".join(bad[:8]) +
                    "。请删除这些名称，只用剧本原文里已有的人、地、事件、道具重新生成。")
            if bad else "未发现剧本外实体",
            score=0.0 if bad else 1.0,
        )

    def check_schema(self, narration: str, dialogues: list[Dialogue], choices: list[Choice]) -> ValidationCheck:
        """Schema 合规检查"""
        issues = []
        if not narration or len(narration.strip()) < 10:
            issues.append("旁白过短")
        if not dialogues:
            issues.append("无对话")
        if not choices:
            issues.append("无选择项")
        for d in dialogues:
            if not d.speaker or not d.text:
                issues.append(f"对话缺少 speaker 或 text: {d}")
        for c in choices:
            if not c.text or not c.effect:
                issues.append(f"选择缺少 text 或 effect: {c}")

        return ValidationCheck(
            name="schema_compliance",
            passed=len(issues) == 0,
            severity="critical",
            detail="; ".join(issues) if issues else "合规",
        )

    def check_dialogue_count(self, dialogues: list[Dialogue]) -> ValidationCheck:
        """对话轮数检查：至少 min 轮，最多 max 轮"""
        count = len(dialogues)
        ok = self.min_dialogues <= count <= self.max_dialogues
        return ValidationCheck(
            name="dialogue_count",
            passed=ok,
            severity="high",
            detail=f"{count} 轮对话（要求 {self.min_dialogues}-{self.max_dialogues}）",
        )

    def check_character_consistency(self, dialogues: list[Dialogue]) -> ValidationCheck:
        """角色一致性：所有 speaker 必须在角色卡列表中"""
        unknown = [d.speaker for d in dialogues if d.speaker not in self.character_names]
        ok = len(unknown) == 0
        return ValidationCheck(
            name="character_consistency",
            passed=ok,
            severity="critical",
            detail=f"未识别的角色: {set(unknown)}" if unknown else "所有对话角色匹配",
        )

    def check_consecutive_speaker(self, dialogues: list[Dialogue]) -> ValidationCheck:
        """连续发言检查：同一角色不得连续发言 3 轮以上"""
        max_consecutive = 0
        current_speaker = None
        current_count = 0
        for d in dialogues:
            if d.speaker == current_speaker:
                current_count += 1
            else:
                current_speaker = d.speaker
                current_count = 1
            max_consecutive = max(max_consecutive, current_count)

        ok = max_consecutive <= 2
        return ValidationCheck(
            name="consecutive_speaker",
            passed=ok,
            severity="medium",
            detail=f"最大连续发言 {max_consecutive} 轮" if not ok else "无超长连续发言",
        )

    def check_personality_match(self, dialogues: list[Dialogue]) -> ValidationCheck:
        """
        性格匹配度检查
        主路径：性格关键词词表启发式打分
        兜底：词表对本次角色零命中时，用注入的 LLM 评审回调打分（`personalityJudge`）
        默认 severity=high，即性格违背会触发 Stage 5 重试（可在配置里降级）
        """
        # 性格 → 正面关键词 / 反面关键词
        personality_keywords = {
            "冷静": {
                "positive": ["数据", "概率", "计算", "分析", "参数", "合理", "逻辑", "精确"],
                "negative": ["啊啊啊", "天哪", "完了完了", "救命"],
            },
            "理性": {
                "positive": ["根据", "依据", "推断", "判断", "评估", "考虑"],
                "negative": ["不管了", "随便", "爱怎样怎样"],
            },
            "果断": {
                "positive": ["执行", "现在", "马上", "立刻", "行动", "出发"],
                "negative": ["要不……", "我再想想", "可能也许大概"],
            },
            "务实": {
                "positive": ["结果", "效率", "实际", "方案", "可行"],
                "negative": ["如果当初", "要是能", "要是可以的话"],
            },
            "热血": {
                "positive": ["冲", "拼了", "不怕", "一起上", "绝不退缩"],
                "negative": ["算了", "放弃吧", "太危险了"],
            },
            "温柔": {
                "positive": ["没关系", "别担心", "大家", "一起", "小心"],
                "negative": ["滚", "闭嘴", "你懂什么"],
            },
            # ── 扩展性格类型（覆盖更多剧本角色设定） ──
            "克制": {
                "positive": ["我们", "建议", "不妨", "或许", "请"],
                "negative": ["我不管", "必须听我的", "你给我"],
            },
            "控制": {
                "positive": ["安排", "计划", "掌控", "秩序", "规则", "管理"],
                "negative": ["随便你", "无所谓", "都行"],
            },
            "好奇": {
                "positive": ["为什么", "怎么回事", "有意思", "想知道", "探索", "发现"],
                "negative": ["不想知道", "无所谓", "跟我没关系"],
            },
            "保护": {
                "positive": ["小心", "安全", "保护", "别冒险", "注意", "担心"],
                "negative": ["不管你了", "你自己看着办", "随便你"],
            },
            "固执": {
                "positive": ["必须坚持", "不会改变", "一定", "绝不", "无论如何"],
                "negative": ["算了", "听你的吧", "我放弃"],
            },
            "观察": {
                "positive": ["注意到", "细节", "发现", "看起来", "不对劲", "异常"],
                "negative": ["没注意", "无所谓", "都一样"],
            },
            "正义": {
                "positive": ["真相", "公正", "揭露", "不能容忍", "必须公开"],
                "negative": ["算了吧", "多一事不如少一事", "别管了"],
            },
            "幽默": {
                "positive": ["哈哈", "开玩笑", "有趣", "别说", "嘿"],
                "negative": ["无聊", "不好笑", "别闹"],
            },
            "封闭": {
                "positive": ["没事", "我自己", "不用管", "一个人", "不需要"],
                "negative": ["帮帮我", "我需要你", "求你了"],
            },
            "自信": {
                "positive": ["我能", "没问题", "交给我", "放心", "当然"],
                "negative": ["我不行", "做不到", "太难了"],
            },
        }

        scores = []
        evidence = 0  # 词表实际命中的正/反面词次数，为 0 说明词表对本次角色无效
        lines_by_char: dict[str, list[str]] = {}
        for d in dialogues:
            char = next((c for c in self.context.active_characters if c.name == d.speaker), None)
            if not char:
                continue
            lines_by_char.setdefault(char.name, []).append(d.text)
            score = 1.0  # 默认满分
            for trait in personality_keywords:
                if trait in char.personality:
                    kw = personality_keywords[trait]
                    pos_hits = sum(1 for w in kw["positive"] if w in d.text)
                    neg_hits = sum(1 for w in kw["negative"] if w in d.text)
                    evidence += pos_hits + neg_hits
                    if neg_hits > 0:
                        # 有反面词：从墓准线扣分
                        trait_score = max(0.0, 0.5 - neg_hits * 0.3 + pos_hits * 0.1)
                    elif pos_hits > 0:
                        # 有正面词：加分
                        trait_score = min(1.0, 0.5 + pos_hits * 0.2)
                    else:
                        # 无正反词命中：不扣分，给中性分
                        trait_score = 0.6
                    score = min(score, trait_score)
            scores.append(score)

        avg_score = sum(scores) / max(len(scores), 1)
        judged = False

        # 词表零命中 → 启发式分恒为中性值，改用 LLM 评审兜底
        if evidence == 0 and scores and self._judge is not None and self.personality_judge_enabled:
            judge_scores = []
            for name, lines in lines_by_char.items():
                char = next((c for c in self.context.active_characters if c.name == name), None)
                if char is None:
                    continue
                try:
                    s = self._judge(char, lines)
                except Exception:
                    s = None
                if s is not None:
                    judge_scores.append(float(s))
            if judge_scores:
                avg_score = sum(judge_scores) / len(judge_scores)
                judged = True

        ok = avg_score >= self.personality_threshold

        if evidence == 0 and not judged:
            # 既没命中词表也没有可用 LLM 评审：不阻塞，只提示检查未生效
            severity = "medium"
            detail = f"启发式得分 {avg_score:.2f}（性格词表未命中且未启用 LLM 评审，仅供参考）"
        else:
            severity = self.personality_severity
            source = "LLM 评审" if judged else "启发式词表"
            detail = f"{source}得分: {avg_score:.2f}"

        return ValidationCheck(
            name="personality_match",
            passed=ok,
            severity=severity,
            detail=detail,
            score=round(avg_score, 2),
        )

    def check_worldline_adherence(self, narration: str, dialogues: list[Dialogue]) -> ValidationCheck:
        """主线符合度检查（通用启发式，不绑定特定题材）"""
        all_text = narration + " " + " ".join(d.text for d in dialogues)

        # 检查是否包含当前节点和下一节点的相关关键词
        node_mentioned = 0
        total_nodes_checked = 0
        is_final_scene = not self.context.next_node  # 无下一节点 = 终局场景
        hit_details = []  # 记录命中的关键词，便于调试

        for node_name in [self.context.current_node, self.context.next_node]:
            if not node_name:
                continue
            total_nodes_checked += 1
            # 直接匹配节点名
            if node_name in all_text:
                node_mentioned += 1
                hit_details.append(f"节点[{node_name}]精确命中")
                continue
            # 动态推导：将节点名拆分为 2-3 字子词做模糊匹配
            node_sub_kws = self._extract_keywords(node_name)
            matched_sub = [kw for kw in node_sub_kws if kw in all_text]
            if matched_sub:
                node_mentioned += 1
                hit_details.append(f"节点[{node_name}]子词命中:{','.join(matched_sub[:3])}")
                continue
            # 2-gram 模糊匹配：将节点名拆为连续 2 字片段
            node_chars = node_name.replace(" ", "")
            bigrams = [node_chars[i:i+2] for i in range(len(node_chars) - 1) if len(node_chars[i:i+2]) == 2]
            bigram_hits = [bg for bg in bigrams if bg in all_text]
            if bigram_hits and len(bigram_hits) >= max(1, len(bigrams) // 2):
                node_mentioned += 1
                hit_details.append(f"节点[{node_name}]bigram命中:{','.join(bigram_hits[:3])}")
                continue
            # 检查场景描述关键词是否出现在节点名中
            scene_kws_for_node = self._extract_keywords(self.context.scene_description)
            if any(kw in node_name for kw in scene_kws_for_node if len(kw) >= 2):
                node_mentioned += 1
                hit_details.append(f"节点[{node_name}]场景词关联")

        # 终局场景特殊处理：检查结局/选择/真相等关键词
        if is_final_scene:
            ending_kws = ["选择", "真相", "结局", "最终", "最后", "决定", "证据", "公开", "沉默", "忘记", "交易", "命运", "未来", "结束"]
            ending_hits = sum(1 for kw in ending_kws if kw in all_text)
            if ending_hits >= 2:
                node_mentioned += 1
                total_nodes_checked += 1
                hit_details.append(f"终局词命中{ending_hits}个")

        # 检查场景描述中的核心关键词（2-4字的有意义词）
        scene_kws = self._extract_keywords(self.context.scene_description)
        # 补充角色名作为关键词（角色始终与世界线相关）
        char_names = [c.name for c in self.context.active_characters if c.name]
        extended_kws = list(dict.fromkeys(scene_kws + char_names))  # 去重保序
        scene_hits = sum(1 for kw in extended_kws if kw in all_text)
        hit_kw_list = [kw for kw in extended_kws if kw in all_text]
        # 用固定基准而非关键词总数，避免长描述稀释命中率
        scene_score = min(1.0, scene_hits / max(min(len(extended_kws), 8), 1))

        # 综合得分：场景关键词权重更高（通用架构下节点名精确匹配不可靠）
        node_score = min(1.0, node_mentioned / max(total_nodes_checked, 1))
        combined = scene_score * 0.7 + node_score * 0.3
        # 终局场景阈值略低（终局内容更偏情感/抉择，不易命中场景关键词）
        threshold = self.worldline_threshold_final if is_final_scene else self.worldline_threshold
        ok = combined >= threshold

        detail_str = (
            f"主线关联度: {combined:.2f} (节点匹配: {node_mentioned}/{total_nodes_checked}, "
            f"场景词命中: {scene_hits}/{len(extended_kws)}"
            f"{'，终局' if is_final_scene else ''})"
        )
        if hit_details:
            detail_str += f" | 命中: {'; '.join(hit_details[:4])}"

        return ValidationCheck(
            name="worldline_adherence",
            passed=ok,
            severity="high",
            detail=detail_str,
            score=round(combined, 2),
        )

    def check_choice_diversity(self, choices: list[Choice]) -> ValidationCheck:
        """选择多样性检查"""
        if len(choices) < 2:
            return ValidationCheck(
                name="choice_diversity",
                passed=False,
                severity="high",
                detail="选择项不足 2 个",
            )

        # 检查效果描述不重复
        effects = [c.effect for c in choices]
        unique_effects = set(effects)
        ok = len(unique_effects) == len(effects)

        # 检查 impact 类型多样性
        impacts = {c.worldline_impact for c in choices}
        has_advance = any(i in impacts for i in ("advance", "advance_risky"))

        return ValidationCheck(
            name="choice_diversity",
            passed=ok and has_advance,
            severity="medium",
            detail=f"{len(unique_effects)} 个不同效果, {len(impacts)} 种影响类型",
        )

    def check_choice_validity(self, choices: list[Choice]) -> ValidationCheck:
        """选择项内容有效性"""
        issues = []
        for c in choices:
            if len(c.text) < 2:
                issues.append(f"选项过短: '{c.text}'")
            if c.worldline_impact and c.worldline_impact not in self.VALID_IMPACTS:
                issues.append(f"无效 impact: '{c.worldline_impact}'")

        return ValidationCheck(
            name="choice_validity",
            passed=len(issues) == 0,
            severity="high",
            detail="; ".join(issues) if issues else "全部有效",
        )

    @staticmethod
    def _extract_keywords(text: str) -> list[str]:
        """
        提取关键词：标点分割取有意义词块，限制总量避免稀释命中率。
        策略：优先取 2-4 字的标点分割词块，不足时补充 n-gram。
        """
        import re
        stopwords = {
            "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "人",
            "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去",
            "你", "会", "着", "没有", "看", "好", "自己", "这", "他",
            "中", "里", "内", "外", "上", "下", "她", "它", "们", "那",
            "被", "把", "还", "已", "而", "但", "与", "对", "从", "等",
        }
        # 标点分割
        raw_tokens = re.split(r'[，。！？、\s,.!?\n]+', text)
        primary_kws = []
        for t in raw_tokens:
            t = t.strip()
            if not t or t in stopwords or len(t) < 2:
                continue
            # 取 2-4 字的词块
            if len(t) <= 4:
                primary_kws.append(t)
            else:
                # 长词取前 4 字 + 后 2 字作为代表
                primary_kws.append(t[:4])
                if len(t) > 4:
                    primary_kws.append(t[-2:])
    
        # 去重保持顺序
        seen = set()
        result = []
        for kw in primary_kws:
            if kw not in seen:
                seen.add(kw)
                result.append(kw)
    
        # 如果不足 5 个，补充 2-gram
        if len(result) < 5:
            chars = text.replace(" ", "")
            for i in range(len(chars) - 1):
                gram = chars[i:i + 2]
                if gram not in stopwords and gram not in seen:
                    seen.add(gram)
                    result.append(gram)
                if len(result) >= 20:
                    break
    
        return result[:15]  # 最多返回 15 个关键词，避免长文本稀释命中率
