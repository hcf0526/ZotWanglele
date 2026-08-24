import { ApiFormat } from "./presets";

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

  async chat(
    messages: ChatMessage[],
    onStream?: StreamCallback,
  ): Promise<ChatResult> {
    const stream = !!onStream;
    const maxRetries = this.config.maxRetries ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (this.config.format === "responses") {
          return await this.callResponsesApi(messages, stream, onStream);
        }
        return await this.callChatCompletionsApi(messages, stream, onStream);
      } catch (e: any) {
        if (attempt === maxRetries) throw e;
        const isRetryable =
          e?.status === 429 || e?.status === 500 || e?.status === 503;
        if (!isRetryable) throw e;
        await this.delay(1000 * (attempt + 1));
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

    const response = await this.fetch(url, body);
    log("[AiClient] response status:", response.status);

    if (stream && onStream) {
      return this.parseChatCompletionsStream(response, onStream);
    }

    const json = await this.readJson(response);
    return {
      content: json.choices?.[0]?.message?.content ?? "",
      usage: json.usage,
    };
  }

  private async parseChatCompletionsStream(
    response: Response,
    onStream: StreamCallback,
  ): Promise<ChatResult> {
    let fullContent = "";
    await this.readSSE(response, (data: string) => {
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          fullContent += delta;
          onStream(delta);
        }
      } catch {
        // skip malformed chunks
      }
    });
    return { content: fullContent };
  }

  // ============================================================
  // Responses API — /v1/responses
  // ============================================================

  private async callResponsesApi(
    messages: ChatMessage[],
    stream: boolean,
    onStream?: StreamCallback,
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

    const response = await this.fetch(url, body);

    if (stream && onStream) {
      return this.parseResponsesStream(response, onStream);
    }

    const json = await this.readJson(response);
    const content = this.extractResponsesContent(json);
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
    await this.readSSE(response, (data: string) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "response.output_text.delta") {
          const delta = event.delta ?? "";
          if (delta) {
            fullContent += delta;
            onStream(delta);
          }
        }
      } catch {
        // skip malformed chunks
      }
    });
    return { content: fullContent };
  }

  // ============================================================
  // HTTP helpers
  // ============================================================

  private async fetch(url: string, body: any): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const isStream = !!body?.stream;
    if (isStream) {
      return this.fetchStream(url, headers, JSON.stringify(body));
    }

    log("[AiClient] Zotero.HTTP.request start", url);
    const xhr: any = await (Zotero as any).HTTP.request("POST", url, {
      headers,
      body: JSON.stringify(body),
      responseType: "text",
      successCodes: false,
    });
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

  // Streaming via XMLHttpRequest (Zotero.HTTP.request waits for full response)
  private fetchStream(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<Response> {
    // Lazily provide a Response-like object whose body is a ReadableStream
    // tied to incremental XHR progress events.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      for (const [k, v] of Object.entries(headers)) {
        xhr.setRequestHeader(k, v);
      }

      let processedLen = 0;
      let controller!: any;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(c: any) {
          controller = c;
        },
      });

      let resolved = false;
      const resolveOnce = () => {
        if (resolved) return;
        resolved = true;
        const ok = xhr.status >= 200 && xhr.status < 300;
        const fake: any = {
          ok,
          status: xhr.status,
          statusText: xhr.statusText || "",
          body: stream,
          json: async () => null,
          text: async () => "",
        };
        resolve(fake as Response);
      };

      xhr.onprogress = () => {
        // Resolve as soon as we get any data, so downstream can read the stream
        resolveOnce();
        const text = xhr.responseText ?? "";
        const chunk = text.slice(processedLen);
        processedLen = text.length;
        if (chunk) {
          controller.enqueue(encoder.encode(chunk));
        }
      };
      xhr.onload = () => {
        resolveOnce();
        const text = xhr.responseText ?? "";
        const tail = text.slice(processedLen);
        if (tail) controller.enqueue(encoder.encode(tail));
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      xhr.onerror = () => {
        if (!resolved) {
          reject(new Error(`Network error: ${xhr.statusText || "unknown"}`));
        } else {
          try {
            controller.error(new Error("Network error"));
          } catch {
            // already closed
          }
        }
      };
      xhr.send(body);
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

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await (reader as any).read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          onData(trimmed.slice(6));
        }
      }
    }

    if (buffer.trim().startsWith("data: ")) {
      onData(buffer.trim().slice(6));
    }
  }

  private normalizeBaseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, "");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
