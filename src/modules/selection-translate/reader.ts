import { config } from "../../../package.json";
import { getLocaleID } from "../../utils/locale";
import { DEFAULT_SETTINGS, getSettings, PREF_PREFIX } from "./config";
import { TranslationSession } from "./session";
import { mountTranslationView, element } from "./view";
import { removeSelectionStyles } from "./styles";
import { unmountSelectionPreferences } from "./preferences";
import { translationHistory } from "./history";
import { addSelectionToAgentContext, openAgentChatWindow } from "../agent";

type Reader = _ZoteroTypes.ReaderInstance;
interface ReaderSession {
  session: TranslationSession;
  popupCleanups: Set<() => void>;
  unload: () => void;
  window?: Window;
}
const sessions = new Map<Reader, ReaderSession>();
const sections = new Map<
  HTMLElement,
  { reader: Reader; cleanup: () => void }
>();
let sectionId: string | undefined;
let registered = false;
let observerId: string | undefined;
const prefObservers: symbol[] = [];

function sessionFor(reader: Reader): ReaderSession {
  const existing = sessions.get(reader);
  if (existing) return existing;
  const record: ReaderSession = {
    session: new TranslationSession(),
    popupCleanups: new Set(),
    unload: () => disposeReader(reader),
    window: reader._iframeWindow,
  };
  record.window?.addEventListener("unload", record.unload, { once: true });
  sessions.set(reader, record);
  return record;
}

function disposeReader(reader: Reader): void {
  const record = sessions.get(reader);
  if (!record) return;
  record.window?.removeEventListener("unload", record.unload);
  for (const cleanup of [...record.popupCleanups]) cleanup();
  for (const [body, section] of sections)
    if (section.reader === reader) disposeSection(body);
  record.session.dispose();
  sessions.delete(reader);
}

function disposeSection(body: HTMLElement): void {
  sections.get(body)?.cleanup();
  sections.delete(body);
}

/** 从划词弹层事件中尽量取出选区文本（兼容不同 Zotero 字段与未建批注的情况） */
function readPopupSelectionText(params: any, reader: any): string {
  const candidates = [
    params?.annotation?.text,
    params?.annotation?.comment,
    params?.text,
    params?.selectedText,
    params?.selection?.text,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  try {
    const win = reader?._iframeWindow;
    const selected = win?.getSelection?.()?.toString?.() ?? "";
    if (selected.trim()) return selected.trim();
  } catch {
    // ignore
  }
  return "";
}

export function onSelectionPopup(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
): void {
  const { reader, doc, params, append } = event;
  if (reader.type !== "pdf") return;
  const text = readPopupSelectionText(params, reader);
  if (!text) return;

  // 划词翻译视图仍受自身开关控制
  if (!getSettings().enabled) return;
  const record = sessionFor(reader);
  record.session.setSelection(text);
  const host = element(doc, "div");
  host.className = "zwl-selection-popup-host";
  append(host);
  const unmount = mountTranslationView(host, record.session, true);
  let attached = host.isConnected;
  const observer = new (doc.defaultView as any).MutationObserver(() => {
    if (host.isConnected) attached = true;
    else if (attached) cleanup();
  });
  const cleanup = () => {
    observer.disconnect();
    unmount();
    host.remove();
    record.popupCleanups.delete(cleanup);
  };
  observer.observe(doc.documentElement, { subtree: true, childList: true });
  record.popupCleanups.add(cleanup);
  record.session.scheduleAutomatic(
    () => host.isConnected && sessions.has(reader),
  );
}

function onSelectorContextMenu(
  event: _ZoteroTypes.Reader.EventParams<"createSelectorContextMenu">,
): void {
  const { reader, append } = event;
  if (reader.type !== "pdf") return;
  const text = readPopupSelectionText({}, reader);
  if (!text) return;
  append({
    label: "添加至对话",
    onCommand: () => {
      addSelectionToAgentContext(text);
      openAgentChatWindow(reader._window ?? Zotero.getMainWindow());
    },
  });
}

function renderSection({ body, tabType, setEnabled }: any): void {
  const details = body.closest("item-details");
  const tabId = details?.tabID || details?.dataset?.tabId;
  const reader = tabId ? Zotero.Reader.getByTabID(tabId) : undefined;
  const enabled =
    getSettings().enabled && tabType === "reader" && reader?.type === "pdf";
  setEnabled(enabled);
  if (!enabled || !reader) {
    disposeSection(body);
    return;
  }
  if (sections.get(body)?.reader === reader) return;
  disposeSection(body);
  sections.set(body, {
    reader,
    cleanup: mountTranslationView(body, sessionFor(reader).session, false),
  });
}

function preferencesChanged(): void {
  for (const record of sessions.values()) {
    record.session.resetSettings();
    if (!getSettings().enabled)
      for (const cleanup of [...record.popupCleanups]) cleanup();
  }
  // Refresh existing native sections so enable/disable also applies without changing tabs.
  for (const win of Zotero.getMainWindows()) {
    for (const details of win.document.querySelectorAll("item-details")) {
      void (details as any).render?.();
    }
  }
}

export function registerSelectionTranslation(): void {
  if (registered) return;
  registered = true;
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    onSelectionPopup,
    config.addonID,
  );
  Zotero.Reader.registerEventListener(
    "createSelectorContextMenu",
    onSelectorContextMenu,
    config.addonID,
  );
  const id = Zotero.ItemPaneManager.registerSection({
    paneID: "zotwanglele-selection-translation",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("selection-section-header" as any),
      icon: `chrome://${config.addonRef}/content/icons/sidebar-selection.svg`,
    },
    sidenav: {
      l10nID: getLocaleID("selection-section-header" as any),
      icon: `chrome://${config.addonRef}/content/icons/sidebar-selection.svg`,
    },
    onRender: renderSection,
    onItemChange: renderSection,
    onDestroy: ({ body }) => disposeSection(body),
  });
  if (id) sectionId = id;
  for (const name of Object.keys(DEFAULT_SETTINGS))
    prefObservers.push(
      Zotero.Prefs.registerObserver(
        PREF_PREFIX + name,
        name === "historyLimit" || name === "historyMaxMB"
          ? () => {
              void translationHistory.trim().catch(() => {});
            }
          : preferencesChanged,
        true,
      ),
    );
  for (const name of [
    "profiles",
    "activeProfileId",
    "activePrompts",
    "customPrompts",
    "builtinPromptOverrides",
  ]) {
    prefObservers.push(
      Zotero.Prefs.registerObserver(
        `${config.prefsPrefix}.ai.${name}`,
        preferencesChanged,
        true,
      ),
    );
  }
  observerId = Zotero.Notifier.registerObserver(
    {
      notify(event, type, ids) {
        if (type === "tab" && event === "close")
          for (const reader of sessions.keys())
            if (ids.some((id) => String(id) === reader.tabID))
              disposeReader(reader);
      },
    },
    ["tab"],
    "zotwanglele-selection",
  );
}

export function disposeSelectionWindow(win: Window): void {
  for (const reader of sessions.keys())
    if (reader._window === win) disposeReader(reader);
}

export function unregisterSelectionTranslation(): void {
  if (!registered) return;
  registered = false;
  Zotero.Reader.unregisterEventListener(
    "renderTextSelectionPopup",
    onSelectionPopup,
  );
  Zotero.Reader.unregisterEventListener(
    "createSelectorContextMenu",
    onSelectorContextMenu,
  );
  if (sectionId) Zotero.ItemPaneManager.unregisterSection(sectionId);
  sectionId = undefined;
  if (observerId) Zotero.Notifier.unregisterObserver(observerId);
  observerId = undefined;
  for (const observer of prefObservers.splice(0))
    Zotero.Prefs.unregisterObserver(observer);
  for (const reader of sessions.keys()) disposeReader(reader);
  for (const body of sections.keys()) disposeSection(body);
  unmountSelectionPreferences();
  removeSelectionStyles();
}
