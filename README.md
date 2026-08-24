# ZotWanglele

ZotWanglele 是面向 Zotero 10 的 AI 阅读与 PDF 翻译插件。项目采用
TypeScript、zotero-plugin-scaffold 和 zotero-plugin-toolkit，以单个
`.xpi` 文件交付。

当前版本为 `0.1.0`，处于功能开发阶段。中文是主要界面语言，英文保留基础
本地化。

## 当前能力

### AI 配置与调用

- 管理多个 AI 配置档，支持新增、编辑、删除、排序和当前配置切换。
- 内置 DeepSeek、OpenAI、Claude、Gemini、Ollama 和 SiliconFlow 预设，
  也支持自定义 Base URL、模型与 API 格式。
- 统一支持 Chat Completions 和 Responses 两种 OpenAI 兼容格式。
- AI 客户端包含流式响应、重试和多模态消息辅助函数。
- 配置编辑器提供 API 连通性检测。

### PDF 精读

- Zotero 条目右键菜单提供“论文精读”和“快速摘要”。
- 从 Zotero 全文索引读取 PDF 文本，默认最多使用 60000 个字符。
- 多选条目采用串行处理，并在进度窗口显示执行状态。
- AI 结果保存为原条目的子笔记，Markdown 由内置轻量转换器生成 HTML。
- PDF Base64 读取函数已经存在；当前精读流程仍使用全文索引文本。

### PDF 翻译

- 支持 `pdf2zh` 与 `pdf2zh_next`。
- 子进程模式包含 `uv-auto`、`uv-manual` 和 `bundle` 三种环境来源。
- 服务端模式使用 zotero-pdf2zh 的 JSON Base64 协议：
  `GET /health`、`POST /translate` 和
  `GET /translatedFile/<filename>`。
- 支持单语、双语输出，并将生成文件导入原 Zotero 条目。
- 仪表盘显示内存中的翻译任务、进度、日志与结果文件。
- 翻译服务默认使用 PDFMathTranslate 的 `google` 后端，与 Gemini API 和 AI 配置档
  无关。

### 文献综述

- 对条目列表中选中的 2 至 30 篇文献生成结构化综述。
- 优先读取摘要；摘要为空时使用最多 8000 个字符的 PDF 索引文本。
- 综述包含带编号的题录、作者、年份与 DOI 上下文，便于核查来源。
- 结果保存为独立 Zotero 笔记，并加入当前选中的分类。

### 标题翻译

- 条目右键菜单与仪表盘均提供批量标题翻译入口。
- 译文写入条目的 Extra 字段，已有 Extra 内容会继续保留。
- Zotero 条目列表注册“标题译文”自定义列，支持排序、调整宽度和显示状态持久化。

### 用户界面

- 原生偏好设置用于管理 AI 配置档。
- 独立配置编辑器用于填写服务商、Base URL、API Key、模型与生成参数。
- Zotero 工具栏按钮用于打开仪表盘。
- 仪表盘提供工作概览、翻译任务、提示词管理和高级设置四个页面。
- 提示词管理支持查看内置模板，以及新增、编辑、删除自定义模板。
- 自定义模板保存在 Zotero prefs，重新启动后仍可使用。

## 待开发能力

- PDF 多模态精读、多轮分析与对话追问。
- 文献对比矩阵、自动标签和清理工具。
- 思维导图、阅读侧栏、任务取消、任务持久化和历史记录。
- 发布流程与 Zotero 10 环境下的完整回归测试。

## 使用流程

### AI 精读

1. 在 Zotero 插件偏好设置中打开 ZotWanglele。
2. 新增 AI 配置档并完成连通性检测。
3. 将需要使用的配置档设为当前配置。
4. 在文献条目右键菜单中选择“论文精读”或“快速摘要”。

PDF 需要具备 Zotero 全文索引。当前配置档需要填写 Base URL、API Key 和模型
名称。

### PDF 翻译

1. 通过 Zotero 工具栏打开仪表盘。
2. 在高级设置中选择环境来源、翻译引擎、输出类型、语言和翻译服务。
3. 使用“立即检测”确认运行环境。
4. 在文献条目右键菜单中选择“翻译 PDF”。
5. 在仪表盘的翻译任务页查看状态。

服务端模式可填写类似 `http://127.0.0.1:9999` 的地址。子进程模式要求系统
中存在可用的 `uv`，或提供手动路径与 bundle 目录。

“翻译服务”默认值为 `google`，表示 PDFMathTranslate 的 Google 机器翻译后端。
插件会把服务名发送给 pdf2zh；服务所需密钥由 pdf2zh 运行环境提供。AI 配置档中
的 OpenAI、DeepSeek、Gemini 等 API Key 仅用于论文精读。

### 文献综述与标题翻译

1. 在条目列表中选择两篇或更多文献。
2. 从 ZotWanglele 子菜单选择“生成文献综述”。
3. 综述完成后，插件会选中新建的 Zotero 笔记。
4. 选择“翻译标题”可批量生成标题译文。
5. 在 Zotero 列选择器中确认“标题译文”列处于显示状态。

两项 AI 功能均读取当前 AI 配置档。标题译文保存在条目 Extra 字段的
`ZotWanglele-Translated-Title` 行中。

## 开发环境

- Windows PowerShell 7
- Node.js 与 npm
- Zotero 10
- TypeScript 5.9

```powershell
npm install
npm run build
npm run lint:check
npm test
```

`npm run build` 会生成生产构建并执行 `tsc --noEmit`。产物位于
`.scaffold/build/`。开发启动依赖本地 `.env` 中的 Zotero 路径与 profile
配置。

运行 pdf2zh 服务端功能测试时，需要提供固定样例路径，并保持 `9999` 服务可用：

```powershell
$env:ZOTWANGLELE_TEST_PDF = (Resolve-Path "test/attentionisallyouneed04.pdf").Path
npm test -- --no-watch
```

该测试会在临时 Zotero profile 中创建条目，通过右键菜单命令发起翻译，检查任务
页进度及单语、双语附件，并在结束时清理临时条目。

## 项目结构

```text
addon/                  Zotero 静态资源、界面和本地化
src/modules/ai/         AI 客户端、预设、配置档与提示词
src/modules/reader/     PDF 提取、精读笔记与右键菜单
src/modules/review/     多文献综述生成与笔记保存
src/modules/title-translate/ 标题翻译、元数据存储与自定义列
src/modules/translate/  翻译配置、环境、进程、任务和执行器
src/modules/dashboard/  仪表盘概览、提示词、任务页和高级设置
src/modules/ui/         Zotero 主窗口工具栏
doc/plan/               阶段状态与后续计划
test/                   启动测试、翻译流程测试、PDF 样例与结果
```

## 文档索引

- [简体中文说明](doc/README-zhCN.md)
- [Documentation française](doc/README-frFR.md)
- [开发约定](doc/CONTRIBUTING.md)
- [开发阶段总览](doc/plan/00-总览与功能合并.md)
- [测试资源说明](test/README.md)

## 已知限制

- 当前精读流程依赖 Zotero 全文索引，并截取前 60000 个字符。
- 文献综述单次最多处理 30 篇，当前没有对比矩阵与引用格式选择。
- AI 配置档存于 Zotero prefs，API Key 会随配置档 JSON 保存。
- 翻译任务仅保存在内存中，Zotero 重启后清空。
- 服务端翻译请求会等待服务完成，仪表盘目前没有服务端实时百分比。
- `uv-auto` 负责搜索已有 `uv`；自动下载 `uv` 尚未实现。

## 许可证

本项目采用 [AGPL-3.0-or-later](LICENSE)。
