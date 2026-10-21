import { config } from "../../../package.json";
import { mountAgentChatView, AgentChatViewHandle } from "./chat-view";

const handles = new WeakMap<Window, AgentChatViewHandle>();

export function openAgentChatWindow(parentWin?: Window): void {
  const parent = parentWin ?? Zotero.getMainWindow();
  const url = `chrome://${config.addonRef}/content/agent-chat.xhtml`;
  try {
    (parent as any).openDialog(
      url,
      "zotwanglele-agent-chat",
      "chrome,centerscreen,resizable=yes,width=860,height=720",
    );
  } catch (error) {
    ztoolkit.log("[AgentWindow] open failed:", error);
  }
}

export function onAgentChatLoad(win: Window): void {
  const host = win.document.getElementById("zwl-agent-chat-host");
  if (!host) return;
  handles.get(win)?.destroy();
  handles.set(win, mountAgentChatView(win, host as HTMLElement));
  win.addEventListener(
    "unload",
    () => {
      handles.get(win)?.destroy();
      handles.delete(win);
    },
    { once: true },
  );
}
