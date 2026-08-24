/**
 * Mozilla Subprocess.sys.mjs 的轻量封装。
 *
 * Zotero 9 / Firefox 128+ 推荐用 Subprocess.sys.mjs 启动子进程，
 * 比起遗留的 nsIProcess 它支持 stdout/stderr 流式读取与异步控制。
 */

export interface SpawnOptions {
  /** 可执行文件绝对路径（PATH 中的也可以传名字） */
  command: string;
  arguments?: string[];
  /** 工作目录 */
  workdir?: string;
  /** 环境变量（合并到默认 env） */
  environment?: Record<string, string>;
  /** stdout 行级回调 */
  onStdout?: (line: string) => void;
  /** stderr 行级回调 */
  onStderr?: (line: string) => void;
  /** 超时（毫秒），不传则不超时 */
  timeoutMs?: number;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** 是否被超时 kill */
  timedOut: boolean;
}

/** Subprocess.sys.mjs 的最小类型，避免 TS 报错 */
interface SubprocessAPI {
  call(opts: {
    command: string;
    arguments?: string[];
    workdir?: string;
    environment?: Record<string, string>;
    environmentAppend?: boolean;
    stderr?: "stdout" | "pipe" | "ignore";
  }): Promise<SubprocessHandle>;
  pathSearch(name: string): Promise<string | null>;
}

interface SubprocessHandle {
  stdin: { close(): Promise<void> };
  stdout: SubprocessReader;
  stderr?: SubprocessReader;
  wait(): Promise<{ exitCode: number }>;
  kill(): void;
}

interface SubprocessReader {
  readString(): Promise<string>;
}

let subprocessApi: SubprocessAPI | null = null;

function getSubprocess(): SubprocessAPI {
  if (subprocessApi) return subprocessApi;
  // Subprocess 在 Zotero 9 (Firefox 128+) 是 ESM
  const { Subprocess } = (ChromeUtils as any).importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  );
  subprocessApi = Subprocess as SubprocessAPI;
  return subprocessApi;
}

/**
 * 在 PATH 中查找可执行文件。返回绝对路径或 null。
 */
export async function pathSearch(name: string): Promise<string | null> {
  try {
    const sp = getSubprocess();
    const p = await sp.pathSearch(name);
    return p || null;
  } catch (e) {
    ztoolkit.log("[Subprocess] pathSearch error:", e);
    return null;
  }
}

/**
 * 启动子进程并等到结束。stdout/stderr 流式回调，整体也聚合返回。
 */
export async function spawn(opts: SpawnOptions): Promise<SpawnResult> {
  const sp = getSubprocess();

  ztoolkit.log(
    "[Subprocess] spawn:",
    opts.command,
    (opts.arguments ?? []).join(" "),
  );

  const proc = await sp.call({
    command: opts.command,
    arguments: opts.arguments ?? [],
    workdir: opts.workdir,
    environment: opts.environment,
    environmentAppend: true,
    stderr: "pipe",
  });

  let timedOut = false;
  let timer: any = null;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, opts.timeoutMs);
  }

  // 关掉 stdin（pdf2zh 不需要交互）
  try {
    await proc.stdin.close();
  } catch {
    // ignore
  }

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  // 并发读 stdout / stderr
  const readStream = async (
    reader: SubprocessReader | undefined,
    chunks: string[],
    onLine?: (line: string) => void,
  ) => {
    if (!reader) return;
    let buf = "";
    while (true) {
      let chunk: string;
      try {
        chunk = await reader.readString();
      } catch {
        break;
      }
      if (!chunk) break;
      chunks.push(chunk);
      if (onLine) {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) onLine(line);
        }
      }
    }
    if (onLine && buf.length > 0) onLine(buf);
  };

  const [_, __, waitResult] = await Promise.all([
    readStream(proc.stdout, stdoutChunks, opts.onStdout),
    readStream(proc.stderr, stderrChunks, opts.onStderr),
    proc.wait(),
  ]);

  if (timer) clearTimeout(timer);

  return {
    exitCode: waitResult.exitCode,
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    timedOut,
  };
}
