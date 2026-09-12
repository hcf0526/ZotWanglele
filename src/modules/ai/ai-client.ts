import { ApiFormat } from "./presets";
import {
  abortError,
  cancellableDelay,
  requestText,
  RequestControls,
  throwIfAborted,
  timeoutError,
} from "../../utils/request";

export type ChatOptions = RequestControls;

// ============================================================
// Types
// ============================================================

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | MessageContent[];
}

export interface MessageContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatResult {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type StreamCallback = (chunk: string) => void;

export interface AiClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  format: ApiFormat;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
}

// ============================================================
// AiClient
// ============================================================

export class AiClient {
  private config: AiClientConfig;

  constructor(config: AiClientConfig) {
    this.config = {
      temperature: 0.7,
      maxTokens: 4096,
      maxRetries: 2,
      ...config,
    };
  }

  updateConfig(partial: Partial<AiClientConfig>) {
    Object.assign(this.config, partial);
  }

  async listModels(): Promise<string[]> {
    const baseUrl = this.normalizeBaseUrl().replace(/\/v1$/i, "");
    const xhr = await Zotero.HTTP.request("GET", `${baseUrl}/v1/models`, {
      headers: this.config.apiKey
        ? { Authorization: `Bearer ${this.config.apiKey}` }
        : {},
      responseType: "text",
      successCodes: false,
      timeout: 30000,
    });
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(`获取模型失败（HTTP ${xhr.status}）`);
    }
    let json: { data?: Array<{ id?: unknown }> };
    try {
      json = JSON.parse(xhr.responseText ?? "");
    } catch {
      throw new Error("模型列表响应格式无效");
    }
    if (!Array.isArray(json?.data)) throw new Error("响应中缺少模型列表 data");
    return [
      ...new Set(
        json.data.flatMap((model) =>
          typeof model?.id === "string" && model.id.trim()
            ? [model.id.trim()]
            : [],
        ),
      ),
    ];
  }

  async chat(
    messages: ChatMessage[],
    onStream?: StreamCallback,
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const stream = !!onStream;
    const maxRetries = this.config.maxRetries ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      throwIfAborted(options.signal);
      let emitted = false;
      const callback = onStream
        ? (chunk: string) => {
            throwIfAborted(options.signal);
            emitted = true;
            onStream(chunk);
          }
        : undefined;
      try {
        if (this.config.format === "responses") {
          return await this.callResponsesApi(
            messages,
            stream,
            callback,
            options,
          );
        }
        return await this.callChatCompletionsApi(
          messages,
          stream,
          callback,
          options,
        );
      } catch (e: any) {
        throwIfAborted(options.signal);
        if (attempt === maxRetries || emitted) throw e;
        const isRetryable =
          e?.status === 429 || e?.status === 500 || e?.status === 503;
        if (!isRetryable) throw e;
        await cancellableDelay(1000 * (attempt + 1), options.signal);
      }
    }

    throw new Error("Unreachable");
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.chat([
        { role: "user", content: "请回复：连接成功" },
      ]);
      return { ok: true, message: result.content.slice(0, 100) };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  }

  // ============================================================
  // Chat Completions API — /v1/chat/completions
  // ============================================================

  private async callChatCompletionsApi(
    messages: ChatMessage[],
    stream: boolean,
    onStream?: StreamCallback,
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const url = `${this.normalizeBaseUrl()}/v1/chat/completions`;
    const body = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream,
    };
    log("[AiClient] POST", url, "model=", this.config.model);

    const response = await this.fetch(url, body, options);
    log("[AiClient] response status:", response.status);

    if (stream && onStream) {
      return this.parseChatCompletionsStream(response, onStream);
    }

    const json = await this.readJson(response);
    const content = json?.choices?.[0]?.message?.content;
    if (json?.error || typeof content !== "string" || !content.trim())
      throw new Error("AI response empty or invalid");
    if (["length", "content_filter"].includes(json.choices[0].finish_reason))
      throw new Error("AI response incomplete");
    return {
      content,
      usage: json.usage,
    };
  }

  private async parseChatCompletionsStream(
    response: Response,
    onStream: StreamCallback,
  ): Promise<ChatResult> {
    let fullContent = "";
    let completed = false;
    await this.readSSE(response, (data: string) => {
      if (data === "[DONE]") {
        completed = true;
        return;
      }
      const json = JSON.parse(data);
      if (json.error) throw new Error("AI stream error");
      const choice = json.choices?.[0];
      if (
        choice?.finish_reason === "length" ||
        choice?.finish_reason === "content_filter"
      ) {
        throw new Error("AI response incomplete");
      }
      if (choice?.finish_reason) completed = true;
      const delta = choice?.delta?.content ?? "";
      if (typeof delta !== "string") throw new Error("AI response invalid");
      if (delta) {
        fullContent += delta;
        onStream(delta);
      }
    });
    if (!completed) throw new Error("AI stream ended before completion");
    return { content: fullContent };
  }

  // ============================================================
  // Responses API — /v1/responses
  // ============================================================

  private async callResponsesApi(
    messages: ChatMessage[],
    stream: boolean,
    onStream?: StreamCallback,
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const url = `${this.normalizeBaseUrl()}/v1/responses`;
    const input = this.messagesToResponsesInput(messages);
    const body: Record<string, any> = {
      model: this.config.model,
      input,
      temperature: this.config.temperature,
      max_output_tokens: this.config.maxTokens,
    };
    if (stream) {
      body.stream = true;
    }

    const response = await this.fetch(url, body, options);

    if (stream && onStream) {
      return this.parseResponsesStream(response, onStream);
    }

    const json = await this.readJson(response);
    if (!json || json.error || ["failed", "incomplete"].includes(json.status))
      throw new Error("AI response incomplete");
    const content = this.extractResponsesContent(json);
    if (!content.trim()) throw new Error("AI response empty or invalid");
    return {
      content,
      usage: json.usage,
    };
  }

  private messagesToResponsesInput(
    messages: ChatMessage[],
  ): Record<string, any>[] {
    const input: Record<string, any>[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        input.push({
          role: "developer",
          content:
            typeof msg.content === "string"
              ? msg.content
              : msg.content.map((c) => c).toString(),
        });
      } else {
        input.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }
    return input;
  }

  private extractResponsesContent(json: any): string {
    const output = json.output ?? [];
    const parts: string[] = [];
    for (const item of output) {
      if (item.type === "message") {
        for (const c of item.content ?? []) {
          if (c.type === "output_text") {
            parts.push(c.text);
          }
        }
      }
    }
    return parts.join("");
  }

  private async parseResponsesStream(
    response: Response,
    onStream: StreamCallback,
  ): Promise<ChatResult> {
    let fullContent = "";
    let completed = false;
    await this.readSSE(response, (data: string) => {
      if (data === "[DONE]") return;
      const event = JSON.parse(data);
      if (
        ["error", "response.failed", "response.incomplete"].includes(event.type)
      ) {
        throw new Error("AI response incomplete");
      }
      if (event.type === "response.completed") completed = true;
      if (event.type === "response.output_text.delta" && event.delta) {
        if (typeof event.delta !== "string")
          throw new Error("AI response invalid");
        fullContent += event.delta;
        onStream(event.delta);
      }
    });
    if (!completed) throw new Error("AI stream ended before completion");
    return { content: fullContent };
  }

  // ============================================================
  // HTTP helpers
  // ============================================================

  private async fetch(
    url: string,
    body: any,
    options: ChatOptions,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const isStream = !!body?.stream;
    if (isStream) {
      return this.fetchStream(url, headers, JSON.stringify(body), options);
    }

    log("[AiClient] Zotero.HTTP.request start", url);
    const xhr = await requestText(
      "POST",
      url,
      {
        headers,
        body: JSON.stringify(body),
      },
      options,
    );
    log("[AiClient] Zotero.HTTP.request done", xhr.status);

    const text: string = xhr.responseText ?? "";
    const ok = xhr.status >= 200 && xhr.status < 300;

    if (!ok) {
      let errorMsg = `HTTP ${xhr.status}`;
      try {
        const errorJson = JSON.parse(text);
        errorMsg += `: ${errorJson.error?.message ?? JSON.stringify(errorJson)}`;
      } catch {
        errorMsg += `: ${text || xhr.statusText || "unknown"}`;
      }
      const err: any = new Error(errorMsg);
      err.status = xhr.status;
      throw err;
    }

    return {
      ok: true,
      status: xhr.status,
      statusText: xhr.statusText || "",
      body: null,
      json: async () => (text ? JSON.parse(text) : null),
      text: async () => text,
    } as any as Response;
  }

  // XHR exposes incremental text in the Zotero sandbox.
  protected createXHR(): XMLHttpRequest {
    const ctor = (Zotero.getMainWindow() as any).XMLHttpRequest;
    return new ctor();
  }

  private fetchStream(
    url: string,
    headers: Record<string, string>,
    body: string,
    options: ChatOptions,
  ): Promise<Response> {
    throwIfAborted(options.signal);
    return new Promise((resolve, reject) => {
      const xhr = this.createXHR();
      let processed = 0;
      let resolved = false;
      let finished = false;
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const win = Zotero.getMainWindow() as any;
      const encoder = new win.TextEncoder();
      const cleanup = () =>
        options.signal?.removeEventListener("abort", onAbort);
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (resolved) controller.error(error);
        else reject(error);
      };
      const onAbort = () => {
        fail(abortError());
        xhr.abort();
      };
      const stream = new win.ReadableStream({
        start(c: ReadableStreamDefaultController<Uint8Array>) {
          controller = c;
        },
        cancel() {
          finished = true;
          cleanup();
          xhr.abort();
        },
      });
      const progress = (final = false) => {
        if (finished || xhr.status < 200 || xhr.status >= 300) return;
        if (!resolved) {
          resolved = true;
          resolve({
            ok: true,
            status: xhr.status,
            body: stream,
          } as Response);
        }
        let chunk = (xhr.responseText || "").slice(processed);
        if (!final && /[\uD800-\uDBFF]$/.test(chunk))
          chunk = chunk.slice(0, -1);
        processed += chunk.length;
        if (chunk) controller.enqueue(encoder.encode(chunk));
      };
      xhr.open("POST", url, true);
      xhr.timeout = options.timeoutMs ?? 60000;
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.onprogress = () => progress();
      xhr.onload = () => {
        if (finished) return;
        if (xhr.status < 200 || xhr.status >= 300) {
          fail(
            Object.assign(new Error("HTTP " + xhr.status), {
              status: xhr.status,
            }),
          );
          return;
        }
        progress(true);
        finished = true;
        cleanup();
        controller.close();
      };
      xhr.onerror = () => fail(new Error("Network error"));
      xhr.ontimeout = () => fail(timeoutError());
      xhr.onabort = () => fail(abortError());
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      try {
        xhr.send(body);
      } catch (error) {
        fail(error as Error);
      }
    });
  }

  private async readJson(response: Response): Promise<any> {
    return (await response.json()) as any;
  }

  private async readSSE(
    response: Response,
    onData: (data: string) => void,
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body for SSE");

    const decoder = new (Zotero.getMainWindow() as any).TextDecoder();
    let buffer = "";
    let dataLines: string[] = [];
    const dispatch = () => {
      if (dataLines.length) onData(dataLines.join("\n"));
      dataLines = [];
    };
    const consume = (line: string) => {
      line = line.replace(/\r$/, "");
      if (!line) dispatch();
      else if (line.startsWith("data:"))
        dataLines.push(line.slice(5).replace(/^ /, ""));
    };

    try {
      while (true) {
        const { done, value } = await (reader as any).read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          consume(line);
        }
      }

      buffer += decoder.decode();
      if (buffer) consume(buffer);
      dispatch();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private normalizeBaseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, "");
  }
}

// ============================================================
// Multimodal helpers
// ============================================================

export function textMessage(
  role: ChatMessage["role"],
  text: string,
): ChatMessage {
  return { role, content: text };
}

export function multimodalMessage(
  role: ChatMessage["role"],
  text: string,
  base64Images: string[],
): ChatMessage {
  const content: MessageContent[] = [{ type: "text", text }];
  for (const img of base64Images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${img}`, detail: "auto" },
    });
  }
  return { role, content };
}

function log(...args: unknown[]): void {
  if (typeof ztoolkit !== "undefined") {
    ztoolkit.log(...args);
  }
}
