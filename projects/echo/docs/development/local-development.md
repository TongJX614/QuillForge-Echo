# 本地开发

## 环境

| 依赖 | 版本 |
| --- | --- |
| Node.js | 24.x（`>=24 <25`） |
| pnpm | >= 9 |

## 融合模式（推荐）

在融合仓库根：

```bash
cp .env.example .env
cp projects/echo/.env.example projects/echo/.env
cd projects/echo && pnpm install && cd ../..
sh scripts/fusion.sh
```

- 引擎：http://127.0.0.1:8050/
- ECHO：http://127.0.0.1:5173/
- 接入状态：http://127.0.0.1:8050/api/echo/status

根 `.env` 负责引擎、生图、TTS 与 ECHO 启动参数；`projects/echo/.env` 负责 ECHO
自己的 LLM 连接与模型。两份配置互不代管。根 `.env` 的 `ECHO_PORT` 默认 5173，
被占用时按 `ECHO_PORT_MAX_OFFSET` 向后顺延。

## 只开发 ECHO

```bash
cd projects/echo
pnpm install
cp .env.example .env
pnpm dev
```

ECHO 监听 `127.0.0.1:5000`。`pnpm dev` 会先校验 ECHO 根目录下的 `.env`，端口
冲突时报告 PID 与命令行，不强行终止未知进程。开发服务由
`scripts/lib/process-supervisor.mjs` 托管，退出时统一停止。

如果已有引擎在运行：

```bash
NARRATIVE_ENGINE_HOST=127.0.0.1 NARRATIVE_ENGINE_PORT=8050 pnpm dev
```

未注入地址时，世界编织入口提示未接入，手工内容照常可玩。

## LLM 连接

`projects/echo/.env` 支持两种方式：

```env
# 共用一组连接
SHARED_LLM_PROVIDER=openai-compatible
SHARED_LLM_API_KEY=replace-with-real-secret
SHARED_LLM_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
ECHO_LLM_SOURCE=shared
```

```env
# ECHO 单独连接
ECHO_LLM_SOURCE=dedicated
ECHO_LLM_PROVIDER=openai-compatible
ECHO_LLM_API_KEY=replace-with-echo-secret
ECHO_LLM_BASE_URL=https://echo-provider.example/v1
```

模型：

```env
ECHO_CHAT_MODEL=qwen3.8-flash
ECHO_QUEST_MODEL=qwen3.8-flash
```

不配置 Key 也能启动；生成式功能会降级，索尔维 1927 路线不受影响。

## 测试

```bash
pnpm test                # 完整测试套件
pnpm test:repository     # 仓库结构与内容清单
pnpm --dir apps/echo test
```

测试使用安全的临时配置，不调用真实 LLM、图像或 TTS 服务。融合仓库根也可以跑
`sh scripts/test-all.sh` 统一验证。

## 常见问题

- **`pnpm` 不存在**：先 `corepack enable` 或 `npm i -g pnpm`。融合模式下缺 pnpm
  时 ECHO 会被报告为 `state=failed`，引擎本身不受影响。
- **Node 不是 24**：`pnpm setup` 与 `pnpm dev` 都会校验主版本。
- **端口被占用**：独立模式会报告冲突；融合模式会从 `ECHO_PORT` 向后寻找空闲端口。
- **视频不显示**：确认 `apps/echo/public/videos/intro.mp4` 与 `solvay-enter.mp4`
  存在；两者已通过 `.gitignore` 例外规则随仓库分发。
