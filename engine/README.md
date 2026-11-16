# QuillForge 引擎

QuillForge 是 Harness 架构的 AI 互动叙事生成引擎：读取剧本数据，生成场景旁白、
角色对话与玩家选项，并对生成结果做一致性与内容校验。它同时支持固定剧本驱动、
AI 实时生成、AI 剧本生成、立绘与背景生图、TTS 语音合成。

引擎位于融合仓库的 `engine/`，本身不包含任何具体项目的逻辑。ECHO 通过
`harness/projects/echo/` 把它挂载为自己的叙事后端；`QUILLFORGE_PROJECTS` 置空时，
引擎行为与上游 `675c63a` 一致。

> 上游版本线 6.0.0 | 最后更新 2026-11-16 | 引擎测试 367 项

## 在融合仓库中的位置

```text
apps/echo  ──HTTP──▶  harness/projects/echo  ──注册表──▶  engine/quillforge
   │                        │                                │
   └── 存档、任务、Flags ────┘                         生成、校验、生图、TTS
```

- 引擎负责生成与校验，只回传候选内容和受控 actions。
- 接入层负责把项目语义翻译成引擎节拍，所有 ECHO 专有逻辑都在 harness。
- ECHO 是运行态唯一事实源，引擎与接入层都不直接改写它的存档、任务或 Flags。

## 快速开始

在仓库根目录：

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r engine/requirements.txt
cp .env.example .env
sh scripts/engine.sh
```

打开 http://127.0.0.1:8050/ ，API 文档在 `/docs`。`scripts/engine.sh` 会显式清空
`QUILLFORGE_PROJECTS`，确保以无项目形态启动。

只配置引擎自身、不经过根 `.env` 时：

```bash
cp engine/.env.example engine/.env
cd engine/quillforge
QUILLFORGE_PROJECTS= PYTHONPATH=src ../../.venv/bin/python src/server.py --host 127.0.0.1 --port 8050
```

融合模式由根目录的 `sh scripts/fusion.sh` 启动，引擎会在后台拉起 ECHO，并把
`NARRATIVE_ENGINE_URL/HOST/PORT` 与 `VITE_ENGINE_URL` 注入给它。详见
[README](../README.md) 与 [scripts/README](../scripts/README.md)。

## 架构

### 五阶段流水线

```text
Fixture → Stage 1 上下文组装 → Stage 2 叙事锚定 → Stage 3 对话生成
        → Stage 4 选择分支 → Stage 5 验证门控 → Fixture teardown
                                      │
                                      └── 验证失败，回灌 feedback 重试
```

| 组件 | 职责 |
| --- | --- |
| `core.py` | 薄编排器：组件组装、阶段驱动、重试循环、Observer 通知 |
| `sut.py` | SUT：LLM 客户端与 Prompt 模板渲染，可整体替换 |
| `stages/` | 五个可插拔阶段，统一实现 `StageBase` |
| `observer.py` | Logging / SSE / Metrics 观察者，与执行逻辑解耦 |
| `fixtures.py` | `PreparedContext` 管理前置准备与后置清理 |
| `fallback.py` | 三层保底：流水线重试、简化 prompt、无 LLM 硬保底 |

叙事锚点一致性是 Stage 5 的一部分：`generic_adapter` 提取场景原文、全局设定与
允许实体清单，经 `extra_context` 渲染进 `system_prompt_v2` 的锚点段；验证器在第
9 项阻断级校验 `check_script_entity_fidelity` 中检查实体越界。失败时 `core` 把
`validationFeedback` 回灌到下一轮生成。上游自带的 `personality_judge` 与
`content_guard` 两层同时保留。

### 项目挂载

`registry.py` 把所有项目相关能力做成通用挂载点，注册阶段只收集、不产生副作用：

| 注册方法 | 用途 |
| --- | --- |
| `register_project` | 项目元信息、首页路径、受保护示例剧本 |
| `register_router` | 追加 FastAPI 路由 |
| `register_page` | 追加 HTML 页面 |
| `register_static_dir` | 挂载静态目录，可作静态站点 |
| `register_card` | 引擎首页的已接入项目卡片与入口脚本 |
| `register_page_assets` | 给引擎自带页面注入样式与脚本 |
| `register_interlude` | 注册会话中断态与 `start/resolve/cancel` 委托 |
| `register_process` | 子进程启停与状态探测 |

新增项目只需让模块暴露 `register(registry)`，再把模块名加入
`QUILLFORGE_PROJECTS`。单个模块导入失败只会让引擎降级启动，不会拖垮进程。

### 其他通用能力

- `runtime_paths.py`：`QUILLFORGE_VAR_DIR` 把上传、生图、音频外置到可写目录。
- `script_registry.py`：生成剧本的可信边界、审阅记录与先审阅后开局。
- `session_manager.py`：会话生命周期、TTLCache、`INTERLUDE` 中断状态。
- `provider_key.py`：按请求透传 `X-Provider-Key`，所有静态页统一附带；
  `GET /api/settings/provider-key` 提供脱敏回读。
- 备选模型链：`DEEPSEEK_FALLBACK_MODELS` / `IMAGE_FALLBACK_MODELS` 按顺序切换；
  401/402/403 等账号级错误不切换，避免无意义重试。
- 生图并发：千问 / DashScope 系按 `IMAGE_CONCURRENCY` 真并发，默认 8；其他
  服务商仍串行错峰。
- LLM 客户端统一默认关闭 thinking，避免思考模型把 `max_tokens` 耗尽后返回空串。

## 目录

```text
engine/
├── requirements.txt
├── pyproject.toml                  pytest 配置
├── scripts/check_architecture.py   架构约束检查
├── docs/                           API 文档与历史审查报告
├── AGENTS.md                       引擎内部约定与故障排除
└── quillforge/
    ├── README.md                   子目录说明
    ├── quillforge.md               上游完整技术规格
    ├── server_start.py             Windows 启动器
    ├── prompts/                    Mustache 风格 Prompt 模板
    ├── config/                     Harness、角色卡、世界线配置
    ├── samples/                    内置剧本包
    ├── src/
    │   ├── server.py               FastAPI 入口、中间件、注册表消费
    │   ├── routes/                 页面、会话、实时、剧本生成、上传、资源
    │   ├── quillforge/             Harness 核心、SUT、五个 Stage
    │   ├── adapter/                剧本解析与字段归一化
    │   ├── registry.py             项目挂载
    │   ├── runtime_paths.py        运行期目录
    │   ├── script_registry.py      生成剧本可信边界
    │   ├── session_manager.py      会话与中断态
    │   ├── validator.py            叙事与锚点校验
    │   ├── content_guard.py        内容安全
    │   ├── image_gen.py            生图
    │   ├── tts_gen.py              TTS
    │   ├── realtime_engine.py      实时生成
    │   └── script_generator.py     AI 剧本生成
    └── tests/                      367 项 pytest
```

## API

引擎的基础端点按功能域分组：

| 分组 | 代表端点 | 用途 |
| --- | --- | --- |
| 页面 | `GET /`、`GET /game`、`GET /play` | 创作台、互动剧场、轻量剧情页 |
| 项目 | `GET /api/projects` | 已接入项目列表 |
| 剧本 | `POST /api/load-folder`、`POST /api/story`、`POST /api/scene` | 加载与轻量生成 |
| 会话 | `POST /api/start`、`/generate`、`/generate-stream`、`/choose` | 标准剧本会话 |
| 实时 | `POST /api/realtime/start`、`POST /api/realtime/{id}/choose` | 一句话实时生成 |
| 剧本生成 | `POST /api/generate-script` | SSE 进度，生成完整剧本包 |
| 批量 | `POST /api/auto-run`、`/api/auto-run/stream` | 一键跑完全部场景 |
| 资源 | `/generated_images/*`、`/generated_audio/*` | 生成素材 |
| 设置 | `GET /api/settings/provider-key` | 脱敏回读当前请求的 Key 配置 |

挂载项目会追加自己的端点，因此端点总数随 `QUILLFORGE_PROJECTS` 变化。融合实例
当前 OpenAPI 有 49 个路径；准确清单以运行实例的 `/docs` 或 `/openapi.json` 为准。
[engine/docs/API接口文档.md](docs/API接口文档.md) 记录的是基础接口与示例。

## 数据约定

角色卡支持 10 个字段：`name`、`role`、`personality` 必填，`speakingStyle`、
`background`、`motivation`、`secrets`、`relationships`、`appearance`、`arc` 可选。
字段缺失时由 `fill_character_gaps` 推断补齐。

剧本支持两种结构：

- 扁平结构：元数据、主要角色、场景清单、主线剧情，4 个文件。
- 嵌套结构：额外包含世界线、事件清单、关键选择、结局系统、角色关系、世界书，
  共 11 个文件。

## 测试

```bash
cd engine && ../.venv/bin/python -m pytest quillforge/tests -q -m "not live"   # 367
```

或在仓库根执行 `sh scripts/test-all.sh` 跑全部套件与跨模块冒烟。`live` 标记的
测试需要真实大模型，默认排除。

## 文档

- [AGENTS.md](AGENTS.md)：引擎内部约定、阶段细节、故障排除
- [quillforge/README.md](quillforge/README.md)：Python 子目录说明
- [quillforge/quillforge.md](quillforge/quillforge.md)：上游完整技术规格
- [docs/API接口文档.md](docs/API接口文档.md)：接口清单与示例
- [docs/项目审查报告-2026-11-07.md](docs/项目审查报告-2026-11-07.md)：历史审查快照
