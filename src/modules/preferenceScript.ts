import { config } from "../../package.json";
import { openDashboard } from "./dashboard/dashboard";
import { mountProfileManager } from "./ai/profile-manager";

export async function registerPrefsScripts(win: Window) {
  const doc = win.document;
  injectPrefsStylesheet(doc);
  const button = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-open-dashboard`,
  );
  if (button) (button as any).__zwlHandler = () => openDashboard(win);
  if (button && !(button as any).__zwlBound) {
    button.addEventListener("command", () => (button as any).__zwlHandler?.());
    (button as any).__zwlBound = true;
  }
  const host = doc.getElementById("zwl-prefs-ai-root");
  if (host) mountProfileManager(win, host);
  ztoolkit.log("ZotWanglele prefs loaded");
}

/** Zotero discards top-level xml-stylesheet declarations in preference fragments. */
function injectPrefsStylesheet(doc: Document) {
  for (const filename of ["paper-theme", "preferences", "ai-config"]) {
    const id = `zwl-${filename}-css-${config.addonRef}`;
    if (doc.getElementById(id)) continue;
    const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
    link.id = id;
    link.setAttribute("rel", "stylesheet");
    link.setAttribute(
      "href",
      `chrome://${config.addonRef}/content/${filename}.css`,
    );
    doc.documentElement?.appendChild(link);
  }
}
