# Quillforge-Echo

QuillForge 作为可驱动不同项目的叙事 harness 引擎，ECHO 作为被驱动的项目试例。
两个项目各自都能独立运行；接入之后由引擎承担任务发布、角色对话生成、剧本
生成与校验，ECHO 继续持有场景、任务、Flags 与存档的事实源。

## 目录

| 路径 | 角色 |
| --- | --- |
| `engine/` | QuillForge 引擎，取自上游 `675c63a`。只增加了通用扩展点，不含任何 ECHO 逻辑 |
| `harness/` | 项目接入层。`harness/projects/echo/` 是 ECHO 适配器，全部 ECHO 专有代码在此 |
| `projects/echo/` | ECHO 像素 RPG，取自上游 `gewuzaojing-echo@main`，已摘除内嵌引擎并去除全部引擎命名 |
| `scripts/` | 三种运行模式的编排脚本与跨模块冒烟 |

## 分工

引擎负责生成与校验：五阶段流水线（上下文组装 → 叙事锚定 → 对话生成 → 选择
分支 → 验证门）、剧本生成、实时生成模式、生图、TTS、内容安全拦截、剧本原文
锚点与实体保真校验。

ECHO 负责运行与状态：场景与地图、任务发布与推进、NPC 对话呈现、Flags、背包、
存档。引擎不直接改写 ECHO 的任何运行态，进度只通过请求/响应与对白树的 actions
回写。

接入层负责翻译：把 ECHO 的宿主节拍（`echo_beats.yaml`，2 个剧本包 / 26 个节拍）
映射到引擎的生成能力，并把引擎地址在启动时注入给 ECHO。

## 接入方式

引擎核心不认识任何具体项目。项目模块实现 `register(registry)`，向注册表声明
自己的路由、页面、静态目录、首页卡片、会话中断态与子进程启停钩子。启用方式
是环境变量：

```
QUILLFORGE_PROJECTS=harness.projects.echo
```

不设置这个变量时注册表为空，引擎行为与上游完全一致。会话中断态是引擎提供的
通用机制：引擎只出一个 `INTERLUDE` 状态和一块 per-session 暂存区，玩法的注入、
生成、判定与结算都在项目侧实现。ECHO 的剧情小游戏就是这样挂上去的，对外
`session_state` 仍报 `minigame`，前端契约不变。

接入第二个项目时不需要改引擎，新增一个 `harness/projects/<name>/` 并在
`QUILLFORGE_PROJECTS` 里追加即可。

## 运行

先准备两份配置，两边互不代管：

```
cp .env.example .env                        # 引擎与接入层
cp projects/echo/.env.example projects/echo/.env   # ECHO 自身
```

三种模式：

```
sh scripts/engine.sh     # 只起引擎，不接入任何项目    http://127.0.0.1:8050/
sh scripts/echo.sh       # 只起 ECHO，不接引擎          http://127.0.0.1:5000/
sh scripts/fusion.sh     # 融合：引擎驱动 ECHO          引擎 8050 / ECHO 5173
```

融合模式下引擎起来后由接入层在后台拉起 ECHO，并把引擎地址通过
`NARRATIVE_ENGINE_URL/HOST/PORT` 注入给它。ECHO 自己不写死任何引擎位置；没有
注入时世界编织入口会明确提示引擎未接入，手工制作的索尔维 1927 路线照常可玩。

依赖：引擎需要 Python 3.11 与 `engine/requirements.txt`；ECHO 需要 Node.js 24
与 pnpm 9+。

## 验证

```
sh scripts/test-all.sh    # 一键跑全部
```

分段：

| 套件 | 命令 | 数量 |
| --- | --- | --- |
| 引擎 | `cd engine && python -m pytest quillforge/tests -q -m "not live"` | 350 |
| 接入层 | `python -m pytest harness/projects/echo/tests -q` | 86 |
| 接入层 JS | `node --test harness/projects/echo/tests_js/*.cjs` | 18 |
| ECHO 仓库级 | `cd projects/echo && node --test tests/*.test.mjs` | 9 |
| ECHO app 级 | `cd projects/echo/apps/echo`，逐个 `node --import tsx scripts/test-*.ts` | 15 |
| 跨模块冒烟 | `node scripts/integration-smoke.mjs` | 11 |

引擎的 350 项里有 312 项是上游 `675c63a` 原有测试，数量与未改动的上游克隆一致，
用来确认零回归。冒烟脚本分静态契约、引擎独立模式、融合模式三段，依赖缺失时明确
报 SKIP 而不是假装通过。

依赖：引擎需要 Python 3.11 与 `engine/requirements.txt`（`rembg` 可选，缺失时生图
自动降级为占位图）；ECHO 的 app 级测试需要 `projects/echo/apps/echo/node_modules`
里有 `tsx`。

## 细节

- 引擎架构与故障排除：[engine/AGENTS.md](engine/AGENTS.md)
- 接入层实现说明：[harness/README.md](harness/README.md)
- ECHO 侧文档：[projects/echo/README.md](projects/echo/README.md)

## 授权

引擎与 ECHO 的程序代码沿用各自上游许可。剧情、世界书、角色、美术与音频等
内容采用 CC BY-NC-SA 4.0，边界见 [projects/echo/NOTICE.md](projects/echo/NOTICE.md)
与 [projects/echo/content-manifest.json](projects/echo/content-manifest.json)。
