# scripts

仓库的本地编排脚本。全部用 POSIX `sh` 编写，在仓库根目录执行。

## 命令

| 命令 | 作用 | 地址 |
| --- | --- | --- |
| `sh scripts/engine.sh` | 只启动引擎，`QUILLFORGE_PROJECTS` 置空 | http://127.0.0.1:8050/ |
| `sh scripts/echo.sh` | 只启动 ECHO，不接入引擎 | http://127.0.0.1:5000/ |
| `sh scripts/fusion.sh` | 融合模式，引擎在后台拉起 ECHO | 引擎 8050 / ECHO 5173 |
| `sh scripts/test-all.sh` | 依次跑五套测试与跨模块冒烟 | 终端输出 |
| `node scripts/integration-smoke.mjs` | 只跑跨模块冒烟 | 终端输出 |

`echo.sh` 要求 `pnpm`；`test-all.sh` 会优先使用 PATH 里的 `node`，找不到时尝试
`~/.local/node24/bin/node`。缺少依赖的测试段报 `SKIP`，不会伪装成通过。

## 配置文件

脚本会 `source` 仓库根的 `.env`，把它导出为环境变量。引擎自身只读
`engine/.env` 与 `engine/quillforge/.env`，靠环境变量优先级生效，无需改动引擎。
ECHO 的配置在 `projects/echo/.env`，两份配置互不代管。

首次运行：

```bash
cp .env.example .env
cp projects/echo/.env.example projects/echo/.env
```

根 `.env` 的关键项：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SERVER_HOST` / `SERVER_PORT` | `127.0.0.1` / `8050` | 引擎监听地址 |
| `QUILLFORGE_PROJECTS` | `harness.projects.echo` | 逗号分隔的项目模块；置空则不挂项目 |
| `ECHO_ENABLED` / `ECHO_AUTOSTART` | `true` | 是否由引擎托管 ECHO |
| `ECHO_HOME` | `projects/echo` | ECHO 仓库目录 |
| `ECHO_HOST` / `ECHO_PORT` | `127.0.0.1` / `5173` | 融合模式下的 ECHO 地址 |
| `ECHO_PORT_MAX_OFFSET` | `30` | 端口被占用时向后顺延的范围 |
| `ECHO_LAUNCH_MODE` | `dev` | `dev` 用 Vite 开发服务，`prod` 需要 `dist-server` |
| `ECHO_LAUNCH_TIMEOUT` | `120` | 等待 ECHO 就绪的秒数 |
| `IMAGE_CONCURRENCY` | `8` | 千问 / DashScope 生图并发 |
| `QUILLFORGE_VAR_DIR` | 仓库根 `var/` | 运行期上传、生图、音频目录，必须是绝对路径 |

密钥、模型与备选链在 `.env.example` 内有逐项注释。`.env` 不进入版本管理。

## 公共逻辑

`_common.sh` 被其余脚本 `source`，做三件事：

1. 定位仓库根并加载根 `.env`。
2. 选择 Python：优先 `.venv/bin/python`，其次 `python3.11`，最后 `python3`。
3. 在加载 `.env` 之后设置默认值。`QUILLFORGE_VAR_DIR` 若为空则指向 `var/`。

默认值必须放在 `load_root_env` 之后，否则根 `.env` 里的空赋值会盖掉默认值。

## 融合启动顺序

1. `fusion.sh` 设置 `PYTHONPATH` 为 `engine/quillforge/src` 与仓库根，使
   `harness.projects.echo` 可导入。
2. 引擎启动，`registry.py` 调用接入层的 `register(registry)`。
3. 若 `ECHO_ENABLED` 与 `ECHO_AUTOSTART` 为真，`echo_launcher.py` 在后台启动
   ECHO，注入 `NARRATIVE_ENGINE_URL/HOST/PORT` 与 `VITE_ENGINE_URL`。
4. 引擎轮询 `ECHO_LAUNCH_TIMEOUT` 秒等待 ECHO 就绪；失败时状态为
   `state=failed`，日志在 `projects/echo/.run/echo.log`，引擎本身继续运行。

ECHO 的 `/echo-runtime-config.js` 把注入的引擎地址暴露给前端和世界编织 iframe。
ECHO 不写死任何引擎位置。
