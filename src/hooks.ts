import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import {
  onDashboardLoad,
  onDashboardUnload,
} from "./modules/dashboard/dashboard";
import { onProfileEditorLoad } from "./modules/ai/profile-editor";
import { registerReaderMenu } from "./modules/reader/menu";
import {
  onMetadataCandidateDialogLoad,
  onMetadataDialogLoad,
  onMetadataResultDialogLoad,
} from "./modules/metadata";
import {
  registerNotePreviewSection,
  unregisterNotePreviewSection,
} from "./modules/reader/note-preview";
import { registerDashboardToolbarButton } from "./modules/ui/toolbar";
import {
  registerTitleTranslationColumn,
  unregisterTitleTranslationColumn,
} from "./modules/title-translate/title-translation";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  try {
    await registerTitleTranslationColumn();
  } catch (error) {
    ztoolkit.log("[Hooks] title column registration failed:", error);
  }

  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  try {
    registerNotePreviewSection();
  } catch (error) {
    ztoolkit.log("[Hooks] note preview registration failed:", error);
  }

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  try {
    win.MozXULElement.insertFTLIfNeeded(
      `${addon.data.config.addonRef}-mainWindow.ftl`,
    );
  } catch (error) {
    ztoolkit.log("[Hooks] Fluent registration failed:", error);
  }

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

  // 注册条目右键菜单：AI 精读 / 快速摘要
  try {
    registerReaderMenu();
  } catch (error) {
    ztoolkit.log("[Hooks] reader menu registration failed:", error);
  }

  // 注册主窗口工具栏按钮：打开仪表盘
  try {
    registerDashboardToolbarButton(win);
  } catch (error) {
    ztoolkit.log("[Hooks] toolbar registration failed:", error);
  }

  popupWin.changeLine({
    progress: 100,
    text: `[100%] ${getString("startup-finish")}`,
  });
  popupWin.startCloseTimer(3000);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterNotePreviewSection();
  unregisterTitleTranslationColumn();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(type: string) {
  switch (type) {
    default:
      break;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDashboardLoad,
  onDashboardUnload,
  onProfileEditorLoad,
  onMetadataDialogLoad,
  onMetadataCandidateDialogLoad,
  onMetadataResultDialogLoad,
};
