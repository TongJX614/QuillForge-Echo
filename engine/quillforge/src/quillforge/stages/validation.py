# -*- coding: utf-8 -*-
"""
Stage 5: Validation Gate — 验证门控

委托给 Validator 组件对生成结果进行验证。
从原 harness.py 的 Stage 5 逻辑提取。
Validator 通过构造函数注入，不再在 Stage 内部直接 new。
"""

from __future__ import annotations

from typing import Optional

from schemas import HarnessInput, Dialogue, Choice, ValidationResult
from ..fixtures import PreparedContext
from ..sut import NarrativeSUT
from .base import StageBase


class ValidationStage(StageBase):
    """Stage 5: 验证门控"""

    def __init__(self, validator=None, thresholds: dict | None = None):
        """
        Args:
            validator: 验证器实例（实现 validate_all 方法）。
                       如果为 None，则使用默认的 NarrativeValidator。
            thresholds: 验证阈值（透传给 NarrativeValidator），来自配置文件。
        """
        self._validator = validator
        self._thresholds = thresholds

    @property
    def name(self) -> str:
        return "validation_gate"

    @property
    def stage_number(self) -> int:
        return 5

    def execute(
        self,
        ctx: PreparedContext,
        sut: NarrativeSUT,
        input_data: HarnessInput,
        extra: dict,
        narration: str = "",
        dialogues: list[Dialogue] = None,
        choices: list[Choice] = None,
        retry_count: int = 0,
    ) -> ValidationResult:
        """执行验证：原有 8 项 + 剧本外实体贴合度检查（第 9 项，阻断级）。"""
        dialogues = dialogues or []
        choices = choices or []

        validator = self._get_validator(input_data, ctx.assembled, sut=sut, extra=extra)
        result = validator.validate_all(narration, dialogues, choices, retry_count=retry_count)

        checker = getattr(validator, "check_script_entity_fidelity", None)
        if callable(checker):
            fidelity = checker(narration, dialogues, choices)
            result.checks.append(fidelity)
            if not fidelity.passed and fidelity.severity in ("critical", "high"):
                result.passed = False
        return result

    @staticmethod
    def _extra_value(extra, key: str, attr: str, default: str = "") -> str:
        """兼容 ExtraContext（类型安全）与 dict（向后兼容）两种 extra。"""
        if hasattr(extra, attr):
            return getattr(extra, attr, default) or default
        if isinstance(extra, dict):
            return extra.get(key, default) or default
        return default

    def _get_validator(self, input_data: HarnessInput, assembled=None, sut=None, extra=None):
        """获取验证器实例（延迟创建，因为需要 input_data 的对话数量约束）"""
        if self._validator is not None:
            return self._validator

        # 默认使用 NarrativeValidator，注入阈值、性格评审回调与剧本事实基准
        from validator import NarrativeValidator
        return NarrativeValidator(
            context=assembled,
            min_dialogues=input_data.options.dialogue_count_min,
            max_dialogues=input_data.options.dialogue_count_max,
            thresholds=self._thresholds,
            judge=sut.judge_personality if sut is not None else None,
            allowed_entities=self._extra_value(extra, "_allowedEntities", "allowed_entities"),
            script_scene_raw=self._extra_value(extra, "_scriptSceneRaw", "script_scene_raw"),
            script_global_raw=self._extra_value(extra, "_scriptGlobalRaw", "script_global_raw"),
        )
