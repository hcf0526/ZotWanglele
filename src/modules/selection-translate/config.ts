import { config } from "../../../package.json";

export const PROVIDERS = ["ai", "google", "deepl", "baidu"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export interface TranslationTarget {
  provider: ProviderId;
  aiProfileId: string;
}
export interface LengthRule {
  id: string;
  unit: "words" | "characters";
  min: number;
  max: number | null;
  targets: TranslationTarget[];
}
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
  historyLimit: 100,
  historyMaxMB: 50,
  comparisonEnabled: false,
  comparisonTargets: [] as TranslationTarget[],
  lengthRulesEnabled: false,
  rulesConfigured: false,
  lengthRules: [] as LengthRule[],
};
export type TranslationSettings = typeof DEFAULT_SETTINGS;
export const PREF_PREFIX = `${config.prefsPrefix}.selectionTranslate.`;

export function getSettings(): TranslationSettings {
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(result) as (keyof TranslationSettings)[]) {
    const value = Zotero.Prefs.get(PREF_PREFIX + key, true);
    if (Array.isArray(result[key])) {
      try {
        const parsed = JSON.parse(String(value ?? "[]"));
        if (Array.isArray(parsed)) (result as any)[key] = parsed;
      } catch {
        // Keep the default when a preference contains invalid JSON.
      }
    } else if (typeof value === typeof result[key])
      (result as any)[key] = value;
  }
  if (!PROVIDERS.includes(result.provider)) result.provider = "ai";
  if (!["auto", ...LANGUAGES].includes(result.sourceLang))
    result.sourceLang = "auto";
  if (!(LANGUAGES as readonly string[]).includes(result.targetLang))
    result.targetLang = "zh-CN";
  if (result.deeplPlan !== "pro") result.deeplPlan = "free";
  result.historyLimit = normalizeHistoryLimit(result.historyLimit);
  result.historyMaxMB = normalizeHistoryMaxMB(result.historyMaxMB);
  result.comparisonTargets = normalizeTargets(result.comparisonTargets);
  result.lengthRules = result.lengthRules.filter(validRule).map((rule) => ({
    ...rule,
    targets: normalizeTargets(rule.targets),
  }));
  return result;
}

export function normalizeHistoryLimit(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(1000, Math.floor(value)))
    : 100;
}

export function normalizeHistoryMaxMB(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(10240, Math.floor(value)))
    : 50;
}

/** Present legacy choices as an editable full-length plan until plans are saved. */
export function getLengthRules(settings: TranslationSettings): LengthRule[] {
  if (settings.rulesConfigured || settings.lengthRules.length)
    return settings.lengthRules;
  return [
    {
      id: "migrated-plan",
      unit: "words",
      min: 0,
      max: null,
      targets:
        settings.comparisonEnabled && settings.comparisonTargets.length
          ? settings.comparisonTargets
          : [
              {
                provider: settings.provider,
                aiProfileId: settings.aiProfileId,
              },
            ],
    },
  ];
}

export function targetId(target: TranslationTarget): string {
  return `${target.provider}:${target.provider === "ai" ? target.aiProfileId : ""}`;
}

export function normalizeTargets(values: unknown): TranslationTarget[] {
  if (!Array.isArray(values)) return [];
  const targets = new Map<string, TranslationTarget>();
  for (const value of values) {
    if (!value || !PROVIDERS.includes(value.provider)) continue;
    const target: TranslationTarget = {
      provider: value.provider,
      aiProfileId:
        value.provider === "ai" && typeof value.aiProfileId === "string"
          ? value.aiProfileId
          : "",
    };
    targets.set(targetId(target), target);
  }
  return [...targets.values()];
}

export function validRule(rule: any): rule is LengthRule {
  return (
    !!rule &&
    typeof rule.id === "string" &&
    ["words", "characters"].includes(rule.unit) &&
    Number.isInteger(rule.min) &&
    rule.min >= 0 &&
    (rule.max === null ||
      (Number.isInteger(rule.max) && rule.max > rule.min)) &&
    normalizeTargets(rule.targets).length > 0
  );
}

export function setSetting<K extends keyof TranslationSettings>(
  key: K,
  value: TranslationSettings[K],
): void {
  Zotero.Prefs.set(
    PREF_PREFIX + key,
    Array.isArray(value) ? JSON.stringify(value) : value,
    true,
  );
}
