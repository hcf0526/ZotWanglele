# ZotWanglele 简体中文说明

ZotWanglele 是面向 Zotero 9 的 AI 阅读与 PDF 翻译插件。完整使用说明、当前
功能、开发命令与限制已经整合到仓库根目录的
[README](../README.md)。

## 当前功能摘要

- 多 AI 配置档与 OpenAI 兼容调用。
- 基于 Zotero 全文索引的论文精读与快速摘要。
- `pdf2zh`、`pdf2zh_next` 子进程翻译。
- zotero-pdf2zh 服务端翻译。
- 默认使用 PDFMathTranslate 的 `google` 翻译后端，独立于 AI 配置档。
- 翻译任务页、高级设置页与 Zotero 工具栏入口。

## 文档入口

- [阶段状态](plan/00-总览与功能合并.md)
- [AI 服务层](plan/01-项目骨架与AI服务层.md)
- [PDF 精读](plan/02-PDF精读与笔记生成.md)
- [PDF 翻译](plan/03-PDF整文翻译.md)
- [开发约定](CONTRIBUTING.md)
- [测试资源](../test/README.md)
