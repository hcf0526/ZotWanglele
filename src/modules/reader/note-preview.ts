import { config } from "../../../package.json";
import { getTemplate } from "../ai/prompts";
import { getString, getLocaleID } from "../../utils/locale";
import { addTask, createTaskItems, updateTask } from "../tasks/task-store";
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
  body.classList.add("zwl-note-preview-host");
  body.style.padding = "0";
  body.style.minWidth = "0";
  body.style.minHeight = `${previewHeight}px`;
  body.style.height = `${previewHeight}px`;
  body.style.overflow = "hidden";
  body.style.background = "#ffffff";

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
  refreshButton.setAttribute(
    "aria-label",
    getString("sidebar-ai-refresh" as any),
  );
  header.append(titleWrap, refreshButton);

  const tabs = doc.createElement("div");
  tabs.className = "zwl-note-preview-tabs";
  tabs.setAttribute("role", "tablist");

  const content = doc.createElement("div");
  content.className = "zwl-note-preview-content";
  content.setAttribute("aria-live", "polite");
  content.setAttribute("role", "tabpanel");
  content.id = `zwl-note-preview-panel-${(item as any)?.id ?? "item"}-${Date.now()}`;
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
        const generateLabel = getString("sidebar-ai-generate" as any, {
          args: { kind: getTemplateLabel(definition) },
        });
        generateButton.textContent = `✦ ${generateLabel}`;
        generateButton.setAttribute("aria-label", generateLabel);
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
    const openLabel = getString("sidebar-ai-open" as any);
    openButton.textContent = `↗ ${openLabel}`;
    openButton.setAttribute("aria-label", openLabel);
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
      const isActive = tabId === activeId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
      if (isActive) {
        content.setAttribute("aria-labelledby", button.id);
      }
    }
    renderContent();
  };

  for (const definition of READING_NOTE_DEFINITIONS) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "zwl-note-preview-tab";
    button.textContent = getTemplateLabel(definition);
    button.setAttribute("role", "tab");
    button.id = `zwl-note-preview-tab-${definition.id}-${Date.now()}`;
    button.setAttribute("aria-controls", content.id);
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    button.addEventListener("click", () => setActive(definition.id));
    tabButtons.set(definition.id, button);
    tabs.appendChild(button);
  }

  const refresh = async () => {
    if (loading) return;
    loading = true;
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    content.setAttribute("aria-busy", "true");
    refreshButton.textContent = "…";
    content.replaceChildren();
    const loadingText = doc.createElement("div");
    loadingText.className = "zwl-note-preview-status";
    loadingText.setAttribute("role", "status");
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
      status.setAttribute("role", "alert");
      status.textContent = `${getString("sidebar-ai-failed" as any)}：${error?.message ?? String(error)}`;
      content.appendChild(status);
    } finally {
      loading = false;
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
      content.removeAttribute("aria-busy");
      refreshButton.textContent = "↻";
    }
  };

  const generatePreviewNote = async (
    definition: ReadingNoteDefinition,
    button: HTMLButtonElement,
  ) => {
    if (!parentItem || loading) return;
    const taskTitle = getTemplateLabel(definition);
    const itemResults = createTaskItems([parentItem]);
    const task = addTask({
      kind: "reading-note",
      title: taskTitle,
      itemIds: [parentItem.id],
      itemTitles: itemResults.map((item) => item.title),
      itemResults,
      startedAt: Date.now(),
      summary: "单篇文献",
      details: [{ label: "笔记模板", value: taskTitle }],
    });
    updateTask(task.id, {
      status: "running",
      step: "准备生成笔记",
      progress: 5,
    });

    loading = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = `✦ ${getString("sidebar-ai-generating" as any)}`;
    const generationStatus = doc.createElement("div");
    generationStatus.className = "zwl-note-preview-status";
    generationStatus.setAttribute("role", "status");
    generationStatus.textContent = getString("sidebar-ai-generating" as any);
    content.insertBefore(generationStatus, content.firstChild);
    try {
      const result = await generateNoteForItem(parentItem, {
        templateId: definition.id,
        onProgress: (text) => {
          const status = content.querySelector(
            ".zwl-note-preview-status",
          ) as HTMLElement | null;
          if (status) status.textContent = text;
          updateTask(task.id, { step: text, progress: 55, lastLog: text });
        },
      });
      if (!result.ok) {
        updateTask(task.id, {
          status: "failed",
          step: "生成失败",
          progress: 100,
          summary: result.message,
          itemResults: [
            { ...itemResults[0], status: "failed", detail: result.message },
          ],
          error: result.message,
          finishedAt: Date.now(),
        });
        generationStatus.classList.add("is-error");
        generationStatus.setAttribute("role", "alert");
        generationStatus.textContent = result.message;
        button.textContent = `✦ ${getString("sidebar-ai-generate" as any, {
          args: { kind: taskTitle },
        })}`;
        return;
      }
      updateTask(task.id, {
        status: "success",
        step: "完成",
        progress: 100,
        summary: result.message,
        itemResults: [
          {
            ...itemResults[0],
            status: "success",
            detail: result.message,
            outputId: result.noteId,
          },
        ],
        finishedAt: Date.now(),
      });
      loading = false;
      await refresh();
    } catch (error: any) {
      const message = `${getString("sidebar-ai-failed" as any)}：${error?.message ?? String(error)}`;
      updateTask(task.id, {
        status: "failed",
        step: "生成失败",
        progress: 100,
        summary: message,
        itemResults: [{ ...itemResults[0], status: "failed", detail: message }],
        error: message,
        finishedAt: Date.now(),
      });
      generationStatus.classList.add("is-error");
      generationStatus.setAttribute("role", "alert");
      generationStatus.textContent = message;
      button.textContent = `✦ ${getString("sidebar-ai-generate" as any, {
        args: { kind: taskTitle },
      })}`;
    } finally {
      loading = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  };

  const resizeHandle = doc.createElement("div");
  resizeHandle.className = "zwl-note-preview-resize-handle";
  resizeHandle.title = getString("sidebar-ai-resize" as any);
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.setAttribute("tabindex", "0");
  const resizeGrip = doc.createElement("span");
  resizeGrip.className = "zwl-note-preview-resize-grip";
  resizeGrip.setAttribute("aria-hidden", "true");
  resizeHandle.appendChild(resizeGrip);

  let isResizing = false;
  let resizeStartY = 0;
  let resizeStartHeight = previewHeight;
  let currentHeight = previewHeight;
  const applyHeight = (nextHeight: number) => {
    currentHeight = Math.max(240, Math.min(900, nextHeight));
    body.style.height = `${currentHeight}px`;
    body.style.minHeight = `${currentHeight}px`;
    shell.style.height = `${currentHeight}px`;
  };
  const onMouseMove = (event: MouseEvent) => {
    if (!isResizing) return;
    applyHeight(resizeStartHeight + event.clientY - resizeStartY);
  };
  const onMouseUp = () => {
    if (!isResizing) return;
    isResizing = false;
    setPreviewPrefNumber(PREF_PREVIEW_HEIGHT, currentHeight);
    if (doc.body) doc.body.style.cursor = "";
  };
  const onMouseDown = (event: MouseEvent) => {
    isResizing = true;
    resizeStartY = event.clientY;
    resizeStartHeight = body.getBoundingClientRect().height || previewHeight;
    if (doc.body) doc.body.style.cursor = "ns-resize";
    event.preventDefault();
  };
  const onResizeKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const delta = event.key === "ArrowUp" ? -24 : 24;
    applyHeight(currentHeight + delta);
    setPreviewPrefNumber(PREF_PREVIEW_HEIGHT, currentHeight);
    event.preventDefault();
  };
  resizeHandle.addEventListener("mousedown", onMouseDown);
  resizeHandle.addEventListener("keydown", onResizeKeyDown);
  doc.addEventListener("mousemove", onMouseMove);
  doc.addEventListener("mouseup", onMouseUp);

  const cleanup = () => {
    resizeHandle.removeEventListener("mousedown", onMouseDown);
    resizeHandle.removeEventListener("keydown", onResizeKeyDown);
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", onMouseUp);
    if (doc.body) doc.body.style.cursor = "";
    body.classList.remove("zwl-note-preview-host");
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
  button.setAttribute("aria-label", getString(titleKey as any));
  return button;
}

function sanitizePreviewHtml(html: string): string {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const allowedTags = new Set([
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "hr",
    "i",
    "img",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ]);
  const allowedAttributes = new Set([
    "alt",
    "colspan",
    "href",
    "rowspan",
    "src",
    "target",
    "title",
  ]);

  const isSafeUrl = (value: string, attribute: string): boolean => {
    const url = value.trim();
    if (
      !url ||
      url.startsWith("#") ||
      url.startsWith("/") ||
      url.startsWith("./")
    ) {
      return true;
    }
    if (
      attribute === "src" &&
      /^data:image\/(?:gif|jpeg|png|webp);/i.test(url)
    ) {
      return true;
    }
    try {
      const parsedUrl = new URL(url, "https://zotwanglele.invalid/");
      return ["http:", "https:", "mailto:"].includes(parsedUrl.protocol);
    } catch {
      return false;
    }
  };

  const clean = (root: Element): void => {
    for (const child of Array.from(root.children)) {
      const tag = child.tagName.toLowerCase();
      if (!allowedTags.has(tag)) {
        child.remove();
        continue;
      }
      for (const attribute of Array.from(child.attributes)) {
        const name = attribute.name.toLowerCase();
        if (
          name.startsWith("on") ||
          !allowedAttributes.has(name) ||
          ((name === "href" || name === "src") &&
            !isSafeUrl(attribute.value, name))
        ) {
          child.removeAttribute(attribute.name);
        }
      }
      if (tag === "img") {
        child.setAttribute("loading", "lazy");
      }
      clean(child);
    }
  };

  const body = parsed.body;
  if (!body) return "";
  clean(body);
  return String(body.innerHTML);
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
      box-sizing: border-box;
      border: 1px solid #dce4ec;
      border-radius: 7px;
      color: #25384a;
      background: #ffffff;
      font: 12px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .zwl-note-preview-host {
      background: #ffffff;
    }
    .zwl-note-preview-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 11px;
      border-top: 3px solid #2368a2;
      border-bottom: 1px solid #e1e8ef;
      background: #ffffff;
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
      color: #718096;
      font-size: 10px;
      text-align: center;
    }
    .zwl-note-preview-eyebrow {
      color: #2368a2;
      font-size: 10px;
      font-weight: 700;
    }
    .zwl-note-preview-item-title {
      overflow: hidden;
      color: #1f3447;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
    }
    .zwl-note-preview-icon-button,
    .zwl-note-preview-command,
    .zwl-note-preview-tab {
      border: 1px solid #cbd6e1;
      border-radius: 5px;
      color: #41566a;
      background: #ffffff;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
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
      border-color: #8fb4cf;
      color: #2368a2;
      background: #eef6fb;
    }
    .zwl-note-preview-icon-button:focus-visible,
    .zwl-note-preview-command:focus-visible,
    .zwl-note-preview-tab:focus-visible,
    .zwl-note-preview-resize-handle:focus-visible {
      outline: 2px solid #5b9bc4;
      outline-offset: 1px;
    }
    .zwl-note-preview-tabs {
      display: flex;
      gap: 5px;
      padding: 9px 10px 0;
      overflow-x: auto;
      background: #fbfcfe;
    }
    .zwl-note-preview-tab {
      flex: 0 0 auto;
      padding: 5px 9px;
      font-size: 11px;
      font-weight: 600;
    }
    .zwl-note-preview-tab.is-active {
      border-color: #167d68;
      color: #126b59;
      background: #eaf7f3;
    }
    .zwl-note-preview-content {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 12px;
      background: #ffffff;
    }
    .zwl-note-preview-markdown {
      overflow-wrap: anywhere;
      word-break: break-word;
      color: #25384a;
    }
    .zwl-note-preview-markdown h1,
    .zwl-note-preview-markdown h2,
    .zwl-note-preview-markdown h3,
    .zwl-note-preview-markdown h4 {
      margin: 0.9em 0 0.45em;
      color: #1f3447;
      line-height: 1.3;
    }
    .zwl-note-preview-markdown h1 { font-size: 17px; border-bottom: 1px solid #e1e8ef; padding-bottom: 5px; }
    .zwl-note-preview-markdown h2 { font-size: 15px; color: #2368a2; }
    .zwl-note-preview-markdown h3 { font-size: 13px; color: #167d68; }
    .zwl-note-preview-markdown p { margin: 0.55em 0; }
    .zwl-note-preview-markdown ul,
    .zwl-note-preview-markdown ol { padding-left: 20px; }
    .zwl-note-preview-markdown pre {
      max-width: 100%;
      overflow-x: auto;
      padding: 8px;
      border: 1px solid #e1e8ef;
      border-radius: 5px;
      background: #f7f9fc;
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
      border: 1px solid #dce4ec;
      padding: 5px 6px;
      vertical-align: top;
    }
    .zwl-note-preview-markdown th {
      color: #41566a;
      background: #f2f6f9;
    }
    .zwl-note-preview-empty,
    .zwl-note-preview-status,
    .zwl-note-preview-error {
      position: relative;
      max-width: 310px;
      margin: 20px auto;
      padding: 26px 16px 16px;
      border: 1px dashed #cbdbe8;
      border-radius: 7px;
      text-align: center;
      color: #718096;
      background: #f8fafc;
    }
    .zwl-note-preview-empty::before,
    .zwl-note-preview-status::before {
      display: block;
      margin-bottom: 7px;
      color: #2368a2;
      content: "✦";
      font-size: 18px;
      font-weight: 700;
    }
    .zwl-note-preview-error {
      border-color: #efb4af;
      color: #b42318;
      background: #fff7f6;
    }
    .zwl-note-preview-error::before {
      display: block;
      margin-bottom: 7px;
      content: "!";
      font-size: 18px;
      font-weight: 700;
    }
    .zwl-note-preview-status.is-error {
      border-color: #efb4af;
      color: #b42318;
      background: #fff7f6;
    }
    .zwl-note-preview-command {
      display: block;
      margin: 10px auto 0;
      padding: 6px 10px;
      border-color: #167d68;
      color: #126b59;
      background: #f1fbf8;
      font-size: 11px;
      font-weight: 650;
    }
    .zwl-note-preview-command:hover {
      border-color: #0f6252;
      color: #0f6252;
      background: #e3f5ef;
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
      flex: 0 0 10px;
      cursor: ns-resize;
      border-top: 1px solid #dce4ec;
      background: #f2f6f9;
    }
    .zwl-note-preview-resize-grip {
      width: 38px;
      height: 3px;
      border-radius: 2px;
      background: #8aa0b2;
    }
  `;
  const styleHost = doc.head ?? doc.documentElement;
  styleHost?.appendChild(style);
}
