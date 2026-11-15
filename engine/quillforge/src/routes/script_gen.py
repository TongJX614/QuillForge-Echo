# -*- coding: utf-8 -*-
"""剧本生成路由：/api/generate-script"""

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from content_guard import ContentSafetyError, scan_input
from script_generator import SAMPLES_DIR, generate_script
from script_registry import register_generated_script
from logger import get_logger

logger = get_logger("routes.script_gen")

router = APIRouter(tags=["script_gen"])


class GenerateScriptRequest(BaseModel):
    prompt: str


@router.post("/api/generate-script")
async def api_generate_script(body: GenerateScriptRequest):
    """AI 生成剧本（SSE 流式返回进度）

    生成完成后必须通过 script_registry 的世界书校验才会登记为 ready；
    未登记的剧本无法用于 /api/start，即「先审阅、后开局」。
    """
    user_prompt = body.prompt.strip()
    if not user_prompt:
        raise HTTPException(400, "请输入剧本描述")
    if len(user_prompt) > 150:
        raise HTTPException(400, f"描述不能超过150字（当前{len(user_prompt)}字）")
    verdict = scan_input(user_prompt, source="script_gen_route")
    if verdict.blocked:
        raise HTTPException(400, verdict.message)

    def event_stream():
        try:
            for event in generate_script(user_prompt):
                evt_type = event.get("type", "progress")
                if evt_type == "done":
                    script_id = event.get("script_id")
                    script_path = event.get("path")
                    try:
                        record = register_generated_script(script_id, script_path, SAMPLES_DIR)
                    except Exception as error:
                        # 只透出稳定的错误码，不把内部路径/异常文本回给客户端
                        logger.warning("[script_gen] registry rejection: %s", type(error).__name__)
                        err = json.dumps(
                            {
                                "type": "error",
                                "code": "SCRIPT_REGISTRATION_FAILED",
                                "message": "生成结果未通过世界书校验",
                            },
                            ensure_ascii=False,
                        )
                        yield f"event: error\ndata: {err}\n\n"
                        return
                    event = {
                        "type": "done",
                        "script_id": record.script_id,
                        "summary": record.summary,
                    }
                payload = json.dumps(event, ensure_ascii=False)
                yield f"event: {evt_type}\ndata: {payload}\n\n"
        except ContentSafetyError as e:
            logger.info("[script_gen] 模型内容审核拦截: %s", e.message)
            payload = json.dumps({"type": "error", "message": e.message}, ensure_ascii=False)
            yield f"event: error\ndata: {payload}\n\n"
            return

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
