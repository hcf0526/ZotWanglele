/**
 * Adds ZotWanglele dashboard and AGENT chat buttons to the Zotero main toolbar.
 */
import { config } from "../../../package.json";
import { openDashboard } from "../dashboard/dashboard";
import { openAgentChatWindow } from "../agent/window";

const BTN_ID = "zotwanglele-tb-dashboard";
const AGENT_BTN_ID = "zotwanglele-tb-agent-chat";

function injectToolbarButton(
  win: Window,
  options: {
    id: string;
    tooltip: string;
    icon: string;
    onCommand: () => void;
  },
): void {
  const doc = win.document;
  if (doc.getElementById(options.id)) return;

  const anchor =
    (doc.querySelector("#zotero-tb-search-spinner") as Element | null) ||
    (doc.querySelector("#zotero-tb-search") as Element | null) ||
    (doc.querySelector("#zotero-tb-search-textbox") as Element | null);
  const toolbar =
    anchor?.parentElement ||
    (doc.querySelector("#zotero-toolbar") as Element | null) ||
    (doc.querySelector("#zotero-items-toolbar") as Element | null);
  if (!toolbar) {
    ztoolkit.log(
      "[Toolbar] could not find toolbar to inject button",
      options.id,
    );
    return;
  }

  ztoolkit.UI.appendElement(
    {
      tag: "toolbarbutton",
      namespace: "xul",
      id: options.id,
      attributes: {
        class: "zotero-tb-button",
        tooltiptext: options.tooltip,
        image: options.icon,
        flex: "0",
      },
      styles: {
        width: "24px",
        height: "24px",
        minWidth: "24px",
        minHeight: "24px",
        listStyleImage: `url(${options.icon})`,
      },
      listeners: [
        {
          type: "command",
          listener: () => {
            ztoolkit.log("[Toolbar] button clicked:", options.id);
            options.onCommand();
          },
        },
      ],
    },
    toolbar as HTMLElement,
  );

  const inserted = doc.getElementById(options.id);
  if (inserted && anchor && anchor.parentElement === toolbar) {
    // 仪表盘在前，AGENT 对话紧随其后
    if (options.id === AGENT_BTN_ID) {
      const dash = doc.getElementById(BTN_ID);
      if (dash && dash.parentElement === toolbar) {
        toolbar.insertBefore(inserted, dash.nextSibling);
        return;
      }
    }
    toolbar.insertBefore(inserted, anchor);
  }
}

export function registerDashboardToolbarButton(win: Window) {
  const ref = config.addonRef;
  injectToolbarButton(win, {
    id: BTN_ID,
    tooltip: "ZotWanglele 仪表盘",
    icon: `chrome://${ref}/content/icons/dashboard-toolbar.svg`,
    onCommand: () => openDashboard(win, "overview"),
  });
  injectToolbarButton(win, {
    id: AGENT_BTN_ID,
    tooltip: "ZotWanglele AGENT 对话",
    icon: `chrome://${ref}/content/icons/agent-toolbar.svg`,
    onCommand: () => openAgentChatWindow(win),
  });
  ztoolkit.log("[Toolbar] dashboard and agent buttons registered");
}
