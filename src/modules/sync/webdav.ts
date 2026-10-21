import { config } from "../../../package.json";
import { resetPromptCaches } from "../ai/prompts";

const PREF_PREFIX = `${config.prefsPrefix}.`;
const DEFAULT_REMOTE_PATH = "zotwanglele-settings.json";

/** Preferences owned by ZotWanglele. Sync configuration stays local. */
export const SYNC_PREF_KEYS = [
  "ai.profiles",
  "ai.activeProfileId",
  "ai.baseUrl",
  "ai.apiKey",
  "ai.model",
  "ai.format",
  "ai.temperature",
  "ai.maxTokens",
  "ai.customPrompts",
  "ai.builtinPromptOverrides",
  "ai.activePrompts",
  "translate.envSource",
  "translate.uvPath",
  "translate.bundlePath",
  "translate.engine",
  "translate.outputs",
  "translate.dualMode",
  "translate.ocr",
  "translate.langIn",
  "translate.langOut",
  "translate.service",
  "translate.aiProfileId",
  "translate.aiBaseUrl",
  "translate.aiApiKey",
  "translate.aiModel",
  "translate.qps",
  "translate.poolSize",
  "translate.threads",
  "translate.serverUrl",
  "selectionTranslate.enabled",
  "selectionTranslate.automatic",
  "selectionTranslate.provider",
  "selectionTranslate.aiProfileId",
  "selectionTranslate.sourceLang",
  "selectionTranslate.targetLang",
  "selectionTranslate.deeplKey",
  "selectionTranslate.deeplPlan",
  "selectionTranslate.baiduAppId",
  "selectionTranslate.baiduKey",
  "selectionTranslate.historyLimit",
  "selectionTranslate.historyMaxMB",
  "selectionTranslate.comparisonEnabled",
  "selectionTranslate.comparisonTargets",
  "selectionTranslate.lengthRulesEnabled",
  "selectionTranslate.rulesConfigured",
  "selectionTranslate.lengthRules",
  "ui.notePreviewHeight",
  "ui.notePreviewFontSize",
] as const;

export type SyncPrefKey = (typeof SYNC_PREF_KEYS)[number];

const SECRET_PREF_KEYS = new Set<string>([
  "ai.apiKey",
  "translate.aiApiKey",
  "selectionTranslate.deeplKey",
  "selectionTranslate.baiduKey",
]);

export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  remotePath: string;
  includeSecrets: boolean;
}

export interface SettingsSnapshot {
  schemaVersion: 1;
  addonRef: string;
  exportedAt: string;
  includeSecrets: boolean;
  settings: Record<string, unknown>;
}

export interface SyncResult {
  exportedAt: string;
  includeSecrets: boolean;
  settingCount: number;
}

export function loadWebDavConfig(): WebDavConfig {
  return {
    url: getPref("sync.webdav.url", ""),
    username: getPref("sync.webdav.username", ""),
    password: getPref("sync.webdav.password", ""),
    remotePath:
      getPref("sync.webdav.remotePath", DEFAULT_REMOTE_PATH) ||
      DEFAULT_REMOTE_PATH,
    includeSecrets:
      getPref<boolean>("sync.webdav.includeSecrets", true) !== false,
  };
}

export function saveWebDavConfig(value: WebDavConfig): void {
  setPref("sync.webdav.url", value.url.trim());
  setPref("sync.webdav.username", value.username.trim());
  setPref("sync.webdav.password", value.password);
  setPref(
    "sync.webdav.remotePath",
    normalizeRemotePath(value.remotePath) || DEFAULT_REMOTE_PATH,
  );
  setPref("sync.webdav.includeSecrets", value.includeSecrets);
}

export function createSettingsSnapshot(
  includeSecrets = true,
  now = new Date(),
): SettingsSnapshot {
  const settings: Record<string, unknown> = {};
  for (const key of SYNC_PREF_KEYS) {
    const value = getStoredPref(key);
    if (value === undefined) continue;
    if (!includeSecrets && SECRET_PREF_KEYS.has(key)) continue;
    if (!includeSecrets && key === "ai.profiles") {
      settings[key] = redactProfileKeys(value);
      continue;
    }
    settings[key] = value;
  }
  return {
    schemaVersion: 1,
    addonRef: config.addonRef,
    exportedAt: now.toISOString(),
    includeSecrets,
    settings,
  };
}

export function applySettingsSnapshot(snapshot: unknown): SyncResult {
  const checked = validateSnapshot(snapshot);
  for (const [key, value] of Object.entries(checked.settings)) {
    if (!SYNC_PREF_KEYS.includes(key as SyncPrefKey)) continue;
    const nextValue =
      key === "ai.profiles" && !checked.includeSecrets
        ? mergeProfileKeys(value)
        : value;
    setStoredPref(key, nextValue);
  }
  resetPromptCaches();
  const mainWindow = (Zotero as any).getMainWindow?.();
  mainWindow?.dispatchEvent(new CustomEvent("zotwanglele-prompts-changed"));
  return {
    exportedAt: checked.exportedAt,
    includeSecrets: checked.includeSecrets,
    settingCount: Object.keys(checked.settings).length,
  };
}

export async function testWebDav(value: WebDavConfig): Promise<void> {
  const url = normalizeBaseUrl(value.url);
  if (!/^https?:\/\//i.test(url))
    throw new Error("WebDAV 地址需要使用 HTTP 或 HTTPS");
  const response = await request("OPTIONS", url, value);
  if (response.status < 200 || response.status >= 400) {
    throw httpError("WebDAV 服务检测失败", response.status);
  }
}

export async function uploadSettings(value: WebDavConfig): Promise<SyncResult> {
  const snapshot = createSettingsSnapshot(value.includeSecrets);
  const response = await request(
    "PUT",
    buildFileUrl(value),
    value,
    JSON.stringify(snapshot, null, 2),
  );
  if (response.status < 200 || response.status >= 300) {
    throw httpError("上传设置失败", response.status);
  }
  return {
    exportedAt: snapshot.exportedAt,
    includeSecrets: snapshot.includeSecrets,
    settingCount: Object.keys(snapshot.settings).length,
  };
}

export async function downloadSettings(
  value: WebDavConfig,
): Promise<SyncResult> {
  const response = await request("GET", buildFileUrl(value), value);
  if (response.status < 200 || response.status >= 300) {
    throw httpError("下载设置失败", response.status);
  }
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(response.responseText ?? "");
  } catch {
    throw new Error("远程设置文件格式无效");
  }
  return applySettingsSnapshot(snapshot);
}

export function buildFileUrl(value: WebDavConfig): string {
  const base = normalizeBaseUrl(value.url);
  const path = normalizeRemotePath(value.remotePath) || DEFAULT_REMOTE_PATH;
  if (!/^https?:\/\//i.test(base))
    throw new Error("WebDAV 地址需要使用 HTTP 或 HTTPS");
  return `${base}/${path}`;
}

export function normalizeRemotePath(value: string): string {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function getPref<T>(key: string, fallback: T): T {
  const value = (Zotero.Prefs as any).get(`${PREF_PREFIX}${key}`, true);
  return (value ?? fallback) as T;
}

function setPref(key: string, value: unknown): void {
  (Zotero.Prefs as any).set(`${PREF_PREFIX}${key}`, value, true);
}

function getStoredPref(key: SyncPrefKey): unknown {
  return (Zotero.Prefs as any).get(`${PREF_PREFIX}${key}`, true);
}

function setStoredPref(key: string, value: unknown): void {
  (Zotero.Prefs as any).set(`${PREF_PREFIX}${key}`, value, true);
}

function redactProfileKeys(value: unknown): string {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return "[]";
    return JSON.stringify(
      parsed.map((profile) => {
        if (!profile || typeof profile !== "object") return profile;
        const copy = { ...(profile as Record<string, unknown>) };
        delete copy.apiKey;
        return copy;
      }),
    );
  } catch {
    return "[]";
  }
}

function mergeProfileKeys(value: unknown): string {
  let remote: any[];
  let local: any[];
  try {
    remote = JSON.parse(String(value ?? "[]"));
    local = JSON.parse(String(getStoredPref("ai.profiles") ?? "[]"));
  } catch {
    return String(value ?? "[]");
  }
  if (!Array.isArray(remote) || !Array.isArray(local)) return String(value);
  return JSON.stringify(
    remote.map((profile) => {
      if (!profile || typeof profile !== "object") return profile;
      if (typeof profile.apiKey === "string") return profile;
      const localProfile = local.find(
        (item) =>
          item?.id === profile.id ||
          (item?.baseUrl === profile.baseUrl &&
            item?.model === profile.model &&
            item?.supplier === profile.supplier),
      );
      return localProfile?.apiKey
        ? { ...profile, apiKey: localProfile.apiKey }
        : profile;
    }),
  );
}

function validateSnapshot(value: unknown): SettingsSnapshot {
  if (!value || typeof value !== "object")
    throw new Error("远程设置文件格式无效");
  const candidate = value as Partial<SettingsSnapshot>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.addonRef !== config.addonRef ||
    typeof candidate.exportedAt !== "string" ||
    !candidate.settings ||
    typeof candidate.settings !== "object" ||
    Array.isArray(candidate.settings)
  ) {
    throw new Error("远程设置文件版本不兼容");
  }
  return {
    schemaVersion: 1,
    addonRef: config.addonRef,
    exportedAt: candidate.exportedAt,
    includeSecrets: candidate.includeSecrets === true,
    settings: candidate.settings as Record<string, unknown>,
  };
}

async function request(
  method: string,
  url: string,
  value: WebDavConfig,
  body?: string,
): Promise<{ status: number; responseText?: string }> {
  const headers: Record<string, string> = {
    Authorization: buildAuthorization(value.username, value.password),
  };
  if (body !== undefined)
    headers["Content-Type"] = "application/json; charset=utf-8";
  return (await Zotero.HTTP.request(method, url, {
    headers,
    body,
    responseType: "text",
    successCodes: false,
    timeout: 30000,
  })) as { status: number; responseText?: string };
}

function buildAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function httpError(prefix: string, status: number): Error {
  if (status === 401 || status === 403)
    return new Error(`${prefix}，认证信息无效`);
  if (status === 404) return new Error(`${prefix}，远程路径不存在`);
  return new Error(`${prefix}（HTTP ${status}）`);
}
