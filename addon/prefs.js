// ZotWanglele preferences defaults
pref("ai.preset", "deepseek");
pref("ai.format", "chat-completions");
pref("ai.baseUrl", "");
pref("ai.apiKey", "");
pref("ai.model", "");
pref("ai.temperature", 70);
pref("ai.maxTokens", 4096);
// 多 API 配置档（JSON 序列化）
pref("ai.profiles", "[]");
pref("ai.activeProfileId", "");
pref("ai.customPrompts", "[]");

// PDF selection translation
pref("selectionTranslate.enabled", true);
pref("selectionTranslate.automatic", false);
pref("selectionTranslate.provider", "ai");
pref("selectionTranslate.aiProfileId", "");
pref("selectionTranslate.sourceLang", "auto");
pref("selectionTranslate.targetLang", "zh-CN");
pref("selectionTranslate.deeplPlan", "free");
pref("selectionTranslate.deeplKey", "");
pref("selectionTranslate.baiduAppId", "");
pref("selectionTranslate.baiduKey", "");

// === 翻译模块 ===
// 环境来源："uv-auto" | "uv-manual" | "bundle"
pref("translate.envSource", "uv-auto");
// uv-manual 模式下的 uv 二进制路径
pref("translate.uvPath", "");
// bundle 模式下的 bundle 目录路径
pref("translate.bundlePath", "");
// 引擎："pdf2zh" | "pdf2zh_next"
pref("translate.engine", "pdf2zh");
// 输出格式（多选，逗号分隔）："mono" | "dual" | "mono,dual"
pref("translate.outputs", "dual");
// 目标语言
pref("translate.langOut", "zh");
// 源语言（auto = 自动）
pref("translate.langIn", "auto");
// 翻译服务（pdf2zh 的 -s 参数）
pref("translate.service", "google");
// 线程数
pref("translate.threads", 4);
// 外部服务端 URL（留空则不启用服务端模式）
pref("translate.serverUrl", "");
