import { assert } from "chai";
import { config } from "../package.json";
import {
  DEFAULT_SETTINGS,
  getSettings,
  PREF_PREFIX,
} from "../src/modules/selection-translate/config";
import { TranslationSession } from "../src/modules/selection-translate/session";
import {
  normalizeSelection,
  splitText,
} from "../src/modules/selection-translate/text";
import {
  baiduSignature,
  prepareTranslator,
  providerLanguage,
  TranslationRequest,
} from "../src/modules/selection-translate/services";
import {
  element,
  mountTranslationView,
} from "../src/modules/selection-translate/view";
import {
  mountSelectionPreferences,
  unmountSelectionPreferences,
} from "../src/modules/selection-translate/preferences";
import {
  getActiveTemplate,
  updateBuiltinTemplate,
} from "../src/modules/ai/prompts";
import { newAbortController } from "../src/utils/request";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("selection translation", function () {
  this.timeout(15000);
  let previousAddon: unknown;
  let previousToolkit: unknown;

  before(function () {
    previousAddon = (globalThis as any).addon;
    previousToolkit = (globalThis as any).ztoolkit;
    (globalThis as any).addon = (Zotero as any)[config.addonInstance];
    (globalThis as any).ztoolkit = (globalThis as any).addon.data.ztoolkit;
  });

  after(function () {
    (globalThis as any).addon = previousAddon;
    (globalThis as any).ztoolkit = previousToolkit;
  });
  const live: TranslationSession[] = [];
  const saved = new Map<string, any>();
  let originalRequest: typeof Zotero.HTTP.request;

  beforeEach(function () {
    originalRequest = Zotero.HTTP.request;
    for (const key of Object.keys(DEFAULT_SETTINGS))
      saved.set(key, Zotero.Prefs.get(PREF_PREFIX + key, true));
  });

  afterEach(function () {
    Zotero.HTTP.request = originalRequest;
    for (const session of live.splice(0)) session.dispose();
    for (const [key, value] of saved) {
      if (value === undefined) Zotero.Prefs.clear(PREF_PREFIX + key, true);
      else Zotero.Prefs.set(PREF_PREFIX + key, value, true);
    }
    saved.clear();
  });
  const session = (
    translate: (request: TranslationRequest) => Promise<{ text: string }>,
    settings = { ...DEFAULT_SETTINGS },
    fingerprint = () => "test",
  ) => {
    const instance = new TranslationSession(
      () => settings,
      () => ({ fingerprint: fingerprint(), translate }),
    );
    live.push(instance);
    return instance;
  };

  it("preserves paragraphs, math, real hyphens and Unicode at chunk boundaries", function () {
    assert.equal(
      normalizeSelection(
        "  soft\u00ad\nware  state-of-the-art\r\n\r\nx² + y² = 1  ",
      ),
      "software state-of-the-art\n\nx² + y² = 1",
    );
    assert.throws(() => normalizeSelection(" \n\t "), "empty-selection");
    assert.equal(
      Array.from(normalizeSelection("😀".repeat(5000))).length,
      5000,
    );
    assert.throws(() => normalizeSelection("😀".repeat(5001)), "too-long");
    for (const size of [500, 1500]) {
      const input = "Sentence with math α = 2. 中文段落。 😀\n\n".repeat(120);
      const chunks = splitText(input, size);
      assert.equal(
        chunks.map((part) => part.text + part.suffix).join(""),
        input,
      );
      assert.isTrue(
        chunks.every((part) => Array.from(part.text).length <= size),
      );
      assert.isFalse(chunks.some((part) => /[\uD800-\uDBFF]$/.test(part.text)));
    }
  });

  it("uses provider-specific language codes and Baidu's documented signing vector", function () {
    assert.equal(
      baiduSignature("2015063000000001", "apple", "1435660288", "12345678"),
      "f89f9594663708c1605f3d736d01d2d4",
    );
    assert.equal(providerLanguage("baidu", "zh-TW"), "cht");
    assert.equal(providerLanguage("baidu", "ja"), "jp");
    assert.equal(providerLanguage("deepl", "zh-TW"), "ZH-HANT");
    assert.isUndefined(providerLanguage("deepl", "auto"));
    assert.equal(providerLanguage("google", "zh-TW"), "zh-TW");
  });

  it("coalesces duplicate starts and ignores an old response after reselection", async function () {
    const requests: TranslationRequest[] = [];
    const finish: Array<(value: { text: string }) => void> = [];
    const instance = session((request) => {
      requests.push(request);
      return new Promise((resolve) => finish.push(resolve));
    });
    instance.setSelection("first");
    const first = instance.run();
    await instance.run();
    assert.lengthOf(requests, 1);
    instance.setSelection("second");
    assert.isTrue(requests[0].signal.aborted);
    const second = instance.run();
    requests[0].onChunk?.("stale");
    finish[0]({ text: "old" });
    await first;
    assert.equal(instance.snapshot.text, "");
    finish[1]({ text: "new" });
    await second;
    assert.equal(instance.snapshot.text, "new");
  });

  it("isolates readers, keeps a bounded cache and invalidates changed configuration", async function () {
    let calls = 0,
      fingerprint = "model-a";
    const translate = async (request: TranslationRequest) => {
      calls++;
      return { text: `译文 ${request.text}` };
    };
    const left = session(translate, { ...DEFAULT_SETTINGS }, () => fingerprint);
    const right = session(translate);
    left.setSelection("same");
    await left.run();
    right.setSelection("same");
    await right.run();
    assert.equal(calls, 2);
    left.setSelection("different");
    left.setSelection("same");
    await left.run();
    assert.isTrue(left.snapshot.fromCache);
    assert.equal(calls, 2);
    await left.run(true);
    assert.equal(calls, 3);
    fingerprint = "model-b";
    await left.run();
    assert.equal(calls, 4);
    for (let i = 0; i < 51; i++) {
      left.setSelection(`text ${i}`);
      await left.run();
    }
    left.setSelection("same");
    await left.run();
    assert.isFalse(left.snapshot.fromCache);
    assert.equal(right.snapshot.text, "译文 same");
  });

  it("debounces automatic translation, skips dismissed selections and cancels on disposal", async function () {
    let calls = 0;
    const instance = session(
      async () => {
        calls++;
        return { text: "译文" };
      },
      { ...DEFAULT_SETTINGS, automatic: true },
    );
    instance.setSelection("first");
    instance.scheduleAutomatic(() => true);
    await sleep(300);
    instance.setSelection("second");
    instance.scheduleAutomatic(() => true);
    await sleep(350);
    assert.equal(calls, 0);
    await sleep(300);
    assert.equal(calls, 1);
    instance.setSelection("dismissed");
    instance.scheduleAutomatic(() => false);
    await sleep(650);
    assert.equal(calls, 1);
    instance.setSelection("closed");
    instance.scheduleAutomatic(() => true);
    instance.dispose();
    await sleep(650);
    assert.equal(calls, 1);
  });

  it("stops active requests and never caches partial output", async function () {
    let request!: TranslationRequest;
    let finish!: (value: { text: string }) => void;
    let calls = 0;
    const instance = session((input) => {
      calls++;
      request = input;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    instance.setSelection("source");
    const work = instance.run();
    request.onChunk?.("partial");
    instance.stop();
    assert.isTrue(request.signal.aborted);
    finish({ text: "late" });
    await work;
    assert.equal(instance.snapshot.status, "cancelled");
    assert.equal(instance.snapshot.text, "partial");
    const retry = instance.run();
    assert.equal(calls, 2);
    instance.dispose();
    assert.isTrue(request.signal.aborted);
    finish({ text: "closed" });
    await retry;
    assert.equal(instance.snapshot.text, "");
  });

  it("maps Google, DeepL and Baidu responses without writing to library items", async function () {
    const seen: Array<{ method: string; url: string; options: any }> = [];
    Zotero.HTTP.request = (async (
      method: string,
      url: string,
      options: any,
    ) => {
      seen.push({ method, url, options });
      const data = url.includes("googleapis")
        ? [[["译文", "source"]], null, "en"]
        : url.includes("deepl")
          ? { translations: [{ text: "译文", detected_source_language: "EN" }] }
          : { from: "en", trans_result: [{ dst: "译文" }] };
      return { status: 200, responseText: JSON.stringify(data) };
    }) as any;
    for (const provider of ["google", "deepl", "baidu"] as const) {
      const translator = prepareTranslator({
        ...DEFAULT_SETTINGS,
        provider,
        deeplKey: "test-deepl",
        baiduAppId: "appid",
        baiduKey: "secret",
      });
      const output = await translator.translate({
        text: "source",
        sourceLang: "auto",
        targetLang: "zh-TW",
        signal: newAbortController().signal,
      });
      assert.equal(output.text, "译文");
    }
    assert.include(seen[0].url, "tl=zh-TW");
    assert.equal(
      seen[1].options.headers.Authorization,
      "DeepL-Auth-Key test-deepl",
    );
    assert.notProperty(JSON.parse(seen[1].options.body), "source_lang");
    assert.equal(seen[2].method, "POST");
    assert.match(seen[2].url, /^https:/);
    assert.equal(new URLSearchParams(seen[2].options.body).get("to"), "cht");
  });

  it("validates credentials, HTTP failures, empty output and service errors", async function () {
    assert.throws(
      () => prepareTranslator({ ...DEFAULT_SETTINGS, provider: "deepl" }),
      "deepl-config",
    );
    assert.throws(
      () => prepareTranslator({ ...DEFAULT_SETTINGS, provider: "baidu" }),
      "baidu-config",
    );
    const translator = prepareTranslator({
      ...DEFAULT_SETTINGS,
      provider: "google",
    });
    for (const [status, body, code] of [
      [403, "{}", "auth"],
      [429, "{}", "rate-limit"],
      [200, "invalid", "response"],
      [200, "[]", "response"],
      [200, "[[]]", "empty-result"],
    ] as const) {
      Zotero.HTTP.request = (async () => ({
        status,
        responseText: body,
      })) as any;
      let thrown: any;
      try {
        await translator.translate({
          text: "source",
          sourceLang: "auto",
          targetLang: "zh-CN",
          signal: newAbortController().signal,
        });
      } catch (error) {
        thrown = error;
      }
      assert.equal(thrown?.code, code);
    }
  });

  it("renders synchronized, selectable plain text in the popup and sidebar", async function () {
    const doc = Zotero.getMainWindow().document;
    const host = element(doc, "div");
    doc.documentElement!.appendChild(host);
    const instance = session(async () => ({
      text: "<img src=x onerror=alert(1)>\n译文",
    }));
    const left = mountTranslationView(host, instance, true);
    const right = mountTranslationView(host, instance, false);
    try {
      instance.setSelection("<b>source</b>");
      await instance.run();
      const results = host.querySelectorAll(".zwl-selection-result");
      assert.lengthOf(results, 2);
      assert.equal(results[0].textContent, results[1].textContent);
      assert.isNull(results[0].querySelector("img"));
      assert.include(instance.copyText(true), "<b>source</b>");
      assert.isFalse(
        (host.querySelector('[data-action="copy"]') as HTMLButtonElement)
          .disabled,
      );
    } finally {
      left();
      right();
      host.remove();
    }
  });

  it("mounts settings idempotently and persists independent preferences", function () {
    const doc = Zotero.getMainWindow().document;
    const host = element(doc, "div");
    host.id = "zotwanglele-dashboard-selection-root";
    doc.documentElement!.appendChild(host);
    try {
      mountSelectionPreferences(doc, host);
      mountSelectionPreferences(doc, host);
      assert.lengthOf(host.querySelectorAll("#zwl-selection-settings"), 1);
      const field = host.querySelector(
        '[data-pref="provider"]',
      ) as HTMLSelectElement;
      field.value = "deepl";
      field.dispatchEvent(
        new (doc.defaultView as any).Event("change", { bubbles: true }),
      );
      assert.equal(getSettings().provider, "deepl");
      assert.isFalse(
        (host.querySelector('[data-provider="deepl"]') as HTMLElement).hidden,
      );
    } finally {
      unmountSelectionPreferences();
      host.remove();
    }
  });

  it("registers the native reader event and pane section, and exposes an editable prompt", function () {
    const listeners = (Zotero.Reader as any)._registeredListeners;
    assert.equal(
      listeners.filter(
        (entry: any) =>
          entry.type === "renderTextSelectionPopup" &&
          entry.pluginID === config.addonID,
      ).length,
      1,
    );
    const sections = (Zotero.ItemPaneManager as any).customSectionData.options;
    assert.isTrue(
      sections.some((entry: any) =>
        String(entry.paneID).includes("zotwanglele-selection-translation"),
      ),
    );
    const original = getActiveTemplate("selection-translate")!;
    assert.include(original.userPrompt, "{{text}}");
    try {
      updateBuiltinTemplate("selection-translate", {
        systemPrompt: "Translation system",
        userPrompt: "{{text}} => {{targetLang}}",
      });
      assert.equal(
        getActiveTemplate("selection-translate")?.systemPrompt,
        "Translation system",
      );
    } finally {
      updateBuiltinTemplate("selection-translate", original);
    }
  });

  it("maps native panes by reader tab, retains dismissed popup results and cleans up closed readers", async function () {
    const doc = Zotero.getMainWindow().document;
    const WindowEventTarget = (doc.defaultView as any).EventTarget;
    const WindowEvent = (doc.defaultView as any).Event;
    const readers = [0, 1, 2].map((index) => ({
      type: "pdf",
      itemID: 100 + index,
      tabID: index < 2 ? `selection-test-${index}` : undefined,
      _iframeWindow: new WindowEventTarget(),
    }));
    const getReader = Zotero.Reader.getByTabID;
    (Zotero.Reader as any).getByTabID = (id: string) =>
      readers.find((reader) => reader.tabID === id) ||
      getReader.call(Zotero.Reader, id);
    const section = (
      Zotero.ItemPaneManager as any
    ).customSectionData.options.find((entry: any) =>
      String(entry.paneID).includes("zotwanglele-selection-translation"),
    );
    const handler = (Zotero.Reader as any)._registeredListeners.find(
      (entry: any) =>
        entry.type === "renderTextSelectionPopup" &&
        entry.pluginID === config.addonID,
    ).handler;
    const hosts: HTMLElement[] = [];
    const bodies: HTMLElement[] = [];
    const popupHosts: HTMLElement[] = [];
    Zotero.Prefs.set(PREF_PREFIX + "provider", "google", true);
    Zotero.Prefs.set(PREF_PREFIX + "enabled", true, true);
    Zotero.HTTP.request = (async (method: any, url: any, options: any) => {
      if (!String(url).includes("translate.googleapis.com"))
        return originalRequest.call(Zotero.HTTP, method, url, options);
      const text = new URL(String(url)).searchParams.get("q");
      return {
        status: 200,
        responseText: JSON.stringify([[[`译文 ${text}`]], null, "en"]),
      };
    }) as any;
    try {
      for (const reader of readers) {
        const host = element(doc, "div");
        hosts.push(host);
        doc.documentElement!.appendChild(host);
        if (reader.tabID) {
          const details = doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "item-details",
          ) as HTMLElement;
          details.dataset.tabId = reader.tabID;
          const body = element(doc, "div");
          bodies.push(body);
          details.appendChild(body);
          host.appendChild(details);
          section.onRender({
            body,
            tabType: "reader",
            item: { id: 99 },
            setEnabled: (value: boolean) => assert.isTrue(value),
          });
        }
        handler({
          reader,
          doc,
          params: { annotation: { text: `source ${reader.itemID}` } },
          append: (node: HTMLElement) => {
            host.appendChild(node);
            popupHosts.push(node);
          },
        });
        (
          host.querySelector(
            '.zwl-selection-popup [data-action="translate"]',
          ) as HTMLButtonElement
        ).click();
      }
      await sleep(50);
      assert.include(bodies[0].textContent!, "译文 source 100");
      assert.include(bodies[1].textContent!, "译文 source 101");
      assert.notInclude(bodies[0].textContent!, "source 101");
      assert.include(popupHosts[2].textContent!, "译文 source 102");
      popupHosts[0].remove();
      await sleep(20);
      assert.include(bodies[0].textContent!, "译文 source 100");
      const source = bodies[0].querySelector(
        ".zwl-selection-source",
      )!.textContent;
      assert.equal(source, "source 100");
      readers[1]._iframeWindow.dispatchEvent(new WindowEvent("unload"));
      assert.equal(bodies[1].childElementCount, 0);
      assert.isFalse(popupHosts[1].isConnected);
      assert.include(bodies[0].textContent!, "译文 source 100");
    } finally {
      for (const reader of readers)
        reader._iframeWindow.dispatchEvent(new WindowEvent("unload"));
      for (const body of bodies) section.onDestroy({ body });
      for (const host of hosts) host.remove();
      Zotero.Reader.getByTabID = getReader;
    }
  });
});
