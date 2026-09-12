import { config } from "../../../package.json";
import { mountQueuePanel } from "./queue-panel";
import { mountAdvancedPanel } from "./advanced-panel";
import { mountOverviewPanel } from "./overview-panel";
import { mountPromptsPanel } from "./prompts-panel";
import { mountProfileManager } from "../ai/profile-manager";
import { mountSelectionPreferences } from "../selection-translate/preferences";

export type DashboardTab =
  | "overview"
  | "ai"
  | "queue"
  | "prompts"
  | "advanced"
  | "selection";

const TAB_ORDER: DashboardTab[] = [
  "overview",
  "ai",
  "queue",
  "prompts",
  "advanced",
  "selection",
];

// 仪表盘窗口 → 卸载函数列表（保证关闭时解订）
const unmounters = new WeakMap<Window, Array<() => void>>();

/**
 * 打开仪表盘窗口（单例：已打开则前置）。
 *
 * @param parentWin 父窗口（默认 Zotero 主窗口）
 * @param tab 打开后定位到哪个 tab，默认 overview
 */
export function openDashboard(
  parentWin?: Window,
  tab: DashboardTab = "overview",
): Window | null {
  const ref = config.addonRef;
  const url = `chrome://${ref}/content/dashboard.xhtml`;
  const windowType = "zotwanglele:dashboard";

  // 单例：已打开则前置 + 切到指定 tab
  const existing = Services.wm.getMostRecentWindow(windowType) as any;
  if (existing) {
    existing.focus();
    selectTab(existing as Window, tab);
    return existing as Window;
  }

  const win = parentWin ?? Zotero.getMainWindow();
  const dialogWin = Services.ww.openWindow(
    win as any,
    url,
    windowType,
    "chrome,centerscreen,resizable=yes,dialog=no",
    null as any,
  ) as any as Window;

  // 等 onload 跑完后切 tab
  if (dialogWin) {
    (dialogWin as any).addEventListener?.(
      "load",
      () => selectTab(dialogWin, tab),
      { once: true },
    );
  }

  return dialogWin;
}

/**
 * 仪表盘窗口加载完成时调用
 */
export function onDashboardLoad(win: Window) {
  ztoolkit.log("Dashboard loaded");
  const list: Array<() => void> = [];
  try {
    const host = win.document.getElementById("zotwanglele-dashboard-ai-root");
    if (host) list.push(mountProfileManager(win, host));
  } catch (e) {
    ztoolkit.log("[Dashboard] mountProfileManager error:", e);
  }
  try {
    const host = win.document.getElementById(
      "zotwanglele-dashboard-selection-root",
    );
    if (host) list.push(mountSelectionPreferences(win.document, host));
  } catch (e) {
    ztoolkit.log("[Dashboard] mountSelectionPreferences error:", e);
  }
  try {
    list.push(mountOverviewPanel(win));
  } catch (e) {
    ztoolkit.log("[Dashboard] mountOverviewPanel error:", e);
  }
  try {
    list.push(mountPromptsPanel(win));
  } catch (e) {
    ztoolkit.log("[Dashboard] mountPromptsPanel error:", e);
  }
  try {
    list.push(mountQueuePanel(win));
  } catch (e) {
    ztoolkit.log("[Dashboard] mountQueuePanel error:", e);
  }
  try {
    list.push(mountAdvancedPanel(win));
  } catch (e) {
    ztoolkit.log("[Dashboard] mountAdvancedPanel error:", e);
  }
  unmounters.set(win, list);
}

/**
 * 仪表盘窗口卸载时调用
 */
export function onDashboardUnload(win: Window) {
  ztoolkit.log("Dashboard unloaded");
  try {
    const list = unmounters.get(win) ?? [];
    for (const fn of list) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    unmounters.delete(win);
  } catch (e) {
    ztoolkit.log("[Dashboard] unmount error:", e);
  }
}

// ============================================================
// helpers
// ============================================================

function selectTab(win: Window, tab: DashboardTab) {
  try {
    const idx = TAB_ORDER.indexOf(tab);
    if (idx < 0) return;
    const tabbox = win.document.querySelector("tabbox") as any;
    if (tabbox) tabbox.selectedIndex = idx;
  } catch (e) {
    ztoolkit.log("[Dashboard] selectTab error:", e);
  }
}
