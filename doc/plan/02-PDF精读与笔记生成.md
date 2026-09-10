# 阶段 3：PDF 精读与笔记生成

## 阶段状态

索引文本精读与快速摘要已经形成基础流程，Zotero 条目面板的 AI 笔记预览也已经接入。
多模态 PDF、多轮分析和对话追问仍待开发。

## 文本提取

`src/modules/reader/pdf-extractor.ts` 会从常规条目中查找第一个 PDF 附件，并读取
Zotero 的 `attachmentText` 全文索引。`getPdfText()` 默认返回最多 60000 个字符；
索引缺失时返回空文本。

阅读提示词统一存放在 `src/modules/ai/prompts.ts`。仪表盘中的“论文精读”和“快速摘要”
功能名称固定，可为每个功能准备多套模板并指定当前使用的一套；阅读流程按功能 ID
读取当前选用的模板内容并替换论文元数据变量。

同一模块提供 `getPdfBase64()`，可读取整个 PDF 并生成 Base64 字符串。当前
`note-generator.ts` 仅使用索引文本，因此公式、图表和后续页面可能缺少上下文。

## 笔记生成

`src/modules/reader/note-generator.ts` 的处理流程如下：

- 校验常规条目、当前 AI 配置档和必填字段。
- 读取标题、作者、年份、摘要及 PDF 索引文本。
- 组合系统提示词与用户消息，执行一次 AI 调用。
- 将 AI 返回内容转换为基础 HTML，保存为原条目的子笔记。

基础 Markdown 转换覆盖标题、段落、无序列表、代码块、粗体、斜体与行内代码。
表格、脚注、LaTeX 和复杂嵌套尚无专门处理。

## 右侧笔记预览

`src/modules/reader/note-preview.ts` 通过 `Zotero.ItemPaneManager.registerSection()`
注册“AI 笔记预览”区块，文库条目面板和 PDF Reader 均可使用。选择附件时，模块会
找到父文献，并通过 `reading-notes.ts` 查找最新的“论文精读”或“快速摘要”子笔记。

预览区提供以下操作：

- 在两类阅读笔记之间切换。
- 缺失时直接发起生成。
- 监听 Zotero item 变化并自动刷新，也可手动刷新。
- 打开对应的 Zotero 原始笔记。
- 调整字号和预览高度，设置保存于 Zotero prefs。

新生成的阅读笔记带有 `ZotWanglele-AI:<template-id>` 标签；旧笔记继续通过标题识别。

`src/modules/reader/menu.ts` 在 Zotero 条目菜单中注册“论文精读”和“快速摘要”。
菜单仅处理常规条目。多选时按条目顺序串行调用 AI，并通过进度窗口展示成功与
失败数量。

以下情况会终止单篇处理：

- 当前配置档缺少 Base URL、API Key 或模型。
- 条目缺少可读取的 PDF 附件。
- Zotero 尚未生成该 PDF 的全文索引。
- AI 返回错误或空内容。

## 后续工作

- 将 PDF 或页面图像送入支持文件理解的模型。
- 增加分段、上下文预算与长文汇总策略。
- 增加多轮分析及对话追问。
- 让用户选择 PDF 附件，并为更多模板接入执行入口。
- 增加笔记渲染测试与 Zotero 10 人工验证记录。
