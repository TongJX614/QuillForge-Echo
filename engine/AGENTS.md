# AGENTS.md — QuillForge 引擎

本文件面向修改 `engine/` 的 AI 助手与维护者。仓库级上下文见
[../AGENTS.md](../AGENTS.md)，使用说明见 [README.md](README.md)。

## 引擎定位

QuillForge 是项目无关的 AI 互动叙事生成引擎：读取剧本数据，经五阶段 Harness
流水线生成旁白、对话与选项，并在 Stage 5 做质量与锚点校验。它不认识 ECHO，
也不应出现任何具体项目的名称、路径或业务规则。

```text
Fixture → Stage 1 上下文组装 → Stage 2 叙事锚定 → Stage 3 对话生成
        → Stage 4 选择分支 → Stage 5 验证门控 → Fixture teardown
                                      │
                                      └── 失败时回灌 validationFeedback 重试
```

| 阶段 | 名称 | 职责 | LLM |
| --- | --- | --- | --- |
| 1 | Context Assembly | 组装角色、世界线、场景与额外上下文 | 否 |
| 2 | Narrative Anchoring | 生成旁白，≤250 字 | 是 |
| 3 | Dialogue Generation | 生成 3-15 轮对话，同次调用附带选项 | 是 |
| 4 | Choice Branching | 复用 Stage 3 选项；缺失时补调用；预设选项跳过 | 视情况 |
| 5 | Validation Gate | 质量、性格、主线、实体保真校验 | 视情况 |

## 架构原则

- **Harness 是薄编排器**：`quillforge/core.py` 只组装组件、驱动阶段、重试与通知，
  不放业务逻辑。
- **SUT 隔离**：LLM 客户端与 Prompt 渲染封装在 `NarrativeSUT`，可整体替换。
- **可插拔 Stage**：所有阶段实现 `StageBase` 的 `name`、`stage_number`、`execute`。
- **Observer 解耦**：日志、SSE、指标通过观察者接收事件。
- **三层 Fallback**：流水线重试、简化 Prompt、无 LLM 硬编码保底。
- **两种模式同一质量口径**：上传模式走 Stage 5，实时模式走
  `realtime_engine._check_scene_quality`；说话人合法性、最小对话数、旁白完整度
  使用同一标准。
- **内容安全三层**：入口拦截、生图提示词软化、服务商审核报错翻译，均在
  `content_guard.py`。

## 项目挂载

引擎核心通过 `registry.py` 接收外部项目，不反向导入 harness：

| 注册点 | 说明 |
| --- | --- |
| `register_project` | 项目元信息、首页、受保护示例剧本 |
| `register_router` | 追加 FastAPI 路由 |
| `register_page` | 追加 HTML 页面 |
| `register_static_dir` | 挂载静态目录，可作静态站点 |
| `register_card` | 引擎首页的项目卡片与入口脚本 |
| `register_page_assets` | 给引擎页面注入样式与脚本 |
| `register_interlude` | 会话中断态与 `start/resolve/cancel` 委托 |
| `register_process` | 子进程启停与状态探测 |

`QUILLFORGE_PROJECTS` 是逗号分隔的模块名。未设置时注册表为空，引擎行为与上游
`675c63a` 一致；单个模块导入失败只记录错误并降级启动。修改这里时保持“注册阶段
只收集，不产生副作用”。

引擎侧的通用接入能力还有：

- `runtime_paths.py`：`QUILLFORGE_VAR_DIR`，必须绝对路径。
- `script_registry.py`：生成剧本的可信边界、审阅与先审阅后开局。
- `session_manager.py`：TTLCache、`INTERLUDE` 状态、中断态委托。
- `provider_key.py`：透传 `X-Provider-Key`，`/api/settings/provider-key` 脱敏回读。
- `StaticDirSpec` 与 `serve_page_file`：项目页面与静态目录。
- 锚点一致性：`generic_adapter` 提取场景原文、全局设定、允许实体；
  `extra_context` 渲染进 `system_prompt_v2`；Stage 5 追加第 9 项
  `check_script_entity_fidelity`，`high` 级别，失败会阻断并触发重试。

## 目录职责

```text
engine/quillforge/
├── src/
│   ├── quillforge/             Harness 核心
│   │   ├── core.py             编排、重试、feedback 回灌
│   │   ├── sut.py              LLM + Prompt 渲染
│   │   ├── observer.py         Logging / SSE / Metrics
│   │   ├── fallback.py         三层保底
│   │   ├── fixtures.py         PreparedContext
│   │   └── stages/             五个阶段
│   ├── routes/                 pages / story / session / realtime / script_gen /
│   │                           auto_run / upload / assets / settings
│   ├── adapter/                parser / normalizer / loader
│   ├── server.py               FastAPI 入口、中间件、注册表消费
│   ├── registry.py             项目挂载
│   ├── runtime_paths.py        运行期目录
│   ├── script_registry.py      生成剧本可信边界
│   ├── session_manager.py      会话与中断态
│   ├── schemas.py              dataclass I/O
│   ├── llm_client.py           统一 LLM 客户端
│   ├── config_manager.py       环境变量 + YAML
│   ├── validator.py            9 项校验（8 项基础 + 实体保真）
│   ├── content_guard.py        内容安全
│   ├── extra_context.py        额外上下文
│   ├── image_gen.py            生图与并发
│   ├── tts_gen.py              TTS
│   ├── realtime_engine.py      实时生成
│   ├── script_generator.py     AI 剧本生成
│   ├── provider_key.py         Key 透传中间件
│   └── logger.py               日志
├── prompts/                    6 份 Mustache 模板
├── config/                     Harness、角色卡、世界线、示例场景
├── samples/                    回响-DEMO、索尔维0801
├── tests/                      367 项 pytest
├── quillforge.md               上游完整技术规格
├── server_start.py             交互式启动器
├── ../README.md                引擎使用说明
└── ../AGENTS.md                本文件
```

## 编码约定

1. 文件头使用 `# -*- coding: utf-8 -*-` 与模块级 docstring。
2. 顶部保留 `from __future__ import annotations`。
3. 日志通过 `from logger import get_logger`，名称用 `"module.submodule"`。
4. 公共方法写完整类型标注；数据模型定义在 `schemas.py`。
5. 抽象接口用 `ABC` + `@abstractmethod`。
6. Prompt 使用 Mustache 风格 `{{variable}}`、`{{#if}}`、`{{#each}}`。
7. 路径使用 `pathlib.Path`，配置通过 `config_manager`。
8. 不新增硬编码的项目判断；项目差异应通过注册表与配置注入。

## 变更约束

- 不得在 `core.py` 加入业务逻辑，业务逻辑属于 Stage 或 SUT。
- 不得绕过 SUT 直接调用 LLM；所有客户端统一经 `LLMClient`。
- 不得让路由层包含生成逻辑，路由只解析请求、调用引擎、格式化响应。
- 不得让适配器调用 LLM，它只解析与归一化。
- 修改 `schemas.py` 时新增字段必须有默认值，保持向后兼容。
- Prompt 变量变更必须与 `ExtraContext` / `_common_variables()` 对齐，并验证渲染。
- 新增 Stage 必须实现 `StageBase`；新增项目必须实现 `register(registry)`。
- 引擎不得导入 `harness.*`；导入方向只能 harness → engine。

## 运行与配置

在仓库根推荐：

```bash
sh scripts/engine.sh    # 独立引擎，QUILLFORGE_PROJECTS 置空
sh scripts/fusion.sh    # 融合，挂载 harness.projects.echo
```

直接运行：

```bash
cd engine/quillforge
QUILLFORGE_PROJECTS= PYTHONPATH=src ../../.venv/bin/python src/server.py --host 127.0.0.1 --port 8050
```

配置优先级：环境变量 > `engine/.env` > 默认值。融合模式由根 `.env` 经编排脚本
导出为环境变量，因此不需要在 `engine/` 再放一份 Key。模板在
[../.env.example](../.env.example)。

## 测试

```bash
cd engine
../.venv/bin/python -m pytest quillforge/tests -q -m "not live"   # 367
```

`live` 标记的测试需要真实大模型，默认排除。改动引擎或接入层后，再跑仓库根的
`sh scripts/test-all.sh` 与 `node scripts/integration-smoke.mjs`。

## Stage 5 校验

`NarrativeValidator.validate_all()` 执行 8 项基础检查，Stage 5 再追加实体保真检查：

| 检查项 | 级别 | 常见失败 |
| --- | --- | --- |
| `schema_compliance` | critical | 旁白过短、对话缺 speaker/text、选项缺字段 |
| `dialogue_count` | high | 对话不在 `[min, max]`，默认 3-15 |
| `character_consistency` | critical | 说话人不在角色卡集合 |
| `consecutive_speaker` | medium | 同一角色连续发言 ≥ 3 轮 |
| `personality_match` | high | 性格词表得分低；零命中时追加 LLM 评审 |
| `worldline_adherence` | high | 未命中当前或下一世界线节点关键词 |
| `choice_diversity` | medium | 选项高度雷同或 impact 单一 |
| `choice_validity` | high | impact 不在合法集合 |
| `script_entity_fidelity` | high | 生成内容出现剧本外的人、地、事、物 |

失败项会写入日志 `[FAIL] 验证未通过: [...]`。实体保真未注入清单时会跳过，不误伤
无剧本场景。

## 故障排除

### 实时引擎并发

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 预生成场景与主线程数据不一致 | `self.scenes` / `self.history` 被并发修改 | 使用 `copy.deepcopy` 快照，检查新增字段是否纳入 |
| TTS / 图片 SSE 乱序或丢失 | 后台线程异常未捕获 | 检查 `_tts_task` / `_bg_task` 的异常路径 |
| 会话过期后线程池未释放 | TTLCache 淘汰未关闭 executor | 确认 `__delitem__` 调用 `session.close()` |
| 同一 session 多个 SSE 客户端 | 路由层无互斥 | 避免同 session 并发请求，必要时加锁 |

### LLM 调用与 Fallback

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `ReadTimeout` / `ConnectTimeout` | 网络或服务过载 | 检查 `DEEPSEEK_BASE_URL`，调整 `llm.timeout` |
| JSON 解析失败触发重试 | 输出含 markdown 或截断 | 检查 `max_tokens`；确认 thinking 已关闭 |
| 日志 `[FALLBACK] 硬编码保底` | Stage 3 连续失败或对话不足 | 查 Key、余额与 `dialogue_count_min` |
| 重试耗尽仍不通过 | Prompt 变量缺失导致偏离 | 核对 `ExtraContext` 与模板变量 |
| 主模型失败但未切换 | 账号级错误不触发备选链 | 401/402/403 按设计不切换，检查 Key 与余额 |

### 配置与素材

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 启动后 401 | 未配置 Key 或仍是占位值 | 检查根 `.env` 或 `engine/.env` |
| 无图片但不报错 | 图片三件套缺失 | 配齐 `IMAGE_API_KEY` / `IMAGE_BASE_URL` / `IMAGE_MODEL` |
| 单张生图超过 70 秒 | 千问 prompt_extend 未关闭 | 保持默认关闭，或显式设 `IMAGE_PROMPT_EXTEND=false` |
| TTS 不生效 | TTS 配置缺失 | 检查 `TTSGenerator.enabled` |
| 配置被覆盖 | 系统环境变量优先于 `.env` | 检查当前 shell 的环境变量 |

### 接入相关

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 引擎日志 `项目模块 ... 接入失败` | `QUILLFORGE_PROJECTS` 模块不可导入 | 确认仓库根在 `PYTHONPATH`，模块暴露 `register(registry)` |
| ECHO `state=failed` | pnpm 缺失或依赖未安装 | 在 `projects/echo` 执行 `pnpm install`，看 `.run/echo.log` |
| 端点数量与文档不一致 | 挂载项目追加了路由 | 以运行实例 `/openapi.json` 为准，不用 `app.routes` 计数 |
| 剧本生成后前端一直「未完成」 | `script_id` 不是 32 位十六进制 | 使用 `uuid4().hex`，不要截断 |

## 维护元数据

```text
@maintainer: QuillForge Team
@last_reviewed: 2026-11-16
@version: 2.0.0
```
