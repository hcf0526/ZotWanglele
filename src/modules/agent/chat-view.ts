import { agentSession, AgentContextItem, AgentMessage } from "./session";
import { ensureAgentStyles } from "./styles";
import { openAgentChatWindow } from "./window";

export interface AgentChatViewHandle {
  destroy: () => void;
}

export function mountAgentChatView(
  win: Window,
  host: HTMLElement,
  options: { compact?: boolean } = {},
): AgentChatViewHandle {
  ensureAgentStyles(win.document);
  const doc = win.document;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
    doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];

  host.replaceChildren();
  const shell = create("div");
  shell.className = "zwl-agent-shell";
  if (options.compact) shell.dataset.compact = "true";

  const toolbar = create("div");
  toolbar.className = "zwl-agent-toolbar";
  const openButton = create("button");
  openButton.type = "button";
  openButton.textContent = "独立窗口";
  const addSelectedButton = create("button");
  addSelectedButton.type = "button";
  addSelectedButton.textContent = "添加选中文献";
  const clearContextButton = create("button");
  clearContextButton.type = "button";
  clearContextButton.textContent = "清空上下文";
  const clearChatButton = create("button");
  clearChatButton.type = "button";
  clearChatButton.textContent = "清空对话";
  toolbar.append(
    openButton,
    addSelectedButton,
    clearContextButton,
    clearChatButton,
  );

  const contextPanel = create("div");
  contextPanel.className = "zwl-agent-context-panel";
  const contextTitle = create("div");
  contextTitle.className = "zwl-agent-context-title";
  const contextTitleText = create("span");
  contextTitleText.textContent = "对话上下文";
  const contextHint = create("span");
  contextHint.textContent = "发送时记忆快照，可随时增删";
  contextTitle.append(contextTitleText, contextHint);
  const contextList = create("div");
  contextList.className = "zwl-agent-context-list";
  contextPanel.append(contextTitle, contextList);

  const messages = create("div");
  messages.className = "zwl-agent-messages";
  messages.setAttribute("role", "log");
  messages.setAttribute("aria-live", "polite");

  const composer = create("div");
  composer.className = "zwl-agent-composer";
  const textarea = create("textarea");
  textarea.placeholder = "输入问题，Enter 发送，Shift+Enter 换行";
  textarea.rows = 3;
  const actions = create("div");
  actions.className = "zwl-agent-composer-actions";
  const status = create("div");
  status.className = "zwl-agent-status";
  const stopButton = create("button");
  stopButton.type = "button";
  stopButton.textContent = "停止";
  const sendButton = create("button");
  sendButton.type = "button";
  sendButton.className = "primary";
  sendButton.textContent = "发送";
  actions.append(status, stopButton, sendButton);
  composer.append(textarea, actions);

  shell.append(toolbar, contextPanel, messages, composer);
  host.appendChild(shell);

  const renderContext = (items: AgentContextItem[]) => {
    contextList.replaceChildren();
    if (!items.length) {
      const empty = create("div");
      empty.className = "zwl-agent-context-empty";
      empty.textContent =
        "尚未添加上下文。可在条目右键选择「添加至 Agent」，或在 PDF 划词后添加。";
      contextList.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = create("div");
      row.className = "zwl-agent-context-item";
      row.dataset.kind = item.kind;
      const main = create("div");
      main.className = "zwl-agent-context-item-main";
      const label = create("div");
      label.className = "zwl-agent-context-label";
      label.textContent = item.label;
      const meta = create("div");
      meta.className = "zwl-agent-context-meta";
      meta.textContent = `${item.kind === "item" ? "文献" : "划词"} · ${item.source}`;
      main.append(label, meta);
      const remove = create("button");
      remove.type = "button";
      remove.textContent = "移除";
      remove.addEventListener("click", () =>
        agentSession.removeContext(item.id),
      );
      row.append(main, remove);
      contextList.appendChild(row);
    }
  };

  const contextLabel = (id: string) =>
    agentSession.getContext().find((entry) => entry.id === id)?.label ?? id;

  const renderMessages = (list: AgentMessage[]) => {
    messages.replaceChildren();
    if (!list.length) {
      const empty = create("div");
      empty.className = "zwl-agent-empty";
      empty.textContent =
        "开始多轮对话：先添加文献或划词上下文，再输入问题。系统提示词可在「提示词管理 · AGENT 对话」中修改。";
      messages.appendChild(empty);
      return;
    }
    for (const message of list) {
      const card = create("div");
      card.className = "zwl-agent-message";
      card.dataset.role = message.role;
      card.dataset.error = String(!!message.error);
      const meta = create("div");
      meta.className = "zwl-agent-message-meta";
      const roleLabel = message.role === "user" ? "你" : "AGENT";
      const contextPart = message.contextIds.length
        ? ` · 上下文 ${message.contextIds.length} 项`
        : " · 无上下文";
      meta.textContent = `${roleLabel}${contextPart}${message.modelLabel ? ` · ${message.modelLabel}` : ""}`;
      const body = create("div");
      body.textContent = message.content;
      card.append(meta, body);
      if (message.contextIds.length) {
        const ctx = create("div");
        ctx.className = "zwl-agent-context-meta";
        ctx.textContent = message.contextIds
          .map((id) => contextLabel(id))
          .join("；");
        card.appendChild(ctx);
      }
      messages.appendChild(card);
    }
    messages.scrollTop = messages.scrollHeight;
  };

  const render = () => {
    renderContext(agentSession.getContext());
    renderMessages(agentSession.getMessages());
    const sending = agentSession.isSending();
    sendButton.disabled = sending;
    stopButton.disabled = !sending;
    status.textContent = sending
      ? "正在生成回复…"
      : `上下文 ${agentSession.getContext().length} 项 · 消息 ${agentSession.getMessages().length} 条`;
  };

  const send = async () => {
    const text = textarea.value;
    if (!text.trim() || agentSession.isSending()) return;
    textarea.value = "";
    await agentSession.send(text);
  };

  sendButton.addEventListener("click", () => {
    void send();
  });
  stopButton.addEventListener("click", () => agentSession.stop());
  textarea.addEventListener("keydown", (event) => {
    const keyEvent = event as KeyboardEvent;
    if (
      keyEvent.key === "Enter" &&
      !keyEvent.shiftKey &&
      !keyEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  });
  openButton.addEventListener("click", () => openAgentChatWindow(win));
  addSelectedButton.addEventListener("click", () => {
    const pane = (Zotero as any).getActiveZoteroPane?.();
    const items: Zotero.Item[] = pane?.getSelectedItems?.() ?? [];
    const added = agentSession.addItemsContext(items, "列表选中");
    status.textContent = added
      ? `已添加 ${added} 篇文献到上下文`
      : "请先在条目列表选中常规文献";
  });
  clearContextButton.addEventListener("click", () =>
    agentSession.clearContext(),
  );
  clearChatButton.addEventListener("click", () => agentSession.clearMessages());

  const unsubscribe = agentSession.subscribe(render);
  render();

  return {
    destroy: () => {
      unsubscribe();
      host.replaceChildren();
    },
  };
}
