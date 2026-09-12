import { config } from "../../../package.json";

export const PROVIDERS = ["ai", "google", "deepl", "baidu"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const LANGUAGES = [
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
] as const;

export const DEFAULT_SETTINGS = {
  enabled: true,
  automatic: false,
  provider: "ai" as ProviderId,
  aiProfileId: "",
  sourceLang: "auto",
  targetLang: "zh-CN",
  deeplKey: "",
  deeplPlan: "free" as "free" | "pro",
  baiduAppId: "",
  baiduKey: "",
};
export type TranslationSettings = typeof DEFAULT_SETTINGS;
export const PREF_PREFIX = `${config.prefsPrefix}.selectionTranslate.`;

export function getSettings(): TranslationSettings {
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(result) as (keyof TranslationSettings)[]) {
    const value = Zotero.Prefs.get(PREF_PREFIX + key, true);
    if (typeof value === typeof result[key]) (result as any)[key] = value;
  }
  if (!PROVIDERS.includes(result.provider)) result.provider = "ai";
  if (!["auto", ...LANGUAGES].includes(result.sourceLang))
    result.sourceLang = "auto";
  if (!(LANGUAGES as readonly string[]).includes(result.targetLang))
    result.targetLang = "zh-CN";
  if (result.deeplPlan !== "pro") result.deeplPlan = "free";
  return result;
}

export function setSetting<K extends keyof TranslationSettings>(
  key: K,
  value: TranslationSettings[K],
): void {
  Zotero.Prefs.set(PREF_PREFIX + key, value, true);
}
