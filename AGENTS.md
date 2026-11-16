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
sh scripts/test-all.sh                                               # 一键全量
```

分段跑：

```
cd engine && python -m pytest quillforge/tests -q -m "not live"       # 引擎，350 项
python -m pytest harness/projects/echo/tests -q                       # 接入层，86 项
node --test harness/projects/echo/tests_js/*.cjs                      # 接入层 JS，18 项
cd projects/echo && node --test tests/*.test.mjs                      # echo 仓库级，9 项
cd projects/echo/apps/echo && for t in scripts/test-*.ts; do node --import tsx $t; done   # 15 项
node scripts/integration-smoke.mjs                                    # 跨模块冒烟，11 项
```

引擎的 350 项里，312 项来自上游 `675c63a` 原有测试（数量与未改动的上游克隆一致，
可用来确认零回归），其余 38 项覆盖本次移植进引擎的 `script_registry`、
`runtime_paths`、带幂等头的 `/api/start` 与 `script_gen` 注册路径。

冒烟脚本分静态契约、引擎独立模式、融合模式三段，依赖缺失时报 SKIP 而非假装通过；
融合段会轮询等 ECHO 真正 ready（tsx + vite 冷启动十几秒），查一次就判定会误报。
改动引擎或接入层后至少跑冒烟与引擎 pytest。

血脉 B 的审计测试套件（`tests/audit_*.py`、`run_full_audit.py`，约 1864 行）未移植：
它按参考版「引擎与 ECHO 同仓、tests 与 src 同级」的布局硬编码路径
（`SRC_DIR = TESTS_DIR.parent / "src"`），在本仓库 engine/harness 分离的布局下全部失效，
且 `audit_findings.json` 是当时的问题基线快照、`test_audit_d_live.py` 需要实时大模型。
移植等于重写并重新基线，故未做。

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
- **`script_id` 必须是 `uuid4().hex`（32 位十六进制）**。`script_registry` 用
  `re.fullmatch(r"[0-9a-f]{32}", ...)` 校验，上游取的 `str(uuid4())[:8]` 会被全数拒绝，
  前端只能看到「生成未完成」，而服务端日志原先只记异常类名、不记错误码。
- **所有 LLM 客户端都要 `extra_body={"thinking": {"type": "disabled"}}`**。
  `sut.py` 与 `realtime_engine.py` 本来就有，上游唯独 `_build_script_gen_client` 漏了；
  思考模型会把 `max_tokens` 耗尽在 reasoning 上返回空串，而 `generate_script` 的
  Step 1A/1B 解析到空串只静默返回 None、`max_retries` 默认 1 等于不重试，
  表现为剧本生成随机失败。已补齐，并给静默失败加了告警日志。
- 生成的剧本落在 `engine/quillforge/samples/`（`SAMPLES_DIR`），**不在**
  `QUILLFORGE_VAR_DIR` 下——这是上游行为，`register_generated_script` 也要求
  剧本目录必须在 `SAMPLES_DIR` 之内。跑完验证记得清掉新增的未跟踪目录，
  别混进提交。

## 提交约定

本仓库是纯本地版本管理，**没有配置任何 remote，也不要配置**。提交信息用中文，
说清动机与影响面，不用 emoji。
