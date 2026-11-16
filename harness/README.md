# harness — 项目接入层

引擎核心不认识任何具体项目。这一层把项目专有的东西全部收在这里，通过引擎的
注册表挂进去。当前只有一个项目：`projects/echo/`（回响 ECHO）。

## 结构

```text
harness/
├── __init__.py
└── projects/
    └── echo/
        ├── __init__.py             register(registry)：唯一挂载入口
        ├── settings.py             ECHO 配置，只读环境变量与本项目 config/
        ├── interlude.py            剧情小游戏，实现引擎的会话中断态钩子
        ├── echo_host.py            宿主节拍解析、对白树/结局/背景/TTS 桥接
        ├── echo_launcher.py        ECHO 子进程、端口分配、就绪探测、地址注入
        ├── minigame_generator.py   12 种玩法的生成与判定
        ├── debate_generator.py     言弹辩论生成
        ├── routes/                 /api/echo/*、/api/debate/*、/api/minigame/*
        ├── static/                 debate.html、minigame.html、嵌入桥接、
        │                           入口状态机、首页世界编织视图、小游戏浮层
        ├── config/                 echo_beats.yaml（节拍注册表）、echo.yaml（玩法参数）
        ├── tests/                  生成器、路由、上下文接地 pytest（90 项）
        └── tests_js/               桥接、入口状态机、契约一致性 node 测试（18 项）
```

## 挂载了什么

`register()` 向注册表声明以下几类内容，引擎在 `server.py` 启动时统一消费：

| 类型 | ECHO 提供的内容 |
| --- | --- |
| 项目 | 名称、首页、描述、受保护示例剧本 `回响-DEMO` 与 `索尔维` |
| 路由 | debate / minigame / echo 三组，共 16 个端点 |
| 页面 | `/debate`、`/minigame` |
| 静态目录 | `/echo/static`（桥接脚本）、`/weave`（世界编织成品页，`html=True`） |
| 首页卡片 | 「项目二 · 世界编织」，带入口状态机与视图脚本 |
| 页面资源 | 首页世界编织样式、`/game` 页的小游戏浮层 |
| 会话中断态 | `minigame`，含选项装饰、上下文构建、开始、结算、取消、场景推进清理 |
| 子进程 | ECHO 的启动、停止、状态查询，`autostart` 由配置决定 |

引擎首页通过 `/api/projects` 拿到卡片数据，渲染后按序注入 `scripts` 里的脚本。
引擎只负责插入 `script` 标签，不理解脚本内容。

## 与引擎的边界

导入方向是单向的：本层可以 `from llm_client import LLMClient`、
`from dependencies import sessions`，引擎不得反向导入本层任何模块。运行期靠
`PYTHONPATH` 同时包含 `engine/quillforge/src` 与仓库根，模块名是
`harness.projects.echo`。

引擎侧为接入提供的通用能力，都是项目无关的：

- `registry.py`：注册表与 `QUILLFORGE_PROJECTS` 装载。单个项目模块导入失败只
  记录错误并降级启动，不拖垮引擎。
- `runtime_paths.py`：`QUILLFORGE_VAR_DIR` 把上传、生成图片、生成音频整体外置，
  引擎安装目录可以只读。
- `script_registry.py`：生成剧本的可信边界，校验 script_id 格式、拒绝越出存储
  根的路径与符号链接/junction，读取世界书节选。`/api/start` 带
  `Idempotency-Key` 时只接受已登记为 ready 的剧本，即先审阅后开局。
- `session_manager.py` 的 `INTERLUDE` 状态、`scratch` 暂存区与
  `start/resolve/cancel_interlude` 委托。
- `routes/pages.py` 的 `serve_page_file` 与 `/api/projects`。
- `provider_key.py` 的 `X-Provider-Key` 透传与脱敏回读。

## 地址注入

ECHO 不知道引擎在哪。`echo_launcher._build_env` 在拉起 ECHO 时注入
`NARRATIVE_ENGINE_URL/HOST/PORT` 与 `VITE_ENGINE_URL`，ECHO 的
`/echo-runtime-config.js` 把它暴露成 `window.__ECHO_RUNTIME__.engineBase`，
前端与 iframe 都从这里取。

`_env_file` 只认 `projects/echo/.env`。仓库根的 `.env` 属于引擎与接入层，里面
没有 `ECHO_LLM_SOURCE` 这类 ECHO 必需项，交给 ECHO 会让它的环境校验直接失败。

## 节拍与配置

`config/echo_beats.yaml` 当前登记两个剧本包、26 个宿主节拍：

- `samples/回响-DEMO`
- `samples/索尔维/索尔维0801`

节拍里的 `pack` 相对路径以引擎根为基准，与引擎自带 `samples/` 共用目录。修改
节拍时必须保持 `id`、`trigger`、`pack`、`choices.actions` 与 ECHO 的 task/flag
命名一致。玩法参数在 `config/echo.yaml`，不要写进引擎的
`quillforge_config.yaml`。

## 验证

在仓库根：

```bash
.venv/bin/python -m pytest harness/projects/echo/tests -q    # 90
node --test harness/projects/echo/tests_js/*.cjs             # 18
```

再跑 `node scripts/integration-smoke.mjs`（11 项）确认接入层与 ECHO、引擎的
跨模块契约。

## 约定

- 引擎侧的模型选择走环境变量（`MINIGAME_MODEL`、`DEBATE_MODEL`），与引擎自己的
  `SCRIPT_GEN_MODEL` 约定一致，不往引擎的 config_manager 里塞项目字段。
- ECHO 的进度以 ECHO 为唯一事实源。本层不得直接改写 ECHO 的存档、任务运行时
  或 Flags，只能通过响应体与对白树的 actions 回写。
- 本层可以出现 quillforge 相关模块名；`projects/echo/` 内不得出现。
- 新增项目时不要改引擎，新建 `harness/projects/<name>/` 并实现
  `register(registry)`，再把模块名加入 `QUILLFORGE_PROJECTS`。
