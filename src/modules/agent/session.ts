import { AiClient, ChatMessage } from "../ai/ai-client";
import {
  getActiveProfile,
  getModelLabel,
  resolveFileUploadProfile,
} from "../ai/profiles";
import { getActiveTemplate, renderPrompt } from "../ai/prompts";
import {
  MAX_PDF_UPLOAD_BYTES,
  buildPdfFileName,
  estimateBase64Bytes,
  getPdfBase64,
  getItemMeta,
} from "../reader/pdf-extractor";

export const AGENT_FEATURE_ID = "agent-chat";

export type AgentContextKind = "item" | "text";

export interface AgentContextItem {
  id: string;
  kind: AgentContextKind;
  label: string;
  itemId?: number;
  text?: string;
  source: string;
  addedAt: number;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 发送当时挂载的上下文 id 快照 */
  contextIds: string[];
  error?: boolean;
  modelLabel?: string;
}

type Listener = () => void;

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

class AgentChatSession {
  private context: AgentContextItem[] = [];
  private messages: AgentMessage[] = [];
  private listeners = new Set<Listener>();
  private sending = false;
  private abort: AbortController | null = null;

  getContext(): AgentContextItem[] {
    return [...this.context];
  }

  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  isSending(): boolean {
    return this.sending;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (e) {
        ztoolkit.log("[AgentSession] listener error:", e);
      }
    }
  }

  addItemContext(
    item: Zotero.Item,
    source = "文献条目",
  ): AgentContextItem | null {
    if (!item?.isRegularItem?.()) return null;
    const existing = this.context.find(
      (entry) => entry.kind === "item" && entry.itemId === item.id,
    );
    if (existing) return existing;
    const meta = getItemMeta(item);
    const entry: AgentContextItem = {
      id: uid("ctx"),
      kind: "item",
      label: meta.title || `条目 #${item.id}`,
      itemId: item.id,
      source,
      addedAt: Date.now(),
    };
    this.context.push(entry);
    this.emit();
    return entry;
  }

  addItemsContext(items: Zotero.Item[], source = "文献条目"): number {
    let added = 0;
    for (const item of items) {
      if (!item?.isRegularItem?.()) continue;
      const before = this.context.length;
      this.addItemContext(item, source);
      if (this.context.length > before) added += 1;
    }
    if (added) this.emit();
    return added;
  }

  addTextContext(text: string, source = "阅读器划词"): AgentContextItem | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const entry: AgentContextItem = {
      id: uid("ctx"),
      kind: "text",
      label: trimmed.length > 36 ? `${trimmed.slice(0, 36)}…` : trimmed,
      text: trimmed,
      source,
      addedAt: Date.now(),
    };
    this.context.push(entry);
    this.emit();
    return entry;
  }

  removeContext(id: string): void {
    const next = this.context.filter((entry) => entry.id !== id);
    if (next.length === this.context.length) return;
    this.context = next;
    this.emit();
  }

  clearContext(): void {
    if (!this.context.length) return;
    this.context = [];
    this.emit();
  }

  clearMessages(): void {
    this.abort?.abort();
    this.messages = [];
    this.emit();
  }

  stop(): void {
    this.abort?.abort();
  }

  async send(userText: string): Promise<void> {
    const text = userText.trim();
    if (!text || this.sending) return;

    const active = getActiveProfile();
    if (!active) {
      this.pushError("请先在 AI 配置中设置当前模型", []);
      return;
    }
    const profile = resolveFileUploadProfile(active);
    if (!profile.baseUrl || !profile.apiKey || !profile.model) {
      this.pushError(
        `配置档「${getModelLabel(profile)}」缺少 Base URL / API Key / 模型`,
        this.context.map((c) => c.id),
      );
      return;
    }

    const template = getActiveTemplate(AGENT_FEATURE_ID);
    if (!template) {
      this.pushError("AGENT 对话提示词缺失，请在提示词管理中检查", []);
      return;
    }

    const contextIds = this.context.map((entry) => entry.id);
    const userMessage: AgentMessage = {
      id: uid("msg"),
      role: "user",
      content: text,
      contextIds,
    };
    this.messages.push(userMessage);
    this.sending = true;
    this.abort = new AbortController();
    this.emit();

    try {
      const { userContent, files } = await this.buildUserContent(
        text,
        this.context,
      );
      const systemPrompt = template.systemPrompt;
      const history = this.buildHistoryMessages(template.systemPrompt);
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...history,
        files.length
          ? {
              role: "user",
              content: [
                { type: "text", text: userContent },
                ...files.map((file) => ({
                  type: "file" as const,
                  file: {
                    filename: file.filename,
                    file_data: file.base64.startsWith("data:")
                      ? file.base64
                      : `data:application/pdf;base64,${file.base64}`,
                  },
                })),
              ],
            }
          : { role: "user", content: userContent },
      ];

      const client = new AiClient({
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        format: profile.format,
        temperature: profile.temperature / 100,
        maxTokens: profile.maxTokens,
      });
      const result = await client.chat(messages, undefined, {
        signal: this.abort.signal,
      });
      const content = (result.content ?? "").trim();
      if (!content) throw new Error("AI 返回空内容");
      this.messages.push({
        id: uid("msg"),
        role: "assistant",
        content,
        contextIds,
        modelLabel: getModelLabel(profile),
      });
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.message?.includes?.("aborted")) {
        this.messages.push({
          id: uid("msg"),
          role: "assistant",
          content: "已停止本次生成。",
          contextIds,
        });
      } else {
        this.messages.push({
          id: uid("msg"),
          role: "assistant",
          content: `调用失败：${e?.message ?? String(e)}`,
          contextIds,
          error: true,
        });
      }
    } finally {
      this.sending = false;
      this.abort = null;
      this.emit();
    }
  }

  /** 历史消息不含最终用户消息与助手回复之外的重复上下文块 */
  private buildHistoryMessages(systemPrompt: string): ChatMessage[] {
    void systemPrompt;
    const history: ChatMessage[] = [];
    // 只带上一对以内的完整往返即可控上下文；完整多轮保留
    for (const message of this.messages.slice(0, -1)) {
      if (message.error) continue;
      history.push({
        role: message.role,
        content: message.content,
      });
    }
    return history;
  }

  private async buildUserContent(
    message: string,
    context: AgentContextItem[],
  ): Promise<{
    userContent: string;
    files: Array<{ filename: string; base64: string }>;
  }> {
    const template = getActiveTemplate(AGENT_FEATURE_ID);
    const files: Array<{ filename: string; base64: string }> = [];
    const blocks: string[] = [];
    let pendingBytes = 0;

    for (const entry of context) {
      if (entry.kind === "text") {
        blocks.push(
          `### 划词原文（${entry.source}）\n${entry.text ?? entry.label}`,
        );
        continue;
      }
      const item = entry.itemId ? Zotero.Items.get(entry.itemId) : null;
      if (!item) {
        blocks.push(`### 文献（已失效）\n${entry.label}`);
        continue;
      }
      const meta = getItemMeta(item);
      const lines = [
        `### 文献：${meta.title || entry.label}`,
        `作者：${meta.authors || "未填写"}`,
        `年份：${meta.year || "未填写"}`,
        meta.doi ? `DOI：${meta.doi}` : "",
        `摘要：${meta.abstract || "未提供"}`,
      ].filter(Boolean);
      try {
        const pdf = await getPdfBase64(item);
        const bytes = pdf ? estimateBase64Bytes(pdf) : 0;
        if (pdf && bytes > 0 && pendingBytes + bytes <= MAX_PDF_UPLOAD_BYTES) {
          const filename = buildPdfFileName(meta.title, `doc-${entry.itemId}`);
          files.push({ filename, base64: pdf });
          pendingBytes += bytes;
          lines.push(`PDF 附件：${filename}`);
        } else if (pdf) {
          lines.push("PDF 过大，未随本条消息上传");
        }
      } catch {
        // ignore attachment failures; metadata still useful
      }
      blocks.push(lines.join("\n"));
    }

    const contextText = blocks.length
      ? blocks.join("\n\n---\n\n")
      : "（当前未挂载额外上下文）";
    const userContent = template
      ? renderPrompt(template.userPrompt, {
          context: contextText,
          message,
        })
      : `对话上下文：\n${contextText}\n\n用户消息：\n${message}`;
    return { userContent, files };
  }

  private pushError(content: string, contextIds: string[]): void {
    this.messages.push({
      id: uid("msg"),
      role: "assistant",
      content,
      contextIds,
      error: true,
    });
    this.emit();
  }
}

export const agentSession = new AgentChatSession();

/** 右键划词：把选区写入共享上下文并打开对话 */
export function addSelectionToAgentContext(text: string): void {
  const entry = agentSession.addTextContext(text, "阅读器划词");
  if (!entry) {
    new ztoolkit.ProgressWindow("ZotWanglele AGENT")
      .createLine({
        text: "选区为空，未加入对话上下文",
        type: "fail",
        progress: 100,
      })
      .show()
      .startCloseTimer(2500);
    return;
  }
  new ztoolkit.ProgressWindow("ZotWanglele AGENT")
    .createLine({
      text: "已加入 AGENT 对话上下文",
      type: "success",
      progress: 100,
    })
    .show()
    .startCloseTimer(2000);
}

/** 右键文献：把选中条目写入共享上下文并打开对话 */
export function addItemsToAgentContextAndOpen(
  items: Zotero.Item[],
  parentWin?: Window,
): void {
  const targets = items.filter((item) => item?.isRegularItem?.());
  if (!targets.length) {
    new ztoolkit.ProgressWindow("ZotWanglele AGENT")
      .createLine({
        text: "请先选中常规文献条目",
        type: "fail",
        progress: 100,
      })
      .show()
      .startCloseTimer(2500);
    return;
  }
  const added = agentSession.addItemsContext(targets, "文献条目");
  new ztoolkit.ProgressWindow("ZotWanglele AGENT")
    .createLine({
      text: `已将 ${added} 篇文献加入 AGENT 对话上下文`,
      type: "success",
      progress: 100,
    })
    .show()
    .startCloseTimer(2000);
  void openAgentChatWindow(parentWin);
}

async function openAgentChatWindow(parentWin?: Window): Promise<void> {
  const { openAgentChatWindow: open } = await import("./window");
  open(parentWin);
}
