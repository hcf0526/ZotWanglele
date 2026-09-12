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

`profile-manager.test.ts` 检查插件设置页面与仪表盘共用的 AI 配置操作：
选中模型、设为当前、组内排序、两处同步、翻译模型选项刷新及卸载清理。
供应商弹窗测试从仪表盘与 Zotero 原生设置页面的实际按钮进入，检查多 Key、
两种 API 格式、模型列表与生成参数的填入，以及取消、保存和删除确认。
测试使用模拟凭据，结束后恢复原有设置。
2026-09-12 修复仪表盘打开供应商编辑器时的初始化依赖，回归共 55 项通过。
正式安装后，通过 Zotero 内部调试检查 `zotero-wanglele` 中两家供应商的
Key、模型与生成参数均可填入，检查前后的 AI 配置内容一致。
`startup.test.ts` 检查六个页签顺序和新增页面挂载；划词翻译设置的保存沿用独立偏好项。
2026-09-12 在 Zotero 10.0.2 测试 profile 中检查了仪表盘 AI 配置、插件设置页面、
供应商编辑器与划词翻译设置的实际窗口；覆盖 125% 显示缩放、约 746px 宽仪表盘、
长模型名称、列表内滚动与设置页原生标签宽度影响。

进度提示使用 Zotero 默认背景、颜色、字号与间距，仅覆盖衬线字体。
人工检查启动提示、多行任务提示和自动关闭，并与 Zotero 原生提示比较外观。
Windows 中移除提示窗的 `customtitlebar` 属性，避免 Zotero 10 无标题栏窗口出现宽边框。
2026-09-12 已在 `zotero-wanglele` profile、Zotero 10.0.2 和 125% 显示缩放下
核对实际截图：默认底色与文字颜色一致，外框恢复细边线，主题字体、多行扩展与自动关闭正常。

`selection-translation.test.ts` 覆盖 Unicode 字符上限、文本分段、百度固定签名、
服务响应、缓存与配置变化、快速换词、重复点击、自动翻译延迟、请求取消、纯文本
渲染、浮层与侧栏同步、设置持久化，以及阅读器标签页映射和关闭清理。

`ai-transport.test.ts` 覆盖 Chat Completions 和 Responses 的流式与普通调用，
HTTP 失败、跨事件与跨 Unicode 字符解析、中断、提前结束、超时、异常响应及重试取消。
测试使用模拟网络响应，保持现有 AI 功能的调用方式。

2026-09-12 在 Zotero 10.0.2 的测试 profile 中完成原生 PDF 浮层与侧栏检查，
并通过本地模拟 SSE 服务验证了插件实际调用路径。已检查复制、独立窗口、240px
内容区、缩放、焦点轮廓与减少动态效果。真实服务凭据与网络通道由用户验证。

常规回归可执行 `npm test -- --no-watch`。PowerShell 中可使用以下方式保留完整参数：

```powershell
npm.cmd --% test -- --no-watch
```

测试使用 `.scaffold/test/profile`，与用户 profile 分开。

`profiles.test.ts` 覆盖供应商名称的旧配置兼容、保存与重读、跨原预设分组，以及同组配置排序。

`supplier-models.test.ts` 覆盖多 Key 模型汇总、保存重读、Key 移除后的模型选择、供应商合并、翻译模型筛选，以及 `/v1/models` 地址、认证和异常响应。模型获取测试使用响应替身。

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

`startup.test.ts` 还会检查文献综述、标题翻译菜单、Crossref 元数据更新菜单、“标题译文”自定义列、提示词功能列表与默认模板名称、任务记录卡片展开交互和右侧笔记预览相关界面挂载状态。`features.test.ts` 覆盖统一任务记录的创建、订阅、清理、Extra 字段的译文写入与更新、Crossref DOI/日期/XML 解析、字段差异、选择性写入和 Extra 追踪行、自定义提示词的新增编辑删除、按功能分组与当前模板切换，以及阅读笔记标签和查找。

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
