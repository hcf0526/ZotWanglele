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
| PDF 翻译  | 基础版 | 子进程、服务端、逐篇任务记录和结果附件            |
| 仪表盘    | 已实现 | 概览、任务记录、提示词管理与高级设置              |
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
src/modules/tasks/                统一任务记录、订阅与清理
src/modules/translate/           翻译配置、环境、子进程与执行器
src/modules/dashboard/           仪表盘窗口、任务记录页与高级设置
src/modules/ui/toolbar.ts        主窗口工具栏入口
addon/content/                   XUL/XHTML 界面与样式
addon/locale/                    中英文 Fluent 本地化
doc/plan/                        阶段状态与后续计划
test/                            启动测试、翻译流程测试与 PDF 样例
```

## 主要代码用途

| 文件                                      | 用途                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                            | 插件入口，挂载 `Zotero.ZotWanglele` 全局对象与生命周期钩子。                                                                                                                                                                                                                              |
| `src/hooks.ts`                            | `onStartup`/`onMainWindowLoad`/`onShutdown`，注册工具栏、右键菜单、条目面板区块与偏好脚本。                                                                                                                                                                                               |
| `src/modules/preferenceScript.ts`         | 插件设置页面逻辑：AI 配置档列表、增删改排序、注入 `preferences.css`（`injectPrefsStylesheet`，偏好面板会丢弃 XHTML 顶部 `xml-stylesheet`，样式表只能运行时注入）。                                                                                                                        |
| `src/modules/ai/ai-client.ts`             | 全部 AI 网络调用的唯一出口：Chat Completions、Responses、SSE 流式、重试。                                                                                                                                                                                                                 |
| `src/modules/ai/profiles.ts`              | AI 配置档的持久化（Zotero prefs 中的 JSON）、当前配置切换。                                                                                                                                                                                                                               |
| `src/modules/ai/profile-editor.ts`        | 配置档编辑窗口逻辑与 API 连通性检测。                                                                                                                                                                                                                                                     |
| `src/modules/ai/prompts.ts`               | 内置提示词与自定义模板管理，仪表盘提示词页的数据来源。                                                                                                                                                                                                                                    |
| `src/modules/reader/note-preview.ts`      | 条目面板“AI 笔记预览”区块：论文精读/快速摘要的自定义下拉切换、生成、刷新、打开笔记、字号与高度调整。样式内嵌于 `ensurePreviewStyles`；内容容器使用 `contain: inline-size` 让 Zotero 决定侧栏宽度，避免 JS 测宽循环与长内容撑破面板；笔记 HTML 经 `sanitizePreviewHtml` 白名单清理后渲染。 |
| `src/modules/reader/note-generator.ts`    | 精读/摘要生成流程：全文索引读取、任务记录联动、子笔记写入。                                                                                                                                                                                                                               |
| `src/modules/reader/reading-notes.ts`     | 精读与摘要子笔记的定义、查找与归属（附件映射父文献）。                                                                                                                                                                                                                                    |
| `src/modules/reader/menu.ts`              | 条目右键菜单注册（精读、摘要、翻译、综述、标题翻译、文献信息更新）。                                                                                                                                                                                                                      |
| `src/modules/review/`                     | 多文献综述生成、上下文构建与独立笔记保存。                                                                                                                                                                                                                                                |
| `src/modules/title-translate/`            | 批量标题翻译、Extra 字段读写、条目列表“标题译文”自定义列。                                                                                                                                                                                                                                |
| `src/modules/metadata.ts`                 | Crossref 查询、字段对比窗口数据与选择性写入。                                                                                                                                                                                                                                             |
| `src/modules/tasks/task-store.ts`         | 统一任务记录（进程内状态）、订阅通知；窗口关闭时需清理订阅。                                                                                                                                                                                                                              |
| `src/modules/translate/`                  | PDF 翻译：配置读取、`uv` 环境探测、pdf2zh 子进程与服务端执行器。                                                                                                                                                                                                                          |
| `src/modules/dashboard/dashboard.ts`      | 仪表盘单例窗口与页签切换。                                                                                                                                                                                                                                                                |
| `src/modules/dashboard/queue-panel.ts`    | 任务记录页：卡片列表、进度与详情。                                                                                                                                                                                                                                                        |
| `src/modules/dashboard/advanced-panel.ts` | 高级设置页：翻译环境、引擎、输出与语言。                                                                                                                                                                                                                                                  |
| `src/modules/dashboard/prompts-panel.ts`  | 提示词管理页：按功能列出内置能力，中间管理该功能的模板，右侧编辑提示词。                                                                                                                                                                                                                  |
| `src/modules/dashboard/overview-panel.ts` | 工作概览页：配置、模板、任务统计与常用操作。                                                                                                                                                                                                                                              |
| `src/modules/ui/confirm-dialog.ts`        | 统一操作确认窗口：删除供应商、删除自定义模板与恢复内置模板。                                                                                                                                                                                                                              |
| `src/modules/ui/toolbar.ts`               | Zotero 主工具栏的仪表盘按钮。                                                                                                                                                                                                                                                             |
| `addon/content/paper-theme.css`           | 全插件纸感主题变量：纸面、文字、分隔线、功能色、字体与焦点色。                                                                                                                                                                                                                            |
| `addon/content/preferences.css`           | 设置页面纸感主题（米色画布、纸质面板、衬线字体、红/苔绿点缀）。                                                                                                                                                                                                                           |
| `addon/content/dashboard.css`             | 仪表盘纸感主题与任务卡片样式。                                                                                                                                                                                                                                                            |
| `addon/content/profile-editor.css`        | 配置编辑器纸感表单、Key 卡片与操作区样式。                                                                                                                                                                                                                                                |
| `addon/content/metadata-dialog.css`       | Crossref 候选、字段对比、处理结果与操作确认窗口的共享样式。                                                                                                                                                                                                                               |
| `addon/content/progress-window.css`       | 插件进度提示的纸感样式，由 ztoolkit 初始化逻辑注入。                                                                                                                                                                                                                                      |

## 界面区域称呼

为避免描述歧义，涉及插件界面区域时统一使用以下称呼：

1. **插件设置页面**：Zotero 本身的插件设置页面，即“编辑 → 设置”中的插件设置区域。
2. **仪表盘**：本插件设计的“仪表盘”窗口。
3. **工具栏**：Zotero 右侧的“工具栏”。
4. **弹窗**：批量文献任务后出现的“弹窗”。

## 界面设计规范

### 视觉方向

仪表盘是全插件界面设计的主要参照。当前主题可概括为“暖色纸张上的中文研究手记”：
米色画布承托象牙白纸面，深褐文字形成阅读重心，印章红承担品牌识别与主要操作，
苔绿、梅紫和赭黄用于少量功能区分。整体气质应温和、克制、具有纸本文献与编辑出版物的触感，
同时保持桌面工具所需的信息密度。

`addon/content/dashboard.css` 中 `/* Warm paper editorial direction. */`
之后的样式层代表当前方向。该文件前部保留的蓝灰样式属于历史层；其他界面改造时，
应参照最终纸感样式层与 `addon/content/dashboard.xhtml` 的结构。插件设置页面、配置编辑弹窗、
元数据弹窗、任务弹窗和阅读侧栏均应逐步采用同一视觉语言。

避免通用蓝灰色后台、玻璃拟态、大面积渐变、霓虹高饱和色、胶囊式圆角和悬浮感过强的卡片。
装饰元素需与文献研究、阅读流程或当前功能含义相关。

### 色彩系统

新增界面应复用以下 CSS 变量；局部颜色变量用于表达明确的功能类别或状态。

| 角色     | 变量或色值           | 用途                               |
| -------- | -------------------- | ---------------------------------- |
| 外层画布 | `#eee4d1`            | 窗口背景，形成纸张外围的暖米色空间 |
| 主纸面   | `#fbf8f0`            | 页签内容、主面板                   |
| 深纸面   | `#f5ecdc`            | 首屏主题区、强调区域               |
| 浅纸面   | `#fffaf2`            | 卡片、次级按钮、列表项             |
| 主文字   | `#2b241e`            | 标题、正文、主要数据               |
| 次要文字 | `#6c5d4f`            | 说明、摘要、辅助标签               |
| 分隔线   | `#d3c2a8`、`#e5d9c7` | 外框与内部细分隔                   |
| 印章红   | `#b64b37`            | 品牌强调、主要按钮、选中标记       |
| 深印章红 | `#873627`            | 悬停、强调文字、危险操作           |
| 梅紫     | `#69537e`            | 模板类别等辅助识别                 |
| 苔绿     | `#3d6b55`            | 保存成功、启用状态、确认类操作     |
| 赭黄     | `#ac762a`            | 补充分类、统计卡片                 |

运行、成功、部分完成、失败与取消等任务状态沿用清晰的蓝、绿、黄、红、灰语义色，
并通过浅色背景与细边框降低饱和度。颜色需要同时配合文字或图标，避免单靠色彩传递状态。

### 字体与层级

界面主体使用中文衬线字体栈：`Source Han Serif SC`、`Noto Serif CJK SC`、
`Noto Serif SC`、`思源宋体`、`Songti SC`、`STSong`、`SimSun`、`serif`。
按钮、输入框、选择框和文本域随主体使用相同字体。提示词正文、任务消息等长文本内容可使用
`ui-monospace, monospace`，便于辨识结构。

字号和字重参照仪表盘的现有层级：窗口标题约 `23px/800`，主题标题约 `37px/900`，
页面标题约 `20–21px/800`，卡片数据约 `26px/900`，字段标签约 `12–13px/700–800`，
说明文字约 `11–13px`。统计数字使用 `font-variant-numeric: tabular-nums`。
标题数量保持节制，通过字号、字重和留白建立层次。

### 布局与空间

窗口采用“米色画布—纸面容器—内容分区”三层结构。标题栏与页签属于窗口层，页签内容位于完整纸面；
页面内部使用细分隔线、字段分组和卡片建立信息结构。常用尺寸如下：

1.  外壳内边距约 `18px 20px 14px`，页面内容内边距约 `24–30px`。
2.  面板与卡片间距约 `10–20px`，卡片内边距约 `14–17px`。
3.  圆角集中在 `6–8px`，字段控件可使用 `6px`，避免过度圆润。
4.  边框以 `1px` 暖灰棕细线为主；阴影模拟纸张厚度，颜色浅、范围小、层数有限。
5.  多栏工作区使用清楚的比例和分隔线；长列表及编辑区在各自容器内滚动，窗口主体保持固定。

首屏主题区承担最鲜明的视觉表达，可使用左侧印章红竖线、研究流程图、品牌图形和轻微纸层阴影。
其余区域减少装饰，让统计、任务和表单成为阅读主体。

### 组件样式

1.  **主要操作**：印章红实底、浅色文字、`6px` 圆角，可用深红底边阴影表现实体按钮；悬停转为深印章红。
2.  **确认操作**：苔绿用于保存、启用和完成类动作，形态与主要操作一致。
3.  **次级操作**：浅纸面底色、暖棕边框和深褐文字；悬停使用浅红纸面及红色文字。
4.  **危险操作**：常态采用浅红纸面与深红文字，悬停可变为深红实底。操作名称应明确说明影响。
5.  **输入控件**：背景采用 `#fffdf8`，边框采用 `#d2c1a9`，配合很浅的内阴影；聚焦时使用
    `#c87968` 边框和 `#f1d4ca` 外轮廓。
6.  **卡片与列表项**：浅纸面、暖色细边框和轻阴影。选中项使用浅红背景及左侧 `4px` 印章红内嵌标记。
7.  **图标**：采用含义明确的简洁 SVG 或插件品牌图形，尺寸多为 `18–21px`；图标容器多为
    `36–40px` 方形纸面块。图标颜色随功能类别变化。
8.  **空状态**：使用虚线边框、浅米色背景、简洁图标、说明文字和可执行动作，保持完整的页面引导。

### 交互与可访问性

悬停反馈以边框、底色、阴影和 `1–3px` 位移为主，过渡时长通常为 `150–160ms`。
页面进入动效可使用约 `520ms` 的轻微上移与淡入；循环动效仅用于品牌图形等少量视觉焦点。
所有按钮、输入框、选择框和文本域需提供 `:focus-visible`，使用 `2px` 暖红轮廓与清晰偏移。

必须支持 `prefers-reduced-motion: reduce`，在该模式中移除循环动画、进入动画和非必要过渡。
窄窗口下保持内容可读：`880px` 以下统计卡片改为两列；`760px` 以下收紧页面留白，
主题区隐藏流程图，提示词三栏改为纵向排列。滚动区域需设置 `min-height: 0`，防止内容撑开窗口。

### 界面文案

标题使用正式的词语或短语，控件名称清楚描述用户动作。标签、按钮、状态提示与完成提示应沿用同一名称。
错误提示需说明发生的问题和可采取的处理方式；空状态需给出下一步操作。面向用户的文字采用功能概念，
避免展示内部模块名、代码术语或实现流程。

### 新增与改造要求

新增界面或调整遗留界面时，应检查色彩变量、字体、圆角、边框、阴影、控件状态、滚动方式和窄窗口布局。
现有功能与 Zotero 原生交互习惯需要保留。样式类继续使用 `zwl-` 前缀，公共视觉值应提取为变量，
语义状态可在组件范围内定义局部变量。完成后应通过实际窗口截图检查层级、密度、文本溢出、键盘焦点和缩放表现。

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

## 本地 Zotero 验证

- 涉及插件行为的修改，完成构建后可直接将当前构建产物安装到 C 盘的 `zotero-wanglele` profile，无需额外确认。profile 的实际目录仍以 `C:\Users\<用户名>\AppData\Roaming\Zotero\Zotero\profiles.ini` 中 `Name=zotero-wanglele` 的 `Path` 为依据。
- Zotero 的常规启动和功能测试由用户执行；完成安装后告知用户测试范围。
- 本机 Zotero 安装目录为 `D:\Software\Zotero`；执行安装或调试命令时使用 `D:\Software\Zotero\zotero.exe`。
- 用户反馈错误后，可启动使用 `zotero-wanglele` profile 的 Zotero 进行调试。
- 安装前运行 `npm run build`，使用项目构建产物完成安装；测试完成后保留或卸载插件由当前任务需要决定。
- `npm test` 使用 `.scaffold` 临时 profile，适合自动化回归；它不能替代在 `zotero-wanglele` profile 中的手动行为验证。
- 最终汇报中说明是否已安装到 `zotero-wanglele` profile，以及实际验证过的功能范围。

### 用户 profile 插件恢复记录

- `npm start` / `zotero-plugin serve` 会通过远程调试把构建目录作为临时扩展加载。停止开发服务或结束测试后，临时扩展会从该 Zotero 进程移除；此方式不能作为用户 profile 的持久安装步骤。
- 用户 profile 的真实路径以 `C:\\Users\\<用户名>\\AppData\\Roaming\\Zotero\\Zotero\\profiles.ini` 为准，读取其中 `Name=zotero-wanglele` 对应的 `Path`，不要根据项目目录或默认 profile 推断。
- 本次故障表现为 profile 的 `extensions.json` 仍有插件记录，`extensions\\zotwanglele@wanglele.com.xpi` 也可能存在，但 Zotero 的 `AddonManager` 实际扩展列表为空，工具栏和右键菜单因此不会生成。`extensions.json` 中的 `active` 字段不能单独作为运行状态依据。
- 恢复前备份 profile 中原有的插件 XPI 和 `extensions.json`。运行 `npm run build`，使用 `.scaffold\\build\\zot-wanglele.xpi`，通过 Zotero 的“工具 → 插件”界面正式安装；紧急情况下可在 Zotero chrome 环境调用 `AddonManager.getInstallForFile(...).install()`，安装完成后重启同一 profile。
- 恢复后需要同时核对三个层面：扩展目录存在当前 XPI；`extensions.json` 的插件版本和路径正确；运行时 `AddonManager.getAddonByID("zotwanglele@wanglele.com")` 返回 `isActive=true`，并且 `Zotero.ZotWanglele`、`zotwanglele-tb-dashboard`、`zotwanglele-itemmenu-translate` 均已存在。
- 排查过程中不要直接把 `extensions.json` 的 `active` 改成 `true` 代替安装流程，也不要用测试 profile 的临时扩展记录覆盖用户 profile。恢复完成后清理诊断用的临时扩展和临时文件，保留用户 profile 的文献库与偏好设置。

### XPI 安装报错排查记录

- `npm start` / `zotero-plugin serve` 加载的是临时扩展。它和正式安装包使用同一个扩展 ID `zotwanglele@wanglele.com`；开发会话存在时，`AddonManager.getAddonByID()` 可能返回临时实例，正式 XPI 更新会遇到 ID 冲突或生命周期等待。安装正式包前结束同一 profile 的开发会话，重启干净的 Zotero 实例。
- 开发模式、测试模式会反复生成 `.scaffold/build/addon`，并可能清理或重建 `.scaffold/build/zot-wanglele.xpi`。执行安装前紧邻运行一次生产 `npm run build`，确认 XPI 存在，再记录文件大小和 SHA-256；安装调用期间保留该文件。
- `zotero.exe -install-addon <path>` 返回进程成功并不能证明扩展文件已替换。安装结果需要同时核对 profile 中 XPI 的大小、修改时间和 SHA-256，以及 `extensions.json` 的版本和路径。
- `AddonManager.getInstallForFile(file, "application/x-xpinstall").install()` 报 `Install failed: onDownloadFailed` 时，优先检查源 XPI 是否已经被开发或测试流程清理、路径是否有效、同 ID 临时实例是否仍在运行。安装调用应在 Zotero chrome 环境执行，源文件存在性需要在调用前和调用后分别确认。
- 正式安装推荐使用 Zotero 的“工具 → 插件”界面。需要脚本化安装时，流程为：结束目标 profile 的 Zotero 和开发服务，备份 `extensions.json` 与原 XPI，生产构建，调用 AddonManager，重启同一 profile，再进行运行时核验。
- profile 启动后立即退出时，先确认没有其他 Zotero 进程占用该 profile。只有在确认进程全部结束、文件长度为 0 的情况下，才清理残留 `parent.lock`，随后重新启动。活动进程对应的锁文件需要保留。
- 安装完成的运行时核验至少包含：`AddonManager.getAddonByID("zotwanglele@wanglele.com")` 返回 `version` 为目标版本、`isActive=true`、`temporarilyInstalled=false`、`userDisabled=false`；同时检查 `Zotero.ZotWanglele`、`zotwanglele-tb-dashboard` 和 `zotwanglele-itemmenu-translate`。
- 日志需要分开判断：`onDownloadFailed` 指向 XPI 安装阶段；`Missing chrome or resource URL` 多为 Zotero 自身资源提示；`AsyncShutdown` 或调试阶段的未捕获异常常出现在进程强制退出后。判断安装结果以 profile 文件、`extensions.json` 和 AddonManager 运行时状态为依据。
- 生产安装与开发调试使用不同 profile。测试使用 `.scaffold` profile，开发服务使用独立开发 profile，用户 profile 只用于正式安装和最终运行验证。

## 文档维护

文档需要区分已有实现与后续计划。新增功能完成后，应同步更新根 README、对应
阶段文档和测试说明。

<claude-mem-context>
# Memory Context

# [ZotWanglele] recent context, 2026-09-10 11:36pm GMT+8

No previous sessions found.
</claude-mem-context>
