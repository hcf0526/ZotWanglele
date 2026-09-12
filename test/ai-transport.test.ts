import { assert } from "chai";
import { AiClient } from "../src/modules/ai/ai-client";
import { newAbortController, requestText } from "../src/utils/request";

class FakeXHR {
  status = 200;
  responseText = "";
  timeout = 0;
  aborted = false;
  body = "";
  url = "";
  headers: Record<string, string> = {};
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(body: string) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  chunk(text: string) {
    this.responseText += text;
    this.onprogress?.();
  }
  finish() {
    this.onload?.();
  }
}
class TestClient extends AiClient {
  xhr = new FakeXHR();
  protected createXHR(): XMLHttpRequest {
    return this.xhr as any;
  }
}
const messages = [{ role: "user" as const, content: "Translate this text" }];
const client = (format: "chat-completions" | "responses", maxRetries = 0) =>
  new TestClient({
    baseUrl: "https://example.invalid",
    apiKey: "test-key",
    model: "test-model",
    format,
    maxRetries,
  });
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
async function failure(work: Promise<unknown>): Promise<any> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  assert.fail("Expected the request to fail");
}

describe("AI transport", function () {
  this.timeout(5000);
  let originalRequest: typeof Zotero.HTTP.request;

  beforeEach(function () {
    originalRequest = Zotero.HTTP.request;
  });

  afterEach(function () {
    Zotero.HTTP.request = originalRequest;
  });

  it("streams Chat Completions through split events and split Unicode characters", async function () {
    const instance = client("chat-completions");
    const chunks: string[] = [];
    const work = instance.chat(messages, (chunk) => chunks.push(chunk));
    instance.xhr.chunk(
      ': keepalive\r\ndata:{"choices":\r\ndata:[{"delta":{"content":"译文 ',
    );
    instance.xhr.chunk("\uD83D");
    instance.xhr.chunk('\uDE00"}}]}\r\n\r\n');
    instance.xhr.chunk("data: [DONE]\n\n");
    instance.xhr.finish();
    assert.equal((await work).content, "译文 😀");
    assert.deepEqual(chunks, ["译文 😀"]);
    assert.include(instance.xhr.url, "/v1/chat/completions");
    assert.equal(instance.xhr.headers.Authorization, "Bearer test-key");
    assert.isTrue(JSON.parse(instance.xhr.body).stream);
  });

  it("streams Responses and requires its completion event", async function () {
    const instance = client("responses");
    let text = "";
    const work = instance.chat(messages, (chunk) => (text += chunk));
    instance.xhr.chunk(
      sse({ type: "response.output_text.delta", delta: "译文" }),
    );
    instance.xhr.chunk(
      sse({ type: "response.completed", response: { status: "completed" } }),
    );
    instance.xhr.finish();
    assert.equal((await work).content, text);
    assert.equal(text, "译文");
    assert.include(instance.xhr.url, "/v1/responses");
  });

  it("rejects HTTP failures before interpreting their body as SSE", async function () {
    for (const status of [401, 429, 503]) {
      const instance = client("chat-completions");
      let called = false;
      const work = instance.chat(messages, () => (called = true));
      instance.xhr.status = status;
      instance.xhr.chunk('{"error":{"message":"failed"}}');
      instance.xhr.finish();
      assert.equal((await failure(work)).status, status);
      assert.isFalse(called);
    }
  });

  it("aborts the actual streaming request before and after the first chunk", async function () {
    for (const partial of [false, true]) {
      const instance = client("chat-completions");
      const controller = newAbortController();
      const work = instance.chat(messages, () => {}, {
        signal: controller.signal,
      });
      if (partial)
        instance.xhr.chunk(
          sse({ choices: [{ delta: { content: "partial" } }] }),
        );
      controller.abort();
      assert.equal((await failure(work)).name, "AbortError");
      assert.isTrue(instance.xhr.aborted);
    }
    const instance = client("responses"),
      controller = newAbortController();
    controller.abort();
    assert.equal(
      (
        await failure(
          instance.chat(messages, () => {}, { signal: controller.signal }),
        )
      ).name,
      "AbortError",
    );
    assert.equal(instance.xhr.body, "");
  });

  it("reports timeout, premature EOF, invalid JSON and server-side stream failures", async function () {
    for (const mode of [
      "timeout",
      "truncated",
      "json",
      "server",
      "length",
      "shape",
    ] as const) {
      const instance = client("chat-completions", 2);
      const work = instance.chat(messages, () => {}, { timeoutMs: 45 });
      assert.equal(instance.xhr.timeout, 45);
      if (mode === "timeout") instance.xhr.ontimeout?.();
      else {
        const event =
          mode === "json"
            ? "data: invalid\n\n"
            : sse(
                mode === "server"
                  ? { error: { message: "failed" } }
                  : {
                      choices: [
                        {
                          delta: { content: mode === "shape" ? {} : "partial" },
                          finish_reason: mode === "length" ? "length" : null,
                        },
                      ],
                    },
              );
        instance.xhr.chunk(event);
        instance.xhr.finish();
      }
      const error = await failure(work);
      if (mode === "timeout") assert.equal(error.name, "TimeoutError");
      else assert.instanceOf(error, Error);
    }
    const instance = client("responses");
    const work = instance.chat(messages, () => {});
    instance.xhr.chunk(sse({ type: "response.incomplete" }));
    instance.xhr.finish();
    assert.include((await failure(work)).message, "incomplete");
  });

  it("preserves existing non-stream calls for both AI protocols", async function () {
    for (const format of ["chat-completions", "responses"] as const) {
      Zotero.HTTP.request = (async () => ({
        status: 200,
        responseText: JSON.stringify(
          format === "responses"
            ? {
                status: "completed",
                output: [
                  {
                    type: "message",
                    content: [{ type: "output_text", text: "译文" }],
                  },
                ],
              }
            : {
                choices: [
                  { message: { content: "译文" }, finish_reason: "stop" },
                ],
              },
        ),
      })) as any;
      assert.equal((await client(format).chat(messages)).content, "译文");
    }
    Zotero.HTTP.request = (async () => ({
      status: 200,
      responseText: "{}",
    })) as any;
    assert.include(
      (await failure(client("chat-completions").chat(messages))).message,
      "invalid",
    );
  });

  it("cancels non-stream HTTP and retry backoff and maps Zotero timeouts", async function () {
    let cancelled = false;
    Zotero.HTTP.request = ((_method: any, _url: any, options: any) =>
      new Promise((_resolve, reject) =>
        options.cancellerReceiver(() => {
          cancelled = true;
          reject(new Error("aborted"));
        }),
      )) as any;
    const controller = newAbortController();
    const work = requestText(
      "POST",
      "https://example.invalid",
      {},
      { signal: controller.signal },
    );
    controller.abort();
    assert.equal((await failure(work)).name, "AbortError");
    assert.isTrue(cancelled);
    Zotero.HTTP.request = (async () => {
      throw new (Zotero.HTTP as any).TimeoutException(50);
    }) as any;
    assert.equal(
      (await failure(requestText("GET", "https://example.invalid", {}))).name,
      "TimeoutError",
    );
    let calls = 0;
    Zotero.HTTP.request = (async () => {
      calls++;
      return { status: 429, responseText: "{}" };
    }) as any;
    const retryController = newAbortController();
    const retry = client("chat-completions", 2).chat(messages, undefined, {
      signal: retryController.signal,
    });
    await Zotero.Promise.delay(30);
    retryController.abort();
    assert.equal((await failure(retry)).name, "AbortError");
    assert.equal(calls, 1);
  });
});
