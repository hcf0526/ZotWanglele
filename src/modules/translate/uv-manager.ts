/**
 * 翻译执行环境管理。支持三种来源：
 *
 *   1. uv-auto   — 系统 PATH 中的 uv
 *   2. uv-manual — 用户手动指定的 uv 二进制路径
 *   3. bundle    — 用户提供的打包目录（含 uv + requirements.txt 等）
 *
 * 目标是给上层一个统一的 `ResolvedEnv`，告诉它怎么调起 pdf2zh。
 */

import { pathSearch, spawn } from "./subprocess";
import { EnvSource, loadTranslateConfig } from "./config";

export interface UvInfo {
  path: string;
  version: string;
}

export interface ResolvedEnv {
  /** uv 二进制绝对路径 */
  uvPath: string;
  /** 工作目录（bundle 模式下指向 bundle 目录；其他为空） */
  workdir?: string;
  /** requirements.txt 路径（bundle 模式有，其他为空） */
  requirementsPath?: string;
  /** 来源类型 */
  source: EnvSource;
}

/**
 * 根据当前偏好解析执行环境。
 */
export async function resolveEnv(): Promise<ResolvedEnv | null> {
  const cfg = loadTranslateConfig();
  switch (cfg.envSource) {
    case "uv-auto":
      return resolveUvAuto();
    case "uv-manual":
      return resolveUvManual(cfg.uvPath);
    case "bundle":
      return resolveBundle(cfg.bundlePath);
    case "server":
      return resolveServer(cfg.serverUrl);
    default:
      return null;
  }
}

/**
 * 检查执行环境是否可用，可用则返回 uv 版本号。
 */
export async function probeEnv(env: ResolvedEnv): Promise<UvInfo | null> {
  try {
    const r = await spawn({
      command: env.uvPath,
      arguments: ["--version"],
      timeoutMs: 5000,
    });
    if (r.exitCode !== 0) {
      ztoolkit.log("[UvManager] uv --version failed:", r.stderr);
      return null;
    }
    return { path: env.uvPath, version: r.stdout.trim() };
  } catch (e) {
    ztoolkit.log("[UvManager] probe error:", e);
    return null;
  }
}

// ============================================================
// 三种解析策略
// ============================================================

async function resolveUvAuto(): Promise<ResolvedEnv | null> {
  // 1) PATH 搜索
  const candidate = isWindows() ? "uv.exe" : "uv";
  let found = await pathSearch(candidate);
  if (!found && isWindows()) found = await pathSearch("uv");

  // 2) 常见安装位置（PATH 没生效时兜底）
  if (!found) {
    const home = getHomeDir();
    if (home) {
      const fallbacks = isWindows()
        ? [
            `${home}\\.local\\bin\\uv.exe`,
            `${home}\\.cargo\\bin\\uv.exe`,
            `${home}\\AppData\\Local\\Programs\\uv\\uv.exe`,
          ]
        : [
            `${home}/.local/bin/uv`,
            `${home}/.cargo/bin/uv`,
            "/usr/local/bin/uv",
            "/opt/homebrew/bin/uv",
          ];
      for (const p of fallbacks) {
        if (await fileExists(p)) {
          ztoolkit.log("[UvManager] found uv at fallback location:", p);
          found = p;
          break;
        }
      }
    }
  }

  if (!found) return null;
  return { uvPath: found, source: "uv-auto" };
}

function getHomeDir(): string | null {
  try {
    // Mozilla 标准 API：通过 nsIEnvironment 拿环境变量
    const env = (Services as any).env;
    if (env?.get) {
      const userProfile = env.get("USERPROFILE");
      if (userProfile) return userProfile;
      const home = env.get("HOME");
      if (home) return home;
    }
  } catch (e) {
    ztoolkit.log("[UvManager] getHomeDir error:", e);
  }
  return null;
}

async function resolveUvManual(uvPath: string): Promise<ResolvedEnv | null> {
  if (!uvPath) return null;
  if (!(await fileExists(uvPath))) {
    ztoolkit.log("[UvManager] uvPath not found:", uvPath);
    return null;
  }
  return { uvPath, source: "uv-manual" };
}

async function resolveBundle(bundlePath: string): Promise<ResolvedEnv | null> {
  if (!bundlePath) return null;
  if (!(await fileExists(bundlePath))) {
    ztoolkit.log("[UvManager] bundle path not found:", bundlePath);
    return null;
  }

  // 在 bundle 里找 uv（windows 优先 uv.exe）
  const candidates = isWindows() ? ["uv.exe", "uv"] : ["uv", "uv.exe"];
  let uvPath: string | null = null;
  for (const name of candidates) {
    const p = joinPath(bundlePath, name);
    if (await fileExists(p)) {
      uvPath = p;
      break;
    }
  }
  if (!uvPath) {
    ztoolkit.log("[UvManager] uv not found inside bundle:", bundlePath);
    return null;
  }

  // requirements.txt 可选
  const reqPath = joinPath(bundlePath, "requirements.txt");
  const hasReq = await fileExists(reqPath);

  return {
    uvPath,
    workdir: bundlePath,
    requirementsPath: hasReq ? reqPath : undefined,
    source: "bundle",
  };
}

function resolveServer(serverUrl: string): ResolvedEnv | null {
  if (!serverUrl || !normalizeServerUrl(serverUrl)) {
    return null;
  }
  return {
    uvPath: "",
    source: "server",
  };
}

// ============================================================
// 检测报告（供"检测"按钮用）
// ============================================================

export interface EnvCheckResult {
  ok: boolean;
  /** 给用户看的 markdown/纯文本描述 */
  message: string;
  /** 详细列表，每项一条 */
  items: Array<{ ok: boolean; label: string; detail?: string }>;
  resolved?: ResolvedEnv;
  uvVersion?: string;
}

export async function checkEnv(): Promise<EnvCheckResult> {
  const cfg = loadTranslateConfig();
  const items: EnvCheckResult["items"] = [];

  if (cfg.envSource === "server") {
    const baseUrl = normalizeServerUrl(cfg.serverUrl);
    if (!baseUrl) {
      items.push({
        ok: false,
        label: "服务地址",
        detail: "请填写形如 http://127.0.0.1:9999 的服务端地址",
      });
      return { ok: false, message: "服务地址无效", items };
    }

    const health = await probeServer(baseUrl);
    if (!health.ok) {
      items.push({
        ok: false,
        label: "服务连通性",
        detail: health.detail,
      });
      return { ok: false, message: "服务不可用", items };
    }

    items.push({
      ok: true,
      label: "服务地址",
      detail: baseUrl,
    });
    items.push({
      ok: true,
      label: "健康检查",
      detail: health.detail,
    });
    return {
      ok: true,
      message: "服务端就绪",
      items,
      resolved: { uvPath: "", source: "server" },
      uvVersion: health.version,
    };
  }

  const env = await resolveEnv();
  if (!env) {
    items.push({
      ok: false,
      label: `执行环境（${cfg.envSource}）`,
      detail:
        cfg.envSource === "uv-auto"
          ? "未在 PATH 中找到 uv，请手动安装或切换到 uv-manual / bundle 模式"
          : cfg.envSource === "uv-manual"
            ? "uv 路径无效或不存在"
            : "bundle 路径无效或里面没找到 uv 二进制",
    });
    return { ok: false, message: "环境不可用", items };
  }
  items.push({
    ok: true,
    label: `uv 二进制`,
    detail: env.uvPath,
  });

  const probe = await probeEnv(env);
  if (!probe) {
    items.push({
      ok: false,
      label: "uv 可执行性",
      detail: "找到 uv 但无法运行 --version",
    });
    return { ok: false, message: "uv 不可执行", items, resolved: env };
  }
  items.push({
    ok: true,
    label: "uv 版本",
    detail: probe.version,
  });

  if (env.source === "bundle") {
    if (env.requirementsPath) {
      items.push({
        ok: true,
        label: "requirements.txt",
        detail: env.requirementsPath,
      });
    } else {
      items.push({
        ok: false,
        label: "requirements.txt",
        detail: "bundle 里没有 requirements.txt（可能是无依赖锁定的最小包）",
      });
    }
  }

  return {
    ok: true,
    message: "环境就绪",
    items,
    resolved: env,
    uvVersion: probe.version,
  };
}

// ============================================================
// helpers
// ============================================================

function isWindows(): boolean {
  return Zotero.isWin;
}

function joinPath(...parts: string[]): string {
  // 简单跨平台 join
  const sep = isWindows() ? "\\" : "/";
  return parts
    .map((p, i) =>
      i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, ""),
    )
    .join(sep);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await (IOUtils as any).stat(path);
    return !!info;
  } catch {
    return false;
  }
}

function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return trimmed;
}

async function probeServer(
  baseUrl: string,
): Promise<{ ok: boolean; detail: string; version?: string }> {
  try {
    const resp = await fetch(`${baseUrl}/health`);
    if (!resp.ok) {
      return {
        ok: false,
        detail: `/health 返回 HTTP ${resp.status}`,
      };
    }
    const json = (await resp.json()) as {
      version?: string;
      message?: string;
    };
    const version = json.version?.trim() || "";
    const message = json.message?.trim() || "服务响应正常";
    return {
      ok: true,
      detail: version ? `${message}（版本 ${version}）` : message,
      version,
    };
  } catch (e: any) {
    return {
      ok: false,
      detail: e?.message ?? String(e),
    };
  }
}
