# ZotWanglele 简体中文说明

ZotWanglele 是面向 Zotero 10 的 AI 阅读与 PDF 翻译插件。当前发布版本为 `0.1.3`。
完整使用说明、当前功能、开发命令与限制已经整合到仓库根目录的
[README](../README.md)。

## 当前功能摘要

- 多 AI 配置档与 OpenAI 兼容调用。
- 基于 Zotero 全文索引的论文精读与快速摘要。
- `pdf2zh`、`pdf2zh_next` 子进程翻译。
- zotero-pdf2zh 服务端翻译。
- 默认使用 PDFMathTranslate 的 `google` 翻译后端，独立于 AI 配置档。
- 任务记录页、高级设置页与 Zotero 工具栏入口；PDF 翻译按文献分开记录，批量信息更新和 AI 工作流按操作聚合，并提供卡片详情。
- Zotero 条目面板中的 AI 笔记预览，支持论文精读和快速摘要笔记的查看与生成。
- 仪表盘中的统一提示词管理，支持内置提示词内容编辑与自定义模板管理。
- Crossref 文献信息更新：按 DOI 查询、字段对比、逐字段确认和多条目串行处理。

## 文档入口

- [阶段状态](plan/00-总览与功能合并.md)
- [AI 服务层](plan/01-项目骨架与AI服务层.md)
- [PDF 精读](plan/02-PDF精读与笔记生成.md)
- [PDF 翻译](plan/03-PDF整文翻译.md)
- [开发约定](CONTRIBUTING.md)
- [测试资源](../test/README.md)
