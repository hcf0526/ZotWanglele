import { assert } from "chai";
import { config } from "../package.json";
import {
  DEFAULT_SETTINGS,
  getSettings,
  LengthRule,
  PREF_PREFIX,
  setSetting,
  TranslationSettings,
  validRule,
} from "../src/modules/selection-translate/config";
import {
  HistoryEntry,
  HistoryStorage,
  historyBytes,
  TranslationHistory,
} from "../src/modules/selection-translate/history";
import { TranslationSession } from "../src/modules/selection-translate/session";
import {
  countText,
  resolveTargets,
} from "../src/modules/selection-translate/text";
import {
  PreparedTranslator,
  prepareTranslator,
  TranslationRequest,
} from "../src/modules/selection-translate/services";
import {
  element,
  mountTranslationView,
} from "../src/modules/selection-translate/view";
import { mountSelectionPreferences } from "../src/modules/selection-translate/preferences";
import {
  getModelLabel,
  saveProfiles,
  listProfiles,
  updateProfile,
} from "../src/modules/ai/profiles";
import { AiClient } from "../src/modules/ai/ai-client";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const google = { provider: "google" as const, aiProfileId: "" };
const ai = (id: string) => ({ provider: "ai" as const, aiProfileId: id });
const settings = (
  patch: Partial<TranslationSettings> = {},
): TranslationSettings => ({
  ...DEFAULT_SETTINGS,
  provider: "google",
  ...patch,
});
function memoryStorage(): HistoryStorage & { entries: HistoryEntry[] } {
  return {
    entries: [],
    async read() {
      return JSON.parse(JSON.stringify(this.entries));
    },
    async write(entries) {
      this.entries = JSON.parse(JSON.stringify(entries));
    },
  };
}
const result = (id: string, text = "译文") => ({
  routeId: id,
  fingerprint: id,
  provider: "google" as const,
  label: "Google",
  text,
  createdAt: Date.now(),
});

describe("selection history, comparison and routing", function () {
  this.timeout(15000);
  let previousAddon: unknown, previousToolkit: unknown;
  const saved = new Map<string, unknown>();
  const sessions: TranslationSession[] = [];
  const cleanups: Array<() => void> = [];

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

  beforeEach(function () {
    for (const key of Object.keys(DEFAULT_SETTINGS))
      saved.set(key, Zotero.Prefs.get(PREF_PREFIX + key, true));
  });

  afterEach(function () {
    for (const cleanup of cleanups.splice(0)) cleanup();
    for (const instance of sessions.splice(0)) instance.dispose();
    for (const [key, value] of saved) {
      if (value === undefined) Zotero.Prefs.clear(PREF_PREFIX + key, true);
      else Zotero.Prefs.set(PREF_PREFIX + key, value as any, true);
    }
    saved.clear();
  });
  const session = (
    value: TranslationSettings,
    prepare: (value: TranslationSettings) => PreparedTranslator,
    history = new TranslationHistory(memoryStorage()),
  ) => {
    const instance = new TranslationSession(() => value, prepare, history);
    sessions.push(instance);
    return instance;
  };
  const host = () => {
    const doc = Zotero.getMainWindow().document;
    const node = element(doc, "div");
    doc.documentElement!.appendChild(node);
    cleanups.push(() => node.remove());
    return node;
  };

  it("counts contractions, mixed Han text, punctuation and Unicode explicitly", function () {
    assert.equal(
      countText("one two three four five six seven eight nine", "words"),
      9,
    );
    assert.equal(
      countText("one two three four five six seven eight nine ten", "words"),
      10,
    );
    assert.equal(countText("don't state-of-the-art research", "words"), 3);
    assert.equal(countText("hello中文 world", "words"), 4);
    assert.equal(countText("中文，a 😀\n", "characters"), 5);
    assert.equal(countText("  \n", "words"), 0);
  });

  it("routes 9 and 10 words at exclusive upper bounds and respects rule order", function () {
    const rules: LengthRule[] = [
      { id: "short", unit: "words", min: 0, max: 10, targets: [google] },
      {
        id: "long",
        unit: "words",
        min: 10,
        max: null,
        targets: [google, ai("a")],
      },
    ];
    const value = settings({ lengthRulesEnabled: true, lengthRules: rules });
    assert.equal(resolveTargets("word ".repeat(9), value).rule?.id, "short");
    assert.lengthOf(resolveTargets("word ".repeat(10), value).targets, 2);
    assert.equal(resolveTargets("word ".repeat(100), value).rule?.id, "long");
    value.lengthRules = [
      { id: "chars", unit: "characters", min: 2, max: 4, targets: [ai("b")] },
      ...rules,
    ];
    assert.equal(resolveTargets("中文", value).rule?.id, "chars");
    value.lengthRules = [value.lengthRules[0]];
    value.comparisonEnabled = true;
    value.comparisonTargets = [google, ai("a")];
    assert.isUndefined(
      resolveTargets("five words outside the range", value).rule,
    );
    assert.lengthOf(
      resolveTargets("five words outside the range", value).targets,
      0,
    );
    assert.isFalse(validRule({ ...rules[0], max: 0 }));
    assert.isFalse(validRule({ ...rules[0], min: -1 }));
    assert.isFalse(validRule({ ...rules[0], min: 0.5 }));
    assert.isFalse(validRule({ ...rules[0], targets: [] }));
  });

  it("migrates single-provider settings and rejects malformed persisted rules", function () {
    setSetting("comparisonTargets", []);
    setSetting("lengthRules", []);
    setSetting("provider", "deepl");
    const value = getSettings();
    assert.equal(resolveTargets("source", value).targets[0].provider, "deepl");
    Zotero.Prefs.set(
      PREF_PREFIX + "lengthRules",
      JSON.stringify([
        null,
        { id: "bad", min: 5, max: 2, unit: "words", targets: [google] },
      ]),
      true,
    );
    Zotero.Prefs.set(PREF_PREFIX + "comparisonTargets", "invalid JSON", true);
    Zotero.Prefs.set(PREF_PREFIX + "historyLimit", -10, true);
    assert.lengthOf(getSettings().lengthRules, 0);
    assert.lengthOf(getSettings().comparisonTargets, 0);
    assert.equal(getSettings().historyLimit, 0);
  });

  it("limits UTF-8 history bytes on record, reload and capacity changes", async function () {
    const storage = memoryStorage();
    let capacity = 2;
    const history = new TranslationHistory(
      storage,
      () => 100,
      () => capacity,
    );
    const text = "中😀".repeat(90000);
    await history.record("first", "auto", "zh-CN", result("a", text));
    await history.record("second", "auto", "zh-CN", result("b", text));
    assert.lengthOf(history.snapshot, 2);
    const reloaded = new TranslationHistory(
      storage,
      () => 100,
      () => 1,
    );
    await reloaded.ready();
    assert.lengthOf(reloaded.snapshot, 1);
    assert.equal(reloaded.snapshot[0].sourceText, "second");
    assert.isAtMost(historyBytes(storage.entries), 1024 * 1024);
    await reloaded.record(
      "oversized",
      "auto",
      "zh-CN",
      result("c", text.repeat(2)),
    );
    assert.equal(reloaded.snapshot[0].sourceText, "second");
    capacity = 0;
    await history.trim();
    assert.lengthOf(history.snapshot, 0);
    assert.lengthOf(storage.entries, 0);
  });

  it("persists grouped results across store reloads and trims by source entries", async function () {
    const storage = memoryStorage();
    let limit = 2;
    const history = new TranslationHistory(storage, () => limit);
    await history.record("first", "auto", "zh-CN", result("google"));
    await history.record("first", "auto", "zh-CN", result("ai"));
    assert.lengthOf(history.snapshot, 1);
    assert.lengthOf(history.snapshot[0].results, 2);
    await history.record("second", "auto", "zh-CN", result("google"));
    await history.record("third", "auto", "zh-CN", result("google"));
    assert.deepEqual(
      history.snapshot.map((entry) => entry.sourceText),
      ["third", "second"],
    );
    const reloaded = new TranslationHistory(storage, () => limit);
    await reloaded.ready();
    assert.equal(
      reloaded.find("third", "auto", "zh-CN", "google")?.text,
      "译文",
    );
    assert.isUndefined(reloaded.find("third", "en", "zh-CN", "google"));
    assert.isUndefined(reloaded.find("third", "auto", "en", "google"));
    assert.isUndefined(reloaded.find("third", "auto", "zh-CN", "new-model"));
    limit = 1;
    await reloaded.trim();
    assert.lengthOf(storage.entries, 1);
    await reloaded.remove(reloaded.snapshot[0].id);
    assert.lengthOf(storage.entries, 0);
    await reloaded.record("last", "auto", "zh-CN", result("google"));
    limit = 0;
    await reloaded.trim();
    await reloaded.record("disabled", "auto", "zh-CN", result("google"));
    assert.lengthOf(storage.entries, 0);
  });

  it("reuses history immediately after reselection and after a new reader/store", async function () {
    let calls = 0;
    const storage = memoryStorage();
    const prepare = () => ({
      fingerprint: "same",
      translate: async () => {
        calls++;
        return { text: "历史译文" };
      },
    });
    const first = session(settings(), prepare, new TranslationHistory(storage));
    first.setSelection("same source");
    await first.run();
    first.setSelection("other");
    first.setSelection(" same  source ");
    await tick();
    assert.isTrue(first.snapshot.fromCache);
    assert.equal(first.snapshot.text, "历史译文");
    first.dispose();
    const next = session(settings(), prepare, new TranslationHistory(storage));
    next.setSelection("same source");
    await next.run();
    await next.run();
    assert.equal(calls, 1);
    assert.isTrue(next.snapshot.fromCache);
  });

  it("requests only missing comparison results and preserves success after a failure", async function () {
    const calls: string[] = [];
    let fail = true;
    const value = settings({
      comparisonEnabled: true,
      comparisonTargets: [google, ai("a"), ai("b")],
    });
    const instance = session(value, (selected) => {
      const id = selected.provider === "ai" ? selected.aiProfileId : "google";
      return {
        fingerprint: id,
        translate: async (request) => {
          calls.push(id);
          request.onChunk?.(`${id} partial`);
          if (id === "b" && fail) throw new Error("network");
          return { text: `${id} complete` };
        },
      };
    });
    instance.setSelection("comparison");
    await instance.run();
    assert.equal(instance.snapshot.status, "partial");
    assert.lengthOf(instance.history.snapshot[0].results, 2);
    assert.equal(instance.snapshot.results[2].status, "error");
    fail = false;
    await instance.run();
    assert.deepEqual(calls, ["google", "a", "b", "b"]);
    assert.equal(instance.snapshot.status, "success");
    assert.isTrue(instance.snapshot.results[0].fromCache);
    assert.isTrue(instance.snapshot.results[1].fromCache);
    assert.isFalse(instance.snapshot.results[2].fromCache);
    await instance.run();
    assert.lengthOf(calls, 4);
    assert.isTrue(instance.snapshot.fromCache);
  });

  it("starts comparison requests independently and cancels every unfinished result", async function () {
    const requests: TranslationRequest[] = [];
    const finish: Array<(value: { text: string }) => void> = [];
    const instance = session(
      settings({
        comparisonEnabled: true,
        comparisonTargets: [google, ai("a")],
      }),
      (value) => ({
        fingerprint: value.provider,
        translate: (request) => {
          requests.push(request);
          return new Promise((resolve) => finish.push(resolve));
        },
      }),
    );
    instance.setSelection("old");
    const work = instance.run();
    await tick();
    assert.lengthOf(requests, 2);
    requests[0].onChunk?.("partial");
    instance.setSelection("new");
    assert.isTrue(requests.every((request) => request.signal.aborted));
    for (const request of requests) request.onChunk?.("stale");
    for (const resolve of finish) resolve({ text: "late result" });
    await work;
    assert.equal(instance.snapshot.text, "");
    assert.lengthOf(instance.history.snapshot, 0);
  });

  it("retains completed translations when persistence fails and reports the storage error", async function () {
    const history = new TranslationHistory({
      read: async () => [],
      write: async () => {
        throw new Error("disk full");
      },
    });
    const instance = session(
      settings(),
      () => ({
        fingerprint: "google",
        translate: async () => ({ text: "completed" }),
      }),
      history,
    );
    instance.setSelection("source");
    await instance.run();
    assert.equal(instance.snapshot.status, "success");
    assert.equal(instance.snapshot.text, "completed");
    assert.equal(history.error, "history-write");
  });

  it("keeps cache identity independent of history limits, rules and unrelated credentials", function () {
    const value = settings();
    const signature = prepareTranslator(value).fingerprint;
    assert.equal(
      prepareTranslator({
        ...value,
        historyLimit: 3,
        automatic: true,
        comparisonEnabled: true,
        comparisonTargets: [google, ai("a")],
        deeplKey: "unrelated",
      }).fingerprint,
      signature,
    );
    const deepl = settings({ provider: "deepl", deeplKey: "old" });
    assert.notEqual(
      prepareTranslator(deepl).fingerprint,
      prepareTranslator({ ...deepl, deeplKey: "new" }).fingerprint,
    );
    const label = getModelLabel({
      name: "raw",
      provider: "custom",
      supplier: "供应商",
      model: "nested/model",
      baseUrl: "",
      apiKey: "",
      format: "chat-completions",
      temperature: 70,
      maxTokens: 4096,
    });
    assert.equal(label, "供应商/nested/model");
  });

  it("uses actual AI model routes alongside Google and invalidates only the changed model", async function () {
    const profiles = listProfiles();
    const request = Zotero.HTTP.request;
    const createXHR = (AiClient.prototype as any).createXHR;
    const calls: Array<{ url: string; body: any }> = [];
    try {
      saveProfiles([
        {
          id: "compare-a",
          name: "a",
          supplier: "供应商甲",
          provider: "custom",
          model: "model-a",
          baseUrl: "https://a.invalid",
          apiKey: "test-key-a",
          format: "chat-completions",
          temperature: 70,
          maxTokens: 4096,
        },
        {
          id: "compare-b",
          name: "b",
          supplier: "供应商乙",
          provider: "custom",
          model: "model-b",
          baseUrl: "https://b.invalid",
          apiKey: "test-key-b",
          format: "responses",
          temperature: 70,
          maxTokens: 4096,
        },
      ]);
      (AiClient.prototype as any).createXHR = () => ({
        status: 200,
        responseText: "",
        url: "",
        onprogress: null,
        onload: null,
        open(_method: string, url: string) {
          this.url = url;
        },
        setRequestHeader() {},
        abort() {},
        send(body: string) {
          const data = JSON.parse(body);
          calls.push({ url: this.url, body: data });
          setTimeout(() => {
            const response = this.url.endsWith("/responses");
            this.responseText = response
              ? `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Responses 译文" })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`
              : `data: ${JSON.stringify({ choices: [{ delta: { content: "Chat 译文" } }] })}\n\ndata: [DONE]\n\n`;
            (this as any).onprogress?.();
            (this as any).onload?.();
          }, 0);
        },
      });
      Zotero.HTTP.request = (async (_method: string, url: string) => {
        calls.push({ url, body: {} });
        return {
          status: 200,
          responseText: JSON.stringify([[["Google 译文"]], null, "en"]),
        };
      }) as any;
      const instance = session(
        settings({
          comparisonEnabled: true,
          comparisonTargets: [google, ai("compare-a"), ai("compare-b")],
        }),
        prepareTranslator,
      );
      instance.setSelection("route check");
      await instance.run();
      assert.equal(instance.snapshot.status, "success");
      assert.equal(instance.snapshot.results[1].label, "供应商甲/model-a");
      assert.equal(instance.snapshot.results[2].label, "供应商乙/model-b");
      assert.deepEqual(
        calls.filter((call) => call.body.model).map((call) => call.body.model),
        ["model-a", "model-b"],
      );
      assert.isTrue(
        calls.some(
          (call) => call.url === "https://a.invalid/v1/chat/completions",
        ),
      );
      assert.isTrue(
        calls.some((call) => call.url === "https://b.invalid/v1/responses"),
      );
      await instance.run();
      assert.lengthOf(calls, 3);
      updateProfile("compare-a", { model: "model-a-updated" });
      await instance.run();
      assert.lengthOf(calls, 4);
      assert.equal(calls[3].body.model, "model-a-updated");
      assert.isTrue(instance.snapshot.results[0].fromCache);
      assert.isTrue(instance.snapshot.results[2].fromCache);
    } finally {
      Zotero.HTTP.request = request;
      (AiClient.prototype as any).createXHR = createXHR;
      saveProfiles(profiles);
    }
  });

  it("shows searchable history only in the sidebar and reopens it without network calls", async function () {
    let calls = 0;
    const instance = session(settings(), () => ({
      fingerprint: "google",
      translate: async () => {
        calls++;
        return { text: "<img src=x>历史译文" };
      },
    }));
    const node = host();
    cleanups.push(
      mountTranslationView(node, instance, true),
      mountTranslationView(node, instance, false),
    );
    instance.setSelection("<b>saved source</b>");
    await instance.run();
    assert.lengthOf(node.querySelectorAll(".zwl-selection-history"), 1);
    assert.isNull(
      node.querySelector(".zwl-selection-popup .zwl-selection-history"),
    );
    instance.setSelection("different");
    (
      node.querySelector('[data-action="history-open"]') as HTMLButtonElement
    ).click();
    assert.isTrue(instance.snapshot.fromCache);
    assert.equal(instance.snapshot.sourceText, "<b>saved source</b>");
    assert.equal(calls, 1);
    assert.isNull(node.querySelector(".zwl-selection-result img"));
    const search = node.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;
    search.value = "absent";
    search.dispatchEvent(
      new (node.ownerDocument!.defaultView as any).Event("input"),
    );
    assert.lengthOf(node.querySelectorAll('[data-action="history-open"]'), 0);
    search.value = "历史译文";
    search.dispatchEvent(
      new (node.ownerDocument!.defaultView as any).Event("input"),
    );
    assert.lengthOf(node.querySelectorAll('[data-action="history-open"]'), 1);
    (
      node.querySelector('[data-action="history-remove"]') as HTMLButtonElement
    ).click();
    await tick();
    assert.lengthOf(instance.history.snapshot, 0);
  });

  it("adds translator rows and validates length plans without legacy controls", function () {
    setSetting("lengthRules", []);
    setSetting("rulesConfigured", true);
    const node = host();
    cleanups.push(mountSelectionPreferences(node.ownerDocument!, node));
    const event = (type: string) =>
      new (node.ownerDocument!.defaultView as any).Event(type, {
        bubbles: true,
      });
    const click = (action: string) =>
      (
        node.querySelector(`[data-action="${action}"]`) as HTMLButtonElement
      ).click();
    assert.isNull(node.querySelector('[data-pref="comparisonEnabled"]'));
    assert.isNull(node.querySelector('[data-pref="provider"]'));
    assert.isNull(node.querySelector('[data-pref="lengthRulesEnabled"]'));
    click("rule-add");
    click("rules-save");
    assert.lengthOf(getSettings().lengthRules, 0);
    click("target-add");
    const service = node.querySelector(
      '[data-field="provider"]',
    ) as HTMLSelectElement;
    service.value = "ai";
    service.dispatchEvent(event("change"));
    const model = node.querySelector(
      '[data-field="aiProfileId"]',
    ) as HTMLSelectElement;
    assert.isFalse(model.parentElement!.hidden);
    click("rules-save");
    assert.lengthOf(getSettings().lengthRules, 0);
    service.value = "google";
    service.dispatchEvent(event("change"));
    assert.isTrue(model.parentElement!.hidden);
    const min = node.querySelector('[data-field="min"]') as HTMLInputElement;
    const max = node.querySelector('[data-field="max"]') as HTMLInputElement;
    min.value = "10";
    min.dispatchEvent(event("input"));
    max.value = "5";
    max.dispatchEvent(event("input"));
    click("rules-save");
    assert.lengthOf(getSettings().lengthRules, 0);
    max.value = "";
    max.dispatchEvent(event("input"));
    click("rules-save");
    assert.equal(getSettings().lengthRules[0].min, 10);
    assert.isNull(getSettings().lengthRules[0].max);
    assert.deepEqual(getSettings().lengthRules[0].targets, [google]);
    click("rule-remove");
    click("rules-save");
    assert.isTrue(getSettings().rulesConfigured);
    assert.lengthOf(resolveTargets("text", getSettings()).targets, 0);
  });

  it("makes no request when saved plans are empty or no range matches", async function () {
    let prepared = 0;
    const instance = session(
      settings({ rulesConfigured: true, lengthRules: [] }),
      () => {
        prepared++;
        throw new Error("Unexpected preparation");
      },
    );
    instance.setSelection("unmatched text");
    await instance.run();
    assert.equal(prepared, 0);
    assert.equal(instance.snapshot.status, "error");
  });
});
