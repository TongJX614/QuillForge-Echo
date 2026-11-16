# 格物造境 · 回响（ECHO）

> 让科学不再只是被讲述，而是被亲自推理。

ECHO 是面向玩家的像素 RPG，也是这套融合仓库的运行端。场景探索、任务推进、NPC
对白、背包、Flags、存档与结局判定都在这里发生。叙事引擎与本仓库同处一个融合
仓库，但 ECHO 不导入它的任何模块，只通过 HTTP、iframe 与共享消息契约通信。

作品由两个可独立运行、也可协同工作的模块组成：

| 模块 | 定位 | 技术栈 | 核心职责 |
| --- | --- | --- | --- |
| **ECHO / 回响**（运行端） | 面向玩家的像素 RPG 与智能体运行时 | TypeScript + Express + Vite | 任务、对话、状态回写与存档 |
| **叙事引擎**（创作端） | 生成式世界编织与剧情续写 | Python + FastAPI | 世界书、对白、剧本、生图与校验 |

**AI 只生成候选，运行端只执行受控状态动作。** ECHO 的存档、任务运行时与 Flags
是唯一事实源，引擎和接入层都不直接改写。

## 三条体验动线

### 记忆修复主线

从苏然的办公室开始，和林晓一起追查匿名委托，经过天文实验室、ARPES 实验室与
VR 实验室，最终进入记忆回溯。任务链、道具与对白共同推进，选择会影响属性与
后续分支。

### 索尔维 1927

以 1927 年索尔维会议为舞台，人物、争论与科学细节经过人工整理。玩家通过探索、
收集与对话推进，在现场面对爱因斯坦、玻尔、居里夫人、洛伦兹等人。路线包含入场
影像、CG、言弹辩驳与多结局，**不依赖大模型即可完整游玩**。

理论被拆成可以击破的推理链：共轭准备、相位漂移、条纹洗平。玩家不是在选项里挑
术语，而是击中具体的推理环节；错误言弹会说明为何没有击中。

### 世界编织

在 VR 实验室与研究员交互，选择「世界编织」，通过游戏内 iframe 打开叙事引擎的
创作台：确认主题、角色与真实世界书节选，生成并人工审阅世界书，确认后才进入
生成的 GALGAME。引擎未接入或生成失败时，入口会明确提示并降级，不会静默卡住。

```text
浏览器 → ECHO → iframe → 叙事引擎世界书审阅 → GALGAME
```

研究员的第一级菜单：

- **体验现有世界**：进入手工制作的索尔维 1927 路线。
- **世界编织**：进入生成式世界编织流程。
- **暂时离开**。

按 Escape 呼出 ECHO 系统菜单；存档、读档、继续游戏、返回标题与退出均为宿主
游戏功能。引擎页面内的 Escape 会转交给 ECHO 暂停菜单处理。

## 架构

- ECHO 不导入引擎模块，只消费 `shared/contracts/` 定义的环境与 iframe 消息契约。
- 引擎不读取 ECHO 游戏状态。浏览器适配器负责宣布就绪、在 Escape 时请求暂停
  菜单，并接收暂停/恢复通知。
- 引擎地址由环境变量注入；ECHO 不写死任何引擎位置，也不依赖引擎的内部实现。
- ECHO 在没有引擎时依然可运行：生成式入口降级为不可用，手工内容不受影响。

融合模式由仓库根的编排脚本启动：引擎监听 8050，ECHO 监听 5173，引擎在后台
拉起 ECHO 并注入地址。独立开发时 ECHO 默认监听 5000，两者不是同一个端口。

## 环境要求

| 依赖 | 版本 |
| --- | --- |
| Node.js | 24.x（`>=24 <25`） |
| pnpm | >= 9 |

## 快速开始

### 融合模式（推荐）

在仓库根：

```bash
cp projects/echo/.env.example projects/echo/.env
cd projects/echo && pnpm setup && cd ../..
sh scripts/fusion.sh
```

打开 http://127.0.0.1:5173/ 。引擎在 http://127.0.0.1:8050/ ，接入状态可查
`/api/echo/status`。

### 独立运行 ECHO

```bash
cd projects/echo
pnpm setup
cp .env.example .env
pnpm dev
```

打开 http://127.0.0.1:5000/ 。未注入引擎地址时，世界编织入口会提示未接入，
索尔维 1927 与记忆修复主线照常可玩。

如果已有一个在别处运行的引擎，可以在启动时注入地址：

```bash
NARRATIVE_ENGINE_HOST=127.0.0.1 NARRATIVE_ENGINE_PORT=8050 pnpm dev
```

`pnpm dev` 会校验 ECHO 根目录下的 `.env`；端口被占用时会报告冲突的 PID 与
命令行，不会强行终止未知进程。缺依赖时先执行 `pnpm setup`。

## 配置

ECHO 的配置在 `projects/echo/.env`，模板是
[.env.example](.env.example)。不配置 Key 也能启动并游玩手工内容；生成式对白、
任务生成与世界编织需要真实密钥。

### 共用一组 LLM 连接（推荐）

```env
SHARED_LLM_PROVIDER=openai-compatible
SHARED_LLM_API_KEY=replace-with-real-secret
SHARED_LLM_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
ECHO_LLM_SOURCE=shared
```

### 为 ECHO 单独配置连接

```env
ECHO_LLM_SOURCE=dedicated
ECHO_LLM_PROVIDER=openai-compatible
ECHO_LLM_API_KEY=replace-with-echo-secret
ECHO_LLM_BASE_URL=https://echo-provider.example/v1
```

### 模型与端口

```env
ECHO_CHAT_MODEL=qwen3.8-flash
ECHO_QUEST_MODEL=qwen3.8-flash
ECHO_HOST=127.0.0.1
ECHO_PORT=5000
```

融合模式下 ECHO 的端口由根 `.env` 的 `ECHO_PORT` 控制，默认 5173；被占用时按
`ECHO_PORT_MAX_OFFSET` 向后顺延。引擎地址由编排层注入，不需要在 ECHO 的
`.env` 里填写。

## 测试

```bash
pnpm test                # 完整测试套件
pnpm test:repository     # 仓库结构与内容清单
pnpm --dir apps/echo test
```

测试使用安全的临时配置，不调用真实 LLM、图像或 TTS 服务。在融合仓库根也可以
统一跑：

```bash
sh scripts/test-all.sh
```

其中 ECHO 仓库级 9 项、app 级 15 项；接入层与引擎的测试数量见根
[README](../../README.md)。

## 项目结构

```text
projects/echo/
├── apps/echo/              像素 RPG 客户端与 Express 侧
├── packages/narrative-core/独立叙事图运行时与示例
├── shared/contracts/       环境与 iframe 消息契约
├── examples/narrative-demo/世界编织成品页示例
├── docs/                   产品、架构、开发文档
├── scripts/                setup / dev / test
├── tests/                  仓库级测试
└── content-manifest.json   内容清单与许可边界
```

关键位置：

- `apps/echo/src/scenes/scenes.ts`：场景注册与位置。
- `apps/echo/src/data/dialogues.ts`：对白树与固定演出。
- `apps/echo/src/data/quests/`：任务链。
- `apps/echo/server/`：Express 侧配置、对话与生成代理。
- `apps/echo/public/videos/`：标题背景与索尔维入场影像，随仓库分发。

## 授权

- 程序代码采用 **MIT**。
- 剧情、世界书、角色、美术、音频与视频等内容采用 **CC BY-NC-SA 4.0**。

目录边界与许可范围详见 [NOTICE.md](NOTICE.md) 与
[content-manifest.json](content-manifest.json)。
