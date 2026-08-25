# ZotWanglele 开发指南

本文档提供仓库结构、当前能力和开发约定，供自动化编程工具与项目维护者使用。

## 项目范围

ZotWanglele 是 Zotero 10 插件，面向个人及小范围分享。源码使用 TypeScript，
构建基于 zotero-plugin-scaffold 和 esbuild，发布形式为单个 `.xpi` 文件。

AI 调用采用 OpenAI 兼容协议。PDF 翻译采用 PDFMathTranslate 系列工具，支持
本地子进程和 zotero-pdf2zh 服务端两种运行方式。

## 当前状态

| 模块      | 状态   | 说明                                              |
| --------- | ------ | ------------------------------------------------- |
| 项目骨架  | 已实现 | 启动、关闭、偏好设置注册和本地化                  |
| AI 配置档 | 已实现 | 多配置档、编辑器、排序、当前配置与连通性检测      |
| AI 客户端 | 已实现 | Chat Completions、Responses、SSE 和重试           |
| PDF 精读  | 基础版 | 索引文本、单轮生成、子笔记和串行批处理            |
| PDF 翻译  | 基础版 | 子进程、服务端、任务列表和结果附件                |
| 仪表盘    | 已实现 | 概览、翻译任务、提示词管理与高级设置              |
| 文献综述  | 基础版 | 多条目上下文、AI 生成与独立笔记                   |
| 标题翻译  | 已实现 | 批量翻译、Extra 存储与 Zotero 自定义列            |
| 管理工具  | 待开发 | `src/modules/tools/` 仅含 `.gitkeep`              |
| 思维导图  | 待开发 | `src/modules/mindmap/` 仅含 `.gitkeep`            |
| 阅读侧栏  | 已实现 | Zotero 条目面板中的 AI 笔记预览、生成、刷新和打开 |

## 代码结构

```text
src/index.ts                     插件入口与全局对象
src/hooks.ts                     生命周期与窗口初始化
src/modules/preferenceScript.ts  AI 配置档偏好设置
src/modules/ai/                  AI 客户端、预设、配置档与通用提示词
src/modules/reader/              PDF 文本读取、笔记生成与条目菜单
src/modules/review/              多文献综述生成与笔记保存
src/modules/title-translate/     标题翻译、Extra 存储与条目列表列
src/modules/translate/           翻译配置、环境、子进程、任务和执行器
src/modules/dashboard/           仪表盘窗口、翻译任务页与高级设置
src/modules/ui/toolbar.ts        主窗口工具栏入口
addon/content/                   XUL/XHTML 界面与样式
addon/locale/                    中英文 Fluent 本地化
doc/plan/                        阶段状态与后续计划
test/                            启动测试、翻译流程测试与 PDF 样例
```

## 开发约定

- AI 网络调用集中在 `src/modules/ai/ai-client.ts`。
- 通用 AI 提示词位于 `src/modules/ai/prompts.ts`。
- 精读、摘要及其他 AI 功能提示词统一位于 `src/modules/ai/prompts.ts`，通过仪表盘提示词管理持久化。
- PDF 翻译统一从 `src/modules/translate/translator.ts` 发起。
- 条目右键菜单由 `src/modules/reader/menu.ts` 实现，并由 `src/hooks.ts` 注册。
- 偏好设置键使用 `extensions.zotero.zotwanglele.` 前缀。
- 中文为主要本地化，英文维持基础覆盖。
- 任务列表目前属于进程内状态，修改时需保留关闭窗口后的订阅清理。
- 服务端模式遵循 zotero-pdf2zh 4.x 的 JSON Base64 请求格式。
- PDF 翻译读取 `translate.*` 设置，默认服务为 `google`；AI 配置档用于论文精读。
- 插件向 pdf2zh 发送翻译服务名，服务密钥由 pdf2zh 运行环境管理。
- 源码改动保持小范围，避免为个人插件引入重型基础设施。

## 验证命令

```powershell
npm run build
npm run lint:check
npm test
```

`npm test` 需要可启动的 Zotero 测试环境。PDF 翻译样例与已有结果记录在
`test/README.md`。

服务端翻译流程测试还需要设置 `ZOTWANGLELE_TEST_PDF`，并保持
`http://127.0.0.1:9999` 可用。测试会验证右键菜单、任务页进度以及单语、双语
附件。

## 文档维护

文档需要区分已有实现与后续计划。新增功能完成后，应同步更新根 README、对应
阶段文档和测试说明。
