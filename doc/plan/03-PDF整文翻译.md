# 阶段 4：PDF 整文翻译

## 阶段状态

`pdf2zh`、`pdf2zh_next`、本地子进程与 zotero-pdf2zh 服务端模式已经形成基础
流程。任务持久化、取消操作、并发限制和服务端实时百分比仍待开发。

## 配置模型

`src/modules/translate/config.ts` 定义以下设置：

| 设置     | 可选值或默认值                             |
| -------- | ------------------------------------------ |
| 环境来源 | `uv-auto`、`uv-manual`、`bundle`、`server` |
| 引擎     | `pdf2zh`、`pdf2zh_next`                    |
| 输出     | `mono`、`dual`，默认 `dual`                |
| 语言     | 源语言默认 `auto`，目标语言默认 `zh`       |
| 翻译服务 | 默认 `google`                              |
| 线程数   | 默认 `4`                                   |
| 服务地址 | 用户填写，示例为 `http://127.0.0.1:9999`   |

## 翻译服务与 AI 配置

默认 `service` 为 `google`，表示 PDFMathTranslate 的 Google 机器翻译后端，与
Gemini API 无关。当前默认流程没有调用 OpenAI、DeepSeek、Gemini 等大模型 API。

翻译执行器仅读取 `translate.*` 设置，并把 `service` 名称发送给 pdf2zh。若改用
`openai`、`deepl` 等服务，具体可用名称和所需密钥由 pdf2zh 服务端版本与运行
环境决定；插件当前不从 AI 配置档传递 API Key。

## 子进程模式

`src/modules/translate/uv-manager.ts` 负责解析执行环境：

- `uv-auto` 搜索 PATH 与用户目录中的常见安装位置。
- `uv-manual` 使用用户指定的 `uv` 文件。
- `bundle` 从指定目录寻找 `uv`，并可使用 `requirements.txt`。
- 环境检测会执行 `uv --version`。

`uv-auto` 当前仅搜索已安装的程序，仓库中没有自动下载实现。

执行器生成的命令结构为：

```powershell
uv run --python 3.12 --with pdf2zh -- pdf2zh input.pdf -lo zh -s google -t 4 -o output
uv run --python 3.12 --with pdf2zh-next -- pdf2zh_next input.pdf -lo zh -s google -t 4 -o output
```

bundle 模式会把 uv 缓存、Python、工具和临时目录指向 bundle 内部。子进程最长
运行 30 分钟，输出日志会更新任务记录。进度值按日志行递增，属于界面估算值。

## 服务端模式

当前实现兼容 zotero-pdf2zh 4.x 的同步 JSON Base64 协议：

- `GET /health`：检查服务状态与版本。
- `POST /translate`：提交文件名、PDF Base64、引擎、服务、语言、线程和输出选项。
- `GET /translatedFile/<filename>`：下载返回列表中的单语或双语文件。

`POST /translate` 会持续等待服务完成并返回 `fileList`。执行器当前没有任务 ID
轮询流程，仪表盘显示的是阶段值 `8`、`20`、`70`、`95` 与 `100`。

服务端请求会把源语言 `auto` 转换为 `en`，并把目标语言 `zh` 转换为 `zh-CN`。
本地子进程在源语言为 `auto` 时省略 `-li` 参数。

## 输出与 Zotero 附件

翻译文件写入系统临时目录下的独立任务文件夹。执行器按文件名中的 `mono` 或
`dual` 过滤用户所选输出，并通过 `Zotero.Attachments.importFromFile()` 导入原
条目，附件标题使用 `[翻译]` 或 `[双语]` 前缀。

单个附件导入异常目前仅写入日志，任务流程仍会继续，并可能最终显示
`success`。后续需要把导入结果纳入任务状态。

## 任务模型

任务存储位于 `src/modules/translate/task-store.ts`。状态类型包含 `pending`、
`running`、`success`、`failed` 和 `cancelled`，当前代码没有触发取消状态的操作。
任务仅驻留内存；仪表盘关闭后订阅会移除，任务本身仍持续运行。

多选翻译会逐项创建任务，每个任务创建后立即异步执行，因此“任务列表”目前是
状态展示区，尚无串行调度、暂停、重试或并发上限。

## 验证样例

当前翻译样例为 `test/attentionisallyouneed04.pdf`。仓库保留服务端模式生成的
单语与双语结果，详见 [测试资源说明](../../test/README.md)。

`test/translation.test.ts` 会在 Zotero 测试 profile 中调用真实条目菜单命令，
读取任务页的中间数值与 `100%` 状态，并核对两类结果附件。
