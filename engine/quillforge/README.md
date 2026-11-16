# quillforge

引擎的可运行目录。Python 源码、Prompt、配置、示例剧本与测试都在这里；推荐从
仓库根用 `sh scripts/engine.sh` 或 `sh scripts/fusion.sh` 启动，脚本会设置
`PYTHONPATH`、加载根 `.env` 并选择解释器。

日常使用与架构说明见 [../README.md](../README.md)；内部约定见
[../AGENTS.md](../AGENTS.md)。本页只说明这个目录本身。

## 目录

```text
quillforge/
├── server_start.py        交互式启动器，默认端口 8050
├── start_server.bat       Windows 入口
├── src/
│   ├── server.py          FastAPI 应用入口
│   ├── routes/            页面、会话、实时、生成、上传、资源
│   ├── quillforge/        Harness 核心、SUT、五个 Stage
│   ├── adapter/           剧本解析与字段归一化
│   └── ...                校验、生图、TTS、注册表、运行期目录
├── prompts/               六份 Prompt 模板
├── config/                Harness 参数、角色卡、世界线、示例场景
├── samples/               内置剧本包：回响-DEMO、索尔维0801
├── tests/                 380 项 pytest
└── quillforge.md          上游完整技术规格
```

## 运行

```bash
# 在仓库根，推荐
sh scripts/engine.sh

# 在本目录直接运行
QUILLFORGE_PROJECTS= PYTHONPATH=src ../../.venv/bin/python src/server.py --host 127.0.0.1 --port 8050
```

`server_start.py` 适合需要交互式输入 Key 的 Windows 环境：

```powershell
python server_start.py
```

配置读取顺序：进程环境变量优先，其次是 `engine/.env`；融合模式下由根
`.env` 经编排脚本导出为环境变量，因此不需要把 Key 再写到本目录。模板是
[../.env.example](../.env.example)。

## 源码分层

| 层 | 位置 | 说明 |
| --- | --- | --- |
| HTTP 层 | `src/server.py`、`src/routes/` | FastAPI、中间件、SSE、页面与资源 |
| 编排层 | `src/quillforge/core.py` | 组装组件、驱动五个 Stage、重试与通知 |
| 生成层 | `src/quillforge/stages/`、`src/sut.py` | 上下文、旁白、对话、选项、校验 |
| 适配层 | `src/adapter/` | 解析扁平或嵌套剧本，归一化角色字段 |
| 运行时 | `src/session_manager.py`、`src/runtime_paths.py` | 会话、TTLCache、中断态、可写目录 |
| 可信边界 | `src/script_registry.py` | 生成剧本的登记、审阅与开局限制 |
| 项目挂载 | `src/registry.py` | `QUILLFORGE_PROJECTS` 与所有注册点 |
| 素材 | `src/image_gen.py`、`src/tts_gen.py` | 生图、并发控制、语音合成 |

## Prompt 与配置

`prompts/` 使用 Mustache 风格占位符，由 `NarrativeSUT` 加载与渲染：

| 文件 | 用途 |
| --- | --- |
| `system_prompt_v2.md` | 系统提示词，含剧本锚点与角色一致性 |
| `system_prompt_dynamic.md` | 动态叙事风格、世界书、概要 |
| `narration_v2.md` | Stage 2 旁白 |
| `dialogue_v2.md` | Stage 3 对话 |
| `choices_v2.md` | Stage 4 选项 |
| `personality_judge.md` | 性格一致性评审 |

`config/quillforge_config.yaml` 控制 LLM、阶段开关与验证阈值；角色卡和世界线
模板用于剧本生成与校验。

## 示例剧本

内置两个剧本包：

- `samples/回响-DEMO`
- `samples/索尔维/索尔维0801`

它们是接入层 `echo_beats.yaml` 的骨架内容，也是首页受保护、不可删除的示例。
AI 生成的剧本同样落在这个目录下，属于可写区；清理时注意不要误删内置包。

## 测试

```bash
cd engine
../.venv/bin/python -m pytest quillforge/tests -q -m "not live"
```

380 项。`live` 标记的测试需要真实大模型，默认排除。跨模块行为由仓库根的
`node scripts/integration-smoke.mjs` 覆盖。
