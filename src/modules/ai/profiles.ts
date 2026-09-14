import { config } from "../../../package.json";
import { ApiFormat, BUILTIN_PRESETS } from "./presets";

const PREF_PREFIX = `extensions.zotero.${config.addonRef}.`;
const PREF_PROFILES = "ai.profiles";
const PREF_ACTIVE = "ai.activeProfileId";

/** Observe persisted changes across the preferences window and dashboard. */
export function subscribeProfiles(listener: () => void): () => void {
  const observers = [PREF_PROFILES, PREF_ACTIVE].map((key) =>
    Zotero.Prefs.registerObserver(PREF_PREFIX + key, listener, true),
  );
  return () =>
    observers.forEach((observer) => Zotero.Prefs.unregisterObserver(observer));
}

export interface ApiProfile {
  id: string;
  name: string;
  /** 用户填写的供应商名称；旧配置按原 provider 显示名称读取。 */
  supplier?: string;
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

export interface SupplierKey {
  apiKey: string;
  baseUrl: string;
  format: ApiFormat;
  models: string[];
}

export interface SupplierDraft {
  supplier: string;
  keys: SupplierKey[];
  temperature: number;
  maxTokens: number;
}

/** Keep every key/model route in storage; expose each supplier/model once. */
export function listModelProfiles(format?: ApiFormat): ApiProfile[] {
  const seen = new Set<string>();
  const profiles = listProfiles();
  return profiles.filter((profile) => {
    if (format && profile.format !== format) return false;
    if (
      !profile.model &&
      profiles.some(
        (p) => getSupplierName(p) === getSupplierName(profile) && p.model,
      )
    )
      return false;
    const key = JSON.stringify([getSupplierName(profile), profile.model]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getSupplierDraft(profile: ApiProfile): SupplierDraft {
  const supplier = getSupplierName(profile);
  const keys = new Map<string, SupplierKey>();
  for (const item of listProfiles().filter(
    (p) => getSupplierName(p) === supplier,
  )) {
    const id = JSON.stringify([item.baseUrl, item.apiKey, item.format]);
    if (!keys.has(id)) {
      keys.set(id, {
        baseUrl: item.baseUrl,
        apiKey: item.apiKey,
        format: item.format,
        models: [],
      });
    }
    const models = keys.get(id)!.models;
    if (item.model && !models.includes(item.model)) models.push(item.model);
  }
  return {
    supplier,
    keys: [...keys.values()],
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
  };
}

export function saveSupplier(
  draft: SupplierDraft,
  originalSupplier?: string,
): ApiProfile {
  const profiles = listProfiles();
  const supplier = draft.supplier.trim();
  if (!supplier || draft.keys.length === 0)
    throw new Error("请填写供应商并添加 API Key");
  const source = profiles.filter(
    (p) => getSupplierName(p) === originalSupplier,
  );
  const target = profiles.filter(
    (p) => getSupplierName(p) === supplier && !source.includes(p),
  );
  const route = (
    p: Pick<ApiProfile, "baseUrl" | "apiKey" | "format" | "model">,
  ) => JSON.stringify([p.baseUrl, p.apiKey, p.format, p.model]);
  const prior = new Map([...source, ...target].map((p) => [route(p), p]));
  const replacements = new Map(target.map((p) => [route(p), p]));
  for (const key of draft.keys) {
    const models = [
      ...new Set(key.models.map((model) => model.trim()).filter(Boolean)),
    ];
    for (const model of models.length ? models : [""]) {
      const value = {
        baseUrl: key.baseUrl.trim(),
        apiKey: key.apiKey.trim(),
        format: key.format,
        model,
      };
      const old = prior.get(route(value));
      replacements.set(route(value), {
        ...value,
        id: old?.id ?? generateId(),
        name: model || supplier,
        supplier,
        provider: old?.provider ?? "custom",
        temperature: draft.temperature,
        maxTokens: draft.maxTokens,
      });
    }
  }
  const inserted = [...replacements.values()];
  const removed = new Set([...source, ...target].map((p) => p.id));
  const position = profiles.findIndex((p) => removed.has(p.id));
  const remaining = profiles.filter((p) => !removed.has(p.id));
  remaining.splice(position < 0 ? remaining.length : position, 0, ...inserted);
  saveProfiles(remaining);
  for (const pref of [PREF_ACTIVE, "translate.aiProfileId"]) {
    const selected = getPref<string>(pref, "");
    if (
      !selected ||
      (removed.has(selected) && !inserted.some((p) => p.id === selected))
    ) {
      const old = profiles.find((p) => p.id === selected);
      const compatible = inserted.filter(
        (p) =>
          pref !== "translate.aiProfileId" || p.format === "chat-completions",
      );
      setPref(
        pref,
        (compatible.find((p) => p.model === old?.model) ?? compatible[0])?.id ??
          "",
      );
    }
  }
  return inserted[0];
}

export function deleteSupplier(id: string): boolean {
  const profiles = listProfiles();
  const selected = profiles.find((p) => p.id === id);
  if (!selected) return false;
  const remaining = profiles.filter(
    (p) => getSupplierName(p) !== getSupplierName(selected),
  );
  if (!remaining.length) return false;
  saveProfiles(remaining);
  if (!remaining.some((p) => p.id === getActiveId()))
    setActiveId(remaining[0].id);
  return true;
}

export function getSupplierName(profile: ApiProfileDraft): string {
  if (typeof profile.supplier === "string") return profile.supplier.trim();
  return profile.provider === "custom"
    ? ""
    : (BUILTIN_PRESETS[profile.provider]?.name ?? profile.provider ?? "");
}

/** A single display name for model selectors, results and progress messages. */
export function getModelLabel(profile: ApiProfileDraft): string {
  const chinese = Zotero.locale?.startsWith("zh");
  return `${getSupplierName(profile) || (chinese ? "未填写供应商" : "Unnamed provider")}/${profile.model || (chinese ? "尚未选择模型" : "No model selected")}`;
}

/** 按供应商首次出现的顺序分组，保留组内配置顺序。 */
export function groupProfilesBySupplier(profiles: ApiProfile[]) {
  const groups = new Map<string, ApiProfile[]>();
  for (const profile of profiles) {
    const supplier = getSupplierName(profile);
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier)!.push(profile);
  }
  return groups;
}

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
  const supplier = getSupplierName(profiles[idx]);
  const members = profiles.filter((p) => getSupplierName(p) === supplier);
  const models = [...new Set(members.map((p) => p.model))];
  const modelIndex = models.indexOf(profiles[idx].model);
  const newIndex = modelIndex + direction;
  if (newIndex < 0 || newIndex >= models.length) return false;
  [models[modelIndex], models[newIndex]] = [
    models[newIndex],
    models[modelIndex],
  ];
  const ordered = models.flatMap((model) =>
    members.filter((p) => p.model === model),
  );
  let memberIndex = 0;
  for (let i = 0; i < profiles.length; i++) {
    if (getSupplierName(profiles[i]) === supplier)
      profiles[i] = ordered[memberIndex++];
  }
  saveProfiles(profiles);
  return true;
}
