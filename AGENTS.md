# AGENTS.md — 仓库工作指南

## 这个仓库是什么

三段式融合：`engine/` 是 QuillForge 叙事 harness 引擎，`harness/` 是项目接入层，
`projects/echo/` 是被驱动的项目试例（ECHO 像素 RPG）。引擎与 ECHO 各自都能独立
运行，接入后由引擎承担生成，ECHO 继续持有运行态的事实源。

来源与版本：

| 目录 | 上游 | 提交 |
| --- | --- | --- |
| `engine/` | `TongJX614/QuillForge` | `675c63a` |
| `projects/echo/` | `TongJX614/gewuzaojing-echo` | `e1ce5b9`（`apps/echo` 取融合版内容） |

`_upstream/` 是只读参照克隆，不参与构建，已在 `.gitignore` 中排除。改代码前可以
用它做三方比对：`diff --strip-trailing-cr` 能滤掉这两个上游混乱的行尾，不加会看到
大量假差异。

## 硬性边界

- **引擎核心不得出现任何 ECHO 专有逻辑**。ECHO 的东西一律放
  `harness/projects/echo/`，通过 `registry.py` 挂载。判断标准：把
  `QUILLFORGE_PROJECTS` 置空后，引擎行为必须与上游 `675c63a` 一致。
- **`projects/echo/` 里不得出现 quillforge 字样**（大小写不敏感）。引擎地址只经
  `NARRATIVE_ENGINE_HOST/PORT/URL` 注入，echo 不写死任何引擎位置。
- **导入方向单向**：harness 可以导入引擎模块，引擎不得导入 harness。
- **ECHO 进度以 ECHO 为唯一事实源**：引擎与接入层不得直接改写 ECHO 的存档、
  任务运行时或 Flags。

新增项目时不要改引擎，新建 `harness/projects/<name>/` 实现 `register(registry)`，
在 `QUILLFORGE_PROJECTS` 里追加模块名即可。

## 引擎侧为接入提供的通用能力

`registry.py`（注册表与装载）、`runtime_paths.py`（`QUILLFORGE_VAR_DIR` 运行期
目录外置）、`script_registry.py`（生成剧本的可信边界与先审阅后开局）、
`session_manager.py` 的 `INTERLUDE` 状态与 `start/resolve/cancel_interlude` 委托、
`routes/pages.py` 的 `serve_page_file` 与 `/api/projects`、`server.py` 的
`StaticDirSpec` 挂载与 lifespan 进程启停。

相对上游 `675c63a`，引擎还合入了两项与项目无关的通用能力：一是剧本锚点一致性
子系统（`generic_adapter` 提取场景原文/全局设定/允许实体清单，经 `extra_context`
与 `sut` 渲染进 `system_prompt_v2` 的锚点段，`validator.check_script_entity_fidelity`
由 Stage 5 追加为第 9 项阻断级校验，`core` 在校验失败时回灌 `validationFeedback`），
与上游自带的 `personality_judge`、`content_guard` 双层并存；二是两处缺陷修复
（YAML 纯数字角色 id 的防御性字符串化、剧本选项 `effect` 缺省时补默认值）。

## 运行

```
sh scripts/engine.sh     # 只起引擎    QUILLFORGE_PROJECTS 置空
sh scripts/echo.sh       # 只起 ECHO   不接引擎
sh scripts/fusion.sh     # 融合        引擎拉起 ECHO 并注入地址
```

两份 `.env` 互不代管：仓库根的给引擎与接入层，`projects/echo/.env` 给 ECHO。
引擎的 `config_manager` 只读 `engine/.env` 与 `engine/quillforge/.env`，编排脚本把
根 `.env` 导出到环境变量，靠环境变量优先级更高的既有规则生效，引擎无需改动。

## 验证

```
node scripts/integration-smoke.mjs                                  # 跨模块冒烟，11 项
cd engine && python -m pytest quillforge/tests -q -m "not live"      # 引擎，312 项
cd projects/echo && node --test tests/*.test.mjs                     # echo 仓库级，8 项
cd projects/echo/apps/echo && for t in scripts/test-*.ts; do node --import tsx $t; done   # 15 项
```

冒烟脚本分静态契约、引擎独立模式、融合模式三段，依赖缺失时报 SKIP 而非假装通过。
改动引擎或接入层后至少跑冒烟与引擎 pytest。

## 已知的坑

- 本机 `node` 不在默认 PATH，在 `~/.local/node24/bin/node`；`pnpm` 可能缺失，
  缺了 ECHO 拉不起来，`echo_launcher` 会如实报 `state=failed` 并给出日志路径，
  引擎本身不受影响。
- `QUILLFORGE_VAR_DIR` 必须是绝对路径。空字符串按未设置处理，不要写成空值赋值。
- `scripts/_common.sh` 的默认值要在 `load_root_env` 之后由 `apply_defaults` 设置，
  否则根 `.env` 里的空赋值会盖掉默认值。
- Vite 的 HMR 固定用 24678 端口，同时跑多个 ECHO 实例会冲突。
- `FastAPI` 0.163 起 `app.routes` 里是 `_IncludedRouter` 包装，数不出真实端点数；
  用 `app.openapi()["paths"]` 核验。
- 上游 `gewuzaojing-echo@main` 的 `tests/public-docs.test.mjs` 有一个自带失败
  （README 缺「索尔维会议」表述），本仓库已顺手修掉。

## 提交约定

本仓库是纯本地版本管理，**没有配置任何 remote，也不要配置**。提交信息用中文，
说清动机与影响面，不用 emoji。
