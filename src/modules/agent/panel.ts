import { config } from "../../../package.json";
import { getLocaleID } from "../../utils/locale";
import { agentSession } from "./session";
import { mountAgentChatView, AgentChatViewHandle } from "./chat-view";

let sectionId: string | undefined;
let registered = false;
let notifierId: string | undefined;
const panels = new Map<HTMLElement, AgentChatViewHandle>();

function renderSection({ body, tabType, setEnabled }: any): void {
  // AGENT 对话在文献页与阅读器页均可用
  const enabled = tabType === "info" || tabType === "reader";
  setEnabled(enabled);
  if (!enabled) {
    panels.get(body)?.destroy();
    panels.delete(body);
    body.replaceChildren();
    return;
  }
  if (panels.has(body)) return;
  panels.get(body)?.destroy();
  const handle = mountAgentChatView(
    body.ownerDocument.defaultView ?? Zotero.getMainWindow(),
    body,
    {
      compact: true,
    },
  );
  panels.set(body, handle);
  // 若用户在其它入口添加了上下文，视图通过 session 订阅自行刷新
  void agentSession;
}

export function registerAgentChatSection(): void {
  if (registered) return;
  registered = true;
  const id = Zotero.ItemPaneManager.registerSection({
    paneID: "zotwanglele-agent-chat",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("agent-section-header" as any),
      icon: `chrome://${config.addonRef}/content/icons/sidebar-agent.svg`,
    },
    sidenav: {
      l10nID: getLocaleID("agent-section-header" as any),
      icon: `chrome://${config.addonRef}/content/icons/sidebar-agent.svg`,
    },
    onRender: renderSection,
    onItemChange: renderSection,
    onDestroy: ({ body }) => {
      panels.get(body)?.destroy();
      panels.delete(body);
    },
  });
  if (id) sectionId = id;
  notifierId = Zotero.Notifier.registerObserver(
    {
      notify() {
        // 保持区块存活；内容由共享 session 驱动刷新
      },
    },
    ["tab"],
    "zotwanglele-agent-chat",
  );
  ztoolkit.log("[AgentPanel] section registered");
}

export function unregisterAgentChatSection(): void {
  if (!registered) return;
  registered = false;
  for (const handle of panels.values()) handle.destroy();
  panels.clear();
  if (sectionId) {
    try {
      Zotero.ItemPaneManager.unregisterSection(sectionId);
    } catch (e) {
      ztoolkit.log("[AgentPanel] unregister failed:", e);
    }
  }
  sectionId = undefined;
  if (notifierId) {
    try {
      Zotero.Notifier.unregisterObserver(notifierId);
    } catch {
      // ignore
    }
    notifierId = undefined;
  }
}
