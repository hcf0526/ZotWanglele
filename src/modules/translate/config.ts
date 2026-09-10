/**
 * 翻译模块的配置读取与类型定义。
 */

import { config as pkg } from "../../../package.json";
import {
  ApiProfile,
  getActiveProfile,
  getProfile,
  getSupplierName,
  listModelProfiles,
} from "../ai/profiles";

const PREF_PREFIX = `extensions.zotero.${pkg.addonRef}.`;

export type EnvSource = "uv-auto" | "uv-manual" | "bundle" | "server";
export type Engine = "pdf2zh" | "pdf2zh_next";
export type OutputKind = "mono" | "dual";
export type DualMode = "LR" | "TB";

export interface TranslateConfig {
  envSource: EnvSource;
  uvPath: string;
  bundlePath: string;
  engine: Engine;
  outputs: OutputKind[];
  dualMode: DualMode;
  ocr: boolean;
  langIn: string;
  langOut: string;
  service: string;
  aiProfileId: string;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  qps: number;
  poolSize: number;
  threads: number;
  serverUrl: string;
}

function getPref<T = string>(key: string, fallback: T): T {
  try {
    const v = (Zotero.Prefs as any).get(`${PREF_PREFIX}${key}`, true);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function setPref(key: string, value: string | number | boolean): void {
  try {
    (Zotero.Prefs as any).set(`${PREF_PREFIX}${key}`, value, true);
  } catch (e) {
    ztoolkit.log("[TranslateConfig] setPref error:", e);
  }
}

function getChatProfiles(): ApiProfile[] {
  try {
    return listModelProfiles("chat-completions").filter(
      (profile) => profile.model && profile.apiKey,
    );
  } catch {
    return [];
  }
}

export function getChatProfilesForTranslation(): ApiProfile[] {
  return getChatProfiles();
}

export function getActiveChatProfile(): ApiProfile | null {
  const active = getActiveProfile();
  return active?.format === "chat-completions"
    ? (getChatProfiles().find(
        (p) =>
          getSupplierName(p) === getSupplierName(active) &&
          p.model === active.model,
      ) ?? null)
    : (getChatProfiles()[0] ?? null);
}
export function loadTranslateConfig(): TranslateConfig {
  const outputsStr = getPref<string>("translate.outputs", "dual");
  const outputs = outputsStr
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OutputKind => s === "mono" || s === "dual");

  const storedProfileId = getPref<string>("translate.aiProfileId", "");
  const storedProfile = getProfile(storedProfileId);
  const selectedProfile =
    getChatProfiles().find((profile) => profile.id === storedProfileId) ??
    (storedProfile &&
      getChatProfiles().find(
        (profile) =>
          getSupplierName(profile) === getSupplierName(storedProfile) &&
          profile.model === storedProfile.model,
      )) ??
    getActiveChatProfile();
  const legacyThreads = Number(getPref<number>("translate.threads", 4)) || 4;
  const qps = Number(getPref<number>("translate.qps", 4)) || 4;
  const poolSize = Math.max(
    0,
    Number(getPref<number>("translate.poolSize", 0)) || 0,
  );

  return {
    envSource: "server",
    uvPath: "",
    bundlePath: "",
    engine: getPref<Engine>("translate.engine", "pdf2zh_next"),
    outputs: outputs.length > 0 ? outputs : ["dual"],
    dualMode: getPref<DualMode>("translate.dualMode", "LR"),
    ocr: getPref<boolean>("translate.ocr", false),
    langIn: getPref<string>("translate.langIn", "auto"),
    langOut: getPref<string>("translate.langOut", "zh"),
    service: getPref<string>("translate.service", "openailiked"),
    aiProfileId: selectedProfile?.id ?? storedProfileId,
    aiBaseUrl:
      selectedProfile?.baseUrl ?? getPref<string>("translate.aiBaseUrl", ""),
    aiApiKey:
      selectedProfile?.apiKey ?? getPref<string>("translate.aiApiKey", ""),
    aiModel: selectedProfile?.model ?? getPref<string>("translate.aiModel", ""),
    qps,
    poolSize,
    threads: legacyThreads,
    serverUrl: getPref<string>("translate.serverUrl", ""),
  };
}

export function saveTranslateConfig(cfg: Partial<TranslateConfig>): void {
  if (cfg.envSource !== undefined)
    setPref("translate.envSource", cfg.envSource);
  if (cfg.uvPath !== undefined) setPref("translate.uvPath", cfg.uvPath);
  if (cfg.bundlePath !== undefined)
    setPref("translate.bundlePath", cfg.bundlePath);
  if (cfg.engine !== undefined) setPref("translate.engine", cfg.engine);
  if (cfg.outputs !== undefined)
    setPref("translate.outputs", cfg.outputs.join(","));
  if (cfg.dualMode !== undefined) setPref("translate.dualMode", cfg.dualMode);
  if (cfg.ocr !== undefined) setPref("translate.ocr", cfg.ocr);
  if (cfg.langIn !== undefined) setPref("translate.langIn", cfg.langIn);
  if (cfg.langOut !== undefined) setPref("translate.langOut", cfg.langOut);
  if (cfg.service !== undefined) setPref("translate.service", cfg.service);
  if (cfg.aiProfileId !== undefined)
    setPref("translate.aiProfileId", cfg.aiProfileId);
  if (cfg.aiBaseUrl !== undefined)
    setPref("translate.aiBaseUrl", cfg.aiBaseUrl);
  if (cfg.aiApiKey !== undefined) setPref("translate.aiApiKey", cfg.aiApiKey);
  if (cfg.aiModel !== undefined) setPref("translate.aiModel", cfg.aiModel);
  if (cfg.qps !== undefined) setPref("translate.qps", cfg.qps);
  if (cfg.poolSize !== undefined) setPref("translate.poolSize", cfg.poolSize);
  if (cfg.threads !== undefined) setPref("translate.threads", cfg.threads);
  if (cfg.serverUrl !== undefined)
    setPref("translate.serverUrl", cfg.serverUrl);
}
