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
src/modules/tasks/              统一任务记录、订阅与清理
src/modules/translate/           翻译配置、环境、子进程与执行器
src/modules/dashboard/           仪表盘窗口、任务记录页与高级设置
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

## 本地 Zotero 验证

- 涉及插件行为的修改，完成构建后可以直接安装到本机 `zotero-wanglele` profile 进行实际测试，无需每次额外确认。
- 安装前运行 `npm run build`，使用项目构建产物和现有 Zotero 配置完成菜单、窗口、条目写入等验证；测试完成后保留或卸载插件由当前任务需要决定。
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
