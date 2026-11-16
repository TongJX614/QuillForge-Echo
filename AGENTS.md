# AGENTS.md — 仓库工作指南

这份文档给 AI 助手和新维护者使用。目标是在不读完整代码库的情况下，快速建立正确的
项目模型、找到入口、避开已踩过的坑。面向外部读者的介绍在 [README.md](README.md)，
文档索引在 [docs/README.md](docs/README.md)。

## 一句话模型

这是 QuillForge 叙事引擎与 ECHO 像素 RPG 的三段式融合仓库：

- `engine/` 负责生成与校验，不认识任何具体项目。
- `harness/` 负责翻译与挂载，所有 ECHO 专有逻辑都在这里。
- `projects/echo/` 负责运行与状态，是场景、任务、Flags 与存档的唯一事实源。

两边可以独立运行；融合时由引擎拉起 ECHO 并注入引擎地址。`_upstream/` 参照克隆
已经删除，需要对照上游时按下方提交号从远端拉取，不要再把克隆放回工作区。

| 目录 | 上游 | 基准提交 |
| --- | --- | --- |
| `engine/` | `TongJX614/QuillForge` | `675c63a` |
| `projects/echo/` | `TongJX614/gewuzaojing-echo` | `e1ce5b9` |

## 目录职责

```text
engine/quillforge/
├── src/server.py              FastAPI 入口、中间件、注册表消费
├── src/quillforge/            Harness 编排器、SUT、五阶段、Fallback
├── src/routes/                story / session / realtime / script_gen / upload / pages
├── src/image_gen.py           生图与并发控制
├── src/tts_gen.py             TTS
├── src/validator.py           叙事与剧本锚点校验
├── src/registry.py            QUILLFORGE_PROJECTS 项目注册表
├── src/runtime_paths.py       QUILLFORGE_VAR_DIR 运行期目录
├── src/script_registry.py     生成剧本的可信边界与先审阅后开局
├── tests/                     367 项 pytest
└── samples/                   2 个内置剧本包：回响-DEMO、索尔维0801

harness/projects/echo/
├── __init__.py                register(registry)：唯一挂载入口
├── settings.py                ECHO 配置读取
├── echo_host.py               宿主节拍、对白树、结局、背景、TTS 桥接
├── echo_launcher.py           ECHO 子进程、端口、就绪探测、地址注入
├── interlude.py               会话中断态：剧情小游戏
├── minigame_generator.py      12 种玩法生成与判定
├── debate_generator.py        言弹辩论生成
├── routes/                    /api/echo/*、/api/debate/*、/api/minigame/*
├── static/                    桥接脚本、首页世界编织视图、小游戏浮层
├── config/echo_beats.yaml     2 个剧本包 / 26 个宿主节拍
├── config/echo.yaml           玩法参数
├── tests/                     90 项 pytest
└── tests_js/                  18 项 node --test

projects/echo/
├── apps/echo/src/             游戏客户端：引擎、场景、UI、系统
├── apps/echo/server/          Express 侧：配置、对话、生成代理
├── apps/echo/public/          美术、音频、视频、世界背景
├── shared/contracts/          iframe 与运行环境的唯一跨应用契约
├── docs/                      产品、架构、开发文档
├── tests/                     9 项仓库级 node --test
└── packages/narrative-core/   独立叙事图运行时与示例
```

## 一次请求怎么走

1. 浏览器里的 ECHO 产生游戏事件：对话、任务、结局或世界编织入口。
2. ECHO 的 Express 侧调用接入层 `/api/echo/dialogue`、`/api/echo/chat` 等端点。
3. 接入层把 `(scene, trigger, stage)` 映射到 `echo_beats.yaml` 的节拍和剧本包。
4. 引擎组装上下文、生成并校验内容，返回候选对白、选项与 actions。
5. ECHO 校验并执行受控动作，更新任务、Flags、背包与存档。

关键原则：引擎与接入层只能回传候选内容和受控 actions，不能直接写 ECHO 的存档、
任务运行时或 Flags。

## 不可破坏的边界

- **引擎核心不得出现 ECHO 专有逻辑**。`QUILLFORGE_PROJECTS` 置空后，引擎行为应
  与上游基准一致。判断方法是搜 `engine/quillforge/src` 是否出现 `echo_host`、
  `echo_launcher`、`minigame_generator`、`debate_generator`、`echo_beats`。
- **`projects/echo/` 内不得出现 quillforge 字样**（大小写不敏感）。引擎地址只经
  `NARRATIVE_ENGINE_HOST/PORT/URL` 注入，ECHO 不写死任何引擎位置。
- **导入方向单向**：harness → engine 可以，engine → harness 不可以。
- **ECHO 进度是唯一事实源**：存档、任务状态、Flags 只能由 ECHO 写。
- **新增项目不改引擎**：新建 `harness/projects/<name>/`，实现 `register(registry)`，
  把模块名追加到 `QUILLFORGE_PROJECTS`。

## 运行

准备两份配置：

```bash
cp .env.example .env
cp projects/echo/.env.example projects/echo/.env
```

三种模式：

```bash
sh scripts/engine.sh   # 只起引擎      http://127.0.0.1:8050/
sh scripts/echo.sh     # 只起 ECHO     http://127.0.0.1:5000/
sh scripts/fusion.sh   # 融合          引擎 8050 / ECHO 5173
```

融合模式下 `echo_launcher.py` 在后台拉起 ECHO，并注入
`NARRATIVE_ENGINE_URL/HOST/PORT` 与 `VITE_ENGINE_URL`。ECHO 的
`/echo-runtime-config.js` 把它暴露给前端和 iframe。

`sh scripts/echo.sh` 用 5000；融合默认 5173，被占用时按
`ECHO_PORT_MAX_OFFSET` 向后顺延。Vite HMR 固定使用 24678，同时跑多个 ECHO
实例会冲突。

## 修改指引

- **改游戏 UI / 场景 / 任务**：入口在 `projects/echo/apps/echo/src/`。场景注册在
  `src/scenes/scenes.ts`，对白树在 `src/data/dialogues.ts`，任务在
  `src/data/quests/`。改完跑 ECHO app 级测试与仓库级测试。
- **改对白生成链路**：先看 `harness/projects/echo/echo_host.py` 与
  `config/echo_beats.yaml`，再看 `engine/quillforge/src/quillforge/` 的 Stage。
- **改引擎通用能力**：只改 `engine/quillforge/src/`，保持项目无关，跑引擎 pytest。
- **改接入层**：只改 `harness/projects/echo/`，跑接入层 pytest 与 JS 测试。
- **新增项目**：在 `harness/projects/<name>/` 实现 `register(registry)`，不要动
  引擎核心；同时补接入层测试与一个跨模块冒烟。
- **改文档或截图**：截图放在 `docs/assets/screenshots/`，使用真实游戏画面；更新
  README、AGENTS 与相关子文档时要同步端口、测试数量与路径。

## 验证

一键全量：

```bash
sh scripts/test-all.sh
```

分段：

```bash
cd engine && ../.venv/bin/python -m pytest quillforge/tests -q -m "not live"   # 367
.venv/bin/python -m pytest harness/projects/echo/tests -q                     # 90
node --test harness/projects/echo/tests_js/*.cjs                              # 18
cd projects/echo && node --test tests/*.test.mjs                              # 9
cd projects/echo/apps/echo && for t in scripts/test-*.ts; do node --import tsx "$t"; done   # 15
node scripts/integration-smoke.mjs                                            # 11
```

本机 `node` 可能不在默认 PATH，常见位置是 `~/.local/node24/bin/node`。跑测试时
先把它加入 PATH，或直接使用完整路径。`pnpm` 可能缺失；缺依赖时融合仍然能起引擎，
但 ECHO 会被报告为 `state=failed`，日志在 `projects/echo/.run/echo.log`。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [README.md](README.md) | 对外介绍、截图、快速开始 |
| [docs/README.md](docs/README.md) | 文档索引与截图目录 |
| [engine/README.md](engine/README.md) | 引擎运行、架构、配置 |
| [engine/AGENTS.md](engine/AGENTS.md) | 引擎内部编码约定与故障排除 |
| [harness/README.md](harness/README.md) | 接入层结构、挂载点、边界 |
| [projects/echo/README.md](projects/echo/README.md) | ECHO 游戏侧说明 |
| [projects/echo/docs/](projects/echo/docs/) | ECHO 产品、架构、开发 |
| [engine/quillforge/quillforge.md](engine/quillforge/quillforge.md) | 上游完整技术规格 |

## 已知的坑

- `QUILLFORGE_VAR_DIR` 必须是绝对路径。空字符串按未设置处理，不要写成空值赋值。
- `scripts/_common.sh` 的默认值要在 `load_root_env` 之后由 `apply_defaults` 设置，
  否则根 `.env` 里的空赋值会盖掉默认值。
- `FastAPI` 0.163 起 `app.routes` 里是 `_IncludedRouter` 包装，数不出真实端点；
  用 `app.openapi()["paths"]` 核验。当前运行实例有 49 个路径。
- `script_id` 必须是 `uuid4().hex`（32 位十六进制），`script_registry` 会拒绝
  `str(uuid4())[:8]`。
- 所有 LLM 客户端默认关闭 thinking。构造 `LLMClient` 时未显式传 `extra_body`
  会自动补 `{"thinking": {"type": "disabled"}}`；思考模型会把 `max_tokens` 耗尽在
  reasoning 上并返回空串。
- 千问 / DashScope 生图默认关闭 `prompt_extend` 与水印，否则单张可能多耗 70 秒。
  `IMAGE_PROMPT_EXTEND` / `IMAGE_WATERMARK` 可显式打开。
- 生图并发：千问 / DashScope 系按 `IMAGE_CONCURRENCY` 真并发，默认 8；其他服务商
  仍串行错峰，避免免费额度 429。
- 引擎 venv 不装 `rembg` 时，立绘去背景回退到纯 PIL 绿幕抠图，提示词里的
  「纯绿色背景」必须保留。
- 生成的剧本落在 `engine/quillforge/samples/`，不在 `QUILLFORGE_VAR_DIR` 下。
  `register_generated_script` 要求剧本目录在 `SAMPLES_DIR` 之内。验证后清掉新增
  的未跟踪目录，别混进提交。
- ECHO 的两个视频（`public/videos/intro.mp4`、`solvay-enter.mp4`）已通过
  `projects/echo/apps/echo/.gitignore` 的例外规则纳入版本管理范围。不要用会删除
  忽略文件的清理命令；这两个文件是标题页与索尔维入场的实际素材。
- `projects/echo/packages/narrative-core/dist/` 是生成物，仓库不跟踪。需要时在
  `packages/narrative-core` 下执行 `tsc -p tsconfig.build.json`。
- `echo_launcher` 的 `prod` 模式依赖 `apps/echo/dist-server/server.js`；当前默认
  `ECHO_LAUNCH_MODE=dev`，不需要该构建产物。
- 本机如果同时跑多个实例，Vite HMR 的 24678 会冲突；先停旧实例再起新实例。

## 当前状态

截至 2026-11-16：

- 全量测试通过：367 + 90 + 18 + 9 + 15 = 499 项，跨模块冒烟 11 项。
- 标题页与索尔维入场视频已恢复到 `public/videos/`。
- 文档与真实游戏截图已补齐到 `docs/assets/screenshots/`。
- 内置示例保留两个剧本包：`回响-DEMO` 与 `索尔维0801`，共 26 个宿主节拍。
- `_upstream/` 参照克隆已删除；需要上游比对时按文档中的提交号重新拉取到工作区
  之外，不要放回仓库。
