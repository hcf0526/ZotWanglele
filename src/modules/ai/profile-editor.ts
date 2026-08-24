import { config } from "../../../package.json";
import { ApiProfile, ApiProfileDraft } from "./profiles";
import { getPreset, ApiFormat } from "./presets";
import { AiClient } from "./ai-client";

/**
 * 编辑器结果对象，通过 window.arguments 在父子窗口之间传递。
 */
export interface ProfileEditorResult {
  saved: boolean;
  draft: ApiProfileDraft | null;
}

/**
 * 编辑器输入参数。
 */
export interface ProfileEditorInput {
  /** 要编辑的 profile，新建时为 null */
  profile: ApiProfile | null;
}

/**
 * 打开编辑器弹窗（模态）。返回保存的 draft 或 null（取消）。
 */
export function openProfileEditor(
  parentWin: Window,
  profile: ApiProfile | null,
): ApiProfileDraft | null {
  const ref = config.addonRef;
  const url = `chrome://${ref}/content/profile-editor.xhtml`;

  const input: ProfileEditorInput = { profile };
  const result: ProfileEditorResult = { saved: false, draft: null };

  (parentWin as any).openDialog(
    url,
    "zotwanglele-profile-editor",
    "chrome,centerscreen,modal,resizable=yes",
    input,
    result,
  );

  return result.saved ? result.draft : null;
}

/**
 * 编辑器窗口加载时调用（由 hooks.ts 转发）。
 */
export function onProfileEditorLoad(win: Window) {
  const doc = win.document;
  const args = (win as any).arguments;
  const input: ProfileEditorInput = args?.[0] ?? { profile: null };
  const result: ProfileEditorResult = args?.[1] ?? {
    saved: false,
    draft: null,
  };

  const initial: ApiProfileDraft = input.profile ?? {
    name: "",
    provider: "custom",
    baseUrl: "",
    apiKey: "",
    model: "",
    format: "chat-completions",
    temperature: 70,
    maxTokens: 4096,
  };

  // 填充字段
  setVal(doc, "name", initial.name);
  setVal(doc, "preset", initial.provider || "custom");
  setVal(doc, "format", initial.format);
  setVal(doc, "baseUrl", initial.baseUrl);
  setVal(doc, "apiKey", initial.apiKey);
  setVal(doc, "model", initial.model);
  setVal(doc, "temperature", String(initial.temperature));
  setVal(doc, "maxTokens", String(initial.maxTokens));
  refreshTemperatureLabel(doc);

  // Temperature 滑块联动（input 事件在 HTML range 上可靠）
  const slider = doc.querySelector(
    "#zwl-editor-temperature",
  ) as HTMLInputElement | null;
  slider?.addEventListener("input", () => refreshTemperatureLabel(doc));

  // 把 handler 暴露到 window 上，供 XHTML 中 inline oncommand 调用。
  // 这是 XUL 最可靠的事件接线方式（dashboard 的 close 也是这样做）。
  const w = win as any;

  w.zwlEditorPresetChange = (presetKey?: string) => {
    // 优先用 menuitem 直接传过来的值，避免读 menulist.value 时尚未同步
    const value =
      presetKey ?? (doc.querySelector("#zwl-editor-preset") as any)?.value;
    ztoolkit.log("[ProfileEditor] preset change:", value);
    if (!value || value === "custom") return;
    const preset = getPreset(value);
    if (!preset) return;
    setVal(doc, "baseUrl", preset.baseUrl);
    setVal(doc, "model", preset.defaultModel);
    setVal(doc, "format", preset.defaultFormat);
  };

  w.zwlEditorTest = async () => {
    const statusEl = doc.querySelector(
      "#zwl-editor-test-status",
    ) as HTMLElement | null;
    const setStatus = (text: string, color?: string) => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.style.color = color ?? "";
    };

    const draft = readDraft(doc);
    if (!draft.baseUrl || !draft.apiKey || !draft.model) {
      setStatus("❌ 请先填写 Base URL / API Key / 模型名称", "#d83b01");
      return;
    }

    const startTime = Date.now();
    setStatus("⏳ 正在测试连接… (0.0s)", "");
    const tickTimer = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setStatus(`⏳ 正在测试连接… (${elapsed}s)`, "");
    }, 100);

    const client = new AiClient({
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      model: draft.model,
      format: draft.format as ApiFormat,
      maxRetries: 0,
    });

    try {
      const r = await client.testConnection();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setStatus(
        r.ok
          ? `✅ 成功 (${elapsed}s)：${r.message}`
          : `❌ 失败 (${elapsed}s)：${r.message}`,
        r.ok ? "#107c10" : "#d83b01",
      );
    } catch (err: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setStatus(
        `❌ 异常 (${elapsed}s)：${err?.message ?? String(err)}`,
        "#d83b01",
      );
    } finally {
      clearInterval(tickTimer);
    }
  };

  w.zwlEditorSave = () => {
    const draft = readDraft(doc);
    if (!draft.name) {
      showToast("❌ 请填写配置档名称", "fail", 3000);
      return;
    }
    if (!draft.baseUrl) {
      showToast("❌ 请填写 Base URL", "fail", 3000);
      return;
    }
    if (!draft.model) {
      showToast("❌ 请填写模型名称", "fail", 3000);
      return;
    }
    result.saved = true;
    result.draft = draft;
    win.close();
  };
  // 取消按钮直接 oncommand="window.close()"，无需暴露 handler
}

// ============================================================
// Helpers
// ============================================================

function setVal(doc: Document, idSuffix: string, value: string) {
  const el = doc.querySelector(`#zwl-editor-${idSuffix}`) as any;
  if (el) el.value = value;
}

function getVal(doc: Document, idSuffix: string): string {
  const el = doc.querySelector(`#zwl-editor-${idSuffix}`) as any;
  return el?.value ?? "";
}

function readDraft(doc: Document): ApiProfileDraft {
  return {
    name: getVal(doc, "name").trim(),
    provider: getVal(doc, "preset") || "custom",
    baseUrl: getVal(doc, "baseUrl").trim(),
    apiKey: getVal(doc, "apiKey").trim(),
    model: getVal(doc, "model").trim(),
    format: (getVal(doc, "format") || "chat-completions") as ApiFormat,
    temperature: parseInt(getVal(doc, "temperature") || "70", 10),
    maxTokens: parseInt(getVal(doc, "maxTokens") || "4096", 10),
  };
}

function refreshTemperatureLabel(doc: Document) {
  const slider = doc.querySelector(
    "#zwl-editor-temperature",
  ) as HTMLInputElement | null;
  const label = doc.querySelector("#zwl-editor-temperature-value");
  if (slider && label) {
    label.textContent = (parseInt(slider.value || "70") / 100).toFixed(2);
  }
}

function showToast(
  text: string,
  type: "default" | "success" | "fail",
  ms: number,
) {
  new ztoolkit.ProgressWindow("ZotWanglele")
    .createLine({ text, type, progress: 100 })
    .show()
    .startCloseTimer(ms);
}
