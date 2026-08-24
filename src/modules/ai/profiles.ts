import { config } from "../../../package.json";
import { ApiFormat, BUILTIN_PRESETS } from "./presets";

const PREF_PREFIX = `extensions.zotero.${config.addonRef}.`;
const PREF_PROFILES = "ai.profiles";
const PREF_ACTIVE = "ai.activeProfileId";

export interface ApiProfile {
  id: string;
  name: string;
  /** Provider 类别：预设 key (deepseek/openai/...) 或 "custom" */
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  format: ApiFormat;
  temperature: number; // 0-100
  maxTokens: number;
}

/** 根据 baseUrl 推断 provider（迁移旧数据用） */
export function inferProvider(baseUrl: string): string {
  if (!baseUrl) return "custom";
  for (const [key, preset] of Object.entries(BUILTIN_PRESETS)) {
    if (baseUrl.startsWith(preset.baseUrl)) return key;
  }
  return "custom";
}

export type ApiProfileDraft = Omit<ApiProfile, "id">;

// ============================================================
// Pref helpers
// ============================================================

function getPref<T = any>(key: string, fallback: T): T {
  const v = (Zotero.Prefs as any).get(PREF_PREFIX + key, true);
  return (v ?? fallback) as T;
}

function setPref(key: string, value: any) {
  (Zotero.Prefs as any).set(PREF_PREFIX + key, value, true);
}

function generateId(): string {
  return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// CRUD
// ============================================================

export function listProfiles(): ApiProfile[] {
  const json = getPref<string>(PREF_PROFILES, "[]");
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    // 迁移：为旧 profile 补全 provider 字段
    let mutated = false;
    const migrated = arr.map((p: any) => {
      if (typeof p.provider === "string") return p as ApiProfile;
      mutated = true;
      return { ...p, provider: inferProvider(p.baseUrl ?? "") } as ApiProfile;
    });
    if (mutated) saveProfiles(migrated);
    return migrated;
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: ApiProfile[]) {
  setPref(PREF_PROFILES, JSON.stringify(profiles));
}

export function getActiveId(): string {
  return getPref<string>(PREF_ACTIVE, "");
}

export function setActiveId(id: string) {
  setPref(PREF_ACTIVE, id);
}

export function getActiveProfile(): ApiProfile | null {
  const id = getActiveId();
  if (!id) return null;
  return listProfiles().find((p) => p.id === id) ?? null;
}

export function getProfile(id: string): ApiProfile | null {
  return listProfiles().find((p) => p.id === id) ?? null;
}

/** 保证至少有一个 profile。返回当前 active profile。 */
export function ensureDefaultProfile(): ApiProfile {
  let profiles = listProfiles();

  if (profiles.length === 0) {
    // 首次：创建空的"默认"档，如果旧版本有 ai.* 值则迁移
    const legacy = readLegacyAiPrefs();
    const defaultProfile: ApiProfile = {
      id: generateId(),
      ...legacy,
    };
    profiles = [defaultProfile];
    saveProfiles(profiles);
    setActiveId(defaultProfile.id);
    return defaultProfile;
  }

  const activeId = getActiveId();
  const found = profiles.find((p) => p.id === activeId);
  if (found) return found;

  // active id 失效，落回第一个
  setActiveId(profiles[0].id);
  return profiles[0];
}

/** 迁移旧版本的 ai.* 单个字段 prefs */
function readLegacyAiPrefs(): ApiProfileDraft {
  const baseUrl = getPref<string>("ai.baseUrl", "");
  return {
    name: "默认",
    provider: inferProvider(baseUrl),
    baseUrl,
    apiKey: getPref<string>("ai.apiKey", ""),
    model: getPref<string>("ai.model", ""),
    format: getPref<ApiFormat>("ai.format", "chat-completions"),
    temperature: getPref<number>("ai.temperature", 70),
    maxTokens: getPref<number>("ai.maxTokens", 4096),
  };
}

/** 添加一个新 profile，返回创建的实例 */
export function addProfile(draft: ApiProfileDraft): ApiProfile {
  const newProfile: ApiProfile = { id: generateId(), ...draft };
  const profiles = listProfiles();
  profiles.push(newProfile);
  saveProfiles(profiles);
  // 如果之前没有 active，设为当前
  if (!getActiveId()) setActiveId(newProfile.id);
  return newProfile;
}

/** 更新指定 profile 的字段 */
export function updateProfile(
  id: string,
  draft: Partial<ApiProfileDraft>,
): boolean {
  const profiles = listProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  profiles[idx] = { ...profiles[idx], ...draft };
  saveProfiles(profiles);
  return true;
}

/** 删除指定 profile。至少保留一个。 */
export function deleteProfile(id: string): boolean {
  const profiles = listProfiles();
  if (profiles.length <= 1) return false;
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return false;

  profiles.splice(idx, 1);
  saveProfiles(profiles);

  if (getActiveId() === id) {
    setActiveId(profiles[0].id);
  }
  return true;
}

/** 上移 / 下移。direction: -1 = 上移, 1 = 下移 */
export function moveProfile(id: string, direction: -1 | 1): boolean {
  const profiles = listProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= profiles.length) return false;
  [profiles[idx], profiles[newIdx]] = [profiles[newIdx], profiles[idx]];
  saveProfiles(profiles);
  return true;
}
