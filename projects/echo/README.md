# 格物造境 · 回响（gewuzaojing-echo）
<img width=95% alt="image" src="https://github.com/user-attachments/assets/bc50ff2d-43d3-43e9-83b5-c12aa4e799e8" />


> **让科学不再只是被讲述，而是被亲自推理。**



「格物造境 · 回响」是一个面向科学传播的 AI 叙事游戏工作台。它不把科普做成一块独立的展板，而是把科学知识写进任务链、道具与论证玩法里——玩家在探索、追问与辩驳中自己得出结论。

作品由两个可独立部署、也可协同工作的模块组成：

| 模块 | 定位 | 技术栈 | 核心输出 |
| --- | --- | --- | --- |
| **Echo / 回响**（运行端，本仓库） | 面向玩家的像素 RPG 宿主与智能体运行时 | TypeScript + Express + Vite | 任务发布、NPC 对话、状态回写 |
| **叙事引擎**（创作端，外部服务） | 面向创作者的生成式世界编织引擎 | 由接入方提供 | 世界书、剧情续写、小游戏配置 |

### 双模块体系

* **叙事引擎 · 世界创作** — 根据主题、资料与世界规则生成**世界书**（事实与来源、人物与关系、目标与冲突、生成禁区），再基于世界书上下文续写下一幕，并为关键节点编排小游戏。产出是可预览、可编辑、可导入的叙事内容包。引擎不在本仓库内，Echo 只通过约定好的 HTTP 与 iframe 消息接口消费它。

* **Echo · 智能体运行** — 读取场景、人物、道具、交互事件、Flags、任务历史和角色设定，分别生成合法的任务 JSON 与角色化 NPC 回应，再由运行端校验结构、推进任务并回写状态。**AI 只生成候选，运行端只执行受控状态动作。**

* **玩家共创闭环** — `DEFINE 玩家定义 → CO-CREATE AI 辅助创作 → EVOLVE 社区共创`。AI 给出候选，玩家负责选择、修改、发布与版本确认；是否发布与版本更新始终由创作者决定。

### 游戏内的科学体验

主线体验链为 **对话提问 → 跨场景探索 → 道具推进 → 知识进入下一幕**：

1. **天文（ASTRO）** — 追问 LISA，接到书籍支线，了解引力波探测的背景、原理与工程。
2. **材料物理（ARPES）** — 进入角分辨光电子能谱实验室，调查设备与样品杆异常，理解能带测量。
3. **VR 实验室** — 取得门禁卡后启动 VR，进入独立研究员的世界编织入口。
4. **索尔维 1927（标杆 DLC）** — 以 1927 年索尔维会议为舞台、手工制作、高事实约束的剧情内容，不依赖大模型即可完整体验。

其中索尔维路线把理论拆解成可以击破的推理链（共轭准备 → 相位漂移 → 条纹洗平），玩家在**言弹辩驳**中不是选择术语，而是击中具体的推理环节；错误言弹会明确说明为何没有击中。

### 关键技术设计

* **上下文工程与压缩** — 固定事实与来源约束、人物关系与当前立场、场景阶段与任务状态、玩家选择与生成禁区，按阶段组装成每一幕的"最小充分上下文"。

* **分阶段生成与回退** — 长链路拆成「上下文组装 → 叙事锚定 → 对话生成 → 选择分支 → 验证门」五个阶段；验证失败只回退当前阶段，不污染运行状态。

* **证据化科普** — 同一个对象（如电子衍射累积图）同时承担任务证据、科普说明与论战言弹三重角色。

* **跨应用契约** — Echo 不导入任何引擎模块，仅通过 iframe 打开其本地地址，并消费 `shared/contracts` 定义的消息词汇表；引擎地址由 `NARRATIVE_ENGINE_HOST/PORT` 给出，可留空（`shared/contracts/environment.json` 为唯一跨应用环境接口）。

游戏内含两条体验入口：

1. **索尔维 1927 路线**：手工制作、高事实约束的剧情内容，不依赖大模型即可体验。
2. **世界编织**：在 VR 实验室中与独立研究员交互，通过游戏内 iframe 接入叙事引擎，选择主题与角色、生成世界书、人工审阅确认后开启 GALGAME。未接入引擎时该入口会明确提示不可用。

体验流程：`Echo VR 研究员 → iframe → 叙事引擎世界书审阅 → GALGAME`。

## 架构概览

* Echo 不导入任何引擎模块，仅通过 iframe 打开配置好的引擎地址，并消费 `shared/contracts` 中定义的消息词汇表。

* 引擎不读取 Echo 游戏状态；其浏览器适配器负责宣布就绪、在 Escape 时请求 Echo 暂停菜单，并接收暂停/恢复通知。任务、Flags 与存档的事实源始终是 Echo。

* Echo 在没有引擎时依然可运行：生成式入口降级为不可用，手工制作的内容不受影响。

详细内容见 [docs/architecture/overview.md](docs/architecture/overview.md)。

## 环境要求

| 依赖      | 版本               |
| ------- | ---------------- |
| Node.js | 24.x（`>=24 <25`） |
| pnpm    | >= 9             |

## 快速开始（Windows PowerShell）

```powershell
# 1. 克隆仓库后进入根目录
cd gewuzaojing-echo

# 2. 一键安装：校验工具版本并安装 pnpm 依赖
pnpm setup

# 3. 复制环境变量模板并填入你的 API Key
Copy-Item .env.example .env
notepad .env

# 4. 启动开发服务
pnpm dev
```

启动成功后：

* **Echo 主游戏**：<http://127.0.0.1:5000/>

`pnpm dev` 在启动前会校验唯一的根 `.env` 文件；若端口被占用，会报告冲突的 PID 与命令行，但不会强行终止未知进程。

## 配置 API（根目录 `.env`）

Echo 的 LLM 配置写在仓库根目录的 `.env`（模板见 `.env.example`）。

> 提示：不配置 API Key 也可以启动并游玩手工制作的索尔维 1927 路线；生成式功能（游戏内对话、任务生成、世界编织等）需要配置真实密钥后才可用。

### 方式一：共用一组 LLM 连接（推荐）

```env
SHARED_LLM_PROVIDER=openai-compatible
SHARED_LLM_API_KEY=sk-你的真实密钥
SHARED_LLM_BASE_URL=https://api.deepseek.com/v1
ECHO_LLM_SOURCE=shared
```

`SHARED_LLM_PROVIDER` 目前为 `openai-compatible`，任何兼容 OpenAI Chat Completions 接口的服务均可使用（DeepSeek、Moonshot、硅基流动、本地 vLLM/Ollama 等），只需替换 `BASE_URL` 与密钥。

### 方式二：为 Echo 单独配置连接

把选择器改为 `dedicated`，并给出完整的三元组：

```env
ECHO_LLM_SOURCE=dedicated

ECHO_LLM_PROVIDER=openai-compatible
ECHO_LLM_API_KEY=echo-应用的密钥
ECHO_LLM_BASE_URL=https://echo-provider.example/v1
```

### 任务模型

```env
ECHO_CHAT_MODEL=deepseek-v4-flash       # 游戏内对话
ECHO_QUEST_MODEL=deepseek-v4-flash      # 任务生成
```

### 本地服务端口

```env
ECHO_HOST=127.0.0.1
ECHO_PORT=5000
```

### 可选：接入外部叙事引擎

世界编织需要一个在别处运行的叙事引擎。融合部署时由上层编排注入下面两项；
单独开发 Echo 时可以留空，此时世界编织入口提示未接入，其余内容照常可玩。

```env
NARRATIVE_ENGINE_HOST=127.0.0.1
NARRATIVE_ENGINE_PORT=8050
```

引擎自己的模型、密钥、图像与语音配置属于引擎仓库，不在本仓库的 `.env` 里。

## 开始游玩（Echo 主页面）

1. 启动 `pnpm dev` 后，在浏览器打开 <http://127.0.0.1:5000/>。
2. 从标题界面进入游戏，在 VR 实验室中与传送门下方的独立女研究员交互，她的第一级菜单为：

   * **体验现有世界** — 进入手工制作的索尔维 1927 路线。

   * **世界编织** — 进入世界编织：依次完成主题与角色选择，游戏内打开叙事引擎，生成世界书并供你审阅；确认后才会开始 GALGAME。

   * **暂时离开**。
3. 按 Escape 呼出 Echo 系统菜单；存档、读档、继续游戏、返回标题与退出均为宿主游戏功能，引擎页面内的 Escape 会转交给 Echo 暂停菜单处理。

## 验证与测试

```powershell
pnpm test          # 运行完整测试套件
pnpm test:repository   # 仅运行仓库结构与内容清单检查
```

测试使用安全的临时配置，不会调用真实 LLM、图像或 TTS 服务。

## 项目结构

```
gewuzaojing-echo/
├── apps/
│   └── echo/          # 像素 RPG 宿主（TypeScript + Express + Vite）
├── docs/              # 架构 / 开发 / 产品文档
├── scripts/           # setup / dev / test 等工作区脚本
├── shared/contracts/  # 跨应用环境与 iframe 消息契约
└── tests/             # 仓库级测试
```

## 授权

* 程序代码采用 **MIT**。

* 剧情、世界书、角色、美术、音频与视频等内容采用 **CC BY-NC-SA 4.0**。

目录边界与许可范围详见 [NOTICE.md](NOTICE.md) 与 [content-manifest.json](content-manifest.json)。
