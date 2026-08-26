# 测试资源说明

## 固定 PDF 样例

仓库中的 PDF 阅读与翻译测试统一使用：

`test/attentionisallyouneed04.pdf`

该文件是当前主样例。新增测试记录和人工验证说明应引用此路径。

## 翻译结果

服务端模式已经生成以下文件，并保存在仓库中：

- `test/outputs/attentionisallyouneed04-mono.pdf`
- `test/outputs/attentionisallyouneed04-dual.pdf`

## 服务端验证记录

验证环境为 `http://127.0.0.1:9999`，服务版本为 zotero-pdf2zh `4.0.4`。健康
检查、JSON Base64 翻译提交和两份结果下载均已完成。

本次验证使用 `service: google`，对应 PDFMathTranslate 的 Google 机器翻译后端。
该流程独立于插件中的 OpenAI、DeepSeek 与 Gemini 配置档。

插件使用的服务端路径如下：

```text
GET  /health
POST /translate
GET  /translatedFile/<filename>
```

## 自动化验证

保持 `9999` 服务运行，在 PowerShell 7 中执行：

```powershell
$env:ZOTWANGLELE_TEST_PDF = (Resolve-Path "test/attentionisallyouneed04.pdf").Path
npm test -- --no-watch
```

`translation.test.ts` 会创建临时 Zotero 条目，通过右键菜单命令发起翻译，并检查：

- 翻译菜单与仪表盘工具栏按钮已经注册。
- 任务记录页在完成前展示进度数值和 `100%` 状态。
- 批量翻译中的每篇文献保留独立任务记录。
- 原条目下生成 `[翻译]` 与 `[双语]` 两份附件。
- 测试结束后删除临时条目并恢复翻译设置。

`startup.test.ts` 还会检查文献综述、标题翻译菜单、Crossref 元数据更新菜单、“标题译文”自定义列、提示词内置名称、任务记录卡片展开交互和右侧笔记预览相关界面挂载状态。`features.test.ts` 覆盖统一任务记录的创建、订阅、清理、Extra 字段的译文写入与更新、Crossref DOI/日期/XML 解析、字段差异、选择性写入和 Extra 追踪行、自定义提示词的新增编辑删除，以及阅读笔记标签和查找。

`ai-workflows.test.ts` 使用本地 AI 响应替身创建临时条目，检查标题译文写入、自定义
列取值、文献综述生成与独立笔记保存。测试结束后会恢复 AI 偏好设置并删除临时条目。

真实文献综述与标题翻译调用依赖用户 AI 配置档，当前自动化测试不发送相关网络
请求。

缺少 `ZOTWANGLELE_TEST_PDF` 时，服务端翻译流程测试会跳过；启动与界面注册测试
仍会运行。

## 样例选择说明

此前使用极小页面的合成 PDF 时，ONNX TopK 阶段因候选数量过少而失败。该现象
与页面尺寸及版面候选有关。固定样例具有常规论文页面，可用于当前功能验证和
结果对比。
