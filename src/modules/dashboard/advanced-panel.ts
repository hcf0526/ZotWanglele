/**
 * 仪表盘 "高级设置" tab 的渲染器与事件接线。
 *
 * 负责：
 *   - 从 prefs 读出当前翻译配置并填入表单
 *   - 处理浏览/检测/保存按钮
 *   - 写回 prefs
 */

import {
  EnvSource,
  Engine,
  getActiveChatProfile,
  getChatProfilesForTranslation,
  loadTranslateConfig,
  saveTranslateConfig,
} from "../translate/config";
import { checkEnv } from "../translate/uv-manager";

/**
 * 在仪表盘窗口里挂载高级设置面板。返回卸载函数。
 */
export function mountAdvancedPanel(win: Window): () => void {
  const doc = win.document;
  const root = doc.getElementById("zotwanglele-adv-root");
  if (!root) {
    ztoolkit.log("[AdvancedPanel] root not found, abort mount");
    return () => undefined;
  }

  // 1) 把当前 prefs 灌进表单
  loadIntoForm(doc);

  // 2) 接线
  const cleanup: Array<() => void> = [];

  cleanup.push(
    bindClick(doc, "zwl-env-check", async () => {
      // 先把当前表单里的值临时存入 prefs，让 checkEnv 用最新配置
      saveFromForm(doc);

      const status = doc.getElementById("zwl-env-status");
      const detail = doc.getElementById("zwl-env-detail");
      if (status) {
        status.textContent = "检测中…";
        status.setAttribute("data-state", "checking");
      }
      if (detail) detail.textContent = "";

      const r = await checkEnv();
      if (status) {
        status.textContent = r.ok ? `✓ ${r.message}` : `× ${r.message}`;
        status.setAttribute("data-state", r.ok ? "success" : "error");
      }
      if (detail) {
        detail.textContent = r.items
          .map((it) => `${it.ok ? "✓" : "✗"} ${it.label}: ${it.detail ?? ""}`)
          .join("\n");
      }
    }),
  );

  // 保存
  cleanup.push(
    bindClick(doc, "zwl-adv-save", () => {
      saveFromForm(doc);
      const note = doc.getElementById("zwl-adv-savestatus");
      if (note) {
        note.textContent = "✓ 已保存";
        note.setAttribute("data-state", "success");
        win.setTimeout(() => {
          note.textContent = "";
        }, 2000);
      }
    }),
  );

  return () => {
    for (const fn of cleanup) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  };
}

// ============================================================
// 表单读写
// ============================================================

function loadIntoForm(doc: Document) {
  const cfg = loadTranslateConfig();
  setRadio(doc, "zwl-env-server");
  setValue(doc, "zwl-server-url", cfg.serverUrl);
  setValue(doc, "zwl-engine", cfg.engine);
  setChecked(doc, "zwl-out-mono", cfg.outputs.includes("mono"));
  setChecked(doc, "zwl-out-dual", cfg.outputs.includes("dual"));
  setValue(doc, "zwl-dual-mode", cfg.dualMode);
  setChecked(doc, "zwl-ocr", cfg.ocr);
  setValue(doc, "zwl-lang-out", cfg.langOut);
  setValue(doc, "zwl-lang-in", cfg.langIn);
  setValue(doc, "zwl-service", cfg.service);
  const select = doc.getElementById("zwl-service") as HTMLSelectElement | null;
  if (select) {
    select.replaceChildren();
    for (const profile of getChatProfilesForTranslation()) {
      const option = doc.createElement("option");
      option.value = profile.id;
      option.textContent = `${profile.name} · ${profile.model || "未设置模型"}`;
      option.selected = profile.id === cfg.aiProfileId;
      select.append(option);
    }
    if (select.options.length === 0) {
      const option = doc.createElement("option");
      option.value = "";
      option.textContent = "暂无 Chat 配置";
      select.append(option);
    }
  }
  setValue(doc, "zwl-qps", String(cfg.qps));
  setValue(doc, "zwl-pool-size", String(cfg.poolSize));
}

function saveFromForm(doc: Document) {
  const profile =
    getChatProfilesForTranslation().find(
      (item) => item.id === getValue(doc, "zwl-service"),
    ) ?? getActiveChatProfile();
  const outputs: ("mono" | "dual")[] = [];
  if (isChecked(doc, "zwl-out-mono")) outputs.push("mono");
  if (isChecked(doc, "zwl-out-dual")) outputs.push("dual");
  if (outputs.length === 0) outputs.push("dual");

  saveTranslateConfig({
    envSource: "server",
    uvPath: "",
    bundlePath: "",
    serverUrl: getValue(doc, "zwl-server-url"),
    engine: (getValue(doc, "zwl-engine") || "pdf2zh_next") as Engine,
    outputs,
    dualMode: getValue(doc, "zwl-dual-mode") === "TB" ? "TB" : "LR",
    ocr: isChecked(doc, "zwl-ocr"),
    langOut: getValue(doc, "zwl-lang-out") || "zh",
    langIn: getValue(doc, "zwl-lang-in") || "auto",
    service: "openailiked",
    aiProfileId: getValue(doc, "zwl-service"),
    aiBaseUrl: profile?.baseUrl ?? "",
    aiApiKey: profile?.apiKey ?? "",
    aiModel: profile?.model ?? "",
    qps: Math.max(1, Number(getValue(doc, "zwl-qps")) || 4),
    poolSize: Math.max(0, Number(getValue(doc, "zwl-pool-size")) || 0),
    threads: Math.max(1, Number(getValue(doc, "zwl-qps")) || 4),
  });
}

// ============================================================
// 文件选择器
// ============================================================

async function pickFile(
  win: Window,
  title: string,
  directory: boolean,
): Promise<string | null> {
  try {
    const Cc = (Components as any).classes;
    const Ci = (Components as any).interfaces;
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(
      win,
      title,
      directory ? Ci.nsIFilePicker.modeGetFolder : Ci.nsIFilePicker.modeOpen,
    );

    return await new Promise<string | null>((resolve) => {
      fp.open((rv: number) => {
        if (rv !== Ci.nsIFilePicker.returnOK || !fp.file) {
          resolve(null);
          return;
        }
        resolve(fp.file.path);
      });
    });
  } catch (e) {
    ztoolkit.log("[AdvancedPanel] pickFile error:", e);
    return null;
  }
}

// ============================================================
// DOM helpers
// ============================================================

function bindClick(
  doc: Document,
  id: string,
  handler: (e: Event) => void,
): () => void {
  const el = doc.getElementById(id);
  if (!el) return () => undefined;
  el.addEventListener("click", handler);
  return () => el.removeEventListener("click", handler);
}

function getValue(doc: Document, id: string): string {
  const el = doc.getElementById(id) as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  return el?.value ?? "";
}

function setValue(doc: Document, id: string, value: string): void {
  const el = doc.getElementById(id) as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  if (el) el.value = value;
}

function isChecked(doc: Document, id: string): boolean {
  const el = doc.getElementById(id) as HTMLInputElement | null;
  return !!el?.checked;
}

function setChecked(doc: Document, id: string, checked: boolean): void {
  const el = doc.getElementById(id) as HTMLInputElement | null;
  if (el) el.checked = checked;
}

function setRadio(doc: Document, id: string): void {
  const el = doc.getElementById(id) as HTMLInputElement | null;
  if (el) el.checked = true;
}

function getRadio(doc: Document, name: string): string | null {
  const els = Array.from(
    doc.querySelectorAll(`input[name="${name}"]`),
  ) as HTMLInputElement[];
  for (const el of els) {
    if (el.checked) return el.value;
  }
  return null;
}
