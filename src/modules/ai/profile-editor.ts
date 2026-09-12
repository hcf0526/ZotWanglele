import { config } from "../../../package.json";
import {
  ApiProfile,
  SupplierDraft,
  SupplierKey,
  getSupplierDraft,
} from "./profiles";
import { ApiFormat } from "./presets";
import { AiClient } from "./ai-client";

export interface ProfileEditorResult {
  saved: boolean;
  draft: SupplierDraft | null;
}

export function openProfileEditor(
  parentWin: Window,
  profile: ApiProfile | null,
): SupplierDraft | null {
  const result: ProfileEditorResult = { saved: false, draft: null };
  (parentWin as any).openDialog(
    `chrome://${config.addonRef}/content/profile-editor.xhtml`,
    "zotwanglele-profile-editor",
    "chrome,centerscreen,modal,resizable=yes",
    { profile },
    result,
  );
  return result.saved ? result.draft : null;
}

export function onProfileEditorLoad(win: Window) {
  const doc = win.document;
  const args = (win as any).arguments;
  const initial: SupplierDraft = args?.[0]?.profile
    ? getSupplierDraft(args[0].profile)
    : { supplier: "", keys: [], temperature: 70, maxTokens: 4096 };
  const result: ProfileEditorResult = args?.[1] ?? {
    saved: false,
    draft: null,
  };
  const input = (id: string) =>
    doc.getElementById(`zwl-editor-${id}`) as HTMLInputElement;
  input("supplier").value = initial.supplier;
  input("temperature").value = String(initial.temperature);
  input("maxTokens").value = String(initial.maxTokens);
  const refreshTemperature = () => {
    doc.getElementById("zwl-editor-temperature-value")!.textContent = (
      Number(input("temperature").value) / 100
    ).toFixed(2);
  };
  refreshTemperature();
  input("temperature").addEventListener("input", refreshTemperature);
  const root = doc.getElementById("zwl-editor-keys")!;
  const status = doc.getElementById("zwl-editor-test-status")!;
  let closed = false;
  win.addEventListener(
    "unload",
    () => {
      closed = true;
    },
    { once: true },
  );
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
    doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];
  const rows: Array<{ element: HTMLElement; read: () => SupplierKey }> = [];
  const addKey = (
    key: SupplierKey = {
      apiKey: "",
      baseUrl: "",
      format: "chat-completions",
      models: [],
    },
  ) => {
    const card = create("section");
    card.className = "zwl-key-card";
    const header = create("div");
    header.className = "zwl-key-header";
    const title = create("strong");
    title.textContent = "API Key";
    const remove = create("button");
    remove.type = "button";
    remove.className = "zwl-key-button zwl-key-button-danger";
    remove.textContent = "移除";
    header.append(title, remove);
    card.append(header);
    const field = (labelText: string, element: HTMLElement) => {
      const label = create("label");
      label.className = "zwl-key-field";
      const text = create("span");
      text.textContent = labelText;
      label.append(text, element);
      card.append(label);
    };
    const url = create("input");
    url.type = "url";
    url.value = key.baseUrl;
    url.placeholder = "https://api.example.com/v1";
    field("Base URL", url);
    const secret = create("input");
    secret.type = "password";
    secret.value = key.apiKey;
    secret.autocomplete = "off";
    field("API Key", secret);
    const format = create("select");
    for (const [value, label] of [
      ["chat-completions", "Chat Completions"],
      ["responses", "Responses"],
    ]) {
      const option = create("option");
      option.value = value;
      option.textContent = label;
      format.append(option);
    }
    format.value = key.format;
    field("API 格式", format);
    const models = create("textarea");
    models.rows = 3;
    models.value = key.models.join("\n");
    models.placeholder = "每行一个模型名称，可获取列表或手动填写";
    field("可用模型", models);
    const actions = create("div");
    actions.className = "zwl-key-header";
    const fetchButton = create("button");
    fetchButton.type = "button";
    fetchButton.className = "zwl-key-button";
    fetchButton.textContent = "获取模型";
    const feedback = create("span");
    feedback.setAttribute("aria-live", "polite");
    actions.append(fetchButton, feedback);
    card.append(actions);
    const row = {
      element: card,
      read: (): SupplierKey => ({
        baseUrl: url.value.trim(),
        apiKey: secret.value.trim(),
        format: format.value as ApiFormat,
        models: [
          ...new Set(
            models.value
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ],
      }),
    };
    remove.addEventListener("click", () => {
      rows.splice(rows.indexOf(row), 1);
      card.remove();
    });
    fetchButton.addEventListener("click", async () => {
      const value = row.read();
      if (!/^https?:\/\//i.test(value.baseUrl) || !value.apiKey) {
        feedback.textContent = "请填写有效的 Base URL 和 API Key";
        return;
      }
      const snapshot = JSON.stringify(value);
      fetchButton.disabled = true;
      feedback.textContent = "正在获取模型…";
      try {
        const fetched = await new AiClient({
          ...value,
          model: "",
          maxRetries: 0,
        }).listModels();
        if (closed || !card.isConnected) return;
        if (JSON.stringify(row.read()) !== snapshot) {
          feedback.textContent = "内容已修改，请重新获取模型";
          return;
        }
        if (fetched.length) models.value = fetched.join("\n");
        feedback.textContent = fetched.length
          ? `已获取 ${fetched.length} 个模型`
          : "返回列表为空，已保留现有模型";
      } catch {
        if (!closed && card.isConnected)
          feedback.textContent =
            "获取失败，请检查地址、Key 与网络；现有模型已保留";
      } finally {
        if (!closed && card.isConnected) fetchButton.disabled = false;
      }
    });
    rows.push(row);
    root.append(card);
  };
  for (const key of initial.keys.length ? initial.keys : [undefined])
    addKey(key);
  doc
    .getElementById("zwl-editor-add-key")!
    .addEventListener("click", () => addKey());
  (win as any).zwlEditorSave = () => {
    const supplier = input("supplier").value.trim();
    if (!supplier) {
      status.textContent = "请填写供应商";
      input("supplier").focus();
      return;
    }
    const keys = rows.map((row) => row.read());
    if (
      !keys.length ||
      keys.some((key) => !key.apiKey || !/^https?:\/\//i.test(key.baseUrl))
    ) {
      status.textContent = "请为每个 Key 填写有效的 Base URL 和 API Key";
      return;
    }
    result.saved = true;
    result.draft = {
      supplier,
      keys,
      temperature: Number(input("temperature").value),
      maxTokens: Number(input("maxTokens").value) || 4096,
    };
    win.close();
  };
}
