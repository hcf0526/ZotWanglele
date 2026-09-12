import { ZoteroToolkit } from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export { createZToolkit };

function createZToolkit() {
  const _ztoolkit = new ZoteroToolkit();
  /**
   * Alternatively, import toolkit modules you use to minify the plugin size.
   * You can add the modules under the `MyToolkit` class below and uncomment the following line.
   */
  // const _ztoolkit = new MyToolkit();
  initZToolkit(_ztoolkit);
  return _ztoolkit;
}

function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  const env = __env__;
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = __env__ === "development";
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = __env__ === "development";
  // Getting basicOptions.debug will load global modules like the debug bridge.
  // since we want to deprecate it, should avoid using it unless necessary.
  // _ztoolkit.basicOptions.debug.disableDebugBridgePassword =
  //   __env__ === "development";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  _ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
  patchProgressWindowTheme(_ztoolkit);
}

function patchProgressWindowTheme(
  _ztoolkit: ReturnType<typeof createZToolkit>,
): void {
  const progressWindow = _ztoolkit.ProgressWindow as any;
  const prototype = progressWindow.prototype as any;
  if (prototype.__zwlPaperThemePatched) return;

  const updateIcons = prototype.updateIcons;
  prototype.updateIcons = function (this: any, ...args: any[]) {
    const result = updateIcons.apply(this, args);
    const doc = this.lines
      ?.map((line: any) => line?._hbox?.ownerDocument)
      .find((value: Document | undefined) => Boolean(value)) as
      | Document
      | undefined;
    if (doc) injectProgressWindowStyles(doc);
    return result;
  };
  prototype.__zwlPaperThemePatched = true;
}

function injectProgressWindowStyles(doc: Document): void {
  const stylesheets = [
    ["zotwanglele-progress-paper-theme", "paper-theme.css"],
    ["zotwanglele-progress-window-theme", "progress-window.css"],
  ] as const;
  const host = doc.documentElement;
  if (!host) return;
  for (const [id, filename] of stylesheets) {
    if (doc.getElementById(id)) continue;
    const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
    link.id = id;
    link.setAttribute("rel", "stylesheet");
    link.setAttribute(
      "href",
      `chrome://${config.addonRef}/content/${filename}`,
    );
    link.addEventListener(
      "load",
      () => {
        const popup = doc.defaultView as any;
        popup?.sizeToContent?.();
        (Zotero.ProgressWindowSet as any).tile?.(popup);
      },
      { once: true },
    );
    host.appendChild(link);
  }
}

import { BasicTool, unregister } from "zotero-plugin-toolkit";
import { UITool } from "zotero-plugin-toolkit";

class MyToolkit extends BasicTool {
  UI: UITool;

  constructor() {
    super();
    this.UI = new UITool(this);
  }

  unregisterAll() {
    unregister(this);
  }
}
