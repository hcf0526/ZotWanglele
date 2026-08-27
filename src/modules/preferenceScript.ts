import { config } from "../../package.json";
import { openDashboard } from "./dashboard/dashboard";
import {
  ensureDefaultProfile,
  listProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  moveProfile,
  getActiveId,
  setActiveId,
  getProfile,
  ApiProfile,
} from "./ai/profiles";
import { openProfileEditor } from "./ai/profile-editor";
import { getProviderLabel, PROVIDER_ORDER } from "./ai/presets";

function bindButton(
  el: Element | null,
  handler: (e: Event) => void | Promise<void>,
) {
  if (!el) return;
  // 关键：prefs 面板可能多次加载，会重复调用本函数。
  // 用 dispatcher 模式：listener 只附一次，handler 引用可以反复更新。
  // 这样既不会累积监听器（双触发），也总是用最新的 handler 闭包。
  (el as any).__zwlHandler = handler;
  if ((el as any).__zwlBound) return;
  (el as any).__zwlBound = true;
  el.addEventListener("command", (e: Event) => {
    (el as any).__zwlHandler?.(e);
  });
}

export async function registerPrefsScripts(_window: Window) {
  const doc = _window.document;
  const ref = config.addonRef;

  ensureDefaultProfile();

  injectPrefsStylesheet(doc, ref);
  bindOpenDashboard(doc, ref, _window);
  bindProfileList(doc, ref, _window);

  ztoolkit.log("ZotWanglele prefs loaded");
}

/**
 * Zotero 解析偏好面板 XHTML 片段时会丢弃顶部的 xml-stylesheet 声明，
 * preferences.css 因此不会被加载；改为运行时注入 link 引入样式表。
 */
function injectPrefsStylesheet(doc: Document, ref: string) {
  const linkId = `zwl-prefs-css-${ref}`;
  if (doc.getElementById(linkId)) return;
  const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
  link.id = linkId;
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", `chrome://${ref}/content/preferences.css`);
  (doc.documentElement || doc.body)?.appendChild(link);
}

function bindOpenDashboard(doc: Document, ref: string, win: Window) {
  const btn = doc.querySelector(`#zotero-prefpane-${ref}-open-dashboard`);
  bindButton(btn, () => {
    openDashboard(win);
  });
}

/**
 * 注入 CSS 覆盖 Mozilla 默认的"非焦点选中"灰化样式。
 * 让选中行无论 listbox 是否有焦点，都用系统的激活选中色（高对比度）。
 */
function injectProfileListStyle(doc: Document, ref: string) {
  const styleId = `zwl-prefs-list-style-${ref}`;
  if (doc.getElementById(styleId)) return;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = `
    #zotero-prefpane-${ref}-profile-list richlistitem[selected="true"]:not([data-header]) {
      border-color: #d0a091 !important;
      background-color: #f9e9e2 !important;
      color: #873627 !important;
    }
    #zotero-prefpane-${ref}-profile-list richlistitem[data-header] {
      background-color: #f7efe1 !important;
      color: #806f5e !important;
    }
  `;
  (doc.documentElement || doc.body)?.appendChild(style);
}

function bindProfileList(doc: Document, ref: string, win: Window) {
  const listEl = doc.querySelector(
    `#zotero-prefpane-${ref}-profile-list`,
  ) as any;
  if (!listEl) return;

  injectProfileListStyle(doc, ref);

  const refreshList = () => {
    // 清空子项
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

    const profiles = listProfiles();
    const activeId = getActiveId();

    // 按 provider 分组
    const groups = new Map<string, ApiProfile[]>();
    for (const p of profiles) {
      const key = p.provider || "custom";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    // 按 PROVIDER_ORDER 顺序渲染，未在顺序表中的 Provider 附在末尾
    const orderedKeys: string[] = [];
    for (const key of PROVIDER_ORDER) {
      if (groups.has(key)) orderedKeys.push(key);
    }
    for (const key of groups.keys()) {
      if (!orderedKeys.includes(key)) orderedKeys.push(key);
    }

    for (const providerKey of orderedKeys) {
      // 分组头（不可选）
      const header = doc.createXULElement("richlistitem") as any;
      header.setAttribute("disabled", "true");
      header.setAttribute("data-header", "1");
      const headerLabel = doc.createXULElement("label") as any;
      headerLabel.setAttribute("value", `▼ ${getProviderLabel(providerKey)}`);
      headerLabel.setAttribute("class", "zwl-profile-group-label");
      header.appendChild(headerLabel);
      listEl.appendChild(header);

      // 该组下的配置
      for (const p of groups.get(providerKey)!) {
        const item = doc.createXULElement("richlistitem") as any;
        item.setAttribute("value", p.id);

        const vbox = doc.createXULElement("vbox") as any;
        vbox.setAttribute("flex", "1");
        vbox.setAttribute("class", "zwl-profile-item-content");

        const nameLabel = doc.createXULElement("label") as any;
        nameLabel.setAttribute("class", "zwl-profile-item-name");
        const isActive = p.id === activeId;
        nameLabel.setAttribute(
          "value",
          `${isActive ? "★ " : "  "}${p.name || "(未命名)"}`,
        );
        item.setAttribute("data-active", String(isActive));

        const detailLabel = doc.createXULElement("label") as any;
        detailLabel.setAttribute("class", "zwl-profile-item-detail");
        detailLabel.setAttribute("value", `${p.model || "未填模型"}`);

        const formatLabel = doc.createXULElement("label") as any;
        formatLabel.setAttribute("class", "zwl-profile-item-detail");
        formatLabel.setAttribute(
          "value",
          p.format === "responses" ? "Responses" : "Chat Completions",
        );

        vbox.appendChild(nameLabel);
        vbox.appendChild(detailLabel);
        vbox.appendChild(formatLabel);
        item.appendChild(vbox);
        listEl.appendChild(item);
      }
    }
    // 不自动选中 active：active 由 ★ 标记体现，
    // 选中是用户操作行为，避免 Mozilla 非焦点选中灰化文字
  };

  refreshList();

  // 选中改变仅高亮，不自动设为 active；需明确点"设为当前"按钮

  // 双击→ 编辑（跳过分组头）；偏好面板重载时替换旧监听器
  const previousDoubleClick = (listEl as any).__zwlDoubleClickHandler;
  if (previousDoubleClick) {
    listEl.removeEventListener("dblclick", previousDoubleClick);
  }
  const onDoubleClick = () => {
    const selected = listEl.selectedItem as any;
    if (!selected) return;
    if (selected.getAttribute("data-header") === "1") return;
    const id = selected.getAttribute("value");
    if (id) editProfile(win, id, refreshList);
  };
  (listEl as any).__zwlDoubleClickHandler = onDoubleClick;
  listEl.addEventListener("dblclick", onDoubleClick);

  // 按钮接线
  bindButton(doc.querySelector(`#zotero-prefpane-${ref}-profile-add`), () =>
    addNewProfile(win, refreshList, listEl),
  );
  bindButton(doc.querySelector(`#zotero-prefpane-${ref}-profile-use`), () => {
    const id = getSelectedProfileId(listEl);
    if (!id) {
      toastWarn("请先选中一个配置档");
      return;
    }
    if (id === getActiveId()) {
      toastWarn("已是当前使用的配置档");
      return;
    }
    setActiveId(id);
    refreshList();
    toastSuccess("已设为当前配置");
  });
  bindButton(doc.querySelector(`#zotero-prefpane-${ref}-profile-edit`), () => {
    const id = getSelectedProfileId(listEl);
    if (!id) {
      toastWarn("请先选中一个配置档");
      return;
    }
    editProfile(win, id, refreshList);
  });
  bindButton(
    doc.querySelector(`#zotero-prefpane-${ref}-profile-delete`),
    () => {
      const id = getSelectedProfileId(listEl);
      if (!id) {
        toastWarn("请先选中一个配置档");
        return;
      }
      const profiles = listProfiles();
      if (profiles.length <= 1) {
        toastFail("至少需要保留一个配置档");
        return;
      }
      if (
        !confirmDialog(
          win,
          "删除配置档",
          "确定要删除选中的配置档吗？此操作无法撤销。",
        )
      ) {
        return;
      }
      deleteProfile(id);
      refreshList();
    },
  );
  bindButton(doc.querySelector(`#zotero-prefpane-${ref}-profile-up`), () =>
    moveSelectedProfile(listEl, -1, refreshList),
  );
  bindButton(doc.querySelector(`#zotero-prefpane-${ref}-profile-down`), () =>
    moveSelectedProfile(listEl, 1, refreshList),
  );
}

function addNewProfile(win: Window, refresh: () => void, listEl: any) {
  const draft = openProfileEditor(win, null);
  if (!draft) return;
  const newProfile = addProfile(draft);
  // 不自动设为 active，仅选中该项供用户决定
  refresh();
  selectProfileInList(listEl, newProfile.id);
}

function editProfile(win: Window, id: string, refresh: () => void) {
  const profile = getProfile(id);
  if (!profile) return;
  const draft = openProfileEditor(win, profile);
  if (!draft) return;
  updateProfile(id, draft);
  refresh();
}

function moveSelectedProfile(
  listEl: any,
  direction: -1 | 1,
  refresh: () => void,
) {
  const id = getSelectedProfileId(listEl);
  if (!id) {
    toastWarn("请先选中一个配置档");
    return;
  }
  const ok = moveProfile(id, direction);
  if (!ok) return;
  refresh();
  // 保持选中：在重新渲染后找到该 id 对应的 listitem
  selectProfileInList(listEl, id);
}

/** 从 richlistbox 中获取当前选中的非头部项的 profile id */
function getSelectedProfileId(listEl: any): string | null {
  const selected = listEl.selectedItem as any;
  if (!selected) return null;
  if (selected.getAttribute("data-header") === "1") return null;
  return selected.getAttribute("value") || null;
}

/** 选中指定 id 的项（会跳过分组头，需要遇到同 id 才选中） */
function selectProfileInList(listEl: any, id: string) {
  const items = listEl.querySelectorAll("richlistitem");
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as any;
    if (it.getAttribute("value") === id) {
      try {
        listEl.selectedIndex = i;
      } catch {
        // ignore
      }
      return;
    }
  }
}

function toastWarn(text: string) {
  new ztoolkit.ProgressWindow("ZotWanglele")
    .createLine({ text: `⚠️ ${text}`, type: "default", progress: 100 })
    .show()
    .startCloseTimer(2500);
}

function toastFail(text: string) {
  new ztoolkit.ProgressWindow("ZotWanglele")
    .createLine({ text: `❌ ${text}`, type: "fail", progress: 100 })
    .show()
    .startCloseTimer(3000);
}

function toastSuccess(text: string) {
  new ztoolkit.ProgressWindow("ZotWanglele")
    .createLine({ text: `✅ ${text}`, type: "success", progress: 100 })
    .show()
    .startCloseTimer(2000);
}

function confirmDialog(win: Window, title: string, text: string): boolean {
  return (Services as any).prompt.confirm(win, title, text);
}
