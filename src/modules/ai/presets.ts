export type ApiFormat = "chat-completions" | "responses";

export interface ModelPreset {
  name: string;
  baseUrl: string;
  defaultModel: string;
  defaultFormat: ApiFormat;
  multimodal: boolean;
}

export const BUILTIN_PRESETS: Record<string, ModelPreset> = {
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    defaultFormat: "chat-completions",
    multimodal: false,
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o",
    defaultFormat: "responses",
    multimodal: true,
  },
  claude: {
    name: "Claude",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    defaultFormat: "chat-completions",
    multimodal: true,
  },
  gemini: {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-2.5-pro",
    defaultFormat: "chat-completions",
    multimodal: true,
  },
  ollama: {
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    defaultModel: "",
    defaultFormat: "chat-completions",
    multimodal: false,
  },
  siliconflow: {
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn",
    defaultModel: "",
    defaultFormat: "chat-completions",
    multimodal: false,
  },
};

export function getPreset(key: string): ModelPreset | undefined {
  return BUILTIN_PRESETS[key];
}

export function getPresetKeys(): string[] {
  return Object.keys(BUILTIN_PRESETS);
}

/** 获取 provider 的显示名（自定义为"自定义"） */
export function getProviderLabel(key: string): string {
  if (key === "custom") return "自定义";
  return BUILTIN_PRESETS[key]?.name ?? key;
}

/** Provider 在分组列表中的固定显示顺序 */
export const PROVIDER_ORDER: string[] = [
  "custom",
  "openai",
  "claude",
  "deepseek",
  "gemini",
  "siliconflow",
  "ollama",
];
