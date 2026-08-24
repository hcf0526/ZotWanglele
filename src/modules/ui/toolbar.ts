/**
 * Adds the ZotWanglele dashboard button to the Zotero main toolbar.
 */
import { config } from "../../../package.json";
import { openDashboard } from "../dashboard/dashboard";

const BTN_ID = "zotwanglele-tb-dashboard";

export function registerDashboardToolbarButton(win: Window) {
  const doc = win.document;
  if (doc.getElementById(BTN_ID)) return;

  const anchor =
    (doc.querySelector("#zotero-tb-search-spinner") as Element | null) ||
    (doc.querySelector("#zotero-tb-search") as Element | null) ||
    (doc.querySelector("#zotero-tb-search-textbox") as Element | null);
  const toolbar =
    anchor?.parentElement ||
    (doc.querySelector("#zotero-toolbar") as Element | null) ||
    (doc.querySelector("#zotero-items-toolbar") as Element | null);
  if (!toolbar) {
    ztoolkit.log("[Toolbar] could not find toolbar to inject button");
    return;
  }

  const ref = config.addonRef;
  const icon = `chrome://${ref}/content/icons/toolbar.png`;
  ztoolkit.UI.appendElement(
    {
      tag: "toolbarbutton",
      namespace: "xul",
      id: BTN_ID,
      attributes: {
        class: "zotero-tb-button",
        tooltiptext: "ZotWanglele 仪表盘",
        image: icon,
        width: "24",
        height: "24",
        flex: "0",
      },
      styles: {
        width: "24px",
        height: "24px",
        minWidth: "24px",
        minHeight: "24px",
        maxWidth: "24px",
        maxHeight: "24px",
        listStyleImage: `url(${icon})`,
      },
      listeners: [
        {
          type: "command",
          listener: () => {
            ztoolkit.log("[Toolbar] dashboard button clicked");
            openDashboard(win, "overview");
          },
        },
      ],
    },
    toolbar as HTMLElement,
  );

  const inserted = doc.getElementById(BTN_ID);
  if (inserted && anchor && anchor.parentElement === toolbar) {
    toolbar.insertBefore(inserted, anchor);
  }
  ztoolkit.log("[Toolbar] dashboard button registered");
}
