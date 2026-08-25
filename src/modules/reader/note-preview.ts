import { config } from "../../../package.json";
import { getTemplate } from "../ai/prompts";
import { getString, getLocaleID } from "../../utils/locale";
import { generateNoteForItem } from "./note-generator";
import {
  findLatestReadingNote,
  READING_NOTE_DEFINITIONS,
  resolveReadingParentItem,
  ReadingNoteDefinition,
  ReadingNoteRecord,
} from "./reading-notes";

const PREF_PREFIX = `extensions.zotero.${config.addonRef}.`;
const PREF_PREVIEW_HEIGHT = "ui.notePreviewHeight";
const PREF_PREVIEW_FONT_SIZE = "ui.notePreviewFontSize";
const DEFAULT_PREVIEW_HEIGHT = 460;
const DEFAULT_PREVIEW_FONT_SIZE = 13;

let registeredSectionKey: string | null = null;

interface PreviewContext {
  body: HTMLElement;
  itemId: number;
  parentId: number;
  refresh: () => void;
  cleanup: () => void;
}

const previewContexts = new Set<PreviewContext>();
let notePreviewObserverId: string | null = null;

export function registerNotePreviewSection(): void {
  if (registeredSectionKey) return;

  const manager = (Zotero as any).ItemPaneManager;
  if (!manager?.registerSection) {
    ztoolkit.log("[NotePreview] ItemPaneManager is unavailable");
    return;
  }

  const rootURI = `chrome://${config.addonRef}/content/`;
  const result = manager.registerSection({
    paneID: "zotwanglele-ai-notes",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("sidebar-ai-section-header" as any),
      icon: `${rootURI}icons/toolbar.png`,
    },
    sidenav: {
      l10nID: getLocaleID("sidebar-ai-section-sidenav" as any),
      icon: `${rootURI}icons/toolbar.png`,
    },
    onRender: ({ body, item }: any) => {
      renderNotePreviewSection(body, item);
    },
    onItemChange: ({ body, item }: any) => {
      renderNotePreviewSection(body, item);
    },
    onDestroy: ({ body }: any) => {
      removePreviewContext(body);
    },
  } as any);

  if (typeof result === "string") {
    registeredSectionKey = result;
    ensureNotePreviewObserver();
    ztoolkit.log("[NotePreview] item pane section registered");
  } else {
    ztoolkit.log("[NotePreview] item pane section registration failed");
  }
}

export function unregisterNotePreviewSection(): void {
  if (!registeredSectionKey) return;
  try {
    (Zotero as any).ItemPaneManager?.unregisterSection?.(registeredSectionKey);
    if (notePreviewObserverId) {
      (Zotero as any).Notifier?.unregisterObserver?.(notePreviewObserverId);
    }
  } catch (error) {
    ztoolkit.log("[NotePreview] unregister failed:", error);
  } finally {
    registeredSectionKey = null;
    notePreviewObserverId = null;
    for (const context of previewContexts) context.cleanup();
    previewContexts.clear();
  }
}

function ensureNotePreviewObserver(): void {
  if (notePreviewObserverId) return;
  const notifier = (Zotero as any).Notifier;
  if (!notifier?.registerObserver) return;

  notePreviewObserverId = notifier.registerObserver(
    {
      notify: async (
        _event: string,
        type: string,
        ids: Array<string | number>,
      ) => {
        if (type !== "item") return;
        const changedIds = ids.map((id) => Number(id));
        for (const context of [...previewContexts]) {
          if (!context.body.isConnected) {
            context.cleanup();
            previewContexts.delete(context);
            continue;
          }
          if (
            changedIds.includes(context.itemId) ||
            (context.parentId > 0 && changedIds.includes(context.parentId))
          ) {
            context.refresh();
            continue;
          }
          for (const id of changedIds) {
            const changedItem = (await Zotero.Items.getAsync(id)) as any;
            if (changedItem?.parentID === context.parentId) {
              context.refresh();
              break;
            }
          }
        }
      },
    },
    ["item"],
    `${config.addonRef}-note-preview`,
  );
}

function removePreviewContext(body: HTMLElement): void {
  for (const context of previewContexts) {
    if (context.body === body) {
      context.cleanup();
      previewContexts.delete(context);
    }
  }
}

function getPreviewPrefNumber(key: string, fallback: number): number {
  const value = Number((Zotero.Prefs as any).get(`${PREF_PREFIX}${key}`, true));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function setPreviewPrefNumber(key: string, value: number): void {
  (Zotero.Prefs as any).set(`${PREF_PREFIX}${key}`, value, true);
}

function renderNotePreviewSection(
  body: HTMLElement,
  item: Zotero.Item | null | undefined,
): void {
  const doc = body.ownerDocument;
  if (!doc) return;

  removePreviewContext(body);
  const previewHeight = Math.max(
    240,
    Math.min(
      900,
      getPreviewPrefNumber(PREF_PREVIEW_HEIGHT, DEFAULT_PREVIEW_HEIGHT),
    ),
  );
  body.replaceChildren();
  ensurePreviewStyles(doc);
  body.style.cssText = `padding:0; min-width:0; min-height:${previewHeight}px; height:${previewHeight}px; overflow:hidden;`;

  const shell = doc.createElement("div");
  shell.className = "zwl-note-preview-shell";
  shell.style.height = `${previewHeight}px`;

  const header = doc.createElement("div");
  header.className = "zwl-note-preview-header";

  const titleWrap = doc.createElement("div");
  titleWrap.className = "zwl-note-preview-title-wrap";
  const eyebrow = doc.createElement("div");
  eyebrow.className = "zwl-note-preview-eyebrow";
  eyebrow.textContent = getString("sidebar-ai-title" as any);
  const title = doc.createElement("div");
  title.className = "zwl-note-preview-item-title";
  title.textContent = getItemTitle(item);
  title.title = title.textContent;
  titleWrap.append(eyebrow, title);

  const refreshButton = doc.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "zwl-note-preview-icon-button";
  refreshButton.textContent = "↻";
  refreshButton.title = getString("sidebar-ai-refresh" as any);
  header.append(titleWrap, refreshButton);

  const tabs = doc.createElement("div");
  tabs.className = "zwl-note-preview-tabs";
  tabs.setAttribute("role", "tablist");

  const content = doc.createElement("div");
  content.className = "zwl-note-preview-content";
  let previewFontSize = Math.max(
    11,
    Math.min(
      20,
      getPreviewPrefNumber(PREF_PREVIEW_FONT_SIZE, DEFAULT_PREVIEW_FONT_SIZE),
    ),
  );
  content.style.fontSize = `${previewFontSize}px`;

  const fontControls = doc.createElement("div");
  fontControls.className = "zwl-note-preview-font-controls";
  const decreaseFontButton = createPreviewIconButton(
    doc,
    "−",
    "sidebar-ai-decrease-font",
  );
  const fontSizeLabel = doc.createElement("span");
  fontSizeLabel.className = "zwl-note-preview-font-size";
  fontSizeLabel.textContent = `${previewFontSize}px`;
  const increaseFontButton = createPreviewIconButton(
    doc,
    "+",
    "sidebar-ai-increase-font",
  );
  decreaseFontButton.addEventListener("click", () => {
    previewFontSize = Math.max(11, previewFontSize - 1);
    content.style.fontSize = `${previewFontSize}px`;
    fontSizeLabel.textContent = `${previewFontSize}px`;
    setPreviewPrefNumber(PREF_PREVIEW_FONT_SIZE, previewFontSize);
  });
  increaseFontButton.addEventListener("click", () => {
    previewFontSize = Math.min(20, previewFontSize + 1);
    content.style.fontSize = `${previewFontSize}px`;
    fontSizeLabel.textContent = `${previewFontSize}px`;
    setPreviewPrefNumber(PREF_PREVIEW_FONT_SIZE, previewFontSize);
  });
  fontControls.append(decreaseFontButton, fontSizeLabel, increaseFontButton);
  header.insertBefore(fontControls, refreshButton);
  const tabButtons = new Map<string, HTMLButtonElement>();
  let activeId = READING_NOTE_DEFINITIONS[0].id;
  let notes = new Map<string, ReadingNoteRecord | null>();
  let parentItem: Zotero.Item | null = null;
  let loading = false;

  const renderContent = () => {
    content.replaceChildren();
    const definition = READING_NOTE_DEFINITIONS.find(
      (entry) => entry.id === activeId,
    );
    if (!definition) return;

    const note = notes.get(definition.id);
    if (!note) {
      const empty = doc.createElement("div");
      empty.className = "zwl-note-preview-empty";
      empty.textContent = parentItem
        ? getString("sidebar-ai-empty" as any, {
            args: { kind: getTemplateLabel(definition) },
          })
        : getString("sidebar-ai-no-item" as any);

      if (parentItem) {
        const generateButton = doc.createElement("button");
        generateButton.type = "button";
        generateButton.className = "zwl-note-preview-command";
        generateButton.textContent = getString("sidebar-ai-generate" as any, {
          args: { kind: getTemplateLabel(definition) },
        });
        generateButton.disabled = loading;
        generateButton.addEventListener("click", () => {
          void generatePreviewNote(definition, generateButton);
        });
        content.append(empty, generateButton);
      } else {
        content.appendChild(empty);
      }
      return;
    }

    const noteContent = doc.createElement("div");
    noteContent.className = "zwl-note-preview-markdown";
    noteContent.innerHTML = sanitizePreviewHtml(note.previewHtml);

    const actions = doc.createElement("div");
    actions.className = "zwl-note-preview-actions";
    const openButton = doc.createElement("button");
    openButton.type = "button";
    openButton.className = "zwl-note-preview-command";
    openButton.textContent = getString("sidebar-ai-open" as any);
    openButton.addEventListener("click", () => {
      const pane = (Zotero as any).getActiveZoteroPane?.();
      void pane?.selectItem?.(note.note.id);
    });
    actions.appendChild(openButton);
    content.append(noteContent, actions);
  };

  const setActive = (id: string) => {
    activeId = id;
    for (const [tabId, button] of tabButtons) {
      button.classList.toggle("is-active", tabId === activeId);
      button.setAttribute("aria-selected", String(tabId === activeId));
    }
    renderContent();
  };

  for (const definition of READING_NOTE_DEFINITIONS) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "zwl-note-preview-tab";
    button.textContent = getTemplateLabel(definition);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.addEventListener("click", () => setActive(definition.id));
    tabButtons.set(definition.id, button);
    tabs.appendChild(button);
  }

  const refresh = async () => {
    if (loading) return;
    loading = true;
    refreshButton.disabled = true;
    refreshButton.textContent = "…";
    content.replaceChildren();
    const loadingText = doc.createElement("div");
    loadingText.className = "zwl-note-preview-status";
    loadingText.textContent = getString("sidebar-ai-loading" as any);
    content.appendChild(loadingText);

    try {
      parentItem = await resolveReadingParentItem(item);
      context.parentId = parentItem?.id ?? 0;
      if (parentItem) {
        const parentTitle = String(parentItem.getField("title") || "");
        if (parentTitle) {
          title.textContent = parentTitle;
          title.title = parentTitle;
        }
      }
      notes = new Map(
        await Promise.all(
          READING_NOTE_DEFINITIONS.map(
            async (definition) =>
              [
                definition.id,
                parentItem
                  ? await findLatestReadingNote(parentItem, definition.id)
                  : null,
              ] as const,
          ),
        ),
      );
      loading = false;
      if (!notes.get(activeId) && notes.get(READING_NOTE_DEFINITIONS[1].id)) {
        setActive(READING_NOTE_DEFINITIONS[1].id);
      } else {
        setActive(activeId);
      }
    } catch (error: any) {
      ztoolkit.log("[NotePreview] refresh failed:", error);
      content.replaceChildren();
      const status = doc.createElement("div");
      status.className = "zwl-note-preview-error";
      status.textContent = `${getString("sidebar-ai-failed" as any)}：${error?.message ?? String(error)}`;
      content.appendChild(status);
    } finally {
      loading = false;
      refreshButton.disabled = false;
      refreshButton.textContent = "↻";
    }
  };

  const generatePreviewNote = async (
    definition: ReadingNoteDefinition,
    button: HTMLButtonElement,
  ) => {
    if (!parentItem || loading) return;
    loading = true;
    button.disabled = true;
    button.textContent = getString("sidebar-ai-generating" as any);
    try {
      const result = await generateNoteForItem(parentItem, {
        templateId: definition.id,
        onProgress: (text) => {
          const status = content.querySelector(
            ".zwl-note-preview-status",
          ) as HTMLElement | null;
          if (status) status.textContent = text;
        },
      });
      if (!result.ok) {
        button.textContent = result.message;
        return;
      }
      loading = false;
      await refresh();
    } catch (error: any) {
      button.textContent = `${getString("sidebar-ai-failed" as any)}：${error?.message ?? String(error)}`;
    } finally {
      loading = false;
      button.disabled = false;
    }
  };

  const resizeHandle = doc.createElement("div");
  resizeHandle.className = "zwl-note-preview-resize-handle";
  resizeHandle.title = getString("sidebar-ai-resize" as any);
  const resizeGrip = doc.createElement("span");
  resizeGrip.className = "zwl-note-preview-resize-grip";
  resizeHandle.appendChild(resizeGrip);

  let isResizing = false;
  let resizeStartY = 0;
  let resizeStartHeight = previewHeight;
  const onMouseMove = (event: MouseEvent) => {
    if (!isResizing) return;
    const nextHeight = Math.max(
      240,
      Math.min(900, resizeStartHeight + event.clientY - resizeStartY),
    );
    body.style.height = `${nextHeight}px`;
    body.style.minHeight = `${nextHeight}px`;
    shell.style.height = `${nextHeight}px`;
    setPreviewPrefNumber(PREF_PREVIEW_HEIGHT, nextHeight);
  };
  const onMouseUp = () => {
    if (!isResizing) return;
    isResizing = false;
    if (doc.body) doc.body.style.cursor = "";
  };
  const onMouseDown = (event: MouseEvent) => {
    isResizing = true;
    resizeStartY = event.clientY;
    resizeStartHeight = body.getBoundingClientRect().height || previewHeight;
    if (doc.body) doc.body.style.cursor = "ns-resize";
    event.preventDefault();
  };
  resizeHandle.addEventListener("mousedown", onMouseDown);
  doc.addEventListener("mousemove", onMouseMove);
  doc.addEventListener("mouseup", onMouseUp);

  const cleanup = () => {
    resizeHandle.removeEventListener("mousedown", onMouseDown);
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", onMouseUp);
    if (doc.body) doc.body.style.cursor = "";
  };

  const context: PreviewContext = {
    body,
    itemId: (item as any)?.id ?? 0,
    parentId: 0,
    refresh: () => void refresh(),
    cleanup,
  };
  previewContexts.add(context);
  ensureNotePreviewObserver();
  refreshButton.addEventListener("click", () => void refresh());
  shell.append(header, tabs, content, resizeHandle);
  body.appendChild(shell);
  setActive(activeId);
  void refresh();
}

function getTemplateLabel(definition: ReadingNoteDefinition): string {
  return getTemplate(definition.id)?.name ?? definition.fallbackLabel;
}

function getItemTitle(item: Zotero.Item | null | undefined): string {
  const rawItem = item as any;
  if (!rawItem) return getString("sidebar-ai-no-item" as any);
  const title = rawItem.getField?.("title");
  return String(title || getString("sidebar-ai-no-item" as any));
}

function createPreviewIconButton(
  doc: Document,
  text: string,
  titleKey: string,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "zwl-note-preview-icon-button";
  button.textContent = text;
  button.title = getString(titleKey as any);
  return button;
}

function sanitizePreviewHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/javascript\s*:/gi, "");
}

function ensurePreviewStyles(doc: Document): void {
  if (doc.getElementById("zotwanglele-note-preview-styles")) return;
  const style = doc.createElement("style");
  style.id = "zotwanglele-note-preview-styles";
  style.textContent = `
    .zwl-note-preview-shell {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 180px;
      min-width: 0;
      overflow: hidden;
      color: inherit;
      font: 12px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .zwl-note-preview-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 10px;
      border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      background: color-mix(in srgb, Canvas 94%, currentColor 6%);
    }
    .zwl-note-preview-title-wrap {
      min-width: 0;
      flex: 1;
    }
    .zwl-note-preview-font-controls {
      display: flex;
      align-items: center;
      gap: 3px;
      flex: 0 0 auto;
    }
    .zwl-note-preview-font-size {
      min-width: 30px;
      color: color-mix(in srgb, currentColor 62%, transparent);
      font-size: 10px;
      text-align: center;
    }
    .zwl-note-preview-eyebrow {
      color: color-mix(in srgb, currentColor 58%, transparent);
      font-size: 10px;
    }
    .zwl-note-preview-item-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .zwl-note-preview-icon-button,
    .zwl-note-preview-command,
    .zwl-note-preview-tab {
      border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
      border-radius: 4px;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }
    .zwl-note-preview-icon-button {
      width: 24px;
      height: 24px;
      padding: 0;
      font-size: 16px;
      line-height: 20px;
    }
    .zwl-note-preview-icon-button:hover,
    .zwl-note-preview-command:hover,
    .zwl-note-preview-tab:hover {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .zwl-note-preview-tabs {
      display: flex;
      gap: 5px;
      padding: 8px 10px 0;
      overflow-x: auto;
    }
    .zwl-note-preview-tab {
      flex: 0 0 auto;
      padding: 4px 8px;
      font-size: 11px;
    }
    .zwl-note-preview-tab.is-active {
      border-color: color-mix(in srgb, #167d68 65%, transparent);
      color: #167d68;
      background: color-mix(in srgb, #167d68 10%, transparent);
    }
    .zwl-note-preview-content {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 10px;
    }
    .zwl-note-preview-markdown {
      overflow-wrap: anywhere;
      word-break: break-word;
      color: inherit;
    }
    .zwl-note-preview-markdown h1,
    .zwl-note-preview-markdown h2,
    .zwl-note-preview-markdown h3,
    .zwl-note-preview-markdown h4 {
      margin: 0.85em 0 0.4em;
      line-height: 1.3;
    }
    .zwl-note-preview-markdown h1 { font-size: 17px; }
    .zwl-note-preview-markdown h2 { font-size: 15px; }
    .zwl-note-preview-markdown h3 { font-size: 13px; }
    .zwl-note-preview-markdown p { margin: 0.55em 0; }
    .zwl-note-preview-markdown ul,
    .zwl-note-preview-markdown ol { padding-left: 20px; }
    .zwl-note-preview-markdown pre {
      max-width: 100%;
      overflow-x: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .zwl-note-preview-markdown img,
    .zwl-note-preview-markdown table { max-width: 100%; }
    .zwl-note-preview-markdown table {
      border-collapse: collapse;
      font-size: 11px;
    }
    .zwl-note-preview-markdown th,
    .zwl-note-preview-markdown td {
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      padding: 3px 5px;
      vertical-align: top;
    }
    .zwl-note-preview-empty,
    .zwl-note-preview-status,
    .zwl-note-preview-error {
      padding: 28px 12px;
      text-align: center;
      color: color-mix(in srgb, currentColor 62%, transparent);
    }
    .zwl-note-preview-error { color: #b42318; }
    .zwl-note-preview-command {
      display: block;
      margin: 10px auto 0;
      padding: 5px 9px;
      font-size: 11px;
    }
    .zwl-note-preview-command:disabled,
    .zwl-note-preview-icon-button:disabled {
      cursor: wait;
      opacity: 0.55;
    }
    .zwl-note-preview-resize-handle {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 9px;
      cursor: ns-resize;
      border-top: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      background: color-mix(in srgb, Canvas 94%, currentColor 6%);
    }
    .zwl-note-preview-resize-grip {
      width: 34px;
      height: 3px;
      border-radius: 2px;
      background: color-mix(in srgb, currentColor 35%, transparent);
    }
  `;
  const styleHost = doc.head ?? doc.documentElement;
  styleHost?.appendChild(style);
}
