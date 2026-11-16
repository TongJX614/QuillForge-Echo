# 文档索引

这个仓库有三类文档：对外介绍、给 AI 与维护者的上下文、以及引擎与游戏各自的
技术文档。本页是入口，避免在多个 README 之间来回找。

## 先读这些

| 文档 | 读者 | 内容 |
| --- | --- | --- |
| [../README.md](../README.md) | 外部读者、评审、合作方 | 项目介绍、真实截图、功能、架构、快速开始 |
| [../AGENTS.md](../AGENTS.md) | AI 助手、新维护者 | 心智模型、目录职责、数据流、硬边界、验证命令、已知坑 |
| [../scripts/README.md](../scripts/README.md) | 本地运行者 | 编排脚本与环境变量说明 |

## 引擎

| 文档 | 内容 |
| --- | --- |
| [../engine/README.md](../engine/README.md) | 引擎定位、运行方式、API 概览、扩展点 |
| [../engine/AGENTS.md](../engine/AGENTS.md) | 引擎内部编码约定、流水线细节、故障排除 |
| [../engine/quillforge/README.md](../engine/quillforge/README.md) | Python 包结构与子模块说明 |
| [../engine/quillforge/quillforge.md](../engine/quillforge/quillforge.md) | 上游完整技术规格，适合深入实现时查阅 |
| [../engine/docs/API接口文档.md](../engine/docs/API接口文档.md) | 接口清单与请求响应示例 |
| [../engine/docs/项目审查报告-2026-11-07.md](../engine/docs/项目审查报告-2026-11-07.md) | 历史审查快照，记录当时的问题与建议 |
| [../engine/docs/一致性与生图并发审查报告-2026-11-07.md](../engine/docs/一致性与生图并发审查报告-2026-11-07.md) | 历史审查快照，聚焦锚点一致性与生图并发 |

两份审查报告写于 2026-11-07，是当时状态的记录，不是当前缺陷清单。当前测试数量、
端口与行为以 [../AGENTS.md](../AGENTS.md) 和实际代码为准。

## 接入层

| 文档 | 内容 |
| --- | --- |
| [../harness/README.md](../harness/README.md) | 接入层职责、注册表、ECHO 挂载点、目录结构 |

## ECHO 游戏

| 文档 | 内容 |
| --- | --- |
| [../projects/echo/README.md](../projects/echo/README.md) | 游戏概览、独立运行、融合运行、目录结构 |
| [../projects/echo/docs/product/experience.md](../projects/echo/docs/product/experience.md) | 玩家体验：办公室、索尔维、世界编织 |
| [../projects/echo/docs/architecture/overview.md](../projects/echo/docs/architecture/overview.md) | 客户端、Express 侧、iframe 与运行环境契约 |
| [../projects/echo/docs/development/local-development.md](../projects/echo/docs/development/local-development.md) | 本地开发、环境变量、测试 |

## 截图

以下图片是运行中的真实画面，统一为 1440x813 JPEG，放在
[assets/screenshots/](assets/screenshots/)。

| 文件 | 画面 |
| --- | --- |
| [title.jpg](assets/screenshots/title.jpg) | 标题页，回响 LOGO 与动态背景 |
| [office.jpg](assets/screenshots/office.jpg) | 回声研究所办公室，任务与交互提示 |
| [dialogue-lin-xiao.jpg](assets/screenshots/dialogue-lin-xiao.jpg) | 与林晓的对白，立绘、打字机与选项 |
| [solvay-intro.jpg](assets/screenshots/solvay-intro.jpg) | 索尔维 1927 入场影像 |
| [solvay-hall.jpg](assets/screenshots/solvay-hall.jpg) | 索尔维会场，可交互角色与言弹入口 |
| [dialogue-lorentz.jpg](assets/screenshots/dialogue-lorentz.jpg) | 与洛伦兹的对白 |
| [vr-lab.jpg](assets/screenshots/vr-lab.jpg) | VR 实验室与记忆织机 |
| [engine-home.jpg](assets/screenshots/engine-home.jpg) | 引擎创作台首页 |

截图由浏览器实际运行后采集，不使用生成图或拼贴图。更新截图时保持 16:9 左右
的视口、统一 JPEG 质量，并同步根 README 与 [../AGENTS.md](../AGENTS.md) 中的画面
描述。

## 文档维护约定

- 中文为主，命令与路径保持原样，不使用 emoji。
- 改动端口、测试数量、剧本包数量或运行模式时，同步更新根 README、AGENTS 与本页。
- 引擎与接入层的边界描述必须与 `registry.py`、`QUILLFORGE_PROJECTS` 的实际行为
  一致；`projects/echo/` 的文档中不得出现 quillforge 字样。
- 历史审查报告保留原文与日期，不追改成“当前结论”。
