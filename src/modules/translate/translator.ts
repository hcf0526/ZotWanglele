/**
 * PDF 整文翻译执行器（子进程模式 + 服务端模式）。
 *
 * 编排：
 *   1. 拿到 Zotero 条目的 PDF 附件路径
 *   2. 解析执行环境（uv-auto / uv-manual / bundle）
 *   3. 拼 uv run 命令
 *   4. spawn，流式更新 task store
 *   5. 找到输出 PDF 文件（mono / dual）
 *   6. 加为 Zotero 附件
 *
 * 注意：每个引擎的输出文件命名约定不同，需要我们识别。
 *   - pdf2zh: <stem>-mono.pdf, <stem>-dual.pdf （在工作目录下）
 *   - pdf2zh_next: 类似，但具体看版本
 */

import {
  Engine,
  OutputKind,
  loadTranslateConfig,
  getActiveChatProfile,
} from "./config";
import { ResolvedEnv, resolveEnv } from "./uv-manager";
import { spawn } from "./subprocess";
import { TranslateTask, addTask, updateTask } from "./task-store";

export interface StartTranslateOptions {
  item: Zotero.Item;
}

export interface StartTranslateResult {
  ok: boolean;
  task?: TranslateTask;
  error?: string;
}

type ReadyTranslateTask = TranslateTask & {
  attachmentId: number;
  pdfPath: string;
};

/**
 * 入口：选中一个 Zotero 条目，发起翻译任务。
 * 加入任务队列、立即开始执行（异步），返回 task。
 */
export async function startTranslate(
  opts: StartTranslateOptions,
): Promise<StartTranslateResult> {
  const cfg = loadTranslateConfig();

  const title =
    (opts.item.getField("title") as string) || `条目 ${opts.item.id}`;
  const task = addTask<TranslateTask>({
    kind: "pdf-translation",
    itemId: opts.item.id,
    itemIds: [opts.item.id],
    itemTitles: [title],
    title,
    engine: cfg.engine,
    outputs: cfg.outputs,
    langOut: cfg.langOut,
    service: cfg.service,
    startedAt: Date.now(),
    summary: "等待翻译",
    details: [
      { label: "翻译引擎", value: cfg.engine },
      { label: "目标语言", value: cfg.langOut },
      { label: "翻译服务", value: cfg.service },
      { label: "输出格式", value: cfg.outputs.join(" + ") },
    ],
  });

  // 1. 找 PDF 附件
  const att = await pickPdfAttachment(opts.item);
  if (!att) {
    updateTask(task.id, {
      status: "failed",
      error: "条目下没有 PDF 附件",
      summary: "未找到 PDF 附件",
      finishedAt: Date.now(),
    });
    return { ok: false, error: "条目下没有 PDF 附件", task };
  }
  const pdfPath = (await att.getFilePathAsync?.()) || att.getFilePath?.();
  if (!pdfPath) {
    updateTask(task.id, {
      status: "failed",
      error: "PDF 附件文件路径不可访问",
      summary: "PDF 文件不可访问",
      finishedAt: Date.now(),
    });
    return { ok: false, error: "PDF 附件文件路径不可访问", task };
  }

  const readyTask: ReadyTranslateTask = {
    ...task,
    attachmentId: att.id,
    pdfPath,
  };
  updateTask(readyTask.id, {
    attachmentId: readyTask.attachmentId,
    pdfPath: readyTask.pdfPath,
    status: "running",
    step: "准备翻译环境",
    progress: 2,
    summary: "正在准备翻译",
  });

  // 2. 解析环境
  let env: ResolvedEnv | null;
  try {
    env = await resolveEnv();
  } catch (error: any) {
    const message = `翻译环境检测失败：${error?.message ?? String(error)}`;
    updateTask(readyTask.id, {
      status: "failed",
      error: message,
      summary: "翻译环境检测失败",
      finishedAt: Date.now(),
    });
    return { ok: false, error: message, task: readyTask };
  }
  if (!env) {
    updateTask(readyTask.id, {
      status: "failed",
      error:
        cfg.envSource === "server"
          ? "服务端地址不可用，请在仪表盘 → 高级设置中填写并检测服务地址"
          : "翻译环境不可用，请在仪表盘 → 高级设置中配置 uv 路径、bundle 路径或切换到服务端模式",
      summary: "翻译环境不可用",
      finishedAt: Date.now(),
    });
    return { ok: false, error: "翻译环境不可用", task: readyTask };
  }

  // 5. 异步执行（不 await，调用方立即拿到 task 句柄）
  void runTask(readyTask, env, cfg).catch((e) => {
    ztoolkit.log("[Translator] runTask uncaught:", e);
    updateTask(readyTask.id, {
      status: "failed",
      error: String(e?.message ?? e),
      summary: "翻译执行异常",
      finishedAt: Date.now(),
    });
  });

  return { ok: true, task: readyTask };
}

// ============================================================
// 执行
// ============================================================

async function runTask(
  task: ReadyTranslateTask,
  env: ResolvedEnv,
  cfg: ReturnType<typeof loadTranslateConfig>,
): Promise<void> {
  if (cfg.envSource === "server") {
    await runServerTask(task, cfg);
    return;
  }

  updateTask(task.id, { status: "running", step: "准备命令", progress: 5 });

  // 输出目录：和原 PDF 同目录下建一个 zotwanglele-translate-<taskid> 子目录
  const outDir = await prepareOutputDir(task);
  ztoolkit.log("[Translator] outDir:", outDir);

  // 构造 uv run 命令
  const { command, args } = buildCommand(env, cfg, task.pdfPath, outDir);
  ztoolkit.log("[Translator] cmd:", command, args.join(" "));

  updateTask(task.id, { step: "启动 uv 子进程…", progress: 10 });

  // bundle 模式：让 uv 把所有缓存、Python 安装、venv 都隔离到 bundle 目录里，
  // 避免污染系统盘 %LOCALAPPDATA%\uv\cache 等
  const environment = buildEnv(env);

  let lastProgress = 10;
  const r = await spawn({
    command,
    arguments: args,
    workdir: env.workdir,
    environment,
    onStdout: (line) => {
      lastProgress = Math.min(lastProgress + 1, 90);
      updateTask(task.id, { lastLog: line, progress: lastProgress });
    },
    onStderr: (line) => {
      // pdf2zh 把进度信息打到 stderr（tqdm）
      lastProgress = Math.min(lastProgress + 1, 90);
      updateTask(task.id, { lastLog: line, progress: lastProgress });
    },
    timeoutMs: 1000 * 60 * 30, // 30 分钟兜底
  });

  if (r.timedOut) {
    updateTask(task.id, {
      status: "failed",
      error: "翻译超时（>30 分钟）",
      finishedAt: Date.now(),
    });
    return;
  }

  if (r.exitCode !== 0) {
    updateTask(task.id, {
      status: "failed",
      error: `子进程退出码 ${r.exitCode}\n${(r.stderr || r.stdout).slice(-2000)}`,
      finishedAt: Date.now(),
    });
    return;
  }

  // 5. 找输出文件
  updateTask(task.id, { step: "查找输出文件…", progress: 92 });
  const outputs = await locateOutputs(outDir, task);
  if (outputs.length === 0) {
    updateTask(task.id, {
      status: "failed",
      error: `子进程已完成但未找到输出 PDF（在 ${outDir}）`,
      finishedAt: Date.now(),
    });
    return;
  }

  // 6. 加为 Zotero 附件
  updateTask(task.id, { step: "添加为 Zotero 附件…", progress: 96 });
  await addOutputsToZotero(task, outputs);

  updateTask(task.id, {
    status: "success",
    step: "完成",
    progress: 100,
    outputFiles: outputs,
    finishedAt: Date.now(),
  });
}

async function runServerTask(
  task: ReadyTranslateTask,
  cfg: ReturnType<typeof loadTranslateConfig>,
): Promise<void> {
  const baseUrl = normalizeServerUrl(cfg.serverUrl);
  if (!baseUrl) {
    updateTask(task.id, {
      status: "failed",
      error: "服务端地址为空或格式无效",
      finishedAt: Date.now(),
    });
    return;
  }

  updateTask(task.id, {
    status: "running",
    step: "读取 PDF 文件…",
    progress: 8,
  });
  const fileContent = await readFileAsBase64(task.pdfPath);

  updateTask(task.id, {
    step: "提交到 pdf2zh 服务端…",
    progress: 20,
  });

  const payload = buildServerPayload(task, cfg, fileContent);
  const submit = await postJson(`${baseUrl}/translate`, payload);
  if (!submit.ok) {
    updateTask(task.id, {
      status: "failed",
      error: submit.error,
      finishedAt: Date.now(),
    });
    return;
  }

  const fileList = extractServerFileList(submit.json);
  if (fileList.length === 0) {
    updateTask(task.id, {
      status: "failed",
      error: "服务端未返回可下载的结果文件",
      finishedAt: Date.now(),
    });
    return;
  }

  updateTask(task.id, {
    step: "下载翻译结果…",
    progress: 70,
    lastLog: fileList.join(", "),
  });

  const outDir = await prepareOutputDir(task);
  const downloaded = await downloadServerOutputs(
    baseUrl,
    outDir,
    task.outputs,
    fileList,
  );
  if (downloaded.length === 0) {
    updateTask(task.id, {
      status: "failed",
      error: "结果文件下载失败",
      finishedAt: Date.now(),
    });
    return;
  }

  updateTask(task.id, {
    step: "添加为 Zotero 附件…",
    progress: 95,
  });
  await addOutputsToZotero(task, downloaded);

  updateTask(task.id, {
    status: "success",
    step: "完成",
    progress: 100,
    outputFiles: downloaded,
    finishedAt: Date.now(),
  });
}

// ============================================================
// 命令构造
// ============================================================

function buildCommand(
  env: ResolvedEnv,
  cfg: ReturnType<typeof loadTranslateConfig>,
  inputPdf: string,
  outDir: string,
): { command: string; args: string[] } {
  const command = env.uvPath;

  // pdf2zh 走 -lo zh，pdf2zh_next 命令一致但参数细节略有不同（首版按 pdf2zh）
  const engineModule = cfg.engine === "pdf2zh_next" ? "pdf2zh_next" : "pdf2zh";

  // 判断是否要把 dual 输出关掉（pdf2zh 默认两个都生成；通过参数控制）
  // pdf2zh 文档：默认输出 mono+dual；--no-dual / --no-mono 可关。

  const runArgs = ["run", "--python", "3.12"];

  if (env.requirementsPath) {
    runArgs.push("--with-requirements", env.requirementsPath);
  } else {
    // 从 PyPI 拉对应包
    const pkg = cfg.engine === "pdf2zh_next" ? "pdf2zh-next" : "pdf2zh";
    runArgs.push("--with", pkg);
  }

  runArgs.push("--", engineModule);

  // 引擎参数
  runArgs.push(inputPdf);
  runArgs.push("-lo", cfg.langOut);
  if (cfg.langIn && cfg.langIn !== "auto") {
    runArgs.push("-li", cfg.langIn);
  }
  runArgs.push("-s", cfg.service);
  runArgs.push("-t", String(cfg.threads));
  runArgs.push("-o", outDir);

  // 注：pdf2zh 默认同时输出 mono + dual。我们不传 --no-* 参数（具体支持情况看版本），
  // 实际导入 Zotero 时再按 cfg.outputs 过滤。

  return { command, args: runArgs };
}

/**
 * 构造子进程环境变量。
 *
 * 关键设计：bundle 模式下把 uv 的所有运行时产物隔离到 bundle 目录里。
 * 用户解压一次 zip，所有包/缓存/venv 都在 bundle 内部，删除/迁移都干净。
 *
 * 涉及的 uv 环境变量：
 *   UV_CACHE_DIR        — wheel/源码缓存
 *   UV_PYTHON_INSTALL_DIR — uv 自动管理的 Python 安装位置
 *   UV_TOOL_DIR         — uv tool 工具
 *   TMPDIR / TEMP / TMP — 临时文件，避免占系统 temp
 */
function buildEnv(env: ResolvedEnv): Record<string, string> | undefined {
  if (env.source !== "bundle" || !env.workdir) {
    // 非 bundle 模式：使用 uv 默认行为，不注入额外变量
    return undefined;
  }

  const sep = Zotero.isWin ? "\\" : "/";
  const root = env.workdir.replace(/[\\/]+$/, "");
  const inBundle = (sub: string) => `${root}${sep}${sub}`;

  return {
    UV_CACHE_DIR: inBundle("cache"),
    UV_PYTHON_INSTALL_DIR: inBundle("python"),
    UV_TOOL_DIR: inBundle("tools"),
    UV_TOOL_BIN_DIR: inBundle("tools-bin"),
    // 让一些库的临时文件也落到 bundle 目录里
    TMPDIR: inBundle("tmp"),
    TEMP: inBundle("tmp"),
    TMP: inBundle("tmp"),
  };
}

// ============================================================
// 文件管理
// ============================================================

async function prepareOutputDir(task: TranslateTask): Promise<string> {
  // 输出落在系统 temp 目录，子目录用 task id 隔离
  const tempBase =
    (PathUtils as any).tempDir ??
    (Zotero as any).getTempDirectory?.()?.path ??
    PathUtils.join((PathUtils as any).profileDir, "tmp");
  const dir = PathUtils.join(tempBase, `zotwanglele-translate-${task.id}`);
  await IOUtils.makeDirectory(dir, { ignoreExisting: true } as any);
  return dir;
}

async function locateOutputs(
  outDir: string,
  task: TranslateTask,
): Promise<{ kind: OutputKind; path: string }[]> {
  const list = await IOUtils.getChildren(outDir);
  const result: { kind: OutputKind; path: string }[] = [];
  for (const p of list) {
    const lower = p.toLowerCase();
    if (!lower.endsWith(".pdf")) continue;
    if (lower.includes("dual") && task.outputs.includes("dual")) {
      result.push({ kind: "dual", path: p });
    } else if (lower.includes("mono") && task.outputs.includes("mono")) {
      result.push({ kind: "mono", path: p });
    }
  }
  return result;
}

async function addOutputsToZotero(
  task: TranslateTask,
  outputs: { kind: OutputKind; path: string }[],
): Promise<void> {
  for (const out of outputs) {
    try {
      await (Zotero.Attachments as any).importFromFile({
        file: out.path,
        parentItemID: task.itemId,
        title: `[${out.kind === "mono" ? "翻译" : "双语"}] ${task.title}`,
      });
    } catch (e) {
      ztoolkit.log("[Translator] importFromFile error:", e);
    }
  }
}

function buildServerPayload(
  task: ReadyTranslateTask,
  cfg: ReturnType<typeof loadTranslateConfig>,
  fileContent: string,
): Record<string, any> {
  return {
    fileName: basename(task.pdfPath),
    fileContent: `data:application/pdf;base64,${fileContent}`,
    engine: cfg.engine,
    service: cfg.service,
    llm_api: {
      apiKey: cfg.aiApiKey,
      apiUrl: cfg.aiBaseUrl,
      model: cfg.aiModel,
      threadNum: cfg.threads,
    },
    sourceLang: cfg.langIn && cfg.langIn !== "auto" ? cfg.langIn : "en",
    targetLang: normalizeTargetLang(cfg.langOut),
    dualMode: cfg.dualMode,
    transFirst: true,
    ocr: cfg.ocr,
    qps: cfg.qps,
    poolSize: cfg.poolSize,
    threadNum: cfg.threads,
    mono: cfg.outputs.includes("mono"),
    dual: cfg.outputs.includes("dual"),
    mono_cut: false,
    dual_cut: false,
    crop_compare: false,
    compare: false,
  };
}

function extractServerFileList(json: any): string[] {
  if (json?.status !== "success" || !Array.isArray(json?.fileList)) {
    return [];
  }
  return json.fileList.filter(
    (it: unknown): it is string => typeof it === "string",
  );
}

async function downloadServerOutputs(
  baseUrl: string,
  outDir: string,
  wanted: OutputKind[],
  fileList: string[],
): Promise<{ kind: OutputKind; path: string }[]> {
  const outputs: { kind: OutputKind; path: string }[] = [];
  for (const fileName of fileList) {
    const kind = classifyOutputKind(fileName);
    if (!kind || !wanted.includes(kind)) continue;
    const bytes = await getBinary(
      `${baseUrl}/translatedFile/${encodeURIComponent(fileName)}`,
    );
    if (!bytes) continue;
    const targetPath = PathUtils.join(outDir, sanitizeFilename(fileName));
    await IOUtils.write(targetPath, bytes);
    outputs.push({ kind, path: targetPath });
  }
  return outputs;
}

// ============================================================
// 选 PDF 附件
// ============================================================

async function pickPdfAttachment(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  if (!item.isRegularItem || !item.isRegularItem()) return null;
  const attIds = (item as any).getAttachments?.() ?? [];
  for (const id of attIds) {
    const att = (await Zotero.Items.getAsync(id)) as Zotero.Item | null;
    if (!att) continue;
    if (
      att.attachmentContentType === "application/pdf" ||
      ((att as any).attachmentReaderType as string) === "pdf"
    ) {
      return att;
    }
  }
  return null;
}

async function readFileAsBase64(path: string): Promise<string> {
  const bytes: Uint8Array = await (IOUtils as any).read(path);
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function postJson(
  url: string,
  body: Record<string, any>,
): Promise<{ ok: true; json: any } | { ok: false; error: string }> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      const message = json?.message || text || `HTTP ${resp.status}`;
      return { ok: false, error: message };
    }
    return { ok: true, json };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function getBinary(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (e) {
    ztoolkit.log("[Translator] getBinary error:", e);
    return null;
  }
}

function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function normalizeTargetLang(langOut: string): string {
  const normalized = (langOut || "zh").trim().toLowerCase();
  if (normalized === "zh") return "zh-CN";
  return normalized || "zh-CN";
}

function classifyOutputKind(fileName: string): OutputKind | null {
  const lower = fileName.toLowerCase();
  if (lower.includes("mono")) return "mono";
  if (lower.includes("dual")) return "dual";
  return null;
}

function sanitizeFilename(name: string): string {
  return Array.from(name, (char) =>
    char.charCodeAt(0) <= 0x1f || /[<>:"/\\|?*]/.test(char) ? "_" : char,
  ).join("");
}

function basename(path: string): string {
  const m = path.match(/[\\/]([^\\/]+)$/);
  return m ? m[1] : path;
}
