# 第三方组件声明

本仓库仅内置运行所需的最小第三方源码，不包含其 Git 历史、用户配置或凭证。

| 组件 | 用途 | 许可 | 处理方式 |
|---|---|---|---|
| `tools/memory-graph` | 知识图谱前端组件 | MIT，Copyright 2025 supermemory | 保留 `LICENSE` 与源代码。 |
| Obsidian Local REST API | 本地 Vault 读写接口 | 外部依赖 | 不随本仓库再分发；请从其官方项目自行安装并保留其许可证。 |
| Tesseract 语言数据 | 浏览器端 OCR | 上游许可见 Tesseract 项目 | 仅保留中英语言数据，发布前应复核其上游许可证和分发条件。 |

前端 npm 依赖由 `package-lock.json` 锁定；发布前请生成并保存依赖清单或软件物料清单（SBOM）。
